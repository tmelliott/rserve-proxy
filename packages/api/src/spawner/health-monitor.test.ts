import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HealthMonitor } from "./health-monitor.js";
import type { DockerSpawner } from "./docker-spawner.js";
import type { AppStatus, ContainerInfo } from "@rserve-proxy/shared";

// ---------------------------------------------------------------------------
// Mock spawner
// ---------------------------------------------------------------------------

function createMockSpawner(overrides?: Partial<DockerSpawner>) {
  return {
    listManagedContainers: vi.fn().mockResolvedValue([]),
    getAppStatus: vi.fn().mockResolvedValue("stopped" as AppStatus),
    getContainers: vi.fn().mockResolvedValue([] as ContainerInfo[]),
    ...overrides,
  } as unknown as DockerSpawner;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let monitor: HealthMonitor;

afterEach(() => {
  monitor?.stop();
});

describe("HealthMonitor", () => {
  it("starts and stops the polling loop", () => {
    const spawner = createMockSpawner();
    monitor = new HealthMonitor(spawner, { intervalMs: 100 });

    expect(monitor.isRunning).toBe(false);
    monitor.start();
    expect(monitor.isRunning).toBe(true);
    monitor.stop();
    expect(monitor.isRunning).toBe(false);
  });

  it("does not start twice", () => {
    const spawner = createMockSpawner();
    monitor = new HealthMonitor(spawner, { intervalMs: 100 });

    monitor.start();
    monitor.start(); // no-op
    expect(monitor.isRunning).toBe(true);
  });

  it("tracks and untracks apps", () => {
    const spawner = createMockSpawner();
    monitor = new HealthMonitor(spawner, { intervalMs: 100 });

    monitor.track("app-1");
    monitor.track("app-2");
    monitor.untrack("app-1");

    // Untracked app's snapshot should be removed
    expect(monitor.getSnapshot("app-1")).toBeUndefined();
  });

  it("polls tracked apps and caches snapshots", async () => {
    const spawner = createMockSpawner({
      getAppStatus: vi.fn().mockResolvedValue("running" as AppStatus),
      getContainers: vi.fn().mockResolvedValue([
        {
          containerId: "abc123",
          status: "running",
          healthStatus: "healthy",
          port: 6311,
        },
      ] as ContainerInfo[]),
    });

    monitor = new HealthMonitor(spawner, { intervalMs: 50 });
    monitor.track("app-1");
    monitor.start();

    // Wait for at least one poll
    await vi.waitFor(() => {
      expect(monitor.getSnapshot("app-1")).toBeDefined();
    });

    const snapshot = monitor.getSnapshot("app-1")!;
    expect(snapshot.status).toBe("running");
    expect(snapshot.containers).toHaveLength(1);
    expect(snapshot.containers[0].healthStatus).toBe("healthy");
    expect(snapshot.checkedAt).toBeInstanceOf(Date);
  });

  it("discovers untracked containers from Docker", async () => {
    const spawner = createMockSpawner({
      listManagedContainers: vi.fn().mockResolvedValue([
        { Id: "c1", Labels: { "rserve-proxy.app-id": "discovered-app" } },
      ]),
      getAppStatus: vi.fn().mockResolvedValue("running" as AppStatus),
      getContainers: vi.fn().mockResolvedValue([]),
    });

    monitor = new HealthMonitor(spawner, { intervalMs: 50 });
    monitor.start();

    await vi.waitFor(() => {
      expect(monitor.getSnapshot("discovered-app")).toBeDefined();
    });

    expect(monitor.getSnapshot("discovered-app")!.status).toBe("running");
  });

  it("calls onStatusChange when app status changes", async () => {
    const onChange = vi.fn();
    let callCount = 0;
    const spawner = createMockSpawner({
      getAppStatus: vi.fn().mockImplementation(() => {
        callCount++;
        // First poll: running, second poll: error
        return Promise.resolve(callCount <= 1 ? "running" : "error");
      }),
      getContainers: vi.fn().mockResolvedValue([]),
    });

    monitor = new HealthMonitor(spawner, {
      intervalMs: 50,
      onStatusChange: onChange,
    });
    monitor.track("app-1");
    monitor.start();

    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    expect(onChange).toHaveBeenCalledWith("app-1", "running", "error");
  });

  it("marks app as error when spawner throws", async () => {
    const spawner = createMockSpawner({
      getAppStatus: vi.fn().mockRejectedValue(new Error("Docker unavailable")),
      getContainers: vi.fn().mockRejectedValue(new Error("Docker unavailable")),
    });

    monitor = new HealthMonitor(spawner, { intervalMs: 50 });
    monitor.track("app-1");
    monitor.start();

    await vi.waitFor(() => {
      expect(monitor.getSnapshot("app-1")).toBeDefined();
    });

    expect(monitor.getSnapshot("app-1")!.status).toBe("error");
  });

  it("returns all snapshots", async () => {
    const spawner = createMockSpawner({
      getAppStatus: vi.fn().mockResolvedValue("running" as AppStatus),
      getContainers: vi.fn().mockResolvedValue([]),
    });

    monitor = new HealthMonitor(spawner, { intervalMs: 50 });
    monitor.track("app-1");
    monitor.track("app-2");
    monitor.start();

    await vi.waitFor(() => {
      expect(monitor.getAllSnapshots()).toHaveLength(2);
    });

    const all = monitor.getAllSnapshots();
    expect(all.map((s) => s.appId).sort()).toEqual(["app-1", "app-2"]);
  });
});
