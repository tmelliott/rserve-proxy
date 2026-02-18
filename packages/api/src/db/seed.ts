/**
 * Seed script — creates an initial admin user if none exists.
 *
 * Usage:
 *   bun run db:seed            (from root)
 *   tsx src/db/seed.ts          (from packages/api)
 *
 * Environment:
 *   ADMIN_USERNAME  (default: "admin")
 *   ADMIN_EMAIL     (default: "admin@localhost")
 *   ADMIN_PASSWORD  (read from env, or auto-generated and persisted to .env)
 */

import { randomBytes } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hash } from "argon2";
import { client } from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = resolve(__dirname, "../../../../.env");

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@localhost";

async function getAdminPassword(): Promise<string> {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;

  // Generate a random password and persist it to the .env file
  const generated = randomBytes(32).toString("base64url");
  await appendFile(ENV_FILE, `\nADMIN_PASSWORD=${generated}\n`);
  console.log(
    `  ⚠ No ADMIN_PASSWORD set — generated one and saved to .env`,
  );
  console.log(`  ⚠ Admin password: ${generated}`);
  return generated;
}

async function seed() {
  console.log("🌱 Seeding database...");

  // Check if any admin user already exists
  const existing =
    await client`SELECT id, username FROM users WHERE role = 'admin' LIMIT 1`;

  if (existing.length > 0) {
    console.log(
      `  ✓ Admin user already exists: "${existing[0].username}" — skipping.`,
    );
  } else {
    const password = await getAdminPassword();
    const passwordHash = await hash(password);

    const [admin] = await client`
      INSERT INTO users (username, email, password_hash, role)
      VALUES (${ADMIN_USERNAME}, ${ADMIN_EMAIL}, ${passwordHash}, 'admin')
      RETURNING id, username
    `;

    console.log(`  ✓ Created admin user: "${admin.username}" (${admin.id})`);
  }

  console.log("🌱 Seed complete.");
  await client.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
