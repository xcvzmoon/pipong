import { sql } from 'drizzle-orm';
import { check, foreignKey, pgPolicy, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { TIMESTAMP_CONFIG } from './helpers/index.ts';
import { appSchema } from './schema.ts';
import { deliveries } from './submission-schema.ts';

const recoveryPredicate = sql`
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  AND environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid
`;

export const deliveryRedrives = appSchema.table(
  'delivery_redrives',
  {
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    environmentId: uuid('environment_id').notNull(),
    sourceDeliveryId: uuid('source_delivery_id').notNull(),
    deliveryId: uuid('delivery_id').notNull(),
    actorId: text('actor_id').notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).notNull().defaultNow(),
  },
  (table) => [
    unique('delivery_redrives_source_unique').on(table.sourceDeliveryId),
    unique('delivery_redrives_delivery_unique').on(table.deliveryId),
    check('delivery_redrives_reason_valid', sql`length(${table.reason}) BETWEEN 1 AND 500`),
    foreignKey({
      columns: [table.organizationId, table.projectId, table.environmentId, table.sourceDeliveryId],
      foreignColumns: [
        deliveries.organizationId,
        deliveries.projectId,
        deliveries.environmentId,
        deliveries.id,
      ],
      name: 'delivery_redrives_source_ownership_fk',
    }),
    foreignKey({
      columns: [table.organizationId, table.projectId, table.environmentId, table.deliveryId],
      foreignColumns: [
        deliveries.organizationId,
        deliveries.projectId,
        deliveries.environmentId,
        deliveries.id,
      ],
      name: 'delivery_redrives_delivery_ownership_fk',
    }),
    pgPolicy('delivery_redrives_scope', {
      for: 'all',
      to: ['pipong_api'],
      using: recoveryPredicate,
      withCheck: recoveryPredicate,
    }),
  ],
);
