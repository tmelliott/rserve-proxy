/**
 * Spawner Module
 *
 * Self-contained module responsible for all Rserve container lifecycle
 * operations. Communicates with Docker via dockerode.
 *
 * IMPORTANT: This module must NOT import from or depend on:
 * - The web framework (Fastify, routes, plugins)
 * - The auth system (sessions, tokens)
 * - The proxy layer (Traefik config)
 *
 * All communication with this module goes through the ISpawner interface.
 * The manager calls the spawner; the spawner never calls back into the manager.
 *
 * See README.md "Spawner Module" section for the full design rationale.
 */

export { DockerSpawner } from "./docker-spawner.js";
export type { ISpawner } from "@rserve-proxy/shared";
