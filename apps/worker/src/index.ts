import type { WorkerConsumer } from '@pipong/database/telemetry';
import { loadMailConfig, startAuthMailWorker } from '@pipong/auth';
import { useWorkerDb } from '@pipong/database';
import { startDeliveryQueue } from '@pipong/database/delivery-queue';
import { publishWorkerHeartbeat, removeWorkerHeartbeat } from '@pipong/database/telemetry';
import {
  createApnsRuntime,
  createFcmRuntime,
  createWebPushRuntime,
  loadEgressPolicy,
  loadSecretKeyring,
  runDeliveryConsumer,
  writeTelemetry,
} from '@pipong/service';
import { loadWorkerConfig } from '@pipong/shared';
import { randomUUID } from 'node:crypto';
import { setInterval } from 'node:timers/promises';
import { runRetention } from './retention.ts';

const workerConfig = loadWorkerConfig();
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
let deliveryConsumers: Promise<void> | undefined;
let closeApns: (() => void) | undefined;
let closeFcm: (() => void) | undefined;
const consumers: WorkerConsumer[] = ['auth-email'];
let closeMailTransport: (() => Promise<void>) | undefined;

try {
  closeMailTransport = await startAuthMailWorker(mailQueue, mailConfig);
  if (workerConfig.pushDeliveryEnabled) {
    await loadSecretKeyring(workerConfig.credentialKeyringRef);
    const policy = await loadEgressPolicy(process.env.WEB_PUSH_EGRESS_POLICY_REF);
    const apns = createApnsRuntime();
    closeApns = apns.close;
    const fcm = createFcmRuntime();
    closeFcm = fcm.close;
    const webPush = createWebPushRuntime(workerConfig.webPushSubject, policy);
    deliveryConsumers = Promise.all([
      runDeliveryConsumer(
        database,
        mailQueue,
        { provider: 'apns', runtime: apns },
        workerConfig.credentialKeyringRef,
        abortController.signal,
      ),
      runDeliveryConsumer(
        database,
        mailQueue,
        { provider: 'fcm', runtime: fcm },
        workerConfig.credentialKeyringRef,
        abortController.signal,
      ),
      runDeliveryConsumer(
        database,
        mailQueue,
        { provider: 'web-push', runtime: webPush },
        workerConfig.credentialKeyringRef,
        abortController.signal,
      ),
    ]).then(() => undefined);
    consumers.push('apns', 'fcm', 'web-push');
  }
  await publishWorkerHeartbeat(database, workerId, consumers);
  heartbeatTimer = globalThis.setInterval(() => {
    if (heartbeat) {
      return;
    }
    heartbeat = publishWorkerHeartbeat(database, workerId, consumers)
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
  abortController.abort();
  await deliveryConsumers;
  closeApns?.();
  closeFcm?.();
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
