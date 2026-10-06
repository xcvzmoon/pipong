import { sql } from 'drizzle-orm';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/index.ts';
import { runMigrations } from '../src/migrate.ts';

const testUrl = process.env.TEST_DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../migrations/', import.meta.url));
const databaseName = `pipong_test_${process.pid}`;
const admin = new Client({ connectionString: testUrl });
let fixture: Client;
let migrationUrl: string;
let apiUrl: string;
let workerUrl: string;

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
  });

  afterAll(async () => {
    await fixture.end();
    await admin.query(`DROP DATABASE ${databaseName} WITH (FORCE)`);
    await admin.query('DROP ROLE pipong_api, pipong_worker, pipong_migrator');
    await admin.end();
  });

  it('migrates a clean database and serializes repeats without duplicate history', async () => {
    await Promise.all([
      runMigrations(migrationUrl, migrationsFolder),
      runMigrations(migrationUrl, migrationsFolder),
    ]);
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
      await expect(runMigrations(migrationUrl, folder)).rejects.toThrow(
        'DATABASE_MIGRATION_FAILED',
      );
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
      (
        [
          [apiUrl, 'pipong_api'],
          [workerUrl, 'pipong_worker'],
        ] as const
      ).map(async ([url, role]) => {
        const runtime = await openDatabase(url, 2, role);
        try {
          await runtime.db.transaction(async (transaction) => {
            await transaction.execute(sql`INSERT INTO app.grant_probe VALUES (1)`);
            await transaction.execute(sql`INSERT INTO pgboss.grant_probe VALUES (1)`);
          });
          await Promise.all(
            ['app', 'auth', 'pgboss', 'public'].map(async (schema) => {
              await expect(
                runtime.pool.query(`CREATE TABLE ${schema}.forbidden (id integer)`),
              ).rejects.toMatchObject({ code: '42501' });
            }),
          );
          await expect(
            runtime.pool.query('CREATE TEMP TABLE forbidden (id integer)'),
          ).rejects.toMatchObject({ code: '42501' });
          if (role === 'pipong_api')
            await runtime.pool.query('INSERT INTO auth.grant_probe VALUES (1)');
          else
            await expect(
              runtime.pool.query('SELECT * FROM auth.grant_probe'),
            ).rejects.toMatchObject({
              code: '42501',
            });
          await expect(
            runtime.pool.query('SELECT * FROM pipong_migrations.__drizzle_migrations'),
          ).rejects.toMatchObject({ code: '42501' });
        } finally {
          await runtime.close();
        }
      }),
    );
  });

  it('bounds pools and drains checked-out connections before shutdown', async () => {
    const runtime = await openDatabase(apiUrl, 1, 'pipong_api');
    const client = await runtime.pool.connect();
    const pending = runtime.pool.connect();
    await setTimeout(20);
    expect(runtime.pool.totalCount).toBe(1);
    expect(runtime.pool.waitingCount).toBe(1);
    client.release();
    const nextClient = await pending;
    const closing = runtime.close();
    expect(runtime.pool.totalCount).toBe(1);
    nextClient.release();
    await closing;
    expect(runtime.pool.totalCount).toBe(0);
    await expect(runtime.pool.connect()).rejects.toThrow('Cannot use a pool after calling end');
  });

  it('rejects privileged or mismatched runtime identities and closes failed startup pools', async () => {
    await expect(openDatabase(roleUrl('postgres'), 1, 'pipong_api')).rejects.toThrow(
      'DATABASE_STARTUP_FAILED',
    );
    await expect(openDatabase(workerUrl, 1, 'pipong_api')).rejects.toThrow(
      'DATABASE_STARTUP_FAILED',
    );
    await expect(runMigrations(apiUrl, migrationsFolder)).rejects.toThrow(
      'DATABASE_MIGRATION_FAILED',
    );
    const connections = await fixture.query<{ count: string }>(
      "SELECT count(*) FROM pg_stat_activity WHERE datname = $1 AND usename IN ('pipong_api', 'pipong_worker', 'pipong_migrator')",
      [databaseName],
    );
    expect(connections.rows[0]?.count).toBe('0');
  });
});
