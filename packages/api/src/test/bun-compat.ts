/**
 * Bun compatibility patch for Fastify 5 tests.
 *
 * Bun's http.ServerResponse.end() does not set `writableEnded = true`,
 * but Fastify 5 relies on `reply.raw.writableEnded` for `reply.sent`.
 * Without this patch, Fastify's hook runner and wrapThenable see
 * `reply.sent === false` after a response is fully written, causing
 * double-send errors ("Cannot writeHead headers after they are sent").
 *
 * This must be loaded before any Fastify imports (via bunfig.toml preload).
 */
import http from "node:http";

const origEnd = http.ServerResponse.prototype.end;

http.ServerResponse.prototype.end = function (
  this: http.ServerResponse,
  ...args: unknown[]
) {
  const result = (origEnd as Function).apply(this, args);
  Object.defineProperty(this, "writableEnded", {
    value: true,
    writable: true,
    configurable: true,
  });
  return result;
} as typeof origEnd;
