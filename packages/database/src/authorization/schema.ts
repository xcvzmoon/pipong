import { foreignKey, text, uuid } from 'drizzle-orm/pg-core';
import { apikeys, authSchema } from '../auth/schema.ts';
import { generateTimestamps } from '../helpers/index.ts';
import { environments } from '../tenancy/schema.ts';

export const serviceKeyGrants = authSchema.table(
  'service_key_grants',
  {
    keyId: uuid('key_id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    environmentId: uuid('environment_id').notNull(),
    actions: text('actions').array().notNull(),
    ...generateTimestamps(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.keyId],
      foreignColumns: [apikeys.referenceId, apikeys.id],
      name: 'service_key_grants_key_ownership_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.projectId, table.environmentId],
      foreignColumns: [environments.organizationId, environments.projectId, environments.id],
      name: 'service_key_grants_environment_ownership_fk',
    }),
  ],
);
