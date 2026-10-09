CREATE TABLE "app"."delivery_events" (
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"environment_id" uuid,
	"sequence" bigint,
	"notification_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "delivery_events_pkey" PRIMARY KEY("environment_id","sequence"),
	CONSTRAINT "delivery_events_sequence_positive" CHECK ("sequence" > 0),
	CONSTRAINT "delivery_events_state_valid" CHECK ("state" IN ('queued', 'sending', 'retry_wait', 'provider_accepted', 'failed', 'expired', 'canceled'))
);
--> statement-breakpoint
ALTER TABLE "app"."delivery_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."event_streams" (
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"environment_id" uuid PRIMARY KEY,
	"sequence" bigint DEFAULT 0 NOT NULL,
	"watermark" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "event_streams_bounds" CHECK ("watermark" >= 0 AND "sequence" >= "watermark")
);
--> statement-breakpoint
ALTER TABLE "app"."event_streams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."delivery_events" ADD CONSTRAINT "delivery_events_Tpb2NlefxDhz_fkey" FOREIGN KEY ("environment_id") REFERENCES "app"."event_streams"("environment_id");--> statement-breakpoint
ALTER TABLE "app"."delivery_events" ADD CONSTRAINT "delivery_events_environment_fk" FOREIGN KEY ("organization_id","project_id","environment_id") REFERENCES "app"."environments"("organization_id","project_id","id");--> statement-breakpoint
ALTER TABLE "app"."event_streams" ADD CONSTRAINT "event_streams_environment_fk" FOREIGN KEY ("organization_id","project_id","environment_id") REFERENCES "app"."environments"("organization_id","project_id","id");--> statement-breakpoint
CREATE POLICY "delivery_events_scope" ON "app"."delivery_events" AS PERMISSIVE FOR ALL TO "pipong_api", "pipong_worker" USING (organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "event_streams_scope" ON "app"."event_streams" AS PERMISSIVE FOR ALL TO "pipong_api", "pipong_worker" USING (organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE app.event_streams FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.delivery_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON app.delivery_events FROM pipong_api, pipong_worker;
--> statement-breakpoint
GRANT DELETE ON app.delivery_events TO pipong_worker;
--> statement-breakpoint
REVOKE DELETE ON app.event_streams FROM pipong_api, pipong_worker;
--> statement-breakpoint
REVOKE UPDATE ON app.event_streams FROM pipong_api;
--> statement-breakpoint
GRANT UPDATE (sequence) ON app.event_streams TO pipong_api;
