import type { FastifyPluginAsync } from "fastify";
import { verify } from "argon2";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { requireAuth } from "../hooks/require-auth.js";

export const authRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /api/auth/login
   *
   * Accepts { username, password }, verifies credentials against the DB,
   * and creates a session. Returns the user profile on success.
   */
  app.post<{
    Body: { username: string; password: string };
  }>("/login", async (request, reply) => {
    const { username, password } = request.body ?? {};

    if (!username || !password) {
      return reply
        .status(400)
        .send({ error: "Username and password are required" });
    }

    // Look up user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (!user) {
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    // Verify password
    const valid = await verify(user.passwordHash, password);
    if (!valid) {
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    // Store user info in session
    request.session.userId = user.id;
    request.session.role = user.role;

    return reply.send({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  });

  /**
   * POST /api/auth/logout
   *
   * Destroys the current session and clears the session cookie.
   */
  app.post("/logout", async (request, reply) => {
    await request.session.destroy();
    return reply.send({ ok: true });
  });

  /**
   * GET /api/auth/me
   *
   * Returns the currently authenticated user's profile.
   * Requires a valid session (attached via requireAuth hook).
   */
  app.get("/me", { onRequest: requireAuth }, async (request, reply) => {
    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, request.session.userId!))
      .limit(1);

    if (!user) {
      // Session refers to a deleted user — clean up
      await request.session.destroy();
      return reply.status(401).send({ error: "User not found" });
    }

    return reply.send({ user });
  });

  // --- Token routes (Phase 1b stubs) ---

  app.post("/tokens", async (request, reply) => {
    // TODO: Create API token (Phase 1b)
    return reply.status(501).send({ error: "Not implemented" });
  });

  app.get("/tokens", async (request, reply) => {
    // TODO: List API tokens for current user (Phase 1b)
    return reply.status(501).send({ error: "Not implemented" });
  });

  app.delete("/tokens/:id", async (request, reply) => {
    // TODO: Revoke API token (Phase 1b)
    return reply.status(501).send({ error: "Not implemented" });
  });
};
