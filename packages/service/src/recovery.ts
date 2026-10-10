import type { EnvironmentScope } from '@pipong/database/recipients';
import type { RecoveryResult } from '@pipong/database/recovery';
import type { TenantTransaction } from '@pipong/database/tenancy';
import { cancelPendingNotification } from '@pipong/database/recovery';

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
