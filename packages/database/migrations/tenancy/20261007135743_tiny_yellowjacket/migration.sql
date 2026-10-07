ALTER TABLE "app"."environments" ADD COLUMN "suspended_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "app"."projects" ADD COLUMN "suspended_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "app"."environments" ADD CONSTRAINT "environments_scoped_name_unique" UNIQUE("organization_id","project_id","name");--> statement-breakpoint
ALTER TABLE "app"."projects" ADD CONSTRAINT "projects_scoped_name_unique" UNIQUE("organization_id","name");
--> statement-breakpoint
REVOKE UPDATE ON app.projects, app.environments FROM pipong_api, pipong_worker;
--> statement-breakpoint
GRANT UPDATE (name, suspended_at, updated_at, deleted_at) ON app.projects, app.environments TO pipong_api, pipong_worker;
