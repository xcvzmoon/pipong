import type { SQL } from 'drizzle-orm';
import type { DeliveryJob } from './delivery-queue.ts';
import type { EnvironmentScope } from './recipients/index.ts';
import type { TenantTransaction } from './tenancy/index.ts';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { publishDeliveryState } from './attempts.ts';
import { deliveries, notifications } from './submission-schema.ts';

export type RecoveryResult<Result> =
  | { ok: true; value: Result }
  | { ok: false; status: 404 | 409 | 429; code: string; retryAfter?: number };
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
