import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "@rserve-proxy/shared";

// ---------------------------------------------------------------------------
// Mock dockerode — define mocks at module scope for vi.mock() references
// ---------------------------------------------------------------------------

function fakeBuildStream(lines: { stream?: string; error?: string }[]) {
  const data = lines.map((l: unknown) => JSON.stringify(l)).join("\n") + "\n";
  return Readable.from([Buffer.from(data)]);
}

const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockResolvedValue(undefined);
const mockRemove = vi.fn().mockResolvedValue(undefined);
const mockRestart = vi.fn().mockResolvedValue(undefined);
const mockCreateContainer = vi.fn().mockResolvedValue({
  start: mockStart,
  id: "abc123def456",
});
const mockListContainers = vi.fn().mockResolvedValue([]);
const mockListImages = vi.fn().mockResolvedValue([]);
const mockGetContainer = vi.fn().mockReturnValue({
  stop: mockStop,
  remove: mockRemove,
  restart: mockRestart,
});
const mockGetImage = vi.fn().mockReturnValue({
  remove: vi.fn().mockResolvedValue(undefined),
});
const mockBuildImage = vi.fn().mockImplementation(() =>
  Promise.resolve(
    fakeBuildStream([
      { stream: "Step 1/4 : FROM rserve-base:4.4.1\n" },
      { stream: "Successfully built abc123\n" },
      { stream: "Successfully tagged rserve-app-test:hash123\n" },
    ]),
  ),
);
const mockExecFileSync = vi.fn();

vi.mock("dockerode", () => {
  const DockerMock = function (this: Record<string, unknown>) {
    this.buildImage = mockBuildImage;
    this.createContainer = mockCreateContainer;
    this.listContainers = mockListContainers;
    this.listImages = mockListImages;
    this.getContainer = mockGetContainer;
    this.getImage = mockGetImage;
  } as unknown as { new (): unknown };
  return { default: DockerMock };
});

vi.mock("tar-fs", () => ({
  pack: vi.fn().mockImplementation(() => Readable.from([Buffer.from("fake-tar")])),
}));

vi.mock("node:child_process", () => ({
  execFileSync: mockExecFileSync,
}));

// ---------------------------------------------------------------------------
import { DockerSpawner } from "./docker-spawner.js";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function makeAppConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    id: "app-0000-0000-0000-000000000001",
    name: "Test App",
    slug: "test-app",
    rVersion: "4.4.1",
    packages: [],
    codeSource: { type: "upload" },
    entryScript: "run_rserve.R",
    replicas: 1,
    ownerId: "owner-1",
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let spawner: DockerSpawner;

beforeEach(() => {
  vi.clearAllMocks();
  spawner = new DockerSpawner();
});

// ===========================================================================
// buildImage
// ===========================================================================
describe("buildImage", () => {
  it("builds an image for an upload source app", async () => {
    // Create a real temp dir with a simple R file (needed for fs.cp)
    const codeDir = await mkdtemp(join(tmpdir(), "test-code-"));
    await writeFile(join(codeDir, "run_rserve.R"), 'cat("hello")\n');

    try {
      const result = await spawner.buildImage({
        appConfig: makeAppConfig(),
        codePath: codeDir,
      });

      expect(result.success).toBe(true);
      expect(result.imageName).toBe("rserve-app-test-app");
      expect(result.imageTag).toHaveLength(12);
      expect(result.buildLog.length).toBeGreaterThan(0);
      expect(result.error).toBeUndefined();

      // dockerode.buildImage should have been called
      expect(mockBuildImage).toHaveBeenCalledOnce();
      const [, opts] = mockBuildImage.mock.calls[0];
      expect(opts.t).toMatch(/^rserve-app-test-app:/);
      expect(opts.labels["managed-by"]).toBe("rserve-proxy");
      expect(opts.labels["rserve-proxy.app-id"]).toBe(
        "app-0000-0000-0000-000000000001",
      );
    } finally {
      await rm(codeDir, { recursive: true, force: true });
    }
  });

  it("clones a git repo for git source apps", async () => {
    const result = await spawner.buildImage({
      appConfig: makeAppConfig({
        codeSource: { type: "git", repoUrl: "https://github.com/test/repo.git" },
      }),
    });

    expect(result.success).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["clone", "--depth", "1", "https://github.com/test/repo.git"]),
      expect.objectContaining({ timeout: 120_000 }),
    );
  });

  it("includes packages in the image when specified", async () => {
    const codeDir = await mkdtemp(join(tmpdir(), "test-code-"));
    await writeFile(join(codeDir, "run_rserve.R"), 'cat("hello")\n');

    try {
      const cfg = makeAppConfig({ packages: ["ggplot2", "dplyr"] });
      const result = await spawner.buildImage({
        appConfig: cfg,
        codePath: codeDir,
      });

      expect(result.success).toBe(true);
      // Different packages = different image hash
      const cfgNoPackages = makeAppConfig();
      const result2 = await spawner.buildImage({
        appConfig: cfgNoPackages,
        codePath: codeDir,
      });
      expect(result.imageTag).not.toBe(result2.imageTag);
    } finally {
      await rm(codeDir, { recursive: true, force: true });
    }
  });

  it("reports build errors from the stream", async () => {
    mockBuildImage.mockResolvedValueOnce(
      fakeBuildStream([
        { stream: "Step 1/4 : FROM rserve-base:4.4.1\n" },
        { error: "something went wrong" },
      ]),
    );

    const codeDir = await mkdtemp(join(tmpdir(), "test-code-"));
    await writeFile(join(codeDir, "run_rserve.R"), 'cat("hello")\n');

    try {
      const result = await spawner.buildImage({
        appConfig: makeAppConfig(),
        codePath: codeDir,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("something went wrong");
    } finally {
      await rm(codeDir, { recursive: true, force: true });
    }
  });

  it("throws when upload source has no codePath", async () => {
    await expect(
      spawner.buildImage({ appConfig: makeAppConfig() }),
    ).rejects.toThrow(/upload source requires codePath/);
  });
});

// ===========================================================================
// startApp
// ===========================================================================
describe("startApp", () => {
  it("creates and starts a container with Traefik labels", async () => {
    const cfg = makeAppConfig();

    await spawner.startApp({
      appConfig: cfg,
      imageName: "rserve-app-test-app:abc123",
    });

    expect(mockCreateContainer).toHaveBeenCalledOnce();
    const createArg = mockCreateContainer.mock.calls[0][0];

    expect(createArg.Image).toBe("rserve-app-test-app:abc123");
    expect(createArg.name).toBe("rserve-test-app-0");
    expect(createArg.Labels["traefik.enable"]).toBe("true");
    expect(createArg.Labels["traefik.http.routers.test-app.rule"]).toBe(
      "PathPrefix(`/test-app`)",
    );
    expect(
      createArg.Labels["traefik.http.services.test-app.loadbalancer.server.port"],
    ).toBe("8081");
    expect(createArg.Labels["managed-by"]).toBe("rserve-proxy");
    expect(createArg.Labels["rserve-proxy.app-id"]).toBe(cfg.id);
    expect(mockStart).toHaveBeenCalledOnce();
  });

  it("creates multiple containers for replicas > 1", async () => {
    const cfg = makeAppConfig({ replicas: 3 });

    await spawner.startApp({
      appConfig: cfg,
      imageName: "rserve-app-test-app:abc123",
    });

    expect(mockCreateContainer).toHaveBeenCalledTimes(3);
    const names = mockCreateContainer.mock.calls.map(
      (c: unknown[]) => (c[0] as { name: string }).name,
    );
    expect(names).toEqual([
      "rserve-test-app-0",
      "rserve-test-app-1",
      "rserve-test-app-2",
    ]);
    expect(mockStart).toHaveBeenCalledTimes(3);
  });

  it("builds an image first when imageName is not provided", async () => {
    const codeDir = await mkdtemp(join(tmpdir(), "test-code-"));
    await writeFile(join(codeDir, "run_rserve.R"), 'cat("hello")\n');

    try {
      const cfg = makeAppConfig({
        codeSource: { type: "git", repoUrl: "https://github.com/test/repo.git" },
      });

      await spawner.startApp({ appConfig: cfg });

      expect(mockBuildImage).toHaveBeenCalledOnce();
      expect(mockCreateContainer).toHaveBeenCalledOnce();
    } finally {
      await rm(codeDir, { recursive: true, force: true });
    }
  });

  it("throws when image build fails", async () => {
    mockBuildImage.mockResolvedValueOnce(
      fakeBuildStream([{ error: "build failed" }]),
    );

    const cfg = makeAppConfig({
      codeSource: { type: "git", repoUrl: "https://github.com/test/repo.git" },
    });

    await expect(spawner.startApp({ appConfig: cfg })).rejects.toThrow(
      /Image build failed/,
    );
  });
});

// ===========================================================================
// stopApp
// ===========================================================================
describe("stopApp", () => {
  it("stops and removes running containers", async () => {
    mockListContainers.mockResolvedValueOnce([
      { Id: "c1", State: "running" },
      { Id: "c2", State: "exited" },
    ]);

    await spawner.stopApp("app-1");

    expect(mockGetContainer).toHaveBeenCalledWith("c1");
    expect(mockGetContainer).toHaveBeenCalledWith("c2");
    expect(mockStop).toHaveBeenCalledOnce(); // only running container
    expect(mockRemove).toHaveBeenCalledTimes(2); // both removed
  });

  it("does nothing when no containers exist", async () => {
    mockListContainers.mockResolvedValueOnce([]);
    await spawner.stopApp("app-1");
    expect(mockStop).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// restartApp
// ===========================================================================
describe("restartApp", () => {
  it("restarts all containers for the app", async () => {
    mockListContainers.mockResolvedValueOnce([
      { Id: "c1", State: "running" },
      { Id: "c2", State: "running" },
    ]);

    await spawner.restartApp("app-1");

    expect(mockRestart).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// getAppStatus
// ===========================================================================
describe("getAppStatus", () => {
  it('returns "stopped" when no containers exist', async () => {
    mockListContainers.mockResolvedValueOnce([]);
    expect(await spawner.getAppStatus("app-1")).toBe("stopped");
  });

  it('returns "running" when all containers are running', async () => {
    mockListContainers.mockResolvedValueOnce([
      { Id: "c1", State: "running" },
      { Id: "c2", State: "running" },
    ]);
    expect(await spawner.getAppStatus("app-1")).toBe("running");
  });

  it('returns "error" when any container has exited', async () => {
    mockListContainers.mockResolvedValueOnce([
      { Id: "c1", State: "running" },
      { Id: "c2", State: "exited" },
    ]);
    expect(await spawner.getAppStatus("app-1")).toBe("error");
  });

  it('returns "error" when a container is dead', async () => {
    mockListContainers.mockResolvedValueOnce([
      { Id: "c1", State: "dead" },
    ]);
    expect(await spawner.getAppStatus("app-1")).toBe("error");
  });

  it('returns "starting" when containers are in mixed states', async () => {
    mockListContainers.mockResolvedValueOnce([
      { Id: "c1", State: "running" },
      { Id: "c2", State: "created" },
    ]);
    expect(await spawner.getAppStatus("app-1")).toBe("starting");
  });
});

// ===========================================================================
// getContainers
// ===========================================================================
describe("getContainers", () => {
  it("returns container info list", async () => {
    mockListContainers.mockResolvedValueOnce([
      {
        Id: "abc123def456789",
        State: "running",
        Status: "Up 5 minutes (healthy)",
        Created: 1700000000,
      },
    ]);

    const containers = await spawner.getContainers("app-1");

    expect(containers).toHaveLength(1);
    expect(containers[0].containerId).toBe("abc123def456");
    expect(containers[0].status).toBe("running");
    expect(containers[0].healthStatus).toBe("healthy");
    expect(containers[0].port).toBe(8081);
    expect(containers[0].startedAt).toBeInstanceOf(Date);
  });

  it("returns empty array when no containers", async () => {
    mockListContainers.mockResolvedValueOnce([]);
    expect(await spawner.getContainers("app-1")).toEqual([]);
  });
});

// ===========================================================================
// cleanup
// ===========================================================================
describe("cleanup", () => {
  it("removes stopped containers but not running ones", async () => {
    mockListContainers.mockResolvedValueOnce([
      { Id: "c1", State: "running" },
      { Id: "c2", State: "exited" },
    ]);
    mockListImages.mockResolvedValueOnce([]);

    await spawner.cleanup("app-1");

    // Only the exited container should be removed
    expect(mockGetContainer).toHaveBeenCalledWith("c2");
    expect(mockGetContainer).not.toHaveBeenCalledWith("c1");
  });
});

// ===========================================================================
// cleanupAll
// ===========================================================================
describe("cleanupAll", () => {
  it("stops running containers and removes all containers + images", async () => {
    mockListContainers.mockResolvedValueOnce([
      { Id: "c1", State: "running" },
      { Id: "c2", State: "exited" },
    ]);
    mockListImages.mockResolvedValueOnce([{ Id: "img1" }]);

    const result = await spawner.cleanupAll();

    expect(result.containers).toBe(2);
    expect(result.images).toBe(1);
    expect(mockStop).toHaveBeenCalledOnce();
    expect(mockRemove).toHaveBeenCalledTimes(2);
  });
});
