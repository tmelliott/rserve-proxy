/**
 * Metrics API routes — resource usage and status history.
 *
 * All routes require authentication.
 */

import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { requireAuth } from "../hooks/require-auth.js";
import { db } from "../db/index.js";
import { apps } from "../db/schema.js";
import { MetricsQuery, AppIdParams } from "./metrics.schemas.js";
import type { MetricsPeriod } from "@rserve-proxy/shared";

/** Bucket size in minutes for each aggregated period */
const BUCKET_MINUTES: Partial<Record<MetricsPeriod, number>> = {
  "6h": 5,
  "24h": 15,
  "7d": 60,
};

/**
 * Admins can access any app; regular users can only access their own.
 */
function canAccess(
  session: { userId?: string; role?: string },
  appOwnerId: string,
): boolean {
  if (session.role === "admin") return true;
  return session.userId === appOwnerId;
}

export const metricsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", requireAuth);

  // -------------------------------------------------------------------------
  // GET /api/metrics/system?period=1h
  // -------------------------------------------------------------------------
  app.get<{ Querystring: MetricsQuery }>(
    "/system",
    { schema: { querystring: MetricsQuery } },
    async (request, reply) => {
      const period = (request.query.period ?? "1h") as MetricsPeriod;

      // 1h: raw data points from memory; 6h/24h/7d: aggregated from DB
      if (period === "1h") {
        const dataPoints = app.metricsCollector.getSystemMetrics(period);
        return reply.send({ period, dataPoints });
      }

      const bucketMinutes = BUCKET_MINUTES[period]!;
      const aggregated = await app.metricsCollector.getSystemMetricsAggregated(period, bucketMinutes);
      return reply.send({ period, dataPoints: [], aggregated });
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/metrics/apps/:id?period=1h
  // -------------------------------------------------------------------------
  app.get<{ Params: AppIdParams; Querystring: MetricsQuery }>(
    "/apps/:id",
    { schema: { params: AppIdParams, querystring: MetricsQuery } },
    async (request, reply) => {
      const { id } = request.params;
      const period = (request.query.period ?? "1h") as MetricsPeriod;

      // Verify app exists and user has access
      const [row] = await db.select().from(apps).where(eq(apps.id, id));
      if (!row) {
        return reply.status(404).send({ error: "App not found" });
      }
      if (!canAccess(request.session, row.ownerId)) {
        return reply.status(403).send({ error: "Access denied" });
      }

      // 1h: raw data points from memory; 6h/24h/7d: aggregated from DB
      if (period === "1h") {
        const dataPoints = app.metricsCollector.getAppMetrics(id, period);
        return reply.send({ period, dataPoints });
      }

      const bucketMinutes = BUCKET_MINUTES[period]!;
      const aggregated = await app.metricsCollector.getAppMetricsAggregated(id, period, bucketMinutes);
      return reply.send({ period, dataPoints: [], aggregated });
    },
  );
};

// ---------------------------------------------------------------------------
// Status history routes — registered separately under /api/status
// ---------------------------------------------------------------------------

export const statusRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", requireAuth);

  // -------------------------------------------------------------------------
  // GET /api/status/history?period=1h
  // -------------------------------------------------------------------------
  app.get<{ Querystring: MetricsQuery }>(
    "/history",
    { schema: { querystring: MetricsQuery } },
    async (request, reply) => {
      const period = (request.query.period ?? "1h") as MetricsPeriod;

      // 1h: in-memory (hydrated from DB on startup); longer periods: from DB
      const appsList = period === "1h"
        ? app.metricsCollector.getStatusHistory(period)
        : await app.metricsCollector.getStatusHistoryFromDb(period);

      // Resolve app names from DB for any that are still showing as IDs
      const appIds = appsList
        .filter((a) => a.appName === a.appId)
        .map((a) => a.appId);
      if (appIds.length > 0) {
        const rows = await db.select({ id: apps.id, name: apps.name }).from(apps);
        const nameMap = new Map(rows.map((r) => [r.id, r.name]));
        for (const entry of appsList) {
          const dbName = nameMap.get(entry.appId);
          if (dbName) {
            entry.appName = dbName;
            app.metricsCollector.setAppName(entry.appId, dbName);
          }
        }
      }

      return reply.send({ period, apps: appsList });
    },
  );
};

// ---------------------------------------------------------------------------
// Per-app status history — registered under /api/apps/:id/status
// (added to the existing apps route plugin via separate registration)
// ---------------------------------------------------------------------------

export const appStatusHistoryRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", requireAuth);

  // -------------------------------------------------------------------------
  // GET /api/apps/:id/status/history?period=1h
  // -------------------------------------------------------------------------
  app.get<{ Params: AppIdParams; Querystring: MetricsQuery }>(
    "/:id/status/history",
    { schema: { params: AppIdParams, querystring: MetricsQuery } },
    async (request, reply) => {
      const { id } = request.params;
      const period = (request.query.period ?? "1h") as MetricsPeriod;

      // Verify app exists and user has access
      const [row] = await db.select().from(apps).where(eq(apps.id, id));
      if (!row) {
        return reply.status(404).send({ error: "App not found" });
      }
      if (!canAccess(request.session, row.ownerId)) {
        return reply.status(403).send({ error: "Access denied" });
      }

      // 1h: in-memory; longer periods: from DB
      const entries = period === "1h"
        ? app.metricsCollector.getAppStatusHistory(id, period)
        : await app.metricsCollector.getAppStatusHistoryFromDb(id, period);
      return reply.send({
        period,
        appId: id,
        appName: row.name,
        entries,
      });
    },
  );
};
