import type { DatabaseRuntime } from '@pipong/database';
import type { ProviderOutcome, SendReservation } from '@pipong/database/attempts';
import type { QueueRuntime } from '@pipong/database/delivery-queue';
import type { SecretKeyring } from '../secrets.ts';
import type { FcmAuth } from './fcm-auth.ts';
import { settleDeliveryAttempt } from '@pipong/database/attempts';
import { disableEndpointGeneration, lockEndpointRecipient } from '@pipong/database/endpoints';
import { withTenantTransaction } from '@pipong/database/tenancy';
import { v7 } from 'uuid';
import * as v from 'valibot';
import { credentialInputSchema } from '../credentials.ts';
import { endpointInputSchema } from '../endpoints.ts';
import { notificationRequestSchema } from '../notification-contract.ts';
import { encodeProviderPayload } from '../provider-payloads.ts';
import { decryptSecret } from '../secrets.ts';
import { createFcmAuth, FcmAuthError } from './fcm-auth.ts';

export type FcmResponse = {
  status: number | null;
  authStatus?: number | null;
  name: string | null;
  errorPresent: boolean;
  errorStatus: string | null;
  errorCode: string | null;
  quotaReason: string | null;
  retryAfter: string | null;
};
export type FcmBinding = {
  organizationId: string;
  projectId: string;
  environmentId: string;
  credentialId: string;
  targetProjectId: string;
};
export type FcmOutcome = { outcome: ProviderOutcome; response: FcmResponse | null };
type ReservedSend = Extract<SendReservation, { status: 'send' }>;
export type FcmRuntime = {
  send: (reservation: ReservedSend, keyring: SecretKeyring) => Promise<FcmOutcome>;
  close: () => void;
};

type AuthFactory = (clientEmail: string, privateKey: string) => FcmAuth;
type FcmErrorDetail = {
  '@type'?: string;
  errorCode?: string;
  reason?: string;
  violations?: { subject?: string; description?: string }[];
};
const apiResponseSchema = v.object({
  name: v.optional(v.string()),
  error: v.optional(
    v.object({
      status: v.optional(v.string()),
      details: v.optional(
        v.array(
          v.object({
            '@type': v.optional(v.string()),
            errorCode: v.optional(v.string()),
            reason: v.optional(v.string()),
            violations: v.optional(
              v.array(
                v.object({ subject: v.optional(v.string()), description: v.optional(v.string()) }),
              ),
            ),
          }),
        ),
      ),
    }),
  ),
});

function retryAt(header: string | null, floorMs: number, now: number): Date {
  const seconds = header === null ? NaN : Number(header);
  const parsed =
    Number.isFinite(seconds) && seconds >= 0 ? now + seconds * 1000 : Date.parse(header ?? '');
  const target = Number.isFinite(parsed) ? Math.max(now + floorMs, parsed) : now + floorMs;
  return new Date(Math.min(8640000000000000, target));
}

function classify(response: FcmResponse, now: number): ProviderOutcome {
  if (response.status === null) {
    return { kind: 'permanent', code: 'FCM_AUTH_FAILED' };
  }
  if (
    response.status >= 200 &&
    response.status < 300 &&
    response.name !== null &&
    /^projects\/[^/]+\/messages\/[^/]+$/.test(response.name) &&
    !response.errorPresent &&
    response.errorStatus === null &&
    response.errorCode === null
  ) {
    return { kind: 'accepted', code: 'FCM_ACCEPTED' };
  }
  if (response.status >= 200 && response.status < 300) {
    return {
      kind: 'ambiguous',
      code: 'FCM_RESPONSE_INVALID',
      retryAt: new Date(now + 10_000),
      successorId: v7(),
    };
  }
  if (response.status === 429 || response.status >= 500) {
    const quota = response.status === 429;
    return {
      kind: 'transient',
      code:
        (quota ? (response.quotaReason ?? 'FCM_QUOTA_LIMIT') : null) ??
        response.errorCode ??
        response.errorStatus ??
        `FCM_HTTP_${response.status}`,
      retryAt: retryAt(response.retryAfter, quota ? 60_000 : 10_000, now),
      successorId: v7(),
    };
  }
  return {
    kind: 'permanent',
    code: response.errorCode ?? response.errorStatus ?? `FCM_HTTP_${response.status}`,
  };
}

async function readResponse(
  response: Response,
): Promise<v.InferOutput<typeof apiResponseSchema> | undefined> {
  if (!response.body) {
    return undefined;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let body = '';
  let bytes = 0;
  try {
    while (true) {
      // eslint-disable-next-line no-await-in-loop -- The response stream must be consumed in order and bounded as it arrives.
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      const value = v.parse(v.instance(Uint8Array), chunk.value);
      bytes += value.byteLength;
      if (bytes > 8192) {
        // eslint-disable-next-line no-await-in-loop -- Cancel before returning so the bounded response does not keep streaming.
        await reader.cancel();
        return undefined;
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return v.parse(apiResponseSchema, JSON.parse(body));
  } catch {
    await reader.cancel().catch(() => undefined);
    return undefined;
  }
}

/**
 * Creates a bounded FCM HTTP v1 runtime for committed worker reservations.
 * Credentials are scoped to their immutable version; the environment's credential appId is the explicit target project.
 * The transport sends once, follows no redirects, and bounds its deadline and response body.
 * @param request - Fetch implementation; the default uses Node's direct HTTPS transport.
 * @param authFactory - Per-version OAuth factory; tests may provide a controlled token source.
 * @param baseUrl - FCM API origin; production uses the fixed Google endpoint.
 * @returns Runtime accepting encrypted reservations; close drops OAuth clients and prevents further sends.
 * @throws {Error} FCM_RUNTIME_CLOSED, FCM_BINDING_INVALID, and decrypt/validation failures before sending.
 * @example
 * ```ts
 * const runtime = createFcmRuntime();
 * try { const result = await runtime.send(reservation, keyring); }
 * finally { runtime.close(); }
 * ```
 */
export function createFcmRuntime(
  request: typeof fetch = fetch,
  authFactory: AuthFactory = createFcmAuth,
  baseUrl = 'https://fcm.googleapis.com',
  deadlineMs = 10_000,
): FcmRuntime {
  const authClients = new Map<string, FcmAuth>();
  const authUsers = new Map<FcmAuth, number>();
  const activeRequests = new Set<AbortController>();
  let closed = false;

  async function send(reservation: ReservedSend, keyring: SecretKeyring): Promise<FcmOutcome> {
    if (closed) {
      throw new Error('FCM_RUNTIME_CLOSED');
    }
    const { job } = reservation.fence;
    if (job.provider !== 'fcm') {
      throw new Error('FCM_BINDING_INVALID');
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
            binding: JSON.stringify(['fcm', reservation.appId, reservation.publicKey]),
          },
          reservation.encryptedSecret,
        ),
      ),
    );
    const target = v.parse(
      endpointInputSchema.options[1].entries.target,
      JSON.parse(
        decryptSecret(
          keyring,
          {
            ...scope,
            resourceId: reservation.endpointId,
            purpose: 'endpoint',
            binding: JSON.stringify([
              reservation.recipientId,
              'fcm',
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
    if (credential.provider !== 'fcm' || credential.appId !== reservation.appId) {
      throw new Error('FCM_BINDING_INVALID');
    }
    const now = Date.now();
    const notification = v.parse(notificationRequestSchema, JSON.parse(reservation.request));
    const payload = encodeProviderPayload(
      notification,
      { provider: 'fcm', target },
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
              retryAt: new Date(now + 10_000),
              successorId: v7(),
            }
          : { kind: 'permanent', code: payload.problem.code };
      return { outcome, response: null };
    }
    if (payload.value.provider !== 'fcm' || payload.value.bytes > 4096) {
      throw new Error('FCM_BINDING_INVALID');
    }
    const binding: FcmBinding = {
      ...scope,
      credentialId: reservation.credentialId,
      targetProjectId: reservation.appId,
    };
    const cacheKey = JSON.stringify([
      binding.organizationId,
      binding.projectId,
      binding.environmentId,
      binding.credentialId,
      binding.targetProjectId,
    ]);
    let auth = authClients.get(cacheKey);
    let cacheAuth = true;
    if (!auth) {
      if (authClients.size >= 32) {
        let idleKey: string | undefined;
        for (const [cachedKey, cachedAuth] of authClients) {
          if ((authUsers.get(cachedAuth) ?? 0) === 0) {
            idleKey = cachedKey;
            break;
          }
        }
        if (idleKey === undefined) {
          cacheAuth = false;
        } else {
          authClients.get(idleKey)?.close?.();
          authClients.delete(idleKey);
        }
      }
      auth = authFactory(credential.secret.clientEmail, credential.secret.privateKey);
      if (cacheAuth) {
        authClients.set(cacheKey, auth);
      }
    }
    authUsers.set(auth, (authUsers.get(auth) ?? 0) + 1);
    const controller = new AbortController();
    activeRequests.add(controller);
    const deadline = setTimeout(() => {
      controller.abort();
    }, deadlineMs);
    try {
      let accessToken: string;
      try {
        accessToken = await Promise.race([
          auth.getAccessToken(controller.signal),
          new Promise<never>((_resolve, reject) => {
            controller.signal.addEventListener(
              'abort',
              () => {
                reject(new Error('FCM_AUTH_ABORTED'));
              },
              { once: true },
            );
          }),
        ]);
      } catch (error) {
        if (closed) {
          throw new Error('FCM_RUNTIME_CLOSED', { cause: error });
        }
        if (Date.parse(notification.expiresAt) <= Date.now()) {
          return {
            outcome: {
              kind: 'transient',
              code: 'NOTIFICATION_EXPIRED',
              retryAt: new Date(notification.expiresAt),
              successorId: v7(),
            },
            response: null,
          };
        }
        if (error instanceof FcmAuthError) {
          return {
            outcome: error.permanent
              ? { kind: 'permanent', code: 'FCM_AUTH_FAILED' }
              : {
                  kind: 'transient',
                  code: 'FCM_AUTH_UNAVAILABLE',
                  retryAt: new Date(Date.now() + 10_000),
                  successorId: v7(),
                },
            response: {
              status: null,
              authStatus: error.statusCode,
              name: null,
              errorPresent: false,
              errorStatus: null,
              errorCode: null,
              quotaReason: null,
              retryAfter: null,
            },
          };
        }
        return {
          outcome: {
            kind: 'transient',
            code: 'FCM_AUTH_UNAVAILABLE',
            retryAt: new Date(Date.now() + 10_000),
            successorId: v7(),
          },
          response: null,
        };
      }
      if (closed || controller.signal.aborted) {
        return {
          outcome: {
            kind: 'ambiguous',
            code: 'FCM_TRANSPORT_FAILED',
            retryAt: new Date(Date.now() + 10_000),
            successorId: v7(),
          },
          response: null,
        };
      }
      const sendTime = Date.now();
      const freshPayload = encodeProviderPayload(
        notification,
        { provider: 'fcm', target },
        { notificationId: job.notificationId, deliveryId: job.deliveryId },
        sendTime,
        job.deliveryId,
      );
      if (!freshPayload.ok) {
        const expired: ProviderOutcome =
          freshPayload.problem.code === 'NOTIFICATION_EXPIRY_INVALID'
            ? {
                kind: 'transient',
                code: 'NOTIFICATION_EXPIRED',
                retryAt: new Date(notification.expiresAt),
                successorId: v7(),
              }
            : { kind: 'permanent', code: freshPayload.problem.code };
        return { outcome: expired, response: null };
      }
      const response = await request(
        `${baseUrl}/v1/projects/${encodeURIComponent(binding.targetProjectId)}/messages:send`,
        {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
          body: freshPayload.value.body,
        },
      );
      const parsed = await readResponse(response);
      if (!parsed) {
        const incompleteReceipt: FcmResponse = {
          status: response.status,
          name: null,
          errorPresent: false,
          errorStatus: null,
          errorCode: null,
          quotaReason: null,
          retryAfter: response.headers.get('retry-after'),
        };
        return {
          outcome:
            controller.signal.aborted && response.status !== 429 && response.status < 500
              ? {
                  kind: 'ambiguous',
                  code: 'FCM_TRANSPORT_FAILED',
                  retryAt: new Date(Date.now() + 10_000),
                  successorId: v7(),
                }
              : classify(incompleteReceipt, Date.now()),
          response: incompleteReceipt,
        };
      }
      const details: FcmErrorDetail[] = parsed.error?.details ?? [];
      const fcmDetail = details.find(
        (detail) => detail['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
      );
      const quotaDetail = details.find(
        (detail) => detail['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure',
      );
      const quotaCategory =
        quotaDetail || fcmDetail?.errorCode?.includes('QUOTA')
          ? fcmDetail?.errorCode === 'QUOTA_EXCEEDED'
            ? 'FCM_QUOTA_EXCEEDED'
            : 'FCM_QUOTA_LIMIT'
          : null;
      const receipt: FcmResponse = {
        status: response.status,
        name: parsed.name ?? null,
        errorPresent: parsed.error !== undefined,
        errorStatus: parsed.error?.status ?? null,
        errorCode: fcmDetail?.errorCode ?? null,
        quotaReason: quotaCategory,
        retryAfter: response.headers.get('retry-after'),
      };
      return {
        outcome: classify(receipt, Date.now()),
        response: receipt,
      };
    } catch {
      return {
        outcome: {
          kind: 'ambiguous',
          code: 'FCM_TRANSPORT_FAILED',
          retryAt: new Date(Date.now() + 10_000),
          successorId: v7(),
        },
        response: null,
      };
    } finally {
      clearTimeout(deadline);
      activeRequests.delete(controller);
      const remainingUsers = (authUsers.get(auth) ?? 1) - 1;
      if (remainingUsers === 0) {
        authUsers.delete(auth);
        if (!cacheAuth) {
          auth.close?.();
        }
      } else {
        authUsers.set(auth, remainingUsers);
      }
    }
  }

  function close(): void {
    closed = true;
    for (const controller of activeRequests) {
      controller.abort();
    }
    for (const auth of authClients.values()) {
      auth.close?.();
    }
    activeRequests.clear();
    authClients.clear();
    authUsers.clear();
  }
  return { send, close };
}

/**
 * Settles one FCM response against the original queue and application fences.
 * UNREGISTERED disables only the endpoint generation used by this send.
 * @param database - Worker database runtime.
 * @param queue - Started queue on the same database.
 * @param reservation - Committed FCM send reservation retained unchanged.
 * @param result - Result from this runtime's single HTTP request.
 * @returns Persisted delivery state, with retries beyond expiry settled as expired.
 * @throws {Error} Lost fence/claim and database failures roll back every settlement write.
 * @example
 * ```ts
 * await settleFcmDelivery(database, queue, reservation, await runtime.send(reservation, keyring));
 * ```
 */
export function settleFcmDelivery(
  database: DatabaseRuntime,
  queue: QueueRuntime,
  reservation: ReservedSend,
  result: FcmOutcome,
): ReturnType<typeof settleDeliveryAttempt> {
  const { job } = reservation.fence;
  if (job.provider !== 'fcm') {
    throw new Error('FCM_BINDING_INVALID');
  }
  const scope = {
    kind: 'environment',
    organizationId: job.organizationId,
    projectId: job.projectId,
    environmentId: job.environmentId,
  } as const;
  return withTenantTransaction(database, scope, async (transaction) => {
    if (
      result.response?.errorCode === 'UNREGISTERED' &&
      result.response.name === null &&
      result.response.status === 404 &&
      result.response.errorStatus === 'NOT_FOUND' &&
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
