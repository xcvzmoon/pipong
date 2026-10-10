CREATE TABLE "app"."delivery_redrives" (
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"source_delivery_id" uuid NOT NULL CONSTRAINT "delivery_redrives_source_unique" UNIQUE,
	"delivery_id" uuid NOT NULL CONSTRAINT "delivery_redrives_delivery_unique" UNIQUE,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_redrives_reason_valid" CHECK (length("reason") BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "app"."delivery_redrives" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."delivery_redrives" ADD CONSTRAINT "delivery_redrives_source_ownership_fk" FOREIGN KEY ("organization_id","project_id","environment_id","source_delivery_id") REFERENCES "app"."deliveries"("organization_id","project_id","environment_id","id");--> statement-breakpoint
ALTER TABLE "app"."delivery_redrives" ADD CONSTRAINT "delivery_redrives_delivery_ownership_fk" FOREIGN KEY ("organization_id","project_id","environment_id","delivery_id") REFERENCES "app"."deliveries"("organization_id","project_id","environment_id","id");--> statement-breakpoint
CREATE POLICY "delivery_redrives_scope" ON "app"."delivery_redrives" AS PERMISSIVE FOR ALL TO "pipong_api" USING (
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid
) WITH CHECK (
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid
);
--> statement-breakpoint
ALTER TABLE app.delivery_redrives FORCE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON app.delivery_redrives FROM pipong_api, pipong_worker;
GRANT INSERT ON app.delivery_redrives TO pipong_api;
GRANT UPDATE (state) ON app.deliveries TO pipong_api;
--> statement-breakpoint
GRANT UPDATE (remaining) ON app.admission_reservations TO pipong_api;
