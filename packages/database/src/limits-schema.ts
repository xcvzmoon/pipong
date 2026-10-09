import { sql } from 'drizzle-orm';
import { check, integer, pgPolicy, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './auth/schema.ts';
import { TIMESTAMP_CONFIG } from './helpers/index.ts';
import { appSchema } from './schema.ts';

const organizationPredicate = sql`organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid`;

export const tenantBudgets = appSchema.table(
  'tenant_budgets',
  {
    organizationId: uuid('organization_id')
      .primaryKey()
      .references(() => organizations.id),
    requestLimit: integer('request_limit').notNull().default(120),
    keyRequestLimit: integer('key_request_limit').notNull().default(60),
    fanoutLimit: integer('fanout_limit').notNull().default(1000),
    pendingLimit: integer('pending_limit').notNull().default(10000),
    windowSeconds: integer('window_seconds').notNull().default(60),
    windowStart: timestamp('window_start', TIMESTAMP_CONFIG)
      .notNull()
      .default(sql`clock_timestamp()`),
    requests: integer('requests').notNull().default(0),
    fanout: integer('fanout').notNull().default(0),
    pending: integer('pending').notNull().default(0),
  },
  (table) => [
    check(
      'tenant_budgets_positive_limits',
      sql`${table.requestLimit} > 0 AND ${table.keyRequestLimit} > 0 AND ${table.fanoutLimit} > 0 AND ${table.pendingLimit} > 0 AND ${table.windowSeconds} > 0`,
    ),
    check(
      'tenant_budgets_nonnegative_usage',
      sql`${table.requests} >= 0 AND ${table.fanout} >= 0 AND ${table.pending} >= 0`,
    ),
    pgPolicy('tenant_budgets_scope', {
      for: 'all',
      to: ['pipong_api', 'pipong_worker'],
      using: organizationPredicate,
      withCheck: organizationPredicate,
    }),
  ],
);

export const keyBudgets = appSchema.table(
  'key_budgets',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => tenantBudgets.organizationId),
    keyId: uuid('key_id').notNull(),
    windowStart: timestamp('window_start', TIMESTAMP_CONFIG).notNull(),
    requests: integer('requests').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.keyId] }),
    check('key_budgets_nonnegative_usage', sql`${table.requests} >= 0`),
    pgPolicy('key_budgets_scope', {
      for: 'all',
      to: ['pipong_api', 'pipong_worker'],
      using: organizationPredicate,
      withCheck: organizationPredicate,
    }),
  ],
);

export const admissionReservations = appSchema.table(
  'admission_reservations',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => tenantBudgets.organizationId),
    id: uuid('id').notNull(),
    endpoints: integer('endpoints').notNull(),
    remaining: integer('remaining').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.id] }),
    check(
      'admission_reservations_bounds',
      sql`${table.endpoints} >= 0 AND ${table.remaining} >= 0 AND ${table.remaining} <= ${table.endpoints}`,
    ),
    pgPolicy('admission_reservations_scope', {
      for: 'all',
      to: ['pipong_api', 'pipong_worker'],
      using: organizationPredicate,
      withCheck: organizationPredicate,
    }),
  ],
);
