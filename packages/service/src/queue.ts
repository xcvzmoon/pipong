import type { DeliveryJob, QueueRuntime } from '@pipong/database/delivery-queue';
import type { TenantTransaction } from '@pipong/database/tenancy';
import { insertDeliveryJob } from '@pipong/database/delivery-queue';
import * as v from 'valibot';

const idSchema = v.pipe(v.string(), v.uuid());
const jobIdSchema = v.pipe(
  idSchema,
  v.check((id) => id[14] === '7'),
);

/** Identifier-only delivery payload; rejects secrets, provider bodies, and extra fields. */
export const deliveryJobSchema = v.strictObject({
  organizationId: idSchema,
  projectId: idSchema,
  environmentId: idSchema,
  notificationId: idSchema,
  deliveryId: idSchema,
  provider: v.picklist(['apns', 'fcm', 'web-push']),
});

/**
 * Validates and enqueues a persisted delivery in its application transaction.
 * This internal operation does not authorize requests. The caller must hold the
 * authorized tenant transaction and persist the delivery before calling it.
 * @param queue - Started provider queue handle.
 * @param transaction - Authorized transaction containing delivery writes.
 * @param jobId - Fresh UUIDv7 queue job ID, distinct from delivery identity.
 * @param job - Tenant and delivery identifiers; no credentials or payload bodies.
 * @returns Inserted job ID. Workers see it only after transaction commit.
 * @throws {Error} DELIVERY_JOB_INVALID for invalid IDs, provider, or extra fields. DELIVERY_ENQUEUE_FAILED and database errors propagate and must abort the transaction.
 * @example
 * ```ts
 * await enqueueDelivery(queue, transaction, jobId, job);
 * ```
 */
export function enqueueDelivery(
  queue: QueueRuntime,
  transaction: TenantTransaction,
  jobId: string,
  job: DeliveryJob,
): Promise<string> {
  const parsed = v.safeParse(deliveryJobSchema, job);
  if (!parsed.success || !v.safeParse(jobIdSchema, jobId).success) {
    throw new Error('DELIVERY_JOB_INVALID: invalid delivery queue identifiers');
  }
  return insertDeliveryJob(queue, transaction, jobId, parsed.output);
}
