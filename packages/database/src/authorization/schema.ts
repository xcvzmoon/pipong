import { sql } from 'drizzle-orm';
import { check, foreignKey, index, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { apikeys, authSchema } from '../auth/schema.ts';
import { generateTimestamps, generateUuid, TIMESTAMP_CONFIG } from '../helpers/index.ts';
import { environments } from '../tenancy/schema.ts';

export const serviceKeyGrants = authSchema.table(
  'service_key_grants',
  {
    keyId: uuid('key_id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    environmentId: uuid('environment_id').notNull(),
    actions: text('actions').array().notNull(),
    rotatedAt: timestamp('rotated_at', TIMESTAMP_CONFIG),
    ...generateTimestamps(),
  },
  (table) => [
    index('service_key_grants_scope_idx').on(
      table.organizationId,
      table.projectId,
      table.environmentId,
      table.keyId,
    ),
    check(
      'service_key_grants_actions_valid',
      sql`cardinality(${table.actions}) BETWEEN 1 AND 9 AND ${table.actions} <@ ARRAY['recipient:read', 'recipient:write', 'endpoint:read', 'endpoint:write', 'notification:read', 'notification:send', 'notification:cancel', 'delivery:read', 'event:read']::text[]`,
    ),
    foreignKey({
      columns: [table.organizationId, table.keyId],
      foreignColumns: [apikeys.referenceId, apikeys.id],
      name: 'service_key_grants_key_ownership_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.projectId, table.environmentId],
      foreignColumns: [environments.organizationId, environments.projectId, environments.id],
      name: 'service_key_grants_environment_ownership_fk',
    }),
  ],
);

export const serviceKeyAudits = authSchema.table('service_key_audits', {
  id: generateUuid(),
  keyId: uuid('key_id').notNull(),
  organizationId: uuid('organization_id').notNull(),
  projectId: uuid('project_id').notNull(),
  environmentId: uuid('environment_id').notNull(),
  userId: uuid('user_id').notNull(),
  sessionId: uuid('session_id').notNull(),
  action: text('action').notNull(),
  replacementKeyId: uuid('replacement_key_id'),
  createdAt: timestamp('created_at', TIMESTAMP_CONFIG).defaultNow().notNull(),
});
