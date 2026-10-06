import { useWorkerDb } from '@pipong/database';
import { loadWorkerConfig } from '@pipong/shared';
import { setInterval } from 'node:timers/promises';

loadWorkerConfig();
const database = await useWorkerDb();

const abortController = new AbortController();

function stop(): void {
  abortController.abort();
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

console.info('Worker started; no delivery consumers are enabled');

try {
  for await (const _ of setInterval(60_000, undefined, { signal: abortController.signal })) {
    // Waiting for shutdown.
  }
} catch (error) {
  if (!abortController.signal.aborted) {
    throw error;
  }
} finally {
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  await database.close();
}

console.info('Worker stopped');
