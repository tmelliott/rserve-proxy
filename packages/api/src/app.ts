import Fastify, { type FastifyServerOptions, type FastifyError } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import session from "@fastify/session";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
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
  const {
    spawner: customSpawner,
    healthMonitor: customMonitor,
    ...fastifyOpts
  } = opts ?? {};

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
            : {
                // Production: structured JSON logging with redaction
                redact: ["req.headers.authorization", "req.headers.cookie"],
              },
          // Generate unique request IDs for tracing
          genReqId: (req) =>
            req.headers["x-request-id"] as string || crypto.randomUUID(),
        },
  );

  // Spawner + Health Monitor (decorated so routes can access them)
  const spawner = customSpawner ?? new DockerSpawner();
  const healthMonitor = customMonitor ?? new HealthMonitor(spawner);
  app.decorate("spawner", spawner);
  app.decorate("healthMonitor", healthMonitor);

  // ---------------------------------------------------------------------------
  // Plugins
  // ---------------------------------------------------------------------------

  // CORS — in production, only allow same origin (or explicit CORS_ORIGIN)
  await app.register(cors, {
    origin: isDev
      ? process.env.CORS_ORIGIN || "http://localhost:5173"
      : process.env.CORS_ORIGIN || true, // true = reflect request origin (same-origin only with credentials)
    credentials: true,
  });

  await app.register(cookie);

  await app.register(session, {
    secret:
      process.env.SESSION_SECRET || "change-me-to-a-long-random-string!!",
    cookieName: "sessionId",
    cookie: {
      // Secure cookies require HTTPS. Set COOKIE_SECURE=true when HTTPS is enabled.
      // Defaults to false to avoid issues when running behind a non-TLS reverse proxy.
      secure: process.env.COOKIE_SECURE === "true",
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

  // Rate limiting on auth routes (prevent brute force).
  // Skipped in test mode — inject() shares 127.0.0.1 across all tests.
  if (process.env.NODE_ENV !== "test") {
    await app.register(rateLimit, {
      global: false, // Don't rate-limit all routes — only auth
    });
  }

  // ---------------------------------------------------------------------------
  // Global error handler — normalise error responses
  // ---------------------------------------------------------------------------
  app.setErrorHandler((error: FastifyError, request, reply) => {
    // Validation errors from Typebox schemas (Fastify AJV)
    if (error.validation) {
      const details = error.validation.map((v) => ({
        field: v.instancePath || (v.params as Record<string, string>)?.missingProperty || "body",
        message: v.message ?? "Invalid value",
      }));
      return reply.status(400).send({ error: "Validation failed", details });
    }

    // Rate limit errors
    if (error.statusCode === 429) {
      return reply.status(429).send({
        error: "Too many requests. Please try again later.",
      });
    }

    // Known HTTP errors (4xx)
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({
        error: error.message,
      });
    }

    // Unexpected errors — log full details, return generic message
    request.log.error(error, "Unhandled error");
    return reply.status(error.statusCode ?? 500).send({
      error: isDev ? error.message : "Internal server error",
      ...(isDev && { stack: error.stack }),
    });
  });

  // ---------------------------------------------------------------------------
  // API routes
  // ---------------------------------------------------------------------------
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(appRoutes, { prefix: "/api/apps" });
  await app.register(healthRoutes, { prefix: "/api/health" });

  // ---------------------------------------------------------------------------
  // Static files (production)
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Lifecycle hooks
  // ---------------------------------------------------------------------------

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
