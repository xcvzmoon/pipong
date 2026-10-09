import type { Db } from 'pg-boss';
import type { AuthTransaction } from './auth/client.ts';
import type { DatabaseRuntime } from './clients.ts';
import { sql } from 'drizzle-orm';
import { PgBoss, fromDrizzle } from 'pg-boss';

/**
 * Starts pg-boss on the existing pool without creating or migrating queue storage.
 *
 * Queue migrations must be applied before startup. Stop the queue before closing
 * the database runtime.
 *
 * @param database - Runtime whose pool will execute queue queries.
 * @param role - Producer or worker process; only workers supervise jobs.
 * @returns Started queue backed by the pgboss schema.
 * @throws {Error} AUTH_MAIL_QUEUE_STARTUP_FAILED when startup fails; the queue is stopped before rejection.
 *
 * @example
 * ```ts
 * const queue = await startQueue(database, 'worker');
 * try {
 *   await runWorker(queue);
 * } finally {
 *   await queue.stop({ graceful: true });
 * }
 * ```
 */
export async function startQueue(
  database: DatabaseRuntime,
  role: 'producer' | 'worker',
): Promise<PgBoss> {
  const queue = new PgBoss({
    db: { executeSql: (text, values) => database.pool.query(text, values) },
    schema: 'pgboss',
    migrate: false,
    createSchema: false,
    schedule: false,
    reindex: false,
    supervise: role === 'worker',
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

/**
 * Adapts an authentication transaction for atomic pg-boss job insertion.
 *
 * @param transaction - Enrollment transaction that must also contain the account changes.
 * @returns Queue database adapter using the supplied transaction.
 *
 * @example
 * ```ts
 * await queue.send('auth-email', mail, {
 *   db: authTransactionQueue(transaction),
 * });
 * ```
 */
export function authTransactionQueue(transaction: AuthTransaction): Db {
  return fromDrizzle(transaction, sql);
}
