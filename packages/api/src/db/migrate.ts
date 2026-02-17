/**
 * Programmatic migration runner.
 *
 * Uses drizzle-orm's migrate() to apply SQL migrations from the
 * `drizzle/` folder. Called on app startup so the container
 * self-initializes its schema.
 */

import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, client } from "./index.js";

/**
 * Run pending migrations.
 * Resolves the migrations folder relative to the working directory,
 * which is `/app` in Docker (Dockerfile WORKDIR).
 */
export async function runMigrations(): Promise<void> {
  await migrate(db, {
    migrationsFolder: "./packages/api/drizzle",
  });
}

/**
 * Seed the initial admin user if none exists.
 * Uses raw SQL to avoid importing argon2 at the top level
 * (it's already a dependency but keeps this module lightweight).
 */
export async function seedAdminUser(): Promise<void> {
  const existing =
    await client`SELECT id FROM users WHERE role = 'admin' LIMIT 1`;
  if (existing.length > 0) return;

  // Dynamic import so argon2 is only loaded when needed
  const { hash } = await import("argon2");

  const username = process.env.ADMIN_USERNAME || "admin";
  const email = process.env.ADMIN_EMAIL || "admin@localhost";
  const password = process.env.ADMIN_PASSWORD || "admin";
  const passwordHash = await hash(password);

  await client`
    INSERT INTO users (username, email, password_hash, role)
    VALUES (${username}, ${email}, ${passwordHash}, 'admin')
  `;
  console.log(`Created admin user: "${username}"`);
}
