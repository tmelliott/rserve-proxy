import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetricsCollector } from "./metrics-collector.js";
import type { DockerSpawner } from "../spawner/docker-spawner.js";
import type { HealthMonitor, AppHealthSnapshot } from "../spawner/health-monitor.js";
import type { AppStatus } from "@rserve-proxy/shared";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockSpawner(overrides?: Partial<DockerSpawner>) {
  return {
    listManagedContainers: vi.fn().mockResolvedValue([]),
    getAppStatus: vi.fn().mockResolvedValue("stopped" as AppStatus),
    getContainers: vi.fn().mockResolvedValue([]),
    getDocker: vi.fn().mockReturnValue({
      getContainer: vi.fn().mockReturnValue({
        stats: vi.fn().mockResolvedValue(createMockStats()),
      }),
    }),
    ...overrides,
  } as unknown as DockerSpawner;
}

function createMockHealthMonitor(overrides?: Partial<HealthMonitor>) {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    track: vi.fn(),
    untrack: vi.fn(),
    getSnapshot: vi.fn().mockReturnValue(undefined),
    getAllSnapshots: vi.fn().mockReturnValue([]),
    isRunning: false,
    ...overrides,
  } as unknown as HealthMonitor;
}

/** Create a realistic Docker stats response */
function createMockStats(overrides?: Record<string, unknown>) {
  return {
    cpu_stats: {
      cpu_usage: { total_usage: 500_000_000 },
      system_cpu_usage: 10_000_000_000,
      online_cpus: 4,
    },
    memory_stats: {
      usage: 128 * 1024 * 1024, // 128 MB
      limit: 512 * 1024 * 1024, // 512 MB
    },
    networks: {
      eth0: {
        rx_bytes: 1_000_000,
        tx_bytes: 500_000,
      },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let collector: MetricsCollector;

afterEach(() => {
  collector?.stop();
});

describe("MetricsCollector", () => {
  it("starts and stops the collection loop", () => {
    const spawner = createMockSpawner();
    const monitor = createMockHealthMonitor();
    collector = new MetricsCollector(spawner, monitor, { intervalMs: 100 });

    expect(collector.isRunning).toBe(false);
    collector.start();
    expect(collector.isRunning).toBe(true);
    collector.stop();
    expect(collector.isRunning).toBe(false);
  });

  it("does not start twice", () => {
    const spawner = createMockSpawner();
    const monitor = createMockHealthMonitor();
    collector = new MetricsCollector(spawner, monitor, { intervalMs: 100 });

    collector.start();
    collector.start(); // no-op
    expect(collector.isRunning).toBe(true);
  });

  it("records status history from health monitor", async () => {
    const snapshots: AppHealthSnapshot[] = [
      { appId: "app-1", status: "running", containers: [], checkedAt: new Date() },
      { appId: "app-2", status: "stopped", containers: [], checkedAt: new Date() },
    ];
    const monitor = createMockHealthMonitor({
      getAllSnapshots: vi.fn().mockReturnValue(snapshots),
    });
    const spawner = createMockSpawner();

    collector = new MetricsCollector(spawner, monitor, { intervalMs: 50 });
    collector.setAppName("app-1", "My App");
    collector.start();

    await vi.waitFor(() => {
      const history = collector.getStatusHistory("1h");
      expect(history.length).toBeGreaterThanOrEqual(2);
    });

    const history = collector.getStatusHistory("1h");
    const app1 = history.find((h) => h.appId === "app-1");
    expect(app1).toBeDefined();
    expect(app1!.appName).toBe("My App");
    expect(app1!.entries[0].status).toBe("running");

    const app2 = history.find((h) => h.appId === "app-2");
    expect(app2).toBeDefined();
    expect(app2!.entries[0].status).toBe("stopped");
  });

  it("collects container resource metrics", async () => {
    const mockContainer = {
      stats: vi.fn().mockResolvedValue(createMockStats()),
    };
    const mockDocker = {
      getContainer: vi.fn().mockReturnValue(mockContainer),
    };

    const spawner = createMockSpawner({
      listManagedContainers: vi.fn().mockResolvedValue([
        {
          Id: "container-1",
          State: "running",
          Labels: { "rserve-proxy.app-id": "app-1" },
        },
      ]),
      getDocker: vi.fn().mockReturnValue(mockDocker),
    });
    const monitor = createMockHealthMonitor();

    collector = new MetricsCollector(spawner, monitor, { intervalMs: 50 });
    collector.start();

    // Wait for at least 2 collections so we get CPU deltas
    await vi.waitFor(
      () => {
        const metrics = collector.getAppMetrics("app-1", "1h");
        expect(metrics.length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 500 },
    );

    const appMetrics = collector.getAppMetrics("app-1", "1h");
    expect(appMetrics[0].appId).toBe("app-1");
    expect(appMetrics[0].memoryMB).toBeCloseTo(128, 0);
    expect(appMetrics[0].memoryLimitMB).toBeCloseTo(512, 0);
    expect(appMetrics[0].containers).toBe(1);
    expect(appMetrics[0].requestsPerMin).toBeNull(); // Phase 7d

    // System metrics should also be populated
    const sysMetrics = collector.getSystemMetrics("1h");
    expect(sysMetrics.length).toBeGreaterThanOrEqual(2);
    expect(sysMetrics[0].activeContainers).toBe(1);
    expect(sysMetrics[0].activeApps).toBe(1);
  });

  it("computes CPU delta between collections", async () => {
    let callCount = 0;
    const mockContainer = {
      stats: vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(
          createMockStats({
            cpu_stats: {
              // Increase CPU each call to get a non-zero delta
              cpu_usage: { total_usage: callCount * 100_000_000 },
              system_cpu_usage: callCount * 1_000_000_000,
              online_cpus: 4,
            },
          }),
        );
      }),
    };
    const mockDocker = {
      getContainer: vi.fn().mockReturnValue(mockContainer),
    };

    const spawner = createMockSpawner({
      listManagedContainers: vi.fn().mockResolvedValue([
        { Id: "c1", State: "running", Labels: { "rserve-proxy.app-id": "app-1" } },
      ]),
      getDocker: vi.fn().mockReturnValue(mockDocker),
    });
    const monitor = createMockHealthMonitor();

    collector = new MetricsCollector(spawner, monitor, { intervalMs: 50 });
    collector.start();

    await vi.waitFor(
      () => {
        const metrics = collector.getAppMetrics("app-1", "1h");
        // Second data point should have CPU > 0 (delta calculation)
        expect(metrics.length).toBeGreaterThanOrEqual(2);
        expect(metrics[1].cpuPercent).toBeGreaterThan(0);
      },
      { timeout: 500 },
    );
  });

  it("handles Docker unavailable gracefully", async () => {
    const spawner = createMockSpawner({
      listManagedContainers: vi.fn().mockRejectedValue(new Error("Docker unavailable")),
    });
    const monitor = createMockHealthMonitor();

    collector = new MetricsCollector(spawner, monitor, { intervalMs: 50 });
    collector.start();

    // Should not throw; system metrics should record zeros
    await vi.waitFor(() => {
      const sysMetrics = collector.getSystemMetrics("1h");
      expect(sysMetrics.length).toBeGreaterThanOrEqual(1);
    });

    const sysMetrics = collector.getSystemMetrics("1h");
    expect(sysMetrics[0].activeContainers).toBe(0);
    expect(sysMetrics[0].cpuPercent).toBe(0);
  });

  it("skips non-running containers", async () => {
    const spawner = createMockSpawner({
      listManagedContainers: vi.fn().mockResolvedValue([
        { Id: "c1", State: "exited", Labels: { "rserve-proxy.app-id": "app-1" } },
      ]),
    });
    const monitor = createMockHealthMonitor();

    collector = new MetricsCollector(spawner, monitor, { intervalMs: 50 });
    collector.start();

    await vi.waitFor(() => {
      const sysMetrics = collector.getSystemMetrics("1h");
      expect(sysMetrics.length).toBeGreaterThanOrEqual(1);
    });

    const sysMetrics = collector.getSystemMetrics("1h");
    expect(sysMetrics[0].activeContainers).toBe(0);
    expect(collector.getAppMetrics("app-1", "1h")).toHaveLength(0);
  });

  it("filters metrics by period", async () => {
    const spawner = createMockSpawner();
    const monitor = createMockHealthMonitor();

    collector = new MetricsCollector(spawner, monitor, { intervalMs: 50 });
    collector.start();

    await vi.waitFor(() => {
      expect(collector.getSystemMetrics("1h").length).toBeGreaterThanOrEqual(1);
    });

    // All recent data should appear in any period
    expect(collector.getSystemMetrics("1h").length).toBeGreaterThanOrEqual(1);
    expect(collector.getSystemMetrics("24h").length).toBeGreaterThanOrEqual(1);
    expect(collector.getSystemMetrics("7d").length).toBeGreaterThanOrEqual(1);
  });

  it("returns per-app status history", async () => {
    const snapshots: AppHealthSnapshot[] = [
      { appId: "app-1", status: "running", containers: [], checkedAt: new Date() },
    ];
    const monitor = createMockHealthMonitor({
      getAllSnapshots: vi.fn().mockReturnValue(snapshots),
    });
    const spawner = createMockSpawner();

    collector = new MetricsCollector(spawner, monitor, { intervalMs: 50 });
    collector.start();

    await vi.waitFor(() => {
      const entries = collector.getAppStatusHistory("app-1", "1h");
      expect(entries.length).toBeGreaterThanOrEqual(1);
    });

    const entries = collector.getAppStatusHistory("app-1", "1h");
    expect(entries[0].status).toBe("running");
    expect(entries[0].timestamp).toBeDefined();
  });

  it("aggregates metrics across multiple containers for one app", async () => {
    const mockContainer = {
      stats: vi.fn().mockResolvedValue(createMockStats()),
    };
    const mockDocker = {
      getContainer: vi.fn().mockReturnValue(mockContainer),
    };

    const spawner = createMockSpawner({
      listManagedContainers: vi.fn().mockResolvedValue([
        { Id: "c1", State: "running", Labels: { "rserve-proxy.app-id": "app-1" } },
        { Id: "c2", State: "running", Labels: { "rserve-proxy.app-id": "app-1" } },
      ]),
      getDocker: vi.fn().mockReturnValue(mockDocker),
    });
    const monitor = createMockHealthMonitor();

    collector = new MetricsCollector(spawner, monitor, { intervalMs: 50 });
    collector.start();

    await vi.waitFor(() => {
      const metrics = collector.getAppMetrics("app-1", "1h");
      expect(metrics.length).toBeGreaterThanOrEqual(1);
    });

    const appMetrics = collector.getAppMetrics("app-1", "1h");
    expect(appMetrics[0].containers).toBe(2);
    // Memory should be summed: 128 MB * 2 = 256 MB
    expect(appMetrics[0].memoryMB).toBeCloseTo(256, 0);
  });

  it("computes requestsPerMin from Traefik metrics", async () => {
    let fetchCallCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      fetchCallCount++;
      // First call: baseline counter. Second call: increased counter.
      const count = fetchCallCount === 1 ? 100 : 160;
      const body =
        `traefik_service_requests_total{code="200",method="GET",protocol="http",service="test-slug@docker"} ${count}`;
      return new Response(body, { status: 200 });
    });

    const mockContainer = {
      stats: vi.fn().mockResolvedValue(createMockStats()),
    };
    const spawner = createMockSpawner({
      listManagedContainers: vi.fn().mockResolvedValue([
        { Id: "c1", State: "running", Labels: { "rserve-proxy.app-id": "app-1" } },
      ]),
      getDocker: vi.fn().mockReturnValue({
        getContainer: vi.fn().mockReturnValue(mockContainer),
      }),
    });
    const monitor = createMockHealthMonitor();

    collector = new MetricsCollector(spawner, monitor, {
      intervalMs: 50,
      traefikUrl: "http://traefik:8082/metrics",
    });
    collector.setAppSlug("app-1", "test-slug");
    collector.start();

    // Wait for at least 2 collections so we get a delta
    await vi.waitFor(
      () => {
        const metrics = collector.getAppMetrics("app-1", "1h");
        expect(metrics.length).toBeGreaterThanOrEqual(2);
        // Second data point should have a computed request rate
        const withRate = metrics.find((m) => m.requestsPerMin !== null);
        expect(withRate).toBeDefined();
      },
      { timeout: 1000 },
    );

    const appMetrics = collector.getAppMetrics("app-1", "1h");
    const withRate = appMetrics.find((m) => m.requestsPerMin !== null);
    expect(withRate!.requestsPerMin).toBeGreaterThan(0);

    // System metrics should also have requestsPerMin
    const sysMetrics = collector.getSystemMetrics("1h");
    const sysWithRate = sysMetrics.find((m) => m.requestsPerMin !== null);
    expect(sysWithRate).toBeDefined();

    vi.restoreAllMocks();
  });

  it("leaves requestsPerMin null when no traefik URL configured", async () => {
    const spawner = createMockSpawner();
    const monitor = createMockHealthMonitor();

    collector = new MetricsCollector(spawner, monitor, { intervalMs: 50 });
    collector.start();

    await vi.waitFor(() => {
      expect(collector.getSystemMetrics("1h").length).toBeGreaterThanOrEqual(1);
    });

    const sysMetrics = collector.getSystemMetrics("1h");
    expect(sysMetrics[0].requestsPerMin).toBeNull();
  });

  it("handles Traefik scrape failure gracefully", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const spawner = createMockSpawner();
    const monitor = createMockHealthMonitor();

    collector = new MetricsCollector(spawner, monitor, {
      intervalMs: 50,
      traefikUrl: "http://traefik:8082/metrics",
    });
    collector.start();

    await vi.waitFor(() => {
      expect(collector.getSystemMetrics("1h").length).toBeGreaterThanOrEqual(1);
    });

    // Should still record metrics with null requestsPerMin
    const sysMetrics = collector.getSystemMetrics("1h");
    expect(sysMetrics[0].requestsPerMin).toBeNull();

    vi.restoreAllMocks();
  });
});
