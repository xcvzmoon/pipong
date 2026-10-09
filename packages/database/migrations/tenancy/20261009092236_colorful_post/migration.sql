CREATE TABLE "app"."admission_reservations" (
	"organization_id" uuid,
	"id" uuid,
	"endpoints" integer NOT NULL,
	"remaining" integer NOT NULL,
	CONSTRAINT "admission_reservations_pkey" PRIMARY KEY("organization_id","id"),
	CONSTRAINT "admission_reservations_bounds" CHECK ("endpoints" >= 0 AND "remaining" >= 0 AND "remaining" <= "endpoints")
);
--> statement-breakpoint
ALTER TABLE "app"."admission_reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."key_budgets" (
	"organization_id" uuid,
	"key_id" uuid,
	"window_start" timestamp(3) with time zone NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "key_budgets_pkey" PRIMARY KEY("organization_id","key_id"),
	CONSTRAINT "key_budgets_nonnegative_usage" CHECK ("requests" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."key_budgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."tenant_budgets" (
	"organization_id" uuid PRIMARY KEY,
	"request_limit" integer DEFAULT 120 NOT NULL,
	"key_request_limit" integer DEFAULT 60 NOT NULL,
	"fanout_limit" integer DEFAULT 1000 NOT NULL,
	"pending_limit" integer DEFAULT 10000 NOT NULL,
	"window_seconds" integer DEFAULT 60 NOT NULL,
	"window_start" timestamp(3) with time zone DEFAULT clock_timestamp() NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"fanout" integer DEFAULT 0 NOT NULL,
	"pending" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tenant_budgets_positive_limits" CHECK ("request_limit" > 0 AND "key_request_limit" > 0 AND "fanout_limit" > 0 AND "pending_limit" > 0 AND "window_seconds" > 0),
	CONSTRAINT "tenant_budgets_nonnegative_usage" CHECK ("requests" >= 0 AND "fanout" >= 0 AND "pending" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."tenant_budgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."admission_reservations" ADD CONSTRAINT "admission_reservations_icX6eu1K1Lyn_fkey" FOREIGN KEY ("organization_id") REFERENCES "app"."tenant_budgets"("organization_id");--> statement-breakpoint
ALTER TABLE "app"."key_budgets" ADD CONSTRAINT "key_budgets_organization_id_tenant_budgets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "app"."tenant_budgets"("organization_id");--> statement-breakpoint
ALTER TABLE "app"."tenant_budgets" ADD CONSTRAINT "tenant_budgets_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "auth"."organizations"("id");--> statement-breakpoint
CREATE POLICY "admission_reservations_scope" ON "app"."admission_reservations" AS PERMISSIVE FOR ALL TO "pipong_api", "pipong_worker" USING (organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "key_budgets_scope" ON "app"."key_budgets" AS PERMISSIVE FOR ALL TO "pipong_api", "pipong_worker" USING (organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_budgets_scope" ON "app"."tenant_budgets" AS PERMISSIVE FOR ALL TO "pipong_api", "pipong_worker" USING (organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE app.tenant_budgets FORCE ROW LEVEL SECURITY;
ALTER TABLE app.key_budgets FORCE ROW LEVEL SECURITY;
ALTER TABLE app.admission_reservations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON app.tenant_budgets, app.key_budgets, app.admission_reservations FROM pipong_api, pipong_worker;
GRANT INSERT (organization_id) ON app.tenant_budgets TO pipong_api;
GRANT UPDATE (window_start, requests, fanout, pending) ON app.tenant_budgets TO pipong_api;
GRANT UPDATE (pending) ON app.tenant_budgets TO pipong_worker;
GRANT INSERT ON app.key_budgets, app.admission_reservations TO pipong_api;
GRANT UPDATE (window_start, requests) ON app.key_budgets TO pipong_api;
GRANT UPDATE (remaining) ON app.admission_reservations TO pipong_worker;
