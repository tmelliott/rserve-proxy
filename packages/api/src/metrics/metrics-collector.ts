/**
 * Metrics Collector — periodically polls Docker for container resource usage
 * and records status history from the HealthMonitor.
 *
 * Storage strategy (tiered):
 *  - In-memory ring buffers for fast "1h" queries (MAX_ENTRIES at 10s resolution)
 *  - Postgres tables for longer periods (6h/24h raw, 7d aggregated)
 *  - Auto-prunes DB rows older than 7 days
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
  AggregatedSnapshot,
} from "@rserve-proxy/shared";
import { scrapeTraefikMetrics } from "./traefik-scraper.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 10_000; // 10 seconds
const MAX_ENTRIES = 360; // 1 hour at 10s intervals
const PRUNE_EVERY_N_CYCLES = 6; // Prune every ~60s (6 × 10s)
const RETENTION_DAYS = 7;

/** Map period strings to milliseconds */
export const PERIOD_MS: Record<MetricsPeriod, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

// ---------------------------------------------------------------------------
// DB interface (to avoid coupling to drizzle directly)
// ---------------------------------------------------------------------------

/** A persisted status point (appId + status + timestamp) */
export interface StatusPoint {
  appId: string;
  status: string;
  collectedAt: string; // ISO 8601
}

/** Minimal DB interface for persistence — allows mocking in tests */
export interface MetricsDb {
  insertAppMetrics(snapshots: AppMetricsSnapshot[]): Promise<void>;
  insertSystemMetrics(snapshot: SystemMetricsSnapshot): Promise<void>;
  insertStatusPoints(points: StatusPoint[]): Promise<void>;
  queryAppMetrics(appId: string, since: Date): Promise<AppMetricsSnapshot[]>;
  queryAllAppMetrics(since: Date): Promise<AppMetricsSnapshot[]>;
  querySystemMetrics(since: Date): Promise<SystemMetricsSnapshot[]>;
  queryStatusPoints(since: Date): Promise<StatusPoint[]>;
  queryAppStatusPoints(appId: string, since: Date): Promise<StatusPoint[]>;
  queryAppMetricsAggregated(appId: string, since: Date, bucketMinutes: number): Promise<AggregatedSnapshot[]>;
  querySystemMetricsAggregated(since: Date, bucketMinutes: number): Promise<AggregatedSnapshot[]>;
  pruneOlderThan(date: Date): Promise<void>;
}

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
  /** Collection interval in ms (default: 10000 = 10s) */
  intervalMs?: number;
  /** Traefik Prometheus metrics URL (e.g. http://traefik:8082/metrics) */
  traefikUrl?: string;
  /** Database persistence layer (optional — metrics are in-memory only without it) */
  metricsDb?: MetricsDb;
}

// ---------------------------------------------------------------------------
// MetricsCollector
// ---------------------------------------------------------------------------

export class MetricsCollector {
  private spawner: DockerSpawner;
  private healthMonitor: HealthMonitor;
  private intervalMs: number;
  private traefikUrl: string | null;
  private metricsDb: MetricsDb | null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cycleCount = 0;

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

  /** Slug → appId mapping for Traefik service name resolution */
  private slugToAppId = new Map<string, string>();

  /** Previous Traefik request counters for delta computation (slug → count) */
  private prevRequestCounts = new Map<string, number>();

  constructor(
    spawner: DockerSpawner,
    healthMonitor: HealthMonitor,
    options?: MetricsCollectorOptions,
  ) {
    this.spawner = spawner;
    this.healthMonitor = healthMonitor;
    this.intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.traefikUrl = options?.traefikUrl ?? null;
    this.metricsDb = options?.metricsDb ?? null;
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

  /** Register a slug → appId mapping for Traefik service name resolution */
  setAppSlug(appId: string, slug: string): void {
    this.slugToAppId.set(slug, appId);
  }

  // -----------------------------------------------------------------------
  // Public query methods
  // -----------------------------------------------------------------------

  /** Get system-wide metrics for a time period (in-memory only) */
  getSystemMetrics(period: MetricsPeriod = "1h"): SystemMetricsSnapshot[] {
    return filterByPeriod(this.systemMetrics, period);
  }

  /** Get per-app metrics for a time period (in-memory only) */
  getAppMetrics(appId: string, period: MetricsPeriod = "1h"): AppMetricsSnapshot[] {
    const data = this.appMetrics.get(appId) ?? [];
    return filterByPeriod(data, period);
  }

  /** Get system metrics from DB for longer periods */
  async getSystemMetricsFromDb(period: MetricsPeriod): Promise<SystemMetricsSnapshot[]> {
    if (!this.metricsDb) return [];
    const since = new Date(Date.now() - PERIOD_MS[period]);
    return this.metricsDb.querySystemMetrics(since);
  }

  /** Get app metrics from DB for longer periods */
  async getAppMetricsFromDb(appId: string, period: MetricsPeriod): Promise<AppMetricsSnapshot[]> {
    if (!this.metricsDb) return [];
    const since = new Date(Date.now() - PERIOD_MS[period]);
    return this.metricsDb.queryAppMetrics(appId, since);
  }

  /** Get aggregated system metrics from DB (for 7d view) */
  async getSystemMetricsAggregated(period: MetricsPeriod, bucketMinutes = 5): Promise<AggregatedSnapshot[]> {
    if (!this.metricsDb) return [];
    const since = new Date(Date.now() - PERIOD_MS[period]);
    return this.metricsDb.querySystemMetricsAggregated(since, bucketMinutes);
  }

  /** Get aggregated app metrics from DB (for 7d view) */
  async getAppMetricsAggregated(appId: string, period: MetricsPeriod, bucketMinutes = 5): Promise<AggregatedSnapshot[]> {
    if (!this.metricsDb) return [];
    const since = new Date(Date.now() - PERIOD_MS[period]);
    return this.metricsDb.queryAppMetricsAggregated(appId, since, bucketMinutes);
  }

  /** Get status history for all apps (in-memory) */
  getStatusHistory(period: MetricsPeriod = "1h"): AppStatusHistory[] {
    const result: AppStatusHistory[] = [];
    for (const [appId, entries] of this.statusHistory) {
      result.push({
        appId,
        appName: this.appNames.get(appId) ?? appId,
        entries: filterByPeriod(entries, period, (e) => e.timestamp),
      });
    }
    return result;
  }

  /** Get status history for a single app (in-memory) */
  getAppStatusHistory(appId: string, period: MetricsPeriod = "1h"): StatusHistoryEntry[] {
    const entries = this.statusHistory.get(appId) ?? [];
    return filterByPeriod(entries, period, (e) => e.timestamp);
  }

  /** Get status history for all apps from DB (for longer periods) */
  async getStatusHistoryFromDb(period: MetricsPeriod): Promise<AppStatusHistory[]> {
    if (!this.metricsDb) return [];
    const since = new Date(Date.now() - PERIOD_MS[period]);
    const points = await this.metricsDb.queryStatusPoints(since);
    // Group by appId
    const byApp = new Map<string, StatusHistoryEntry[]>();
    for (const p of points) {
      if (!byApp.has(p.appId)) byApp.set(p.appId, []);
      byApp.get(p.appId)!.push({ status: p.status as StatusHistoryEntry["status"], timestamp: p.collectedAt });
    }
    const result: AppStatusHistory[] = [];
    for (const [appId, entries] of byApp) {
      result.push({ appId, appName: this.appNames.get(appId) ?? appId, entries });
    }
    return result;
  }

  /** Get status history for a single app from DB (for longer periods) */
  async getAppStatusHistoryFromDb(appId: string, period: MetricsPeriod): Promise<StatusHistoryEntry[]> {
    if (!this.metricsDb) return [];
    const since = new Date(Date.now() - PERIOD_MS[period]);
    const points = await this.metricsDb.queryAppStatusPoints(appId, since);
    return points.map((p) => ({ status: p.status as StatusHistoryEntry["status"], timestamp: p.collectedAt }));
  }

  /** Hydrate in-memory ring buffers from DB (called on startup) */
  async hydrateFromDb(): Promise<void> {
    if (!this.metricsDb) return;
    const since = new Date(Date.now() - PERIOD_MS["1h"]);
    const [sysRows, appRows, statusRows] = await Promise.all([
      this.metricsDb.querySystemMetrics(since),
      this.metricsDb.queryAllAppMetrics(since),
      this.metricsDb.queryStatusPoints(since),
    ]);
    // System metrics
    this.systemMetrics = sysRows.slice(-MAX_ENTRIES);
    // App metrics — group by appId
    for (const row of appRows) {
      if (!this.appMetrics.has(row.appId)) this.appMetrics.set(row.appId, []);
      const arr = this.appMetrics.get(row.appId)!;
      arr.push(row);
      if (arr.length > MAX_ENTRIES) arr.splice(0, arr.length - MAX_ENTRIES);
    }
    // Status history — group by appId
    for (const p of statusRows) {
      if (!this.statusHistory.has(p.appId)) this.statusHistory.set(p.appId, []);
      const arr = this.statusHistory.get(p.appId)!;
      arr.push({ status: p.status as StatusHistoryEntry["status"], timestamp: p.collectedAt });
      if (arr.length > MAX_ENTRIES) arr.splice(0, arr.length - MAX_ENTRIES);
    }
  }

  // -----------------------------------------------------------------------
  // Internal collection
  // -----------------------------------------------------------------------

  /** Run a single collection cycle */
  private async collect(): Promise<void> {
    const now = new Date().toISOString();
    this.cycleCount++;

    // 1. Record status from health monitor
    const statusPoints = this.recordStatusHistory(now);

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

    // 3. Scrape Traefik metrics for request rates
    const appRequestRates = new Map<string, number>();
    let totalRequestsPerMin: number | null = null;

    if (this.traefikUrl) {
      const counts = await scrapeTraefikMetrics(this.traefikUrl);
      if (counts.size > 0) {
        let totalRate = 0;
        const minutesFactor = this.intervalMs / 60_000;

        for (const [slug, currentCount] of counts) {
          const prev = this.prevRequestCounts.get(slug);
          if (prev !== undefined) {
            const delta = Math.max(0, currentCount - prev);
            const rate = round2(delta / minutesFactor);
            // Map slug → appId
            const appId = this.slugToAppId.get(slug);
            if (appId) {
              appRequestRates.set(
                appId,
                (appRequestRates.get(appId) ?? 0) + rate,
              );
              totalRate += rate;
            }
          }
        }

        // Save current counters for next delta
        this.prevRequestCounts = counts;

        // Only report system total if we had previous data to delta against
        if (this.prevRequestCounts.size > 0) {
          totalRequestsPerMin = round2(totalRate);
        }
      }
    }

    // 4. Store per-app metrics (in-memory ring buffer)
    const appSnapshots: AppMetricsSnapshot[] = [];
    for (const [appId, acc] of appAccum) {
      const snapshot: AppMetricsSnapshot = {
        appId,
        cpuPercent: round2(acc.cpu),
        memoryMB: round2(acc.mem),
        memoryLimitMB: round2(acc.memLimit),
        networkRxBytes: acc.rx,
        networkTxBytes: acc.tx,
        requestsPerMin: appRequestRates.get(appId) ?? null,
        containers: acc.containers,
        collectedAt: now,
      };
      pushRingBuffer(this.appMetrics, appId, snapshot, MAX_ENTRIES);
      appSnapshots.push(snapshot);
    }

    // 5. Store system metrics (in-memory ring buffer)
    const systemSnapshot: SystemMetricsSnapshot = {
      cpuPercent: round2(totalCpu),
      memoryMB: round2(totalMemory),
      memoryLimitMB: round2(totalMemoryLimit),
      networkRxBytes: totalRx,
      networkTxBytes: totalTx,
      requestsPerMin: totalRequestsPerMin,
      activeContainers: totalContainers,
      activeApps: activeAppIds.size,
      collectedAt: now,
    };
    this.systemMetrics.push(systemSnapshot);
    if (this.systemMetrics.length > MAX_ENTRIES) {
      this.systemMetrics.splice(0, this.systemMetrics.length - MAX_ENTRIES);
    }

    // 6. Persist to database (fire-and-forget)
    if (this.metricsDb) {
      this.persistToDb(appSnapshots, systemSnapshot, statusPoints).catch(() => {});
    }

    // 7. Periodic pruning (~every 60s)
    if (this.metricsDb && this.cycleCount % PRUNE_EVERY_N_CYCLES === 0) {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
      this.metricsDb.pruneOlderThan(cutoff).catch(() => {});
    }
  }

  /** Persist snapshots to database */
  private async persistToDb(
    appSnapshots: AppMetricsSnapshot[],
    systemSnapshot: SystemMetricsSnapshot,
    statusPoints: StatusPoint[],
  ): Promise<void> {
    if (!this.metricsDb) return;
    await Promise.all([
      appSnapshots.length > 0
        ? this.metricsDb.insertAppMetrics(appSnapshots)
        : Promise.resolve(),
      this.metricsDb.insertSystemMetrics(systemSnapshot),
      statusPoints.length > 0
        ? this.metricsDb.insertStatusPoints(statusPoints)
        : Promise.resolve(),
    ]);
  }

  /** Record current status from health monitor into status history.
   *  Returns StatusPoint[] for DB persistence. */
  private recordStatusHistory(now: string): StatusPoint[] {
    const snapshots = this.healthMonitor.getAllSnapshots();
    const points: StatusPoint[] = [];
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

      points.push({ appId: snap.appId, status: snap.status, collectedAt: now });
    }
    return points;
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

/** Filter array by time period using an accessor function for the timestamp */
function filterByPeriod<T>(
  data: T[],
  period: MetricsPeriod,
  getTimestamp: (item: T) => string = (item) => (item as { collectedAt: string }).collectedAt,
): T[] {
  const cutoff = Date.now() - PERIOD_MS[period];
  return data.filter((d) => new Date(getTimestamp(d)).getTime() >= cutoff);
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
