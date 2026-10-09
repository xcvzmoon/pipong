import type { PgBoss } from 'pg-boss';
import type { DatabaseRuntime } from './clients.ts';
import type { TenantTransaction } from './tenancy/index.ts';
import { sql } from 'drizzle-orm';
import { fromDrizzle } from 'pg-boss';
import * as v from 'valibot';
import { startQueue } from './queue.ts';

/** Identifier-only job; endpoint generations and payloads are loaded under tenant context. */
export type DeliveryJob = {
  organizationId: string;
  projectId: string;
  environmentId: string;
  notificationId: string;
  deliveryId: string;
  provider: 'apns' | 'fcm' | 'web-push';
};

/** Queue handle owned by one process; stop it before closing its database runtime. */
export type QueueRuntime = PgBoss;

/**
 * Starts the migrated provider queues on an existing database pool.
 * Producers do not supervise jobs. Workers recover infrastructure failures but
 * this function does not register provider consumers.
 * @param database - Verified runtime with queue schema access.
 * @param role - Process purpose; only workers supervise unfinished jobs.
 * @returns Started queue handle. Stop it before closing the database pool.
 * @throws {Error} DELIVERY_QUEUE_NOT_PROVISIONED if provider queues are missing. Queue startup failures propagate; a failed handle is stopped.
 * @example
 * ```ts
 * const queue = await startDeliveryQueue(database, 'worker');
 * try { await runWorker(queue); } finally { await queue.stop({ graceful: true }); }
 * ```
 */
export async function startDeliveryQueue(
  database: DatabaseRuntime,
  role: 'producer' | 'worker',
): Promise<QueueRuntime> {
  const queue = await startQueue(database, role);
  try {
    const queues = await queue.getQueues(['delivery-apns', 'delivery-fcm', 'delivery-web-push']);
    if (queues.length !== 3) {
      throw new Error('DELIVERY_QUEUE_NOT_PROVISIONED: apply delivery queue migrations');
    }
    return queue;
  } catch (error) {
    await queue.stop();
    throw error;
  }
}

/**
 * Inserts a delivery job through the caller's transaction and disables unfinished-job deletion.
 * The caller must authorize tenant identifiers and validate the job before insertion.
 * A rejected or suppressed insertion must abort the transaction.
 * @param queue - Started provider queue handle.
 * @param transaction - Transaction containing the delivery's application writes.
 * @param jobId - Fresh UUIDv7 queue ID, distinct from the delivery ID.
 * @param job - Validated identifiers of the persisted delivery.
 * @returns Inserted queue job ID, visible to workers only after commit.
 * @throws {Error} DELIVERY_ENQUEUE_FAILED when insertion is suppressed or retention protection is not applied. Database failures propagate.
 * @example
 * ```ts
 * await insertDeliveryJob(queue, transaction, jobId, job);
 * ```
 */
export async function insertDeliveryJob(
  queue: QueueRuntime,
  transaction: TenantTransaction,
  jobId: string,
  job: DeliveryJob,
): Promise<string> {
  const name = `delivery-${job.provider}`;
  const id = await queue.send(name, job, { id: jobId, db: fromDrizzle(transaction, sql) });
  if (id === null) {
    throw new Error('DELIVERY_ENQUEUE_FAILED: job insertion was suppressed');
  }
  const result = await transaction.execute(sql`UPDATE pgboss.job
    SET keep_until = 'infinity'::timestamptz
    WHERE name = ${name} AND id = ${id}::uuid RETURNING id`);
  if (result.rows.length !== 1) {
    throw new Error('DELIVERY_ENQUEUE_FAILED: unfinished job retention was not protected');
  }
  return id;
}

/**
 * Completes only the fetched claim in the transaction containing its result writes.
 * A lost claim throws so application state and any successor insertion roll back.
 * @param queue - Started provider queue handle.
 * @param transaction - Transaction containing delivery result and event writes.
 * @param provider - Provider queue from which the job was fetched.
 * @param claim - ID and retry count returned by pg-boss fetch, retained without alteration.
 * @returns Resolves when exactly one active claim is completed.
 * @throws {Error} DELIVERY_QUEUE_CLAIM_LOST if the claim is stale or no longer active. Database failures propagate.
 * @example
 * ```ts
 * await completeDeliveryJob(queue, transaction, job.provider, claim);
 * ```
 */
export async function completeDeliveryJob(
  queue: QueueRuntime,
  transaction: TenantTransaction,
  provider: DeliveryJob['provider'],
  claim: { id: string; retryCount: number },
): Promise<void> {
  const result = await queue.complete(`delivery-${provider}`, claim, null, {
    db: fromDrizzle(transaction, sql),
  });
  const parsed = v.safeParse(v.looseObject({ affected: v.literal(1) }), result);
  if (!parsed.success) {
    throw new Error('DELIVERY_QUEUE_CLAIM_LOST: delivery claim is no longer active');
  }
}
