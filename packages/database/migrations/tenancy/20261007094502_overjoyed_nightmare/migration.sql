CREATE TABLE "app"."environments" (
	"id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	CONSTRAINT "environments_organization_project_id_unique" UNIQUE("organization_id","project_id","id")
);
--> statement-breakpoint
ALTER TABLE "app"."environments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."projects" (
	"id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	CONSTRAINT "projects_organization_id_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "app"."projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."environments" ADD CONSTRAINT "environments_project_ownership_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "app"."projects"("organization_id","id");--> statement-breakpoint
ALTER TABLE "app"."projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "auth"."organizations"("id");--> statement-breakpoint
CREATE POLICY "environments_scope" ON "app"."environments" AS PERMISSIVE FOR ALL TO "pipong_api", "pipong_worker" USING (

  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid

  AND (
    nullif(current_setting('pipong.project_id', true), '') IS NULL
    OR project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  )
  AND (
    nullif(current_setting('pipong.environment_id', true), '') IS NULL
    OR id = nullif(current_setting('pipong.environment_id', true), '')::uuid
  )
) WITH CHECK (

  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid

  AND (
    nullif(current_setting('pipong.project_id', true), '') IS NULL
    OR project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  )
  AND (
    nullif(current_setting('pipong.environment_id', true), '') IS NULL
    OR id = nullif(current_setting('pipong.environment_id', true), '')::uuid
  )
);--> statement-breakpoint
CREATE POLICY "projects_scope" ON "app"."projects" AS PERMISSIVE FOR ALL TO "pipong_api", "pipong_worker" USING (

  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid

  AND (
    nullif(current_setting('pipong.project_id', true), '') IS NULL
    OR id = nullif(current_setting('pipong.project_id', true), '')::uuid
  )
) WITH CHECK (

  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid

  AND (
    nullif(current_setting('pipong.project_id', true), '') IS NULL
    OR id = nullif(current_setting('pipong.project_id', true), '')::uuid
  )
);
--> statement-breakpoint
ALTER TABLE app.projects FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.environments FORCE ROW LEVEL SECURITY;
