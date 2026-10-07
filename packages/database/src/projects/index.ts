import type { TenantScope, TenantTransaction } from '../tenancy/index.ts';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { projects } from '../tenancy/schema.ts';

export type OrganizationScope = Extract<TenantScope, { kind: 'organization' }>;
export type ProjectRecord = typeof projects.$inferSelect;

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
