import { setInterval } from 'node:timers/promises';

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
}

console.info('Worker stopped');
