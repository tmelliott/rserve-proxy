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

      if (period === "1h") {
        const dataPoints = app.metricsCollector.getSystemMetrics(period);
        return reply.send({ period, dataPoints });
      }

      if (period === "7d") {
        const aggregated = await app.metricsCollector.getSystemMetricsAggregated(period);
        return reply.send({ period, dataPoints: [], aggregated });
      }

      // 6h, 24h — raw rows from DB
      const dataPoints = await app.metricsCollector.getSystemMetricsFromDb(period);
      return reply.send({ period, dataPoints });
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

      // Verify app exists
      const [row] = await db.select().from(apps).where(eq(apps.id, id));
      if (!row) {
        return reply.status(404).send({ error: "App not found" });
      }

      if (period === "1h") {
        const dataPoints = app.metricsCollector.getAppMetrics(id, period);
        return reply.send({ period, dataPoints });
      }

      if (period === "7d") {
        const aggregated = await app.metricsCollector.getAppMetricsAggregated(id, period);
        return reply.send({ period, dataPoints: [], aggregated });
      }

      // 6h, 24h — raw rows from DB
      const dataPoints = await app.metricsCollector.getAppMetricsFromDb(id, period);
      return reply.send({ period, dataPoints });
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
      const appsList = app.metricsCollector.getStatusHistory(period);

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

      // Verify app exists
      const [row] = await db.select().from(apps).where(eq(apps.id, id));
      if (!row) {
        return reply.status(404).send({ error: "App not found" });
      }

      const entries = app.metricsCollector.getAppStatusHistory(id, period);
      return reply.send({
        period,
        appId: id,
        appName: row.name,
        entries,
      });
    },
  );
};
