CREATE TABLE "app_status_points" (
	"id" serial PRIMARY KEY NOT NULL,
	"app_id" uuid NOT NULL,
	"status" text NOT NULL,
	"collected_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_status_points" ADD CONSTRAINT "app_status_points_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_status_app_collected_idx" ON "app_status_points" USING btree ("app_id","collected_at");