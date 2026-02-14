import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { hash } from "argon2";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Mock the DB module so tests don't need a running Postgres.
//
// Uses a queue: each `await db.xxx()...` call pops the next result set.
// Tests push expected results via `queueRows(...)` before each request.
// ---------------------------------------------------------------------------
const rowsQueue: unknown[][] = [];

function queueRows(...batches: unknown[][]) {
  batches.forEach((b) => rowsQueue.push(b));
}

/** Creates a chainable object that mimics Drizzle's query builder */
function chain(): Record<string, any> {
  const self: Record<string, any> = {};
  const methods = [
    "select", "from", "where", "limit", "orderBy", "leftJoin",
    "insert", "values", "returning",
    "delete",
    "update", "set",
  ];
  for (const m of methods) {
    self[m] = vi.fn((..._args: unknown[]) => chain());
  }
  // Resolve with next queued result when awaited.
  // Return a real Promise so .then().catch() chains work.
  self.then = (resolve?: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(rowsQueue.shift() ?? []).then(resolve, reject);
  return self;
}

vi.mock("../db/index.js", () => {
  const clientTag = Object.assign(
    vi.fn().mockResolvedValue([{ "?column?": 1 }]),
    { end: vi.fn() },
  );
  return {
    db: chain(),
    client: clientTag,
  };
});

// ---------------------------------------------------------------------------
import { buildApp } from "../app.js";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const TEST_USER = {
  id: "00000000-0000-0000-0000-000000000001",
  username: "admin",
  email: "admin@localhost",
  passwordHash: "", // set in beforeAll
  role: "admin" as const,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

const TEST_REGULAR_USER = {
  id: "00000000-0000-0000-0000-000000000002",
  username: "user1",
  email: "user1@localhost",
  passwordHash: "", // set in beforeAll
  role: "user" as const,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

const TEST_TOKEN_ID = "00000000-0000-0000-0000-000000000099";

/** Hash a token the same way the app does */
function sha256(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
let app: FastifyInstance;

beforeAll(async () => {
  TEST_USER.passwordHash = await hash("admin");
  TEST_REGULAR_USER.passwordHash = await hash("password");
  app = await buildApp({ logger: false });
  await app.ready();
});

beforeEach(() => {
  // Clear any leftover queued rows between tests
  rowsQueue.length = 0;
});

afterAll(async () => {
  await app.close();
});

/** Extract the sessionId cookie from a response */
function getSessionCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  if (typeof raw === "string") return raw.split(";")[0];
  if (Array.isArray(raw)) return (raw[0] as string).split(";")[0];
  return "";
}

/** Login helper — returns the session cookie */
async function login(
  user: typeof TEST_USER | typeof TEST_REGULAR_USER = TEST_USER,
  password = "admin",
): Promise<string> {
  queueRows([user]);
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: user.username, password },
  });
  return getSessionCookie(res);
}

// ===========================================================================
// POST /api/auth/login
// ===========================================================================
describe("POST /api/auth/login", () => {
  it("returns 400 when body is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/required/i);
  });

  it("returns 401 for unknown user", async () => {
    queueRows([]);
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "nobody", password: "pass" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/invalid/i);
  });

  it("returns 401 for wrong password", async () => {
    queueRows([TEST_USER]);
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "wrong" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/invalid/i);
  });

  it("returns 200 and user profile on valid credentials", async () => {
    queueRows([TEST_USER]);
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "admin" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.id).toBe(TEST_USER.id);
    expect(body.user.username).toBe("admin");
    expect(body.user.role).toBe("admin");
    expect(body.user).not.toHaveProperty("passwordHash");
  });

  it("sets a session cookie on successful login", async () => {
    queueRows([TEST_USER]);
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "admin" },
    });
    expect(res.headers["set-cookie"]).toBeDefined();
    expect(String(res.headers["set-cookie"])).toContain("sessionId");
  });
});

// ===========================================================================
// GET /api/auth/me
// ===========================================================================
describe("GET /api/auth/me", () => {
  it("returns 401 without a session", async () => {
    // requireAuth will try Bearer lookup → no header → 401
    const res = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the user when authenticated via session", async () => {
    const cookie = await login();

    queueRows([{
      id: TEST_USER.id,
      username: TEST_USER.username,
      email: TEST_USER.email,
      role: TEST_USER.role,
      createdAt: TEST_USER.createdAt,
    }]);

    const res = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toBe("admin");
  });
});

// ===========================================================================
// POST /api/auth/logout
// ===========================================================================
describe("POST /api/auth/logout", () => {
  it("destroys the session so /me returns 401", async () => {
    const cookie = await login();

    const logoutRes = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie },
    });
    expect(logoutRes.statusCode).toBe(200);
    expect(logoutRes.json().ok).toBe(true);

    // /me should now be 401
    const meRes = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie },
    });
    expect(meRes.statusCode).toBe(401);
  });
});

// ===========================================================================
// POST /api/auth/tokens
// ===========================================================================
describe("POST /api/auth/tokens", () => {
  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/tokens",
      payload: { name: "test" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when name is missing", async () => {
    const cookie = await login();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/tokens",
      payload: {},
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/name/i);
  });

  it("creates a token and returns the raw value once", async () => {
    const cookie = await login();

    // Queue the insert().values().returning() result
    queueRows([{
      id: TEST_TOKEN_ID,
      name: "My Token",
      tokenHash: "hash",
      tokenPrefix: "rsp_abcd1234",
      userId: TEST_USER.id,
      expiresAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
    }]);

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/tokens",
      payload: { name: "My Token" },
      headers: { cookie },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token.name).toBe("My Token");
    expect(body.token.token).toMatch(/^rsp_/); // raw token returned
    expect(body.token.tokenPrefix).toBeDefined();
    expect(body.token.id).toBe(TEST_TOKEN_ID);
  });

  it("creates a token with expiration", async () => {
    const cookie = await login();

    queueRows([{
      id: TEST_TOKEN_ID,
      name: "Expiring Token",
      tokenHash: "hash",
      tokenPrefix: "rsp_abcd1234",
      userId: TEST_USER.id,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      lastUsedAt: null,
      createdAt: new Date(),
    }]);

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/tokens",
      payload: { name: "Expiring Token", expiresInDays: 30 },
      headers: { cookie },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().token.expiresAt).toBeDefined();
  });
});

// ===========================================================================
// GET /api/auth/tokens
// ===========================================================================
describe("GET /api/auth/tokens", () => {
  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/tokens",
    });
    expect(res.statusCode).toBe(401);
  });

  it("lists tokens for the current user", async () => {
    const cookie = await login();

    queueRows([
      {
        id: TEST_TOKEN_ID,
        name: "Token A",
        tokenPrefix: "rsp_aaaa1111",
        userId: TEST_USER.id,
        expiresAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
      },
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/api/auth/tokens",
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0].name).toBe("Token A");
    // Should NOT include the hash or raw token
    expect(body.tokens[0]).not.toHaveProperty("tokenHash");
    expect(body.tokens[0]).not.toHaveProperty("token");
  });
});

// ===========================================================================
// DELETE /api/auth/tokens/:id
// ===========================================================================
describe("DELETE /api/auth/tokens/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/auth/tokens/${TEST_TOKEN_ID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("deletes an existing token", async () => {
    const cookie = await login();

    queueRows([{ id: TEST_TOKEN_ID }]); // delete returning

    const res = await app.inject({
      method: "DELETE",
      url: `/api/auth/tokens/${TEST_TOKEN_ID}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("returns 404 for non-existent token", async () => {
    const cookie = await login();

    queueRows([]); // delete returning empty

    const res = await app.inject({
      method: "DELETE",
      url: "/api/auth/tokens/00000000-0000-0000-0000-nonexistent0",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ===========================================================================
// Bearer token authentication
// ===========================================================================
describe("Bearer token auth", () => {
  const RAW_TOKEN = "rsp_test-token-value-for-bearer-auth-testing";
  const TOKEN_HASH = sha256(RAW_TOKEN);

  it("authenticates via Authorization: Bearer header", async () => {
    queueRows(
      // 1. requireAuth: select token + join user
      [{
        tokenId: TEST_TOKEN_ID,
        userId: TEST_USER.id,
        expiresAt: null,
        role: "admin",
      }],
      // 2. requireAuth: update lastUsedAt (fire-and-forget)
      [],
      // 3. /me route: select user profile
      [{
        id: TEST_USER.id,
        username: TEST_USER.username,
        email: TEST_USER.email,
        role: TEST_USER.role,
        createdAt: TEST_USER.createdAt,
      }],
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${RAW_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toBe("admin");
  });

  it("rejects an invalid Bearer token", async () => {
    // Token lookup returns nothing
    queueRows([]);

    const res = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: "Bearer rsp_invalid-token-value" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an expired Bearer token", async () => {
    // Token lookup returns nothing (the WHERE clause filters expired tokens)
    queueRows([]);

    const res = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${RAW_TOKEN}` },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ===========================================================================
// Role-based access (Phase 1c)
// ===========================================================================
describe("Role-based access", () => {
  it("regular user can access requireAuth routes", async () => {
    const cookie = await login(TEST_REGULAR_USER, "password");

    // /me should work for any authenticated user
    queueRows([{
      id: TEST_REGULAR_USER.id,
      username: TEST_REGULAR_USER.username,
      email: TEST_REGULAR_USER.email,
      role: TEST_REGULAR_USER.role,
      createdAt: TEST_REGULAR_USER.createdAt,
    }]);

    const res = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.role).toBe("user");
  });

  it("regular user can manage their own tokens", async () => {
    const cookie = await login(TEST_REGULAR_USER, "password");

    // List tokens
    queueRows([]);
    const listRes = await app.inject({
      method: "GET",
      url: "/api/auth/tokens",
      headers: { cookie },
    });
    expect(listRes.statusCode).toBe(200);

    // Create token
    queueRows([{
      id: TEST_TOKEN_ID,
      name: "User Token",
      tokenHash: "hash",
      tokenPrefix: "rsp_usertkn1",
      userId: TEST_REGULAR_USER.id,
      expiresAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
    }]);
    const createRes = await app.inject({
      method: "POST",
      url: "/api/auth/tokens",
      payload: { name: "User Token" },
      headers: { cookie },
    });
    expect(createRes.statusCode).toBe(201);
  });

  it("app routes require authentication", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/apps",
    });
    expect(res.statusCode).toBe(401);
  });

  it("authenticated user can access app routes", async () => {
    const cookie = await login(TEST_REGULAR_USER, "password");

    const res = await app.inject({
      method: "GET",
      url: "/api/apps",
      headers: { cookie },
    });
    // Routes are now implemented — should return 200, NOT 401/403
    expect(res.statusCode).toBe(200);
  });

  it("admin can access app routes", async () => {
    const cookie = await login();

    const res = await app.inject({
      method: "GET",
      url: "/api/apps",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
  });
});
