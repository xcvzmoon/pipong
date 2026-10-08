CREATE TABLE "app"."recipients" (
	"id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	CONSTRAINT "recipients_scoped_external_id_unique" UNIQUE("organization_id","project_id","environment_id","external_id"),
	CONSTRAINT "recipients_ownership_id_unique" UNIQUE("organization_id","project_id","environment_id","id"),
	CONSTRAINT "recipients_external_id_valid" CHECK (char_length("external_id") BETWEEN 1 AND 200 AND "external_id" !~ '[[:cntrl:]]' AND "external_id" ~ '[^[:space:]]')
);
--> statement-breakpoint
ALTER TABLE "app"."recipients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."recipients" ADD CONSTRAINT "recipients_environment_ownership_fk" FOREIGN KEY ("organization_id","project_id","environment_id") REFERENCES "app"."environments"("organization_id","project_id","id");--> statement-breakpoint
CREATE POLICY "recipients_scope" ON "app"."recipients" AS PERMISSIVE FOR ALL TO "pipong_api", "pipong_worker" USING (
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND (
    nullif(current_setting('pipong.project_id', true), '') IS NULL
    OR project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  )
  AND (
    nullif(current_setting('pipong.environment_id', true), '') IS NULL
    OR environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid
  )
) WITH CHECK (
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND (
    nullif(current_setting('pipong.project_id', true), '') IS NULL
    OR project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  )
  AND (
    nullif(current_setting('pipong.environment_id', true), '') IS NULL
    OR environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid
  )
);
--> statement-breakpoint
ALTER TABLE app.recipients FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON app.recipients FROM pipong_api, pipong_worker;
--> statement-breakpoint
GRANT UPDATE (updated_at, deleted_at) ON app.recipients TO pipong_api, pipong_worker;
