/**
 * Docker-based spawner implementation.
 *
 * Manages Rserve instances as Docker containers using dockerode.
 * Each app gets a custom-built Docker image with:
 * - A user-selected R version (from rserve-base:{version})
 * - Installed R packages
 * - The app's R code (cloned from git or uploaded)
 *
 * Containers are created with Traefik labels for automatic
 * reverse proxy discovery.
 */

import Docker from "dockerode";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar-fs";
import type {
  ISpawner,
  BuildImageOptions,
  BuildResult,
  StartAppOptions,
  AppConfig,
  AppStatus,
  ContainerInfo,
} from "@rserve-proxy/shared";

/**
 * Label applied to ALL resources (containers, images) created by the spawner.
 * Used for identification and cleanup:
 *   docker container ls --filter label=managed-by=rserve-proxy
 *   docker image ls --filter label=managed-by=rserve-proxy
 */
const MANAGED_LABEL = "managed-by";
const MANAGED_VALUE = "rserve-proxy";
const APP_ID_LABEL = "rserve-proxy.app-id";

/** Default Rserve port inside the container */
const RSERVE_PORT = 6311;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute a short deterministic hash from the app config fields that affect
 * the built image. If any of these change, we get a new image tag.
 */
function imageHash(cfg: AppConfig): string {
  const data = JSON.stringify({
    rVersion: cfg.rVersion,
    packages: [...cfg.packages].sort(),
    codeSource: cfg.codeSource,
    entryScript: cfg.entryScript,
  });
  return createHash("sha256").update(data).digest("hex").slice(0, 12);
}

/** Build the image name + tag for an app */
function imageTag(cfg: AppConfig): { name: string; tag: string; full: string } {
  const name = `rserve-app-${cfg.slug}`;
  const tag = imageHash(cfg);
  return { name, tag, full: `${name}:${tag}` };
}

/**
 * Generate a Dockerfile for an app.
 * - FROM rserve-base:{rVersion}
 * - Install R packages via pak (if any)
 * - Copy app code into /app
 * - CMD sources the entry script
 */
function generateDockerfile(cfg: AppConfig): string {
  const lines: string[] = [
    `FROM rserve-base:${cfg.rVersion}`,
    "",
    `LABEL ${MANAGED_LABEL}=${MANAGED_VALUE}`,
    `LABEL ${APP_ID_LABEL}=${cfg.id}`,
    "",
  ];

  if (cfg.packages.length > 0) {
    const pkgList = cfg.packages.map((p) => `'${p}'`).join(", ");
    lines.push(`RUN R -e "pak::pak(c(${pkgList}))"`, "");
  }

  lines.push(
    "COPY code/ /app/",
    "",
    `EXPOSE ${RSERVE_PORT}`,
    "",
    // Health check: attempt a TCP connection to the Rserve port.
    // bash's /dev/tcp is the simplest zero-dependency check.
    `HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \\`,
    `  CMD bash -c "echo > /dev/tcp/localhost/${RSERVE_PORT}" || exit 1`,
    "",
    `CMD ["R", "-e", "source('/app/${cfg.entryScript}')"]`,
    "",
  );

  return lines.join("\n");
}

/**
 * Parse a Docker build output stream. Each chunk is a JSON object with
 * a `stream` or `error` field (or both).
 */
function parseBuildStream(
  stream: NodeJS.ReadableStream,
  onLog?: (line: string) => void,
): Promise<{ log: string[]; error?: string }> {
  return new Promise((resolve, reject) => {
    const log: string[] = [];
    let error: string | undefined;

    stream.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const raw of lines) {
        try {
          const obj = JSON.parse(raw) as {
            stream?: string;
            error?: string;
            errorDetail?: { message: string };
          };
          if (obj.stream) {
            const text = obj.stream.trimEnd();
            if (text) {
              log.push(text);
              onLog?.(text);
            }
          }
          if (obj.error) {
            error = obj.error;
            log.push(`ERROR: ${obj.error}`);
            onLog?.(`ERROR: ${obj.error}`);
          }
        } catch {
          // Non-JSON line — include as-is
          const text = raw.trim();
          if (text) {
            log.push(text);
            onLog?.(text);
          }
        }
      }
    });

    stream.on("end", () => resolve({ log, error }));
    stream.on("error", (err: Error) => reject(err));
  });
}

// ---------------------------------------------------------------------------
// DockerSpawner
// ---------------------------------------------------------------------------

export class DockerSpawner implements ISpawner {
  private docker: Docker;
  private networkName: string;

  /** In-flight build logs keyed by appId, for streamBuildLogs() */
  private buildLogs = new Map<string, string[]>();
  private buildListeners = new Map<string, Set<(line: string) => void>>();

  constructor(options?: { socketPath?: string; networkName?: string }) {
    this.docker = new Docker({
      socketPath: options?.socketPath || "/var/run/docker.sock",
    });
    this.networkName = options?.networkName || "rserve-proxy_default";
  }

  /** List all containers managed by rserve-proxy */
  async listManagedContainers(appId?: string): Promise<Docker.ContainerInfo[]> {
    const filters: Record<string, string[]> = {
      label: [`${MANAGED_LABEL}=${MANAGED_VALUE}`],
    };
    if (appId) {
      filters.label.push(`${APP_ID_LABEL}=${appId}`);
    }
    return this.docker.listContainers({ all: true, filters });
  }

  /** Remove all containers and images managed by rserve-proxy */
  async cleanupAll(): Promise<{ containers: number; images: number }> {
    const containers = await this.listManagedContainers();
    for (const info of containers) {
      const container = this.docker.getContainer(info.Id);
      if (info.State === "running") {
        await container.stop();
      }
      await container.remove();
    }

    const images = await this.docker.listImages({
      filters: { label: [`${MANAGED_LABEL}=${MANAGED_VALUE}`] },
    });
    for (const img of images) {
      await this.docker.getImage(img.Id).remove({ force: true });
    }

    return { containers: containers.length, images: images.length };
  }

  // -----------------------------------------------------------------------
  // Build
  // -----------------------------------------------------------------------

  async buildImage(options: BuildImageOptions): Promise<BuildResult> {
    const { appConfig, codePath } = options;
    const { name, tag, full } = imageTag(appConfig);
    let contextDir: string | undefined;

    try {
      // 1. Create temp build context
      contextDir = await mkdtemp(join(tmpdir(), `rserve-build-${appConfig.slug}-`));
      const codeDir = join(contextDir, "code");

      // 2. Prepare the code directory
      if (appConfig.codeSource.type === "git") {
        const { repoUrl, branch } = appConfig.codeSource;
        const args = ["clone", "--depth", "1"];
        if (branch) args.push("--branch", branch);
        args.push(repoUrl, codeDir);
        execFileSync("git", args, { timeout: 120_000, stdio: "pipe" });
      } else if (codePath) {
        // Upload source — copy the uploaded files into the context
        await cp(codePath, codeDir, { recursive: true });
      } else {
        throw new Error(
          `App "${appConfig.slug}": upload source requires codePath`,
        );
      }

      // 3. Write the generated Dockerfile
      const dockerfile = generateDockerfile(appConfig);
      await writeFile(join(contextDir, "Dockerfile"), dockerfile);

      // 4. Create tar stream from context and build
      const tarStream = tar.pack(contextDir);

      // Set up log collection for streamBuildLogs()
      this.buildLogs.set(appConfig.id, []);
      const listeners = this.buildListeners.get(appConfig.id);

      const onLog = (line: string) => {
        this.buildLogs.get(appConfig.id)?.push(line);
        listeners?.forEach((fn) => fn(line));
      };

      const stream = await this.docker.buildImage(tarStream, {
        t: full,
        labels: {
          [MANAGED_LABEL]: MANAGED_VALUE,
          [APP_ID_LABEL]: appConfig.id,
        },
      });

      const { log, error } = await parseBuildStream(stream, onLog);

      return {
        success: !error,
        imageName: name,
        imageTag: tag,
        buildLog: log,
        error,
      };
    } finally {
      // 5. Clean up temp directory
      if (contextDir) {
        await rm(contextDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  // -----------------------------------------------------------------------
  // Container Lifecycle
  // -----------------------------------------------------------------------

  async startApp(options: StartAppOptions): Promise<void> {
    const { appConfig } = options;
    const slug = appConfig.slug;

    // 1. Determine or build the image
    let image: string;
    if (options.imageName) {
      image = options.imageName;
    } else {
      const result = await this.buildImage({ appConfig });
      if (!result.success) {
        throw new Error(`Image build failed for "${slug}": ${result.error}`);
      }
      image = `${result.imageName}:${result.imageTag}`;
    }

    // 2. Create + start a container for each replica
    for (let i = 0; i < appConfig.replicas; i++) {
      const containerName = `rserve-${slug}-${i}`;

      // Traefik labels for auto-discovery.
      // Each replica is part of the same Traefik service so Traefik
      // load-balances across them.
      const labels: Record<string, string> = {
        [MANAGED_LABEL]: MANAGED_VALUE,
        [APP_ID_LABEL]: appConfig.id,
        "traefik.enable": "true",
        [`traefik.http.routers.${slug}.rule`]: `PathPrefix(\`/${slug}\`)`,
        [`traefik.http.routers.${slug}.entrypoints`]: "web",
        [`traefik.http.services.${slug}.loadbalancer.server.port`]:
          String(RSERVE_PORT),
        // Strip the prefix so Rserve sees / not /slug
        [`traefik.http.middlewares.${slug}-strip.stripprefix.prefixes`]:
          `/${slug}`,
        [`traefik.http.routers.${slug}.middlewares`]: `${slug}-strip`,
      };

      const container = await this.docker.createContainer({
        Image: image,
        name: containerName,
        Labels: labels,
        ExposedPorts: { [`${RSERVE_PORT}/tcp`]: {} },
        HostConfig: {
          // No published ports — Traefik reaches containers via the shared
          // Docker network. Container port is declared in the Traefik
          // service label above.
          NetworkMode: this.networkName,
        },
      });

      await container.start();
    }
  }

  async stopApp(appId: string): Promise<void> {
    const containers = await this.listManagedContainers(appId);
    for (const info of containers) {
      const container = this.docker.getContainer(info.Id);
      if (info.State === "running") {
        await container.stop();
      }
      await container.remove();
    }
  }

  async restartApp(appId: string): Promise<void> {
    const containers = await this.listManagedContainers(appId);
    for (const info of containers) {
      const container = this.docker.getContainer(info.Id);
      await container.restart();
    }
  }

  async getAppStatus(appId: string): Promise<AppStatus> {
    const containers = await this.listManagedContainers(appId);

    if (containers.length === 0) return "stopped";

    // If any container is in an error state, the app is in error
    const hasError = containers.some(
      (c) => c.State === "exited" || c.State === "dead",
    );
    if (hasError) return "error";

    // If all are running, the app is running
    const allRunning = containers.every((c) => c.State === "running");
    if (allRunning) return "running";

    // If a build is in progress, report building
    if (this.buildLogs.has(appId)) return "building";

    // Otherwise, it's somewhere in between
    return "starting";
  }

  async getContainers(appId: string): Promise<ContainerInfo[]> {
    const containers = await this.listManagedContainers(appId);

    return containers.map((c) => ({
      containerId: c.Id.slice(0, 12),
      status: c.State ?? "unknown",
      healthStatus: parseHealthStatus(c.Status),
      startedAt: c.Created ? new Date(c.Created * 1000) : undefined,
      port: RSERVE_PORT,
    }));
  }

  async streamBuildLogs(
    appId: string,
    onLog: (line: string) => void,
  ): Promise<void> {
    // Replay any existing log lines first
    const existing = this.buildLogs.get(appId);
    if (existing) {
      for (const line of existing) onLog(line);
    }

    // Register listener for new lines
    return new Promise<void>((resolve) => {
      if (!this.buildListeners.has(appId)) {
        this.buildListeners.set(appId, new Set());
      }
      const listeners = this.buildListeners.get(appId)!;
      const listener = (line: string) => {
        onLog(line);
      };
      listeners.add(listener);

      // Clean up when the build finishes (caller should await buildImage
      // separately; this resolves when the build log entry is removed)
      const interval = setInterval(() => {
        if (!this.buildLogs.has(appId)) {
          listeners.delete(listener);
          if (listeners.size === 0) this.buildListeners.delete(appId);
          clearInterval(interval);
          resolve();
        }
      }, 500);
    });
  }

  async cleanup(appId: string): Promise<void> {
    // 1. Remove stopped containers for this app
    const containers = await this.listManagedContainers(appId);
    for (const info of containers) {
      if (info.State !== "running") {
        await this.docker.getContainer(info.Id).remove({ force: true });
      }
    }

    // 2. Remove dangling images for this app
    const images = await this.docker.listImages({
      filters: {
        label: [
          `${MANAGED_LABEL}=${MANAGED_VALUE}`,
          `${APP_ID_LABEL}=${appId}`,
        ],
        dangling: ["true"],
      },
    });
    for (const img of images) {
      await this.docker.getImage(img.Id).remove({ force: true }).catch(() => {
        // Image may be in use — ignore
      });
    }
  }

  /** Remove ALL images (tagged + dangling) for an app. Use on app deletion. */
  async removeImages(appId: string): Promise<number> {
    const images = await this.docker.listImages({
      filters: {
        label: [
          `${MANAGED_LABEL}=${MANAGED_VALUE}`,
          `${APP_ID_LABEL}=${appId}`,
        ],
      },
    });
    let removed = 0;
    for (const img of images) {
      await this.docker.getImage(img.Id).remove({ force: true }).catch(() => {});
      removed++;
    }
    return removed;
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Extract a health status hint from Docker's Status string (e.g. "Up 5m (healthy)") */
function parseHealthStatus(
  status?: string,
): "healthy" | "unhealthy" | "starting" | undefined {
  if (!status) return undefined;
  if (status.includes("healthy")) return "healthy";
  if (status.includes("unhealthy")) return "unhealthy";
  if (status.includes("starting")) return "starting";
  return undefined;
}
