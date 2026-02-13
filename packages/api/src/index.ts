import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import serveStatic from "@fastify/static";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { appRoutes } from "./routes/apps.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV !== "production";

const app = Fastify({
  logger: isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }
    : true,
});

// Plugins
await app.register(cors, {
  origin: process.env.CORS_ORIGIN || "http://localhost:5173",
  credentials: true,
});
await app.register(cookie);

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

// Start
const port = parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || "0.0.0.0";

try {
  await app.listen({ port, host });
  app.log.info(`Manager API listening on ${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
