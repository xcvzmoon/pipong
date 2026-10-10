CREATE TABLE "app"."delivery_attempts" (
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"job_id" uuid NOT NULL,
	"retry_count" integer NOT NULL,
	"started_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp(3) with time zone,
	"outcome" text,
	"code" text,
	CONSTRAINT "delivery_attempts_delivery_generation_unique" UNIQUE("delivery_id","generation"),
	CONSTRAINT "delivery_attempts_claim_unique" UNIQUE("job_id","retry_count"),
	CONSTRAINT "delivery_attempts_generation_valid" CHECK ("generation" > 0 AND "retry_count" >= 0),
	CONSTRAINT "delivery_attempts_outcome_valid" CHECK ("outcome" IS NULL OR "outcome" IN ('accepted', 'permanent', 'transient', 'ambiguous')),
	CONSTRAINT "delivery_attempts_result_valid" CHECK (("finished_at" IS NULL) = ("outcome" IS NULL) AND ("finished_at" IS NULL) = ("code" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "app"."delivery_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."deliveries" ADD COLUMN "attempt_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD COLUMN "canceled_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "app"."delivery_attempts" ADD CONSTRAINT "delivery_attempts_delivery_ownership_fk" FOREIGN KEY ("organization_id","project_id","environment_id","delivery_id") REFERENCES "app"."deliveries"("organization_id","project_id","environment_id","id");--> statement-breakpoint
ALTER TABLE "app"."deliveries" ADD CONSTRAINT "deliveries_attempt_generation_valid" CHECK ("attempt_generation" >= 0);--> statement-breakpoint
CREATE POLICY "credential_versions_worker_lock" ON "app"."credential_versions" AS PERMISSIVE FOR SELECT TO "pipong_migrator" USING (
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND (nullif(current_setting('pipong.project_id', true), '') IS NULL
    OR project_id = nullif(current_setting('pipong.project_id', true), '')::uuid)
  AND (nullif(current_setting('pipong.environment_id', true), '') IS NULL
    OR environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid)
);--> statement-breakpoint
CREATE POLICY "delivery_attempts_scope" ON "app"."delivery_attempts" AS PERMISSIVE FOR ALL TO "pipong_worker" USING (
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid
) WITH CHECK (
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid
);
--> statement-breakpoint
ALTER TABLE app.delivery_attempts FORCE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON app.delivery_attempts FROM pipong_api, pipong_worker;
GRANT INSERT ON app.delivery_attempts TO pipong_worker;
GRANT UPDATE (finished_at, outcome, code) ON app.delivery_attempts TO pipong_worker;
GRANT UPDATE (attempt_generation) ON app.deliveries TO pipong_worker;
--> statement-breakpoint
CREATE FUNCTION app.lock_delivery_organization(organization_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE enabled boolean;
BEGIN
  IF organization_id IS DISTINCT FROM nullif(current_setting('pipong.organization_id', true), '')::uuid THEN
    RAISE EXCEPTION 'DELIVERY_SCOPE_INVALID' USING ERRCODE = '42501';
  END IF;
  SELECT organizations.disabled_at IS NULL AND organizations.deleted_at IS NULL INTO enabled
  FROM auth.organizations WHERE organizations.id = organization_id FOR SHARE;
  RETURN coalesce(enabled, false);
END;
$$;
REVOKE ALL ON FUNCTION app.lock_delivery_organization(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.lock_delivery_organization(uuid) TO pipong_worker;

--> statement-breakpoint
GRANT UPDATE (canceled_at) ON app.notifications TO pipong_api, pipong_worker;
--> statement-breakpoint
CREATE FUNCTION app.lock_delivery_credential(credential_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT id FROM app.credential_versions WHERE id = credential_id FOR SHARE;
$$;
REVOKE ALL ON FUNCTION app.lock_delivery_credential(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.lock_delivery_credential(uuid) TO pipong_worker;
