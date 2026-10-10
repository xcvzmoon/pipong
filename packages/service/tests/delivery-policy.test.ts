import { describe, expect, it } from 'vitest';
import { decideDeliveryRetry } from '../src/delivery-policy.ts';

const now = new Date('2026-10-10T00:00:00Z');
const expiresAt = new Date('2026-10-11T00:00:00Z');

describe('bounded delivery retry policy', () => {
  it.each(['apns', 'fcm', 'web-push'] as const)(
    'applies the %s delay floor and additive jitter',
    (provider) => {
      const floor = provider === 'apns' ? 900_000 : 10_000;
      const result = decideDeliveryRetry(provider, 1, now, expiresAt, now);
      if (result.state !== 'retry_wait') {
        throw new Error('TEST_RETRY_MISSING');
      }
      const delay = result.retryAt.getTime() - now.getTime();
      expect(delay).toBeGreaterThanOrEqual(floor);
      expect(delay).toBeLessThanOrEqual(floor * 1.2);
    },
  );

  it('honors provider Retry-After without scheduling before it', () => {
    const requestedAt = new Date(now.getTime() + 7_200_000);
    const result = decideDeliveryRetry('fcm', 3, requestedAt, expiresAt, now);
    if (result.state !== 'retry_wait') {
      throw new Error('TEST_RETRY_MISSING');
    }
    expect(result.retryAt.getTime()).toBeGreaterThanOrEqual(requestedAt.getTime());
    expect(result.retryAt.getTime()).toBeLessThanOrEqual(requestedAt.getTime() + 8_000);
  });

  it('caps exponential backoff at one hour before jitter', () => {
    const result = decideDeliveryRetry('apns', 7, now, expiresAt, now);
    if (result.state !== 'retry_wait') {
      throw new Error('TEST_RETRY_MISSING');
    }
    const delay = result.retryAt.getTime() - now.getTime();
    expect(delay).toBeGreaterThanOrEqual(3_600_000);
    expect(delay).toBeLessThanOrEqual(4_320_000);
  });

  it('stops on attempt eight, including crash generations', () => {
    expect(decideDeliveryRetry('fcm', 8, now, expiresAt, now)).toEqual({ state: 'failed' });
    expect(decideDeliveryRetry('fcm', 9, now, expiresAt, now)).toEqual({ state: 'failed' });
  });

  it('expires when the current time, provider delay, or minimum delay reaches expiry', () => {
    expect(decideDeliveryRetry('fcm', 1, now, now, now)).toEqual({ state: 'expired' });
    expect(decideDeliveryRetry('fcm', 1, expiresAt, expiresAt, now)).toEqual({ state: 'expired' });
    expect(decideDeliveryRetry('apns', 1, now, new Date(now.getTime() + 900_000), now)).toEqual({
      state: 'expired',
    });
  });
});
