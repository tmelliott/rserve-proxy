/**
 * Drizzle-based implementation of MetricsDb.
 *
 * Handles insert, query, aggregation, and pruning of metrics data
 * stored in the `app_metrics_points` and `system_metrics_points` tables.
 */

import { sql, lt, gte, and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../db/schema.js";
import { appMetricsPoints, systemMetricsPoints } from "../db/schema.js";
import type { MetricsDb } from "./metrics-collector.js";
import type {
  AppMetricsSnapshot,
  SystemMetricsSnapshot,
  AggregatedSnapshot,
} from "@rserve-proxy/shared";

type Db = PostgresJsDatabase<typeof schema>;

export class DrizzleMetricsDb implements MetricsDb {
  constructor(private db: Db) {}

  async insertAppMetrics(snapshots: AppMetricsSnapshot[]): Promise<void> {
    if (snapshots.length === 0) return;
    await this.db.insert(appMetricsPoints).values(
      snapshots.map((s) => ({
        appId: s.appId,
        cpuPercent: s.cpuPercent,
        memoryMB: s.memoryMB,
        memoryLimitMB: s.memoryLimitMB,
        networkRxBytes: s.networkRxBytes,
        networkTxBytes: s.networkTxBytes,
        requestsPerMin: s.requestsPerMin,
        containers: s.containers,
        collectedAt: new Date(s.collectedAt),
      })),
    );
  }

  async insertSystemMetrics(snapshot: SystemMetricsSnapshot): Promise<void> {
    await this.db.insert(systemMetricsPoints).values({
      cpuPercent: snapshot.cpuPercent,
      memoryMB: snapshot.memoryMB,
      memoryLimitMB: snapshot.memoryLimitMB,
      networkRxBytes: snapshot.networkRxBytes,
      networkTxBytes: snapshot.networkTxBytes,
      requestsPerMin: snapshot.requestsPerMin,
      activeContainers: snapshot.activeContainers,
      activeApps: snapshot.activeApps,
      collectedAt: new Date(snapshot.collectedAt),
    });
  }

  async queryAppMetrics(appId: string, since: Date): Promise<AppMetricsSnapshot[]> {
    const rows = await this.db
      .select()
      .from(appMetricsPoints)
      .where(and(eq(appMetricsPoints.appId, appId), gte(appMetricsPoints.collectedAt, since)))
      .orderBy(appMetricsPoints.collectedAt);

    return rows.map((r) => ({
      appId: r.appId,
      cpuPercent: r.cpuPercent,
      memoryMB: r.memoryMB,
      memoryLimitMB: r.memoryLimitMB,
      networkRxBytes: r.networkRxBytes,
      networkTxBytes: r.networkTxBytes,
      requestsPerMin: r.requestsPerMin,
      containers: r.containers,
      collectedAt: r.collectedAt.toISOString(),
    }));
  }

  async querySystemMetrics(since: Date): Promise<SystemMetricsSnapshot[]> {
    const rows = await this.db
      .select()
      .from(systemMetricsPoints)
      .where(gte(systemMetricsPoints.collectedAt, since))
      .orderBy(systemMetricsPoints.collectedAt);

    return rows.map((r) => ({
      cpuPercent: r.cpuPercent,
      memoryMB: r.memoryMB,
      memoryLimitMB: r.memoryLimitMB,
      networkRxBytes: r.networkRxBytes,
      networkTxBytes: r.networkTxBytes,
      requestsPerMin: r.requestsPerMin,
      activeContainers: r.activeContainers,
      activeApps: r.activeApps,
      collectedAt: r.collectedAt.toISOString(),
    }));
  }

  async queryAppMetricsAggregated(
    appId: string,
    since: Date,
    bucketMinutes: number,
  ): Promise<AggregatedSnapshot[]> {
    const rows = await this.db.execute(sql`
      SELECT
        date_trunc('hour', ${appMetricsPoints.collectedAt}) +
          (EXTRACT(minute FROM ${appMetricsPoints.collectedAt})::int / ${bucketMinutes} * ${bucketMinutes} * interval '1 minute') AS bucket,
        AVG(${appMetricsPoints.cpuPercent}) AS cpu_avg,
        MIN(${appMetricsPoints.cpuPercent}) AS cpu_min,
        MAX(${appMetricsPoints.cpuPercent}) AS cpu_max,
        AVG(${appMetricsPoints.memoryMB}) AS mem_avg,
        MIN(${appMetricsPoints.memoryMB}) AS mem_min,
        MAX(${appMetricsPoints.memoryMB}) AS mem_max,
        AVG(${appMetricsPoints.networkRxBytes}::real) AS rx_avg,
        MIN(${appMetricsPoints.networkRxBytes}) AS rx_min,
        MAX(${appMetricsPoints.networkRxBytes}) AS rx_max,
        AVG(${appMetricsPoints.networkTxBytes}::real) AS tx_avg,
        MIN(${appMetricsPoints.networkTxBytes}) AS tx_min,
        MAX(${appMetricsPoints.networkTxBytes}) AS tx_max,
        AVG(${appMetricsPoints.requestsPerMin}) AS req_avg,
        MIN(${appMetricsPoints.requestsPerMin}) AS req_min,
        MAX(${appMetricsPoints.requestsPerMin}) AS req_max
      FROM ${appMetricsPoints}
      WHERE ${appMetricsPoints.appId} = ${appId}
        AND ${appMetricsPoints.collectedAt} >= ${since}
      GROUP BY bucket
      ORDER BY bucket
    `);

    return rows.map(mapAggregatedRow);
  }

  async querySystemMetricsAggregated(
    since: Date,
    bucketMinutes: number,
  ): Promise<AggregatedSnapshot[]> {
    const rows = await this.db.execute(sql`
      SELECT
        date_trunc('hour', ${systemMetricsPoints.collectedAt}) +
          (EXTRACT(minute FROM ${systemMetricsPoints.collectedAt})::int / ${bucketMinutes} * ${bucketMinutes} * interval '1 minute') AS bucket,
        AVG(${systemMetricsPoints.cpuPercent}) AS cpu_avg,
        MIN(${systemMetricsPoints.cpuPercent}) AS cpu_min,
        MAX(${systemMetricsPoints.cpuPercent}) AS cpu_max,
        AVG(${systemMetricsPoints.memoryMB}) AS mem_avg,
        MIN(${systemMetricsPoints.memoryMB}) AS mem_min,
        MAX(${systemMetricsPoints.memoryMB}) AS mem_max,
        AVG(${systemMetricsPoints.networkRxBytes}::real) AS rx_avg,
        MIN(${systemMetricsPoints.networkRxBytes}) AS rx_min,
        MAX(${systemMetricsPoints.networkRxBytes}) AS rx_max,
        AVG(${systemMetricsPoints.networkTxBytes}::real) AS tx_avg,
        MIN(${systemMetricsPoints.networkTxBytes}) AS tx_min,
        MAX(${systemMetricsPoints.networkTxBytes}) AS tx_max,
        AVG(${systemMetricsPoints.requestsPerMin}) AS req_avg,
        MIN(${systemMetricsPoints.requestsPerMin}) AS req_min,
        MAX(${systemMetricsPoints.requestsPerMin}) AS req_max
      FROM ${systemMetricsPoints}
      WHERE ${systemMetricsPoints.collectedAt} >= ${since}
      GROUP BY bucket
      ORDER BY bucket
    `);

    return rows.map(mapAggregatedRow);
  }

  async pruneOlderThan(date: Date): Promise<void> {
    await Promise.all([
      this.db.delete(appMetricsPoints).where(lt(appMetricsPoints.collectedAt, date)),
      this.db.delete(systemMetricsPoints).where(lt(systemMetricsPoints.collectedAt, date)),
    ]);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapAggregatedRow(row: Record<string, unknown>): AggregatedSnapshot {
  return {
    cpuPercent: {
      avg: Number(row.cpu_avg) || 0,
      min: Number(row.cpu_min) || 0,
      max: Number(row.cpu_max) || 0,
    },
    memoryMB: {
      avg: Number(row.mem_avg) || 0,
      min: Number(row.mem_min) || 0,
      max: Number(row.mem_max) || 0,
    },
    networkRxBytes: {
      avg: Number(row.rx_avg) || 0,
      min: Number(row.rx_min) || 0,
      max: Number(row.rx_max) || 0,
    },
    networkTxBytes: {
      avg: Number(row.tx_avg) || 0,
      min: Number(row.tx_min) || 0,
      max: Number(row.tx_max) || 0,
    },
    requestsPerMin:
      row.req_avg != null
        ? {
            avg: Number(row.req_avg),
            min: Number(row.req_min),
            max: Number(row.req_max),
          }
        : null,
    collectedAt: row.bucket instanceof Date
      ? row.bucket.toISOString()
      : String(row.bucket),
  };
}
