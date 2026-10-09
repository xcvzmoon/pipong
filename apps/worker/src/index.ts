import { loadMailConfig, startAuthMailWorker } from '@pipong/auth';
import { startQueue, useWorkerDb } from '@pipong/database';
import { loadWorkerConfig } from '@pipong/shared';
import { setInterval } from 'node:timers/promises';

loadWorkerConfig();
const mailConfig = loadMailConfig();
const database = await useWorkerDb();
const mailQueue = await startQueue(database, 'worker').catch(async (error: Error) => {
  await database.close();
  throw error;
});

const abortController = new AbortController();

function stop(): void {
  abortController.abort();
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

console.info('Worker started; authentication email enabled');

let closeMailTransport: (() => Promise<void>) | undefined;

try {
  closeMailTransport = await startAuthMailWorker(mailQueue, mailConfig);
  for await (const _ of setInterval(60_000, undefined, { signal: abortController.signal })) {
  }
} catch (error) {
  if (!abortController.signal.aborted) {
    throw error;
  }
} finally {
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  try {
    await mailQueue.stop({ graceful: true, timeout: 30_000 });
  } finally {
    try {
      await closeMailTransport?.();
    } finally {
      await database.close();
    }
  }
}

console.info('Worker stopped');
