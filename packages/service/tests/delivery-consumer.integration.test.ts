import type { DatabaseRuntime } from '@pipong/database';
import type { DeliveryJob, QueueRuntime } from '@pipong/database/delivery-queue';
import type { DeliveryConsumer } from '../src/delivery-consumer.ts';
import { insertDeliveryJob, startDeliveryQueue } from '@pipong/database/delivery-queue';
import { withTenantTransaction } from '@pipong/database/tenancy';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { v7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDeliveryConsumer } from '../src/delivery-consumer.ts';
import { cancelNotification } from '../src/recovery.ts';

const testUrl = process.env.TEST_DELIVERY_DATABASE_URL;
const runCommand = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const databaseName = `pipong_consumers_${process.pid}`;
const organizationId = v7();
const projectId = v7();
const environmentId = v7();
const recipientId = v7();
const credentialId = v7();
const endpointId = v7();
const notificationId = v7();
const deliveryId = v7();
const scope = { kind: 'environment', organizationId, projectId, environmentId } as const;
const job: DeliveryJob = {
  organizationId,
  projectId,
  environmentId,
  notificationId,
  deliveryId,
  provider: 'apns',
};

describe.skipIf(!testUrl)('provider consumers in disposable PostgreSQL', () => {
  const admin = new Client({ connectionString: testUrl });
  let fixture: Client;
  let worker: DatabaseRuntime;
  let api: DatabaseRuntime;
  let apiQueue: QueueRuntime;
  let queue: QueueRuntime;
  let jobId: string;
  let directory: string;
  let keyringPath: string;
  function roleUrl(role: string): string {
    const url = new URL(testUrl ?? 'postgres://postgres@localhost/postgres');
    url.pathname = `/${databaseName}`;
    url.username = role;
    url.password = '';
    return url.href;
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipong-consumers-'));
    keyringPath = join(directory, 'keyring.json');
    await admin.connect();
    await admin.query(`CREATE DATABASE ${databaseName}`);
    fixture = new Client({ connectionString: roleUrl('postgres') });
    await fixture.connect();
    const provision = await readFile(
      new URL('../../database/provision.sql', import.meta.url),
      'utf8',
    );
    await fixture.query(provision.replaceAll(':"DBNAME"', `"${databaseName}"`));
    await runCommand('pnpm', ['migrate'], {
      cwd: root,
      env: { ...process.env, NODE_ENV: 'test', MIGRATION_DATABASE_URL: roleUrl('pipong_migrator') },
    });
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('WORKER_DATABASE_URL', roleUrl('pipong_worker'));
    vi.stubEnv('API_DATABASE_URL', roleUrl('pipong_api'));
    const { useWorkerDb, useApiDb } = await import('@pipong/database');
    worker = await useWorkerDb();
    queue = await startDeliveryQueue(worker, 'worker');
    api = await useApiDb();
    apiQueue = await startDeliveryQueue(api, 'producer');
  }, 30_000);

  async function seed(provider: DeliveryJob['provider'] = 'apns'): Promise<void> {
    await writeFile(
      keyringPath,
      JSON.stringify({ activeKeyId: 'test', keys: { test: '07'.repeat(32) } }),
      { mode: 0o600 },
    );
    await fixture.query(
      "TRUNCATE app.delivery_attempts, app.idempotency_records, app.notifications, app.deliveries, app.endpoint_generations, app.endpoints, app.credential_versions, app.recipients, app.environments, app.projects, app.delivery_events, app.event_streams, app.admission_reservations, app.key_budgets, app.tenant_budgets CASCADE; DELETE FROM pgboss.job WHERE name LIKE 'delivery-%'; DELETE FROM auth.organizations",
    );
    await fixture.query(
      "INSERT INTO auth.organizations (id,name,slug) VALUES ($1,'Attempts','attempts')",
      [organizationId],
    );
    await fixture.query(
      "INSERT INTO app.projects (id,organization_id,name) VALUES ($1,$2,'Project')",
      [projectId, organizationId],
    );
    await fixture.query(
      "INSERT INTO app.environments (id,organization_id,project_id,name) VALUES ($1,$2,$3,'Environment')",
      [environmentId, organizationId, projectId],
    );
    await fixture.query(
      "INSERT INTO app.recipients (id,organization_id,project_id,environment_id,external_id) VALUES ($1,$2,$3,$4,'recipient')",
      [recipientId, organizationId, projectId, environmentId],
    );
    await fixture.query(
      `INSERT INTO app.credential_versions (id,organization_id,project_id,environment_id,provider,app_id,encrypted_secret,state) VALUES ($1,$2,$3,$4,'${provider}','app','secret','active')`,
      [credentialId, organizationId, projectId, environmentId],
    );
    await fixture.query('BEGIN');
    await fixture.query(
      `INSERT INTO app.endpoints (id,organization_id,project_id,environment_id,recipient_id,installation_id,provider,app_id,generation,credential_id,target_hash) VALUES ($1,$2,$3,$4,$5,'installation','${provider}','app',1,$6,'hash')`,
      [endpointId, organizationId, projectId, environmentId, recipientId, credentialId],
    );
    await fixture.query(
      "INSERT INTO app.endpoint_generations (endpoint_id,generation,credential_id,encrypted_target,organization_id,project_id,environment_id,registered_at) VALUES ($1,1,$2,'target',$3,$4,$5,now())",
      [endpointId, credentialId, organizationId, projectId, environmentId],
    );
    await fixture.query('COMMIT');
    await fixture.query(
      "INSERT INTO app.notifications (id,organization_id,project_id,environment_id,request,expires_at,delivery_count) VALUES ($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',1)",
      [
        notificationId,
        organizationId,
        projectId,
        environmentId,
        JSON.stringify({
          targets: { kind: 'endpoints', ids: [endpointId] },
          content: { alert: { title: 'Recovery', body: 'Test' } },
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      ],
    );
    await fixture.query(
      `INSERT INTO app.deliveries (id,organization_id,project_id,environment_id,notification_id,endpoint_id,generation,credential_id,provider) VALUES ($1,$2,$3,$4,$5,$6,1,$7,'${provider}')`,
      [
        deliveryId,
        organizationId,
        projectId,
        environmentId,
        notificationId,
        endpointId,
        credentialId,
      ],
    );
    await fixture.query('INSERT INTO app.tenant_budgets (organization_id,pending) VALUES ($1,1);', [
      organizationId,
    ]);
    await fixture.query(
      'INSERT INTO app.admission_reservations (organization_id,id,endpoints,remaining) VALUES ($1,$2,1,1)',
      [organizationId, notificationId],
    );
    jobId = v7();
    await withTenantTransaction(worker, scope, (transaction) =>
      insertDeliveryJob(queue, transaction, jobId, { ...job, provider }),
    );
  }

  beforeEach(() => seed());

  afterAll(async () => {
    await queue?.stop({ graceful: true });
    await worker?.close();
    await apiQueue?.stop({ graceful: true });
    await api?.close();
    await fixture?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin.query('DROP ROLE IF EXISTS pipong_api, pipong_worker, pipong_migrator');
    await admin.end();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it('drains a committed send on abort without claiming another job', async () => {
    const controller = new AbortController();
    let sends = 0;
    await runDeliveryConsumer(
      worker,
      queue,
      {
        provider: 'apns',
        runtime: {
          async send(reservation, keyring) {
            sends += 1;
            expect(keyring.activeKeyId).toBe('test');
            expect((await fixture.query('SELECT state FROM app.deliveries')).rows).toEqual([
              { state: 'sending' },
            ]);
            expect(
              (await fixture.query('SELECT generation FROM app.delivery_attempts')).rows,
            ).toEqual([{ generation: reservation.fence.generation }]);
            controller.abort();
            return { outcome: { kind: 'accepted', code: 'TEST_ACCEPTED' }, response: null };
          },
          close() {},
        },
      },
      keyringPath,
      controller.signal,
    );
    expect(sends).toBe(1);
    expect((await fixture.query('SELECT state FROM app.deliveries')).rows).toEqual([
      { state: 'provider_accepted' },
    ]);
    expect((await fixture.query('SELECT state FROM pgboss.job WHERE id=$1', [jobId])).rows).toEqual(
      [{ state: 'completed' }],
    );
    expect((await fixture.query('SELECT pending FROM app.tenant_budgets')).rows).toEqual([
      { pending: 0 },
    ]);
  });

  it('records thrown sends as ambiguous application retries', async () => {
    const controller = new AbortController();
    await runDeliveryConsumer(
      worker,
      queue,
      {
        provider: 'apns',
        runtime: {
          send() {
            controller.abort();
            return Promise.reject(new Error('secret provider error must not escape'));
          },
          close() {},
        },
      },
      keyringPath,
      controller.signal,
    );
    expect((await fixture.query('SELECT state FROM app.deliveries')).rows).toEqual([
      { state: 'retry_wait' },
    ]);
    expect((await fixture.query('SELECT outcome,code FROM app.delivery_attempts')).rows).toEqual([
      { outcome: 'ambiguous', code: 'DELIVERY_SENDER_FAILED' },
    ]);
    expect((await fixture.query('SELECT state FROM pgboss.job ORDER BY created_on')).rows).toEqual([
      { state: 'completed' },
      { state: 'created' },
    ]);
    expect((await fixture.query('SELECT pending FROM app.tenant_budgets')).rows).toEqual([
      { pending: 1 },
    ]);
  });

  it('acknowledges canceled work without invoking a sender and stops idle polling', async () => {
    await withTenantTransaction(api, scope, (transaction) =>
      cancelNotification(transaction, scope, notificationId),
    );
    const controller = new AbortController();
    let sends = 0;
    const running = runDeliveryConsumer(
      worker,
      queue,
      {
        provider: 'apns',
        runtime: {
          send() {
            sends += 1;
            return Promise.reject(new Error('TEST_UNEXPECTED_SEND'));
          },
          close() {},
        },
      },
      keyringPath,
      controller.signal,
    );
    try {
      await vi.waitFor(async () => {
        expect(
          (await fixture.query('SELECT state FROM pgboss.job WHERE id=$1', [jobId])).rows,
        ).toEqual([{ state: 'completed' }]);
      });
    } finally {
      controller.abort();
      await running;
    }
    expect(sends).toBe(0);
    expect((await fixture.query('SELECT * FROM app.delivery_attempts')).rows).toHaveLength(0);
  });

  it('leaves runnable jobs unclaimed until the keyring is repaired', async () => {
    const controller = new AbortController();
    let sends = 0;
    const running = runDeliveryConsumer(
      worker,
      queue,
      {
        provider: 'apns',
        runtime: {
          send() {
            sends += 1;
            controller.abort();
            return Promise.resolve({
              outcome: { kind: 'accepted' as const, code: 'TEST_ACCEPTED' },
              response: null,
            });
          },
          close() {},
        },
      },
      join(directory, 'absent.json'),
      controller.signal,
    );
    try {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 100));
      expect(
        (await fixture.query('SELECT state FROM pgboss.job WHERE id=$1', [jobId])).rows,
      ).toEqual([{ state: 'created' }]);
      await writeFile(join(directory, 'absent.json'), await readFile(keyringPath), { mode: 0o600 });
      await vi.waitFor(
        async () => {
          expect((await fixture.query('SELECT state FROM app.deliveries')).rows).toEqual([
            { state: 'provider_accepted' },
          ]);
        },
        { timeout: 3000 },
      );
    } finally {
      controller.abort();
      await running;
    }
    expect(sends).toBe(1);
  });
  it.each(['fcm', 'web-push'] as const)(
    'settles %s through its provider-specific handler',
    async (provider) => {
      await seed(provider);
      const controller = new AbortController();
      let sends = 0;
      function send(): Promise<{ outcome: { kind: 'accepted'; code: string }; response: null }> {
        sends += 1;
        controller.abort();
        return Promise.resolve({
          outcome: { kind: 'accepted', code: 'TEST_ACCEPTED' },
          response: null,
        });
      }
      const consumer: DeliveryConsumer =
        provider === 'fcm'
          ? { provider, runtime: { send, close() {} } }
          : { provider, runtime: { send } };
      await runDeliveryConsumer(worker, queue, consumer, keyringPath, controller.signal);
      expect(sends).toBe(1);
      expect((await fixture.query('SELECT state FROM app.deliveries')).rows).toEqual([
        { state: 'provider_accepted' },
      ]);
    },
  );

  it('rolls back late settlement after the queue claim is lost', async () => {
    const controller = new AbortController();
    await runDeliveryConsumer(
      worker,
      queue,
      {
        provider: 'apns',
        runtime: {
          async send() {
            await fixture.query(
              "UPDATE pgboss.job SET state='retry', start_after=clock_timestamp() WHERE id=$1",
              [jobId],
            );
            controller.abort();
            return { outcome: { kind: 'accepted', code: 'TEST_LATE' }, response: null };
          },
          close() {},
        },
      },
      keyringPath,
      controller.signal,
    );
    expect((await fixture.query('SELECT state FROM app.deliveries')).rows).toEqual([
      { state: 'sending' },
    ]);
    expect(
      (await fixture.query('SELECT outcome,finished_at FROM app.delivery_attempts')).rows,
    ).toEqual([{ outcome: null, finished_at: null }]);
    expect((await fixture.query('SELECT state FROM pgboss.job WHERE id=$1', [jobId])).rows).toEqual(
      [{ state: 'retry' }],
    );
    expect((await fixture.query('SELECT pending FROM app.tenant_budgets')).rows).toEqual([
      { pending: 1 },
    ]);
  });
});
