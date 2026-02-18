/**
 * Programmatic migration runner.
 *
 * Uses drizzle-orm's migrate() to apply SQL migrations from the
 * `drizzle/` folder. Called on app startup so the container
 * self-initializes its schema.
 */

import { randomBytes } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, client } from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Run pending migrations.
 * Resolves the migrations folder relative to this file so it works
 * both in Docker (WORKDIR /app) and local dev (tsx watch).
 */
export async function runMigrations(): Promise<void> {
  await migrate(db, {
    migrationsFolder: resolve(__dirname, "../../drizzle"),
  });
}

const ENV_FILE = resolve(__dirname, "../../.env");

/**
 * Seed the initial admin user if none exists.
 * If ADMIN_PASSWORD is not set, generates a random one and persists to .env.
 */
export async function seedAdminUser(): Promise<void> {
  const existing =
    await client`SELECT id FROM users WHERE role = 'admin' LIMIT 1`;
  if (existing.length > 0) return;

  // Dynamic import so argon2 is only loaded when needed
  const { hash } = await import("argon2");

  const username = process.env.ADMIN_USERNAME || "admin";
  const email = process.env.ADMIN_EMAIL || "admin@localhost";

  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = randomBytes(32).toString("base64url");
    try {
      await appendFile(ENV_FILE, `\nADMIN_PASSWORD=${password}\n`);
    } catch {
      // In Docker the .env may not be writable — that's fine
    }
    console.log(`No ADMIN_PASSWORD set — generated one: ${password}`);
  }

  const passwordHash = await hash(password);

  await client`
    INSERT INTO users (username, email, password_hash, role)
    VALUES (${username}, ${email}, ${passwordHash}, 'admin')
  `;
  console.log(`Created admin user: "${username}"`);
}
