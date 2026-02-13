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
import type {
  ISpawner,
  BuildImageOptions,
  BuildResult,
  StartAppOptions,
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

export class DockerSpawner implements ISpawner {
  private docker: Docker;
  private networkName: string;

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

  async buildImage(options: BuildImageOptions): Promise<BuildResult> {
    // TODO: Generate a Dockerfile dynamically, build the image
    // 1. Create temp build context
    // 2. Write Dockerfile: FROM rserve-base:{rVersion}, install packages, copy code
    // 3. Build image via dockerode
    // 4. Stream and collect build logs
    throw new Error("Not implemented");
  }

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
