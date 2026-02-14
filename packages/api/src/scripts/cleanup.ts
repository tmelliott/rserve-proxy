#!/usr/bin/env tsx
/**
 * Cleanup script — removes all rserve-proxy managed containers and images.
 *
 * Usage: bun run docker:cleanup
 */

import { DockerSpawner } from "../spawner/docker-spawner.js";

async function main() {
  console.log("🧹 Cleaning up rserve-proxy resources...");

  const spawner = new DockerSpawner();
  const result = await spawner.cleanupAll();

  console.log(`  ✓ Removed ${result.containers} container(s)`);
  console.log(`  ✓ Removed ${result.images} image(s)`);
  console.log("🧹 Cleanup complete.");
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
