import type { FastifyRequest, FastifyReply } from "fastify";
import { createHash } from "node:crypto";
import { eq, and, gt, isNull, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { apiTokens, users } from "../db/schema.js";

/**
 * Hash a raw API token with SHA-256 for DB lookup.
 * (Same algorithm used at creation time.)
 */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Try to authenticate via Bearer token.
 * Returns the user ID and role if valid, or null.
 */
async function authenticateBearer(
  request: FastifyRequest,
): Promise<{ userId: string; role: "admin" | "user" } | null> {
  const auth = request.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;

  const raw = auth.slice(7);
  if (!raw) return null;

  const tokenHash = hashToken(raw);

  // Look up token + join user to get role
  const [result] = await db
    .select({
      tokenId: apiTokens.id,
      userId: apiTokens.userId,
      expiresAt: apiTokens.expiresAt,
      role: users.role,
    })
    .from(apiTokens)
    .leftJoin(users, eq(apiTokens.userId, users.id))
    .where(
      and(
        eq(apiTokens.tokenHash, tokenHash),
        // Token must not be expired (null expiresAt = never expires)
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, new Date())),
      ),
    )
    .limit(1);

  if (!result || !result.role) return null;

  // Update lastUsedAt (fire-and-forget — don't block the request)
  db.update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, result.tokenId))
    .then(() => {})
    .catch(() => {});

  return { userId: result.userId, role: result.role };
}

/**
 * Fastify onRequest hook that rejects unauthenticated requests.
 * Checks session cookies first, then falls back to Bearer token.
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
  // 1. Session auth (already set by @fastify/session)
  if (request.session.userId) return;

  // 2. Bearer token auth
  const tokenAuth = await authenticateBearer(request);
  if (tokenAuth) {
    // Populate session fields so downstream code can use them uniformly
    request.session.userId = tokenAuth.userId;
    request.session.role = tokenAuth.role;
    return;
  }

  reply.status(401).send({ error: "Authentication required" });
}

/**
 * Fastify onRequest hook that requires the user to have the "admin" role.
 * Must be used after requireAuth (session must already be validated).
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Run requireAuth first
  await requireAuth(request, reply);
  if (reply.sent) return;

  if (request.session.role !== "admin") {
    await reply.status(403).send({ error: "Admin access required" });
  }
}
