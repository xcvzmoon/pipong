import type { DatabaseRuntime } from '@pipong/database';
import type {
  AttemptFence,
  ProviderOutcome,
  QueueClaim,
  SendReservation,
} from '@pipong/database/attempts';
import type { DeliveryJob, QueueRuntime } from '@pipong/database/delivery-queue';
import { reserveDeliveryAttempt, settleDeliveryAttempt } from '@pipong/database/attempts';
import { withTenantTransaction } from '@pipong/database/tenancy';
import * as v from 'valibot';
import { decideDeliveryRetry } from './delivery-policy.ts';
import { deliveryJobSchema } from './queue.ts';
import { writeTelemetry } from './telemetry.ts';

const claimSchema = v.strictObject({
  id: v.pipe(v.string(), v.uuid()),
  retryCount: v.pipe(v.number(), v.integer(), v.minValue(0)),
});
const fenceSchema = v.strictObject({
  job: deliveryJobSchema,
  claim: claimSchema,
  generation: v.pipe(v.number(), v.integer(), v.minValue(1)),
});
const codeSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.maxLength(100),
  v.regex(/^[a-zA-Z0-9_.-]+$/),
);
const successorSchema = v.pipe(
  v.string(),
  v.uuid(),
  v.check((id) => id[14] === '7'),
);
const providerResponseSchema = v.optional(v.pipe(v.string(), v.maxLength(2048)));
const outcomeSchema = v.variant('kind', [
  v.strictObject({
    kind: v.literal('accepted'),
    code: codeSchema,
    providerResponse: providerResponseSchema,
  }),
  v.strictObject({
    kind: v.literal('permanent'),
    code: codeSchema,
    providerResponse: providerResponseSchema,
  }),
  v.strictObject({
    kind: v.picklist(['transient', 'ambiguous']),
    code: codeSchema,
    retryAt: v.date(),
    successorId: successorSchema,
    providerResponse: providerResponseSchema,
  }),
]);

/**
 * Commits logical send-start before returning the encrypted provider snapshot.
 * Use only with an identifier-only worker claim. No network work runs in this transaction.
 * Later cancellation or disablement cannot retract a committed reservation.
 * @param database - Worker database runtime.
 * @param queue - Started queue using the same database.
 * @param job - Identifier-only payload fetched from the provider queue.
 * @param claim - Fetched job ID and retry count, retained unchanged.
 * @returns Send snapshot and attempt fence, or terminal work acknowledged without sending.
 * @throws {Error} DELIVERY_INPUT_INVALID for invalid identifiers. Reservation and database errors propagate; no send is authorized when this rejects.
 * @example
 * ```ts
 * const reservation = await reserveDelivery(database, queue, job.data, job);
 * if (reservation.status === 'send') {
 *   await transport.send(reservation);
 * }
 * ```
 */
export async function reserveDelivery(
  database: DatabaseRuntime,
  queue: QueueRuntime,
  job: DeliveryJob,
  claim: QueueClaim,
): Promise<SendReservation> {
  const parsedJob = v.safeParse(deliveryJobSchema, job);
  const parsedClaim = v.safeParse(claimSchema, { id: claim.id, retryCount: claim.retryCount });
  if (!parsedJob.success || !parsedClaim.success) {
    throw new Error('DELIVERY_INPUT_INVALID: invalid delivery claim');
  }
  const result = await withTenantTransaction(
    database,
    {
      kind: 'environment',
      organizationId: parsedJob.output.organizationId,
      projectId: parsedJob.output.projectId,
      environmentId: parsedJob.output.environmentId,
    },
    (transaction) =>
      reserveDeliveryAttempt(transaction, queue, parsedJob.output, parsedClaim.output),
  );
  if (result.status === 'send') {
    writeTelemetry({
      event: 'delivery_reserved',
      notificationId: job.notificationId,
      deliveryId: job.deliveryId,
      attempt: result.fence.generation,
    });
  }
  return result;
}

/**
 * Commits the result of network I/O against its original application and queue fences.
 * Record provider failures here instead of throwing to trigger queue recovery retries.
 * Application retry policy supplies a future successor time and fresh UUIDv7.
 * @param database - Worker database runtime.
 * @param queue - Started queue using the same database.
 * @param fence - Unchanged fence from the committed send reservation.
 * @param outcome - Provider classification, redacted stable code, and optional receipt up to 2048 characters; retry outcomes include successor identity and timing.
 * @returns Persisted delivery state after atomic result/event/queue settlement.
 * @throws {Error} DELIVERY_INPUT_INVALID for malformed results. Lost-claim/fence and database errors propagate, leaving result writes uncommitted.
 * @example
 * ```ts
 * if (reservation.status === 'send') {
 *   await settleDelivery(database, queue, reservation.fence, { kind: 'accepted', code: 'accepted' });
 * }
 * ```
 */
export async function settleDelivery(
  database: DatabaseRuntime,
  queue: QueueRuntime,
  fence: AttemptFence,
  outcome: ProviderOutcome,
): Promise<
  'queued' | 'sending' | 'retry_wait' | 'provider_accepted' | 'failed' | 'expired' | 'canceled'
> {
  const parsedFence = v.safeParse(fenceSchema, fence);
  const parsedOutcome = v.safeParse(outcomeSchema, outcome);
  if (!parsedFence.success || !parsedOutcome.success) {
    throw new Error('DELIVERY_INPUT_INVALID: invalid delivery settlement');
  }
  const result = await withTenantTransaction(
    database,
    {
      kind: 'environment',
      organizationId: parsedFence.output.job.organizationId,
      projectId: parsedFence.output.job.projectId,
      environmentId: parsedFence.output.job.environmentId,
    },
    (transaction) =>
      settleDeliveryAttempt(
        transaction,
        queue,
        parsedFence.output,
        parsedOutcome.output,
        decideDeliveryRetry,
      ),
  );
  writeTelemetry({
    event: 'delivery_settled',
    notificationId: fence.job.notificationId,
    deliveryId: fence.job.deliveryId,
    attempt: fence.generation,
  });
  return result;
}
