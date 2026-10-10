import type { SQL } from 'drizzle-orm';
import type { DeliveryJob, QueueRuntime } from './delivery-queue.ts';
import type { EnvironmentScope } from './recipients/index.ts';
import type { SubmissionTarget } from './submission.ts';
import type { TenantTransaction } from './tenancy/index.ts';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { v7 } from 'uuid';
import { publishDeliveryState } from './attempts.ts';
import { insertDeliveryJob } from './delivery-queue.ts';
import { appendDeliveryEvent } from './events.ts';
import { reserveAdmission } from './limits.ts';
import { deliveryRedrives } from './recovery-schema.ts';
import { deliveries, notifications } from './submission-schema.ts';
import { resolveSubmissionTargets } from './submission.ts';

export type RecoveryResult<Result> =
  | { ok: true; value: Result }
  | { ok: false; status: 404 | 409 | 429; code: string; retryAfter?: number };
export type RedriveSource = {
  notification: typeof notifications.$inferSelect;
  delivery: typeof deliveries.$inferSelect;
  target: SubmissionTarget | undefined;
  alreadyRedriven: boolean;
  now: Date;
};

function notificationScope(scope: EnvironmentScope, notificationId: string): SQL | undefined {
  return and(
    eq(notifications.id, notificationId),
    eq(notifications.organizationId, scope.organizationId),
    eq(notifications.projectId, scope.projectId),
    eq(notifications.environmentId, scope.environmentId),
  );
}

function deliveryJob(
  scope: EnvironmentScope,
  delivery: typeof deliveries.$inferSelect,
): DeliveryJob {
  return {
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    environmentId: scope.environmentId,
    notificationId: delivery.notificationId,
    deliveryId: delivery.id,
    provider: delivery.provider,
  };
}

/**
 * Cancels only pending work while holding the notification lifecycle lock.
 * A committed send remains in flight; repeat cancellation is safe.
 * @param transaction - Authorized notification:cancel tenant transaction.
 * @param scope - Authorized environment.
 * @param notificationId - Validated notification UUID.
 * @returns Canceled count, or a scoped not-found result.
 * @throws {Error} Database failures roll back cancellation, events, and admission release.
 * @example
 * ```ts
 * const result = await cancelPendingNotification(transaction, scope, notificationId);
 * ```
 */
export async function cancelPendingNotification(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  notificationId: string,
): Promise<RecoveryResult<{ notificationId: string; canceledCount: number }>> {
  const [notification] = await transaction
    .select()
    .from(notifications)
    .where(notificationScope(scope, notificationId))
    .for('update');
  if (!notification) {
    return { ok: false, status: 404, code: 'NOTIFICATION_NOT_FOUND' };
  }
  await transaction
    .update(notifications)
    .set({ canceledAt: notification.canceledAt ?? new Date() })
    .where(eq(notifications.id, notificationId));
  const pending = await transaction
    .select()
    .from(deliveries)
    .where(
      and(
        eq(deliveries.notificationId, notificationId),
        inArray(deliveries.state, ['queued', 'retry_wait']),
      ),
    )
    .orderBy(asc(deliveries.id))
    .for('update');
  // oxlint-disable eslint/no-await-in-loop -- Ordered events and lifecycle writes share one transaction.
  for (const delivery of pending) {
    await transaction
      .update(deliveries)
      .set({ state: 'canceled' })
      .where(eq(deliveries.id, delivery.id));
    await publishDeliveryState(transaction, deliveryJob(scope, delivery), 'canceled');
  }
  // oxlint-enable eslint/no-await-in-loop
  return { ok: true, value: { notificationId, canceledCount: pending.length } };
}

/**
 * Locks redrive input without changing historical notification or attempt rows.
 * Resolve current endpoint eligibility before acquiring the notification lock.
 * @param transaction - Authorized privileged tenant transaction holding environment lifecycle lock.
 * @param scope - Authorized environment.
 * @param deliveryId - Validated source delivery UUID.
 * @returns Locked source and current target, or undefined for missing/foreign work.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const source = await lockRedriveSource(transaction, scope, deliveryId);
 * ```
 */
export async function lockRedriveSource(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  deliveryId: string,
): Promise<RedriveSource | undefined> {
  const [binding] = await transaction
    .select()
    .from(deliveries)
    .where(
      and(
        eq(deliveries.id, deliveryId),
        eq(deliveries.organizationId, scope.organizationId),
        eq(deliveries.projectId, scope.projectId),
        eq(deliveries.environmentId, scope.environmentId),
      ),
    );
  if (!binding) {
    return undefined;
  }
  const [target] = await resolveSubmissionTargets(
    transaction,
    scope,
    'endpoints',
    [binding.endpointId],
    1,
  );
  const [notification] = await transaction
    .select()
    .from(notifications)
    .where(notificationScope(scope, binding.notificationId))
    .for('update');
  const [delivery] = await transaction
    .select()
    .from(deliveries)
    .where(eq(deliveries.id, deliveryId))
    .for('update');
  if (!notification || !delivery) {
    return undefined;
  }
  const [audit] = await transaction
    .select()
    .from(deliveryRedrives)
    .where(eq(deliveryRedrives.sourceDeliveryId, deliveryId));
  const [clock] = await transaction
    .select({ now: sql`clock_timestamp()`.mapWith(notifications.acceptedAt) })
    .from(sql`(SELECT 1) AS clock`);
  if (!clock) {
    throw new Error('DELIVERY_CLOCK_UNAVAILABLE: database clock unavailable');
  }
  return { notification, delivery, target, alreadyRedriven: audit !== undefined, now: clock.now };
}

/**
 * Persists an admitted new chain and its immutable actor/reason lineage.
 * The caller must validate eligibility, request payload, and expiry against locked source.
 * @param transaction - Authorized privileged transaction holding source locks.
 * @param queue - Started queue using the same database.
 * @param scope - Owning environment.
 * @param source - Locked source with an eligible current endpoint.
 * @param request - Validated serialized notification using the fresh expiry and single endpoint.
 * @param expiresAt - Validated fresh absolute expiry.
 * @param actorId - Authenticated human actor.
 * @param reason - Validated operator reason, one to 500 characters.
 * @returns New identities and source lineage, or admission rejection.
 * @throws {Error} DELIVERY_REDRIVE_ENDPOINT_INACTIVE if the target is missing. Database/enqueue failures roll back every write.
 * @example
 * ```ts
 * const result = await persistDeliveryRedrive(transaction, queue, scope, source, request, expiresAt, actorId, reason);
 * ```
 */
export async function persistDeliveryRedrive(
  transaction: TenantTransaction,
  queue: QueueRuntime,
  scope: EnvironmentScope,
  source: RedriveSource,
  request: string,
  expiresAt: Date,
  actorId: string,
  reason: string,
): Promise<
  RecoveryResult<{ notificationId: string; deliveryId: string; sourceDeliveryId: string }>
> {
  const { target } = source;
  if (!target) {
    throw new Error('DELIVERY_REDRIVE_ENDPOINT_INACTIVE');
  }
  const notificationId = v7();
  const deliveryId = v7();
  const admission = await reserveAdmission(
    transaction,
    scope.organizationId,
    null,
    notificationId,
    1,
  );
  if (admission.status === 'rejected') {
    return { ok: false, status: 429, code: admission.code, retryAfter: admission.retryAfter };
  }
  await transaction.insert(notifications).values({
    ...scope,
    id: notificationId,
    request,
    expiresAt,
    acceptedAt: source.now,
    deliveryCount: 1,
  });
  await transaction.insert(deliveries).values({
    ...scope,
    id: deliveryId,
    notificationId,
    endpointId: target.id,
    generation: target.generation,
    credentialId: target.credentialId,
    provider: target.provider,
  });
  await transaction
    .insert(deliveryRedrives)
    .values({ ...scope, sourceDeliveryId: source.delivery.id, deliveryId, actorId, reason });
  await appendDeliveryEvent(transaction, scope, { notificationId, deliveryId, state: 'queued' });
  await insertDeliveryJob(queue, transaction, v7(), {
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    environmentId: scope.environmentId,
    notificationId,
    deliveryId,
    provider: target.provider,
  });
  return { ok: true, value: { notificationId, deliveryId, sourceDeliveryId: source.delivery.id } };
}
