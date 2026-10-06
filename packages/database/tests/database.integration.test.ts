import { execFile } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const testUrl = process.env.TEST_DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../migrations/', import.meta.url));
const databaseName = `pipong_test_${process.pid}`;
const admin = new Client({ connectionString: testUrl });
let fixture: Client;
let migrationUrl: string;
let apiUrl: string;
let workerUrl: string;

const runCommand = promisify(execFile);

async function runMigrations(connectionString: string, folder: string): Promise<void> {
  const configFolder = await mkdtemp(join(tmpdir(), 'pipong-drizzle-config-'));
  try {
    const configPath = join(configFolder, 'drizzle.config.ts');
    await writeFile(
      configPath,
      `export default ${JSON.stringify({ dialect: 'postgresql', out: folder, migrations: { schema: 'pipong_migrations' }, dbCredentials: { url: connectionString } })}`,
    );
    await runCommand(process.execPath, [
      fileURLToPath(new URL('../node_modules/drizzle-kit/bin.cjs', import.meta.url)),
      'migrate',
      '--config',
      configPath,
    ]);
  } finally {
    await rm(configFolder, { recursive: true, force: true });
  }
}

async function runClient(role: 'api' | 'worker', body: string): Promise<string> {
  const clientPath = new URL('../src/index.ts', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import { sql } from ${JSON.stringify(new URL('../node_modules/drizzle-orm/index.js', import.meta.url).href)};
    const { useApiDb, useWorkerDb } = await import(${JSON.stringify(clientPath)});
    const runtime = await ${role === 'api' ? 'useApiDb' : 'useWorkerDb'}();
    try { ${body} } finally { if (!runtime.pool.ending) await runtime.close(); }
  `;
  const result = await runCommand(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, NODE_ENV: 'test' },
  });
  return result.stdout;
}

function roleUrl(role: string): string {
  const url = new URL(testUrl ?? 'postgres://postgres@localhost/postgres');
  url.pathname = `/${databaseName}`;
  url.username = role;
  url.password = '';
  return url.href;
}

describe.skipIf(!testUrl)('PostgreSQL lifecycle (dedicated disposable cluster)', () => {
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${databaseName}`);
    fixture = new Client({ connectionString: roleUrl('postgres') });
    await fixture.connect();
    const provision = await readFile(new URL('../provision.sql', import.meta.url), 'utf8');
    await fixture.query(provision.replaceAll(':"DBNAME"', `"${databaseName}"`));
    migrationUrl = roleUrl('pipong_migrator');
    apiUrl = roleUrl('pipong_api');
    workerUrl = roleUrl('pipong_worker');
    vi.stubEnv('API_DATABASE_URL', apiUrl);
    vi.stubEnv('WORKER_DATABASE_URL', workerUrl);
    vi.stubEnv('API_DATABASE_MAX_POOL', '2');
    vi.stubEnv('WORKER_DATABASE_MAX_POOL', '2');
  });

  afterAll(async () => {
    await fixture.end();
    await admin.query(`DROP DATABASE ${databaseName} WITH (FORCE)`);
    await admin.query('DROP ROLE pipong_api, pipong_worker, pipong_migrator');
    await admin.end();
    vi.unstubAllEnvs();
  });

  it('migrates a clean database and repeats without duplicate history', async () => {
    await runMigrations(migrationUrl, migrationsFolder);
    await runMigrations(migrationUrl, migrationsFolder);
    const result = await fixture.query<{ count: string }>(
      'SELECT count(*) FROM pipong_migrations.__drizzle_migrations',
    );
    expect(result.rows[0]?.count).toBe('1');
  });

  it('rolls back failed migrations without recording completion', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'pipong-migration-'));
    try {
      await mkdir(join(folder, '20261007000000_failure'));
      await writeFile(
        join(folder, '20261007000000_failure/migration.sql'),
        'CREATE TABLE app.rollback_probe (id integer);\n--> statement-breakpoint\nSELECT missing_column FROM app.rollback_probe;',
      );
      await expect(runMigrations(migrationUrl, folder)).rejects.toThrow();
      const result = await fixture.query<{ table_name: string | null }>(
        "SELECT to_regclass('app.rollback_probe')::text AS table_name",
      );
      expect(result.rows[0]?.table_name).toBeNull();
      const history = await fixture.query<{ count: string }>(
        'SELECT count(*) FROM pipong_migrations.__drizzle_migrations',
      );
      expect(history.rows[0]?.count).toBe('1');
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('enforces schema grants and forbids runtime DDL', async () => {
    const migration = new Client({ connectionString: migrationUrl });
    await migration.connect();
    try {
      await migration.query(
        'CREATE TABLE app.grant_probe (id integer); CREATE TABLE auth.grant_probe (id integer); CREATE TABLE pgboss.grant_probe (id integer)',
      );
    } finally {
      await migration.end();
    }
    await Promise.all(
      (['api', 'worker'] as const).map(async (role) => {
        await runClient(
          role,
          `
        await runtime.db.transaction(async (transaction) => {
          await transaction.execute(sql\`INSERT INTO app.grant_probe VALUES (1)\`);
          await transaction.execute(sql\`INSERT INTO pgboss.grant_probe VALUES (1)\`);
        });
        for (const schema of ['app','auth','pgboss','public']) {
          await assert.rejects(runtime.pool.query('CREATE TABLE ' + schema + '.forbidden (id integer)'), { code: '42501' });
        }
        await assert.rejects(runtime.pool.query('CREATE TEMP TABLE forbidden (id integer)'), { code: '42501' });
        await assert.rejects(runtime.pool.query('SELECT * FROM pipong_migrations.__drizzle_migrations'), { code: '42501' });
        ${role === 'api' ? "await runtime.pool.query('INSERT INTO auth.grant_probe VALUES (1)');" : "await assert.rejects(runtime.pool.query('SELECT * FROM auth.grant_probe'), { code: '42501' });"}
      `,
        );
      }),
    );
  });

  it('uses configured pool limits, timeouts, and application names and drains connections', async () => {
    vi.stubEnv('API_DATABASE_MAX_POOL', '1');
    vi.stubEnv('API_DATABASE_CONNECTION_TIMEOUT', '1250');
    vi.stubEnv('API_DATABASE_IDLE_TIMEOUT', '7500');
    vi.stubEnv('API_DATABASE_APPLICATION_NAME', 'pipong-pool-test');
    await runClient(
      'api',
      `
      assert.equal(runtime.pool.options.connectionTimeoutMillis, 1250);
      assert.equal(runtime.pool.options.idleTimeoutMillis, 7500);
      const identity = await runtime.pool.query('SHOW application_name');
      assert.equal(identity.rows[0].application_name, 'pipong-pool-test');
      const client = await runtime.pool.connect();
      const pending = runtime.pool.connect();
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(runtime.pool.totalCount, 1);
      assert.equal(runtime.pool.waitingCount, 1);
      client.release();
      const nextClient = await pending;
      const closing = runtime.close();
      nextClient.release();
      await closing;
      assert.equal(runtime.pool.totalCount, 0);
    `,
    );
    vi.stubEnv('API_DATABASE_MAX_POOL', '2');
  });

  it('logs queries through the selected client flag', async () => {
    vi.stubEnv('API_DATABASE_USE_QUERY_LOGGER', 'true');
    expect(await runClient('api', 'await runtime.db.execute(sql`SELECT 42`);')).toContain('42');
    vi.stubEnv('API_DATABASE_USE_QUERY_LOGGER', 'false');
    expect(await runClient('api', 'await runtime.db.execute(sql`SELECT 42`);')).toBe('');
  }, 15000);

  it('rejects privileged and mismatched identities without leaking connections', async () => {
    vi.stubEnv('API_DATABASE_URL', roleUrl('postgres'));
    await expect(runClient('api', '')).rejects.toThrow('DATABASE_STARTUP_FAILED');
    vi.stubEnv('API_DATABASE_URL', workerUrl);
    await expect(runClient('api', '')).rejects.toThrow('DATABASE_STARTUP_FAILED');
    vi.stubEnv('API_DATABASE_URL', apiUrl);
    await expect(runMigrations(apiUrl, migrationsFolder)).rejects.toThrow();
    const connections = await fixture.query<{ count: string }>(
      "SELECT count(*) FROM pg_stat_activity WHERE usename IN ('pipong_api','pipong_worker','pipong_migrator')",
    );
    expect(connections.rows[0]?.count).toBe('0');
  });
});
