import {
  generateUuid,
  generateTimestamps,
  generateTimestampsWithAudit,
} from '@pipong/database/helpers';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getTableConfig, pgSchema, text } from 'drizzle-orm/pg-core';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { validate, version } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { user } from '../src/auth/schema.ts';

const testUrl = process.env.TEST_DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../migrations/foundation/', import.meta.url));
const databaseName = `pipong_test_${process.pid}`;
const admin = new Client({ connectionString: testUrl });
let fixture: Client;
let migrationUrl: string;
let apiUrl: string;
let workerUrl: string;

const runCommand = promisify(execFile);
const helperSchema = pgSchema('app');
const helperRecords = helperSchema.table('helper_record', {
  id: generateUuid('record_id'),
  value: text('value').notNull(),
  ...generateTimestamps(),
});
const helperAuditRecords = helperSchema.table('helper_audit_record', {
  id: generateUuid(),
  ...generateTimestampsWithAudit(() => user.id),
});
const helperCascadeRecords = helperSchema.table('helper_cascade_record', {
  id: generateUuid(),
  ...generateTimestampsWithAudit(() => user.id, 'cascade'),
});
const helperUnboundRecords = helperSchema.table('helper_unbound_record', {
  id: generateUuid(),
  ...generateTimestampsWithAudit(),
});

it('declares audit foreign keys against auth users with the selected deletion actions', () => {
  const foreignKeys = getTableConfig(helperAuditRecords).foreignKeys;
  expect(foreignKeys.map((foreignKey) => foreignKey.onDelete)).toEqual([
    'restrict',
    'set null',
    'set null',
  ]);
  for (const foreignKey of foreignKeys) {
    expect(foreignKey.reference().foreignTable).toBe(user);
    expect(foreignKey.reference().foreignColumns).toEqual([user.id]);
  }
  expect(getTableConfig(helperCascadeRecords).foreignKeys[0]?.onDelete).toBe('cascade');
  expect(getTableConfig(helperUnboundRecords).foreignKeys).toEqual([]);
});

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
    if (folder === migrationsFolder) {
      await runMigrations(
        connectionString,
        fileURLToPath(new URL('../migrations/auth/', import.meta.url)),
      );
    }
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
    const { createAuthClient } = await import(${JSON.stringify(new URL('../src/auth/client.ts', import.meta.url).href)});
    const authDb = createAuthClient(runtime);
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
    expect(result.rows[0]?.count).toBe('5');
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
      expect(history.rows[0]?.count).toBe('5');
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
        await assert.rejects(runtime.pool.query("SELECT pgboss.create_queue('forbidden', '{}'::jsonb)"), { code: '42501' });
        await assert.rejects(runtime.pool.query("SELECT pgboss.delete_queue('auth-email')"), { code: '42501' });
        await assert.rejects(runtime.pool.query('SELECT * FROM pipong_migrations.__drizzle_migrations'), { code: '42501' });
        ${role === 'api' ? "await runtime.pool.query('INSERT INTO auth.grant_probe VALUES (1)');" : "await assert.rejects(runtime.pool.query('SELECT * FROM auth.grant_probe'), { code: '42501' });"}
      `,
        );
      }),
    );
    await runClient(
      'api',
      `
      await runtime.pool.query("INSERT INTO auth.enrollment_audit(id,action,user_id) VALUES ('019a0000-0000-7000-8000-000000000041','bootstrap','019a0000-0000-7000-8000-000000000042')");
      await assert.rejects(runtime.pool.query("UPDATE auth.enrollment_audit SET action='tampered'"), { code: '42501' });
      await assert.rejects(runtime.pool.query('DELETE FROM auth.enrollment_audit'), { code: '42501' });
    `,
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

  it('loads related sessions through the runtime client while enforcing worker permissions', async () => {
    const userId = '019a0000-0000-7000-8000-000000000021';
    await fixture.query('INSERT INTO auth."user" (id,name,email) VALUES ($1,$2,$3)', [
      userId,
      'Relations',
      'relations@example.com',
    ]);

    try {
      await fixture.query(
        'INSERT INTO auth.session (id,user_id,token,expires_at) VALUES ($1,$2,$3,now())',
        ['019a0000-0000-7000-8000-000000000022', userId, 'relation-session'],
      );
      await runClient(
        'api',
        `
        const record = await authDb.query.user.findFirst({
          where: { id: '${userId}' },
          with: { sessions: true },
        });
        assert.equal(record.id, '${userId}');
        assert.equal(record.sessions.length, 1);
        assert.equal(record.sessions[0].token, 'relation-session');
      `,
      );
      await runClient(
        'worker',
        `
        await assert.rejects(authDb.query.user.findFirst({ with: { sessions: true } }));
      `,
      );
    } finally {
      await fixture.query('DELETE FROM auth."user" WHERE id=$1', [userId]);
    }
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

  it('inserts UUIDv7 defaults, round-trips timestamps, and updates only the modification timestamp', async () => {
    const migration = new Client({ connectionString: migrationUrl });
    const api = new Client({ connectionString: apiUrl });
    await migration.connect();
    await api.connect();
    try {
      await migration.query(`CREATE TABLE app.helper_record (
        record_id uuid PRIMARY KEY, value text NOT NULL,
        created_at timestamptz(3) NOT NULL DEFAULT now(),
        updated_at timestamptz(3) NOT NULL DEFAULT now(), deleted_at timestamptz(3)
      )`);
      const db = drizzle({ client: api });
      const [inserted] = await db.insert(helperRecords).values({ value: 'original' }).returning();
      if (!inserted) throw new Error('TEST_HELPER_INSERT_MISSING');
      expect(validate(inserted.id)).toBe(true);
      expect(version(inserted.id)).toBe(7);
      expect(inserted.createdAt).toBeInstanceOf(Date);
      expect(inserted.updatedAt).toBeInstanceOf(Date);
      expect(inserted.deletedAt).toBeNull();
      await api.query(
        "UPDATE app.helper_record SET updated_at='2000-01-01T00:00:00Z' WHERE record_id=$1",
        [inserted.id],
      );
      const deletedAt = new Date('2026-10-06T10:11:12.123Z');
      const [updated] = await db
        .update(helperRecords)
        .set({ value: 'changed', deletedAt })
        .where(eq(helperRecords.id, inserted.id))
        .returning();
      expect(updated?.createdAt).toEqual(inserted.createdAt);
      expect(updated?.updatedAt.getTime()).toBeGreaterThan(
        new Date('2000-01-01T00:00:00Z').getTime(),
      );
      expect(updated?.deletedAt).toEqual(deletedAt);
      expect(updated?.value).toBe('changed');
      await expect(
        api.query("INSERT INTO app.helper_record(value) VALUES ('raw SQL without UUID')"),
      ).rejects.toMatchObject({ code: '23502' });
    } finally {
      await api.end();
      await migration.end();
    }
  });

  it('binds UUID audit actors with restrictive creation and nullable update/deletion references', async () => {
    const migration = new Client({ connectionString: migrationUrl });
    const api = new Client({ connectionString: apiUrl });
    await migration.connect();
    await api.connect();
    try {
      await migration.query(`
        CREATE TABLE app.helper_audit_record (
          id uuid PRIMARY KEY,
          created_by uuid NOT NULL REFERENCES auth."user"(id) ON DELETE RESTRICT,
          updated_by uuid REFERENCES auth."user"(id) ON DELETE SET NULL,
          deleted_by uuid REFERENCES auth."user"(id) ON DELETE SET NULL,
          created_at timestamptz(3) NOT NULL DEFAULT now(),
          updated_at timestamptz(3) NOT NULL DEFAULT now(), deleted_at timestamptz(3)
        );
        CREATE TABLE app.helper_cascade_record (
          id uuid PRIMARY KEY, created_by uuid NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
          updated_by uuid REFERENCES auth."user"(id) ON DELETE SET NULL,
          deleted_by uuid REFERENCES auth."user"(id) ON DELETE SET NULL,
          created_at timestamptz(3) NOT NULL DEFAULT now(),
          updated_at timestamptz(3) NOT NULL DEFAULT now(), deleted_at timestamptz(3)
        );
        CREATE TABLE app.helper_unbound_record (
          id uuid PRIMARY KEY, created_by uuid NOT NULL, updated_by uuid, deleted_by uuid,
          created_at timestamptz(3) NOT NULL DEFAULT now(),
          updated_at timestamptz(3) NOT NULL DEFAULT now(), deleted_at timestamptz(3)
        )
      `);
      const db = drizzle({ client: api });
      await db.insert(user).values([
        {
          id: '019a0000-0000-7000-8000-000000000001',
          name: 'Creator',
          email: 'creator@example.com',
        },
        { id: '019a0000-0000-7000-8000-000000000002', name: 'Editor', email: 'editor@example.com' },
        {
          id: '019a0000-0000-7000-8000-000000000003',
          name: 'Cascade',
          email: 'cascade@example.com',
        },
      ]);
      const [inserted] = await db
        .insert(helperAuditRecords)
        .values({
          createdBy: '019a0000-0000-7000-8000-000000000001',
          updatedBy: '019a0000-0000-7000-8000-000000000002',
          deletedBy: '019a0000-0000-7000-8000-000000000002',
        })
        .returning();
      if (!inserted) throw new Error('TEST_AUDIT_INSERT_MISSING');
      await expect(
        db.delete(user).where(eq(user.id, '019a0000-0000-7000-8000-000000000001')),
      ).rejects.toThrow();
      await db.delete(user).where(eq(user.id, '019a0000-0000-7000-8000-000000000002'));
      const [record] = await db
        .select()
        .from(helperAuditRecords)
        .where(eq(helperAuditRecords.id, inserted.id));
      expect(record?.createdBy).toBe('019a0000-0000-7000-8000-000000000001');
      expect(record?.updatedBy).toBeNull();
      expect(record?.deletedBy).toBeNull();
      await expect(
        db.insert(helperAuditRecords).values({ createdBy: '019a0000-0000-7000-8000-000000000004' }),
      ).rejects.toThrow();
      await db
        .insert(helperCascadeRecords)
        .values({ createdBy: '019a0000-0000-7000-8000-000000000003' });
      await db.delete(user).where(eq(user.id, '019a0000-0000-7000-8000-000000000003'));
      expect(await db.select().from(helperCascadeRecords)).toHaveLength(0);
      const [unbound] = await db
        .insert(helperUnboundRecords)
        .values({ createdBy: '019a0000-0000-7000-8000-000000000005' })
        .returning();
      expect(unbound?.createdBy).toBe('019a0000-0000-7000-8000-000000000005');
    } finally {
      await api.end();
      await migration.end();
    }
  });
});
