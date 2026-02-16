import "fastify";
import type { DockerSpawner } from "../spawner/docker-spawner.js";
import type { HealthMonitor } from "../spawner/health-monitor.js";
import type { MetricsCollector } from "../metrics/metrics-collector.js";

declare module "fastify" {
  interface Session {
    userId?: string;
    role?: "admin" | "user";
  }

  interface FastifyInstance {
    spawner: DockerSpawner;
    healthMonitor: HealthMonitor;
    metricsCollector: MetricsCollector;
  }
}
