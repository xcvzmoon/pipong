import type { DatabaseRuntime } from '@pipong/database';
import type { AttemptFence, SendReservation } from '@pipong/database/attempts';
import type { DeliveryJob, QueueRuntime } from '@pipong/database/delivery-queue';
import {
  fetchDeliveryJobs,
  insertDeliveryJob,
  startDeliveryQueue,
} from '@pipong/database/delivery-queue';
import { withTenantTransaction } from '@pipong/database/tenancy';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { v7 } from 'uuid';
import * as v from 'valibot';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { reserveDelivery, settleDelivery } from '../src/delivery.ts';

const testUrl = process.env.TEST_DELIVERY_DATABASE_URL;
const runCommand = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const databaseName = `pipong_attempts_${process.pid}`;
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

function sendFence(reservation: SendReservation): AttemptFence {
  if (reservation.status !== 'send') {
    throw new Error('TEST_SEND_RESERVATION_MISSING');
  }
  return reservation.fence;
}

describe.skipIf(!testUrl)('fenced delivery attempts in disposable PostgreSQL', () => {
  const admin = new Client({ connectionString: testUrl });
  let fixture: Client;
  let worker: DatabaseRuntime;
  let secondWorker: DatabaseRuntime;
  let queue: QueueRuntime;
  let secondQueue: QueueRuntime;
  let jobId: string;
  let sends = 0;
  let transportUrl: string;
  const transport = createServer((_request, response) => {
    sends += 1;
    response.writeHead(200);
    response.end('accepted');
  });

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

  async function recover(): Promise<void> {
    await fixture.query(
      "UPDATE pgboss.job SET state='retry',start_after=clock_timestamp() WHERE id=$1",
      [jobId],
    );
  }

  async function reserveInWorker(claimed: {
    id: string;
    retryCount: number;
  }): Promise<SendReservation> {
    const script = `
      const { useWorkerDb } = await import(${JSON.stringify(new URL('../../database/src/index.ts', import.meta.url).href)});
      const { startDeliveryQueue } = await import(${JSON.stringify(new URL('../../database/src/delivery-queue.ts', import.meta.url).href)});
      const { reserveDelivery } = await import(${JSON.stringify(new URL('../src/delivery.ts', import.meta.url).href)});
      const runtime = await useWorkerDb();
      const handle = await startDeliveryQueue(runtime, 'worker');
      try {
        console.info(JSON.stringify(await reserveDelivery(runtime, handle, ${JSON.stringify(job)}, ${JSON.stringify(claimed)})));
      } finally {
        await handle.stop({ graceful: true });
        await runtime.close();
      }
    `;
    const result = await runCommand(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root,
      env: { ...process.env, NODE_ENV: 'test', WORKER_DATABASE_URL: roleUrl('pipong_worker') },
    });
    return v.parse(
      v.object({
        status: v.literal('send'),
        fence: v.object({
          job: v.object({
            organizationId: v.string(),
            projectId: v.string(),
            environmentId: v.string(),
            notificationId: v.string(),
            deliveryId: v.string(),
            provider: v.literal('apns'),
          }),
          claim: v.object({ id: v.string(), retryCount: v.number() }),
          generation: v.number(),
        }),
        request: v.string(),
        expiresAt: v.pipe(
          v.string(),
          v.transform((value) => new Date(value)),
        ),
        encryptedTarget: v.string(),
        encryptedSecret: v.string(),
        appId: v.string(),
        endpointId: v.string(),
        recipientId: v.string(),
        installationId: v.string(),
        endpointGeneration: v.number(),
        credentialId: v.string(),
        publicKey: v.nullable(v.string()),
      }),
      JSON.parse(result.stdout),
    );
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
    const { useWorkerDb } = await import('@pipong/database');
    [worker, secondWorker] = await Promise.all([useWorkerDb(), useWorkerDb()]);
    [queue, secondQueue] = await Promise.all([
      startDeliveryQueue(worker, 'worker'),
      startDeliveryQueue(secondWorker, 'worker'),
    ]);
    await new Promise<void>((resolve) => transport.listen(0, '127.0.0.1', resolve));
    const address = transport.address();
    if (!address || !v.safeParse(v.object({ port: v.number() }), address).success) {
      throw new Error('TEST_TRANSPORT_UNAVAILABLE');
    }
    transportUrl = `http://127.0.0.1:${v.parse(v.object({ port: v.number() }), address).port}`;
  }, 30_000);

  beforeEach(async () => {
    sends = 0;
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
      "INSERT INTO app.notifications (id,organization_id,project_id,environment_id,request,expires_at,delivery_count) VALUES ($1,$2,$3,$4,'{}',clock_timestamp()+interval '1 hour',1)",
      [notificationId, organizationId, projectId, environmentId],
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
    await new Promise<void>((resolve, reject) =>
      transport.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      }),
    );
    await Promise.all([queue?.stop({ graceful: true }), secondQueue?.stop({ graceful: true })]);
    await Promise.all([worker?.close(), secondWorker?.close()]);
    await fixture?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin.query('DROP ROLE IF EXISTS pipong_api, pipong_worker, pipong_migrator');
    await admin.end();
    vi.unstubAllEnvs();
  });

  it('reserves one attempt for competing workers and commits before local network I/O', async () => {
    const claims = await Promise.all([
      fetchDeliveryJobs(worker, queue, 'apns'),
      fetchDeliveryJobs(secondWorker, secondQueue, 'apns'),
    ]);
    expect(claims.flat()).toHaveLength(1);
    const claimed = claims.flat()[0];
    if (!claimed) {
      throw new Error('TEST_CLAIM_MISSING');
    }
    const outcomes = await Promise.allSettled([reserveInWorker(claimed), reserveInWorker(claimed)]);
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const successful = outcomes.find((outcome) => outcome.status === 'fulfilled');
    if (successful?.status !== 'fulfilled') {
      throw new Error('TEST_RESERVATION_MISSING');
    }
    expect(successful.value).toMatchObject({
      status: 'send',
      encryptedTarget: 'target',
      encryptedSecret: 'secret',
      endpointId,
      recipientId,
      installationId: 'installation',
      endpointGeneration: 1,
      credentialId,
      publicKey: null,
    });
    await fixture.query("SET lock_timeout='1s'");
    await fixture.query("UPDATE app.endpoints SET state='disabled',disabled_at=now() WHERE id=$1", [
      endpointId,
    ]);
    expect((await fetch(transportUrl)).status).toBe(200);
    await settleDelivery(worker, queue, sendFence(successful.value), {
      kind: 'accepted',
      code: 'accepted',
    });
    expect(sends).toBe(1);
    expect(
      (await fixture.query('SELECT state,attempt_generation FROM app.deliveries')).rows,
    ).toEqual([{ state: 'provider_accepted', attempt_generation: 1 }]);
    expect((await fixture.query('SELECT pending FROM app.tenant_budgets')).rows).toEqual([
      { pending: 0 },
    ]);
    expect(
      (await fixture.query('SELECT state FROM app.delivery_events ORDER BY sequence')).rows,
    ).toEqual([{ state: 'sending' }, { state: 'provider_accepted' }]);
  });

  it('rejects a reclaimed claim before its replacement reserves and rolls back successor/result/event writes', async () => {
    const old = await claim();
    const fence = sendFence(await reserveDelivery(worker, queue, job, old));
    await recover();
    const replacement = await claim(secondWorker, secondQueue);
    await expect(
      settleDelivery(worker, queue, fence, { kind: 'accepted', code: 'accepted' }),
    ).rejects.toThrow('DELIVERY_QUEUE_CLAIM_LOST');
    expect((await fixture.query('SELECT pending FROM app.tenant_budgets')).rows).toEqual([
      { pending: 1 },
    ]);
    expect(replacement.retryCount).toBe(old.retryCount + 1);
    await expect(
      settleDelivery(worker, queue, fence, {
        kind: 'ambiguous',
        code: 'timeout',
        retryAt: new Date(Date.now() + 60_000),
        successorId: v7(),
      }),
    ).rejects.toThrow('DELIVERY_QUEUE_CLAIM_LOST');
    expect(
      (await fixture.query('SELECT finished_at,outcome FROM app.delivery_attempts')).rows,
    ).toEqual([{ finished_at: null, outcome: null }]);
    expect((await fixture.query('SELECT state FROM app.delivery_events')).rows).toEqual([
      { state: 'sending' },
    ]);
    expect(
      (await fixture.query("SELECT id FROM pgboss.job WHERE name='delivery-apns'")).rows,
    ).toHaveLength(1);
    const nextFence = sendFence(await reserveDelivery(secondWorker, secondQueue, job, replacement));
    expect(nextFence.generation).toBe(2);
    await expect(
      settleDelivery(worker, queue, fence, { kind: 'accepted', code: 'accepted' }),
    ).rejects.toThrow('DELIVERY_ATTEMPT_FENCE_LOST');
    await settleDelivery(secondWorker, secondQueue, nextFence, {
      kind: 'permanent',
      code: 'invalid_token',
    });
  });

  it('recovers post-acceptance crashes as a new attempt and acknowledges recovered terminal work without sending', async () => {
    const old = await claim();
    await reserveDelivery(worker, queue, job, old);
    await fetch(transportUrl);
    await recover();
    const replacement = await claim(secondWorker, secondQueue);
    const fence = sendFence(await reserveDelivery(secondWorker, secondQueue, job, replacement));
    await fetch(transportUrl);
    await settleDelivery(secondWorker, secondQueue, fence, { kind: 'accepted', code: 'accepted' });
    expect(sends).toBe(2);
    await recover();
    const terminal = await claim();
    expect(await reserveDelivery(worker, queue, job, terminal)).toEqual({
      status: 'completed',
      state: 'provider_accepted',
    });
    expect(sends).toBe(2);
    const attempts = await fixture.query<{ generation: number; finished_at: Date | null }>(
      'SELECT generation,finished_at FROM app.delivery_attempts ORDER BY generation',
    );
    expect(attempts.rows[0]).toEqual({ generation: 1, finished_at: null });
    expect(attempts.rows[1]?.generation).toBe(2);
    expect(attempts.rows[1]?.finished_at).toBeInstanceOf(Date);
    expect(
      (await fixture.query("SELECT state FROM pgboss.job WHERE name='delivery-apns'")).rows,
    ).toEqual([{ state: 'completed' }]);
  });

  /* eslint-disable no-await-in-loop */
  it('orders cancellation, disablement and suspension against logical send-start', async () => {
    const mutations = [
      'UPDATE app.notifications SET canceled_at=now()',
      "UPDATE app.endpoints SET state='disabled',disabled_at=now()",
      'UPDATE app.environments SET suspended_at=now()',
      'UPDATE app.projects SET suspended_at=now()',
      'UPDATE auth.organizations SET disabled_at=now()',
    ];
    for (const mutation of mutations) {
      await fixture.query(mutation);
      const claimed = await claim();
      expect(await reserveDelivery(worker, queue, job, claimed)).toEqual({
        status: 'completed',
        state: 'canceled',
      });
      expect((await fixture.query('SELECT * FROM app.delivery_attempts')).rows).toHaveLength(0);
      await fixture.query(
        "UPDATE app.notifications SET canceled_at=NULL; UPDATE app.endpoints SET state='active',disabled_at=NULL; UPDATE app.environments SET suspended_at=NULL; UPDATE app.projects SET suspended_at=NULL; UPDATE auth.organizations SET disabled_at=NULL; UPDATE app.deliveries SET state='queued'; UPDATE app.tenant_budgets SET pending=1; UPDATE app.admission_reservations SET remaining=1",
      );
      jobId = v7();
      await withTenantTransaction(worker, scope, (transaction) =>
        insertDeliveryJob(queue, transaction, jobId, job),
      );
    }
    const claimed = await claim();
    const fence = sendFence(await reserveDelivery(worker, queue, job, claimed));
    for (const mutation of mutations) {
      await fixture.query(mutation);
    }
    await fetch(transportUrl);
    await settleDelivery(worker, queue, fence, { kind: 'accepted', code: 'accepted' });
    expect(sends).toBe(1);
  });

  /* eslint-enable no-await-in-loop */

  it('atomically schedules retry successors, expires unsendable work and enforces tenant/role boundaries', async () => {
    const claimed = await claim();
    const fence = sendFence(await reserveDelivery(worker, queue, job, claimed));
    const successorId = v7();
    await settleDelivery(worker, queue, fence, {
      kind: 'transient',
      code: 'unavailable',
      retryAt: new Date(Date.now() + 60_000),
      successorId,
    });
    expect(await fetchDeliveryJobs(secondWorker, secondQueue, 'apns')).toEqual([]);
    expect((await fixture.query('SELECT pending FROM app.tenant_budgets')).rows).toEqual([
      { pending: 1 },
    ]);
    expect((await fixture.query('SELECT state FROM app.deliveries')).rows).toEqual([
      { state: 'retry_wait' },
    ]);
    expect(
      (await fixture.query('SELECT keep_until FROM pgboss.job WHERE id=$1', [successorId])).rows,
    ).toEqual([{ keep_until: Infinity }]);
    await fixture.query('UPDATE pgboss.job SET start_after=clock_timestamp() WHERE id=$1', [
      successorId,
    ]);
    await fixture.query(
      "UPDATE app.notifications SET expires_at=clock_timestamp()-interval '1 second'",
    );
    const expired = await claim(secondWorker, secondQueue);
    expect(await reserveDelivery(secondWorker, secondQueue, job, expired)).toEqual({
      status: 'completed',
      state: 'expired',
    });
    expect((await fixture.query('SELECT pending FROM app.tenant_budgets')).rows).toEqual([
      { pending: 0 },
    ]);
    await expect(
      reserveDelivery(worker, queue, { ...job, organizationId: v7() }, claimed),
    ).rejects.toThrow('DELIVERY_NOT_FOUND');
    await expect(worker.pool.query('SELECT * FROM auth.organizations')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      worker.pool.query("UPDATE app.notifications SET request='changed'"),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      worker.pool.query("UPDATE app.credential_versions SET state='active'"),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(worker.pool.query('DELETE FROM app.delivery_attempts')).rejects.toMatchObject({
      code: '42501',
    });
    expect((await worker.pool.query('SELECT * FROM app.delivery_attempts')).rows).toHaveLength(0);
  });
});
