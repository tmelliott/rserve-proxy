/**
 * Health Monitor — periodically polls Docker for container health status.
 *
 * Maintains an in-memory cache of per-app health info so the API can serve
 * status requests without hitting Docker on every call.
 *
 * IMPORTANT: This module must remain independent of the web framework,
 * auth system, and proxy layer (spawner isolation principle).
 */

import type { DockerSpawner } from "./docker-spawner.js";
import type { AppStatus, ContainerInfo } from "@rserve-proxy/shared";

/** Snapshot of an app's health at a point in time */
export interface AppHealthSnapshot {
  appId: string;
  status: AppStatus;
  containers: ContainerInfo[];
  checkedAt: Date;
}

export interface HealthMonitorOptions {
  /** Polling interval in milliseconds (default: 15000 = 15s) */
  intervalMs?: number;
  /** Called whenever an app's status changes */
  onStatusChange?: (appId: string, prev: AppStatus, next: AppStatus) => void;
}

const DEFAULT_INTERVAL_MS = 15_000;

export class HealthMonitor {
  private spawner: DockerSpawner;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onStatusChange?: HealthMonitorOptions["onStatusChange"];

  /** Cached health snapshots keyed by appId */
  private snapshots = new Map<string, AppHealthSnapshot>();

  /** Set of app IDs we're actively tracking */
  private trackedApps = new Set<string>();

  constructor(spawner: DockerSpawner, options?: HealthMonitorOptions) {
    this.spawner = spawner;
    this.intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.onStatusChange = options?.onStatusChange;
  }

  /** Start the health check loop */
  start(): void {
    if (this.timer) return; // already running
    this.timer = setInterval(() => this.poll(), this.intervalMs);
    // Run an initial poll immediately
    this.poll();
  }

  /** Stop the health check loop */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Register an app for health tracking */
  track(appId: string): void {
    this.trackedApps.add(appId);
  }

  /** Stop tracking an app and remove its snapshot */
  untrack(appId: string): void {
    this.trackedApps.delete(appId);
    this.snapshots.delete(appId);
  }

  /** Get the cached health snapshot for an app (may be stale by up to intervalMs) */
  getSnapshot(appId: string): AppHealthSnapshot | undefined {
    return this.snapshots.get(appId);
  }

  /** Get all cached snapshots */
  getAllSnapshots(): AppHealthSnapshot[] {
    return Array.from(this.snapshots.values());
  }

  /** Whether the monitor is currently running */
  get isRunning(): boolean {
    return this.timer !== null;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /** Poll Docker for all tracked apps and update snapshots */
  private async poll(): Promise<void> {
    // Also discover any containers managed by us that we're not tracking
    // (e.g. containers started before the monitor was created)
    try {
      const containers = await this.spawner.listManagedContainers();
      const discoveredAppIds = new Set<string>();

      for (const c of containers) {
        const appId = c.Labels?.["rserve-proxy.app-id"];
        if (appId) discoveredAppIds.add(appId);
      }

      // Merge discovered apps into tracked set
      for (const appId of discoveredAppIds) {
        this.trackedApps.add(appId);
      }
    } catch {
      // Docker may be temporarily unreachable — continue with what we have
    }

    // Check each tracked app
    for (const appId of this.trackedApps) {
      try {
        const [status, containerInfos] = await Promise.all([
          this.spawner.getAppStatus(appId),
          this.spawner.getContainers(appId),
        ]);

        const prev = this.snapshots.get(appId);
        const snapshot: AppHealthSnapshot = {
          appId,
          status,
          containers: containerInfos,
          checkedAt: new Date(),
        };
        this.snapshots.set(appId, snapshot);

        // Notify on status change
        if (prev && prev.status !== status && this.onStatusChange) {
          this.onStatusChange(appId, prev.status, status);
        }
      } catch {
        // If we can't check an app, mark it as error
        const prev = this.snapshots.get(appId);
        const snapshot: AppHealthSnapshot = {
          appId,
          status: "error",
          containers: [],
          checkedAt: new Date(),
        };
        this.snapshots.set(appId, snapshot);

        if (prev && prev.status !== "error" && this.onStatusChange) {
          this.onStatusChange(appId, prev.status, "error");
        }
      }
    }
  }
}
