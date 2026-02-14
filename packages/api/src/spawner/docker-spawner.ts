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
  // Lifecycle (stubs — Phase 2c)
  // -----------------------------------------------------------------------

  async startApp(options: StartAppOptions): Promise<void> {
    // TODO: Build image if needed, then create + start container(s)
    // 1. Build image (or use provided imageName)
    // 2. For each replica: create container with Traefik labels
    // 3. Connect to Docker network
    // 4. Start container
    throw new Error("Not implemented");
  }

  async stopApp(appId: string): Promise<void> {
    // TODO: Stop and remove all containers for this app
    throw new Error("Not implemented");
  }

  async restartApp(appId: string): Promise<void> {
    // TODO: Stop then start all containers
    throw new Error("Not implemented");
  }

  async getAppStatus(appId: string): Promise<AppStatus> {
    // TODO: Query Docker for container state, derive app status
    throw new Error("Not implemented");
  }

  async getContainers(appId: string): Promise<ContainerInfo[]> {
    // TODO: List containers with label filter for this app
    throw new Error("Not implemented");
  }

  async streamBuildLogs(
    appId: string,
    onLog: (line: string) => void,
  ): Promise<void> {
    // TODO: Stream build output in real time
    throw new Error("Not implemented");
  }

  async cleanup(appId: string): Promise<void> {
    // TODO: Remove stopped containers and dangling images
    throw new Error("Not implemented");
  }
}
