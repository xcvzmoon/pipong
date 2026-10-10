import type { NotificationStatusRow } from '@pipong/database/observation';
import type { EnvironmentScope } from '@pipong/database/recipients';
import type { TenantTransaction } from '@pipong/database/tenancy';
import {
  listNotificationDeliveryStatuses,
  listNotificationStatuses,
  readDeliveryOutcome,
  readNotificationStatus,
} from '@pipong/database/observation';
import { readResourceCursor, resourcePage } from './resources.ts';

export type NotificationSummary = {
  id: string;
  acceptedAt: string;
  expiresAt: string;
  canceledAt: string | null;
  deliveryCount: number;
  counts: {
    pending: number;
    providerAccepted: number;
    failed: number;
    expired: number;
    canceled: number;
  };
  providerAcceptance: { apns: number; fcm: number; webPush: number };
};

export type ObservationPage<Value> = { items: Value[]; nextCursor: string | null };
export type ObservationResult<Value> =
  | { ok: true; value: Value }
  | {
      ok: false;
      status: 404 | 422;
      code: 'NOTIFICATION_NOT_FOUND' | 'DELIVERY_NOT_FOUND' | 'RESOURCE_CURSOR_INVALID';
    };

function mapNotificationSummary(row: NotificationStatusRow): NotificationSummary {
  return {
    id: row.id,
    acceptedAt: row.acceptedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    canceledAt: row.canceledAt?.toISOString() ?? null,
    deliveryCount: row.deliveryCount,
    counts: {
      pending: row.pendingCount,
      providerAccepted: row.providerAcceptedCount,
      failed: row.failedCount,
      expired: row.expiredCount,
      canceled: row.canceledCount,
    },
    providerAcceptance: {
      apns: row.apnsAcceptedCount,
      fcm: row.fcmAcceptedCount,
      webPush: row.webPushAcceptedCount,
    },
  };
}

/**
 * Lists notification summaries from statement-consistent delivery aggregates.
 * @param transaction - Authorized notification read transaction.
 * @param scope - Owning environment.
 * @param limit - Validated page size from 1 to 100.
 * @param cursor - Optional cursor returned by the previous page.
 * @returns A status page, or a 422 result for a malformed or mismatched cursor.
 * @throws {Error} Database failures propagate to the caller.
 * @example
 * ```ts
 * const page = await listNotificationSummaries(transaction, scope, 50, undefined);
 * ```
 */
export async function listNotificationSummaries(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  limit: number,
  cursor: string | undefined,
): Promise<ObservationResult<ObservationPage<NotificationSummary>>> {
  const collectionScope = { ...scope, collection: 'notifications' } as const;
  const afterId = readResourceCursor(collectionScope, cursor);
  if (afterId === false) {
    return { ok: false, status: 422, code: 'RESOURCE_CURSOR_INVALID' };
  }
  const rows = await listNotificationStatuses(transaction, scope, limit + 1, afterId);
  const page = resourcePage(collectionScope, rows, limit);
  return {
    ok: true,
    value: {
      items: page.items.map((row) => mapNotificationSummary(row)),
      nextCursor: page.nextCursor,
    },
  };
}

/**
 * Reads one notification summary with delivery counts from a single database snapshot.
 * @param transaction - Authorized notification read transaction.
 * @param scope - Owning environment.
 * @param notificationId - Notification UUID to read.
 * @returns The summary, or a scoped not-found result.
 * @throws {Error} Database failures propagate to the caller.
 * @example
 * ```ts
 * const result = await readNotificationSummary(transaction, scope, notificationId);
 * ```
 */
export async function readNotificationSummary(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  notificationId: string,
): Promise<ObservationResult<NotificationSummary>> {
  const row = await readNotificationStatus(transaction, scope, notificationId);
  if (!row) {
    return { ok: false, status: 404, code: 'NOTIFICATION_NOT_FOUND' };
  }
  return { ok: true, value: mapNotificationSummary(row) };
}

export type DeliveryStatus = {
  id: string;
  provider: 'apns' | 'fcm' | 'web-push';
  state:
    | 'queued'
    | 'sending'
    | 'retry_wait'
    | 'provider_accepted'
    | 'failed'
    | 'expired'
    | 'canceled';
};

/**
 * Lists delivery outcomes for a notification with a cursor bound to its scope and collection.
 * @param transaction - Authorized delivery read transaction.
 * @param scope - Owning environment.
 * @param notificationId - Parent notification UUID.
 * @param limit - Validated page size from 1 to 100.
 * @param cursor - Optional cursor returned by the previous page.
 * @returns A delivery page, or a scoped not-found or cursor failure.
 * @throws {Error} Database failures propagate to the caller.
 * @example
 * ```ts
 * const page = await listNotificationDeliveries(transaction, scope, id, 50, undefined);
 * ```
 */
export async function listNotificationDeliveries(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  notificationId: string,
  limit: number,
  cursor: string | undefined,
): Promise<ObservationResult<ObservationPage<DeliveryStatus>>> {
  const collectionScope = { ...scope, collection: 'deliveries', parentId: notificationId } as const;
  const afterId = readResourceCursor(collectionScope, cursor);
  if (afterId === false) {
    return { ok: false, status: 422, code: 'RESOURCE_CURSOR_INVALID' };
  }
  const notification = await readNotificationStatus(transaction, scope, notificationId);
  if (!notification) {
    return { ok: false, status: 404, code: 'NOTIFICATION_NOT_FOUND' };
  }
  const rows = await listNotificationDeliveryStatuses(
    transaction,
    scope,
    notificationId,
    limit + 1,
    afterId,
  );
  const page = resourcePage(collectionScope, rows, limit);
  return {
    ok: true,
    value: {
      items: page.items.map(({ id, provider, state }) => ({ id, provider, state })),
      nextCursor: page.nextCursor,
    },
  };
}

export type DeliveryOutcome = {
  id: string;
  provider: 'apns' | 'fcm' | 'web-push';
  state: DeliveryStatus['state'];
  attempts: {
    generation: number;
    retryCount: number;
    startedAt: string;
    finishedAt: string | null;
    outcome: 'accepted' | 'permanent' | 'transient' | 'ambiguous' | null;
  }[];
};

/**
 * Reads delivery state and redacted attempt metadata. Job IDs, payloads, tokens, codes, and receipts are omitted.
 * @param transaction - Authorized delivery read transaction.
 * @param scope - Owning environment.
 * @param deliveryId - Delivery UUID to read.
 * @returns The safe outcome, or a scoped not-found result.
 * @throws {Error} Database failures propagate to the caller.
 * @example
 * ```ts
 * const result = await readDeliveryStatus(transaction, scope, deliveryId);
 * ```
 */
export async function readDeliveryStatus(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  deliveryId: string,
): Promise<ObservationResult<DeliveryOutcome>> {
  const outcome = await readDeliveryOutcome(transaction, scope, deliveryId);
  if (!outcome) {
    return { ok: false, status: 404, code: 'DELIVERY_NOT_FOUND' };
  }
  return {
    ok: true,
    value: {
      id: outcome.id,
      provider: outcome.provider,
      state: outcome.state,
      attempts: outcome.attempts.map((attempt) => ({
        generation: attempt.generation,
        retryCount: attempt.retryCount,
        startedAt: attempt.startedAt.toISOString(),
        finishedAt: attempt.finishedAt?.toISOString() ?? null,
        outcome: attempt.outcome,
      })),
    },
  };
}
