import { sql } from 'drizzle-orm';
import { check, index, pgPolicy, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { generateUuid, TIMESTAMP_CONFIG } from './helpers/index.ts';
import { appSchema } from './schema.ts';

const auditScope = sql`organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id IS NOT DISTINCT FROM nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id IS NOT DISTINCT FROM nullif(current_setting('pipong.environment_id', true), '')::uuid`;

export const privilegedAudits = appSchema.table(
  'privileged_audits',
  {
    id: generateUuid(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id'),
    environmentId: uuid('environment_id'),
    userId: uuid('user_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    action: text('action').notNull(),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).notNull().defaultNow(),
  },
  (table) => [
    check(
      'privileged_audits_action_valid',
      sql`${table.action} IN ('organization:manage','project:manage','environment:manage','credential:manage','service-key:manage','delivery:redrive')`,
    ),
    index('privileged_audits_retention_idx').on(table.createdAt, table.id),
    pgPolicy('privileged_audits_insert', {
      for: 'insert',
      to: ['pipong_api'],
      withCheck: auditScope,
    }),
    pgPolicy('privileged_audits_operator_read', {
      for: 'select',
      to: ['pipong_migrator'],
      using: sql`true`,
    }),
    pgPolicy('privileged_audits_retention', {
      for: 'delete',
      to: ['pipong_migrator'],
      using: sql`created_at < clock_timestamp() - interval '90 days'`,
    }),
  ],
);

export const workerHeartbeats = appSchema.table(
  'worker_heartbeats',
  {
    id: uuid('id').primaryKey(),
    expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG).notNull(),
    consumersReady: text('consumers_ready').array().notNull(),
  },
  (table) => [
    check(
      'worker_heartbeats_consumers_valid',
      sql`${table.consumersReady} <@ ARRAY['auth-email','apns','fcm','web-push']::text[]`,
    ),
  ],
);
