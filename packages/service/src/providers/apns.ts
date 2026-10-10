import type { DatabaseRuntime } from '@pipong/database';
import type { ProviderOutcome, SendReservation } from '@pipong/database/attempts';
import type { QueueRuntime } from '@pipong/database/delivery-queue';
import type { SecretKeyring } from '../secrets.ts';
import type { ApnsBinding, ApnsClient, ApnsConnection, ApnsResponse } from './apns-client.ts';
import { settleDeliveryAttempt } from '@pipong/database/attempts';
import { disableEndpointGeneration, lockEndpointRecipient } from '@pipong/database/endpoints';
import { withTenantTransaction } from '@pipong/database/tenancy';
import { v7 } from 'uuid';
import * as v from 'valibot';
import { credentialInputSchema } from '../credentials.ts';
import { decideDeliveryRetry } from '../delivery-policy.ts';
import { endpointInputSchema } from '../endpoints.ts';
import { notificationRequestSchema } from '../notification-contract.ts';
import { encodeProviderPayload } from '../provider-payloads.ts';
import { decryptSecret } from '../secrets.ts';
import { connectApns, createApnsClient } from './apns-client.ts';

export type ApnsOutcome = { outcome: ProviderOutcome; response: ApnsResponse | null };
type ReservedSend = Extract<SendReservation, { status: 'send' }>;
export type ApnsRuntime = {
  send: (reservation: ReservedSend, keyring: SecretKeyring) => Promise<ApnsOutcome>;
  close: () => void;
};

function classify(response: ApnsResponse, now: number): ProviderOutcome {
  const code = `APNS_${response.reason ?? response.status}`;
  if (response.status === 200) {
    return { kind: 'accepted', code };
  }
  if (response.status === 429 || response.status >= 500) {
    const seconds = response.retryAfter === null ? NaN : Number(response.retryAfter);
    const hinted =
      Number.isFinite(seconds) && seconds >= 0
        ? now + seconds * 1000
        : Date.parse(response.retryAfter ?? '');
    const floor = now + (response.status >= 500 ? 900_000 : 60_000);
    const retryAt = new Date(
      Number.isFinite(hinted) ? Math.min(8640000000000000, Math.max(floor, hinted)) : floor,
    );
    return { kind: 'transient', code, retryAt, successorId: v7() };
  }
  return { kind: 'permanent', code };
}

/**
 * Creates a bounded APNs client cache for committed worker reservations.
 * Each immutable tenant, application, environment, and credential binding owns one connection.
 * No transport retries run here. Busy caches reject work before opening another connection.
 * @param connection - HTTP/2 connection factory; defaults to verified Apple TLS endpoints. Local fixtures may supply their own connection.
 * @returns Runtime accepting encrypted reservation snapshots; close destroys all connections, including in-flight requests. The owner must close it during worker shutdown.
 * @throws {Error} APNS_RUNTIME_CLOSED, APNS_CLIENT_UNAVAILABLE, APNS_BINDING_INVALID, or decryption/validation failures before sending. Network failures return ambiguous outcomes.
 * @example
 * ```ts
 * const runtime = createApnsRuntime();
 * try { const result = await runtime.send(reservation, keyring); }
 * finally { runtime.close(); }
 * ```
 */
export function createApnsRuntime(connection: ApnsConnection = connectApns): ApnsRuntime {
  const clients = new Map<string, ApnsClient>();
  let closed = false;
  async function send(reservation: ReservedSend, keyring: SecretKeyring): Promise<ApnsOutcome> {
    if (closed) {
      throw new Error('APNS_RUNTIME_CLOSED');
    }
    const { job } = reservation.fence;
    if (job.provider !== 'apns') {
      throw new Error('APNS_BINDING_INVALID');
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
            binding: JSON.stringify(['apns', reservation.appId, reservation.publicKey]),
          },
          reservation.encryptedSecret,
        ),
      ),
    );
    const target = v.parse(
      endpointInputSchema.options[0].entries.target,
      JSON.parse(
        decryptSecret(
          keyring,
          {
            ...scope,
            resourceId: reservation.endpointId,
            purpose: 'endpoint',
            binding: JSON.stringify([
              reservation.recipientId,
              'apns',
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
      credential.provider !== 'apns' ||
      credential.appId !== reservation.appId ||
      credential.secret.environment !== target.environment
    ) {
      throw new Error('APNS_BINDING_INVALID');
    }
    const now = Date.now();
    const request = v.parse(notificationRequestSchema, JSON.parse(reservation.request));
    const payload = encodeProviderPayload(
      request,
      { provider: 'apns', topic: reservation.appId },
      { notificationId: job.notificationId, deliveryId: job.deliveryId },
      now,
      job.deliveryId,
    );
    if (!payload.ok) {
      const outcome: ProviderOutcome =
        payload.problem.code === 'NOTIFICATION_EXPIRY_INVALID'
          ? {
              kind: 'transient',
              code: payload.problem.code,
              retryAt: new Date(now + 900_000),
              successorId: v7(),
            }
          : { kind: 'permanent', code: payload.problem.code };
      return { outcome, response: null };
    }
    if (payload.value.provider !== 'apns') {
      throw new Error('APNS_BINDING_INVALID');
    }
    const binding: ApnsBinding = {
      ...scope,
      credentialId: reservation.credentialId,
      topic: reservation.appId,
      ...credential.secret,
    };
    const cacheKey = JSON.stringify([
      scope.organizationId,
      scope.projectId,
      scope.environmentId,
      binding.credentialId,
      binding.topic,
      binding.environment,
      binding.teamId,
      binding.keyId,
    ]);
    let client = clients.get(cacheKey);
    if (!client) {
      if (clients.size >= 32) {
        let evicted = false;
        for (const [key, cached] of clients) {
          if (!cached.busy()) {
            cached.close();
            clients.delete(key);
            evicted = true;
            break;
          }
        }
        if (!evicted) {
          throw new Error('APNS_CLIENT_UNAVAILABLE');
        }
      }
      client = createApnsClient(binding, connection);
      clients.set(cacheKey, client);
    }
    const result = await client.send(payload.value, target.token, job.deliveryId);
    if (result.kind === 'ambiguous') {
      return {
        outcome: {
          kind: 'ambiguous',
          code: result.code,
          retryAt: new Date(Date.now() + 900_000),
          successorId: v7(),
        },
        response: null,
      };
    }
    return { outcome: classify(result.response, Date.now()), response: result.response };
  }
  function close(): void {
    closed = true;
    for (const client of clients.values()) {
      client.close();
    }
    clients.clear();
  }
  return { send, close };
}

/**
 * Settles one APNs result against its original queue and application fences.
 * A 410 Unregistered response disables only the attempted generation registered before its timestamp.
 * Receipt, disablement, event, admission, and claim completion commit together.
 * @param database - Worker database runtime.
 * @param queue - Started queue on the same database.
 * @param reservation - Committed APNs send reservation retained unchanged.
 * @param result - Result from this runtime's single send.
 * @returns Persisted delivery state. Retries beyond notification expiry become expired.
 * @throws {Error} Lost fence/claim and database failures roll back all changes.
 * @example
 * ```ts
 * await settleApnsDelivery(database, queue, reservation, await runtime.send(reservation, keyring));
 * ```
 */
export function settleApnsDelivery(
  database: DatabaseRuntime,
  queue: QueueRuntime,
  reservation: ReservedSend,
  result: ApnsOutcome,
): ReturnType<typeof settleDeliveryAttempt> {
  const { job } = reservation.fence;
  if (job.provider !== 'apns') {
    throw new Error('APNS_BINDING_INVALID');
  }
  const scope = {
    kind: 'environment',
    organizationId: job.organizationId,
    projectId: job.projectId,
    environmentId: job.environmentId,
  } as const;
  return withTenantTransaction(database, scope, async (transaction) => {
    if (
      result.response?.status === 410 &&
      result.response.reason === 'Unregistered' &&
      result.response.invalidatedAt !== null
    ) {
      await lockEndpointRecipient(transaction, scope, reservation.recipientId);
      await disableEndpointGeneration(
        transaction,
        scope,
        reservation.recipientId,
        reservation.endpointId,
        reservation.endpointGeneration,
        new Date(result.response.invalidatedAt),
      );
    }
    return settleDeliveryAttempt(
      transaction,
      queue,
      reservation.fence,
      {
        ...result.outcome,
        providerResponse: result.response === null ? undefined : JSON.stringify(result.response),
      },
      decideDeliveryRetry,
    );
  });
}
