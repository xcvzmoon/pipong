import type { ProviderOutcome, RetryDecision } from '@pipong/database/attempts';
import type { DeliveryJob } from '@pipong/database/delivery-queue';
import { deliveryAttemptLimit } from '@pipong/database/attempts';
import { v7 } from 'uuid';

/**
 * Chooses a bounded successor using provider delay floors and additive jitter.
 * Retry-After is a lower bound; a successor at expiry is never scheduled.
 * @param provider - Provider whose minimum retry delay applies.
 * @param attempt - Persisted attempt generation, including crash recovery sends.
 * @param requestedAt - Earliest time reported by the provider adapter.
 * @param expiresAt - Absolute notification expiry.
 * @param now - Database time after lifecycle locks are acquired.
 * @returns Retry time, or a terminal expired/failed decision at expiry or the attempt cap.
 * @example
 * ```ts
 * const decision = decideDeliveryRetry('fcm', 1, retryAt, expiresAt, now);
 * ```
 */
export function decideDeliveryRetry(
  provider: DeliveryJob['provider'],
  attempt: number,
  requestedAt: Date,
  expiresAt: Date,
  now: Date,
): RetryDecision {
  if (now >= expiresAt || requestedAt >= expiresAt) {
    return { state: 'expired' };
  }
  if (attempt >= deliveryAttemptLimit) {
    return { state: 'failed' };
  }
  const floor = provider === 'apns' ? 900_000 : 10_000;
  const backoff = Math.min(3_600_000, floor * 2 ** Math.min(attempt - 1, 10));
  const jitter = Math.floor(Math.random() * backoff * 0.2);
  const retryAt = new Date(Math.max(requestedAt.getTime(), now.getTime() + backoff) + jitter);
  return retryAt >= expiresAt ? { state: 'expired' } : { state: 'retry_wait', retryAt };
}

export function expiredSendReservation(deadline: Date): ProviderOutcome | undefined {
  const now = Date.now();
  if (deadline.getTime() > now) {
    return undefined;
  }
  return {
    kind: 'transient',
    code: 'DELIVERY_RESERVATION_EXPIRED',
    retryAt: new Date(now + 10_000),
    successorId: v7(),
  };
}
