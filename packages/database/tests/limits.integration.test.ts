import type { DatabaseRuntime } from '../src/clients.ts';
import type { QueueRuntime } from '../src/delivery-queue.ts';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { v7 } from 'uuid';
import * as v from 'valibot';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completeDeliveryJob,
  fetchDeliveryJobs,
  insertDeliveryJob,
  startDeliveryQueue,
} from '../src/delivery-queue.ts';
import { reserveAdmission, settleAdmission } from '../src/limits.ts';
import { withTenantTransaction } from '../src/tenancy/index.ts';

const testUrl = process.env.TEST_ADMISSION_DATABASE_URL;
const runCommand = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const databaseName = `pipong_limits_${process.pid}`;
const organizationId = '019a0000-0000-7000-8000-000000000901';
const healthyId = '019a0000-0000-7000-8000-000000000902';
const keyId = '019a0000-0000-7000-8000-000000000903';
const scope = { kind: 'organization', organizationId } as const;
const healthyScope = { kind: 'organization', organizationId: healthyId } as const;

describe.skipIf(!testUrl)('distributed admission in disposable PostgreSQL', () => {
  const admin = new Client({ connectionString: testUrl });
  let fixture: Client;
  let api: DatabaseRuntime;
  let secondApi: DatabaseRuntime;
  let worker: DatabaseRuntime;
  let secondWorker: DatabaseRuntime;
  let queue: QueueRuntime;
  let secondQueue: QueueRuntime;

  function roleUrl(role: string): string {
    const url = new URL(testUrl ?? 'postgres://postgres@localhost/postgres');
    url.pathname = `/${databaseName}`;
    url.username = role;
    url.password = '';
    return url.href;
  }

  async function runReplica(role: 'api' | 'worker', body: string): Promise<string> {
    const script = `
      import assert from 'node:assert/strict';
      import { randomUUID } from 'node:crypto';
      const { useApiDb, useWorkerDb } = await import(${JSON.stringify(new URL('../src/index.ts', import.meta.url).href)});
      const { withTenantTransaction } = await import(${JSON.stringify(new URL('../src/tenancy/index.ts', import.meta.url).href)});
      const { admitNotification, releaseNotificationCapacity } = await import(${JSON.stringify(new URL('../../service/src/limits.ts', import.meta.url).href)});
      const { startDeliveryQueue, fetchDeliveryJobs } = await import(${JSON.stringify(new URL('../src/delivery-queue.ts', import.meta.url).href)});
      const runtime = await ${role === 'api' ? 'useApiDb' : 'useWorkerDb'}();
      const queue = ${role === 'worker' ? "await startDeliveryQueue(runtime, 'worker')" : 'null'};
      const scope = ${JSON.stringify(scope)};
      try { ${body} } finally { if (queue) await queue.stop({ graceful: true }); await runtime.close(); }
    `;
    const result = await runCommand(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        API_DATABASE_URL: roleUrl('pipong_api'),
        WORKER_DATABASE_URL: roleUrl('pipong_worker'),
      },
    });
    return result.stdout.trim();
  }

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${databaseName}`);
    fixture = new Client({ connectionString: roleUrl('postgres') });
    await fixture.connect();
    const provision = await readFile(new URL('../provision.sql', import.meta.url), 'utf8');
    await fixture.query(provision.replaceAll(':"DBNAME"', `"${databaseName}"`));
    await runCommand('pnpm', ['migrate'], {
      cwd: root,
      env: { ...process.env, NODE_ENV: 'test', MIGRATION_DATABASE_URL: roleUrl('pipong_migrator') },
    });
    await fixture.query(
      "INSERT INTO auth.organizations (id,name,slug) VALUES ($1,'Noisy','noisy'),($2,'Healthy','healthy')",
      [organizationId, healthyId],
    );
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('API_DATABASE_URL', roleUrl('pipong_api'));
    vi.stubEnv('WORKER_DATABASE_URL', roleUrl('pipong_worker'));
    const { useApiDb, useWorkerDb } = await import('../src/index.ts');
    [api, secondApi, worker, secondWorker] = await Promise.all([
      useApiDb(),
      useApiDb(),
      useWorkerDb(),
      useWorkerDb(),
    ]);
    [queue, secondQueue] = await Promise.all([
      startDeliveryQueue(worker, 'worker'),
      startDeliveryQueue(secondWorker, 'worker'),
    ]);
  }, 30_000);

  beforeEach(async () => {
    await fixture.query(
      "DELETE FROM app.admission_reservations; DELETE FROM app.key_budgets; DELETE FROM app.tenant_budgets; DELETE FROM pgboss.job WHERE name LIKE 'delivery-%'; UPDATE app.provider_budgets SET global_concurrency=3, tenant_concurrency=1",
    );
    await fixture.query(
      'INSERT INTO app.tenant_budgets (organization_id,request_limit,key_request_limit,fanout_limit,pending_limit) VALUES ($1,3,2,4,4),($2,3,2,4,4)',
      [organizationId, healthyId],
    );
  });

  afterAll(async () => {
    await Promise.all([queue?.stop({ graceful: true }), secondQueue?.stop({ graceful: true })]);
    await Promise.all([api?.close(), secondApi?.close(), worker?.close(), secondWorker?.close()]);
    await fixture?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin.query('DROP ROLE IF EXISTS pipong_api, pipong_worker, pipong_migrator');
    await admin.end();
    vi.unstubAllEnvs();
  });

  it('serializes request races across API processes and keeps another tenant progressing', async () => {
    const body = `
      const decisions = await Promise.all(Array.from({ length: 6 }, () => withTenantTransaction(runtime, scope, transaction => admitNotification(transaction, scope.organizationId, null, randomUUID(), 0))));
      for (const decision of decisions) {
        if (decision.status === 'rejected') {
          assert.equal(decision.code, 'ADMISSION_REQUEST_LIMIT');
          assert.ok(decision.retryAfter > 0 && decision.retryAfter <= 60);
        }
      }
      console.info(decisions.filter(decision => decision.status === 'accepted').length);
    `;
    const counts = await Promise.all([runReplica('api', body), runReplica('api', body)]);
    expect(Number(counts[0]) + Number(counts[1])).toBe(3);
    expect(
      await withTenantTransaction(secondApi, healthyScope, (transaction) =>
        reserveAdmission(transaction, healthyId, null, v7(), 1),
      ),
    ).toEqual({ status: 'accepted', replay: false });
  });

  it('charges replay requests without duplicating work and rolls back admission with failed enqueue', async () => {
    const id = v7();
    const decisions = await Promise.all(
      [api, secondApi].map((runtime) =>
        withTenantTransaction(runtime, scope, (transaction) =>
          reserveAdmission(transaction, organizationId, keyId, id, 2),
        ),
      ),
    );
    expect(decisions).toContainEqual({ status: 'accepted', replay: false });
    expect(decisions).toContainEqual({ status: 'accepted', replay: true });
    expect(
      (
        await fixture.query<{ requests: number; fanout: number; pending: number }>(
          'SELECT requests,fanout,pending FROM app.tenant_budgets WHERE organization_id=$1',
          [organizationId],
        )
      ).rows[0],
    ).toEqual({ requests: 2, fanout: 2, pending: 2 });
    expect(
      await withTenantTransaction(api, scope, (transaction) =>
        reserveAdmission(transaction, organizationId, keyId, id, 2),
      ),
    ).toMatchObject({ status: 'rejected', code: 'ADMISSION_KEY_LIMIT' });
    await expect(
      withTenantTransaction(api, scope, (transaction) =>
        reserveAdmission(transaction, organizationId, keyId, id, 3),
      ),
    ).rejects.toThrow('ADMISSION_RESERVATION_CONFLICT');
    const job = {
      organizationId,
      projectId: v7(),
      environmentId: v7(),
      notificationId: v7(),
      deliveryId: v7(),
      provider: 'apns' as const,
    };
    const jobId = v7();
    await withTenantTransaction(api, scope, (transaction) =>
      insertDeliveryJob(queue, transaction, jobId, job),
    );
    const rolledBackId = v7();
    await expect(
      withTenantTransaction(api, scope, async (transaction) => {
        expect(await reserveAdmission(transaction, organizationId, null, rolledBackId, 2)).toEqual({
          status: 'accepted',
          replay: false,
        });
        await insertDeliveryJob(queue, transaction, jobId, job);
      }),
    ).rejects.toThrow('DELIVERY_ENQUEUE_FAILED');
    expect(
      (await fixture.query('SELECT id FROM app.admission_reservations WHERE id=$1', [rolledBackId]))
        .rows,
    ).toHaveLength(0);
    expect(
      (
        await fixture.query<{ pending: number; requests: number }>(
          'SELECT pending,requests FROM app.tenant_budgets WHERE organization_id=$1',
          [organizationId],
        )
      ).rows[0],
    ).toEqual({ pending: 2, requests: 2 });
  });

  it('enforces key/fanout windows while retaining backlog usage and releasing it once', async () => {
    const id = v7();
    await withTenantTransaction(api, scope, (transaction) =>
      reserveAdmission(transaction, organizationId, keyId, id, 3),
    );
    await withTenantTransaction(secondApi, scope, (transaction) =>
      reserveAdmission(transaction, organizationId, keyId, v7(), 0),
    );
    expect(
      await withTenantTransaction(api, scope, (transaction) =>
        reserveAdmission(transaction, organizationId, keyId, v7(), 0),
      ),
    ).toMatchObject({ code: 'ADMISSION_KEY_LIMIT' });
    expect(
      await withTenantTransaction(api, scope, (transaction) =>
        reserveAdmission(transaction, organizationId, null, v7(), 2),
      ),
    ).toMatchObject({ code: 'ADMISSION_FANOUT_LIMIT' });
    await fixture.query(
      "UPDATE app.tenant_budgets SET window_start=clock_timestamp()-interval '2 minutes' WHERE organization_id=$1",
      [organizationId],
    );
    expect(
      await withTenantTransaction(api, scope, (transaction) =>
        reserveAdmission(transaction, organizationId, keyId, v7(), 2),
      ),
    ).toMatchObject({ code: 'ADMISSION_PENDING_LIMIT' });
    await expect(
      withTenantTransaction(worker, scope, async (transaction) => {
        await settleAdmission(transaction, organizationId, id, 0);
        throw new Error('TEST_ROLLBACK');
      }),
    ).rejects.toThrow('TEST_ROLLBACK');
    expect(
      (
        await fixture.query<{ pending: number }>(
          'SELECT pending FROM app.tenant_budgets WHERE organization_id=$1',
          [organizationId],
        )
      ).rows[0]?.pending,
    ).toBe(3);
    await Promise.all(
      [worker, secondWorker].map((runtime) =>
        withTenantTransaction(runtime, scope, (transaction) =>
          settleAdmission(transaction, organizationId, id, 0),
        ),
      ),
    );
    await expect(
      withTenantTransaction(worker, scope, (transaction) =>
        settleAdmission(transaction, organizationId, id, 1),
      ),
    ).rejects.toThrow('ADMISSION_RESERVATION_INVALID');
    expect(
      await withTenantTransaction(api, scope, (transaction) =>
        reserveAdmission(transaction, organizationId, keyId, v7(), 2),
      ),
    ).toEqual({ status: 'accepted', replay: false });
    expect(
      (
        await fixture.query<{ requests: number; fanout: number; pending: number }>(
          'SELECT requests,fanout,pending FROM app.tenant_budgets WHERE organization_id=$1',
          [organizationId],
        )
      ).rows[0],
    ).toEqual({ requests: 2, fanout: 2, pending: 2 });
  });

  it('caps active provider claims across worker processes and bypasses a saturated noisy tenant', async () => {
    await fixture.query('UPDATE app.provider_budgets SET tenant_concurrency=2 WHERE provider=$1', [
      'apns',
    ]);
    const inputs = Array.from({ length: 12 }, (_entry, index) => {
      const tenantId = index < 10 ? organizationId : healthyId;
      const tenantScope = { kind: 'organization', organizationId: tenantId } as const;
      const job = {
        organizationId: tenantId,
        projectId: v7(),
        environmentId: v7(),
        notificationId: v7(),
        deliveryId: v7(),
        provider: 'apns' as const,
      };
      return withTenantTransaction(api, tenantScope, (transaction) =>
        insertDeliveryJob(queue, transaction, v7(), job),
      );
    });
    await Promise.all(inputs);
    const outputs = await Promise.all([
      runReplica(
        'worker',
        "const batches = await Promise.all(Array.from({ length: 6 }, () => fetchDeliveryJobs(runtime, queue, 'apns'))); console.info(JSON.stringify(batches.flat()));",
      ),
      runReplica(
        'worker',
        "const batches = await Promise.all(Array.from({ length: 6 }, () => fetchDeliveryJobs(runtime, queue, 'apns'))); console.info(JSON.stringify(batches.flat()));",
      ),
    ]);
    const claimSchema = v.object({
      id: v.string(),
      retryCount: v.number(),
      data: v.object({ organizationId: v.string() }),
    });
    const claims = outputs.flatMap((output) => v.parse(v.array(claimSchema), JSON.parse(output)));
    expect(claims).toHaveLength(3);
    expect(claims.filter(({ data }) => data.organizationId === organizationId)).toHaveLength(2);
    expect(claims.filter(({ data }) => data.organizationId === healthyId)).toHaveLength(1);
    const healthy = claims.find(({ data }) => data.organizationId === healthyId);
    if (!healthy) {
      throw new Error('TEST_HEALTHY_CLAIM_MISSING');
    }
    await withTenantTransaction(worker, healthyScope, (transaction) =>
      completeDeliveryJob(queue, transaction, 'apns', healthy),
    );
    const [next] = await fetchDeliveryJobs(secondWorker, secondQueue, 'apns');
    expect(next?.data.organizationId).toBe(healthyId);
    expect(
      (
        await fixture.query<{ count: number }>(
          "SELECT count(*)::integer AS count FROM pgboss.job WHERE name='delivery-apns' AND state='active'",
        )
      ).rows[0]?.count,
    ).toBe(3);
    expect(await fetchDeliveryJobs(worker, queue, 'fcm')).toEqual([]);
  });

  it('fails closed across tenants and denies runtime edits to operator limits', async () => {
    await runReplica(
      'api',
      `
      for (const endpoints of [-1, 0.5, NaN, 2147483648]) {
        await assert.rejects(withTenantTransaction(runtime, scope, transaction => admitNotification(transaction, scope.organizationId, null, randomUUID(), endpoints)), /ADMISSION_INPUT_INVALID/);
      }
      await assert.rejects(withTenantTransaction(runtime, scope, transaction => admitNotification(transaction, 'invalid', null, randomUUID(), 1)), /ADMISSION_INPUT_INVALID/);
      await assert.rejects(withTenantTransaction(runtime, scope, transaction => releaseNotificationCapacity(transaction, scope.organizationId, randomUUID(), -1)), /ADMISSION_INPUT_INVALID/);
    `,
    );
    await expect(
      withTenantTransaction(api, healthyScope, (transaction) =>
        reserveAdmission(transaction, organizationId, null, v7(), 1),
      ),
    ).rejects.toThrow();
    await expect(
      api.pool.query('UPDATE app.tenant_budgets SET request_limit=1000'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      worker.pool.query('UPDATE app.provider_budgets SET global_concurrency=1000'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(worker.pool.query('DELETE FROM app.admission_reservations')).rejects.toMatchObject(
      { code: '42501' },
    );
    expect((await api.pool.query('SELECT * FROM app.tenant_budgets')).rows).toHaveLength(0);
    const lazyId = v7();
    await fixture.query(
      "INSERT INTO auth.organizations (id,name,slug) VALUES ($1,'Default','default')",
      [lazyId],
    );
    expect(
      await withTenantTransaction(
        api,
        { kind: 'organization', organizationId: lazyId },
        (transaction) => reserveAdmission(transaction, lazyId, null, v7(), 1),
      ),
    ).toEqual({ status: 'accepted', replay: false });
    await fixture.query("DELETE FROM app.provider_budgets WHERE provider='apns'");
    await expect(fetchDeliveryJobs(worker, queue, 'apns')).rejects.toThrow(
      'DELIVERY_PROVIDER_BUDGET_UNAVAILABLE',
    );
  });
});
