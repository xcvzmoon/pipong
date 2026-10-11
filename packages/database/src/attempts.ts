import type { DeliveryJob, QueueRuntime } from './delivery-queue.ts';
import type { TenantTransaction } from './tenancy/index.ts';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { deliveryAttempts } from './attempts-schema.ts';
import { scopeExists, scopeSuspended } from './authorization/index.ts';
import { credentialVersions } from './credentials/schema.ts';
import { completeDeliveryJob, insertDeliveryJob } from './delivery-queue.ts';
import { endpointGenerations, endpoints } from './endpoints/schema.ts';
import { erasureJobs } from './erasure-schema.ts';
import { appendDeliveryEvent } from './events.ts';
import { settleAdmission } from './limits.ts';
import { recipients } from './recipients/schema.ts';
import { deliveries, notifications } from './submission-schema.ts';

export type QueueClaim = { id: string; retryCount: number };
export type AttemptFence = { job: DeliveryJob; claim: QueueClaim; generation: number };
export type DeliveryAttempt = typeof deliveryAttempts.$inferSelect;
export type SendReservation =
  | {
      status: 'send';
      fence: AttemptFence;
      request: string;
      expiresAt: Date;
      sendUntil: Date;
      encryptedTarget: string;
      encryptedSecret: string;
      appId: string;
      endpointId: string;
      recipientId: string;
      installationId: string;
      endpointGeneration: number;
      credentialId: string;
      publicKey: string | null;
    }
  | { status: 'completed'; state: typeof deliveries.$inferSelect.state };
export type ProviderOutcome = (
  | { kind: 'accepted'; code: string }
  | { kind: 'permanent'; code: string }
  | { kind: 'transient' | 'ambiguous'; code: string; retryAt: Date; successorId: string }
) & { providerResponse?: string };

/** Maximum committed send reservations in one delivery chain, including crash recovery. */
export const deliveryAttemptLimit = 8;
export type RetryDecision =
  | { state: 'failed' | 'expired' }
  | { state: 'retry_wait'; retryAt: Date };
export type RetryPolicy = (
  provider: DeliveryJob['provider'],
  attempt: number,
  requestedAt: Date,
  expiresAt: Date,
  now: Date,
) => RetryDecision;

const terminalStates = ['provider_accepted', 'failed', 'expired', 'canceled'] as const;

async function lockClaim(
  transaction: TenantTransaction,
  job: DeliveryJob,
  claim: QueueClaim,
): Promise<void> {
  const result = await transaction.execute(sql`SELECT id FROM pgboss.job
    WHERE name = ${'delivery-' + job.provider} AND id = ${claim.id}::uuid
      AND retry_count = ${claim.retryCount} AND state = 'active'
      AND data = ${JSON.stringify(job)}::jsonb FOR UPDATE`);
  if (result.rows.length !== 1) {
    throw new Error('DELIVERY_QUEUE_CLAIM_LOST: delivery claim is no longer active');
  }
}

async function lockNotification(
  transaction: TenantTransaction,
  job: DeliveryJob,
): Promise<typeof notifications.$inferSelect> {
  const [notification] = await transaction
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.id, job.notificationId),
        eq(notifications.organizationId, job.organizationId),
        eq(notifications.projectId, job.projectId),
        eq(notifications.environmentId, job.environmentId),
      ),
    )
    .for('update');
  if (!notification) {
    throw new Error('DELIVERY_NOT_FOUND: notification is unavailable');
  }
  return notification;
}

async function lockDelivery(
  transaction: TenantTransaction,
  job: DeliveryJob,
): Promise<typeof deliveries.$inferSelect> {
  const [delivery] = await transaction
    .select()
    .from(deliveries)
    .where(
      and(
        eq(deliveries.id, job.deliveryId),
        eq(deliveries.notificationId, job.notificationId),
        eq(deliveries.provider, job.provider),
      ),
    )
    .for('update');
  if (!delivery) {
    throw new Error('DELIVERY_NOT_FOUND: delivery is unavailable');
  }
  return delivery;
}

async function databaseTime(transaction: TenantTransaction): Promise<Date> {
  const [clock] = await transaction
    .select({ now: sql`clock_timestamp()`.mapWith(notifications.acceptedAt) })
    .from(sql`(SELECT 1) AS clock`);
  if (!clock) {
    throw new Error('DELIVERY_CLOCK_UNAVAILABLE: database clock unavailable');
  }
  return clock.now;
}

/**
 * Appends a delivery state event and releases admission for terminal work.
 * The caller must lock the notification and persist the delivery state first.
 * @param transaction - Tenant transaction holding lifecycle locks.
 * @param job - Owning notification and delivery identifiers.
 * @param state - State already persisted in this transaction.
 * @returns Resolves after event and admission writes.
 * @throws {Error} DELIVERY_SETTLEMENT_FAILED if remaining work cannot be counted; database failures propagate.
 * @example
 * ```ts
 * await publishDeliveryState(transaction, job, 'canceled');
 * ```
 */
export async function publishDeliveryState(
  transaction: TenantTransaction,
  job: DeliveryJob,
  state: typeof deliveries.$inferSelect.state,
): Promise<void> {
  if (terminalStates.some((terminal) => terminal === state)) {
    const [remaining] = await transaction
      .select({ count: count() })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.notificationId, job.notificationId),
          inArray(deliveries.state, ['queued', 'sending', 'retry_wait']),
        ),
      );
    if (!remaining) {
      throw new Error('DELIVERY_SETTLEMENT_FAILED: remaining work unavailable');
    }
    await settleAdmission(transaction, job.organizationId, job.notificationId, remaining.count);
  }
  await appendDeliveryEvent(
    transaction,
    {
      kind: 'environment',
      organizationId: job.organizationId,
      projectId: job.projectId,
      environmentId: job.environmentId,
    },
    { notificationId: job.notificationId, deliveryId: job.deliveryId, state },
  );
}

/**
 * Reserves logical send-start while lifecycle rows and the fetched claim are locked.
 * Lock order is organization, project, environment, recipient, credential, endpoint,
 * notification, delivery, claim. Cancellation must lock the notification and change
 * only queued/retry-wait deliveries. A committed reservation survives later disablement.
 * The caller must use a worker tenant transaction and commit before network I/O.
 * Send snapshots expire after two minutes; adapters must honor sendUntil.
 * @param transaction - Worker transaction with the job's validated tenant context.
 * @param queue - Queue backed by the same database.
 * @param job - Validated identifier-only payload returned by fetch.
 * @param claim - Unmodified pg-boss ID and retry count.
 * @returns Immutable encrypted send snapshot and fence, or completed work requiring no send.
 * @throws {Error} DELIVERY_QUEUE_CLAIM_LOST for a stale claim; DELIVERY_ATTEMPT_ALREADY_RESERVED for a repeated reservation; DELIVERY_NOT_FOUND for missing work. Database failures roll back all writes.
 * @example
 * ```ts
 * const reservation = await withTenantTransaction(database, scope,
 *   transaction => reserveDeliveryAttempt(transaction, queue, job, claim));
 * ```
 */
export async function reserveDeliveryAttempt(
  transaction: TenantTransaction,
  queue: QueueRuntime,
  job: DeliveryJob,
  claim: QueueClaim,
): Promise<SendReservation> {
  const organization = await transaction.execute(
    sql`SELECT app.lock_delivery_organization(${job.organizationId}::uuid) AS enabled`,
  );
  const enabled = v.parse(v.object({ enabled: v.boolean() }), organization.rows[0]).enabled;
  const scope = { kind: 'environment', ...job } as const;
  const exists = await scopeExists(transaction, scope, 'share', 'share');
  const suspended = exists && (await scopeSuspended(transaction, scope));
  const [binding] = await transaction
    .select({
      recipientId: endpoints.recipientId,
      endpointId: deliveries.endpointId,
      credentialId: deliveries.credentialId,
    })
    .from(deliveries)
    .innerJoin(endpoints, eq(endpoints.id, deliveries.endpointId))
    .where(eq(deliveries.id, job.deliveryId));
  if (!binding) {
    throw new Error('DELIVERY_NOT_FOUND: endpoint binding is unavailable');
  }
  const [recipient] = await transaction
    .select()
    .from(recipients)
    .where(eq(recipients.id, binding.recipientId))
    .for('share');
  await transaction.execute(
    sql`SELECT app.lock_delivery_credential(${binding.credentialId}::uuid)`,
  );
  const [credential] = await transaction
    .select()
    .from(credentialVersions)
    .where(eq(credentialVersions.id, binding.credentialId));
  const [endpoint] = await transaction
    .select()
    .from(endpoints)
    .where(eq(endpoints.id, binding.endpointId))
    .for('share');
  const notification = await lockNotification(transaction, job);
  const delivery = await lockDelivery(transaction, job);
  await lockClaim(transaction, job, claim);
  if (terminalStates.some((state) => state === delivery.state)) {
    await completeDeliveryJob(queue, transaction, job.provider, claim);
    return { status: 'completed', state: delivery.state };
  }
  const [previous] = await transaction
    .select()
    .from(deliveryAttempts)
    .where(
      and(eq(deliveryAttempts.jobId, claim.id), eq(deliveryAttempts.retryCount, claim.retryCount)),
    );
  if (previous) {
    throw new Error('DELIVERY_ATTEMPT_ALREADY_RESERVED: claim already reserved send-start');
  }
  const now = await databaseTime(transaction);
  let blockedState: 'expired' | 'canceled' | 'failed' | undefined;
  if (notification.expiresAt <= now) {
    blockedState = 'expired';
  } else if (
    notification.canceledAt !== null ||
    !enabled ||
    !exists ||
    suspended ||
    recipient?.deletedAt !== null ||
    endpoint?.state !== 'active' ||
    endpoint.installationId === null ||
    endpoint.generation !== delivery.generation
  ) {
    blockedState = 'canceled';
  } else if (credential?.state !== 'active' || delivery.attemptGeneration >= deliveryAttemptLimit) {
    blockedState = 'failed';
  }
  if (blockedState) {
    await transaction
      .update(deliveryAttempts)
      .set({ finishedAt: now, outcome: 'ambiguous', code: 'DELIVERY_RECOVERY_TERMINAL' })
      .where(
        and(
          eq(deliveryAttempts.deliveryId, delivery.id),
          sql`${deliveryAttempts.finishedAt} IS NULL`,
        ),
      );
    await transaction
      .update(deliveries)
      .set({ state: blockedState })
      .where(eq(deliveries.id, delivery.id));
    await completeDeliveryJob(queue, transaction, job.provider, claim);
    await publishDeliveryState(transaction, job, blockedState);
    return { status: 'completed', state: blockedState };
  }
  const [snapshot] = await transaction
    .select()
    .from(endpointGenerations)
    .where(
      and(
        eq(endpointGenerations.endpointId, delivery.endpointId),
        eq(endpointGenerations.generation, delivery.generation),
        eq(endpointGenerations.credentialId, delivery.credentialId),
      ),
    );
  if (!snapshot || !credential || !endpoint || endpoint.installationId === null) {
    throw new Error('DELIVERY_NOT_FOUND: immutable send snapshot is unavailable');
  }
  await transaction
    .update(deliveryAttempts)
    .set({ finishedAt: now, outcome: 'ambiguous', code: 'DELIVERY_CRASH_RECOVERED' })
    .where(
      and(
        eq(deliveryAttempts.deliveryId, delivery.id),
        sql`${deliveryAttempts.finishedAt} IS NULL`,
      ),
    );
  const generation = delivery.attemptGeneration + 1;
  await transaction
    .update(deliveries)
    .set({ state: 'sending', attemptGeneration: generation })
    .where(eq(deliveries.id, delivery.id));
  await transaction.insert(deliveryAttempts).values({
    organizationId: job.organizationId,
    projectId: job.projectId,
    environmentId: job.environmentId,
    deliveryId: job.deliveryId,
    generation,
    jobId: claim.id,
    retryCount: claim.retryCount,
    startedAt: now,
  });
  await publishDeliveryState(transaction, job, 'sending');
  return {
    status: 'send',
    fence: { job, claim, generation },
    request: notification.request,
    expiresAt: notification.expiresAt,
    sendUntil: new Date(Math.min(notification.expiresAt.getTime(), now.getTime() + 120_000)),
    encryptedTarget: snapshot.encryptedTarget,
    encryptedSecret: credential.encryptedSecret,
    appId: endpoint.appId,
    endpointId: delivery.endpointId,
    recipientId: endpoint.recipientId,
    installationId: endpoint.installationId,
    endpointGeneration: delivery.generation,
    credentialId: delivery.credentialId,
    publicKey: credential.publicKey,
  };
}

/**
 * Atomically records a fenced result, event, admission release or delayed successor,
 * and completion of the original claim. Lost claims roll back every result write.
 * Retry timing is supplied by application policy; pg-boss retries recover crashes only.
 * @param transaction - Worker tenant transaction, separate from network I/O.
 * @param queue - Queue backed by the same database.
 * @param fence - Reservation fence retained unchanged from send-start.
 * @param outcome - Validated provider classification, redacted code, and optional serialized provider receipt; retries include a fresh UUIDv7 and future time.
 * @param retryPolicy - Application policy evaluated against locked persisted generation and database time.
 * @returns Committed delivery state after the caller's transaction completes.
 * @throws {Error} DELIVERY_ATTEMPT_FENCE_LOST for replaced attempts; DELIVERY_QUEUE_CLAIM_LOST for reclaimed jobs; DELIVERY_RETRY_INVALID for invalid retry timing. Database/enqueue failures roll back settlement.
 * @example
 * ```ts
 * await withTenantTransaction(database, scope, transaction =>
 *   settleDeliveryAttempt(transaction, queue, fence, { kind: 'accepted', code: 'accepted' }, retryPolicy));
 * ```
 */
export async function settleDeliveryAttempt(
  transaction: TenantTransaction,
  queue: QueueRuntime,
  fence: AttemptFence,
  outcome: ProviderOutcome,
  retryPolicy: RetryPolicy,
): Promise<typeof deliveries.$inferSelect.state> {
  const { job, claim, generation } = fence;
  const notification = await lockNotification(transaction, job);
  const delivery = await lockDelivery(transaction, job);
  if (delivery.state !== 'sending' || delivery.attemptGeneration !== generation) {
    throw new Error('DELIVERY_ATTEMPT_FENCE_LOST: delivery attempt was replaced');
  }
  const now = await databaseTime(transaction);
  let state: typeof deliveries.$inferSelect.state;
  const [erasure] = await transaction
    .select({ inFlightUntil: erasureJobs.inFlightUntil })
    .from(erasureJobs)
    .where(
      and(
        eq(erasureJobs.organizationId, job.organizationId),
        sql`(${erasureJobs.kind} = 'organization'
      OR (${erasureJobs.kind} = 'project' AND ${erasureJobs.projectId} = ${job.projectId}::uuid)
      OR (${erasureJobs.kind} = 'environment' AND ${erasureJobs.environmentId} = ${job.environmentId}::uuid)
      OR (${erasureJobs.kind} = 'recipient' AND EXISTS (SELECT 1 FROM app.deliveries affected JOIN app.endpoints endpoint ON endpoint.id=affected.endpoint_id WHERE affected.notification_id=${job.notificationId}::uuid AND endpoint.recipient_id=${erasureJobs.recipientId})))`,
      ),
    )
    .orderBy(asc(erasureJobs.inFlightUntil))
    .limit(1);
  const abandoned = erasure !== undefined && erasure.inFlightUntil <= now;
  if (abandoned) {
    state = 'canceled';
  } else if (outcome.kind === 'accepted') {
    state = 'provider_accepted';
  } else if (outcome.kind === 'permanent') {
    state = 'failed';
  } else if (erasure || notification.canceledAt !== null) {
    state = 'canceled';
  } else {
    const decision = retryPolicy(
      job.provider,
      generation,
      outcome.retryAt,
      notification.expiresAt,
      now,
    );
    state = decision.state;
    if (decision.state === 'retry_wait') {
      if (
        decision.retryAt <= now ||
        decision.retryAt >= notification.expiresAt ||
        generation >= deliveryAttemptLimit
      ) {
        throw new Error('DELIVERY_RETRY_INVALID: successor violates retry bounds');
      }
      await insertDeliveryJob(queue, transaction, outcome.successorId, job, decision.retryAt);
    }
  }
  const updated = await transaction
    .update(deliveryAttempts)
    .set({
      finishedAt: now,
      outcome: abandoned ? 'ambiguous' : outcome.kind,
      code: abandoned ? 'DELIVERY_ERASURE_ABANDONED' : outcome.code,
      providerResponse: abandoned ? null : outcome.providerResponse,
    })
    .where(
      and(
        eq(deliveryAttempts.deliveryId, delivery.id),
        eq(deliveryAttempts.generation, generation),
        eq(deliveryAttempts.jobId, claim.id),
        eq(deliveryAttempts.retryCount, claim.retryCount),
        sql`${deliveryAttempts.finishedAt} IS NULL`,
      ),
    )
    .returning();
  if (updated.length !== 1) {
    throw new Error('DELIVERY_ATTEMPT_FENCE_LOST: attempt result was already settled');
  }
  await transaction.update(deliveries).set({ state }).where(eq(deliveries.id, delivery.id));
  await completeDeliveryJob(queue, transaction, job.provider, claim);
  await publishDeliveryState(transaction, job, state);
  return state;
}
