import {
  pgTable,
  text,
  timestamp,
  integer,
  json,
  uuid,
  serial,
  real,
  bigint,
  index,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "user"] })
    .notNull()
    .default("user"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const apiTokens = pgTable("api_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  tokenPrefix: text("token_prefix").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at"),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const apps = pgTable("apps", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  rVersion: text("r_version").notNull().default("4.4.1"),
  packages: json("packages").$type<string[]>().notNull().default([]),
  codeSource: json("code_source")
    .$type<{ type: "git"; repoUrl: string; branch?: string } | { type: "upload" }>()
    .notNull(),
  entryScript: text("entry_script").notNull().default("run_rserve.R"),
  replicas: integer("replicas").notNull().default(1),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Metrics persistence (Phase 7 — high-resolution time-series)
// ---------------------------------------------------------------------------

export const appMetricsPoints = pgTable(
  "app_metrics_points",
  {
    id: serial("id").primaryKey(),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    cpuPercent: real("cpu_percent").notNull(),
    memoryMB: real("memory_mb").notNull(),
    memoryLimitMB: real("memory_limit_mb").notNull(),
    networkRxBytes: bigint("network_rx_bytes", { mode: "number" }).notNull(),
    networkTxBytes: bigint("network_tx_bytes", { mode: "number" }).notNull(),
    requestsPerMin: real("requests_per_min"),
    containers: integer("containers").notNull(),
    collectedAt: timestamp("collected_at").notNull(),
  },
  (table) => [
    index("app_metrics_collected_at_idx").on(table.collectedAt),
    index("app_metrics_app_collected_idx").on(table.appId, table.collectedAt),
  ],
);

export const systemMetricsPoints = pgTable(
  "system_metrics_points",
  {
    id: serial("id").primaryKey(),
    cpuPercent: real("cpu_percent").notNull(),
    memoryMB: real("memory_mb").notNull(),
    memoryLimitMB: real("memory_limit_mb").notNull(),
    networkRxBytes: bigint("network_rx_bytes", { mode: "number" }).notNull(),
    networkTxBytes: bigint("network_tx_bytes", { mode: "number" }).notNull(),
    requestsPerMin: real("requests_per_min"),
    activeContainers: integer("active_containers").notNull(),
    activeApps: integer("active_apps").notNull(),
    collectedAt: timestamp("collected_at").notNull(),
  },
  (table) => [
    index("system_metrics_collected_at_idx").on(table.collectedAt),
  ],
);
