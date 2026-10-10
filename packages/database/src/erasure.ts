import type { DatabaseRuntime } from './clients.ts';
import type { EnvironmentScope } from './recipients/index.ts';
import type { TenantScope, TenantTransaction } from './tenancy/index.ts';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { publishDeliveryState } from './attempts.ts';
import { organizations } from './auth/schema.ts';
import { erasureJobs } from './erasure-schema.ts';
import { deliveries, notifications } from './submission-schema.ts';
import { setTenantScope } from './tenancy/index.ts';
import { environments, projects } from './tenancy/schema.ts';

export type ErasureJob = typeof erasureJobs.$inferSelect;
export type ErasureReceipt = { erasureId: string; requestedAt: Date; inFlightUntil: Date };

/**
 * Tombstones an authorized scope and records resumable erasure in the same transaction.
 * The authorization boundary must hold the target lifecycle row for update.
 * @param transaction - Authorized tenant transaction.
 * @param scope - Organization, project, or environment to erase.
 * @param actorId - Authenticated human actor for the retained audit.
 * @returns Durable erasure receipt. New reservations fail after commit.
 * @throws {Error} ERASURE_REQUEST_FAILED when the job cannot be persisted; database failures roll back suspension.
 * @example
 * ```ts
 * const receipt = await requestScopeErasure(transaction, scope, principal.userId);
 * ```
 */
export async function requestScopeErasure(
  transaction: TenantTransaction,
  scope: TenantScope,
  actorId: string,
): Promise<ErasureReceipt> {
  if (scope.kind === 'organization') {
    await transaction
      .update(organizations)
      .set({
        disabledAt: sql`coalesce(${organizations.disabledAt}, clock_timestamp())`,
        deletedAt: sql`clock_timestamp()`,
      })
      .where(eq(organizations.id, scope.organizationId));
  } else if (scope.kind === 'project') {
    await transaction
      .update(projects)
      .set({
        suspendedAt: sql`coalesce(${projects.suspendedAt}, clock_timestamp())`,
        deletedAt: sql`clock_timestamp()`,
      })
      .where(
        and(eq(projects.id, scope.projectId), eq(projects.organizationId, scope.organizationId)),
      );
  } else {
    await transaction
      .update(environments)
      .set({
        suspendedAt: sql`coalesce(${environments.suspendedAt}, clock_timestamp())`,
        deletedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(environments.id, scope.environmentId),
          eq(environments.projectId, scope.projectId),
          eq(environments.organizationId, scope.organizationId),
        ),
      );
  }
  return insertErasureJob(transaction, scope, null, actorId);
}

/**
 * Records cleanup for an already tombstoned recipient while its row is locked.
 * @param transaction - Authorized recipient deletion transaction.
 * @param scope - Owning environment.
 * @param recipientId - Recipient just tombstoned in this transaction.
 * @param actorId - Authenticated human or service-key identifier.
 * @returns Durable erasure receipt.
 * @throws {Error} ERASURE_REQUEST_FAILED if insertion fails; database failures propagate.
 * @example
 * ```ts
 * await requestRecipientErasure(transaction, scope, recipientId, actorId);
 * ```
 */
export function requestRecipientErasure(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  recipientId: string,
  actorId: string,
): Promise<ErasureReceipt> {
  return insertErasureJob(transaction, scope, recipientId, actorId);
}

async function insertErasureJob(
  transaction: TenantTransaction,
  scope: TenantScope,
  recipientId: string | null,
  actorId: string,
): Promise<ErasureReceipt> {
  const kind = recipientId === null ? scope.kind : 'recipient';
  const targetId =
    recipientId ??
    (scope.kind === 'organization'
      ? scope.organizationId
      : scope.kind === 'project'
        ? scope.projectId
        : scope.environmentId);
  const [job] = await transaction
    .insert(erasureJobs)
    .values({
      organizationId: scope.organizationId,
      projectId: scope.kind === 'organization' ? null : scope.projectId,
      environmentId: scope.kind === 'environment' ? scope.environmentId : null,
      recipientId,
      targetId,
      kind,
      actorId,
      requestedAt: sql`statement_timestamp()`,
      inFlightUntil: sql`statement_timestamp() + interval '2 minutes'`,
    })
    .onConflictDoUpdate({ target: [erasureJobs.kind, erasureJobs.targetId], set: { targetId } })
    .returning();
  if (!job) {
    throw new Error('ERASURE_REQUEST_FAILED');
  }
  return { erasureId: job.id, requestedAt: job.requestedAt, inFlightUntil: job.inFlightUntil };
}

/**
 * Discovers at most ten pending jobs through a worker-only function.
 * @param database - Worker runtime.
 * @returns Identifier-only jobs ordered by their last committed batch.
 * @throws {Error} Database or stored identifier validation failures propagate.
 * @example
 * ```ts
 * const jobs = await readPendingErasures(database);
 * ```
 */
export async function readPendingErasures(
  database: DatabaseRuntime,
): Promise<{ id: string; organizationId: string }[]> {
  const result = await database.pool.query(
    'SELECT id, organization_id AS "organizationId" FROM app.pending_erasures()',
  );
  return v.parse(
    v.array(
      v.object({ id: v.pipe(v.string(), v.uuid()), organizationId: v.pipe(v.string(), v.uuid()) }),
    ),
    result.rows,
  );
}

/**
 * Advances one bounded, restart-safe cleanup batch without provider I/O.
 * Organization update locks serialize cleanup with all authorized operations and reservations.
 * Each stage processes at most 100 records with atomic accounting and events; in-flight sends settle for two minutes,
 * then unfinished attempts become ambiguous and cannot settle through their old fence.
 * @param transaction - Worker transaction with the job's organization context.
 * @param id - Identifier discovered by readPendingErasures.
 * @returns Whether an unfinished job was processed.
 * @throws {Error} Database failures roll back both cleanup and progress.
 * @example
 * ```ts
 * await withTenantTransaction(database, scope, transaction => advanceErasure(transaction, id));
 * ```
 */
export async function advanceErasure(transaction: TenantTransaction, id: string): Promise<boolean> {
  await transaction.execute(
    sql`SELECT set_config('statement_timeout','5000',true), set_config('lock_timeout','1000',true)`,
  );
  await transaction.execute(sql`SELECT app.lock_erasure_organization()`);
  const [job] = await transaction
    .select()
    .from(erasureJobs)
    .where(and(eq(erasureJobs.id, id), isNull(erasureJobs.completedAt)))
    .for('update');
  if (!job) {
    return false;
  }
  await transaction
    .update(erasureJobs)
    .set({ updatedAt: sql`clock_timestamp()` })
    .where(eq(erasureJobs.id, id));
  if (job.stage === 'projects' || job.stage === 'auth') {
    await finishRoot(transaction, job);
    return true;
  }
  let environmentId = job.currentEnvironmentId;
  if (environmentId === null) {
    const [environment] = await transaction
      .select()
      .from(environments)
      .where(
        and(
          eq(environments.organizationId, job.organizationId),
          job.projectId ? eq(environments.projectId, job.projectId) : undefined,
          job.environmentId ? eq(environments.id, job.environmentId) : undefined,
          job.environmentCursor ? gt(environments.id, job.environmentCursor) : undefined,
        ),
      )
      .orderBy(asc(environments.id))
      .limit(1);
    if (!environment) {
      await transaction
        .update(erasureJobs)
        .set({ stage: 'projects' })
        .where(eq(erasureJobs.id, id));
      return true;
    }
    environmentId = environment.id;
    await transaction
      .update(erasureJobs)
      .set({ currentEnvironmentId: environmentId })
      .where(eq(erasureJobs.id, id));
  }
  const [environment] = await transaction
    .select()
    .from(environments)
    .where(eq(environments.id, environmentId));
  if (!environment) {
    throw new Error('ERASURE_SCOPE_MISSING');
  }
  const scope = {
    kind: 'environment',
    organizationId: job.organizationId,
    projectId: environment.projectId,
    environmentId,
  } as const;
  await setTenantScope(transaction, scope);
  const nextStage = await eraseEnvironmentBatch(transaction, scope, job);
  await transaction
    .update(erasureJobs)
    .set(
      nextStage === 'projects'
        ? { stage: 'notifications', currentEnvironmentId: null, environmentCursor: environmentId }
        : { stage: nextStage },
    )
    .where(eq(erasureJobs.id, id));
  return true;
}

async function eraseEnvironmentBatch(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  job: ErasureJob,
): Promise<ErasureJob['stage']> {
  const recipient = job.recipientId;
  const endpointPredicate =
    recipient === null ? sql`true` : sql`endpoint.recipient_id = ${recipient}::uuid`;
  switch (job.stage) {
    case 'notifications': {
      const result = await transaction.execute(
        sql`SELECT app.erase_notification_payloads(${recipient}::uuid, false) AS count`,
      );
      return v.parse(v.object({ count: v.number() }), result.rows[0]).count > 0
        ? 'notifications'
        : 'deliveries';
    }
    case 'deliveries': {
      const rows = await transaction
        .select({ delivery: deliveries })
        .from(deliveries)
        .where(
          and(
            sql`${deliveries.state} IN ('queued','retry_wait','sending')`,
            recipient === null
              ? undefined
              : sql`EXISTS (SELECT 1 FROM app.deliveries affected JOIN app.endpoints endpoint ON endpoint.id=affected.endpoint_id WHERE affected.notification_id=${deliveries.notificationId} AND ${endpointPredicate})`,
          ),
        )
        .orderBy(asc(deliveries.notificationId), asc(deliveries.id))
        .limit(100);
      let waiting = false;
      // oxlint-disable eslint/no-await-in-loop -- Lifecycle lock order and ordered event publication require sequential writes.
      for (const { delivery } of rows) {
        await transaction
          .select({ id: notifications.id })
          .from(notifications)
          .where(eq(notifications.id, delivery.notificationId))
          .for('update');
        const [locked] = await transaction
          .select()
          .from(deliveries)
          .where(eq(deliveries.id, delivery.id))
          .for('update');
        if (!locked || !['queued', 'retry_wait', 'sending'].includes(locked.state)) {
          continue;
        }
        if (locked.state === 'sending') {
          const clock = await transaction.execute(
            sql`SELECT clock_timestamp() < ${job.inFlightUntil} AS waiting`,
          );
          if (v.parse(v.object({ waiting: v.boolean() }), clock.rows[0]).waiting) {
            waiting = true;
            continue;
          }
          await transaction.execute(
            sql`UPDATE app.delivery_attempts SET finished_at=clock_timestamp(), outcome='ambiguous', code='DELIVERY_ERASURE_ABANDONED' WHERE delivery_id=${locked.id}::uuid AND finished_at IS NULL`,
          );
        }
        await transaction
          .update(deliveries)
          .set({ state: 'canceled' })
          .where(eq(deliveries.id, locked.id));
        await publishDeliveryState(
          transaction,
          {
            ...scope,
            notificationId: locked.notificationId,
            deliveryId: locked.id,
            provider: locked.provider,
          },
          'canceled',
        );
        await transaction.execute(
          sql`UPDATE pgboss.job SET state='cancelled', completed_on=clock_timestamp(), keep_until=clock_timestamp()+interval '28 days' WHERE id IN (SELECT id FROM pgboss.job WHERE name=${'delivery-' + locked.provider} AND data->>'deliveryId'=${locked.id} AND state IN ('created','retry','active') ORDER BY id LIMIT 100)`,
        );
      }
      // oxlint-enable eslint/no-await-in-loop
      return rows.length > 0 || waiting ? 'deliveries' : 'generations';
    }
    case 'generations': {
      const receipts = await transaction.execute(
        sql`WITH batch AS (SELECT attempt.ctid FROM app.delivery_attempts attempt JOIN app.deliveries delivery ON delivery.id=attempt.delivery_id JOIN app.endpoints endpoint ON endpoint.id=delivery.endpoint_id WHERE attempt.provider_response IS NOT NULL AND ${endpointPredicate} ORDER BY attempt.delivery_id,attempt.generation LIMIT 100 FOR UPDATE OF attempt) UPDATE app.delivery_attempts attempt SET provider_response=NULL FROM batch WHERE attempt.ctid=batch.ctid RETURNING attempt.delivery_id`,
      );
      if (receipts.rows.length > 0) {
        return 'generations';
      }
      const result = await transaction.execute(
        sql`SELECT app.erase_endpoint_generations(${recipient}::uuid) AS count`,
      );
      return v.parse(v.object({ count: v.number() }), result.rows[0]).count > 0
        ? 'generations'
        : 'endpoints';
    }
    case 'endpoints': {
      const result = await transaction.execute(
        sql`SELECT app.erase_endpoints(${recipient}::uuid) AS count`,
      );
      return v.parse(v.object({ count: v.number() }), result.rows[0]).count > 0
        ? 'endpoints'
        : 'recipients';
    }
    case 'recipients': {
      const result = await transaction.execute(
        sql`SELECT app.erase_recipients(${recipient}::uuid) AS count`,
      );
      return v.parse(v.object({ count: v.number() }), result.rows[0]).count > 0
        ? 'recipients'
        : recipient === null
          ? 'credentials'
          : 'environment';
    }
    case 'credentials': {
      const result = await transaction.execute(sql`SELECT app.erase_credentials() AS count`);
      return v.parse(v.object({ count: v.number() }), result.rows[0]).count > 0
        ? 'credentials'
        : 'keys';
    }
    case 'keys': {
      const result = await transaction.execute(sql`SELECT app.erase_environment_keys() AS count`);
      return v.parse(v.object({ count: v.number() }), result.rows[0]).count > 0
        ? 'keys'
        : 'environment';
    }
    case 'environment': {
      if (recipient === null) {
        await transaction
          .update(environments)
          .set({
            name: null,
            deletedAt: sql`coalesce(${environments.deletedAt},clock_timestamp())`,
            suspendedAt: sql`coalesce(${environments.suspendedAt},clock_timestamp())`,
          })
          .where(eq(environments.id, scope.environmentId));
      }
      return 'projects';
    }
    case 'projects':
    case 'auth':
    case 'done':
      throw new Error('ERASURE_STAGE_INVALID');
    default: {
      const unreachable: never = job.stage;
      throw new Error('ERASURE_STAGE_INVALID', { cause: unreachable });
    }
  }
}

async function finishRoot(transaction: TenantTransaction, job: ErasureJob): Promise<void> {
  if (job.stage === 'projects') {
    if (job.kind === 'organization' || job.kind === 'project') {
      const result = await transaction.execute(
        sql`WITH batch AS (SELECT id FROM app.projects WHERE name IS NOT NULL AND (${job.projectId}::uuid IS NULL OR id=${job.projectId}::uuid) ORDER BY id LIMIT 100 FOR UPDATE) UPDATE app.projects project SET name=NULL, deleted_at=coalesce(deleted_at,clock_timestamp()), suspended_at=coalesce(suspended_at,clock_timestamp()) FROM batch WHERE project.id=batch.id RETURNING project.id`,
      );
      if (result.rows.length > 0) {
        return;
      }
    }
    await transaction.update(erasureJobs).set({ stage: 'auth' }).where(eq(erasureJobs.id, job.id));
    return;
  }
  if (job.kind === 'organization') {
    const result = await transaction.execute(sql`SELECT app.erase_organization_auth() AS count`);
    if (v.parse(v.object({ count: v.number() }), result.rows[0]).count > 0) {
      return;
    }
  }
  await transaction
    .update(erasureJobs)
    .set({ stage: 'done', completedAt: sql`clock_timestamp()` })
    .where(eq(erasureJobs.id, job.id));
}
