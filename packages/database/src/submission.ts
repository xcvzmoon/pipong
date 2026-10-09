import type { EnvironmentScope } from './recipients/index.ts';
import type { TenantTransaction } from './tenancy/index.ts';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { credentialVersions } from './credentials/schema.ts';
import { endpointGenerations, endpoints } from './endpoints/schema.ts';
import { recipients } from './recipients/schema.ts';
import { deliveries, idempotencyRecords, notifications } from './submission-schema.ts';

export type { AcceptanceResponse } from './submission-schema.ts';
export type SubmissionTarget = {
  id: string;
  recipientId: string;
  provider: 'apns' | 'fcm' | 'web-push';
  appId: string;
  installationId: string;
  generation: number;
  credentialId: string;
  encryptedTarget: string;
};
export type NotificationInsert = typeof notifications.$inferInsert;
export type DeliveryInsert = typeof deliveries.$inferInsert;
export type IdempotencyInsert = typeof idempotencyRecords.$inferInsert;
export type IdempotencyRecord = typeof idempotencyRecords.$inferSelect;

/**
 * Serializes acceptance for an environment/key pair through transaction completion.
 * @param transaction - Authorized notification:send transaction.
 * @param scope - Authorized environment.
 * @param key - Validated idempotency key.
 * @returns Database time after acquiring the lock, used for the replay window.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const now = await lockSubmission(transaction, scope, key);
 * ```
 */
export async function lockSubmission(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  key: string,
): Promise<Date> {
  await transaction.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([scope.organizationId, scope.projectId, scope.environmentId, key])}, 0))`,
  );
  const [clock] = await transaction
    .select({ now: sql`clock_timestamp()`.mapWith(notifications.acceptedAt) })
    .from(sql`(SELECT 1) AS clock`);
  if (!clock) {
    throw new Error('SUBMISSION_CLOCK_UNAVAILABLE: database clock unavailable');
  }
  return clock.now;
}

/**
 * Reads the original acceptance without resolving endpoint targets again.
 * @param transaction - Authorized transaction holding the submission lock.
 * @param scope - Owning environment.
 * @param key - Validated idempotency key.
 * @returns Stored record, including its fingerprint and expiry, or undefined.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const existing = await readIdempotencyRecord(transaction, scope, key);
 * ```
 */
export async function readIdempotencyRecord(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  key: string,
): Promise<IdempotencyRecord | undefined> {
  const [record] = await transaction
    .select()
    .from(idempotencyRecords)
    .where(
      and(
        eq(idempotencyRecords.organizationId, scope.organizationId),
        eq(idempotencyRecords.projectId, scope.projectId),
        eq(idempotencyRecords.environmentId, scope.environmentId),
        eq(idempotencyRecords.key, key),
      ),
    );
  return record;
}

/**
 * Resolves active endpoints and credentials under the environment lifecycle lock.
 * The bounded query returns one extra row so callers can reject excessive expansion.
 * @param transaction - Authorized transaction holding the environment share lock.
 * @param scope - Owning environment.
 * @param kind - Explicit recipient or endpoint selection.
 * @param ids - Validated target UUIDs.
 * @param limit - Expansion limit plus one.
 * @returns Ordered, unique endpoint snapshots; inactive and foreign targets are omitted.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const targets = await resolveSubmissionTargets(transaction, scope, 'recipients', ids, 1001);
 * ```
 */
export function resolveSubmissionTargets(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  kind: 'recipients' | 'endpoints',
  ids: string[],
  limit: number,
): Promise<SubmissionTarget[]> {
  return transaction
    .select({
      id: endpoints.id,
      recipientId: endpoints.recipientId,
      provider: endpoints.provider,
      appId: endpoints.appId,
      installationId: endpoints.installationId,
      generation: endpoints.generation,
      credentialId: endpoints.credentialId,
      encryptedTarget: endpointGenerations.encryptedTarget,
    })
    .from(endpoints)
    .innerJoin(recipients, eq(recipients.id, endpoints.recipientId))
    .innerJoin(credentialVersions, eq(credentialVersions.id, endpoints.credentialId))
    .innerJoin(
      endpointGenerations,
      and(
        eq(endpointGenerations.endpointId, endpoints.id),
        eq(endpointGenerations.generation, endpoints.generation),
        eq(endpointGenerations.credentialId, endpoints.credentialId),
      ),
    )
    .where(
      and(
        eq(endpoints.organizationId, scope.organizationId),
        eq(endpoints.projectId, scope.projectId),
        eq(endpoints.environmentId, scope.environmentId),
        eq(endpoints.state, 'active'),
        isNull(recipients.deletedAt),
        eq(credentialVersions.state, 'active'),
        kind === 'recipients' ? inArray(endpoints.recipientId, ids) : inArray(endpoints.id, ids),
      ),
    )
    .orderBy(asc(endpoints.id))
    .limit(limit)
    .for('share', { of: recipients });
}

/**
 * Persists immutable acceptance, endpoint snapshots, and the seven-day replay response.
 * The caller must reserve admission first and append events/enqueue before commit.
 * @param transaction - Authorized transaction holding the submission lock.
 * @param notification - Immutable validated request and acceptance metadata.
 * @param targets - Deduplicated delivery generation bindings.
 * @param idempotency - Fingerprint and original response; replaces only an expired record checked by the caller.
 * @returns Resolves after application rows are inserted, before transaction commit.
 * @throws {Error} Database failures propagate and must roll back acceptance.
 * @example
 * ```ts
 * await persistSubmission(transaction, notification, targets, idempotency);
 * ```
 */
export async function persistSubmission(
  transaction: TenantTransaction,
  notification: NotificationInsert,
  targets: DeliveryInsert[],
  idempotency: IdempotencyInsert,
): Promise<void> {
  await transaction.insert(notifications).values(notification);
  await transaction.insert(deliveries).values(targets);
  await transaction
    .insert(idempotencyRecords)
    .values(idempotency)
    .onConflictDoUpdate({
      target: [
        idempotencyRecords.organizationId,
        idempotencyRecords.projectId,
        idempotencyRecords.environmentId,
        idempotencyRecords.key,
      ],
      set: {
        fingerprint: idempotency.fingerprint,
        notificationId: idempotency.notificationId,
        response: idempotency.response,
        expiresAt: idempotency.expiresAt,
      },
    });
}
