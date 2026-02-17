import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
} from "vitest";
import { hash } from "argon2";
import type { FastifyInstance } from "fastify";
import type { DockerSpawner } from "../spawner/docker-spawner.js";
import type { HealthMonitor } from "../spawner/health-monitor.js";
import type { MetricsCollector } from "../metrics/metrics-collector.js";
import type { AppStatus, ContainerInfo, BuildResult } from "@rserve-proxy/shared";

// ---------------------------------------------------------------------------
// Mock the DB module
// ---------------------------------------------------------------------------
const rowsQueue: unknown[][] = [];

function queueRows(...batches: unknown[][]) {
  batches.forEach((b) => rowsQueue.push(b));
}

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
// Mock services
// ---------------------------------------------------------------------------

function createMockSpawner(): DockerSpawner {
  return {
    buildImage: vi.fn().mockResolvedValue({
      success: true, imageName: "test", imageTag: "abc", buildLog: [],
    } as BuildResult),
    startApp: vi.fn().mockResolvedValue(undefined),
    stopApp: vi.fn().mockResolvedValue(undefined),
    restartApp: vi.fn().mockResolvedValue(undefined),
    getAppStatus: vi.fn().mockResolvedValue("stopped" as AppStatus),
    getContainers: vi.fn().mockResolvedValue([] as ContainerInfo[]),
    streamBuildLogs: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn().mockResolvedValue(undefined),
    listManagedContainers: vi.fn().mockResolvedValue([]),
    getDocker: vi.fn().mockReturnValue({}),
  } as unknown as DockerSpawner;
}

function createMockHealthMonitor(): HealthMonitor {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    track: vi.fn(),
    untrack: vi.fn(),
    getSnapshot: vi.fn().mockReturnValue(undefined),
    getAllSnapshots: vi.fn().mockReturnValue([]),
    isRunning: false,
  } as unknown as HealthMonitor;
}

function createMockMetricsCollector(): MetricsCollector {
  const sysSnapshot = {
    cpuPercent: 25.5,
    memoryMB: 256,
    memoryLimitMB: 1024,
    networkRxBytes: 10000,
    networkTxBytes: 5000,
    requestsPerMin: null,
    activeContainers: 3,
    activeApps: 2,
    collectedAt: new Date().toISOString(),
  };
  const appSnapshot = {
    appId: "00000000-0000-0000-0000-000000000010",
    cpuPercent: 12.3,
    memoryMB: 128,
    memoryLimitMB: 512,
    networkRxBytes: 5000,
    networkTxBytes: 2500,
    requestsPerMin: null,
    containers: 1,
    collectedAt: new Date().toISOString(),
  };
  return {
    start: vi.fn(),
    stop: vi.fn(),
    isRunning: false,
    setAppName: vi.fn(),
    setAppSlug: vi.fn(),
    getSystemMetrics: vi.fn().mockReturnValue([sysSnapshot]),
    getAppMetrics: vi.fn().mockReturnValue([appSnapshot]),
    getSystemMetricsFromDb: vi.fn().mockResolvedValue([sysSnapshot]),
    getAppMetricsFromDb: vi.fn().mockResolvedValue([appSnapshot]),
    getSystemMetricsAggregated: vi.fn().mockResolvedValue([]),
    getAppMetricsAggregated: vi.fn().mockResolvedValue([]),
    getStatusHistory: vi.fn().mockReturnValue([
      {
        appId: "00000000-0000-0000-0000-000000000010",
        appName: "Test App",
        entries: [
          { status: "running", timestamp: new Date().toISOString() },
        ],
      },
    ]),
    getAppStatusHistory: vi.fn().mockReturnValue([
      { status: "running", timestamp: new Date().toISOString() },
    ]),
  } as unknown as MetricsCollector;
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const ADMIN_USER = {
  id: "00000000-0000-0000-0000-000000000001",
  username: "admin",
  email: "admin@localhost",
  passwordHash: "",
  role: "admin" as const,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

const TEST_APP = {
  id: "00000000-0000-0000-0000-000000000010",
  name: "Test App",
  slug: "test-app",
  rVersion: "4.4.1",
  packages: [],
  codeSource: { type: "upload" },
  entryScript: "run_rserve.R",
  replicas: 1,
  ownerId: ADMIN_USER.id,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let app: FastifyInstance;
let mockSpawner: DockerSpawner;
let mockHealthMonitor: HealthMonitor;
let mockMetricsCollector: MetricsCollector;

beforeAll(async () => {
  ADMIN_USER.passwordHash = await hash("admin123");
  mockSpawner = createMockSpawner();
  mockHealthMonitor = createMockHealthMonitor();
  mockMetricsCollector = createMockMetricsCollector();
  app = await buildApp({
    logger: false,
    spawner: mockSpawner,
    healthMonitor: mockHealthMonitor,
    metricsCollector: mockMetricsCollector,
  });
  await app.ready();
});

beforeEach(() => {
  rowsQueue.length = 0;
  vi.clearAllMocks();
});

afterAll(async () => {
  await app.close();
});

/** Helper: get a session cookie by logging in */
async function login(): Promise<string> {
  queueRows([ADMIN_USER]); // auth lookup
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "admin123" },
  });
  return res.headers["set-cookie"] as string;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Metrics routes", () => {
  // -----------------------------------------------------------------------
  // GET /api/metrics/system
  // -----------------------------------------------------------------------
  describe("GET /api/metrics/system", () => {
    it("returns 401 without auth", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/metrics/system",
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns system metrics with default period", async () => {
      const cookie = await login();
      queueRows([ADMIN_USER]); // requireAuth session lookup

      const res = await app.inject({
        method: "GET",
        url: "/api/metrics/system",
        headers: { cookie },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.period).toBe("1h");
      expect(body.dataPoints).toHaveLength(1);
      expect(body.dataPoints[0].cpuPercent).toBe(25.5);
      expect(body.dataPoints[0].activeContainers).toBe(3);
    });

    it("accepts period query parameter", async () => {
      const cookie = await login();
      queueRows([ADMIN_USER]); // requireAuth session lookup

      const res = await app.inject({
        method: "GET",
        url: "/api/metrics/system?period=24h",
        headers: { cookie },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().period).toBe("24h");
    });

    it("rejects invalid period", async () => {
      const cookie = await login();
      queueRows([ADMIN_USER]); // requireAuth session lookup

      const res = await app.inject({
        method: "GET",
        url: "/api/metrics/system?period=99h",
        headers: { cookie },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/metrics/apps/:id
  // -----------------------------------------------------------------------
  describe("GET /api/metrics/apps/:id", () => {
    it("returns 401 without auth", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/metrics/apps/${TEST_APP.id}`,
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns per-app metrics", async () => {
      const cookie = await login();

      queueRows([TEST_APP]); // app lookup

      const res = await app.inject({
        method: "GET",
        url: `/api/metrics/apps/${TEST_APP.id}`,
        headers: { cookie },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.period).toBe("1h");
      expect(body.dataPoints).toHaveLength(1);
      expect(body.dataPoints[0].cpuPercent).toBe(12.3);
      expect(body.dataPoints[0].containers).toBe(1);
    });

    it("returns 404 for non-existent app", async () => {
      const cookie = await login();

      queueRows([]); // no app found

      const res = await app.inject({
        method: "GET",
        url: `/api/metrics/apps/${TEST_APP.id}`,
        headers: { cookie },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/status/history
  // -----------------------------------------------------------------------
  describe("GET /api/status/history", () => {
    it("returns 401 without auth", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/status/history",
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns status history for all apps", async () => {
      const cookie = await login();


      const res = await app.inject({
        method: "GET",
        url: "/api/status/history",
        headers: { cookie },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.period).toBe("1h");
      expect(body.apps).toHaveLength(1);
      expect(body.apps[0].appId).toBe(TEST_APP.id);
      expect(body.apps[0].entries[0].status).toBe("running");
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/apps/:id/status/history
  // -----------------------------------------------------------------------
  describe("GET /api/apps/:id/status/history", () => {
    it("returns 401 without auth", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/apps/${TEST_APP.id}/status/history`,
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns per-app status history", async () => {
      const cookie = await login();

      queueRows([TEST_APP]); // app lookup

      const res = await app.inject({
        method: "GET",
        url: `/api/apps/${TEST_APP.id}/status/history`,
        headers: { cookie },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.period).toBe("1h");
      expect(body.appId).toBe(TEST_APP.id);
      expect(body.appName).toBe("Test App");
      expect(body.entries[0].status).toBe("running");
    });

    it("returns 404 for non-existent app", async () => {
      const cookie = await login();

      queueRows([]); // no app found

      const res = await app.inject({
        method: "GET",
        url: `/api/apps/${TEST_APP.id}/status/history`,
        headers: { cookie },
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
