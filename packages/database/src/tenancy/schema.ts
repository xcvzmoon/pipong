import { sql } from 'drizzle-orm';
import { foreignKey, pgPolicy, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { organizations } from '../auth/schema.ts';
import { TIMESTAMP_CONFIG, generateTimestamps, generateUuid } from '../helpers/index.ts';
import { appSchema } from '../schema.ts';

const organizationPredicate = sql`
  organization_id = nullif(current_setting('pipong.organization_id', true), '')::uuid
`;
const projectPredicate = sql`
  ${organizationPredicate}
  AND (
    nullif(current_setting('pipong.project_id', true), '') IS NULL
    OR id = nullif(current_setting('pipong.project_id', true), '')::uuid
  )
`;
const environmentPredicate = sql`
  ${organizationPredicate}
  AND (
    nullif(current_setting('pipong.project_id', true), '') IS NULL
    OR project_id = nullif(current_setting('pipong.project_id', true), '')::uuid
  )
  AND (
    nullif(current_setting('pipong.environment_id', true), '') IS NULL
    OR id = nullif(current_setting('pipong.environment_id', true), '')::uuid
  )
`;

export const projects = appSchema.table(
  'projects',
  {
    id: generateUuid(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    suspendedAt: timestamp('suspended_at', TIMESTAMP_CONFIG),
    ...generateTimestamps(),
  },
  (table) => [
    unique('projects_scoped_name_unique').on(table.organizationId, table.name),
    unique('projects_organization_id_id_unique').on(table.organizationId, table.id),
    pgPolicy('projects_scope', {
      for: 'all',
      to: ['pipong_api', 'pipong_worker'],
      using: projectPredicate,
      withCheck: projectPredicate,
    }),
  ],
);

export const environments = appSchema.table(
  'environments',
  {
    id: generateUuid(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    name: text('name').notNull(),
    suspendedAt: timestamp('suspended_at', TIMESTAMP_CONFIG),
    ...generateTimestamps(),
  },
  (table) => [
    unique('environments_scoped_name_unique').on(table.organizationId, table.projectId, table.name),
    unique('environments_organization_project_id_unique').on(
      table.organizationId,
      table.projectId,
      table.id,
    ),
    foreignKey({
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
      name: 'environments_project_ownership_fk',
    }),
    pgPolicy('environments_scope', {
      for: 'all',
      to: ['pipong_api', 'pipong_worker'],
      using: environmentPredicate,
      withCheck: environmentPredicate,
    }),
  ],
);
