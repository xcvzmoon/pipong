import { sql } from 'drizzle-orm';
import { check, index, pgPolicy, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { generateUuid, TIMESTAMP_CONFIG } from './helpers/index.ts';
import { appSchema } from './schema.ts';

const erasurePredicate = sql`organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid`;

export const erasureJobs = appSchema.table(
  'erasure_jobs',
  {
    id: generateUuid(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id'),
    environmentId: uuid('environment_id'),
    recipientId: uuid('recipient_id'),
    targetId: uuid('target_id').notNull(),
    kind: text('kind', { enum: ['organization', 'project', 'environment', 'recipient'] }).notNull(),
    actorId: text('actor_id').notNull(),
    requestedAt: timestamp('requested_at', TIMESTAMP_CONFIG).notNull().defaultNow(),
    inFlightUntil: timestamp('in_flight_until', TIMESTAMP_CONFIG).notNull(),
    environmentCursor: uuid('environment_cursor'),
    currentEnvironmentId: uuid('current_environment_id'),
    stage: text('stage', {
      enum: [
        'notifications',
        'deliveries',
        'generations',
        'endpoints',
        'recipients',
        'credentials',
        'keys',
        'environment',
        'projects',
        'auth',
        'done',
      ],
    })
      .notNull()
      .default('notifications'),
    updatedAt: timestamp('updated_at', TIMESTAMP_CONFIG).notNull().defaultNow(),
    completedAt: timestamp('completed_at', TIMESTAMP_CONFIG),
  },
  (table) => [
    unique('erasure_jobs_target_unique').on(table.kind, table.targetId),
    index('erasure_jobs_completed_idx')
      .on(table.completedAt)
      .where(sql`${table.completedAt} IS NOT NULL`),
    index('erasure_jobs_pending_idx')
      .on(table.updatedAt)
      .where(sql`${table.completedAt} IS NULL`),
    check(
      'erasure_jobs_stage_valid',
      sql`${table.stage} IN ('notifications','deliveries','generations','endpoints','recipients','credentials','keys','environment','projects','auth','done') AND (${table.stage} = 'done') = (${table.completedAt} IS NOT NULL)`,
    ),
    check(
      'erasure_jobs_kind_valid',
      sql`${table.kind} IN ('organization', 'project', 'environment', 'recipient')`,
    ),
    check(
      'erasure_jobs_scope_valid',
      sql`
      (${table.kind} = 'organization' AND ${table.targetId} = ${table.organizationId} AND ${table.projectId} IS NULL AND ${table.environmentId} IS NULL AND ${table.recipientId} IS NULL)
      OR (${table.kind} = 'project' AND ${table.targetId} = ${table.projectId} AND ${table.projectId} IS NOT NULL AND ${table.environmentId} IS NULL AND ${table.recipientId} IS NULL)
      OR (${table.kind} = 'environment' AND ${table.targetId} = ${table.environmentId} AND ${table.environmentId} IS NOT NULL AND ${table.projectId} IS NOT NULL AND ${table.recipientId} IS NULL)
      OR (${table.kind} = 'recipient' AND ${table.targetId} = ${table.recipientId} AND ${table.recipientId} IS NOT NULL AND ${table.projectId} IS NOT NULL AND ${table.environmentId} IS NOT NULL)
    `,
    ),
    pgPolicy('erasure_jobs_scope', {
      for: 'all',
      to: ['pipong_api', 'pipong_worker'],
      using: erasurePredicate,
      withCheck: erasurePredicate,
    }),
    pgPolicy('erasure_jobs_audit_retention', {
      for: 'delete',
      to: ['pipong_migrator'],
      using: sql`${table.completedAt} < clock_timestamp() - interval '90 days'`,
    }),
    pgPolicy('erasure_jobs_discovery', {
      for: 'select',
      to: ['pipong_migrator'],
      using: sql`true`,
    }),
  ],
);
