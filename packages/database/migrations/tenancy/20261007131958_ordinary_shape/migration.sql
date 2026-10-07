CREATE TABLE "auth"."service_key_grants" (
	"key_id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"actions" text[] NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone
);
--> statement-breakpoint
ALTER TABLE "auth"."service_key_grants" ADD CONSTRAINT "service_key_grants_key_ownership_fk" FOREIGN KEY ("organization_id","key_id") REFERENCES "auth"."api_keys"("reference_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth"."service_key_grants" ADD CONSTRAINT "service_key_grants_environment_ownership_fk" FOREIGN KEY ("organization_id","project_id","environment_id") REFERENCES "app"."environments"("organization_id","project_id","id");