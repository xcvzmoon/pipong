import type { TenantScope, TenantTransaction } from '../tenancy/index.ts';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { projects } from '../tenancy/schema.ts';

export type OrganizationScope = Extract<TenantScope, { kind: 'organization' }>;
export type ProjectRecord = typeof projects.$inferSelect;

/**
 * Inserts a project without raising a scoped name conflict.
 *
 * @param transaction - Active transaction with the tenant context already set.
 * @param scope - Owning organization; this function does not check caller authority.
 * @param name - Validated resource name.
 * @returns The inserted record, or undefined when the scoped name conflicts.
 * @throws {Error} Database errors propagate.
 *
 * @example
 * ```ts
 * const records = await createProject(transaction, scope, 'Production');
 * console.info(records);
 * ```
 */
export async function createProject(
  transaction: TenantTransaction,
  scope: OrganizationScope,
  name: string,
): Promise<ProjectRecord | undefined> {
  const [record] = await transaction
    .insert(projects)
    .values({ organizationId: scope.organizationId, name })
    .onConflictDoNothing({ target: [projects.organizationId, projects.name] })
    .returning();

  return record;
}

/**
 * Selects undeleted projects in ascending ID order.
 *
 * @param transaction - Active transaction with the tenant context already set.
 * @param scope - Owning organization; this function does not check caller authority.
 * @param limit - Maximum number of records to fetch.
 * @param afterId - Exclusive ID boundary, or undefined to start at the first record.
 * @returns Matching records, including suspended records.
 * @throws {Error} Database errors propagate.
 *
 * @example
 * ```ts
 * const records = await listProjects(transaction, scope, 21, undefined);
 * console.info(records);
 * ```
 */
export function listProjects(
  transaction: TenantTransaction,
  scope: OrganizationScope,
  limit: number,
  afterId: string | undefined,
): Promise<ProjectRecord[]> {
  return transaction
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.organizationId, scope.organizationId),
        isNull(projects.deletedAt),
        afterId ? gt(projects.id, afterId) : undefined,
      ),
    )
    .orderBy(asc(projects.id))
    .limit(limit);
}

/**
 * Selects one undeleted project within the supplied scope.
 *
 * @param transaction - Active transaction with the tenant context already set.
 * @param scope - Owning organization; this function does not check caller authority.
 * @param id - Project ID within the supplied scope.
 * @returns The matching record, or undefined when it is missing, deleted, or outside the scope.
 * @throws {Error} Database errors propagate.
 *
 * @example
 * ```ts
 * const records = await readProject(transaction, scope, id);
 * console.info(records);
 * ```
 */
export async function readProject(
  transaction: TenantTransaction,
  scope: OrganizationScope,
  id: string,
): Promise<ProjectRecord | undefined> {
  const [record] = await transaction
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.organizationId, scope.organizationId),
        eq(projects.id, id),
        isNull(projects.deletedAt),
      ),
    );

  return record;
}

/**
 * Updates the name of an undeleted project.
 *
 * @param transaction - Active transaction with the tenant context already set.
 * @param scope - Owning organization; this function does not check caller authority.
 * @param id - Project ID within the supplied scope.
 * @param name - Validated resource name.
 * @returns The matching record, or undefined when it is missing, deleted, or outside the scope.
 * @throws {Error} Database errors propagate, including scoped name conflicts.
 *
 * @example
 * ```ts
 * const records = await renameProject(transaction, scope, id, 'Production');
 * console.info(records);
 * ```
 */
export async function renameProject(
  transaction: TenantTransaction,
  scope: OrganizationScope,
  id: string,
  name: string,
): Promise<ProjectRecord | undefined> {
  const [record] = await transaction
    .update(projects)
    .set({ name })
    .where(
      and(
        eq(projects.organizationId, scope.organizationId),
        eq(projects.id, id),
        isNull(projects.deletedAt),
      ),
    )
    .returning();

  return record;
}

/**
 * Sets the suspension time once for an undeleted project.
 *
 * @param transaction - Active transaction with the tenant context already set.
 * @param scope - Owning organization; this function does not check caller authority.
 * @param id - Project ID within the supplied scope.
 * @returns The matching record, or undefined when it is missing, deleted, or outside the scope.
 * @throws {Error} Database errors propagate.
 *
 * @example
 * ```ts
 * const records = await suspendProject(transaction, scope, id);
 * console.info(records);
 * ```
 */
export async function suspendProject(
  transaction: TenantTransaction,
  scope: OrganizationScope,
  id: string,
): Promise<ProjectRecord | undefined> {
  const [record] = await transaction
    .update(projects)
    .set({ suspendedAt: sql`coalesce(${projects.suspendedAt}, now())` })
    .where(
      and(
        eq(projects.organizationId, scope.organizationId),
        eq(projects.id, id),
        isNull(projects.deletedAt),
      ),
    )
    .returning();

  return record;
}

export { isResourceNameConflict } from './errors.ts';
