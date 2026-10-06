import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export { parseDatabaseUrl } from './env.ts';
export { runMigrations } from './migrate.ts';

export type DatabaseRuntime = {
  db: NodePgDatabase;
  pool: Pool;
  close: () => Promise<void>;
};

export async function openDatabase(
  connectionString: string,
  max: number,
  role: 'pipong_api' | 'pipong_worker',
): Promise<DatabaseRuntime> {
  const pool = new Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
    application_name: role,
  });
  pool.on('error', () => {
    console.error('DATABASE_POOL_ERROR: idle connection failed');
  });
  try {
    const result = await pool.query<{ permitted: boolean }>(
      `
      SELECT current_user = $1 AND NOT rolsuper AND NOT rolbypassrls
        AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
        AND NOT has_database_privilege(current_database(), 'CREATE')
        AND NOT has_database_privilege(current_database(), 'TEMP')
        AND NOT has_schema_privilege('public', 'CREATE')
        AND NOT has_schema_privilege('app', 'CREATE')
        AND NOT has_schema_privilege('auth', 'CREATE')
        AND NOT has_schema_privilege('pgboss', 'CREATE') AS permitted
      FROM pg_roles WHERE rolname = current_user
    `,
      [role],
    );
    if (!result.rows[0]?.permitted) {
      throw new Error('DATABASE_ROLE_INVALID: runtime role has unsafe privileges');
    }
  } catch {
    await pool.end();
    throw new Error('DATABASE_STARTUP_FAILED: connection or runtime privileges invalid');
  }
  return { db: drizzle({ client: pool }), pool, close: () => pool.end() };
}
