import type { TenantScope, TenantTransaction } from '../tenancy/index.ts';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { environments } from '../tenancy/schema.ts';

export type ProjectScope = Extract<TenantScope, { kind: 'project' }>;
export type EnvironmentRecord = typeof environments.$inferSelect;

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
