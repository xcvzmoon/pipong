import type { Principal } from '@pipong/auth';
import type { DatabaseRuntime } from '@pipong/database';
import type { EnvironmentScope } from '@pipong/database/recipients';
import type { AuthorizationFailure } from './authorize.ts';
import type { DeliveryEvent, EventReplayResult } from './events.ts';
import { withAuthorizedTransaction } from './authorize.ts';
import { replayDeliveryEvents } from './events.ts';

export type StreamMessage = { kind: 'delivery'; value: DeliveryEvent } | { kind: 'heartbeat' };
export type StreamSubscription = { disconnect: () => void };
export type StreamOpenResult =
  | { ok: true; value: StreamSubscription }
  | AuthorizationFailure
  | Extract<EventReplayResult, { ok: false }>
  | { ok: false; status: 429 | 503; code: 'EVENT_STREAM_CAPACITY' | 'EVENT_STREAM_UNAVAILABLE' };
export type EventStreamRuntime = {
  subscribe: (
    principal: Principal,
    scope: EnvironmentScope,
    cursor: string | undefined,
    send: (message: StreamMessage) => Promise<void>,
    close: () => void,
  ) => Promise<StreamOpenResult>;
  close: () => Promise<void>;
  pressure: () => { connections: number; slowDisconnects: number };
};

type Subscriber = {
  principal: Principal;
  cursor: string;
  sequence: bigint;
  send: (message: StreamMessage) => Promise<void>;
  close: () => void;
  queue: StreamMessage[];
  writing: boolean;
  disconnected: boolean;
  heartbeatAt: number;
  deadline: ReturnType<typeof setTimeout> | undefined;
};
type Reader = { scope: EnvironmentScope; subscribers: Set<Subscriber> };

/**
 * Creates one polling reader per active environment, backed by the durable event ledger.
 * Each poll checks each distinct principal's live authority in a short transaction before
 * reading a shared page for each distinct subscriber cursor. No transaction or database connection waits on network writes.
 * @param database - API runtime owned by the application.
 * @returns Subscription manager with a 1,024-connection process cap, 64 per environment,
 * 100 queued messages per connection, one-second polling intervals, 15-second heartbeats,
 * and five-second write deadlines. Transport close callbacks must cancel pending sends.
 * Close the manager before closing the database. Subscription database failures
 * propagate before a stream opens; polling failures disconnect affected streams.
 * @example
 * ```ts
 * const streams = createEventStreamRuntime(database);
 * const result = await streams.subscribe(principal, scope, cursor, send, disconnect);
 * if (result.ok) result.value.disconnect();
 * await streams.close();
 * ```
 */
export function createEventStreamRuntime(database: DatabaseRuntime): EventStreamRuntime {
  const readers = new Map<string, Reader>();
  let connections = 0;
  let slowDisconnects = 0;
  let stopped = false;
  let polling: Promise<void> | undefined;

  function disconnect(reader: Reader, subscriber: Subscriber): void {
    if (subscriber.disconnected) {
      return;
    }
    subscriber.disconnected = true;
    if (subscriber.deadline !== undefined) {
      clearTimeout(subscriber.deadline);
    }
    subscriber.queue.length = 0;
    reader.subscribers.delete(subscriber);
    connections--;
    if (reader.subscribers.size === 0) {
      readers.delete(reader.scope.environmentId);
    }
    subscriber.close();
  }

  async function drain(reader: Reader, subscriber: Subscriber): Promise<void> {
    if (subscriber.writing || subscriber.disconnected) {
      return;
    }
    subscriber.writing = true;
    try {
      // oxlint-disable eslint/no-await-in-loop -- Preserve message order with one bounded write in flight.
      while (!subscriber.disconnected) {
        const message = subscriber.queue.shift();
        if (!message) {
          break;
        }
        subscriber.deadline = setTimeout(() => {
          slowDisconnects++;
          disconnect(reader, subscriber);
        }, 5000);
        await subscriber.send(message);
        clearTimeout(subscriber.deadline);
        subscriber.deadline = undefined;
      }
      // oxlint-enable eslint/no-await-in-loop
    } catch {
      disconnect(reader, subscriber);
    } finally {
      subscriber.writing = false;
    }
  }

  function enqueue(reader: Reader, subscriber: Subscriber, message: StreamMessage): void {
    if (subscriber.disconnected) {
      return;
    }
    if (subscriber.queue.length >= 100) {
      slowDisconnects++;
      disconnect(reader, subscriber);
      return;
    }
    subscriber.queue.push(message);
    void drain(reader, subscriber);
  }

  async function pollReader(reader: Reader): Promise<void> {
    try {
      const participants = [...reader.subscribers];
      const identities = new Map<string, Subscriber[]>();
      const groups = new Map<string, Subscriber[]>();
      for (const subscriber of participants) {
        if (subscriber.disconnected) {
          continue;
        }
        const identity = principalIdentity(subscriber.principal);
        const subscribers = identities.get(identity);
        if (subscribers) {
          subscribers.push(subscriber);
        } else {
          identities.set(identity, [subscriber]);
        }
      }
      // oxlint-disable eslint/no-await-in-loop -- Authorization transactions are short and bounded by the connection cap.
      for (const subscribers of identities.values()) {
        const representative = subscribers[0];
        if (!representative || stopped) {
          return;
        }
        const authority = await withAuthorizedTransaction(
          database,
          representative.principal,
          'event:read',
          reader.scope,
          () => Promise.resolve(true),
        );
        for (const subscriber of subscribers) {
          if (!authority.ok) {
            disconnect(reader, subscriber);
            continue;
          }
          if (subscriber.disconnected) {
            continue;
          }
          const group = groups.get(subscriber.cursor);
          if (group) {
            group.push(subscriber);
          } else {
            groups.set(subscriber.cursor, [subscriber]);
          }
        }
      }
      for (const group of groups.values()) {
        const first = group[0];
        if (!first || stopped) {
          return;
        }
        const replay = await withAuthorizedTransaction(
          database,
          first.principal,
          'event:read',
          reader.scope,
          (transaction) => replayDeliveryEvents(transaction, reader.scope, 100, first.cursor),
        );
        if (!replay.ok) {
          disconnect(reader, first);
          continue;
        }
        if (!replay.value.ok) {
          for (const subscriber of group) {
            disconnect(reader, subscriber);
          }
          continue;
        }
        for (const subscriber of group) {
          if (subscriber.disconnected) {
            continue;
          }
          for (const event of replay.value.value.items) {
            const sequence = cursorSequence(event.id);
            if (sequence > subscriber.sequence) {
              enqueue(reader, subscriber, { kind: 'delivery', value: event });
              subscriber.cursor = event.id;
              subscriber.sequence = sequence;
            }
          }
          if (Date.now() - subscriber.heartbeatAt >= 15_000) {
            enqueue(reader, subscriber, { kind: 'heartbeat' });
            subscriber.heartbeatAt = Date.now();
          }
        }
      }
      // oxlint-enable eslint/no-await-in-loop
    } catch {
      console.error('EVENT_STREAM_UNAVAILABLE: event reader failed');
      for (const subscriber of reader.subscribers) {
        disconnect(reader, subscriber);
      }
    }
  }

  async function poll(): Promise<void> {
    // oxlint-disable eslint/no-await-in-loop -- Bound database concurrency independently of the number of active environments.
    for (const reader of readers.values()) {
      if (stopped) {
        break;
      }
      await pollReader(reader);
    }
    // oxlint-enable eslint/no-await-in-loop
  }

  const timer = setInterval(() => {
    if (!polling && !stopped && readers.size > 0) {
      polling = poll().finally(() => {
        polling = undefined;
      });
    }
  }, 1000);
  timer.unref();

  async function subscribe(
    principal: Principal,
    scope: EnvironmentScope,
    cursor: string | undefined,
    send: (message: StreamMessage) => Promise<void>,
    closeConnection: () => void,
  ): Promise<StreamOpenResult> {
    if (stopped) {
      return { ok: false, status: 503, code: 'EVENT_STREAM_UNAVAILABLE' };
    }
    const initial = await withAuthorizedTransaction(
      database,
      principal,
      'event:read',
      scope,
      (transaction) => replayDeliveryEvents(transaction, scope, 1, cursor),
    );
    if (!initial.ok) {
      return initial;
    }
    if (!initial.value.ok) {
      return initial.value;
    }
    if (stopped) {
      return { ok: false, status: 503, code: 'EVENT_STREAM_UNAVAILABLE' };
    }
    let reader = readers.get(scope.environmentId);
    if (
      connections >= 1024 ||
      (reader?.subscribers.size ?? 0) >= 64 ||
      (!reader && readers.size >= 64)
    ) {
      return { ok: false, status: 429, code: 'EVENT_STREAM_CAPACITY' };
    }
    if (!reader) {
      reader = { scope, subscribers: new Set() };
      readers.set(scope.environmentId, reader);
    }
    const start = cursor ?? initial.value.value.watermark;
    const subscriber: Subscriber = {
      principal,
      cursor: start,
      sequence: cursorSequence(start),
      send,
      close: closeConnection,
      queue: [],
      writing: false,
      disconnected: false,
      heartbeatAt: Date.now(),
      deadline: undefined,
    };
    reader.subscribers.add(subscriber);
    connections++;
    enqueue(reader, subscriber, { kind: 'heartbeat' });
    const subscriptionReader = reader;
    return {
      ok: true,
      value: {
        disconnect: () => {
          disconnect(subscriptionReader, subscriber);
        },
      },
    };
  }

  async function close(): Promise<void> {
    stopped = true;
    clearInterval(timer);
    for (const reader of readers.values()) {
      for (const subscriber of reader.subscribers) {
        disconnect(reader, subscriber);
      }
    }
    await polling;
  }

  return { subscribe, close, pressure: () => ({ connections, slowDisconnects }) };
}

function cursorSequence(cursor: string): bigint {
  const sequence = Buffer.from(cursor, 'base64url').toString('utf8').split('.').at(-1);
  if (sequence === undefined) {
    throw new Error('EVENT_CURSOR_INVALID: validated cursor has no sequence');
  }
  return BigInt(sequence);
}

function principalIdentity(principal: Principal): string {
  switch (principal.kind) {
    case 'human':
      return JSON.stringify([principal.kind, principal.userId, principal.sessionId]);
    case 'service-key':
      return JSON.stringify([principal.kind, principal.keyId, principal.organizationId]);
    default: {
      const unreachable: never = principal;
      throw new Error('EVENT_STREAM_PRINCIPAL_INVALID: unsupported principal', {
        cause: unreachable,
      });
    }
  }
}
