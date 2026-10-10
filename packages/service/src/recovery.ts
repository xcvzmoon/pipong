import type { DatabaseRuntime } from '@pipong/database';
import type { QueueRuntime } from '@pipong/database/delivery-queue';
import type { EnvironmentScope } from '@pipong/database/recipients';
import type { RecoveryResult } from '@pipong/database/recovery';
import type { TenantTransaction } from '@pipong/database/tenancy';
import {
  cancelPendingNotification,
  lockRedriveSource,
  persistDeliveryRedrive,
  reconcileFailedDelivery,
  readFailedDeliveryJobs,
} from '@pipong/database/recovery';
import { withTenantTransaction } from '@pipong/database/tenancy';
import * as v from 'valibot';
import { notificationLimits, notificationRequestSchema } from './notification-contract.ts';

export type { RecoveryResult } from '@pipong/database/recovery';

/**
 * Cancels pending deliveries without retracting a committed send reservation.
 * @param transaction - Authorized notification:cancel transaction.
 * @param scope - Authorized owning environment.
 * @param notificationId - Validated notification UUID.
 * @returns Canceled count or scoped not-found result; repeats return zero newly canceled work.
 * @throws {Error} Database failures roll back cancellation, events, and quota release.
 * @example
 * ```ts
 * const result = await cancelNotification(transaction, scope, notificationId);
 * ```
 */
export function cancelNotification(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  notificationId: string,
): Promise<RecoveryResult<{ notificationId: string; canceledCount: number }>> {
  return cancelPendingNotification(transaction, scope, notificationId);
}

/**
 * Starts a new chain for failed, expired, or canceled work and records actor/reason lineage.
 * Redrive can duplicate an earlier ambiguous send. Each source can be redriven once.
 * @param transaction - Authorized delivery:redrive human transaction with recent MFA and environment lifecycle lock.
 * @param queue - Started queue using the same database.
 * @param scope - Authorized owning environment.
 * @param deliveryId - Validated terminal source delivery UUID.
 * @param expiresAt - Fresh expiry between one second and the configured maximum TTL.
 * @param actorId - Authenticated human user ID.
 * @param reason - Operator reason, one to 500 characters.
 * @returns New notification/delivery/source identities or a scoped eligibility/admission failure.
 * @throws {Error} Database and enqueue failures roll back the new chain and audit.
 * @example
 * ```ts
 * const result = await redriveDelivery(transaction, queue, scope, deliveryId, expiresAt, principal.userId, 'Recovered provider configuration');
 * ```
 */
export async function redriveDelivery(
  transaction: TenantTransaction,
  queue: QueueRuntime,
  scope: EnvironmentScope,
  deliveryId: string,
  expiresAt: Date,
  actorId: string,
  reason: string,
): Promise<
  RecoveryResult<{ notificationId: string; deliveryId: string; sourceDeliveryId: string }>
> {
  const source = await lockRedriveSource(transaction, scope, deliveryId);
  if (!source) {
    return { ok: false, status: 404, code: 'DELIVERY_NOT_FOUND' };
  }
  if (!['failed', 'expired', 'canceled'].includes(source.delivery.state)) {
    return { ok: false, status: 409, code: 'DELIVERY_REDRIVE_NOT_TERMINAL' };
  }
  if (source.alreadyRedriven) {
    return { ok: false, status: 409, code: 'DELIVERY_ALREADY_REDRIVEN' };
  }
  if (!source.target) {
    return { ok: false, status: 409, code: 'DELIVERY_REDRIVE_ENDPOINT_INACTIVE' };
  }
  const remaining = expiresAt.getTime() - source.now.getTime();
  if (
    !Number.isFinite(remaining) ||
    remaining < 1000 ||
    remaining > notificationLimits.ttlSeconds * 1000
  ) {
    return { ok: false, status: 409, code: 'DELIVERY_REDRIVE_EXPIRY_INVALID' };
  }
  if (
    !v.safeParse(v.pipe(v.string(), v.minLength(1), v.maxLength(500)), reason).success ||
    actorId.length === 0
  ) {
    return { ok: false, status: 409, code: 'DELIVERY_REDRIVE_INPUT_INVALID' };
  }
  const original = v.parse(notificationRequestSchema, JSON.parse(source.notification.request));
  const request = {
    ...original,
    expiresAt: expiresAt.toISOString(),
    targets: { kind: 'endpoints', ids: [source.target.id] },
  };
  return persistDeliveryRedrive(
    transaction,
    queue,
    scope,
    source,
    JSON.stringify(request),
    expiresAt,
    actorId,
    reason,
  );
}

/**
 * Reconciles a bounded batch of exhausted queue jobs into visible terminal outcomes.
 * Call periodically from a worker. It performs no provider I/O and is safe across workers.
 * @param database - Worker database runtime with access to retained failed queue jobs.
 * @returns Count of deliveries resolved; repeated scans preserve settled outcomes.
 * @throws {Error} Invalid retained job payloads and database failures propagate without fabricated success.
 * @example
 * ```ts
 * const reconciled = await reconcileDeliveryRecovery(database);
 * ```
 */
export async function reconcileDeliveryRecovery(database: DatabaseRuntime): Promise<number> {
  const rows = await readFailedDeliveryJobs(database);
  let reconciled = 0;
  // oxlint-disable eslint/no-await-in-loop -- Each job owns a separate tenant transaction; batches are bounded.
  for (const { id, data } of rows) {
    const changed = await withTenantTransaction(
      database,
      {
        kind: 'environment',
        organizationId: data.organizationId,
        projectId: data.projectId,
        environmentId: data.environmentId,
      },
      (transaction) => reconcileFailedDelivery(transaction, data, id),
    );
    if (changed) {
      reconciled += 1;
    }
  }
  // oxlint-enable eslint/no-await-in-loop
  return reconciled;
}
