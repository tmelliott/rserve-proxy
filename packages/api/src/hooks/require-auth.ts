import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Fastify onRequest hook that rejects unauthenticated requests.
 * Attach to any route or plugin that requires a logged-in user.
 *
 * Usage:
 *   app.addHook("onRequest", requireAuth);
 *   // or per-route:
 *   app.get("/secret", { onRequest: requireAuth }, handler);
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.session.userId) {
    return reply.status(401).send({ error: "Authentication required" });
  }
}

/**
 * Fastify onRequest hook that requires the user to have the "admin" role.
 * Must be used after requireAuth (session must already be validated).
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.session.userId) {
    return reply.status(401).send({ error: "Authentication required" });
  }
  if (request.session.role !== "admin") {
    return reply.status(403).send({ error: "Admin access required" });
  }
}
