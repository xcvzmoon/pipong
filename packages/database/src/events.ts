import type { EnvironmentScope } from './recipients/index.ts';
import type { TenantTransaction } from './tenancy/index.ts';
import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import { deliveryEvents, eventStreams } from './events-schema.ts';

export type DeliveryEventRecord = typeof deliveryEvents.$inferSelect;
export type DeliveryEventInput = Pick<
  DeliveryEventRecord,
  'notificationId' | 'deliveryId' | 'state'
>;
export type EventReplay = { sequence: bigint; watermark: bigint; items: DeliveryEventRecord[] };

/**
 * Appends an event under a stream lock held until the caller commits or rolls back.
 * Persist its associated state change in this same transaction. Acquire stream
 * locks in a consistent order when touching several environments.
 * @param transaction - Authorized environment transaction containing state writes.
 * @param scope - Owning environment.
 * @param input - Validated identifiers and resulting delivery state.
 * @returns Persisted event, visible only after commit.
 * @throws {Error} EVENT_STREAM_UNAVAILABLE if the stream cannot be updated. Database failures propagate and must roll back state writes.
 * @example
 * ```ts
 * await appendDeliveryEvent(transaction, scope, { notificationId, deliveryId, state: 'queued' });
 * ```
 */
export async function appendDeliveryEvent(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  input: DeliveryEventInput,
): Promise<DeliveryEventRecord> {
  await transaction.insert(eventStreams).values(scope).onConflictDoNothing();
  const [stream] = await transaction
    .update(eventStreams)
    .set({ sequence: sql`${eventStreams.sequence} + 1` })
    .where(streamScope(scope))
    .returning();
  if (!stream) {
    throw new Error('EVENT_STREAM_UNAVAILABLE: environment stream is unavailable');
  }
  const [event] = await transaction
    .insert(deliveryEvents)
    .values({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      environmentId: scope.environmentId,
      sequence: stream.sequence,
      ...input,
    })
    .returning();
  if (!event) {
    throw new Error('EVENT_STREAM_UNAVAILABLE: event insertion failed');
  }
  return event;
}

/**
 * Reads a bounded page while holding a shared stream lock against concurrent pruning.
 * @param transaction - Authorized environment transaction; keep it short.
 * @param scope - Owning environment.
 * @param after - Exclusive acknowledged sequence, or undefined for retained history.
 * @param limit - Validated maximum row count.
 * @returns Stream bounds and retained rows in commit order. A missing stream has zero bounds.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const replay = await readDeliveryEvents(transaction, scope, 0n, 50);
 * ```
 */
export async function readDeliveryEvents(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  after: bigint | undefined,
  limit: number,
): Promise<EventReplay> {
  const [stream] = await transaction
    .select()
    .from(eventStreams)
    .where(streamScope(scope))
    .for('share');
  if (!stream) {
    return { sequence: 0n, watermark: 0n, items: [] };
  }
  const items = await transaction
    .select()
    .from(deliveryEvents)
    .where(
      and(
        eq(deliveryEvents.organizationId, scope.organizationId),
        eq(deliveryEvents.projectId, scope.projectId),
        eq(deliveryEvents.environmentId, scope.environmentId),
        gt(deliveryEvents.sequence, after ?? stream.watermark),
        lte(deliveryEvents.sequence, stream.sequence),
      ),
    )
    .orderBy(asc(deliveryEvents.sequence))
    .limit(limit);
  return { sequence: stream.sequence, watermark: stream.watermark, items };
}

/**
 * Prunes a contiguous expired prefix and advances its watermark atomically.
 * Later rows remain when an earlier event is still within retention. Use a
 * worker tenant transaction; callers cannot prune events newer than seven days.
 * @param transaction - Worker transaction with environment context.
 * @param scope - Environment to prune.
 * @returns Last removed sequence, or zero for a missing stream.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * await pruneDeliveryEvents(transaction, scope);
 * ```
 */
export async function pruneDeliveryEvents(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
): Promise<bigint> {
  const [stream] = await transaction
    .select()
    .from(eventStreams)
    .where(streamScope(scope))
    .for('update');
  if (!stream) {
    return 0n;
  }
  const [retained] = await transaction
    .select({ sequence: deliveryEvents.sequence })
    .from(deliveryEvents)
    .where(
      and(
        eq(deliveryEvents.environmentId, scope.environmentId),
        sql`${deliveryEvents.createdAt} >= clock_timestamp() - interval '7 days'`,
      ),
    )
    .orderBy(asc(deliveryEvents.sequence))
    .limit(1);
  const watermark = retained ? retained.sequence - 1n : stream.sequence;
  await transaction
    .delete(deliveryEvents)
    .where(
      and(
        eq(deliveryEvents.environmentId, scope.environmentId),
        lte(deliveryEvents.sequence, watermark),
      ),
    );
  await transaction.update(eventStreams).set({ watermark }).where(streamScope(scope));
  return watermark;
}

function streamScope(scope: EnvironmentScope): ReturnType<typeof and> {
  return and(
    eq(eventStreams.organizationId, scope.organizationId),
    eq(eventStreams.projectId, scope.projectId),
    eq(eventStreams.environmentId, scope.environmentId),
  );
}
