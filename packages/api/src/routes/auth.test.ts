import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { hash } from "argon2";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Mock the DB module so tests don't need a running Postgres.
//
// vi.mock is hoisted above all imports, so this runs before buildApp loads
// the auth routes. We expose `mockRows` so each test can control what the
// next DB query returns.
// ---------------------------------------------------------------------------
let mockRows: unknown[] = [];

/** Creates a chainable object that mimics Drizzle's query builder */
function chain(): Record<string, any> {
  const self: Record<string, any> = {};
  // Every method returns the chain, except awaiting it resolves mockRows
  for (const m of ["select", "from", "where", "limit", "orderBy", "leftJoin"]) {
    self[m] = vi.fn((..._args: unknown[]) => chain());
  }
  // Make the chain thenable so `await db.select().from()...` works
  self.then = (resolve: (v: unknown) => void, _reject?: unknown) =>
    resolve(mockRows);
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
// Now import buildApp (which imports the mocked db module)
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

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
let app: FastifyInstance;

beforeAll(async () => {
  TEST_USER.passwordHash = await hash("admin");
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

/** Helper: extract the sessionId cookie from a response */
function getSessionCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  if (typeof raw === "string") return raw.split(";")[0];
  if (Array.isArray(raw)) return (raw[0] as string).split(";")[0];
  return "";
}

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
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
    mockRows = []; // no user found

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "nobody", password: "pass" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/invalid/i);
  });

  it("returns 401 for wrong password", async () => {
    mockRows = [TEST_USER];

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "wrong" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/invalid/i);
  });

  it("returns 200 and user profile on valid credentials", async () => {
    mockRows = [TEST_USER];

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
    mockRows = [TEST_USER];

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "admin" },
    });
    expect(res.headers["set-cookie"]).toBeDefined();
    expect(String(res.headers["set-cookie"])).toContain("sessionId");
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
describe("GET /api/auth/me", () => {
  it("returns 401 without a session", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/me",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns the user when authenticated", async () => {
    // Step 1: login to get a session cookie
    mockRows = [TEST_USER];
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "admin" },
    });
    const cookie = getSessionCookie(loginRes);

    // Step 2: set mockRows for the /me query (different shape — no passwordHash)
    mockRows = [
      {
        id: TEST_USER.id,
        username: TEST_USER.username,
        email: TEST_USER.email,
        role: TEST_USER.role,
        createdAt: TEST_USER.createdAt,
      },
    ];

    const res = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toBe("admin");
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------
describe("POST /api/auth/logout", () => {
  it("destroys the session so /me returns 401", async () => {
    // Login
    mockRows = [TEST_USER];
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "admin" },
    });
    const cookie = getSessionCookie(loginRes);

    // Logout
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
