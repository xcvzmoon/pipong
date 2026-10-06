import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle } from 'drizzle-orm/node-postgres';
import { EnhancedQueryLogger } from 'drizzle-query-logger';
import { Pool } from 'pg';
import { env } from './env.ts';

/**
 * One independently owned PostgreSQL pool and the Drizzle client backed by it.
 * Create a runtime once during application startup and close it during shutdown.
 * API and worker runtimes can connect to the same database with different accounts.
 */
export type DatabaseRuntime = {
  /** Drizzle client for queries and transactions using this runtime's pool. */
  db: NodePgDatabase;
  /**
   * Underlying node-postgres pool for integrations that require a native client.
   * A checked-out client must be released by its caller in a finally block.
   */
  pool: Pool;
  /**
   * Ends the pool after checked-out clients are released. Await during shutdown,
   * after stopping work that could acquire new connections. Call once per runtime.
   */
  close: () => Promise<void>;
};

type DbRole = 'api' | 'worker';

/**
 * Opens and verifies a new connection pool for the `pipong_api` account.
 * Reads API settings from the package's validated environment. Each call creates
 * an independent pool; this function does not cache or reuse a previous runtime.
 * API_DATABASE_URL must be configured before module import.
 * Schema provisioning and migrations must already have completed.
 *
 * @returns A Drizzle client, its native pool, and an asynchronous shutdown function.
 * @throws An error containing `DATABASE_STARTUP_FAILED` if connection or identity
 * checks fail. The pool is closed before rejecting. A missing role URL rejects
 * with DATABASE_CONFIG_INVALID. Environment validation can
 * fail earlier, during module import.
 * @example
 * ```ts
 * import { useApiDb } from '@pipong/database';
 *
 * const database = await useApiDb();
 *
 * try {
 *   await database.pool.query('SELECT 1');
 * } finally {
 *   await database.close();
 * }
 * ```
 */
export function useApiDb(): Promise<DatabaseRuntime> {
  return defineDb('api');
}
/**
 * Opens and verifies a new connection pool for the `pipong_worker` account.
 * Uses worker pool settings and credentials. The provisioned worker account has
 * access to application and queue tables, with no access to authentication tables.
 * Each call creates an independent pool. WORKER_DATABASE_URL must be configured
 * before import; only the worker pool is opened by this function.
 *
 * @returns A Drizzle client, its native pool, and an asynchronous shutdown function.
 * @throws An error containing `DATABASE_STARTUP_FAILED` if connection or identity
 * checks fail. The pool is closed before rejecting. A missing role URL rejects
 * with DATABASE_CONFIG_INVALID. Environment validation can
 * fail earlier, during module import.
 * @example
 * ```ts
 * import { useWorkerDb } from '@pipong/database';
 *
 * const database = await useWorkerDb();
 *
 * try {
 *   await database.pool.query('SELECT 1');
 * } finally {
 *   await database.close();
 * }
 * ```
 */
export function useWorkerDb(): Promise<DatabaseRuntime> {
  return defineDb('worker');
}

async function defineDb(role: DbRole): Promise<DatabaseRuntime> {
  const config = env[role].database;

  if (config.url === undefined) {
    throw new Error(`DATABASE_CONFIG_INVALID: missing ${role.toUpperCase()}_DATABASE_URL`);
  }

  const pool = new Pool({
    connectionString: config.url,
    max: config.maxPool,
    connectionTimeoutMillis: config.connectionTimeout,
    idleTimeoutMillis: config.idleTimeout,
    application_name: config.applicationName,
  });

  pool.on('error', () => {
    console.error('DATABASE_POOL_ERROR: idle connection failed');
  });

  try {
    const { rows } = await pool.query<{ permitted: boolean }>(
      `
        SELECT current_user = $1 AND NOT rolsuper AND NOT rolbypassrls
          AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
          AND NOT has_database_privilege(current_database(), 'CREATE')
          AND NOT has_database_privilege(current_database(), 'TEMP')
          AND NOT has_schema_privilege('public', 'CREATE')
          AND NOT has_schema_privilege('app', 'CREATE')
          AND NOT has_schema_privilege('auth', 'CREATE')
          AND NOT has_schema_privilege('pgboss', 'CREATE') AS permitted
        FROM pg_roles
        WHERE rolname = current_user
      `,
      [`pipong_${role}`],
    );

    if (!rows.at(0)?.permitted) {
      throw new Error('DATABASE_ROLE_INVALID: runtime role has unsafe privileges');
    }
  } catch {
    await pool.end();
    throw new Error('DATABASE_STARTUP_FAILED: connection or runtime privileges invalid');
  }

  return {
    db: drizzle({
      client: pool,
      logger: config.useQueryLogger && new EnhancedQueryLogger(),
    }),
    pool,
    close: () => pool.end(),
  };
}
