import type { DatabaseRuntime } from '@pipong/database';
import type { ProviderOutcome, SendReservation } from '@pipong/database/attempts';
import type { QueueRuntime } from '@pipong/database/delivery-queue';
import type { ApnsRuntime } from './providers/apns.ts';
import type { FcmRuntime } from './providers/fcm.ts';
import type { WebPushRuntime } from './providers/web-push.ts';
import type { SecretKeyring } from './secrets.ts';
import { fetchDeliveryJobs } from '@pipong/database/delivery-queue';
import { setTimeout } from 'node:timers/promises';
import { v7 } from 'uuid';
import { reserveDelivery } from './delivery.ts';
import { settleApnsDelivery } from './providers/apns.ts';
import { settleFcmDelivery } from './providers/fcm.ts';
import { settleWebPushDelivery } from './providers/web-push.ts';
import { loadSecretKeyring } from './secrets.ts';
import { writeTelemetry } from './telemetry.ts';

export type DeliveryConsumer =
  | { provider: 'apns'; runtime: ApnsRuntime }
  | { provider: 'fcm'; runtime: FcmRuntime }
  | { provider: 'web-push'; runtime: WebPushRuntime };
type ReservedSend = Extract<SendReservation, { status: 'send' }>;
type FailedSend = { outcome: ProviderOutcome; response: null };

async function dispatch(
  database: DatabaseRuntime,
  queue: QueueRuntime,
  consumer: DeliveryConsumer,
  reservation: ReservedSend,
  keyring: SecretKeyring,
): Promise<void> {
  switch (consumer.provider) {
    case 'apns': {
      const result = await consumer.runtime.send(reservation, keyring).catch(failedSend);
      await settleApnsDelivery(database, queue, reservation, result);
      return;
    }
    case 'fcm': {
      const result = await consumer.runtime.send(reservation, keyring).catch(failedSend);
      await settleFcmDelivery(database, queue, reservation, result);
      return;
    }
    case 'web-push': {
      const result = await consumer.runtime.send(reservation, keyring).catch(failedSend);
      await settleWebPushDelivery(database, queue, reservation, result);
      return;
    }
    default: {
      return unsupportedConsumer(consumer);
    }
  }
}

function unsupportedConsumer(_consumer: never): never {
  throw new Error('DELIVERY_PROVIDER_INVALID');
}

function failedSend(): FailedSend {
  return {
    response: null,
    outcome: {
      kind: 'ambiguous',
      code: 'DELIVERY_SENDER_FAILED',
      retryAt: new Date(Date.now() + 60_000),
      successorId: v7(),
    },
  };
}

/**
 * Runs one bounded provider consumer through admission, reservation, and settlement.
 * Reloads the keyring before each claim so an unreadable keyring prevents new reservations.
 * Database failures leave the claim for queue recovery; send failures record an
 * ambiguous result through the application retry policy without logging secrets.
 * @param database - Worker database runtime, kept open until this function resolves.
 * @param queue - Started queue on the same database; consumers must not use queue.work.
 * @param consumer - Provider runtime owned by the caller. Close it after this function resolves.
 * @param keyringReference - Absolute path to the separately managed encryption keyring.
 * @param signal - Stops new claims and idle waits. A fetched claim finishes before shutdown resolves.
 * @returns Resolves after abort and any in-flight bounded send and settlement have drained. Each consumer runs at most one send at a time; database budgets apply across workers.
 * @example
 * ```ts
 * await runDeliveryConsumer(database, queue, { provider: 'apns', runtime }, keyringPath, signal);
 * runtime.close();
 * ```
 */
export async function runDeliveryConsumer(
  database: DatabaseRuntime,
  queue: QueueRuntime,
  consumer: DeliveryConsumer,
  keyringReference: string,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    let found = false;
    try {
      // eslint-disable-next-line no-await-in-loop -- Reload operator keys before claiming the next sequential send.
      const keyring = await loadSecretKeyring(keyringReference);
      if (signal.aborted) {
        break;
      }
      // eslint-disable-next-line no-await-in-loop -- Claims must pass the database-wide provider and tenant budgets.
      const [job] = await fetchDeliveryJobs(database, queue, consumer.provider);
      if (job) {
        found = true;
        if (job.data.provider !== consumer.provider) {
          throw new Error('DELIVERY_PROVIDER_INVALID');
        }
        // eslint-disable-next-line no-await-in-loop -- Commit send-start before any provider I/O.
        const reservation = await reserveDelivery(database, queue, job.data, job);
        if (reservation.status === 'send') {
          // eslint-disable-next-line no-await-in-loop -- Drain the fetched claim before claiming another or shutting down.
          await dispatch(database, queue, consumer, reservation, keyring);
          writeTelemetry({
            event: 'delivery_settled',
            notificationId: job.data.notificationId,
            deliveryId: job.data.deliveryId,
            attempt: reservation.fence.generation,
          });
        }
      }
    } catch {
      found = false;
      writeTelemetry({ event: 'delivery_consumer_failed' });
    }
    if (!found && !signal.aborted) {
      // eslint-disable-next-line no-await-in-loop -- Idle polling and infrastructure failures are bounded and abortable.
      await setTimeout(1_000, undefined, { signal }).catch(() => undefined);
    }
  }
}
