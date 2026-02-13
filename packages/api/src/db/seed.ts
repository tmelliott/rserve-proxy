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
 *   ADMIN_PASSWORD  (default: "admin")
 */

import { hash } from "argon2";
import { client } from "./index.js";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@localhost";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";

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
    const passwordHash = await hash(ADMIN_PASSWORD);

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
