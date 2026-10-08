import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  pgPolicy,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { credentialVersions } from '../credentials/schema.ts';
import { generateUuid, TIMESTAMP_CONFIG } from '../helpers/index.ts';
import { recipients } from '../recipients/schema.ts';
import { appSchema } from '../schema.ts';

const endpointPredicate = sql`
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND (nullif(current_setting('pipong.project_id', true), '') IS NULL
    OR project_id = nullif(current_setting('pipong.project_id', true), '')::uuid)
  AND (nullif(current_setting('pipong.environment_id', true), '') IS NULL
    OR environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid)
`;

export const endpoints = appSchema.table(
  'endpoints',
  {
    id: generateUuid(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    environmentId: uuid('environment_id').notNull(),
    recipientId: uuid('recipient_id').notNull(),
    installationId: text('installation_id').notNull(),
    provider: text('provider', { enum: ['apns', 'fcm', 'web-push'] }).notNull(),
    appId: text('app_id').notNull(),
    generation: integer('generation').notNull(),
    credentialId: uuid('credential_id').notNull(),
    targetHash: text('target_hash').notNull(),
    state: text('state', { enum: ['active', 'disabled'] })
      .notNull()
      .default('active'),
    registeredAt: timestamp('registered_at', TIMESTAMP_CONFIG).notNull().defaultNow(),
    disabledAt: timestamp('disabled_at', TIMESTAMP_CONFIG),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).notNull().defaultNow(),
  },
  (table) => [
    unique('endpoints_ownership_id_unique').on(
      table.organizationId,
      table.projectId,
      table.environmentId,
      table.id,
    ),
    unique('endpoints_installation_unique').on(
      table.organizationId,
      table.projectId,
      table.environmentId,
      table.provider,
      table.appId,
      table.installationId,
    ),
    uniqueIndex('endpoints_active_target_unique')
      .on(
        table.organizationId,
        table.projectId,
        table.environmentId,
        table.provider,
        table.appId,
        table.targetHash,
      )
      .where(sql`${table.state} = 'active'`),
    check('endpoints_generation_valid', sql`${table.generation} > 0`),
    check('endpoints_provider_valid', sql`${table.provider} IN ('apns', 'fcm', 'web-push')`),
    check(
      'endpoints_state_valid',
      sql`${table.state} IN ('active', 'disabled') AND (${table.state} = 'disabled') = (${table.disabledAt} IS NOT NULL)`,
    ),
    foreignKey({
      columns: [table.organizationId, table.projectId, table.environmentId, table.recipientId],
      foreignColumns: [
        recipients.organizationId,
        recipients.projectId,
        recipients.environmentId,
        recipients.id,
      ],
      name: 'endpoints_recipient_ownership_fk',
    }),
    foreignKey({
      columns: [table.organizationId, table.projectId, table.environmentId, table.credentialId],
      foreignColumns: [
        credentialVersions.organizationId,
        credentialVersions.projectId,
        credentialVersions.environmentId,
        credentialVersions.id,
      ],
      name: 'endpoints_credential_ownership_fk',
    }),
    pgPolicy('endpoints_scope', {
      for: 'all',
      to: ['pipong_api', 'pipong_worker'],
      using: endpointPredicate,
      withCheck: endpointPredicate,
    }),
  ],
);

export const endpointGenerations = appSchema.table(
  'endpoint_generations',
  {
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    environmentId: uuid('environment_id').notNull(),
    endpointId: uuid('endpoint_id').notNull(),
    generation: integer('generation').notNull(),
    credentialId: uuid('credential_id').notNull(),
    encryptedTarget: text('encrypted_target').notNull(),
    registeredAt: timestamp('registered_at', TIMESTAMP_CONFIG).notNull(),
  },
  (table) => [
    unique('endpoint_generations_identity_unique').on(table.endpointId, table.generation),
    unique('endpoint_generations_current_binding_unique').on(
      table.endpointId,
      table.generation,
      table.credentialId,
    ),
    check('endpoint_generations_generation_valid', sql`${table.generation} > 0`),
    foreignKey({
      columns: [table.organizationId, table.projectId, table.environmentId, table.endpointId],
      foreignColumns: [
        endpoints.organizationId,
        endpoints.projectId,
        endpoints.environmentId,
        endpoints.id,
      ],
      name: 'endpoint_generations_endpoint_ownership_fk',
    }),
    foreignKey({
      columns: [table.organizationId, table.projectId, table.environmentId, table.credentialId],
      foreignColumns: [
        credentialVersions.organizationId,
        credentialVersions.projectId,
        credentialVersions.environmentId,
        credentialVersions.id,
      ],
      name: 'endpoint_generations_credential_ownership_fk',
    }),
    pgPolicy('endpoint_generations_scope', {
      for: 'all',
      to: ['pipong_api', 'pipong_worker'],
      using: endpointPredicate,
      withCheck: endpointPredicate,
    }),
  ],
);
