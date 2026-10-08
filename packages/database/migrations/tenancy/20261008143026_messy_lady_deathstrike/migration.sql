CREATE TABLE "app"."credential_versions" (
	"id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"app_id" text NOT NULL,
	"public_key" text,
	"encrypted_secret" text NOT NULL,
	"state" text DEFAULT 'inactive' NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp(3) with time zone,
	CONSTRAINT "credential_versions_ownership_id_unique" UNIQUE("organization_id","project_id","environment_id","id"),
	CONSTRAINT "credential_versions_provider_valid" CHECK ("provider" IN ('apns', 'fcm', 'web-push')),
	CONSTRAINT "credential_versions_state_valid" CHECK ("state" IN ('inactive', 'active', 'retired') AND ("state" = 'retired') = ("retired_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "app"."credential_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "credential_versions_active_binding_unique" ON "app"."credential_versions" ("organization_id","project_id","environment_id","provider","app_id") WHERE "state" = 'active';--> statement-breakpoint
ALTER TABLE "app"."credential_versions" ADD CONSTRAINT "credential_versions_environment_ownership_fk" FOREIGN KEY ("organization_id","project_id","environment_id") REFERENCES "app"."environments"("organization_id","project_id","id");--> statement-breakpoint
CREATE POLICY "credential_versions_scope" ON "app"."credential_versions" AS PERMISSIVE FOR ALL TO "pipong_api", "pipong_worker" USING (
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
);
--> statement-breakpoint
ALTER TABLE app.credential_versions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON app.credential_versions FROM pipong_api, pipong_worker;
--> statement-breakpoint
GRANT UPDATE (encrypted_secret, state, retired_at) ON app.credential_versions TO pipong_api;
--> statement-breakpoint
CREATE FUNCTION app.guard_credential_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'retired' AND (NEW.state <> 'retired' OR NEW.retired_at IS DISTINCT FROM OLD.retired_at) THEN
    RAISE EXCEPTION 'CREDENTIAL_RETIRED';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER credential_versions_lifecycle BEFORE UPDATE ON app.credential_versions
FOR EACH ROW EXECUTE FUNCTION app.guard_credential_version();
