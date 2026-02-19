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
import { MetricsCollector } from "./metrics/metrics-collector.js";
import { DrizzleMetricsDb } from "./metrics/drizzle-metrics-db.js";
import { appRoutes } from "./routes/apps.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { metricsRoutes, statusRoutes, appStatusHistoryRoutes } from "./routes/metrics.js";
import { db } from "./db/index.js";
import { apps } from "./db/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV !== "production";

export interface BuildAppOptions extends FastifyServerOptions {
  /** Override the spawner instance (for testing) */
  spawner?: DockerSpawner;
  /** Override the health monitor instance (for testing) */
  healthMonitor?: HealthMonitor;
  /** Override the metrics collector instance (for testing) */
  metricsCollector?: MetricsCollector;
}

/**
 * Build and configure the Fastify application.
 * Exported separately from the server start so tests can use `app.inject()`.
 */
export async function buildApp(opts?: BuildAppOptions) {
  const {
    spawner: customSpawner,
    healthMonitor: customMonitor,
    metricsCollector: customMetrics,
    ...fastifyOpts
  } = opts ?? {};

  const app = Fastify(
    Object.keys(fastifyOpts).length > 0
      ? fastifyOpts
      : {
          // Trust X-Forwarded-* headers from Traefik (TLS termination proxy).
          // Required so request.protocol reflects the real client protocol,
          // which @fastify/session checks before saving secure cookies.
          trustProxy: !isDev,
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
          // Generate unique request IDs for tracing.
          // Accept client-provided x-request-id only if it's a safe format
          // (alphanumeric/dashes, max 64 chars — e.g. UUID from Traefik).
          genReqId: (req) => {
            const clientId = req.headers["x-request-id"];
            if (typeof clientId === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(clientId)) {
              return clientId;
            }
            return crypto.randomUUID();
          },
        },
  );

  // Spawner + Health Monitor + Metrics Collector (decorated so routes can access them)
  const spawner = customSpawner ?? new DockerSpawner();
  const healthMonitor = customMonitor ?? new HealthMonitor(spawner);
  const traefikUrl = process.env.TRAEFIK_METRICS_URL || "http://traefik:8082/metrics";
  const metricsDb = process.env.NODE_ENV === "test" ? undefined : new DrizzleMetricsDb(db);
  const metricsCollector = customMetrics ?? new MetricsCollector(spawner, healthMonitor, {
    traefikUrl: process.env.NODE_ENV === "test" ? undefined : traefikUrl,
    metricsDb,
  });
  app.decorate("spawner", spawner);
  app.decorate("healthMonitor", healthMonitor);
  app.decorate("metricsCollector", metricsCollector);

  // ---------------------------------------------------------------------------
  // Plugins
  // ---------------------------------------------------------------------------

  // CORS — in production, require an explicit origin whitelist.
  // `origin: true` (reflect any origin) with credentials is unsafe.
  const corsOrigin = isDev
    ? process.env.CORS_ORIGIN || "http://localhost:5173"
    : process.env.CORS_ORIGIN || false; // false = no CORS (same-origin only)

  if (!isDev && !process.env.CORS_ORIGIN) {
    console.warn(
      "CORS_ORIGIN not set in production — cross-origin requests will be blocked. " +
        "Set CORS_ORIGIN to your domain (e.g. https://example.com) if needed.",
    );
  }

  await app.register(cors, {
    origin: corsOrigin,
    credentials: true,
  });

  await app.register(cookie);

  const sessionSecret = process.env.SESSION_SECRET
    || (process.env.NODE_ENV === "test" ? "test-secret-that-is-at-least-32-characters-long!!" : undefined);
  if (!sessionSecret) {
    throw new Error(
      "SESSION_SECRET is required. Generate one with: openssl rand -base64 48",
    );
  }

  await app.register(session, {
    secret: sessionSecret,
    cookieName: "sessionId",
    cookie: {
      // Secure cookies in production by default (requires HTTPS).
      // Override with COOKIE_SECURE=false if running behind a non-TLS reverse proxy.
      secure: process.env.COOKIE_SECURE !== undefined
        ? process.env.COOKIE_SECURE === "true"
        : !isDev,
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

  // Global rate limiting — 100 req/min per IP for all routes.
  // Auth routes override with stricter limits (10/min for login).
  // Skipped in test mode — inject() shares 127.0.0.1 across all tests.
  if (process.env.NODE_ENV !== "test") {
    await app.register(rateLimit, {
      max: 100,
      timeWindow: "1 minute",
    });
  }

  // ---------------------------------------------------------------------------
  // Global error handler — normalise error responses
  // ---------------------------------------------------------------------------
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    // Validation errors from Typebox schemas (Fastify AJV)
    if (error.validation) {
      const details = error.validation.map((v) => ({
        field: v.instancePath || (v.params as Record<string, string>)?.missingProperty || "body",
        message: v.message ?? "Invalid value",
      }));
      reply.status(400).send({ error: "Validation failed", details });
      return;
    }

    // Rate limit errors
    if (error.statusCode === 429) {
      reply.status(429).send({
        error: "Too many requests. Please try again later.",
      });
      return;
    }

    // Known HTTP errors (4xx)
    if (error.statusCode && error.statusCode < 500) {
      reply.status(error.statusCode).send({
        error: error.message,
      });
      return;
    }

    // Unexpected errors — log full details, return generic message
    reply.status(error.statusCode ?? 500).send({
      error: isDev ? error.message : "Internal server error",
    });
  });

  // ---------------------------------------------------------------------------
  // API routes
  // ---------------------------------------------------------------------------
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(appRoutes, { prefix: "/api/apps" });
  await app.register(healthRoutes, { prefix: "/api/health" });
  await app.register(metricsRoutes, { prefix: "/api/metrics" });
  await app.register(statusRoutes, { prefix: "/api/status" });
  await app.register(appStatusHistoryRoutes, { prefix: "/api/apps" });

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

  // Start health monitoring and metrics collection when the server is ready
  app.addHook("onReady", async () => {
    // Populate slug → appId mapping for Traefik metrics resolution
    try {
      const rows = await db
        .select({ id: apps.id, slug: apps.slug, name: apps.name })
        .from(apps);
      for (const row of rows) {
        metricsCollector.setAppSlug(row.id, row.slug);
        metricsCollector.setAppName(row.id, row.name);
      }
    } catch {
      // DB may not be available (e.g. tests without real DB)
    }

    healthMonitor.start();
    metricsCollector.start();
  });

  // Stop health monitoring and metrics collection on close
  app.addHook("onClose", async () => {
    healthMonitor.stop();
    metricsCollector.stop();
  });

  return app;
}
