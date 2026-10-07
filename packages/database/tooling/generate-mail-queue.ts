import { writeFile } from 'node:fs/promises';
import { getConstructionPlans } from 'pg-boss';

const folder = process.argv[2];
if (!folder) throw new Error('MIGRATION_FOLDER_REQUIRED: pass the custom migration folder');
const construction = getConstructionPlans('pgboss', { createSchema: false }).trim();
if (!construction.startsWith('BEGIN;') || !construction.endsWith('COMMIT;')) {
  throw new Error('QUEUE_MIGRATION_FORMAT_INVALID: review the generated transaction');
}
const sql = construction.slice('BEGIN;'.length, -'COMMIT;'.length);
await writeFile(
  `${folder}/migration.sql`,
  `${sql}\nSELECT pgboss.create_queue('auth-email', '{"policy":"standard","retryLimit":5,"retryDelay":5,"retryBackoff":true,"retryDelayMax":300,"expireInSeconds":60,"retentionSeconds":3600,"deleteAfterSeconds":3600}'::jsonb);\nREVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION pgboss.job_now() TO pipong_api, pipong_worker;\n`,
);
