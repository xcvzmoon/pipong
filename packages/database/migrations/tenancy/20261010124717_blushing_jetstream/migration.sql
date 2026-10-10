CREATE TABLE "app"."privileged_audits" (
	"id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"environment_id" uuid,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privileged_audits_action_valid" CHECK ("action" IN ('organization:manage','project:manage','environment:manage','credential:manage','service-key:manage','delivery:redrive'))
);
--> statement-breakpoint
ALTER TABLE "app"."privileged_audits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."worker_heartbeats" (
	"id" uuid PRIMARY KEY,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"consumers_ready" text[] NOT NULL,
	CONSTRAINT "worker_heartbeats_consumers_valid" CHECK ("consumers_ready" <@ ARRAY['auth-email','apns','fcm','web-push']::text[])
);
--> statement-breakpoint
CREATE INDEX "privileged_audits_retention_idx" ON "app"."privileged_audits" ("created_at","id");--> statement-breakpoint
CREATE POLICY "privileged_audits_insert" ON "app"."privileged_audits" AS PERMISSIVE FOR INSERT TO "pipong_api" WITH CHECK (organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id IS NOT DISTINCT FROM nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id IS NOT DISTINCT FROM nullif(current_setting('pipong.environment_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "privileged_audits_operator_read" ON "app"."privileged_audits" AS PERMISSIVE FOR SELECT TO "pipong_migrator" USING (true);--> statement-breakpoint
CREATE POLICY "privileged_audits_retention" ON "app"."privileged_audits" AS PERMISSIVE FOR DELETE TO "pipong_migrator" USING (created_at < clock_timestamp() - interval '90 days');--> statement-breakpoint
ALTER TABLE app.privileged_audits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.privileged_audits FROM pipong_api, pipong_worker;
GRANT INSERT ON app.privileged_audits TO pipong_api;
REVOKE ALL ON app.worker_heartbeats FROM pipong_api, pipong_worker;
GRANT DELETE, SELECT (id) ON app.worker_heartbeats TO pipong_worker;
--> statement-breakpoint
CREATE FUNCTION app.publish_worker_heartbeat(worker_id uuid, consumers text[]) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, app SET statement_timeout = '1s' SET lock_timeout = '250ms' AS $$
  DELETE FROM app.worker_heartbeats WHERE expires_at < clock_timestamp();
  INSERT INTO app.worker_heartbeats (id,expires_at,consumers_ready)
  VALUES (worker_id,clock_timestamp()+interval '90 seconds',consumers)
  ON CONFLICT (id) DO UPDATE SET expires_at=excluded.expires_at,consumers_ready=excluded.consumers_ready;
$$;
REVOKE ALL ON FUNCTION app.publish_worker_heartbeat(uuid,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.publish_worker_heartbeat(uuid,text[]) TO pipong_worker;
--> statement-breakpoint
CREATE FUNCTION app.runtime_diagnostics() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, app SET statement_timeout = '1s' SET lock_timeout = '250ms' AS $$
  SELECT jsonb_build_object(
    'queuesReady', (SELECT count(*)=4 FROM pgboss.queue WHERE name IN ('auth-email','delivery-apns','delivery-fcm','delivery-web-push')),
    'consumers', (SELECT coalesce(jsonb_agg(DISTINCT consumer),'[]'::jsonb) FROM app.worker_heartbeats, unnest(consumers_ready) consumer WHERE expires_at > clock_timestamp()),
    'queues', (SELECT jsonb_agg(jsonb_build_object('name', names.name,
      'pending', (SELECT count(*) FROM pgboss.job WHERE name=names.name AND state IN ('created','retry')),
      'active', (SELECT count(*) FROM pgboss.job WHERE name=names.name AND state='active'),
      'failed', (SELECT count(*) FROM pgboss.job WHERE name=names.name AND state='failed'),
      'oldestSeconds', (SELECT coalesce(greatest(0,extract(epoch FROM clock_timestamp()-min(created_on))),0) FROM pgboss.job WHERE name=names.name AND state IN ('created','retry','active'))
    )) FROM (VALUES ('auth-email'),('delivery-apns'),('delivery-fcm'),('delivery-web-push')) names(name)),
    'ambiguous', (SELECT count(*) FROM app.delivery_attempts WHERE outcome='ambiguous'),
    'credentialFailures', (SELECT count(*) FROM app.delivery_attempts WHERE code IN ('InvalidProviderToken','ExpiredProviderToken','FCM_AUTH_FAILED','THIRD_PARTY_AUTH_ERROR','UNAUTHENTICATED','WEB_PUSH_HTTP_401','WEB_PUSH_HTTP_403') AND finished_at > clock_timestamp()-interval '1 hour'),
    'pendingErasures', (SELECT count(*) FROM app.erasure_jobs WHERE completed_at IS NULL)
  );
$$;
REVOKE ALL ON FUNCTION app.runtime_diagnostics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.runtime_diagnostics() TO pipong_api, pipong_worker;
--> statement-breakpoint
CREATE FUNCTION app.prune_privileged_audits() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, app SET statement_timeout = '5s' SET lock_timeout = '1s' AS $$
  DELETE FROM app.privileged_audits WHERE id IN (SELECT id FROM app.privileged_audits WHERE created_at < clock_timestamp()-interval '90 days' ORDER BY created_at,id LIMIT 100);
$$;
REVOKE ALL ON FUNCTION app.prune_privileged_audits() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.prune_privileged_audits() TO pipong_worker;
