import {
  generateUuid,
  generateTimestamps,
  generateTimestampsWithAudit,
} from '@pipong/database/helpers';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getTableConfig, pgSchema, text } from 'drizzle-orm/pg-core';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { validate, version } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { users } from '../src/auth/schema.ts';

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
const helperRecords = helperSchema.table('helper_records', {
  id: generateUuid('record_id'),
  value: text('value').notNull(),
  ...generateTimestamps(),
});
const helperAuditRecords = helperSchema.table('helper_audit_records', {
  id: generateUuid(),
  ...generateTimestampsWithAudit(() => users.id),
});
const helperCascadeRecords = helperSchema.table('helper_cascade_records', {
  id: generateUuid(),
  ...generateTimestampsWithAudit(() => users.id, 'cascade'),
});
const helperUnboundRecords = helperSchema.table('helper_unbound_records', {
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
    expect(foreignKey.reference().foreignTable).toBe(users);
    expect(foreignKey.reference().foreignColumns).toEqual([users.id]);
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
      await runMigrations(
        connectionString,
        fileURLToPath(new URL('../migrations/tenancy/', import.meta.url)),
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
    const { withTenantTransaction } = await import(${JSON.stringify(new URL('../src/tenancy/index.ts', import.meta.url).href)});
    const { projects, environments } = await import(${JSON.stringify(new URL('../src/tenancy/schema.ts', import.meta.url).href)});
    const scopeA = { kind: 'organization', organizationId: '019a0000-0000-7000-8000-000000000101' };
    const scopeB = { kind: 'organization', organizationId: '019a0000-0000-7000-8000-000000000102' };
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
    expect(result.rows[0]?.count).toBe('26');
    const tables = await fixture.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='auth' ORDER BY table_name",
    );
    expect(tables.rows.map(({ table_name }) => table_name)).toEqual([
      'accounts',
      'api_keys',
      'enrollment_audits',
      'invitations',
      'members',
      'mfa_assurances',
      'organizations',
      'rate_limits',
      'service_key_audits',
      'service_key_grants',
      'sessions',
      'two_factors',
      'users',
      'verifications',
    ]);
  }, 15000);

  it('upgrades an earlier schema without losing existing tenant data', async () => {
    const upgradeDatabaseName = `${databaseName}_upgrade`;
    const upgradeUrl = new URL(migrationUrl);
    upgradeUrl.pathname = `/${upgradeDatabaseName}`;
    const directory = await mkdtemp(join(tmpdir(), 'pipong-upgrade-'));
    const upgrade = new Client({ connectionString: upgradeUrl.href });
    try {
      await admin.query(`CREATE DATABASE ${upgradeDatabaseName} OWNER pipong_migrator`);
      await upgrade.connect();
      const foundation = join(directory, 'foundation');
      await cp(migrationsFolder, foundation, { recursive: true });
      await runMigrations(upgradeUrl.href, foundation);
      await runMigrations(
        upgradeUrl.href,
        fileURLToPath(new URL('../migrations/auth/', import.meta.url)),
      );
      const tenancy = fileURLToPath(new URL('../migrations/tenancy/', import.meta.url));
      const baseline = join(directory, 'tenancy');
      await mkdir(baseline);
      await cp(
        join(tenancy, '20261007094502_overjoyed_nightmare'),
        join(baseline, '20261007094502_overjoyed_nightmare'),
        { recursive: true },
      );
      await runMigrations(upgradeUrl.href, baseline);
      await upgrade.query(`INSERT INTO auth.organizations (id, name, slug, created_at)
        VALUES ('019a0000-0000-7000-8000-000000000999', 'Upgrade tenant', 'upgrade-tenant', now())`);
      await runMigrations(upgradeUrl.href, tenancy);
      await runMigrations(upgradeUrl.href, tenancy);
      const organization = await upgrade.query<{ name: string }>(
        "SELECT name FROM auth.organizations WHERE slug='upgrade-tenant'",
      );
      expect(organization.rows).toEqual([{ name: 'Upgrade tenant' }]);
      const history = await upgrade.query<{ count: string }>(
        'SELECT count(*) FROM pipong_migrations.__drizzle_migrations',
      );
      expect(history.rows[0]?.count).toBe('26');
    } finally {
      await upgrade.end();
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${upgradeDatabaseName} WITH (FORCE)`);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }, 30_000);

  it('rejects incomplete delivery queue provisioning and cleans up startup', async () => {
    await fixture.query(
      "UPDATE pgboss.queue SET name='missing-delivery-fcm' WHERE name='delivery-fcm'",
    );
    try {
      await runClient(
        'api',
        `
        const { startDeliveryQueue } = await import(${JSON.stringify(new URL('../src/delivery-queue.ts', import.meta.url).href)});
        await assert.rejects(startDeliveryQueue(runtime, 'producer'), /DELIVERY_QUEUE_NOT_PROVISIONED/);
        const result = await runtime.pool.query('SELECT id FROM pgboss.instance WHERE stopped_on IS NULL');
        assert.equal(result.rows.length, 0);
      `,
      );
    } finally {
      await fixture.query(
        "UPDATE pgboss.queue SET name='delivery-fcm' WHERE name='missing-delivery-fcm'",
      );
    }
  });

  it('commits provider jobs atomically and rolls back writes on failure or suppressed enqueue', async () => {
    await fixture.query(
      'SET ROLE pipong_migrator; CREATE TABLE app.queue_probes (id uuid PRIMARY KEY); RESET ROLE',
    );
    await runClient(
      'api',
      `
      const { startDeliveryQueue } = await import(${JSON.stringify(new URL('../src/delivery-queue.ts', import.meta.url).href)});
      const { enqueueDelivery } = await import(${JSON.stringify(new URL('../../service/src/queue.ts', import.meta.url).href)});
      const queue = await startDeliveryQueue(runtime, 'producer');
      const job = {
        organizationId: scopeA.organizationId,
        projectId: '019a0000-0000-7000-8000-000000000111',
        environmentId: '019a0000-0000-7000-8000-000000000121',
        notificationId: '019a0000-0000-7000-8000-000000000301',
        deliveryId: '019a0000-0000-7000-8000-000000000302',
        provider: 'apns',
      };
      const id = '019a0000-0000-7000-8000-000000000303';
      try {
        await runtime.db.transaction(async (transaction) => {
          await transaction.execute(sql\`INSERT INTO app.queue_probes VALUES (\${id}::uuid)\`);
          assert.equal(await enqueueDelivery(queue, transaction, id, job), id);
          assert.equal((await runtime.pool.query('SELECT id FROM pgboss.job WHERE id=$1', [id])).rows.length, 0);
          assert.equal((await runtime.pool.query('SELECT id FROM app.queue_probes WHERE id=$1', [id])).rows.length, 0);
        });
        assert.equal((await runtime.pool.query('SELECT id FROM app.queue_probes WHERE id=$1', [id])).rows.length, 1);
        for (const provider of ['fcm', 'web-push']) {
          const jobId = provider === 'fcm' ? '019a0000-0000-7000-8000-000000000304' : '019a0000-0000-7000-8000-000000000305';
          await runtime.db.transaction((transaction) => enqueueDelivery(queue, transaction, jobId, { ...job, provider }));
        }
        await assert.rejects(runtime.db.transaction(async (transaction) => {
          await transaction.execute(sql\`INSERT INTO app.queue_probes VALUES ('019a0000-0000-7000-8000-000000000306')\`);
          await enqueueDelivery(queue, transaction, '019a0000-0000-7000-8000-000000000306', job);
          throw new Error('TEST_ROLLBACK');
        }), /TEST_ROLLBACK/);
        await assert.rejects(runtime.db.transaction(async (transaction) => {
          await transaction.execute(sql\`INSERT INTO app.queue_probes VALUES ('019a0000-0000-7000-8000-000000000307')\`);
          await enqueueDelivery(queue, transaction, id, job);
        }), /DELIVERY_ENQUEUE_FAILED/);
        await assert.rejects(runtime.db.transaction((transaction) => enqueueDelivery(queue, transaction, id, { ...job, secret: 'forbidden' })), /DELIVERY_JOB_INVALID/);
        await assert.rejects(runtime.db.transaction((transaction) => enqueueDelivery(queue, transaction, '019a0000-0000-4000-8000-000000000309', job)), /DELIVERY_JOB_INVALID/);
        assert.equal((await runtime.pool.query('SELECT id FROM app.queue_probes')).rows.length, 1);
        assert.equal((await runtime.pool.query("SELECT id FROM pgboss.job WHERE name LIKE 'delivery-%'")).rows.length, 3);
        const instances = await queue.getInstances();
        assert.equal(instances.find((instance) => instance.stoppedOn === null)?.supervise, false);
      } finally { await queue.stop({ graceful: true }); }
    `,
    );
  });

  it('fetches committed provider jobs and fences transactional completion to the current claim', async () => {
    await runClient(
      'worker',
      `
      const { startDeliveryQueue, completeDeliveryJob } = await import(${JSON.stringify(new URL('../src/delivery-queue.ts', import.meta.url).href)});
      const queue = await startDeliveryQueue(runtime, 'worker');
      try {
        for (const provider of ['apns', 'fcm', 'web-push']) {
          const [claim] = await queue.fetch('delivery-' + provider);
          assert.ok(claim);
          assert.equal(claim.data.provider, provider);
          assert.equal(claim.retryCount, 0);
          await assert.rejects(runtime.db.transaction(async (transaction) => {
            await transaction.execute(sql\`INSERT INTO app.queue_probes VALUES ('019a0000-0000-7000-8000-000000000308')\`);
            await completeDeliveryJob(queue, transaction, provider, { id: claim.id, retryCount: claim.retryCount + 1 });
          }), /DELIVERY_QUEUE_CLAIM_LOST/);
          assert.equal((await runtime.pool.query("SELECT id FROM app.queue_probes WHERE id='019a0000-0000-7000-8000-000000000308'")).rows.length, 0);
          await assert.rejects(runtime.db.transaction(async (transaction) => {
            await completeDeliveryJob(queue, transaction, provider, claim);
            throw new Error('TEST_ROLLBACK');
          }), /TEST_ROLLBACK/);
          assert.equal((await queue.findJobs('delivery-' + provider, { id: claim.id }))[0].state, 'active');
          await runtime.db.transaction((transaction) => completeDeliveryJob(queue, transaction, provider, claim));
          assert.equal((await queue.findJobs('delivery-' + provider, { id: claim.id }))[0].state, 'completed');
          await assert.rejects(runtime.db.transaction((transaction) => completeDeliveryJob(queue, transaction, provider, claim)), /DELIVERY_QUEUE_CLAIM_LOST/);
        }
      } finally { await queue.stop({ graceful: true }); }
      assert.equal(runtime.pool.waitingCount, 0);
    `,
    );
  });

  it('protects queued and exhausted provider jobs from retention and recovers expired claims', async () => {
    await runClient(
      'worker',
      `
      const { startDeliveryQueue, insertDeliveryJob, completeDeliveryJob } = await import(${JSON.stringify(new URL('../src/delivery-queue.ts', import.meta.url).href)});
      const queue = await startDeliveryQueue(runtime, 'worker');
      const id = '019a0000-0000-7000-8000-000000000310';
      const job = { organizationId: scopeA.organizationId, projectId: '019a0000-0000-7000-8000-000000000111', environmentId: '019a0000-0000-7000-8000-000000000121', notificationId: '019a0000-0000-7000-8000-000000000301', deliveryId: '019a0000-0000-7000-8000-000000000302', provider: 'apns' };
      try {
        const settings = await queue.getQueue('delivery-apns');
        assert.equal(settings.expireInSeconds, 120);
        assert.equal(settings.heartbeatSeconds, 30);
        assert.equal(settings.retryLimit, 5);
        assert.equal(settings.deleteAfterSeconds, 0);
        await runtime.db.transaction((transaction) => insertDeliveryJob(queue, transaction, id, job));
        await runtime.pool.query("UPDATE pgboss.job SET created_on=now()-interval '60 days', start_after=now()-interval '60 days' WHERE id=$1", [id]);
        assert.equal((await runtime.pool.query('SELECT keep_until::text FROM pgboss.job WHERE id=$1', [id])).rows[0].keep_until, 'infinity');
        await runtime.pool.query("UPDATE pgboss.queue SET monitor_on=NULL, monitor_claim_on=NULL, maintain_on=NULL WHERE name='delivery-apns'");
        await queue.supervise('delivery-apns');
        let [claim] = await queue.fetch('delivery-apns');
        assert.ok(claim);
        const originalClaim = claim;
        await runtime.pool.query("UPDATE pgboss.job SET started_on=now()-interval '1 hour', heartbeat_on=now()-interval '1 hour', retry_delay=0, retry_backoff=false WHERE id=$1", [id]);
        await runtime.pool.query("UPDATE pgboss.queue SET monitor_on=NULL, monitor_claim_on=NULL, maintain_on=NULL WHERE name='delivery-apns'");
        await queue.supervise('delivery-apns');
        [claim] = await queue.fetch('delivery-apns');
        assert.ok(claim);
        assert.equal(claim.retryCount, 1);
        await assert.rejects(runtime.db.transaction((transaction) => completeDeliveryJob(queue, transaction, 'apns', originalClaim)), /DELIVERY_QUEUE_CLAIM_LOST/);
        assert.equal((await queue.findJobs('delivery-apns', { id }))[0].state, 'active');
        await runtime.pool.query("UPDATE pgboss.job SET started_on=now()-interval '1 hour', heartbeat_on=now()-interval '1 hour', retry_limit=retry_count WHERE id=$1", [id]);
        await runtime.pool.query("UPDATE pgboss.queue SET monitor_on=NULL, monitor_claim_on=NULL, maintain_on=NULL WHERE name='delivery-apns'");
        await queue.supervise('delivery-apns');
        assert.equal((await queue.findJobs('delivery-apns', { id }))[0].state, 'failed');
        await runtime.pool.query("UPDATE pgboss.job SET completed_on=now()-interval '60 days' WHERE id=$1", [id]);
        await runtime.pool.query("UPDATE pgboss.queue SET monitor_on=NULL, monitor_claim_on=NULL, maintain_on=NULL WHERE name='delivery-apns'");
        await queue.supervise('delivery-apns');
        assert.equal((await queue.findJobs('delivery-apns', { id }))[0].state, 'failed');
      } finally { await queue.stop({ graceful: true }); }
    `,
    );
  });

  it('enforces FORCE RLS and fails closed without tenant context for both runtime roles', async () => {
    await fixture.query(`INSERT INTO auth.organizations(id,name,slug) VALUES
      ('019a0000-0000-7000-8000-000000000101','Tenant A','tenant-a'),
      ('019a0000-0000-7000-8000-000000000102','Tenant B','tenant-b')`);
    await fixture.query(`INSERT INTO app.projects(id,organization_id,name) VALUES
      ('019a0000-0000-7000-8000-000000000111','019a0000-0000-7000-8000-000000000101','Project A'),
      ('019a0000-0000-7000-8000-000000000112','019a0000-0000-7000-8000-000000000102','Project B'),
      ('019a0000-0000-7000-8000-000000000113','019a0000-0000-7000-8000-000000000101','Sibling A')`);
    await fixture.query(`INSERT INTO app.environments(id,organization_id,project_id,name) VALUES
      ('019a0000-0000-7000-8000-000000000121','019a0000-0000-7000-8000-000000000101','019a0000-0000-7000-8000-000000000111','Production'),
      ('019a0000-0000-7000-8000-000000000122','019a0000-0000-7000-8000-000000000101','019a0000-0000-7000-8000-000000000111','Development')`);
    const policies = await fixture.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid IN ('app.projects'::regclass,'app.environments'::regclass)",
    );
    expect(policies.rows).toEqual([
      { relrowsecurity: true, relforcerowsecurity: true },
      { relrowsecurity: true, relforcerowsecurity: true },
    ]);

    await Promise.all(
      (['api', 'worker'] as const).map(async (role) => {
        await runClient(
          role,
          `
        assert.deepEqual(await runtime.db.select().from(projects), []);
        assert.deepEqual(await runtime.db.select().from(environments), []);
        await assert.rejects(runtime.pool.query(
          "INSERT INTO app.projects(id,organization_id,name) VALUES ('019a0000-0000-7000-8000-000000000141','019a0000-0000-7000-8000-000000000101','Denied')"
        ), { code: '42501' });
        assert.throws(() => withTenantTransaction(runtime, { kind: 'organization', organizationId: 'invalid' }, async () => {}), /TENANT_SCOPE_INVALID/);
        assert.throws(() => withTenantTransaction(runtime, { kind: 'environment', organizationId: scopeA.organizationId, environmentId: '019a0000-0000-7000-8000-000000000121' }, async () => {}), /TENANT_SCOPE_INVALID/);
        assert.deepEqual(await runtime.db.select().from(projects), []);
      `,
        );
      }),
    );
  });

  it('restricts reads, updates, and deletes to the selected ownership scope', async () => {
    await Promise.all(
      (['api', 'worker'] as const).map(async (role) => {
        await runClient(
          role,
          `
        await withTenantTransaction(runtime, scopeA, async (transaction) => {
          const records = await transaction.select().from(projects);
          assert.equal(records.length, 2);
          assert.ok(records.every((record) => record.organizationId === scopeA.organizationId));
          assert.deepEqual(await transaction.execute(sql\`UPDATE app.projects SET name='Denied' WHERE organization_id=\${scopeB.organizationId}::uuid RETURNING id\`).then((result) => result.rows), []);
          assert.deepEqual(await transaction.execute(sql\`DELETE FROM app.projects WHERE organization_id=\${scopeB.organizationId}::uuid RETURNING id\`).then((result) => result.rows), []);
        });
        await withTenantTransaction(runtime, { kind: 'project', organizationId: scopeA.organizationId, projectId: '019a0000-0000-7000-8000-000000000111' }, async (transaction) => {
          assert.equal((await transaction.select().from(projects)).length, 1);
          assert.equal((await transaction.select().from(environments)).length, 2);
        });
        await withTenantTransaction(runtime, { kind: 'environment', organizationId: scopeA.organizationId, projectId: '019a0000-0000-7000-8000-000000000111', environmentId: '019a0000-0000-7000-8000-000000000121' }, async (transaction) => {
          const records = await transaction.select().from(environments);
          assert.equal(records.length, 1);
          assert.equal(records[0].name, 'Production');
        });
        await withTenantTransaction(runtime, { kind: 'project', organizationId: scopeA.organizationId, projectId: '019a0000-0000-7000-8000-000000000112' }, async (transaction) => {
          assert.deepEqual(await transaction.select().from(projects), []);
          assert.deepEqual(await transaction.select().from(environments), []);
        });
      `,
        );
      }),
    );
  });

  it('rejects cross-scope inserts and ownership changes', async () => {
    await Promise.all(
      (['api', 'worker'] as const).map(async (role) => {
        await runClient(
          role,
          `
        await assert.rejects(withTenantTransaction(runtime, scopeA, async (transaction) => {
          await transaction.insert(projects).values({ organizationId: scopeB.organizationId, name: 'Denied' });
        }), (error) => error.cause?.code === '42501');
        await assert.rejects(withTenantTransaction(runtime, scopeA, async (transaction) => {
          await transaction.execute(sql\`UPDATE app.projects SET organization_id=\${scopeB.organizationId}::uuid WHERE id='019a0000-0000-7000-8000-000000000113'\`);
        }), (error) => error.cause?.code === '42501');
        await assert.rejects(withTenantTransaction(runtime, { kind: 'environment', organizationId: scopeA.organizationId, projectId: '019a0000-0000-7000-8000-000000000111', environmentId: '019a0000-0000-7000-8000-000000000121' }, async (transaction) => {
          await transaction.execute(sql\`UPDATE app.environments SET id='019a0000-0000-7000-8000-000000000123'\`);
        }), (error) => error.cause?.code === '42501');
      `,
        );
      }),
    );
  });

  it('rejects nested ownership mismatches through composite foreign keys', async () => {
    await Promise.all(
      (['api', 'worker'] as const).map(async (role) => {
        await runClient(
          role,
          `
        await assert.rejects(withTenantTransaction(runtime, scopeA, async (transaction) => {
          await transaction.insert(environments).values({ organizationId: scopeA.organizationId, projectId: '019a0000-0000-7000-8000-000000000112', name: 'Denied' });
        }), (error) => error.cause?.code === '23503');
      `,
        );
      }),
    );
  });

  it('resets pooled context after commits and rollbacks and isolates concurrent transactions', async () => {
    vi.stubEnv('API_DATABASE_MAX_POOL', '1');
    vi.stubEnv('WORKER_DATABASE_MAX_POOL', '1');
    try {
      // oxlint-disable eslint/no-await-in-loop -- Both roles mutate the same tenant; finish cleanup before the next role starts.
      for (const role of ['api', 'worker'] as const) {
        await runClient(
          role,
          `
          for (const scope of [scopeA, scopeB, scopeA, scopeB]) {
            await withTenantTransaction(runtime, scope, async (transaction) => {
              const records = await transaction.select().from(projects);
              assert.ok(records.length > 0);
              assert.ok(records.every((record) => record.organizationId === scope.organizationId));
            });
            assert.deepEqual(await runtime.db.select().from(projects), []);
          }
          const committedId = await withTenantTransaction(runtime, scopeA, async (transaction) => {
            const [record] = await transaction.insert(projects).values({ organizationId: scopeA.organizationId, name: 'Committed' }).returning();
            return record.id;
          });
          assert.deepEqual(await runtime.db.select().from(projects), []);
          await withTenantTransaction(runtime, scopeA, async (transaction) => {
            const records = await transaction.execute(sql\`DELETE FROM app.projects WHERE id=\${committedId}::uuid RETURNING id\`);
            assert.equal(records.rows.length, 1);
          });
          await assert.rejects(withTenantTransaction(runtime, scopeA, async (transaction) => {
            await transaction.insert(projects).values({ organizationId: scopeA.organizationId, name: 'Rolled back' });
            throw new Error('TEST_ROLLBACK');
          }), /TEST_ROLLBACK/);
          assert.deepEqual(await runtime.db.select().from(projects), []);
          await withTenantTransaction(runtime, scopeA, async (transaction) => {
            assert.equal((await transaction.select().from(projects)).length, 2);
          });
          assert.deepEqual(await runtime.db.select().from(projects), []);
        `,
        );
      }
      // oxlint-enable eslint/no-await-in-loop
    } finally {
      vi.stubEnv('API_DATABASE_MAX_POOL', '2');
      vi.stubEnv('WORKER_DATABASE_MAX_POOL', '2');
    }

    await Promise.all(
      (['api', 'worker'] as const).map(async (role) => {
        await runClient(
          role,
          `
        await Promise.all([scopeA, scopeB].map((scope) => withTenantTransaction(runtime, scope, async (transaction) => {
          await transaction.execute(sql\`SELECT pg_sleep(0.02)\`);
          const records = await transaction.select().from(projects);
          assert.ok(records.length > 0);
          assert.ok(records.every((record) => record.organizationId === scope.organizationId));
        })));
        assert.deepEqual(await runtime.db.select().from(projects), []);
      `,
        );
      }),
    );
  });

  it('rolls back failed migrations without recording completion', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'pipong-migration-'));
    try {
      await mkdir(join(folder, '20261008000000_failure'));
      await writeFile(
        join(folder, '20261008000000_failure/migration.sql'),
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
      expect(history.rows[0]?.count).toBe('26');
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
      await runtime.pool.query("INSERT INTO auth.enrollment_audits(id,action,user_id) VALUES ('019a0000-0000-7000-8000-000000000041','bootstrap','019a0000-0000-7000-8000-000000000042')");
      await assert.rejects(runtime.pool.query("UPDATE auth.enrollment_audits SET action='tampered'"), { code: '42501' });
      await assert.rejects(runtime.pool.query('DELETE FROM auth.enrollment_audits'), { code: '42501' });
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
    await fixture.query('INSERT INTO auth."users" (id,name,email) VALUES ($1,$2,$3)', [
      userId,
      'Relations',
      'relations@example.com',
    ]);

    try {
      await fixture.query(
        'INSERT INTO auth.sessions (id,user_id,token,expires_at) VALUES ($1,$2,$3,now())',
        ['019a0000-0000-7000-8000-000000000022', userId, 'relation-session'],
      );
      await runClient(
        'api',
        `
        const record = await authDb.query.users.findFirst({
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
        await assert.rejects(authDb.query.users.findFirst({ with: { sessions: true } }));
      `,
      );
    } finally {
      await fixture.query('DELETE FROM auth."users" WHERE id=$1', [userId]);
    }
  });

  it('logs query activity without SQL or parameter values', async () => {
    vi.stubEnv('API_DATABASE_USE_QUERY_LOGGER', 'true');
    const output = await runClient(
      'api',
      'await runtime.db.execute(sql`SELECT ${"secret-query-value"}::text`);',
    );
    expect(output).toContain('database_query');
    expect(output).not.toContain('secret-query-value');
    expect(output).not.toContain('SELECT');
    vi.stubEnv('API_DATABASE_USE_QUERY_LOGGER', 'false');
    expect(await runClient('api', 'await runtime.db.execute(sql`SELECT 42`);')).toBe('');
  }, 15000);

  it('persists MFA assurance and audit together, with a strict freshness cutoff', async () => {
    const userId = '019a0000-0000-7000-8000-000000000031';
    const sessionId = '019a0000-0000-7000-8000-000000000032';
    await fixture.query('INSERT INTO auth."users" (id,name,email) VALUES ($1,$2,$3)', [
      userId,
      'Assurance',
      'assurance@example.com',
    ]);
    try {
      await fixture.query(
        'INSERT INTO auth.sessions (id,user_id,token,expires_at) VALUES ($1,$2,$3,now())',
        [sessionId, userId, 'assurance-session'],
      );
      await runClient(
        'api',
        `
        const { hasMfaAssurance, recordAuthActivity } = await import(${JSON.stringify(new URL('../src/auth/index.ts', import.meta.url).href)});
        const verifiedAt = new Date('2026-10-07T10:00:00.000Z');
        const cutoff = new Date(verifiedAt.getTime() - 1);
        assert.equal(await hasMfaAssurance(authDb, '${sessionId}', cutoff), false);
        await assert.rejects(recordAuthActivity(
          authDb,
          { sessionId: '${sessionId}', verifiedAt },
          { action: 'failed-audit', userId: 'invalid-uuid', sessionId: '${sessionId}' },
        ));
        assert.equal(await hasMfaAssurance(authDb, '${sessionId}', cutoff), false);
        await recordAuthActivity(
          authDb,
          { sessionId: '${sessionId}', verifiedAt },
          { action: 'backup-code-recovery', userId: '${userId}', sessionId: '${sessionId}' },
        );
        assert.equal(await hasMfaAssurance(authDb, '${sessionId}', cutoff), true);
        assert.equal(await hasMfaAssurance(authDb, '${sessionId}', verifiedAt), false);
        await recordAuthActivity(authDb, { sessionId: '${sessionId}', verifiedAt: cutoff }, undefined);
        assert.equal(await hasMfaAssurance(authDb, '${sessionId}', cutoff), false);
        const audit = await runtime.pool.query('SELECT action FROM auth.enrollment_audits WHERE user_id=$1', ['${userId}']);
        assert.deepEqual(audit.rows, [{ action: 'backup-code-recovery' }]);
      `,
      );
    } finally {
      await fixture.query('DELETE FROM auth."users" WHERE id=$1', [userId]);
    }
    const assurance = await fixture.query(
      'SELECT session_id FROM auth.mfa_assurances WHERE session_id=$1',
      [sessionId],
    );
    expect(assurance.rows).toEqual([]);
  });

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
      await migration.query(`CREATE TABLE app.helper_records (
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
        "UPDATE app.helper_records SET updated_at='2000-01-01T00:00:00Z' WHERE record_id=$1",
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
        api.query("INSERT INTO app.helper_records(value) VALUES ('raw SQL without UUID')"),
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
        CREATE TABLE app.helper_audit_records (
          id uuid PRIMARY KEY,
          created_by uuid NOT NULL REFERENCES auth."users"(id) ON DELETE RESTRICT,
          updated_by uuid REFERENCES auth."users"(id) ON DELETE SET NULL,
          deleted_by uuid REFERENCES auth."users"(id) ON DELETE SET NULL,
          created_at timestamptz(3) NOT NULL DEFAULT now(),
          updated_at timestamptz(3) NOT NULL DEFAULT now(), deleted_at timestamptz(3)
        );
        CREATE TABLE app.helper_cascade_records (
          id uuid PRIMARY KEY, created_by uuid NOT NULL REFERENCES auth."users"(id) ON DELETE CASCADE,
          updated_by uuid REFERENCES auth."users"(id) ON DELETE SET NULL,
          deleted_by uuid REFERENCES auth."users"(id) ON DELETE SET NULL,
          created_at timestamptz(3) NOT NULL DEFAULT now(),
          updated_at timestamptz(3) NOT NULL DEFAULT now(), deleted_at timestamptz(3)
        );
        CREATE TABLE app.helper_unbound_records (
          id uuid PRIMARY KEY, created_by uuid NOT NULL, updated_by uuid, deleted_by uuid,
          created_at timestamptz(3) NOT NULL DEFAULT now(),
          updated_at timestamptz(3) NOT NULL DEFAULT now(), deleted_at timestamptz(3)
        )
      `);
      const db = drizzle({ client: api });
      await db.insert(users).values([
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
        db.delete(users).where(eq(users.id, '019a0000-0000-7000-8000-000000000001')),
      ).rejects.toThrow();
      await db.delete(users).where(eq(users.id, '019a0000-0000-7000-8000-000000000002'));
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
      await db.delete(users).where(eq(users.id, '019a0000-0000-7000-8000-000000000003'));
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
