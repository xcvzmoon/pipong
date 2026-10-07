import type { DatabaseRuntime } from '../clients.ts';
import { sql } from 'drizzle-orm';
import * as v from 'valibot';

const idSchema = v.pipe(v.string(), v.uuid());
const tenantScopeSchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('organization'), organizationId: idSchema }),
  v.strictObject({ kind: v.literal('project'), organizationId: idSchema, projectId: idSchema }),
  v.strictObject({
    kind: v.literal('environment'),
    organizationId: idSchema,
    projectId: idSchema,
    environmentId: idSchema,
  }),
]);

export type TenantScope = v.InferOutput<typeof tenantScopeSchema>;
export type TenantTransaction = Parameters<Parameters<DatabaseRuntime['db']['transaction']>[0]>[0];

/** Runs database work in an already authorized scope. This does not grant authority. */
export function withTenantTransaction<Result>(
  database: DatabaseRuntime,
  scope: TenantScope,
  run: (transaction: TenantTransaction) => Promise<Result>,
): Promise<Result> {
  const parsed = v.safeParse(tenantScopeSchema, scope);

  if (!parsed.success) {
    throw new Error('TENANT_SCOPE_INVALID: invalid tenant transaction scope');
  }

  const authorizedScope = parsed.output;
  const projectId = authorizedScope.kind === 'organization' ? '' : authorizedScope.projectId;
  const environmentId = authorizedScope.kind === 'environment' ? authorizedScope.environmentId : '';

  return database.db.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT
      set_config('pipong.organization_id', ${authorizedScope.organizationId}, true),
      set_config('pipong.project_id', ${projectId}, true),
      set_config('pipong.environment_id', ${environmentId}, true)`);

    return run(transaction);
  });
}
