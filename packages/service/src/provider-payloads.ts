import type { NotificationRequest, NotificationResult } from './notification-contract.ts';
import { notificationFailure, notificationLimits } from './notification-contract.ts';

export type PayloadDestination =
  | { provider: 'apns'; topic: string }
  | { provider: 'fcm'; target: { kind: 'fid' | 'registration-token'; value: string } }
  | { provider: 'web-push' };
export type DeliveryIdentity = { notificationId: string; deliveryId: string };
export type ProviderPayload =
  | {
      provider: 'apns';
      body: string;
      bytes: number;
      headers: {
        'apns-topic': string;
        'apns-push-type': 'alert' | 'background';
        'apns-priority': '5' | '10';
        'apns-expiration': string;
        'apns-collapse-id'?: string;
      };
    }
  | { provider: 'fcm'; body: string; bytes: number }
  | {
      provider: 'web-push';
      body: string;
      bytes: number;
      options: {
        TTL: number;
        urgency: 'very-low' | 'low' | 'normal' | 'high';
        topic?: string;
        contentEncoding: 'aes128gcm';
      };
    };

/**
 * Encodes a validated request for one bound endpoint, including deduplication IDs.
 * Credentials supply APNs topic; callers cannot override provider identity or targets.
 * Recompute before each attempt so provider TTL never extends the absolute expiry.
 * @param request - Output of parseNotificationRequest.
 * @param destination - Provider and target resolved from the authorized endpoint/credential snapshot.
 * @param identity - Persisted notification and delivery UUIDs, not client-supplied metadata.
 * @param now - Send time in epoch milliseconds.
 * @param requestId - Server-generated correlation ID.
 * @returns Serialized payload and transport options, or an expiry/payload failure. APNs and FCM use a conservative 4096-byte JSON bound; Web Push plaintext is bounded to 3993 bytes.
 * @throws {Error} NOTIFICATION_PROVIDER_UNSUPPORTED if a caller bypasses the destination type.
 * @example
 * ```ts
 * const result = encodeProviderPayload(request, { provider: 'web-push' }, identity, Date.now(), requestId);
 * ```
 */
export function encodeProviderPayload(
  request: NotificationRequest,
  destination: PayloadDestination,
  identity: DeliveryIdentity,
  now: number,
  requestId: string,
): NotificationResult<ProviderPayload> {
  const remaining = Date.parse(request.expiresAt) - now;
  const ttl = Math.floor(remaining / 1000);
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(ttl) ||
    ttl < 1 ||
    remaining > notificationLimits.ttlSeconds * 1000
  ) {
    return notificationFailure('NOTIFICATION_EXPIRY_INVALID', requestId);
  }

  const data = { ...request.content.data, ...identity };
  switch (destination.provider) {
    case 'apns': {
      const override = request.overrides.apns;
      const pushType = override?.pushType ?? (request.content.alert ? 'alert' : 'background');
      const aps =
        pushType === 'background'
          ? { 'content-available': 1 }
          : {
              alert: request.content.alert,
              sound: override?.pushType === 'alert' ? override.sound : undefined,
              badge: override?.pushType === 'alert' ? override.badge : undefined,
            };
      const body = JSON.stringify({ ...data, aps });
      const bytes = Buffer.byteLength(body);
      if (bytes > 4096) {
        return notificationFailure('NOTIFICATION_PAYLOAD_TOO_LARGE', requestId);
      }

      return {
        ok: true,
        value: {
          provider: 'apns',
          body,
          bytes,
          headers: {
            'apns-topic': destination.topic,
            'apns-push-type': pushType,
            'apns-priority': pushType === 'background' || override?.priority === 5 ? '5' : '10',
            'apns-expiration': String(Math.floor(Date.parse(request.expiresAt) / 1000)),
            'apns-collapse-id': override?.collapseId,
          },
        },
      };
    }
    case 'fcm': {
      const override = request.overrides.fcm;
      const message = {
        fid: destination.target.kind === 'fid' ? destination.target.value : undefined,
        token:
          destination.target.kind === 'registration-token' ? destination.target.value : undefined,
        notification: request.content.alert,
        data,
        android: {
          ttl: `${ttl}s`,
          priority: override?.priority ?? 'NORMAL',
          collapse_key: override?.collapseKey,
        },
        apns: {
          headers: { 'apns-expiration': String(Math.floor(Date.parse(request.expiresAt) / 1000)) },
        },
        webpush: { headers: { TTL: String(ttl) } },
      };
      const serialized = JSON.stringify(message);
      const bytes = Buffer.byteLength(serialized);
      if (bytes > 4096) {
        return notificationFailure('NOTIFICATION_PAYLOAD_TOO_LARGE', requestId);
      }

      return { ok: true, value: { provider: 'fcm', body: JSON.stringify({ message }), bytes } };
    }
    case 'web-push': {
      const body = JSON.stringify({ alert: request.content.alert, data });
      const bytes = Buffer.byteLength(body);
      if (bytes > 3993) {
        return notificationFailure('NOTIFICATION_PAYLOAD_TOO_LARGE', requestId);
      }

      return {
        ok: true,
        value: {
          provider: 'web-push',
          body,
          bytes,
          options: {
            TTL: ttl,
            urgency: request.overrides.webPush?.urgency ?? 'normal',
            topic: request.overrides.webPush?.topic,
            contentEncoding: 'aes128gcm',
          },
        },
      };
    }
    default: {
      return unsupportedProvider(destination);
    }
  }
}

function unsupportedProvider(_provider: never): never {
  throw new Error('NOTIFICATION_PROVIDER_UNSUPPORTED');
}
