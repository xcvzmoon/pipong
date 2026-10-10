import type { DatabaseRuntime } from '@pipong/database';
import type { DeliveryJob, QueueRuntime } from '@pipong/database/delivery-queue';
import {
  fetchDeliveryJobs,
  insertDeliveryJob,
  startDeliveryQueue,
} from '@pipong/database/delivery-queue';
import { withTenantTransaction } from '@pipong/database/tenancy';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { v7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { reserveDelivery, settleDelivery } from '../src/delivery.ts';
import { cancelNotification, redriveDelivery, reconcileDeliveryRecovery } from '../src/recovery.ts';

const testUrl = process.env.TEST_DELIVERY_DATABASE_URL;
const runCommand = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const databaseName = `pipong_recovery_${process.pid}`;
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

describe.skipIf(!testUrl)('delivery recovery in disposable PostgreSQL', () => {
  const admin = new Client({ connectionString: testUrl });
  let fixture: Client;
  let worker: DatabaseRuntime;
  let api: DatabaseRuntime;
  let apiQueue: QueueRuntime;
  let queue: QueueRuntime;
  let jobId: string;
  function roleUrl(role: string): string {
    const url = new URL(testUrl ?? 'postgres://postgres@localhost/postgres');
    url.pathname = `/${databaseName}`;
    url.username = role;
    url.password = '';
    return url.href;
  }

  async function claim(
    runtime = worker,
    handle = queue,
  ): Promise<{ id: string; retryCount: number }> {
    const [claimed] = await fetchDeliveryJobs(runtime, handle, 'apns');
    if (!claimed) {
      throw new Error('TEST_CLAIM_MISSING');
    }
    return { id: claimed.id, retryCount: claimed.retryCount };
  }

  beforeAll(async () => {
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

  beforeEach(async () => {
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
      "INSERT INTO app.credential_versions (id,organization_id,project_id,environment_id,provider,app_id,encrypted_secret,state) VALUES ($1,$2,$3,$4,'apns','app','secret','active')",
      [credentialId, organizationId, projectId, environmentId],
    );
    await fixture.query('BEGIN');
    await fixture.query(
      "INSERT INTO app.endpoints (id,organization_id,project_id,environment_id,recipient_id,installation_id,provider,app_id,generation,credential_id,target_hash) VALUES ($1,$2,$3,$4,$5,'installation','apns','app',1,$6,'hash')",
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
      "INSERT INTO app.deliveries (id,organization_id,project_id,environment_id,notification_id,endpoint_id,generation,credential_id,provider) VALUES ($1,$2,$3,$4,$5,$6,1,$7,'apns')",
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
      insertDeliveryJob(queue, transaction, jobId, job),
    );
  });

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
  });

  it('cancels queued work once and releases admission without a send', async () => {
    const result = await withTenantTransaction(api, scope, (transaction) =>
      cancelNotification(transaction, scope, notificationId),
    );
    expect(result).toEqual({ ok: true, value: { notificationId, canceledCount: 1 } });
    expect((await fixture.query('SELECT state FROM app.deliveries')).rows).toEqual([
      { state: 'canceled' },
    ]);
    expect((await fixture.query('SELECT pending FROM app.tenant_budgets')).rows).toEqual([
      { pending: 0 },
    ]);
    const reserved = await reserveDelivery(worker, queue, job, await claim());
    expect(reserved.status).not.toBe('send');
    expect((await fixture.query('SELECT * FROM app.delivery_attempts')).rows).toHaveLength(0);
    await withTenantTransaction(api, scope, (transaction) =>
      cancelNotification(transaction, scope, notificationId),
    );
    expect((await fixture.query('SELECT pending FROM app.tenant_budgets')).rows).toEqual([
      { pending: 0 },
    ]);
  });

  it('retains committed send-start and cancels a transient result without a successor', async () => {
    const reserved = await reserveDelivery(worker, queue, job, await claim());
    if (reserved.status !== 'send') {
      throw new Error('TEST_RESERVATION_MISSING');
    }
    expect(
      await withTenantTransaction(api, scope, (transaction) =>
        cancelNotification(transaction, scope, notificationId),
      ),
    ).toEqual({ ok: true, value: { notificationId, canceledCount: 0 } });
    expect((await fixture.query('SELECT state FROM app.deliveries')).rows).toEqual([
      { state: 'sending' },
    ]);
    expect(
      await settleDelivery(worker, queue, reserved.fence, {
        kind: 'transient',
        code: 'TEST_RETRY',
        retryAt: new Date(Date.now() + 60_000),
        successorId: v7(),
      }),
    ).toBe('canceled');
    expect((await fixture.query('SELECT id FROM pgboss.job')).rows).toHaveLength(1);
    expect((await fixture.query('SELECT pending FROM app.tenant_budgets')).rows).toEqual([
      { pending: 0 },
    ]);
  });

  it('redrives terminal work with new identities and a single immutable audit link', async () => {
    const reserved = await reserveDelivery(worker, queue, job, await claim());
    if (reserved.status !== 'send') {
      throw new Error('TEST_RESERVATION_MISSING');
    }
    await settleDelivery(worker, queue, reserved.fence, { kind: 'permanent', code: 'TEST_FAILED' });
    const expiresAt = new Date(Date.now() + 3_600_000);
    const result = await withTenantTransaction(api, scope, (transaction) =>
      redriveDelivery(
        transaction,
        apiQueue,
        scope,
        deliveryId,
        expiresAt,
        'operator',
        'Retry after credential repair',
      ),
    );
    if (!result.ok) {
      throw new Error('TEST_REDRIVE_FAILED');
    }
    expect(result.value.sourceDeliveryId).toBe(deliveryId);
    expect(result.value.deliveryId).not.toBe(deliveryId);
    expect(result.value.notificationId).not.toBe(notificationId);
    expect(
      (await fixture.query('SELECT state FROM app.deliveries WHERE id=$1', [deliveryId])).rows,
    ).toEqual([{ state: 'failed' }]);
    expect(
      (
        await fixture.query(
          'SELECT source_delivery_id,delivery_id,actor_id,reason FROM app.delivery_redrives',
        )
      ).rows,
    ).toEqual([
      {
        source_delivery_id: deliveryId,
        delivery_id: result.value.deliveryId,
        actor_id: 'operator',
        reason: 'Retry after credential repair',
      },
    ]);
    const duplicate = await withTenantTransaction(api, scope, (transaction) =>
      redriveDelivery(
        transaction,
        apiQueue,
        scope,
        deliveryId,
        expiresAt,
        'operator',
        'Second retry',
      ),
    );
    expect(duplicate).toMatchObject({ ok: false, code: 'DELIVERY_ALREADY_REDRIVEN' });
    expect(
      (await fixture.query('SELECT delivery_id FROM app.delivery_attempts')).rows,
    ).toHaveLength(1);
    expect((await fixture.query('SELECT id FROM app.deliveries')).rows).toHaveLength(2);
    expect((await fixture.query('SELECT pending FROM app.tenant_budgets')).rows).toEqual([
      { pending: 1 },
    ]);
  });

  it('reconciles exhausted crash work once without a successor send', async () => {
    const reserved = await reserveDelivery(worker, queue, job, await claim());
    if (reserved.status !== 'send') {
      throw new Error('TEST_RESERVATION_MISSING');
    }
    await fixture.query(
      "UPDATE pgboss.job SET state='failed',completed_on=clock_timestamp() WHERE id=$1",
      [jobId],
    );
    expect(await reconcileDeliveryRecovery(worker)).toBe(1);
    expect(await reconcileDeliveryRecovery(worker)).toBe(0);
    expect((await fixture.query('SELECT state FROM app.deliveries')).rows).toEqual([
      { state: 'failed' },
    ]);
    expect((await fixture.query('SELECT outcome,code FROM app.delivery_attempts')).rows).toEqual([
      { outcome: 'ambiguous', code: 'DELIVERY_RECOVERY_EXHAUSTED' },
    ]);
    expect((await fixture.query('SELECT pending FROM app.tenant_budgets')).rows).toEqual([
      { pending: 0 },
    ]);
    expect((await fixture.query('SELECT id FROM pgboss.job')).rows).toHaveLength(1);
    expect(
      (
        await fixture.query('SELECT delivery_id FROM app.delivery_events WHERE delivery_id=$1', [
          deliveryId,
        ])
      ).rows,
    ).toHaveLength(2);
  });
  it('counts crash recovery generations toward the eight-send cap', async () => {
    await fixture.query('UPDATE app.deliveries SET attempt_generation=7 WHERE id=$1', [deliveryId]);
    const reserved = await reserveDelivery(worker, queue, job, await claim());
    if (reserved.status !== 'send') {
      throw new Error('TEST_RESERVATION_MISSING');
    }
    expect(reserved.fence.generation).toBe(8);
    expect(
      await settleDelivery(worker, queue, reserved.fence, {
        kind: 'transient',
        code: 'TEST_RETRY',
        retryAt: new Date(Date.now() + 60_000),
        successorId: v7(),
      }),
    ).toBe('failed');
    expect((await fixture.query('SELECT id FROM pgboss.job')).rows).toHaveLength(1);
    expect((await fixture.query('SELECT pending FROM app.tenant_budgets')).rows).toEqual([
      { pending: 0 },
    ]);
  });

  it('never reserves a ninth send after infrastructure recovery', async () => {
    await fixture.query('UPDATE app.deliveries SET attempt_generation=7 WHERE id=$1', [deliveryId]);
    const reserved = await reserveDelivery(worker, queue, job, await claim());
    if (reserved.status !== 'send') {
      throw new Error('TEST_RESERVATION_MISSING');
    }
    expect(reserved.fence.generation).toBe(8);
    await fixture.query(
      "UPDATE pgboss.job SET state='retry',start_after=clock_timestamp() WHERE id=$1",
      [jobId],
    );
    expect(await reserveDelivery(worker, queue, job, await claim())).toEqual({
      status: 'completed',
      state: 'failed',
    });
    expect(
      (
        await fixture.query(
          'SELECT outcome,code,finished_at IS NOT NULL AS finished FROM app.delivery_attempts',
        )
      ).rows,
    ).toEqual([{ outcome: 'ambiguous', code: 'DELIVERY_RECOVERY_TERMINAL', finished: true }]);
    expect((await fixture.query('SELECT pending FROM app.tenant_budgets')).rows).toEqual([
      { pending: 0 },
    ]);
  });
  it('rejects nonterminal, inactive, and invalid-expiry redrives without admitting new work', async () => {
    const expiresAt = new Date(Date.now() + 3_600_000);
    expect(
      await withTenantTransaction(api, scope, (transaction) =>
        redriveDelivery(transaction, apiQueue, scope, deliveryId, expiresAt, 'operator', 'Retry'),
      ),
    ).toMatchObject({ ok: false, code: 'DELIVERY_REDRIVE_NOT_TERMINAL' });
    await withTenantTransaction(api, scope, (transaction) =>
      cancelNotification(transaction, scope, notificationId),
    );
    expect(
      await withTenantTransaction(api, scope, (transaction) =>
        redriveDelivery(transaction, apiQueue, scope, deliveryId, new Date(0), 'operator', 'Retry'),
      ),
    ).toMatchObject({ ok: false, code: 'DELIVERY_REDRIVE_EXPIRY_INVALID' });
    await fixture.query(
      "UPDATE app.endpoints SET state='disabled',disabled_at=clock_timestamp() WHERE id=$1",
      [endpointId],
    );
    expect(
      await withTenantTransaction(api, scope, (transaction) =>
        redriveDelivery(transaction, apiQueue, scope, deliveryId, expiresAt, 'operator', 'Retry'),
      ),
    ).toMatchObject({ ok: false, code: 'DELIVERY_REDRIVE_ENDPOINT_INACTIVE' });
    expect((await fixture.query('SELECT id FROM app.deliveries')).rows).toHaveLength(1);
    expect(
      (await fixture.query('SELECT source_delivery_id FROM app.delivery_redrives')).rows,
    ).toHaveLength(0);
    expect((await fixture.query('SELECT pending FROM app.tenant_budgets')).rows).toEqual([
      { pending: 0 },
    ]);
  });

  it('hides cancellation and redrive identifiers outside their environment', async () => {
    const foreignScope = { ...scope, environmentId: v7() };
    expect(
      await withTenantTransaction(api, foreignScope, (transaction) =>
        cancelNotification(transaction, foreignScope, notificationId),
      ),
    ).toMatchObject({ ok: false, status: 404 });
    expect(
      await withTenantTransaction(api, foreignScope, (transaction) =>
        redriveDelivery(
          transaction,
          apiQueue,
          foreignScope,
          deliveryId,
          new Date(Date.now() + 3_600_000),
          'operator',
          'Retry',
        ),
      ),
    ).toMatchObject({ ok: false, status: 404 });
    expect((await fixture.query('SELECT state FROM app.deliveries')).rows).toEqual([
      { state: 'queued' },
    ]);
  });
});
