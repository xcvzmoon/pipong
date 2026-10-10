import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  pgPolicy,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateUuid, TIMESTAMP_CONFIG } from '../helpers/index.ts';
import { appSchema } from '../schema.ts';
import { environments } from '../tenancy/schema.ts';

const credentialPredicate = sql`
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND (nullif(current_setting('pipong.project_id', true), '') IS NULL
    OR project_id = nullif(current_setting('pipong.project_id', true), '')::uuid)
  AND (nullif(current_setting('pipong.environment_id', true), '') IS NULL
    OR environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid)
`;

export const credentialVersions = appSchema.table(
  'credential_versions',
  {
    id: generateUuid(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    environmentId: uuid('environment_id').notNull(),
    provider: text('provider', { enum: ['apns', 'fcm', 'web-push'] }).notNull(),
    appId: text('app_id').notNull(),
    publicKey: text('public_key'),
    encryptedSecret: text('encrypted_secret').notNull(),
    state: text('state', { enum: ['inactive', 'active', 'retired'] })
      .notNull()
      .default('inactive'),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).notNull().defaultNow(),
    retiredAt: timestamp('retired_at', TIMESTAMP_CONFIG),
  },
  (table) => [
    unique('credential_versions_ownership_id_unique').on(
      table.organizationId,
      table.projectId,
      table.environmentId,
      table.id,
    ),
    uniqueIndex('credential_versions_active_binding_unique')
      .on(table.organizationId, table.projectId, table.environmentId, table.provider, table.appId)
      .where(sql`${table.state} = 'active'`),
    check(
      'credential_versions_provider_valid',
      sql`${table.provider} IN ('apns', 'fcm', 'web-push')`,
    ),
    check(
      'credential_versions_state_valid',
      sql`${table.state} IN ('inactive', 'active', 'retired') AND (${table.state} = 'retired') = (${table.retiredAt} IS NOT NULL)`,
    ),
    foreignKey({
      columns: [table.organizationId, table.projectId, table.environmentId],
      foreignColumns: [environments.organizationId, environments.projectId, environments.id],
      name: 'credential_versions_environment_ownership_fk',
    }),
    pgPolicy('credential_versions_worker_lock', {
      for: 'select',
      to: ['pipong_migrator'],
      using: credentialPredicate,
    }),
    pgPolicy('credential_versions_erasure', {
      for: 'all',
      to: ['pipong_migrator'],
      using: credentialPredicate,
      withCheck: credentialPredicate,
    }),
    pgPolicy('credential_versions_scope', {
      for: 'all',
      to: ['pipong_api', 'pipong_worker'],
      using: credentialPredicate,
      withCheck: credentialPredicate,
    }),
  ],
);
