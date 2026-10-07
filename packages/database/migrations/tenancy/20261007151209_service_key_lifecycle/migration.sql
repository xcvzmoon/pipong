CREATE TABLE "auth"."service_key_audits" (
	"id" uuid PRIMARY KEY,
	"key_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"action" text NOT NULL,
	"replacement_key_id" uuid,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."service_key_grants" ADD COLUMN "rotated_at" timestamp(3) with time zone;--> statement-breakpoint
CREATE INDEX "service_key_grants_scope_idx" ON "auth"."service_key_grants" ("organization_id","project_id","environment_id","key_id");--> statement-breakpoint
ALTER TABLE "auth"."service_key_grants" ADD CONSTRAINT "service_key_grants_actions_valid" CHECK (cardinality("actions") BETWEEN 1 AND 9 AND "actions" <@ ARRAY['recipient:read', 'recipient:write', 'endpoint:read', 'endpoint:write', 'notification:read', 'notification:send', 'notification:cancel', 'delivery:read', 'event:read']::text[]);--> statement-breakpoint
REVOKE UPDATE, DELETE ON auth.service_key_grants FROM pipong_api;
--> statement-breakpoint
GRANT UPDATE (rotated_at, updated_at) ON auth.service_key_grants TO pipong_api;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON auth.service_key_audits FROM pipong_api;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON auth.api_keys FROM pipong_api;
--> statement-breakpoint
GRANT UPDATE (enabled, expires_at, updated_at, request_count, remaining, last_request, last_refill_at) ON auth.api_keys TO pipong_api;
