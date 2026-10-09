import type { DeliveryEventInput } from '@pipong/database/events';
import type { EnvironmentScope } from '@pipong/database/recipients';
import type { TenantTransaction } from '@pipong/database/tenancy';
import { appendDeliveryEvent, readDeliveryEvents } from '@pipong/database/events';
import * as v from 'valibot';

export const deliveryEventInputSchema = v.strictObject({
  notificationId: v.pipe(v.string(), v.uuid()),
  deliveryId: v.pipe(v.string(), v.uuid()),
  state: v.picklist([
    'queued',
    'sending',
    'retry_wait',
    'provider_accepted',
    'failed',
    'expired',
    'canceled',
  ]),
});
export type DeliveryEvent = DeliveryEventInput & { id: string; createdAt: string };
export type EventCursor = string;
export type ReplayWatermark = EventCursor;
export type EventPage = {
  items: DeliveryEvent[];
  nextCursor: EventCursor;
  watermark: ReplayWatermark;
  hasMore: boolean;
};
export type EventReplayResult =
  | { ok: true; value: EventPage }
  | { ok: false; status: 410 | 422; code: 'event_cursor_expired' | 'event_cursor_invalid' };

/**
 * Validates and appends a minimal event in the transaction that changes delivery state.
 * This internal operation grants no authority and never stores provider bodies or secrets.
 * @param transaction - Authorized environment transaction containing state writes.
 * @param scope - Owning environment.
 * @param input - Notification ID, delivery ID, and resulting state.
 * @returns Event with a stream-bound ID; it becomes visible after commit.
 * @throws {Error} EVENT_INPUT_INVALID for invalid identifiers or state. Database failures propagate and must roll back the caller's state writes.
 * @example
 * ```ts
 * await recordDeliveryEvent(transaction, scope, { notificationId, deliveryId, state: 'queued' });
 * ```
 */
export async function recordDeliveryEvent(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  input: DeliveryEventInput,
): Promise<DeliveryEvent> {
  const parsed = v.safeParse(deliveryEventInputSchema, input);
  if (!parsed.success) {
    throw new Error('EVENT_INPUT_INVALID: invalid delivery event');
  }
  const event = await appendDeliveryEvent(transaction, scope, parsed.output);
  return {
    ...parsed.output,
    id: eventCursor(scope, event.sequence),
    createdAt: event.createdAt.toISOString(),
  };
}

/**
 * Replays retained events after an acknowledged stream-bound cursor.
 * Repeating a cursor returns the same retained events; deduplicate by event ID.
 * @param transaction - Short transaction after event:read authorization.
 * @param scope - Owning environment.
 * @param limit - Validated page size from 1 to 100.
 * @param cursor - Previous nextCursor, or undefined to start at retained history.
 * @returns Page and resume cursor, or 422 for invalid/wrong-stream/future cursors and 410 when retention removed required history.
 * @throws {Error} Database failures propagate.
 * @example
 * ```ts
 * const result = await replayDeliveryEvents(transaction, scope, 50, undefined);
 * if (result.ok) console.info(result.value.nextCursor);
 * ```
 */
export async function replayDeliveryEvents(
  transaction: TenantTransaction,
  scope: EnvironmentScope,
  limit: number,
  cursor: EventCursor | undefined,
): Promise<EventReplayResult> {
  const after = readEventCursor(scope, cursor);
  if (after === false) {
    return { ok: false, status: 422, code: 'event_cursor_invalid' };
  }
  const replay = await readDeliveryEvents(transaction, scope, after, limit + 1);
  if (after !== undefined && after < replay.watermark) {
    return { ok: false, status: 410, code: 'event_cursor_expired' };
  }
  if (after !== undefined && after > replay.sequence) {
    return { ok: false, status: 422, code: 'event_cursor_invalid' };
  }
  const records = replay.items.slice(0, limit);
  const items = records.map(({ notificationId, deliveryId, state, sequence, createdAt }) => ({
    notificationId,
    deliveryId,
    state,
    id: eventCursor(scope, sequence),
    createdAt: createdAt.toISOString(),
  }));
  const last = records.at(-1)?.sequence ?? after ?? replay.watermark;
  return {
    ok: true,
    value: {
      items,
      nextCursor: eventCursor(scope, last),
      watermark: eventCursor(scope, replay.watermark),
      hasMore: replay.items.length > limit,
    },
  };
}

function eventCursor(scope: EnvironmentScope, sequence: bigint): EventCursor {
  return Buffer.from(
    `1.${scope.organizationId}.${scope.projectId}.${scope.environmentId}.${sequence}`,
  ).toString('base64url');
}

function readEventCursor(
  scope: EnvironmentScope,
  cursor: EventCursor | undefined,
): bigint | false | undefined {
  if (cursor === undefined) {
    return undefined;
  }
  if (!/^[A-Za-z0-9_-]{1,1024}$/.test(cursor)) {
    return false;
  }
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const [version, organizationId, projectId, environmentId, sequence, extra] = decoded.split('.');
  if (
    Buffer.from(decoded).toString('base64url') !== cursor ||
    version !== '1' ||
    organizationId !== scope.organizationId ||
    projectId !== scope.projectId ||
    environmentId !== scope.environmentId ||
    extra !== undefined ||
    sequence === undefined ||
    !/^(0|[1-9]\d{0,18})$/.test(sequence)
  ) {
    return false;
  }
  const parsed = BigInt(sequence);
  return parsed <= 9223372036854775807n ? parsed : false;
}
