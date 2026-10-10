import type { DatabaseRuntime } from '@pipong/database';
import type { ProviderOutcome, SendReservation } from '@pipong/database/attempts';
import type { QueueRuntime } from '@pipong/database/delivery-queue';
import type { DestinationResolver, EgressPolicy } from '../egress.ts';
import type { SecretKeyring } from '../secrets.ts';
import { settleDeliveryAttempt } from '@pipong/database/attempts';
import { disableEndpointGeneration, lockEndpointRecipient } from '@pipong/database/endpoints';
import { withTenantTransaction } from '@pipong/database/tenancy';
import { createECDH } from 'node:crypto';
import { v7 } from 'uuid';
import * as v from 'valibot';
import webpush from 'web-push';
import { credentialInputSchema } from '../credentials.ts';
import { endpointInputSchema } from '../endpoints.ts';
import { notificationRequestSchema } from '../notification-contract.ts';
import { encodeProviderPayload } from '../provider-payloads.ts';
import { decryptSecret } from '../secrets.ts';
import { sendWebPushRequest } from '../web-push-transport.ts';

export type WebPushBinding = { credentialId: string; publicKey: string };
export type WebPushReceipt = { status: number; retryAfter: string | null };
export type WebPushOutcome = { outcome: ProviderOutcome; response: WebPushReceipt | null };
type ReservedSend = Extract<SendReservation, { status: 'send' }>;
export type WebPushRuntime = {
  send: (reservation: ReservedSend, keyring: SecretKeyring) => Promise<WebPushOutcome>;
};

function classify(response: WebPushReceipt, now: number): ProviderOutcome {
  const code = `WEB_PUSH_HTTP_${response.status}`;
  if (response.status === 201) {
    return { kind: 'accepted', code: 'WEB_PUSH_ACCEPTED' };
  }
  if (response.status === 429 || response.status >= 500) {
    const seconds = response.retryAfter === null ? NaN : Number(response.retryAfter);
    const hint =
      Number.isFinite(seconds) && seconds >= 0
        ? now + seconds * 1000
        : Date.parse(response.retryAfter ?? '');
    const floor = now + (response.status === 429 ? 60_000 : 10_000);
    return {
      kind: 'transient',
      code,
      retryAt: new Date(
        Number.isFinite(hint) ? Math.min(8640000000000000, Math.max(floor, hint)) : floor,
      ),
      successorId: v7(),
    };
  }
  if (response.status >= 200 && response.status < 300) {
    return { kind: 'ambiguous', code, retryAt: new Date(now + 10_000), successorId: v7() };
  }
  return { kind: 'permanent', code };
}

/**
 * Creates a Web Push sender using per-request VAPID keys and screened HTTPS.
 * @param subject - Validated deployment contact URI from worker configuration.
 * @param policy - Operator-owned egress policy, never tenant input.
 * @param resolver - Trusted DNS override for deployment or protocol fixtures.
 * @returns Sender for immutable reservations. Each send owns a bounded connection and performs no transport retries.
 * @throws {Error} WEB_PUSH_BINDING_INVALID, secret validation failures, or request-generation errors before transport.
 * @example
 * ```ts
 * const runtime = createWebPushRuntime('mailto:operator@example.com', policy);
 * const result = await runtime.send(reservation, keyring);
 * ```
 */
export function createWebPushRuntime(
  subject: string,
  policy: EgressPolicy,
  resolver?: DestinationResolver,
): WebPushRuntime {
  async function send(reservation: ReservedSend, keyring: SecretKeyring): Promise<WebPushOutcome> {
    const { job } = reservation.fence;
    if (job.provider !== 'web-push') {
      throw new Error('WEB_PUSH_BINDING_INVALID');
    }
    const scope = {
      organizationId: job.organizationId,
      projectId: job.projectId,
      environmentId: job.environmentId,
    };
    const credential = v.parse(
      credentialInputSchema,
      JSON.parse(
        decryptSecret(
          keyring,
          {
            ...scope,
            resourceId: reservation.credentialId,
            purpose: 'credential',
            binding: JSON.stringify(['web-push', reservation.appId, reservation.publicKey]),
          },
          reservation.encryptedSecret,
        ),
      ),
    );
    const target = v.parse(
      endpointInputSchema.options[2].entries.target,
      JSON.parse(
        decryptSecret(
          keyring,
          {
            ...scope,
            resourceId: reservation.endpointId,
            purpose: 'endpoint',
            binding: JSON.stringify([
              reservation.recipientId,
              'web-push',
              reservation.appId,
              reservation.installationId,
              reservation.endpointGeneration,
              reservation.credentialId,
            ]),
          },
          reservation.encryptedTarget,
        ),
      ),
    );
    if (
      credential.provider !== 'web-push' ||
      credential.appId !== reservation.appId ||
      reservation.publicKey === null ||
      target.applicationServerKey !== reservation.publicKey
    ) {
      throw new Error('WEB_PUSH_BINDING_INVALID');
    }
    const key = createECDH('prime256v1');
    key.setPrivateKey(Buffer.from(credential.secret.privateKey, 'base64url'));
    if (key.getPublicKey().toString('base64url') !== reservation.publicKey) {
      throw new Error('WEB_PUSH_BINDING_INVALID');
    }
    const now = Date.now();
    const request = v.parse(notificationRequestSchema, JSON.parse(reservation.request));
    const payload = encodeProviderPayload(
      request,
      { provider: 'web-push' },
      { notificationId: job.notificationId, deliveryId: job.deliveryId },
      now,
      job.deliveryId,
    );
    if (!payload.ok) {
      return {
        outcome:
          payload.problem.code === 'NOTIFICATION_EXPIRY_INVALID'
            ? {
                kind: 'transient',
                code: 'NOTIFICATION_EXPIRED',
                retryAt: new Date(request.expiresAt),
                successorId: v7(),
              }
            : { kind: 'permanent', code: payload.problem.code },
        response: null,
      };
    }
    if (payload.value.provider !== 'web-push') {
      throw new Error('WEB_PUSH_BINDING_INVALID');
    }
    const binding: WebPushBinding = {
      credentialId: reservation.credentialId,
      publicKey: reservation.publicKey,
    };
    const details = webpush.generateRequestDetails(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      payload.value.body,
      {
        ...payload.value.options,
        vapidDetails: {
          subject,
          publicKey: binding.publicKey,
          privateKey: credential.secret.privateKey,
        },
      },
    );
    if (!details.body || details.body.length > 4096) {
      return {
        outcome: { kind: 'permanent', code: 'NOTIFICATION_PAYLOAD_TOO_LARGE' },
        response: null,
      };
    }
    if (!details.headers.Authorization?.startsWith('vapid ')) {
      throw new Error('WEB_PUSH_BINDING_INVALID');
    }
    try {
      const result = await sendWebPushRequest(details, policy, resolver);
      const response: WebPushReceipt = {
        status: result.statusCode,
        retryAfter: result.headers['retry-after'] ?? null,
      };
      return { outcome: classify(response, Date.now()), response };
    } catch {
      return {
        outcome: {
          kind: 'ambiguous',
          code: 'WEB_PUSH_TRANSPORT_FAILED',
          retryAt: new Date(Date.now() + 10_000),
          successorId: v7(),
        },
        response: null,
      };
    }
  }
  return { send };
}

/**
 * Settles one Web Push result against its original queue and application fences.
 * A confirmed 404 or 410 disables only the attempted endpoint generation.
 * Receipt, disablement, event, admission, and claim completion commit together.
 * @param database - Worker database runtime.
 * @param queue - Started queue on the same database.
 * @param reservation - Committed Web Push send reservation retained unchanged.
 * @param result - Result from this runtime's single send.
 * @returns Persisted delivery state. Retries beyond notification expiry become expired.
 * @throws {Error} Lost fence/claim and database failures roll back all changes.
 * @example
 * ```ts
 * await settleWebPushDelivery(database, queue, reservation, await runtime.send(reservation, keyring));
 * ```
 */
export function settleWebPushDelivery(
  database: DatabaseRuntime,
  queue: QueueRuntime,
  reservation: ReservedSend,
  result: WebPushOutcome,
): ReturnType<typeof settleDeliveryAttempt> {
  const { job } = reservation.fence;
  if (job.provider !== 'web-push') {
    throw new Error('WEB_PUSH_BINDING_INVALID');
  }
  const scope = {
    kind: 'environment',
    organizationId: job.organizationId,
    projectId: job.projectId,
    environmentId: job.environmentId,
  } as const;
  return withTenantTransaction(database, scope, async (transaction) => {
    if (
      (result.response?.status === 404 || result.response?.status === 410) &&
      result.outcome.kind === 'permanent'
    ) {
      await lockEndpointRecipient(transaction, scope, reservation.recipientId);
      await disableEndpointGeneration(
        transaction,
        scope,
        reservation.recipientId,
        reservation.endpointId,
        reservation.endpointGeneration,
        undefined,
      );
    }
    return settleDeliveryAttempt(transaction, queue, reservation.fence, {
      ...result.outcome,
      providerResponse: result.response === null ? undefined : JSON.stringify(result.response),
    });
  });
}
