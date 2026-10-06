import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';

export async function runMigrations(
  connectionString: string,
  migrationsFolder: string,
): Promise<void> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  client.on('error', () => {
    console.error('DATABASE_MIGRATION_CONNECTION_ERROR');
  });
  try {
    await client.connect();
    const result = await client.query<{ permitted: boolean }>(`
      SELECT current_user = 'pipong_migrator' AND NOT rolsuper AND NOT rolbypassrls
        AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AS permitted
      FROM pg_roles WHERE rolname = current_user
    `);
    if (!result.rows[0]?.permitted) throw new Error('invalid migration role');
    await client.query("SET lock_timeout = '5s'");
    await client.query('SELECT pg_advisory_lock(782347102)');
    await migrate(drizzle({ client }), { migrationsFolder, migrationsSchema: 'pipong_migrations' });
  } catch {
    throw new Error('DATABASE_MIGRATION_FAILED: migration could not complete');
  } finally {
    await client.end();
  }
}
