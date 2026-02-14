import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../hooks/require-auth.js";

export const appRoutes: FastifyPluginAsync = async (app) => {
  // All app routes require authentication
  app.addHook("onRequest", requireAuth);

  app.get("/", async (request, reply) => {
    // TODO: List all apps with status
    // Admin sees all; user sees only own apps (Phase 3)
    return reply.status(501).send({ error: "Not implemented" });
  });

  app.post("/", async (request, reply) => {
    // TODO: Create a new app (config only, doesn't start it)
    return reply.status(501).send({ error: "Not implemented" });
  });

  app.get("/:id", async (request, reply) => {
    // TODO: Get app details with status
    // Users can only access their own apps (Phase 3)
    return reply.status(501).send({ error: "Not implemented" });
  });

  app.put("/:id", async (request, reply) => {
    // TODO: Update app config
    // Users can only update their own apps (Phase 3)
    return reply.status(501).send({ error: "Not implemented" });
  });

  app.delete("/:id", async (request, reply) => {
    // TODO: Delete app (stops containers, removes config)
    // Users can only delete their own apps (Phase 3)
    return reply.status(501).send({ error: "Not implemented" });
  });

  app.post("/:id/start", async (request, reply) => {
    // TODO: Build image (if needed) and start containers
    return reply.status(501).send({ error: "Not implemented" });
  });

  app.post("/:id/stop", async (request, reply) => {
    // TODO: Stop all containers for this app
    return reply.status(501).send({ error: "Not implemented" });
  });

  app.post("/:id/restart", async (request, reply) => {
    // TODO: Restart all containers for this app
    return reply.status(501).send({ error: "Not implemented" });
  });

  app.get("/:id/logs", async (request, reply) => {
    // TODO: Stream build/runtime logs
    return reply.status(501).send({ error: "Not implemented" });
  });
};
