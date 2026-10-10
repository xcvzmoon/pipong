CREATE TABLE "app"."erasure_jobs" (
	"id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"environment_id" uuid,
	"recipient_id" uuid,
	"target_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_id" text NOT NULL,
	"requested_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"in_flight_until" timestamp(3) with time zone NOT NULL,
	"environment_cursor" uuid,
	"current_environment_id" uuid,
	"stage" text DEFAULT 'notifications' NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp(3) with time zone,
	CONSTRAINT "erasure_jobs_target_unique" UNIQUE("kind","target_id"),
	CONSTRAINT "erasure_jobs_stage_valid" CHECK ("stage" IN ('notifications','deliveries','generations','endpoints','recipients','credentials','keys','environment','projects','auth','done') AND ("stage" = 'done') = ("completed_at" IS NOT NULL)),
	CONSTRAINT "erasure_jobs_kind_valid" CHECK ("kind" IN ('organization', 'project', 'environment', 'recipient')),
	CONSTRAINT "erasure_jobs_scope_valid" CHECK (
      ("kind" = 'organization' AND "target_id" = "organization_id" AND "project_id" IS NULL AND "environment_id" IS NULL AND "recipient_id" IS NULL)
      OR ("kind" = 'project' AND "target_id" = "project_id" AND "project_id" IS NOT NULL AND "environment_id" IS NULL AND "recipient_id" IS NULL)
      OR ("kind" = 'environment' AND "target_id" = "environment_id" AND "environment_id" IS NOT NULL AND "project_id" IS NOT NULL AND "recipient_id" IS NULL)
      OR ("kind" = 'recipient' AND "target_id" = "recipient_id" AND "recipient_id" IS NOT NULL AND "project_id" IS NOT NULL AND "environment_id" IS NOT NULL)
    )
);
--> statement-breakpoint
ALTER TABLE "app"."erasure_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."environments" ALTER COLUMN "name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."projects" ALTER COLUMN "name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."recipients" ALTER COLUMN "external_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."endpoints" ALTER COLUMN "installation_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "delivery_events_retention_idx" ON "app"."delivery_events" ("created_at");--> statement-breakpoint
CREATE INDEX "idempotency_records_retention_idx" ON "app"."idempotency_records" ("expires_at");--> statement-breakpoint
CREATE INDEX "notifications_retention_idx" ON "app"."notifications" ("accepted_at") WHERE "request" <> '';--> statement-breakpoint
CREATE INDEX "delivery_attempts_retention_idx" ON "app"."delivery_attempts" ("finished_at");--> statement-breakpoint
CREATE INDEX "delivery_redrives_retention_idx" ON "app"."delivery_redrives" ("created_at");--> statement-breakpoint
CREATE INDEX "erasure_jobs_completed_idx" ON "app"."erasure_jobs" ("completed_at") WHERE "completed_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "erasure_jobs_pending_idx" ON "app"."erasure_jobs" ("updated_at") WHERE "completed_at" IS NULL;--> statement-breakpoint
ALTER TABLE "app"."environments" ADD CONSTRAINT "environments_erased_name_valid" CHECK ("name" IS NOT NULL OR "deleted_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "app"."projects" ADD CONSTRAINT "projects_erased_name_valid" CHECK ("name" IS NOT NULL OR "deleted_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "app"."recipients" ADD CONSTRAINT "recipients_erased_identity_valid" CHECK ("external_id" IS NOT NULL OR "deleted_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "app"."endpoints" ADD CONSTRAINT "endpoints_erased_installation_valid" CHECK ("installation_id" IS NOT NULL OR "state" = 'disabled');--> statement-breakpoint
CREATE POLICY "environments_erasure_read" ON "app"."environments" AS PERMISSIVE FOR SELECT TO "pipong_migrator" USING (

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
CREATE POLICY "projects_erasure_read" ON "app"."projects" AS PERMISSIVE FOR SELECT TO "pipong_migrator" USING (

  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid

  AND (
    nullif(current_setting('pipong.project_id', true), '') IS NULL
    OR id = nullif(current_setting('pipong.project_id', true), '')::uuid
  )
);--> statement-breakpoint
CREATE POLICY "recipients_erasure" ON "app"."recipients" AS PERMISSIVE FOR ALL TO "pipong_migrator" USING (
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
);--> statement-breakpoint
CREATE POLICY "credential_versions_erasure" ON "app"."credential_versions" AS PERMISSIVE FOR ALL TO "pipong_migrator" USING (
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
CREATE POLICY "endpoint_generations_erasure" ON "app"."endpoint_generations" AS PERMISSIVE FOR ALL TO "pipong_migrator" USING (
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
CREATE POLICY "endpoints_erasure" ON "app"."endpoints" AS PERMISSIVE FOR ALL TO "pipong_migrator" USING (
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
CREATE POLICY "delivery_events_retention_discovery" ON "app"."delivery_events" AS PERMISSIVE FOR SELECT TO "pipong_migrator" USING (true);--> statement-breakpoint
CREATE POLICY "deliveries_retention_discovery" ON "app"."deliveries" AS PERMISSIVE FOR SELECT TO "pipong_migrator" USING (true);--> statement-breakpoint
CREATE POLICY "idempotency_records_retention_discovery" ON "app"."idempotency_records" AS PERMISSIVE FOR SELECT TO "pipong_migrator" USING (true);--> statement-breakpoint
CREATE POLICY "notifications_retention_discovery" ON "app"."notifications" AS PERMISSIVE FOR SELECT TO "pipong_migrator" USING (true);--> statement-breakpoint
CREATE POLICY "notifications_erasure" ON "app"."notifications" AS PERMISSIVE FOR ALL TO "pipong_migrator" USING (
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid
) WITH CHECK (
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid
);--> statement-breakpoint
CREATE POLICY "delivery_attempts_retention_discovery" ON "app"."delivery_attempts" AS PERMISSIVE FOR SELECT TO "pipong_migrator" USING (true);--> statement-breakpoint
CREATE POLICY "delivery_attempts_erasure" ON "app"."delivery_attempts" AS PERMISSIVE FOR ALL TO "pipong_migrator" USING (
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid
) WITH CHECK (
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid
);--> statement-breakpoint
CREATE POLICY "delivery_redrives_retention_discovery" ON "app"."delivery_redrives" AS PERMISSIVE FOR SELECT TO "pipong_migrator" USING (true);--> statement-breakpoint
CREATE POLICY "delivery_redrives_worker_retention" ON "app"."delivery_redrives" AS PERMISSIVE FOR ALL TO "pipong_worker" USING (
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid
);--> statement-breakpoint
CREATE POLICY "erasure_jobs_scope" ON "app"."erasure_jobs" AS PERMISSIVE FOR ALL TO "pipong_api", "pipong_worker" USING (organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "erasure_jobs_audit_retention" ON "app"."erasure_jobs" AS PERMISSIVE FOR DELETE TO "pipong_migrator" USING ("app"."erasure_jobs"."completed_at" < clock_timestamp() - interval '90 days');--> statement-breakpoint
CREATE POLICY "erasure_jobs_discovery" ON "app"."erasure_jobs" AS PERMISSIVE FOR SELECT TO "pipong_migrator" USING (true);
--> statement-breakpoint
ALTER TABLE app.erasure_jobs FORCE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON app.erasure_jobs FROM pipong_api, pipong_worker;
GRANT INSERT ON app.erasure_jobs TO pipong_api;
GRANT UPDATE (target_id) ON app.erasure_jobs TO pipong_api;
GRANT UPDATE (current_environment_id, environment_cursor, stage, updated_at, completed_at) ON app.erasure_jobs TO pipong_worker;
--> statement-breakpoint
CREATE FUNCTION app.pending_erasures() RETURNS TABLE(id uuid, organization_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT id, organization_id FROM app.erasure_jobs WHERE completed_at IS NULL ORDER BY updated_at, id LIMIT 10;
$$;
REVOKE ALL ON FUNCTION app.pending_erasures() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.pending_erasures() TO pipong_worker;
--> statement-breakpoint
CREATE FUNCTION app.lock_erasure_organization() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT id FROM auth.organizations WHERE id = nullif(current_setting('pipong.organization_id', true), '')::uuid FOR UPDATE;
$$;
REVOKE ALL ON FUNCTION app.lock_erasure_organization() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.lock_erasure_organization() TO pipong_worker;
--> statement-breakpoint
CREATE FUNCTION app.erase_environment_keys() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE affected integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.erasure_jobs job
    WHERE job.organization_id=nullif(current_setting('pipong.organization_id',true),'')::uuid
    AND (job.environment_id IS NULL OR job.environment_id=nullif(current_setting('pipong.environment_id',true),'')::uuid)
    AND job.current_environment_id=nullif(current_setting('pipong.environment_id',true),'')::uuid
    AND (job.project_id IS NULL OR job.project_id=nullif(current_setting('pipong.project_id',true),'')::uuid)
    AND job.recipient_id IS NULL AND job.completed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'ERASURE_SCOPE_ACTIVE' USING ERRCODE='42501';
  END IF;
  WITH batch AS (
    SELECT key.id FROM auth.api_keys key JOIN auth.service_key_grants grant_record ON grant_record.key_id=key.id
    WHERE grant_record.organization_id=nullif(current_setting('pipong.organization_id',true),'')::uuid
    AND grant_record.project_id=nullif(current_setting('pipong.project_id',true),'')::uuid
    AND grant_record.environment_id=nullif(current_setting('pipong.environment_id',true),'')::uuid
    AND key.key <> '' ORDER BY key.id LIMIT 100 FOR UPDATE OF key
  ), revoked AS (
    UPDATE auth.api_keys key SET enabled=false, key='', name=NULL, start=NULL, prefix=NULL, metadata=NULL, permissions=NULL, deleted_at=coalesce(deleted_at,clock_timestamp())
    FROM batch WHERE key.id=batch.id RETURNING key.id
  ) UPDATE auth.service_key_grants grant_record SET deleted_at=coalesce(deleted_at,clock_timestamp()) FROM revoked WHERE grant_record.key_id=revoked.id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION app.erase_environment_keys() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.erase_environment_keys() TO pipong_worker;
--> statement-breakpoint
CREATE FUNCTION app.erase_organization_auth() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE tenant_id uuid := nullif(current_setting('pipong.organization_id',true),'')::uuid;
DECLARE affected integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.organizations WHERE id=tenant_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'ERASURE_SCOPE_ACTIVE' USING ERRCODE='42501';
  END IF;
  WITH batch AS (SELECT id FROM auth.api_keys WHERE reference_id=tenant_id AND key <> '' ORDER BY id LIMIT 100 FOR UPDATE)
  UPDATE auth.api_keys key SET enabled=false, key='', name=NULL, start=NULL, prefix=NULL, metadata=NULL, permissions=NULL, deleted_at=coalesce(deleted_at,clock_timestamp()) FROM batch WHERE key.id=batch.id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN RETURN affected; END IF;
  WITH batch AS (
    SELECT job.id FROM pgboss.job job JOIN auth.invitations invitation ON job.data->>'url' LIKE '%?id=' || invitation.id::text
    WHERE invitation.organization_id=tenant_id AND job.name='auth-email' AND job.data <> '{}'::jsonb ORDER BY job.id LIMIT 100
  ) UPDATE pgboss.job job SET data='{}'::jsonb, state=CASE WHEN state IN ('created','retry','active') THEN 'cancelled'::pgboss.job_state ELSE state END, completed_on=coalesce(completed_on,clock_timestamp()) FROM batch WHERE job.id=batch.id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN RETURN affected; END IF;
  DELETE FROM auth.invitations WHERE id IN (SELECT id FROM auth.invitations WHERE organization_id=tenant_id ORDER BY id LIMIT 100);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN RETURN affected; END IF;
  DELETE FROM auth.members WHERE id IN (SELECT id FROM auth.members WHERE organization_id=tenant_id ORDER BY id LIMIT 100);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN RETURN affected; END IF;
  UPDATE auth.sessions SET active_organization_id=NULL WHERE id IN (SELECT id FROM auth.sessions WHERE active_organization_id=tenant_id ORDER BY id LIMIT 100);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN RETURN affected; END IF;
  UPDATE auth.organizations SET name='erased:' || id::text, slug='erased:' || id::text, logo=NULL, metadata=NULL WHERE id=tenant_id;
  RETURN 0;
END;
$$;
REVOKE ALL ON FUNCTION app.erase_organization_auth() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.erase_organization_auth() TO pipong_worker;

--> statement-breakpoint
GRANT DELETE ON app.idempotency_records, app.delivery_redrives TO pipong_worker;
CREATE FUNCTION app.retention_scopes() RETURNS TABLE(organization_id uuid, project_id uuid, environment_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT DISTINCT organization_id, project_id, environment_id FROM (
    (SELECT organization_id, project_id, environment_id FROM app.notifications notification WHERE request <> '' AND accepted_at < clock_timestamp()-interval '30 days' AND NOT EXISTS (SELECT 1 FROM app.deliveries delivery WHERE delivery.notification_id=notification.id AND delivery.state IN ('queued','retry_wait','sending')) ORDER BY accepted_at LIMIT 100)
    UNION ALL
    (SELECT organization_id, project_id, environment_id FROM app.delivery_attempts WHERE finished_at < clock_timestamp()-interval '30 days' ORDER BY finished_at LIMIT 100)
    UNION ALL
    (SELECT organization_id, project_id, environment_id FROM app.idempotency_records WHERE expires_at <= clock_timestamp() ORDER BY expires_at LIMIT 100)
    UNION ALL
    (SELECT organization_id, project_id, environment_id FROM app.delivery_events WHERE created_at < clock_timestamp()-interval '7 days' ORDER BY created_at LIMIT 100)
    UNION ALL
    (SELECT organization_id, project_id, environment_id FROM app.delivery_redrives WHERE created_at < clock_timestamp()-interval '90 days' ORDER BY created_at LIMIT 100)
  ) candidates LIMIT 10;
$$;
REVOKE ALL ON FUNCTION app.retention_scopes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.retention_scopes() TO pipong_worker;
--> statement-breakpoint
CREATE FUNCTION app.prune_security_audits() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  DELETE FROM app.erasure_jobs WHERE id IN (SELECT id FROM app.erasure_jobs WHERE completed_at < clock_timestamp()-interval '90 days' ORDER BY completed_at,id LIMIT 100);
  DELETE FROM auth.enrollment_audits WHERE id IN (SELECT id FROM auth.enrollment_audits WHERE created_at < clock_timestamp()-interval '90 days' ORDER BY created_at,id LIMIT 100);
  DELETE FROM auth.service_key_audits WHERE id IN (SELECT id FROM auth.service_key_audits WHERE created_at < clock_timestamp()-interval '90 days' ORDER BY created_at,id LIMIT 100);
END;
$$;
REVOKE ALL ON FUNCTION app.prune_security_audits() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.prune_security_audits() TO pipong_worker;

--> statement-breakpoint
CREATE FUNCTION app.erasure_environment(recipient_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.erasure_jobs job
    JOIN auth.organizations organization ON organization.id=job.organization_id
    LEFT JOIN app.projects project ON project.id=job.project_id
    LEFT JOIN app.environments environment ON environment.id=job.environment_id
    LEFT JOIN app.recipients recipient ON recipient.id=job.recipient_id
    WHERE job.organization_id=nullif(current_setting('pipong.organization_id',true),'')::uuid
    AND (job.environment_id IS NULL OR job.environment_id=nullif(current_setting('pipong.environment_id',true),'')::uuid)
    AND job.current_environment_id=nullif(current_setting('pipong.environment_id',true),'')::uuid
    AND (job.project_id IS NULL OR job.project_id=nullif(current_setting('pipong.project_id',true),'')::uuid)
    AND job.recipient_id IS NOT DISTINCT FROM $1 AND job.completed_at IS NULL
    AND ((job.kind='organization' AND organization.deleted_at IS NOT NULL)
      OR (job.kind='project' AND project.deleted_at IS NOT NULL)
      OR (job.kind='environment' AND environment.deleted_at IS NOT NULL)
      OR (job.kind='recipient' AND recipient.deleted_at IS NOT NULL))
  );
$$;
REVOKE ALL ON FUNCTION app.erasure_environment(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION app.erase_notification_payloads(recipient_id uuid, expired_only boolean) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE affected integer;
BEGIN
  IF NOT expired_only AND NOT app.erasure_environment(recipient_id) THEN
    RAISE EXCEPTION 'ERASURE_SCOPE_ACTIVE' USING ERRCODE='42501';
  END IF;
  WITH batch AS (
    SELECT notification.id FROM app.notifications notification
    WHERE notification.organization_id=nullif(current_setting('pipong.organization_id',true),'')::uuid
    AND notification.project_id=nullif(current_setting('pipong.project_id',true),'')::uuid
    AND notification.environment_id=nullif(current_setting('pipong.environment_id',true),'')::uuid
    AND notification.request <> ''
    AND (NOT expired_only OR (notification.accepted_at < clock_timestamp()-interval '30 days'
      AND NOT EXISTS (SELECT 1 FROM app.deliveries delivery WHERE delivery.notification_id=notification.id AND delivery.state IN ('queued','retry_wait','sending'))))
    AND (recipient_id IS NULL OR EXISTS (SELECT 1 FROM app.deliveries delivery JOIN app.endpoints endpoint ON endpoint.id=delivery.endpoint_id WHERE delivery.notification_id=notification.id AND endpoint.recipient_id=erase_notification_payloads.recipient_id))
    ORDER BY notification.id LIMIT 100 FOR UPDATE
  ) UPDATE app.notifications notification SET request='', canceled_at=CASE WHEN expired_only THEN canceled_at ELSE coalesce(canceled_at,clock_timestamp()) END FROM batch WHERE notification.id=batch.id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION app.erase_notification_payloads(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.erase_notification_payloads(uuid,boolean) TO pipong_worker;
--> statement-breakpoint
CREATE FUNCTION app.erase_endpoint_generations(recipient_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE affected integer;
BEGIN
  IF NOT app.erasure_environment(recipient_id) THEN
    RAISE EXCEPTION 'ERASURE_SCOPE_ACTIVE' USING ERRCODE='42501';
  END IF;
  WITH batch AS (SELECT generation.ctid FROM app.endpoint_generations generation JOIN app.endpoints endpoint ON endpoint.id=generation.endpoint_id
    WHERE generation.encrypted_target <> '' AND (erase_endpoint_generations.recipient_id IS NULL OR endpoint.recipient_id=erase_endpoint_generations.recipient_id)
    ORDER BY generation.endpoint_id,generation.generation LIMIT 100 FOR UPDATE OF generation)
  UPDATE app.endpoint_generations generation SET encrypted_target='' FROM batch WHERE generation.ctid=batch.ctid;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION app.erase_endpoint_generations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.erase_endpoint_generations(uuid) TO pipong_worker;
--> statement-breakpoint
CREATE FUNCTION app.erase_endpoints(recipient_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE affected integer;
BEGIN
  IF NOT app.erasure_environment(recipient_id) THEN
    RAISE EXCEPTION 'ERASURE_SCOPE_ACTIVE' USING ERRCODE='42501';
  END IF;
  WITH batch AS (SELECT endpoint.id FROM app.endpoints endpoint WHERE endpoint.installation_id IS NOT NULL AND (erase_endpoints.recipient_id IS NULL OR endpoint.recipient_id=erase_endpoints.recipient_id) ORDER BY endpoint.id LIMIT 100 FOR UPDATE)
  UPDATE app.endpoints endpoint SET installation_id=NULL, target_hash='', state='disabled', disabled_at=coalesce(disabled_at,clock_timestamp()) FROM batch WHERE endpoint.id=batch.id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION app.erase_endpoints(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.erase_endpoints(uuid) TO pipong_worker;
--> statement-breakpoint
CREATE FUNCTION app.erase_recipients(recipient_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE affected integer;
BEGIN
  IF NOT app.erasure_environment(recipient_id) THEN
    RAISE EXCEPTION 'ERASURE_SCOPE_ACTIVE' USING ERRCODE='42501';
  END IF;
  WITH batch AS (SELECT id FROM app.recipients WHERE external_id IS NOT NULL AND (recipient_id IS NULL OR id=recipient_id) ORDER BY id LIMIT 100 FOR UPDATE)
  UPDATE app.recipients recipient SET external_id=NULL, deleted_at=coalesce(deleted_at,clock_timestamp()) FROM batch WHERE recipient.id=batch.id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION app.erase_recipients(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.erase_recipients(uuid) TO pipong_worker;
--> statement-breakpoint
CREATE FUNCTION app.erase_credentials() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE affected integer;
BEGIN
  IF NOT app.erasure_environment(NULL) THEN
    RAISE EXCEPTION 'ERASURE_SCOPE_ACTIVE' USING ERRCODE='42501';
  END IF;
  WITH batch AS (SELECT id FROM app.credential_versions WHERE encrypted_secret <> '' ORDER BY id LIMIT 100 FOR UPDATE)
  UPDATE app.credential_versions credential SET encrypted_secret='', public_key=NULL, state='retired', retired_at=coalesce(retired_at,clock_timestamp()) FROM batch WHERE credential.id=batch.id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION app.erase_credentials() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.erase_credentials() TO pipong_worker;
--> statement-breakpoint
CREATE FUNCTION app.prune_attempts() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  DELETE FROM app.delivery_attempts WHERE ctid IN (
    SELECT ctid FROM app.delivery_attempts
    WHERE organization_id=nullif(current_setting('pipong.organization_id',true),'')::uuid
    AND project_id=nullif(current_setting('pipong.project_id',true),'')::uuid
    AND environment_id=nullif(current_setting('pipong.environment_id',true),'')::uuid
    AND finished_at < clock_timestamp()-interval '30 days'
    ORDER BY finished_at,delivery_id,generation LIMIT 100
  );
$$;
REVOKE ALL ON FUNCTION app.prune_attempts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.prune_attempts() TO pipong_worker;
