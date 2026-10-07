import type { Db } from 'pg-boss';
import type { AuthTransaction } from './auth/client.ts';
import type { DatabaseRuntime } from './clients.ts';
import { sql } from 'drizzle-orm';
import { PgBoss, fromDrizzle } from 'pg-boss';

/**
 * Starts pg-boss on the existing pool without creating or migrating queue storage.
 * Stop the returned queue before closing the database runtime.
 */
export async function startQueue(database: DatabaseRuntime): Promise<PgBoss> {
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

export function authTransactionQueue(transaction: AuthTransaction): Db {
  return fromDrizzle(transaction, sql);
}
