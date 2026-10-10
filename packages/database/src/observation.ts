import type { EnvironmentScope } from './recipients/index.ts';
import type { TenantTransaction } from './tenancy/index.ts';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { deliveryAttempts } from './attempts-schema.ts';
import { deliveries, notifications } from './submission-schema.ts';

export type NotificationStatusRow = {
  id: string;
  acceptedAt: Date;
  expiresAt: Date;
  canceledAt: Date | null;
  deliveryCount: number;
  pendingCount: number;
  providerAcceptedCount: number;
  failedCount: number;
  expiredCount: number;
  canceledCount: number;
  apnsAcceptedCount: number;
  fcmAcceptedCount: number;
  webPushAcceptedCount: number;
};

const notificationStatusSelection = {
  id: notifications.id,
  acceptedAt: notifications.acceptedAt,
  expiresAt: notifications.expiresAt,
  canceledAt: notifications.canceledAt,
  deliveryCount: sql<number>`count(${deliveries.id})::int`.mapWith(Number),
  pendingCount:
    sql<number>`count(*) FILTER (WHERE ${deliveries.state} IN ('queued', 'sending', 'retry_wait'))::int`.mapWith(
      Number,
    ),
  providerAcceptedCount:
    sql<number>`count(*) FILTER (WHERE ${deliveries.state} = 'provider_accepted')::int`.mapWith(
      Number,
    ),
  failedCount: sql<number>`count(*) FILTER (WHERE ${deliveries.state} = 'failed')::int`.mapWith(
    Number,
  ),
  expiredCount: sql<number>`count(*) FILTER (WHERE ${deliveries.state} = 'expired')::int`.mapWith(
    Number,
  ),
  canceledCount: sql<number>`count(*) FILTER (WHERE ${deliveries.state} = 'canceled')::int`.mapWith(
    Number,
  ),
  apnsAcceptedCount:
    sql<number>`count(*) FILTER (WHERE ${deliveries.state} = 'provider_accepted' AND ${deliveries.provider} = 'apns')::int`.mapWith(
      Number,
    ),
  fcmAcceptedCount:
    sql<number>`count(*) FILTER (WHERE ${deliveries.state} = 'provider_accepted' AND ${deliveries.provider} = 'fcm')::int`.mapWith(
      Number,
    ),
  webPushAcceptedCount:
    sql<number>`count(*) FILTER (WHERE ${deliveries.state} = 'provider_accepted' AND ${deliveries.provider} = 'web-push')::int`.mapWith(
      Number,
    ),
};

/**
 * Reads notification status and delivery counts from one PostgreSQL statement snapshot.
 * @param transaction - Authorized notification read transaction.
 * @param scope - Owning environment.
 * @param notificationId - Notification UUID to read.
 * @returns Aggregate status, or undefined when the notification is outside this scope.
 * @throws {Error} Database failures propagate to the caller.
 * @example
 * ```ts
 * const summary = await readNotificationStatus(transaction, scope, notificationId);
 * ```
 */
export async function readNotificationStatus(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  notificationId: string,
): Promise<NotificationStatusRow | undefined> {
  const [summary] = await transaction
    .select(notificationStatusSelection)
    .from(notifications)
    .leftJoin(deliveries, eq(deliveries.notificationId, notifications.id))
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.organizationId, scope.organizationId),
        eq(notifications.projectId, scope.projectId),
        eq(notifications.environmentId, scope.environmentId),
      ),
    )
    .groupBy(notifications.id);
  return summary;
}

/**
 * Lists notification status rows in stable UUID order for cursor pagination.
 * @param transaction - Authorized notification read transaction.
 * @param scope - Owning environment.
 * @param limit - Maximum rows to return; callers request one extra to detect another page.
 * @param afterId - Exclusive UUID boundary from a scope-bound resource cursor.
 * @returns Status rows ordered by notification UUID.
 * @throws {Error} Database failures propagate to the caller.
 * @example
 * ```ts
 * const rows = await listNotificationStatuses(transaction, scope, 51, undefined);
 * ```
 */
export function listNotificationStatuses(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  limit: number,
  afterId: string | undefined,
): Promise<NotificationStatusRow[]> {
  return transaction
    .select(notificationStatusSelection)
    .from(notifications)
    .leftJoin(deliveries, eq(deliveries.notificationId, notifications.id))
    .where(
      and(
        eq(notifications.organizationId, scope.organizationId),
        eq(notifications.projectId, scope.projectId),
        eq(notifications.environmentId, scope.environmentId),
        afterId ? gt(notifications.id, afterId) : undefined,
      ),
    )
    .groupBy(notifications.id)
    .orderBy(asc(notifications.id))
    .limit(limit);
}

export type DeliveryStatusRow = {
  id: string;
  provider: typeof deliveries.$inferSelect.provider;
  state: typeof deliveries.$inferSelect.state;
};

/**
 * Lists delivery outcomes for one notification in stable UUID order.
 * @param transaction - Authorized delivery read transaction.
 * @param scope - Owning environment.
 * @param notificationId - Parent notification UUID.
 * @param limit - Maximum rows to return; callers request one extra to detect another page.
 * @param afterId - Exclusive UUID boundary from a scope-bound resource cursor.
 * @returns Delivery IDs and final/current outcome metadata, or an empty list for no matches.
 * @throws {Error} Database failures propagate to the caller.
 * @example
 * ```ts
 * const rows = await listNotificationDeliveryStatuses(transaction, scope, id, 51, undefined);
 * ```
 */
export function listNotificationDeliveryStatuses(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  notificationId: string,
  limit: number,
  afterId: string | undefined,
): Promise<DeliveryStatusRow[]> {
  return transaction
    .select({ id: deliveries.id, provider: deliveries.provider, state: deliveries.state })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.organizationId, scope.organizationId),
        eq(deliveries.projectId, scope.projectId),
        eq(deliveries.environmentId, scope.environmentId),
        eq(deliveries.notificationId, notificationId),
        afterId ? gt(deliveries.id, afterId) : undefined,
      ),
    )
    .orderBy(asc(deliveries.id))
    .limit(limit);
}

export type DeliveryAttemptStatusRow = {
  generation: number;
  retryCount: number;
  startedAt: Date;
  finishedAt: Date | null;
  outcome: typeof deliveryAttempts.$inferSelect.outcome;
};

export type DeliveryOutcomeRow = {
  id: string;
  provider: typeof deliveries.$inferSelect.provider;
  state: typeof deliveries.$inferSelect.state;
  attempts: DeliveryAttemptStatusRow[];
};

/**
 * Reads delivery state and safe attempts from one statement snapshot, excluding job IDs and provider bodies.
 * @param transaction - Authorized delivery read transaction.
 * @param scope - Owning environment.
 * @param deliveryId - Delivery UUID to read.
 * @returns The delivery and its attempts, or undefined when outside this scope.
 * @throws {Error} Database failures propagate to the caller.
 * @example
 * ```ts
 * const outcome = await readDeliveryOutcome(transaction, scope, deliveryId);
 * ```
 */
export async function readDeliveryOutcome(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  deliveryId: string,
): Promise<DeliveryOutcomeRow | undefined> {
  const records = await transaction
    .select({
      delivery: { id: deliveries.id, provider: deliveries.provider, state: deliveries.state },
      attempt: {
        generation: deliveryAttempts.generation,
        retryCount: deliveryAttempts.retryCount,
        startedAt: deliveryAttempts.startedAt,
        finishedAt: deliveryAttempts.finishedAt,
        outcome: deliveryAttempts.outcome,
      },
    })
    .from(deliveries)
    .leftJoin(deliveryAttempts, eq(deliveryAttempts.deliveryId, deliveries.id))
    .where(
      and(
        eq(deliveries.id, deliveryId),
        eq(deliveries.organizationId, scope.organizationId),
        eq(deliveries.projectId, scope.projectId),
        eq(deliveries.environmentId, scope.environmentId),
      ),
    )
    .orderBy(asc(deliveryAttempts.generation));
  const first = records[0];
  if (!first) {
    return undefined;
  }
  const attempts: DeliveryAttemptStatusRow[] = [];
  for (const { attempt } of records) {
    if (attempt) {
      attempts.push(attempt);
    }
  }
  return { ...first.delivery, attempts };
}
