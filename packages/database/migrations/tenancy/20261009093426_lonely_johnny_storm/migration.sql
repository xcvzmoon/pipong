CREATE TABLE "app"."deliveries" (
	"id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"credential_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	CONSTRAINT "deliveries_ownership_id_unique" UNIQUE("organization_id","project_id","environment_id","id"),
	CONSTRAINT "deliveries_notification_endpoint_unique" UNIQUE("notification_id","endpoint_id"),
	CONSTRAINT "deliveries_provider_valid" CHECK ("provider" IN ('apns', 'fcm', 'web-push')),
	CONSTRAINT "deliveries_state_valid" CHECK ("state" IN ('queued', 'sending', 'retry_wait', 'provider_accepted', 'failed', 'expired', 'canceled'))
);
--> statement-breakpoint
ALTER TABLE "app"."deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."idempotency_records" (
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"notification_id" uuid NOT NULL,
	"response" jsonb NOT NULL,
	"expires_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "idempotency_records_scope_key_unique" UNIQUE("organization_id","project_id","environment_id","key")
);
--> statement-breakpoint
ALTER TABLE "app"."idempotency_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."notifications" (
	"id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"request" text NOT NULL,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"accepted_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"delivery_count" integer NOT NULL,
	CONSTRAINT "notifications_ownership_id_unique" UNIQUE("organization_id","project_id","environment_id","id"),
	CONSTRAINT "notifications_delivery_count_valid" CHECK ("delivery_count" BETWEEN 1 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "app"."notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."deliveries" ADD CONSTRAINT "deliveries_notification_ownership_fk" FOREIGN KEY ("organization_id","project_id","environment_id","notification_id") REFERENCES "app"."notifications"("organization_id","project_id","environment_id","id");--> statement-breakpoint
ALTER TABLE "app"."deliveries" ADD CONSTRAINT "deliveries_endpoint_ownership_fk" FOREIGN KEY ("organization_id","project_id","environment_id","endpoint_id") REFERENCES "app"."endpoints"("organization_id","project_id","environment_id","id");--> statement-breakpoint
ALTER TABLE "app"."deliveries" ADD CONSTRAINT "deliveries_generation_binding_fk" FOREIGN KEY ("endpoint_id","generation","credential_id") REFERENCES "app"."endpoint_generations"("endpoint_id","generation","credential_id");--> statement-breakpoint
ALTER TABLE "app"."idempotency_records" ADD CONSTRAINT "idempotency_records_notification_ownership_fk" FOREIGN KEY ("organization_id","project_id","environment_id","notification_id") REFERENCES "app"."notifications"("organization_id","project_id","environment_id","id");--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "notifications_environment_ownership_fk" FOREIGN KEY ("organization_id","project_id","environment_id") REFERENCES "app"."environments"("organization_id","project_id","id");--> statement-breakpoint
CREATE POLICY "deliveries_scope" ON "app"."deliveries" AS PERMISSIVE FOR ALL TO "pipong_api", "pipong_worker" USING (
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid
) WITH CHECK (
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid
);--> statement-breakpoint
CREATE POLICY "idempotency_records_scope" ON "app"."idempotency_records" AS PERMISSIVE FOR ALL TO "pipong_api", "pipong_worker" USING (
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid
) WITH CHECK (
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid
);--> statement-breakpoint
CREATE POLICY "notifications_scope" ON "app"."notifications" AS PERMISSIVE FOR ALL TO "pipong_api", "pipong_worker" USING (
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid
) WITH CHECK (
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid
);
--> statement-breakpoint
ALTER TABLE app.notifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.deliveries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.idempotency_records FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON app.notifications, app.deliveries FROM pipong_api, pipong_worker;
--> statement-breakpoint
GRANT UPDATE (state) ON app.deliveries TO pipong_worker;
--> statement-breakpoint
REVOKE INSERT ON app.notifications, app.deliveries, app.idempotency_records FROM pipong_worker;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON app.idempotency_records FROM pipong_api, pipong_worker;
--> statement-breakpoint
GRANT UPDATE (fingerprint, notification_id, response, expires_at) ON app.idempotency_records TO pipong_api;
