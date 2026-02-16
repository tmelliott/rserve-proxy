/**
 * Types for the observability / metrics system (Phase 7).
 *
 * These describe the shapes returned by the metrics API endpoints
 * and stored in-memory by the MetricsCollector.
 */

import type { AppStatus } from "./app.js";

// ---------------------------------------------------------------------------
// Resource snapshots
// ---------------------------------------------------------------------------

/** Resource usage for a single collection interval */
export interface ResourceSnapshot {
  /** CPU usage 0–100 (sum across containers) */
  cpuPercent: number;
  /** Memory RSS in MB (sum across containers) */
  memoryMB: number;
  /** Memory limit in MB (sum across containers) */
  memoryLimitMB: number;
  /** Network bytes received since last collection */
  networkRxBytes: number;
  /** Network bytes sent since last collection */
  networkTxBytes: number;
  /** Requests per minute (null until Traefik metrics wired in Phase 7d) */
  requestsPerMin: number | null;
  /** ISO 8601 timestamp */
  collectedAt: string;
}

/** Per-app resource snapshot */
export interface AppMetricsSnapshot extends ResourceSnapshot {
  appId: string;
  /** Number of running containers */
  containers: number;
}

/** System-wide resource snapshot */
export interface SystemMetricsSnapshot extends ResourceSnapshot {
  /** Total running containers across all apps */
  activeContainers: number;
  /** Number of apps with at least one running container */
  activeApps: number;
}

// ---------------------------------------------------------------------------
// Status history
// ---------------------------------------------------------------------------

/** A single status observation */
export interface StatusHistoryEntry {
  status: AppStatus;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/** Status timeline for one app */
export interface AppStatusHistory {
  appId: string;
  appName: string;
  entries: StatusHistoryEntry[];
}

// ---------------------------------------------------------------------------
// API response envelopes
// ---------------------------------------------------------------------------

export type MetricsPeriod = "1h" | "6h" | "24h" | "7d";

export interface SystemMetricsResponse {
  period: MetricsPeriod;
  dataPoints: SystemMetricsSnapshot[];
}

export interface AppMetricsResponse {
  period: MetricsPeriod;
  dataPoints: AppMetricsSnapshot[];
}

export interface StatusHistoryResponse {
  period: MetricsPeriod;
  apps: AppStatusHistory[];
}

export interface AppStatusHistoryResponse {
  period: MetricsPeriod;
  appId: string;
  appName: string;
  entries: StatusHistoryEntry[];
}
