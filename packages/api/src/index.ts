import { buildApp } from "./app.js";

const app = await buildApp();

const port = parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || "0.0.0.0";

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function shutdown(signal: string) {
  app.log.info(`Received ${signal} — shutting down gracefully`);

  // Set a hard timeout in case graceful shutdown hangs
  const timer = setTimeout(() => {
    app.log.error("Graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  timer.unref();

  try {
    // app.close() stops the health monitor (onClose hook),
    // stops accepting new connections, and drains in-flight requests.
    await app.close();
    app.log.info("Shutdown complete");
    process.exit(0);
  } catch (err) {
    app.log.error(err, "Error during shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

try {
  await app.listen({ port, host });
  app.log.info(`Manager API listening on ${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
