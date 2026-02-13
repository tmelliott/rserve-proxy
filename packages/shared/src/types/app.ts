/** Source of R code for an app */
export type AppCodeSource =
  | { type: "git"; repoUrl: string; branch?: string }
  | { type: "upload" };

/** App configuration as stored in the database */
export interface AppConfig {
  id: string;
  name: string;
  /** URL-safe slug used for routing, e.g., "app1" -> /app1 */
  slug: string;
  /** R version to use (e.g., "4.4.1") */
  rVersion: string;
  /** R packages to install */
  packages: string[];
  /** Source of the R code */
  codeSource: AppCodeSource;
  /** Name of the entry script (e.g., "run_rserve.R") */
  entryScript: string;
  /** Number of container replicas */
  replicas: number;
  /** Owner user ID */
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** App status as reported by the spawner */
export type AppStatus =
  | "building"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "error";

/** App with its current runtime status */
export interface AppWithStatus extends AppConfig {
  status: AppStatus;
  /** Per-replica container info */
  containers: ContainerInfo[];
  /** Error message if status is "error" */
  error?: string;
}

/** Info about a single running container */
export interface ContainerInfo {
  containerId: string;
  status: string;
  healthStatus?: "healthy" | "unhealthy" | "starting";
  startedAt?: Date;
  port: number;
}
