import Fastify, { type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import session from "@fastify/session";
import multipart from "@fastify/multipart";
import serveStatic from "@fastify/static";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { DockerSpawner } from "./spawner/docker-spawner.js";
import { HealthMonitor } from "./spawner/health-monitor.js";
import { appRoutes } from "./routes/apps.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV !== "production";

export interface BuildAppOptions extends FastifyServerOptions {
  /** Override the spawner instance (for testing) */
  spawner?: DockerSpawner;
  /** Override the health monitor instance (for testing) */
  healthMonitor?: HealthMonitor;
}

/**
 * Build and configure the Fastify application.
 * Exported separately from the server start so tests can use `app.inject()`.
 */
export async function buildApp(opts?: BuildAppOptions) {
  const { spawner: customSpawner, healthMonitor: customMonitor, ...fastifyOpts } =
    opts ?? {};

  const app = Fastify(
    Object.keys(fastifyOpts).length > 0
      ? fastifyOpts
      : {
          logger: isDev
            ? {
                transport: {
                  target: "pino-pretty",
                  options: { colorize: true },
                },
              }
            : true,
        },
  );

  // Spawner + Health Monitor (decorated so routes can access them)
  const spawner = customSpawner ?? new DockerSpawner();
  const healthMonitor = customMonitor ?? new HealthMonitor(spawner);
  app.decorate("spawner", spawner);
  app.decorate("healthMonitor", healthMonitor);

  // Plugins
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  });
  await app.register(cookie);
  await app.register(session, {
    secret:
      process.env.SESSION_SECRET || "change-me-to-a-long-random-string!!",
    cookieName: "sessionId",
    cookie: {
      secure: false,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24, // 24 hours
    },
  });
  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50 MB max upload
    },
  });

  // API routes
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(appRoutes, { prefix: "/api/apps" });
  await app.register(healthRoutes, { prefix: "/api/health" });

  // Serve the UI static files in production
  if (process.env.NODE_ENV === "production") {
    const uiDistPath = join(__dirname, "../../ui/dist");
    await app.register(serveStatic, {
      root: uiDistPath,
      prefix: "/",
      wildcard: false,
    });

    // SPA fallback — serve index.html for all non-API routes
    app.setNotFoundHandler((_request, reply) => {
      return reply.sendFile("index.html", uiDistPath);
    });
  }

  // Start health monitoring when the server is ready
  app.addHook("onReady", async () => {
    healthMonitor.start();
  });

  // Stop health monitoring on close
  app.addHook("onClose", async () => {
    healthMonitor.stop();
  });

  return app;
}
