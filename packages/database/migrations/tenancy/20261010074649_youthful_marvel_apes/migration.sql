CREATE POLICY "delivery_attempts_api_read" ON "app"."delivery_attempts" AS PERMISSIVE FOR SELECT TO "pipong_api" USING (
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid
);