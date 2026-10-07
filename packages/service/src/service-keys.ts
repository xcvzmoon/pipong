import type { Principal, ServiceKeyIssuer } from '@pipong/auth';
import type { EnvironmentScope, ServiceKeyRecord } from '@pipong/database/service-keys';
import type { TenantTransaction } from '@pipong/database/tenancy';
import type { ResourcePage } from './resources.ts';
import {
  auditServiceKey,
  bindServiceKey,
  listServiceKeys as selectServiceKeys,
  lockServiceKey,
  retireServiceKey,
  revokeServiceKey as disableServiceKey,
} from '@pipong/database/service-keys';
import * as v from 'valibot';
import {
  environmentPathSchema,
  readResourceCursor,
  resourceNameSchema,
  resourcePage,
} from './resources.ts';

/** Permissions available to environment-bound backend integrations. */
export const serviceKeyActionSchema = v.picklist([
  'recipient:read',
  'recipient:write',
  'endpoint:read',
  'endpoint:write',
  'notification:read',
  'notification:send',
  'notification:cancel',
  'delivery:read',
  'event:read',
]);
/** Validates issuance, requiring a unique, nonempty grant and expiry in seconds. */
export const serviceKeyInputSchema = v.strictObject({
  name: resourceNameSchema,
  actions: v.pipe(
    v.array(serviceKeyActionSchema),
    v.minLength(1),
    v.maxLength(9),
    v.check((actions) => new Set(actions).size === actions.length),
  ),
  expiresIn: v.pipe(v.number(), v.integer(), v.minValue(60), v.maxValue(31_536_000)),
});
/** Validates rotation; overlap is explicit and cannot exceed one day. */
export const serviceKeyRotationSchema = v.strictObject({
  expiresIn: serviceKeyInputSchema.entries.expiresIn,
  overlapSeconds: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(86_400)),
});
/** Validates a key ID within the full environment route hierarchy. */
export const serviceKeyPathSchema = v.strictObject({
  ...environmentPathSchema.entries,
  keyId: v.pipe(v.string(), v.uuid()),
});
export type ServiceKeyInput = { name: string; actions: string[]; expiresIn: number };
export type ServiceKeyRotation = v.InferOutput<typeof serviceKeyRotationSchema>;
export type ServiceKeyActor = Extract<Principal, { kind: 'human' }>;
export type IssuedServiceKey = { key: string; metadata: ServiceKeyRecord };
export type ServiceKeyResult<Value> =
  | { ok: true; value: Value }
  | {
      ok: false;
      status: 404 | 409 | 422;
      code:
        | 'SERVICE_KEY_NOT_FOUND'
        | 'SERVICE_KEY_INACTIVE'
        | 'SERVICE_KEY_ALREADY_ROTATED'
        | 'RESOURCE_CURSOR_INVALID';
    };

/**
 * Issues a once-visible organization key with an immutable environment grant.
 *
 * @param transaction - Transaction authorized for service-key:manage with recent MFA.
 * @param scope - Existing environment to bind.
 * @param actor - Authorized human who issues the key.
 * @param input - Body validated by serviceKeyInputSchema.
 * @param issue - Better Auth issuer using this same transaction.
 * @returns Secret and redacted metadata, available only after the outer transaction commits.
 * @throws {Error} Issuer or database failures roll back key, grant, and audit together.
 * @example
 * ```ts
 * const issued = await issueServiceKey(transaction, scope, actor, input, auth.issueServiceKey);
 * ```
 */
export async function issueServiceKey(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  actor: ServiceKeyActor,
  input: ServiceKeyInput,
  issue: ServiceKeyIssuer,
): Promise<IssuedServiceKey> {
  const { id, key } = await issue(
    transaction,
    actor.userId,
    scope.organizationId,
    input.name,
    input.expiresIn,
  );
  await bindServiceKey(transaction, scope, id, input.actions);
  const metadata = await lockServiceKey(transaction, scope, id);

  if (!metadata) {
    throw new Error('SERVICE_KEY_BINDING_FAILED: issued key has no matching grant');
  }

  await auditServiceKey(transaction, {
    keyId: id,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    environmentId: scope.environmentId,
    userId: actor.userId,
    sessionId: actor.sessionId,
    action: 'issued',
  });

  return { key, metadata };
}

/**
 * Lists redacted key metadata with an environment-bound cursor.
 *
 * @param transaction - Transaction authorized for service-key:read.
 * @param scope - Environment whose keys are listed.
 * @param limit - Validated page size from 1 to 100.
 * @param cursor - Previous page cursor, or undefined for the first page.
 * @returns Metadata page or RESOURCE_CURSOR_INVALID for a malformed or mismatched cursor.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const result = await listServiceKeys(transaction, scope, 50, undefined);
 * ```
 */
export async function listServiceKeys(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  limit: number,
  cursor: string | undefined,
): Promise<ServiceKeyResult<ResourcePage<ServiceKeyRecord>>> {
  const afterId = readResourceCursor(scope, cursor);

  if (afterId === false) {
    return { ok: false, status: 422, code: 'RESOURCE_CURSOR_INVALID' };
  }

  const records = await selectServiceKeys(transaction, scope, limit + 1, afterId);

  return { ok: true, value: resourcePage(scope, records, limit) };
}

/**
 * Replaces a live key while preserving its grant and shortening its old lifetime.
 *
 * @param transaction - Transaction authorized for service-key:manage with recent MFA.
 * @param scope - Environment that owns the key.
 * @param actor - Authorized human performing rotation.
 * @param keyId - Existing key to rotate once.
 * @param input - Validated replacement lifetime and explicit overlap in seconds.
 * @param issue - Better Auth issuer using the same transaction.
 * @returns Once-visible replacement plus the old key cutoff, or a scoped lifecycle failure.
 * @throws {Error} Issuer or database failures roll back replacement, retirement, and audits together.
 * @example
 * ```ts
 * const result = await rotateServiceKey(transaction, scope, actor, keyId, input, auth.issueServiceKey);
 * ```
 */
export async function rotateServiceKey(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  actor: ServiceKeyActor,
  keyId: string,
  input: ServiceKeyRotation,
  issue: ServiceKeyIssuer,
): Promise<ServiceKeyResult<IssuedServiceKey & { previousKeyExpiresAt: Date }>> {
  const record = await lockServiceKey(transaction, scope, keyId);
  const now = new Date();

  if (!record) {
    return { ok: false, status: 404, code: 'SERVICE_KEY_NOT_FOUND' };
  }

  if (!record.enabled || !record.expiresAt || record.expiresAt <= now || !record.name) {
    return { ok: false, status: 409, code: 'SERVICE_KEY_INACTIVE' };
  }

  if (record.rotatedAt) {
    return { ok: false, status: 409, code: 'SERVICE_KEY_ALREADY_ROTATED' };
  }

  const replacement = await issueServiceKey(
    transaction,
    scope,
    actor,
    { name: record.name, actions: record.actions, expiresIn: input.expiresIn },
    issue,
  );
  const previousKeyExpiresAt = new Date(
    Math.min(record.expiresAt.getTime(), now.getTime() + input.overlapSeconds * 1000),
  );
  await retireServiceKey(transaction, keyId, previousKeyExpiresAt, now);
  await auditServiceKey(transaction, {
    keyId,
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    environmentId: scope.environmentId,
    userId: actor.userId,
    sessionId: actor.sessionId,
    action: 'rotated',
    replacementKeyId: replacement.metadata.id,
  });

  return { ok: true, value: { ...replacement, previousKeyExpiresAt } };
}

/**
 * Revokes one scoped key idempotently and audits its first revocation.
 *
 * @param transaction - Transaction authorized for service-key:manage with recent MFA.
 * @param scope - Environment that owns the key.
 * @param actor - Authorized human revoking the key.
 * @param keyId - Key whose authority must end.
 * @returns The revoked key ID, or SERVICE_KEY_NOT_FOUND for a missing or mismatched key.
 * @throws {Error} Database failures roll back revocation and its audit together.
 * @example
 * ```ts
 * const result = await revokeServiceKey(transaction, scope, actor, keyId);
 * ```
 */
export async function revokeServiceKey(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  actor: ServiceKeyActor,
  keyId: string,
): Promise<ServiceKeyResult<{ id: string; revoked: true }>> {
  const record = await lockServiceKey(transaction, scope, keyId);

  if (!record) {
    return { ok: false, status: 404, code: 'SERVICE_KEY_NOT_FOUND' };
  }

  if (record.enabled) {
    await disableServiceKey(transaction, keyId);
    await auditServiceKey(transaction, {
      keyId,
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      environmentId: scope.environmentId,
      userId: actor.userId,
      sessionId: actor.sessionId,
      action: 'revoked',
    });
  }

  return { ok: true, value: { id: keyId, revoked: true } };
}
