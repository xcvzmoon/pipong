import type { DatabaseRuntime } from '../clients.ts';
import { sql } from 'drizzle-orm';
import * as v from 'valibot';

const idSchema = v.pipe(v.string(), v.uuid());
/**
 * Validates the UUID hierarchy for an organization, project, or environment scope.
 *
 * Validation establishes shape only; it does not check existence or authority.
 *
 * @example
 * ```ts
 * const scope = v.parse(tenantScopeSchema, {
 *   kind: 'organization',
 *   organizationId: '01960000-0000-7000-8000-000000000001',
 * });
 * ```
 */
export const tenantScopeSchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('organization'), organizationId: idSchema }),
  v.strictObject({ kind: v.literal('project'), organizationId: idSchema, projectId: idSchema }),
  v.strictObject({
    kind: v.literal('environment'),
    organizationId: idSchema,
    projectId: idSchema,
    environmentId: idSchema,
  }),
]);

/**
 * Validated organization, project, or environment identifiers used for tenant isolation.
 */
export type TenantScope = v.InferOutput<typeof tenantScopeSchema>;
/**
 * Drizzle transaction type used by tenant operations.
 */
export type TenantTransaction = Parameters<Parameters<DatabaseRuntime['db']['transaction']>[0]>[0];

/**
 * Runs work in a transaction with validated tenant context.
 *
 * This function sets the row-level security context but does not grant authority.
 * Use withAuthorizedTransaction when handling an authenticated domain request.
 *
 * @param database - Runtime that owns the transaction.
 * @param scope - Previously authorized scope with valid UUID identifiers.
 * @param run - Work to execute after the transaction-local context is set.
 * @returns Callback result after the transaction commits.
 * @throws {Error} TENANT_SCOPE_INVALID for an invalid scope. Database and callback failures propagate and roll back the transaction.
 *
 * @example
 * ```ts
 * const records = await withTenantTransaction(database, scope,
 *   (transaction) => listProjects(transaction, scope, 20, undefined),
 * );
 * ```
 */
export function withTenantTransaction<Result>(
  database: DatabaseRuntime,
  scope: TenantScope,
  run: (transaction: TenantTransaction) => Promise<Result>,
): Promise<Result> {
  const parsed = v.safeParse(tenantScopeSchema, scope);

  if (!parsed.success) {
    throw new Error('TENANT_SCOPE_INVALID: invalid tenant transaction scope');
  }

  return database.db.transaction(async (transaction) => {
    await setTenantScope(transaction, parsed.output);
    return run(transaction);
  });
}

/**
 * Sets transaction-local PostgreSQL tenant identifiers for row-level security.
 *
 * Missing project and environment identifiers are cleared. The caller must validate
 * the scope and check authority before setting this context.
 *
 * @param transaction - Active transaction whose context will be changed.
 * @param scope - Validated and authorized organization, project, or environment scope.
 * @returns Resolves after all context settings have been applied.
 * @throws {Error} Database execution failures propagate.
 *
 * @example
 * ```ts
 * await setTenantScope(transaction, scope);
 * ```
 */
export async function setTenantScope(
  transaction: TenantTransaction,
  scope: TenantScope,
): Promise<void> {
  const projectId = scope.kind === 'organization' ? '' : scope.projectId;
  const environmentId = scope.kind === 'environment' ? scope.environmentId : '';

  await transaction.execute(sql`SELECT
    set_config('pipong.organization_id', ${scope.organizationId}, true),
    set_config('pipong.project_id', ${projectId}, true),
    set_config('pipong.environment_id', ${environmentId}, true)`);
}

/**
 * Bounds event-reader SQL and lock waits within the current transaction.
 * @param transaction - Active event-read transaction, before authority checks.
 * @returns Resolves after one-second statement and 250-millisecond lock limits are set.
 * @throws {Error} Database execution failures propagate.
 * @example
 * ```ts
 * await setEventReadBudget(transaction);
 * ```
 */
export async function setEventReadBudget(transaction: TenantTransaction): Promise<void> {
  await transaction.execute(sql`SELECT
    set_config('statement_timeout', '1000', true),
    set_config('lock_timeout', '250', true)`);
}
