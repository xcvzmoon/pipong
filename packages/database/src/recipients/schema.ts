import { sql } from 'drizzle-orm';
import { check, foreignKey, pgPolicy, text, unique, uuid } from 'drizzle-orm/pg-core';
import { generateTimestamps, generateUuid } from '../helpers/index.ts';
import { appSchema } from '../schema.ts';
import { environments } from '../tenancy/schema.ts';

const recipientPredicate = sql`
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
  AND (
    nullif(current_setting('pipong.project_id', true), '') IS NULL
    OR project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  )
  AND (
    nullif(current_setting('pipong.environment_id', true), '') IS NULL
    OR environment_id = nullif(current_setting('pipong.environment_id', true), '')::uuid
  )
`;

export const recipients = appSchema.table(
  'recipients',
  {
    id: generateUuid(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    environmentId: uuid('environment_id').notNull(),
    externalId: text('external_id').notNull(),
    ...generateTimestamps(),
  },
  (table) => [
    unique('recipients_scoped_external_id_unique').on(
      table.organizationId,
      table.projectId,
      table.environmentId,
      table.externalId,
    ),
    unique('recipients_ownership_id_unique').on(
      table.organizationId,
      table.projectId,
      table.environmentId,
      table.id,
    ),
    check(
      'recipients_external_id_valid',
      sql`char_length(${table.externalId}) BETWEEN 1 AND 200 AND ${table.externalId} !~ '[[:cntrl:]]' AND ${table.externalId} ~ '[^[:space:]]'`,
    ),
    foreignKey({
      columns: [table.organizationId, table.projectId, table.environmentId],
      foreignColumns: [environments.organizationId, environments.projectId, environments.id],
      name: 'recipients_environment_ownership_fk',
    }),
    pgPolicy('recipients_scope', {
      for: 'all',
      to: ['pipong_api', 'pipong_worker'],
      using: recipientPredicate,
      withCheck: recipientPredicate,
    }),
  ],
);
