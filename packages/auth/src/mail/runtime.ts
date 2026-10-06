import type { DatabaseRuntime } from '@pipong/database';
import { PgBoss } from 'pg-boss';

export const authMailQueueName = 'auth-email';

/**
 * Starts pg-boss on the existing pool without creating or migrating queue storage.
 * Stop the returned queue before closing the database runtime.
 */
export async function startMailQueue(database: DatabaseRuntime): Promise<PgBoss> {
  const queue = new PgBoss({
    db: { executeSql: (text, values) => database.pool.query(text, values) },
    schema: 'pgboss',
    migrate: false,
    createSchema: false,
    schedule: false,
    reindex: false,
  });

  queue.on('error', () => {
    console.error('AUTH_MAIL_QUEUE_ERROR: queue operation failed');
  });

  try {
    await queue.start();
    return queue;
  } catch {
    await queue.stop();
    throw new Error('AUTH_MAIL_QUEUE_STARTUP_FAILED: apply queue migrations before startup');
  }
}
