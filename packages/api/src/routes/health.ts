import type { FastifyPluginAsync } from "fastify";
import { client } from "../db/index.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (_request, reply) => {
    let dbOk = false;

    try {
      await client`SELECT 1`;
      dbOk = true;
    } catch {
      // db unreachable
    }

    const payload = {
      status: dbOk ? "ok" : "degraded",
      db: dbOk,
      timestamp: new Date().toISOString(),
    };

    return reply.status(dbOk ? 200 : 503).send(payload);
  });
};
