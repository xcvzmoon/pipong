import { sql } from 'drizzle-orm';
import {
  check,
  index,
  foreignKey,
  integer,
  jsonb,
  pgPolicy,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { endpointGenerations, endpoints } from './endpoints/schema.ts';
import { generateUuid, TIMESTAMP_CONFIG } from './helpers/index.ts';
import { appSchema } from './schema.ts';
import { environments } from './tenancy/schema.ts';

const submissionPredicate = sql`
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid
`;

export const notifications = appSchema.table(
  'notifications',
  {
    id: generateUuid(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    environmentId: uuid('environment_id').notNull(),
    request: text('request').notNull(),
    expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG).notNull(),
    acceptedAt: timestamp('accepted_at', TIMESTAMP_CONFIG).notNull().defaultNow(),
    deliveryCount: integer('delivery_count').notNull(),
    canceledAt: timestamp('canceled_at', TIMESTAMP_CONFIG),
  },
  (table) => [
    unique('notifications_ownership_id_unique').on(
      table.organizationId,
      table.projectId,
      table.environmentId,
      table.id,
    ),
    check('notifications_delivery_count_valid', sql`${table.deliveryCount} BETWEEN 1 AND 1000`),
    foreignKey({
      columns: [table.organizationId, table.projectId, table.environmentId],
      foreignColumns: [environments.organizationId, environments.projectId, environments.id],
      name: 'notifications_environment_ownership_fk',
    }),
    index('notifications_retention_idx')
      .on(table.acceptedAt)
      .where(sql`${table.request} <> ''`),
    pgPolicy('notifications_retention_discovery', {
      for: 'select',
      to: ['pipong_migrator'],
      using: sql`true`,
    }),
    pgPolicy('notifications_erasure', {
      for: 'all',
      to: ['pipong_migrator'],
      using: submissionPredicate,
      withCheck: submissionPredicate,
    }),
    pgPolicy('notifications_scope', {
      for: 'all',
      to: ['pipong_api', 'pipong_worker'],
      using: submissionPredicate,
      withCheck: submissionPredicate,
    }),
  ],
);

export const deliveries = appSchema.table(
  'deliveries',
  {
    id: generateUuid(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    environmentId: uuid('environment_id').notNull(),
    notificationId: uuid('notification_id').notNull(),
    endpointId: uuid('endpoint_id').notNull(),
    generation: integer('generation').notNull(),
    credentialId: uuid('credential_id').notNull(),
    provider: text('provider', { enum: ['apns', 'fcm', 'web-push'] }).notNull(),
    attemptGeneration: integer('attempt_generation').notNull().default(0),
    state: text('state', {
      enum: [
        'queued',
        'sending',
        'retry_wait',
        'provider_accepted',
        'failed',
        'expired',
        'canceled',
      ],
    })
      .notNull()
      .default('queued'),
  },
  (table) => [
    unique('deliveries_ownership_id_unique').on(
      table.organizationId,
      table.projectId,
      table.environmentId,
      table.id,
    ),
    unique('deliveries_notification_endpoint_unique').on(table.notificationId, table.endpointId),
    check('deliveries_attempt_generation_valid', sql`${table.attemptGeneration} >= 0`),
    check('deliveries_provider_valid', sql`${table.provider} IN ('apns', 'fcm', 'web-push')`),
    check(
      'deliveries_state_valid',
      sql`${table.state} IN ('queued', 'sending', 'retry_wait', 'provider_accepted', 'failed', 'expired', 'canceled')`,
    ),
    foreignKey({
      columns: [table.organizationId, table.projectId, table.environmentId, table.notificationId],
      foreignColumns: [
        notifications.organizationId,
        notifications.projectId,
        notifications.environmentId,
        notifications.id,
      ],
      name: 'deliveries_notification_ownership_fk',
    }),
    foreignKey({
      columns: [table.organizationId, table.projectId, table.environmentId, table.endpointId],
      foreignColumns: [
        endpoints.organizationId,
        endpoints.projectId,
        endpoints.environmentId,
        endpoints.id,
      ],
      name: 'deliveries_endpoint_ownership_fk',
    }),
    foreignKey({
      columns: [table.endpointId, table.generation, table.credentialId],
      foreignColumns: [
        endpointGenerations.endpointId,
        endpointGenerations.generation,
        endpointGenerations.credentialId,
      ],
      name: 'deliveries_generation_binding_fk',
    }),
    pgPolicy('deliveries_retention_discovery', {
      for: 'select',
      to: ['pipong_migrator'],
      using: sql`true`,
    }),
    pgPolicy('deliveries_scope', {
      for: 'all',
      to: ['pipong_api', 'pipong_worker'],
      using: submissionPredicate,
      withCheck: submissionPredicate,
    }),
  ],
);

export type AcceptanceResponse = {
  notificationId: string;
  acceptedAt: string;
  deliveryCount: number;
};

export const idempotencyRecords = appSchema.table(
  'idempotency_records',
  {
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    environmentId: uuid('environment_id').notNull(),
    key: text('key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    notificationId: uuid('notification_id').notNull(),
    response: jsonb('response').$type<AcceptanceResponse>().notNull(),
    expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG).notNull(),
  },
  (table) => [
    unique('idempotency_records_scope_key_unique').on(
      table.organizationId,
      table.projectId,
      table.environmentId,
      table.key,
    ),
    foreignKey({
      columns: [table.organizationId, table.projectId, table.environmentId, table.notificationId],
      foreignColumns: [
        notifications.organizationId,
        notifications.projectId,
        notifications.environmentId,
        notifications.id,
      ],
      name: 'idempotency_records_notification_ownership_fk',
    }),
    index('idempotency_records_retention_idx').on(table.expiresAt),
    pgPolicy('idempotency_records_retention_discovery', {
      for: 'select',
      to: ['pipong_migrator'],
      using: sql`true`,
    }),
    pgPolicy('idempotency_records_scope', {
      for: 'all',
      to: ['pipong_api', 'pipong_worker'],
      using: submissionPredicate,
      withCheck: submissionPredicate,
    }),
  ],
);
