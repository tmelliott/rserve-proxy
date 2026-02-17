CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "app_metrics_points" (
	"id" serial PRIMARY KEY NOT NULL,
	"app_id" uuid NOT NULL,
	"cpu_percent" real NOT NULL,
	"memory_mb" real NOT NULL,
	"memory_limit_mb" real NOT NULL,
	"network_rx_bytes" bigint NOT NULL,
	"network_tx_bytes" bigint NOT NULL,
	"requests_per_min" real,
	"containers" integer NOT NULL,
	"collected_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"r_version" text DEFAULT '4.4.1' NOT NULL,
	"packages" json DEFAULT '[]'::json NOT NULL,
	"code_source" json NOT NULL,
	"entry_script" text DEFAULT 'run_rserve.R' NOT NULL,
	"replicas" integer DEFAULT 1 NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "apps_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "system_metrics_points" (
	"id" serial PRIMARY KEY NOT NULL,
	"cpu_percent" real NOT NULL,
	"memory_mb" real NOT NULL,
	"memory_limit_mb" real NOT NULL,
	"network_rx_bytes" bigint NOT NULL,
	"network_tx_bytes" bigint NOT NULL,
	"requests_per_min" real,
	"active_containers" integer NOT NULL,
	"active_apps" integer NOT NULL,
	"collected_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_metrics_points" ADD CONSTRAINT "app_metrics_points_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_metrics_collected_at_idx" ON "app_metrics_points" USING btree ("collected_at");--> statement-breakpoint
CREATE INDEX "app_metrics_app_collected_idx" ON "app_metrics_points" USING btree ("app_id","collected_at");--> statement-breakpoint
CREATE INDEX "system_metrics_collected_at_idx" ON "system_metrics_points" USING btree ("collected_at");