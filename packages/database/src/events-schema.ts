import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  foreignKey,
  pgPolicy,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { TIMESTAMP_CONFIG } from './helpers/index.ts';
import { appSchema } from './schema.ts';
import { environments } from './tenancy/schema.ts';

const scopePredicate = sql`organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid`;

export const eventStreams = appSchema.table(
  'event_streams',
  {
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    environmentId: uuid('environment_id').primaryKey(),
    sequence: bigint('sequence', { mode: 'bigint' }).notNull().default(0n),
    watermark: bigint('watermark', { mode: 'bigint' }).notNull().default(0n),
  },
  (table) => [
    check(
      'event_streams_bounds',
      sql`${table.watermark} >= 0 AND ${table.sequence} >= ${table.watermark}`,
    ),
    foreignKey({
      columns: [table.organizationId, table.projectId, table.environmentId],
      foreignColumns: [environments.organizationId, environments.projectId, environments.id],
      name: 'event_streams_environment_fk',
    }),
    pgPolicy('event_streams_scope', {
      for: 'all',
      to: ['pipong_api', 'pipong_worker'],
      using: scopePredicate,
      withCheck: scopePredicate,
    }),
  ],
);

export const deliveryEvents = appSchema.table(
  'delivery_events',
  {
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    environmentId: uuid('environment_id')
      .notNull()
      .references(() => eventStreams.environmentId),
    sequence: bigint('sequence', { mode: 'bigint' }).notNull(),
    notificationId: uuid('notification_id').notNull(),
    deliveryId: uuid('delivery_id').notNull(),
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
    }).notNull(),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG)
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    primaryKey({ columns: [table.environmentId, table.sequence] }),
    check('delivery_events_sequence_positive', sql`${table.sequence} > 0`),
    check(
      'delivery_events_state_valid',
      sql`${table.state} IN ('queued', 'sending', 'retry_wait', 'provider_accepted', 'failed', 'expired', 'canceled')`,
    ),
    foreignKey({
      columns: [table.organizationId, table.projectId, table.environmentId],
      foreignColumns: [environments.organizationId, environments.projectId, environments.id],
      name: 'delivery_events_environment_fk',
    }),
    index('delivery_events_retention_idx').on(table.createdAt),
    pgPolicy('delivery_events_retention_discovery', {
      for: 'select',
      to: ['pipong_migrator'],
      using: sql`true`,
    }),
    pgPolicy('delivery_events_scope', {
      for: 'all',
      to: ['pipong_api', 'pipong_worker'],
      using: scopePredicate,
      withCheck: scopePredicate,
    }),
  ],
);
