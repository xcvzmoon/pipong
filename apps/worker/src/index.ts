import { loadMailConfig, startAuthMailWorker } from '@pipong/auth';
import { useWorkerDb } from '@pipong/database';
import { startDeliveryQueue } from '@pipong/database/delivery-queue';
import { publishWorkerHeartbeat, removeWorkerHeartbeat } from '@pipong/database/telemetry';
import { writeTelemetry } from '@pipong/service';
import { loadWorkerConfig } from '@pipong/shared';
import { randomUUID } from 'node:crypto';
import { setInterval } from 'node:timers/promises';
import { runRetention } from './retention.ts';

loadWorkerConfig();
const mailConfig = loadMailConfig();
const database = await useWorkerDb();
const mailQueue = await startDeliveryQueue(database, 'worker').catch(async (error: Error) => {
  await database.close();
  throw error;
});

const workerId = randomUUID();
const abortController = new AbortController();

function stop(): void {
  abortController.abort();
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

writeTelemetry({ event: 'worker_started' });

let heartbeatTimer: ReturnType<typeof globalThis.setInterval> | undefined;
let heartbeat: Promise<void> | undefined;
let closeMailTransport: (() => Promise<void>) | undefined;

try {
  closeMailTransport = await startAuthMailWorker(mailQueue, mailConfig);
  await publishWorkerHeartbeat(database, workerId, ['auth-email']);
  heartbeatTimer = globalThis.setInterval(() => {
    if (heartbeat) {
      return;
    }
    heartbeat = publishWorkerHeartbeat(database, workerId, ['auth-email'])
      .catch(() => {
        writeTelemetry({ event: 'worker_heartbeat_failed' });
      })
      .finally(() => {
        heartbeat = undefined;
      });
  }, 30_000);
  heartbeatTimer.unref();
  await runRetention(database);
  for await (const _ of setInterval(60_000, undefined, { signal: abortController.signal })) {
    await runRetention(database);
  }
} catch (error) {
  if (!abortController.signal.aborted) {
    throw error;
  }
} finally {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  await heartbeat;
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  try {
    await removeWorkerHeartbeat(database, workerId).catch(() => {
      writeTelemetry({ event: 'worker_heartbeat_failed' });
    });
    await mailQueue.stop({ graceful: true, timeout: 30_000 });
  } finally {
    try {
      await closeMailTransport?.();
    } finally {
      await database.close();
    }
  }
}

writeTelemetry({ event: 'worker_stopped' });
