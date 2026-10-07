import type { TenantScope, TenantTransaction } from '../tenancy/index.ts';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { apikeys } from '../auth/schema.ts';
import { serviceKeyAudits, serviceKeyGrants } from '../authorization/schema.ts';

export type EnvironmentScope = Extract<TenantScope, { kind: 'environment' }>;
export type ServiceKeyRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  environmentId: string;
  name: string | null;
  actions: string[];
  enabled: boolean | null;
  expiresAt: Date | null;
  createdAt: Date;
  rotatedAt: Date | null;
};
export type ServiceKeyAudit = typeof serviceKeyAudits.$inferInsert;

const metadata = {
  id: apikeys.id,
  organizationId: serviceKeyGrants.organizationId,
  projectId: serviceKeyGrants.projectId,
  environmentId: serviceKeyGrants.environmentId,
  name: apikeys.name,
  actions: serviceKeyGrants.actions,
  enabled: apikeys.enabled,
  expiresAt: apikeys.expiresAt,
  createdAt: apikeys.createdAt,
  rotatedAt: serviceKeyGrants.rotatedAt,
};

function keyScope(scope: EnvironmentScope): ReturnType<typeof and> {
  return and(
    eq(serviceKeyGrants.organizationId, scope.organizationId),
    eq(serviceKeyGrants.projectId, scope.projectId),
    eq(serviceKeyGrants.environmentId, scope.environmentId),
    eq(apikeys.referenceId, scope.organizationId),
    eq(apikeys.configId, 'default'),
    isNull(apikeys.deletedAt),
    isNull(serviceKeyGrants.deletedAt),
  );
}

/**
 * Inserts an immutable environment grant for a newly issued organization key.
 *
 * @param transaction - Authorized transaction containing the auth key insertion.
 * @param scope - Environment that owns the grant.
 * @param keyId - Auth key ID with matching organization ownership.
 * @param actions - Validated service-key actions.
 * @returns Resolves after insertion; no secret is stored in the grant.
 * @throws {Error} Database failures roll back issuance and binding together.
 * @example
 * ```ts
 * await bindServiceKey(transaction, scope, keyId, ['notification:send']);
 * ```
 */
export async function bindServiceKey(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  keyId: string,
  actions: string[],
): Promise<void> {
  await transaction.insert(serviceKeyGrants).values({
    keyId,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    environmentId: scope.environmentId,
    actions,
  });
}

/**
 * Lists key metadata in ascending UUID order without selecting credential material.
 *
 * @param transaction - Authorized tenant transaction.
 * @param scope - Environment to list.
 * @param limit - Maximum rows to fetch, including any pagination lookahead.
 * @param afterId - Exclusive last ID, or undefined for the first page.
 * @returns Scoped key metadata, including expired and revoked keys.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const records = await listServiceKeys(transaction, scope, 51, undefined);
 * ```
 */
export function listServiceKeys(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  limit: number,
  afterId: string | undefined,
): Promise<ServiceKeyRecord[]> {
  return transaction
    .select(metadata)
    .from(apikeys)
    .innerJoin(serviceKeyGrants, eq(serviceKeyGrants.keyId, apikeys.id))
    .where(and(keyScope(scope), afterId ? gt(apikeys.id, afterId) : undefined))
    .orderBy(asc(apikeys.id))
    .limit(limit);
}

/**
 * Locks an auth key before its grant, matching the authorization lock order.
 *
 * @param transaction - Authorized transaction containing the lifecycle mutation.
 * @param scope - Environment that must own the key.
 * @param keyId - Key to lock.
 * @returns Metadata, or undefined when ownership or binding does not match.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const record = await lockServiceKey(transaction, scope, keyId);
 * ```
 */
export async function lockServiceKey(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  keyId: string,
): Promise<ServiceKeyRecord | undefined> {
  const [key] = await transaction
    .select({ id: apikeys.id })
    .from(apikeys)
    .where(
      and(
        eq(apikeys.id, keyId),
        eq(apikeys.referenceId, scope.organizationId),
        eq(apikeys.configId, 'default'),
        isNull(apikeys.deletedAt),
      ),
    )
    .for('update');

  if (!key) {
    return undefined;
  }

  const [record] = await transaction
    .select(metadata)
    .from(apikeys)
    .innerJoin(serviceKeyGrants, eq(serviceKeyGrants.keyId, apikeys.id))
    .where(and(keyScope(scope), eq(apikeys.id, keyId)))
    .for('update', { of: serviceKeyGrants });

  return record;
}

/**
 * Shortens the old key's lifetime and records that it has been rotated.
 *
 * @param transaction - Transaction holding the key and grant update locks.
 * @param keyId - Locked key ID.
 * @param expiresAt - Cutoff no later than the original expiry.
 * @param now - Rotation time; equal cutoff disables the key immediately.
 * @returns Resolves after both updates.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * await retireServiceKey(transaction, keyId, now, now);
 * ```
 */
export async function retireServiceKey(
  transaction: TenantTransaction,
  keyId: string,
  expiresAt: Date,
  now: Date,
): Promise<void> {
  await transaction
    .update(apikeys)
    .set({ expiresAt, enabled: expiresAt > now, updatedAt: now })
    .where(eq(apikeys.id, keyId));
  await transaction
    .update(serviceKeyGrants)
    .set({ rotatedAt: now, updatedAt: now })
    .where(eq(serviceKeyGrants.keyId, keyId));
}

/**
 * Disables a locked key without deleting its metadata or grants.
 *
 * @param transaction - Transaction holding the key update lock.
 * @param keyId - Locked key ID.
 * @returns Resolves after the key is disabled.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * await revokeServiceKey(transaction, keyId);
 * ```
 */
export async function revokeServiceKey(
  transaction: TenantTransaction,
  keyId: string,
): Promise<void> {
  await transaction.update(apikeys).set({ enabled: false }).where(eq(apikeys.id, keyId));
}

/**
 * Appends a key lifecycle audit without storing credential material.
 *
 * @param transaction - Transaction containing the associated lifecycle change.
 * @param entry - Actor, scope, action, key ID, and optional replacement ID.
 * @returns Resolves after insertion.
 * @throws {Error} Database failures roll back the lifecycle change.
 * @example
 * ```ts
 * await auditServiceKey(transaction, entry);
 * ```
 */
export async function auditServiceKey(
  transaction: TenantTransaction,
  entry: ServiceKeyAudit,
): Promise<void> {
  await transaction.insert(serviceKeyAudits).values(entry);
}
