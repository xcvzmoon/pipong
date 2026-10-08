CREATE TABLE "app"."endpoint_generations" (
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"credential_id" uuid NOT NULL,
	"encrypted_target" text NOT NULL,
	"registered_at" timestamp(3) with time zone NOT NULL,
	CONSTRAINT "endpoint_generations_identity_unique" UNIQUE("endpoint_id","generation"),
	CONSTRAINT "endpoint_generations_current_binding_unique" UNIQUE("endpoint_id","generation","credential_id"),
	CONSTRAINT "endpoint_generations_generation_valid" CHECK ("generation" > 0)
);
--> statement-breakpoint
ALTER TABLE "app"."endpoint_generations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."endpoints" (
	"id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"installation_id" text NOT NULL,
	"provider" text NOT NULL,
	"app_id" text NOT NULL,
	"generation" integer NOT NULL,
	"credential_id" uuid NOT NULL,
	"target_hash" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"registered_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "endpoints_ownership_id_unique" UNIQUE("organization_id","project_id","environment_id","id"),
	CONSTRAINT "endpoints_installation_unique" UNIQUE("organization_id","project_id","environment_id","provider","app_id","installation_id"),
	CONSTRAINT "endpoints_generation_valid" CHECK ("generation" > 0),
	CONSTRAINT "endpoints_provider_valid" CHECK ("provider" IN ('apns', 'fcm', 'web-push')),
	CONSTRAINT "endpoints_state_valid" CHECK ("state" IN ('active', 'disabled') AND ("state" = 'disabled') = ("disabled_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "app"."endpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "endpoints_active_target_unique" ON "app"."endpoints" ("organization_id","project_id","environment_id","provider","app_id","target_hash") WHERE "state" = 'active';--> statement-breakpoint
ALTER TABLE "app"."endpoint_generations" ADD CONSTRAINT "endpoint_generations_endpoint_ownership_fk" FOREIGN KEY ("organization_id","project_id","environment_id","endpoint_id") REFERENCES "app"."endpoints"("organization_id","project_id","environment_id","id");--> statement-breakpoint
ALTER TABLE "app"."endpoint_generations" ADD CONSTRAINT "endpoint_generations_credential_ownership_fk" FOREIGN KEY ("organization_id","project_id","environment_id","credential_id") REFERENCES "app"."credential_versions"("organization_id","project_id","environment_id","id");--> statement-breakpoint
ALTER TABLE "app"."endpoints" ADD CONSTRAINT "endpoints_recipient_ownership_fk" FOREIGN KEY ("organization_id","project_id","environment_id","recipient_id") REFERENCES "app"."recipients"("organization_id","project_id","environment_id","id");--> statement-breakpoint
ALTER TABLE "app"."endpoints" ADD CONSTRAINT "endpoints_credential_ownership_fk" FOREIGN KEY ("organization_id","project_id","environment_id","credential_id") REFERENCES "app"."credential_versions"("organization_id","project_id","environment_id","id");--> statement-breakpoint
CREATE POLICY "endpoint_generations_scope" ON "app"."endpoint_generations" AS PERMISSIVE FOR ALL TO "pipong_api", "pipong_worker" USING (
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND (nullif(current_setting('pipong.project_id', true), '') IS NULL
    OR project_id = nullif(current_setting('pipong.project_id', true), '')::uuid)
  AND (nullif(current_setting('pipong.environment_id', true), '') IS NULL
    OR environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid)
) WITH CHECK (
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND (nullif(current_setting('pipong.project_id', true), '') IS NULL
    OR project_id = nullif(current_setting('pipong.project_id', true), '')::uuid)
  AND (nullif(current_setting('pipong.environment_id', true), '') IS NULL
    OR environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid)
);--> statement-breakpoint
CREATE POLICY "endpoints_scope" ON "app"."endpoints" AS PERMISSIVE FOR ALL TO "pipong_api", "pipong_worker" USING (
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND (nullif(current_setting('pipong.project_id', true), '') IS NULL
    OR project_id = nullif(current_setting('pipong.project_id', true), '')::uuid)
  AND (nullif(current_setting('pipong.environment_id', true), '') IS NULL
    OR environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid)
) WITH CHECK (
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND (nullif(current_setting('pipong.project_id', true), '') IS NULL
    OR project_id = nullif(current_setting('pipong.project_id', true), '')::uuid)
  AND (nullif(current_setting('pipong.environment_id', true), '') IS NULL
    OR environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid)
);--> statement-breakpoint
ALTER TABLE app.endpoints FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.endpoint_generations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.endpoints ADD CONSTRAINT endpoints_current_generation_fk
FOREIGN KEY (id, generation, credential_id)
REFERENCES app.endpoint_generations (endpoint_id, generation, credential_id)
DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON app.endpoints FROM pipong_api, pipong_worker;
--> statement-breakpoint
GRANT UPDATE (generation, credential_id, target_hash, state, registered_at, disabled_at) ON app.endpoints TO pipong_api;
--> statement-breakpoint
GRANT UPDATE (state, disabled_at) ON app.endpoints TO pipong_worker;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON app.endpoint_generations FROM pipong_api, pipong_worker;
--> statement-breakpoint
REVOKE INSERT ON app.endpoints, app.endpoint_generations FROM pipong_worker;
