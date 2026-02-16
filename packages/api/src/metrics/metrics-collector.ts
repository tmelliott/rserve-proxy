/**
 * Metrics Collector — periodically polls Docker for container resource usage
 * and records status history from the HealthMonitor.
 *
 * Maintains in-memory ring buffers (capped at MAX_ENTRIES = 1440 ≈ 24h at 1/min)
 * so the API can serve time-windowed metrics without external storage.
 *
 * IMPORTANT: Like the spawner module, this is independent of the web
 * framework. It receives its dependencies via constructor injection.
 */

import type Docker from "dockerode";
import type { DockerSpawner } from "../spawner/docker-spawner.js";
import type { HealthMonitor } from "../spawner/health-monitor.js";
import type {
  AppMetricsSnapshot,
  SystemMetricsSnapshot,
  StatusHistoryEntry,
  MetricsPeriod,
  AppStatusHistory,
} from "@rserve-proxy/shared";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 60_000; // 1 minute
const MAX_ENTRIES = 1440; // 24 hours at 1/min

/** Map period strings to milliseconds */
const PERIOD_MS: Record<MetricsPeriod, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Previous stats reading for computing CPU % and network deltas */
interface PreviousStats {
  cpuTotal: number;
  systemCpu: number;
  networkRx: number;
  networkTx: number;
}

export interface MetricsCollectorOptions {
  /** Collection interval in ms (default: 60000 = 1 min) */
  intervalMs?: number;
}

// ---------------------------------------------------------------------------
// MetricsCollector
// ---------------------------------------------------------------------------

export class MetricsCollector {
  private spawner: DockerSpawner;
  private healthMonitor: HealthMonitor;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Per-app resource snapshots (ring buffer) */
  private appMetrics = new Map<string, AppMetricsSnapshot[]>();

  /** System-wide resource snapshots (ring buffer) */
  private systemMetrics: SystemMetricsSnapshot[] = [];

  /** Per-app status history (ring buffer) */
  private statusHistory = new Map<string, StatusHistoryEntry[]>();

  /** Previous container stats for delta calculations */
  private prevStats = new Map<string, PreviousStats>();

  /** App name cache (appId → name) to avoid DB lookups */
  private appNames = new Map<string, string>();

  constructor(
    spawner: DockerSpawner,
    healthMonitor: HealthMonitor,
    options?: MetricsCollectorOptions,
  ) {
    this.spawner = spawner;
    this.healthMonitor = healthMonitor;
    this.intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  }

  /** Start the collection loop */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.collect(), this.intervalMs);
    // Run an initial collection immediately
    this.collect();
  }

  /** Stop the collection loop */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Whether the collector is running */
  get isRunning(): boolean {
    return this.timer !== null;
  }

  /** Register an app name for status history labels */
  setAppName(appId: string, name: string): void {
    this.appNames.set(appId, name);
  }

  // -----------------------------------------------------------------------
  // Public query methods
  // -----------------------------------------------------------------------

  /** Get system-wide metrics for a time period */
  getSystemMetrics(period: MetricsPeriod = "1h"): SystemMetricsSnapshot[] {
    return filterByPeriod(this.systemMetrics, period);
  }

  /** Get per-app metrics for a time period */
  getAppMetrics(appId: string, period: MetricsPeriod = "1h"): AppMetricsSnapshot[] {
    const data = this.appMetrics.get(appId) ?? [];
    return filterByPeriod(data, period);
  }

  /** Get status history for all apps */
  getStatusHistory(period: MetricsPeriod = "1h"): AppStatusHistory[] {
    const result: AppStatusHistory[] = [];
    for (const [appId, entries] of this.statusHistory) {
      result.push({
        appId,
        appName: this.appNames.get(appId) ?? appId,
        entries: filterByPeriod(entries, period, "timestamp"),
      });
    }
    return result;
  }

  /** Get status history for a single app */
  getAppStatusHistory(appId: string, period: MetricsPeriod = "1h"): StatusHistoryEntry[] {
    const entries = this.statusHistory.get(appId) ?? [];
    return filterByPeriod(entries, period, "timestamp");
  }

  // -----------------------------------------------------------------------
  // Internal collection
  // -----------------------------------------------------------------------

  /** Run a single collection cycle */
  private async collect(): Promise<void> {
    const now = new Date().toISOString();

    // 1. Record status from health monitor
    this.recordStatusHistory(now);

    // 2. Collect Docker container stats
    let totalCpu = 0;
    let totalMemory = 0;
    let totalMemoryLimit = 0;
    let totalRx = 0;
    let totalTx = 0;
    let totalContainers = 0;
    const activeAppIds = new Set<string>();

    // Per-app accumulator
    const appAccum = new Map<string, {
      cpu: number;
      mem: number;
      memLimit: number;
      rx: number;
      tx: number;
      containers: number;
    }>();

    try {
      const docker = this.spawner.getDocker();
      const containers = await this.spawner.listManagedContainers();

      for (const containerInfo of containers) {
        if (containerInfo.State !== "running") continue;

        const appId = containerInfo.Labels?.["rserve-proxy.app-id"];
        if (!appId) continue;

        activeAppIds.add(appId);

        try {
          const container = docker.getContainer(containerInfo.Id);
          const stats = await container.stats({ stream: false }) as Docker.ContainerStats;
          const computed = this.computeStats(containerInfo.Id, stats);

          if (!appAccum.has(appId)) {
            appAccum.set(appId, { cpu: 0, mem: 0, memLimit: 0, rx: 0, tx: 0, containers: 0 });
          }
          const acc = appAccum.get(appId)!;
          acc.cpu += computed.cpuPercent;
          acc.mem += computed.memoryMB;
          acc.memLimit += computed.memoryLimitMB;
          acc.rx += computed.networkRxBytes;
          acc.tx += computed.networkTxBytes;
          acc.containers += 1;

          totalCpu += computed.cpuPercent;
          totalMemory += computed.memoryMB;
          totalMemoryLimit += computed.memoryLimitMB;
          totalRx += computed.networkRxBytes;
          totalTx += computed.networkTxBytes;
          totalContainers += 1;
        } catch {
          // Container may have stopped between list and stats — skip
        }
      }
    } catch {
      // Docker unavailable — record zeros
    }

    // 3. Store per-app metrics
    for (const [appId, acc] of appAccum) {
      const snapshot: AppMetricsSnapshot = {
        appId,
        cpuPercent: round2(acc.cpu),
        memoryMB: round2(acc.mem),
        memoryLimitMB: round2(acc.memLimit),
        networkRxBytes: acc.rx,
        networkTxBytes: acc.tx,
        requestsPerMin: null, // Phase 7d
        containers: acc.containers,
        collectedAt: now,
      };
      pushRingBuffer(this.appMetrics, appId, snapshot, MAX_ENTRIES);
    }

    // 4. Store system metrics
    const systemSnapshot: SystemMetricsSnapshot = {
      cpuPercent: round2(totalCpu),
      memoryMB: round2(totalMemory),
      memoryLimitMB: round2(totalMemoryLimit),
      networkRxBytes: totalRx,
      networkTxBytes: totalTx,
      requestsPerMin: null, // Phase 7d
      activeContainers: totalContainers,
      activeApps: activeAppIds.size,
      collectedAt: now,
    };
    this.systemMetrics.push(systemSnapshot);
    if (this.systemMetrics.length > MAX_ENTRIES) {
      this.systemMetrics.splice(0, this.systemMetrics.length - MAX_ENTRIES);
    }
  }

  /** Record current status from health monitor into status history */
  private recordStatusHistory(now: string): void {
    const snapshots = this.healthMonitor.getAllSnapshots();
    for (const snap of snapshots) {
      const entry: StatusHistoryEntry = {
        status: snap.status,
        timestamp: now,
      };

      if (!this.statusHistory.has(snap.appId)) {
        this.statusHistory.set(snap.appId, []);
      }
      const entries = this.statusHistory.get(snap.appId)!;
      entries.push(entry);
      if (entries.length > MAX_ENTRIES) {
        entries.splice(0, entries.length - MAX_ENTRIES);
      }
    }
  }

  /** Compute CPU %, memory MB, and network deltas from Docker stats */
  private computeStats(
    containerId: string,
    stats: Docker.ContainerStats,
  ): {
    cpuPercent: number;
    memoryMB: number;
    memoryLimitMB: number;
    networkRxBytes: number;
    networkTxBytes: number;
  } {
    // CPU calculation: delta approach
    const cpuTotal = stats.cpu_stats?.cpu_usage?.total_usage ?? 0;
    const systemCpu = stats.cpu_stats?.system_cpu_usage ?? 0;
    const numCpus = stats.cpu_stats?.online_cpus ?? 1;

    let cpuPercent = 0;
    const prev = this.prevStats.get(containerId);
    if (prev) {
      const cpuDelta = cpuTotal - prev.cpuTotal;
      const systemDelta = systemCpu - prev.systemCpu;
      if (systemDelta > 0) {
        cpuPercent = (cpuDelta / systemDelta) * numCpus * 100;
      }
    }

    // Memory
    const memoryUsage = stats.memory_stats?.usage ?? 0;
    const memoryLimit = stats.memory_stats?.limit ?? 0;
    const memoryMB = memoryUsage / (1024 * 1024);
    const memoryLimitMB = memoryLimit / (1024 * 1024);

    // Network — sum all interfaces
    let networkRx = 0;
    let networkTx = 0;
    if (stats.networks) {
      for (const iface of Object.values(stats.networks)) {
        networkRx += iface.rx_bytes ?? 0;
        networkTx += iface.tx_bytes ?? 0;
      }
    }

    // Compute network deltas
    let networkRxDelta = 0;
    let networkTxDelta = 0;
    if (prev) {
      networkRxDelta = Math.max(0, networkRx - prev.networkRx);
      networkTxDelta = Math.max(0, networkTx - prev.networkTx);
    }

    // Save current for next delta
    this.prevStats.set(containerId, {
      cpuTotal,
      systemCpu,
      networkRx,
      networkTx,
    });

    return {
      cpuPercent,
      memoryMB,
      memoryLimitMB,
      networkRxBytes: networkRxDelta,
      networkTxBytes: networkTxDelta,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Filter array by time period, using collectedAt or a custom timestamp field */
function filterByPeriod<T extends Record<string, unknown>>(
  data: T[],
  period: MetricsPeriod,
  tsField: string = "collectedAt",
): T[] {
  const cutoff = Date.now() - PERIOD_MS[period];
  return data.filter((d) => new Date(d[tsField] as string).getTime() >= cutoff);
}

/** Round to 2 decimal places */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Push to a per-key ring buffer stored in a Map */
function pushRingBuffer<T>(
  map: Map<string, T[]>,
  key: string,
  value: T,
  maxSize: number,
): void {
  if (!map.has(key)) {
    map.set(key, []);
  }
  const arr = map.get(key)!;
  arr.push(value);
  if (arr.length > maxSize) {
    arr.splice(0, arr.length - maxSize);
  }
}
