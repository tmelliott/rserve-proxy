import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString =
  process.env.DATABASE_URL || "postgres://rserve:rserve@localhost:5432/rserve";

const client = postgres(connectionString);

export const db = drizzle(client, { schema });
