import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  pgPolicy,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { TIMESTAMP_CONFIG } from './helpers/index.ts';
import { appSchema } from './schema.ts';
import { deliveries } from './submission-schema.ts';

const attemptPredicate = sql`
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid
`;

export const deliveryAttempts = appSchema.table(
  'delivery_attempts',
  {
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    environmentId: uuid('environment_id').notNull(),
    deliveryId: uuid('delivery_id').notNull(),
    generation: integer('generation').notNull(),
    jobId: uuid('job_id').notNull(),
    retryCount: integer('retry_count').notNull(),
    startedAt: timestamp('started_at', TIMESTAMP_CONFIG).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', TIMESTAMP_CONFIG),
    outcome: text('outcome', { enum: ['accepted', 'permanent', 'transient', 'ambiguous'] }),
    code: text('code'),
  },
  (table) => [
    unique('delivery_attempts_delivery_generation_unique').on(table.deliveryId, table.generation),
    unique('delivery_attempts_claim_unique').on(table.jobId, table.retryCount),
    check(
      'delivery_attempts_generation_valid',
      sql`${table.generation} > 0 AND ${table.retryCount} >= 0`,
    ),
    check(
      'delivery_attempts_outcome_valid',
      sql`${table.outcome} IS NULL OR ${table.outcome} IN ('accepted', 'permanent', 'transient', 'ambiguous')`,
    ),
    check(
      'delivery_attempts_result_valid',
      sql`(${table.finishedAt} IS NULL) = (${table.outcome} IS NULL) AND (${table.finishedAt} IS NULL) = (${table.code} IS NULL)`,
    ),
    foreignKey({
      columns: [table.organizationId, table.projectId, table.environmentId, table.deliveryId],
      foreignColumns: [
        deliveries.organizationId,
        deliveries.projectId,
        deliveries.environmentId,
        deliveries.id,
      ],
      name: 'delivery_attempts_delivery_ownership_fk',
    }),
    pgPolicy('delivery_attempts_scope', {
      for: 'all',
      to: ['pipong_worker'],
      using: attemptPredicate,
      withCheck: attemptPredicate,
    }),
  ],
);
