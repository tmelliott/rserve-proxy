import type { FastifyPluginAsync } from "fastify";
import { hash, verify } from "argon2";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { users, apiTokens } from "../db/schema.js";
import { requireAuth, hashToken } from "../hooks/require-auth.js";

export const authRoutes: FastifyPluginAsync = async (app) => {
  // -----------------------------------------------------------------------
  // Session auth
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // Password change
  // -----------------------------------------------------------------------

  /**
   * PUT /api/auth/password
   *
   * Change the current user's password. Requires the current password for
   * verification plus the new password.
   */
  app.put<{
    Body: { currentPassword: string; newPassword: string };
  }>("/password", { onRequest: requireAuth }, async (request, reply) => {
    const { currentPassword, newPassword } = request.body ?? {};

    if (!currentPassword || !newPassword) {
      return reply
        .status(400)
        .send({ error: "Current password and new password are required" });
    }

    if (newPassword.length < 8) {
      return reply
        .status(400)
        .send({ error: "New password must be at least 8 characters" });
    }

    // Look up user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, request.session.userId!))
      .limit(1);

    if (!user) {
      return reply.status(401).send({ error: "User not found" });
    }

    // Verify current password
    const valid = await verify(user.passwordHash, currentPassword);
    if (!valid) {
      return reply.status(403).send({ error: "Current password is incorrect" });
    }

    // Hash and save new password
    const newHash = await hash(newPassword);
    await db
      .update(users)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    return reply.send({ ok: true });
  });

  // -----------------------------------------------------------------------
  // API Token auth
  // -----------------------------------------------------------------------

  /**
   * POST /api/auth/tokens
   *
   * Create a new API token. The raw token is returned ONCE in the response.
   * Accepts { name, expiresInDays? }.
   */
  app.post<{
    Body: { name: string; expiresInDays?: number };
  }>("/tokens", { onRequest: requireAuth }, async (request, reply) => {
    const { name, expiresInDays } = request.body ?? {};

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return reply.status(400).send({ error: "Token name is required" });
    }

    // Generate a random token: rsp_ prefix + 40 chars of nanoid
    const rawToken = `rsp_${nanoid(40)}`;
    const tokenHash = hashToken(rawToken);
    const tokenPrefix = rawToken.slice(0, 12); // "rsp_" + first 8 random chars

    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const [token] = await db
      .insert(apiTokens)
      .values({
        name: name.trim(),
        tokenHash,
        tokenPrefix,
        userId: request.session.userId!,
        expiresAt,
      })
      .returning();

    return reply.status(201).send({
      token: {
        id: token.id,
        name: token.name,
        token: rawToken, // Only returned on creation
        tokenPrefix: token.tokenPrefix,
        userId: token.userId,
        expiresAt: token.expiresAt,
        lastUsedAt: token.lastUsedAt,
        createdAt: token.createdAt,
      },
    });
  });

  /**
   * GET /api/auth/tokens
   *
   * List all API tokens for the current user.
   * Returns prefix only — never the raw token or hash.
   */
  app.get("/tokens", { onRequest: requireAuth }, async (request, reply) => {
    const tokens = await db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        tokenPrefix: apiTokens.tokenPrefix,
        userId: apiTokens.userId,
        expiresAt: apiTokens.expiresAt,
        lastUsedAt: apiTokens.lastUsedAt,
        createdAt: apiTokens.createdAt,
      })
      .from(apiTokens)
      .where(eq(apiTokens.userId, request.session.userId!))
      .orderBy(apiTokens.createdAt);

    return reply.send({ tokens });
  });

  /**
   * DELETE /api/auth/tokens/:id
   *
   * Revoke (delete) an API token. Users can only revoke their own tokens.
   */
  app.delete<{
    Params: { id: string };
  }>("/tokens/:id", { onRequest: requireAuth }, async (request, reply) => {
    const { id } = request.params;

    const deleted = await db
      .delete(apiTokens)
      .where(
        and(
          eq(apiTokens.id, id),
          eq(apiTokens.userId, request.session.userId!),
        ),
      )
      .returning({ id: apiTokens.id });

    if (deleted.length === 0) {
      return reply.status(404).send({ error: "Token not found" });
    }

    return reply.send({ ok: true });
  });
};
