import Fastify, { type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import session from "@fastify/session";
import serveStatic from "@fastify/static";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { appRoutes } from "./routes/apps.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV !== "production";

/**
 * Build and configure the Fastify application.
 * Exported separately from the server start so tests can use `app.inject()`.
 */
export async function buildApp(opts?: FastifyServerOptions) {
  const app = Fastify(
    opts ?? {
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

  return app;
}
