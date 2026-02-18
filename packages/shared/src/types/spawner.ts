/**
 * Spawner interface — the public contract for the spawner module.
 *
 * This interface defines all operations the manager can perform on Rserve
 * instances. The spawner module implements this interface and manages
 * Docker containers via dockerode.
 *
 * IMPORTANT: This interface must remain independent of the web framework,
 * auth system, and proxy layer. It should be possible to extract the spawner
 * into a standalone service that implements this same interface over RPC/HTTP.
 */

import type { AppConfig, AppStatus, ContainerInfo } from "./app.js";

/** Options for building an app image */
export interface BuildImageOptions {
  appConfig: AppConfig;
  /** Path to uploaded code (if source is "upload") */
  codePath?: string;
}

/** Result of an image build */
export interface BuildResult {
  success: boolean;
  imageName: string;
  imageTag: string;
  buildLog: string[];
  error?: string;
}

/** Options for starting an app */
export interface StartAppOptions {
  appConfig: AppConfig;
  /** Pre-built image to use (if not provided, will build first) */
  imageName?: string;
}

/** The spawner's public interface */
export interface ISpawner {
  /** Build a Docker image for an app */
  buildImage(options: BuildImageOptions): Promise<BuildResult>;

  /** Start an app (builds image if needed, then creates containers) */
  startApp(options: StartAppOptions): Promise<void>;

  /** Stop all containers for an app */
  stopApp(appId: string): Promise<void>;

  /** Restart all containers for an app */
  restartApp(appId: string): Promise<void>;

  /** Get the current status of an app */
  getAppStatus(appId: string): Promise<AppStatus>;

  /** Get container info for all replicas of an app */
  getContainers(appId: string): Promise<ContainerInfo[]>;

  /** Stream build logs for an app */
  streamBuildLogs(
    appId: string,
    onLog: (line: string) => void,
  ): Promise<void>;

  /** Clean up stopped containers and dangling images for an app */
  cleanup(appId: string): Promise<void>;

  /** List available R versions (from local rserve-base image tags) */
  listRVersions(): Promise<string[]>;
}
