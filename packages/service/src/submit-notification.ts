import type { QueueRuntime } from '@pipong/database/delivery-queue';
import type { EnvironmentScope } from '@pipong/database/recipients';
import type {
  AcceptanceResponse,
  DeliveryInsert,
  SubmissionTarget,
} from '@pipong/database/submission';
import type { TenantTransaction } from '@pipong/database/tenancy';
import type { AdmissionDecision } from './limits.ts';
import type { ApiProblem, NotificationRequest } from './notification-contract.ts';
import type { PayloadDestination } from './provider-payloads.ts';
import type { SecretKeyring } from './secrets.ts';
import { insertDeliveryJobs } from '@pipong/database/delivery-queue';
import { appendDeliveryEvents } from '@pipong/database/events';
import {
  lockSubmission,
  persistSubmission,
  readIdempotencyRecord,
  resolveSubmissionTargets,
} from '@pipong/database/submission';
import { createHash } from 'node:crypto';
import { v7 } from 'uuid';
import * as v from 'valibot';
import { endpointInputSchema } from './endpoints.ts';
import { admitNotification } from './limits.ts';
import {
  boundNotificationTargets,
  notificationFailure,
  notificationLimits,
} from './notification-contract.ts';
import { encodeProviderPayload } from './provider-payloads.ts';
import { decryptSecret } from './secrets.ts';

export const idempotencyKeySchema = v.pipe(v.string(), v.regex(/^[A-Za-z0-9._:-]{1,200}$/));
export type SubmissionResult =
  | { ok: true; value: AcceptanceResponse }
  | { ok: false; problem: ApiProblem }
  | { ok: false; status: 409; code: 'idempotency_conflict' }
  | {
      ok: false;
      status: 429;
      code: Extract<AdmissionDecision, { status: 'rejected' }>['code'];
      retryAfter: number;
    };

/**
 * Accepts immediate delivery atomically with replay, quota, events, and queue jobs.
 * The caller must validate the request schema and key and hold notification:send
 * authority in this transaction. Authorization is checked before every replay.
 * @param transaction - Authorized environment transaction; errors must abort it.
 * @param queue - Started producer queue sharing this database.
 * @param scope - Authorized owning environment.
 * @param keyId - Authenticated service key UUID, or null for a human.
 * @param keyring - Operator keyring for validating encrypted endpoint snapshots.
 * @param key - Validated Idempotency-Key, scoped to the environment for seven days.
 * @param request - Schema-validated request; target ordering and object key ordering do not change its fingerprint.
 * @param requestId - Server correlation ID for safe failures.
 * @returns Original immutable acceptance, conflict, validation failure, or admission rejection. Replays charge request capacity but never create delivery work again.
 * @throws {Error} Database, decryption, or enqueue failures roll back every acceptance write.
 * @example
 * ```ts
 * const result = await submitNotification(transaction, queue, scope, keyId, keyring, key, request, requestId);
 * ```
 */
export async function submitNotification(
  transaction: TenantTransaction,
  queue: QueueRuntime,
  scope: EnvironmentScope,
  keyId: string | null,
  keyring: SecretKeyring,
  key: string,
  request: NotificationRequest,
  requestId: string,
): Promise<SubmissionResult> {
  const now = await lockSubmission(transaction, scope, key);
  const fingerprint = submissionFingerprint(scope, request);
  const existing = await readIdempotencyRecord(transaction, scope, key);
  if (existing && existing.expiresAt.getTime() > now.getTime()) {
    if (existing.fingerprint !== fingerprint) {
      return { ok: false, status: 409, code: 'idempotency_conflict' };
    }
    const admission = await admitNotification(
      transaction,
      scope.organizationId,
      keyId,
      existing.notificationId,
      existing.response.deliveryCount,
    );
    if (admission.status === 'rejected') {
      return { ok: false, status: 429, code: admission.code, retryAfter: admission.retryAfter };
    }
    return { ok: true, value: existing.response };
  }
  const remaining = Date.parse(request.expiresAt) - now.getTime();
  if (remaining < 1000 || remaining > notificationLimits.ttlSeconds * 1000) {
    return notificationFailure('NOTIFICATION_EXPIRY_INVALID', requestId);
  }
  const targets = await resolveSubmissionTargets(
    transaction,
    scope,
    request.targets.kind,
    [...new Set(request.targets.ids)],
    notificationLimits.endpoints + 1,
  );
  const bounded = boundNotificationTargets(
    targets.map(({ id }) => id),
    requestId,
  );
  if (!bounded.ok) {
    return bounded;
  }
  const notificationId = v7();
  const snapshots: (DeliveryInsert & { id: string })[] = [];
  for (const target of targets) {
    const deliveryId = v7();
    const payload = encodeProviderPayload(
      request,
      payloadDestination(scope, keyring, target),
      { notificationId, deliveryId },
      now.getTime(),
      requestId,
    );
    if (!payload.ok) {
      return payload;
    }
    snapshots.push({
      ...scope,
      id: deliveryId,
      notificationId,
      endpointId: target.id,
      generation: target.generation,
      credentialId: target.credentialId,
      provider: target.provider,
    });
  }
  const admission = await admitNotification(
    transaction,
    scope.organizationId,
    keyId,
    notificationId,
    targets.length,
  );
  if (admission.status === 'rejected') {
    return { ok: false, status: 429, code: admission.code, retryAfter: admission.retryAfter };
  }
  const response = { notificationId, acceptedAt: now.toISOString(), deliveryCount: targets.length };
  await persistSubmission(
    transaction,
    {
      ...scope,
      id: notificationId,
      request: JSON.stringify(request),
      expiresAt: new Date(request.expiresAt),
      acceptedAt: now,
      deliveryCount: targets.length,
    },
    snapshots,
    {
      ...scope,
      key,
      fingerprint,
      notificationId,
      response,
      expiresAt: new Date(now.getTime() + 7 * 86400000),
    },
  );
  await appendDeliveryEvents(
    transaction,
    scope,
    snapshots.map((snapshot) => {
      return { notificationId, deliveryId: snapshot.id, state: 'queued' };
    }),
  );
  await insertDeliveryJobs(
    queue,
    transaction,
    snapshots.map((snapshot) => {
      return {
        id: v7(),
        data: {
          organizationId: scope.organizationId,
          projectId: scope.projectId,
          environmentId: scope.environmentId,
          notificationId,
          deliveryId: snapshot.id,
          provider: snapshot.provider,
        },
      };
    }),
  );
  return { ok: true, value: response };
}

function submissionFingerprint(scope: EnvironmentScope, request: NotificationRequest): string {
  const data = Object.entries(request.content.data).toSorted(([first], [second]) =>
    first < second ? -1 : first > second ? 1 : 0,
  );
  const normalized = {
    targets: { kind: request.targets.kind, ids: [...new Set(request.targets.ids)].toSorted() },
    content: { alert: request.content.alert, data },
    expiresAt: request.expiresAt,
    overrides: request.overrides,
  };
  return createHash('sha256')
    .update(
      JSON.stringify([scope.organizationId, scope.projectId, scope.environmentId, normalized]),
    )
    .digest('hex');
}

function payloadDestination(
  scope: EnvironmentScope,
  keyring: SecretKeyring,
  target: SubmissionTarget,
): PayloadDestination {
  if (target.provider === 'apns') {
    return { provider: 'apns', topic: target.appId };
  }
  if (target.provider === 'web-push') {
    return { provider: 'web-push' };
  }
  const decryptedTarget: unknown = JSON.parse(
    decryptSecret(
      keyring,
      {
        ...scope,
        resourceId: target.id,
        purpose: 'endpoint',
        binding: JSON.stringify([
          target.recipientId,
          target.provider,
          target.appId,
          target.installationId,
          target.generation,
          target.credentialId,
        ]),
      },
      target.encryptedTarget,
    ),
  );
  const registration = v.parse(endpointInputSchema, {
    installationId: target.installationId,
    credentialId: target.credentialId,
    appId: target.appId,
    provider: target.provider,
    target: decryptedTarget,
  });
  if (registration.provider !== 'fcm') {
    throw new Error('SUBMISSION_ENDPOINT_INVALID: mismatched endpoint provider');
  }
  return { provider: 'fcm', target: registration.target };
}
