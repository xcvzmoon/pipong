import type { TenantScope, TenantTransaction } from '../tenancy/index.ts';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { environments } from '../tenancy/schema.ts';

export type ProjectScope = Extract<TenantScope, { kind: 'project' }>;
export type EnvironmentRecord = typeof environments.$inferSelect;

/**
 * Inserts an environment without raising a scoped name conflict.
 *
 * @param transaction - Active transaction with the tenant context already set.
 * @param scope - Owning project; this function does not check caller authority.
 * @param name - Validated resource name.
 * @returns The inserted record, or undefined when the scoped name conflicts.
 * @throws {Error} Database errors propagate.
 *
 * @example
 * ```ts
 * const records = await createEnvironment(transaction, scope, 'Production');
 * console.info(records);
 * ```
 */
export async function createEnvironment(
  transaction: TenantTransaction,
  scope: ProjectScope,
  name: string,
): Promise<EnvironmentRecord | undefined> {
  const [record] = await transaction
    .insert(environments)
    .values({ organizationId: scope.organizationId, projectId: scope.projectId, name })
    .onConflictDoNothing({
      target: [environments.organizationId, environments.projectId, environments.name],
    })
    .returning();

  return record;
}

/**
 * Selects undeleted environments in ascending ID order.
 *
 * @param transaction - Active transaction with the tenant context already set.
 * @param scope - Owning project; this function does not check caller authority.
 * @param limit - Maximum number of records to fetch.
 * @param afterId - Exclusive ID boundary, or undefined to start at the first record.
 * @returns Matching records, including suspended records.
 * @throws {Error} Database errors propagate.
 *
 * @example
 * ```ts
 * const records = await listEnvironments(transaction, scope, 21, undefined);
 * console.info(records);
 * ```
 */
export function listEnvironments(
  transaction: TenantTransaction,
  scope: ProjectScope,
  limit: number,
  afterId: string | undefined,
): Promise<EnvironmentRecord[]> {
  return transaction
    .select()
    .from(environments)
    .where(
      and(
        eq(environments.organizationId, scope.organizationId),
        eq(environments.projectId, scope.projectId),
        isNull(environments.deletedAt),
        afterId ? gt(environments.id, afterId) : undefined,
      ),
    )
    .orderBy(asc(environments.id))
    .limit(limit);
}

/**
 * Selects one undeleted environment within the supplied scope.
 *
 * @param transaction - Active transaction with the tenant context already set.
 * @param scope - Owning project; this function does not check caller authority.
 * @param id - Environment ID within the supplied scope.
 * @returns The matching record, or undefined when it is missing, deleted, or outside the scope.
 * @throws {Error} Database errors propagate.
 *
 * @example
 * ```ts
 * const records = await readEnvironment(transaction, scope, id);
 * console.info(records);
 * ```
 */
export async function readEnvironment(
  transaction: TenantTransaction,
  scope: ProjectScope,
  id: string,
): Promise<EnvironmentRecord | undefined> {
  const [record] = await transaction
    .select()
    .from(environments)
    .where(
      and(
        eq(environments.organizationId, scope.organizationId),
        eq(environments.projectId, scope.projectId),
        eq(environments.id, id),
        isNull(environments.deletedAt),
      ),
    );

  return record;
}

/**
 * Updates the name of an undeleted environment.
 *
 * @param transaction - Active transaction with the tenant context already set.
 * @param scope - Owning project; this function does not check caller authority.
 * @param id - Environment ID within the supplied scope.
 * @param name - Validated resource name.
 * @returns The matching record, or undefined when it is missing, deleted, or outside the scope.
 * @throws {Error} Database errors propagate, including scoped name conflicts.
 *
 * @example
 * ```ts
 * const records = await renameEnvironment(transaction, scope, id, 'Production');
 * console.info(records);
 * ```
 */
export async function renameEnvironment(
  transaction: TenantTransaction,
  scope: ProjectScope,
  id: string,
  name: string,
): Promise<EnvironmentRecord | undefined> {
  const [record] = await transaction
    .update(environments)
    .set({ name })
    .where(
      and(
        eq(environments.organizationId, scope.organizationId),
        eq(environments.projectId, scope.projectId),
        eq(environments.id, id),
        isNull(environments.deletedAt),
      ),
    )
    .returning();

  return record;
}

/**
 * Sets the suspension time once for an undeleted environment.
 *
 * @param transaction - Active transaction with the tenant context already set.
 * @param scope - Owning project; this function does not check caller authority.
 * @param id - Environment ID within the supplied scope.
 * @returns The matching record, or undefined when it is missing, deleted, or outside the scope.
 * @throws {Error} Database errors propagate.
 *
 * @example
 * ```ts
 * const records = await suspendEnvironment(transaction, scope, id);
 * console.info(records);
 * ```
 */
export async function suspendEnvironment(
  transaction: TenantTransaction,
  scope: ProjectScope,
  id: string,
): Promise<EnvironmentRecord | undefined> {
  const [record] = await transaction
    .update(environments)
    .set({ suspendedAt: sql`coalesce(${environments.suspendedAt}, now())` })
    .where(
      and(
        eq(environments.organizationId, scope.organizationId),
        eq(environments.projectId, scope.projectId),
        eq(environments.id, id),
        isNull(environments.deletedAt),
      ),
    )
    .returning();

  return record;
}
