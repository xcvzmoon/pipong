import type { DatabaseRuntime } from '@pipong/database';
import type { SendReservation } from '@pipong/database/attempts';
import type { DeliveryJob, QueueRuntime } from '@pipong/database/delivery-queue';
import { organizationEnabled } from '@pipong/database/authorization';
import {
  fetchDeliveryJobs,
  insertDeliveryJob,
  startDeliveryQueue,
} from '@pipong/database/delivery-queue';
import { advanceErasure, requestScopeErasure } from '@pipong/database/erasure';
import { withTenantTransaction } from '@pipong/database/tenancy';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { v7 } from 'uuid';
import * as v from 'valibot';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { reserveDelivery, settleDelivery } from '../src/delivery.ts';
import { processErasures, processRetention } from '../src/erasure.ts';
import { deleteRecipient } from '../src/recipients.ts';

const testUrl = process.env.TEST_DELIVERY_DATABASE_URL;
const runCommand = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const databaseName = `pipong_erasure_${process.pid}`;
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

describe.skipIf(!testUrl)('bounded erasure in disposable PostgreSQL', () => {
  const admin = new Client({ connectionString: testUrl });
  let fixture: Client;
  let worker: DatabaseRuntime;
  let api: DatabaseRuntime;
  let queue: QueueRuntime;
  let jobId: string;
  function roleUrl(role: string): string {
    const url = new URL(testUrl ?? 'postgres://postgres@localhost/postgres');
    url.pathname = `/${databaseName}`;
    url.username = role;
    url.password = '';
    return url.href;
  }

  async function claim(): Promise<{ id: string; retryCount: number }> {
    const [claimed] = await fetchDeliveryJobs(worker, queue, 'apns');
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
  }, 30_000);

  beforeEach(async () => {
    await fixture.query(
      "TRUNCATE app.erasure_jobs, app.delivery_attempts, app.idempotency_records, app.notifications, app.deliveries, app.endpoint_generations, app.endpoints, app.credential_versions, app.recipients, app.environments, app.projects, app.delivery_events, app.event_streams, app.admission_reservations, app.key_budgets, app.tenant_budgets CASCADE; DELETE FROM pgboss.job WHERE name LIKE 'delivery-%'; DELETE FROM auth.organizations",
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
    await api?.close();
    await fixture?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin.query('DROP ROLE IF EXISTS pipong_api, pipong_worker, pipong_migrator');
    await admin.end();
    vi.unstubAllEnvs();
  });

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
        sendUntil: v.pipe(
          v.string(),
          v.transform((value) => new Date(value)),
        ),
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
      JSON.parse(result.stdout.trim().split('\n').at(-1) ?? ''),
    );
  }
  async function requestErasure(
    kind: 'organization' | 'project' | 'environment' = 'environment',
  ): Promise<string> {
    const target =
      kind === 'organization'
        ? { kind, organizationId }
        : kind === 'project'
          ? { kind, organizationId, projectId }
          : scope;
    const receipt = await withTenantTransaction(api, target, async (transaction) => {
      await organizationEnabled(transaction, organizationId, 'update');
      return requestScopeErasure(transaction, target, 'operator');
    });
    return receipt.erasureId;
  }

  // oxlint-disable eslint/no-await-in-loop -- Each scan commits before the next restart/progress assertion.
  async function drain(): Promise<void> {
    for (let index = 0; index < 80; index += 1) {
      if ((await processErasures(worker)) === 0) {
        expect(
          (await fixture.query('SELECT id FROM app.erasure_jobs WHERE completed_at IS NULL')).rows,
        ).toHaveLength(0);
        return;
      }
    }
    throw new Error('TEST_ERASURE_NOT_FINISHED');
  }

  it('retains a committed send snapshot, blocks new reservations, and never restores erased secrets', async () => {
    const reservation = await reserveInWorker(await claim());
    if (reservation.status !== 'send') {
      throw new Error('TEST_RESERVATION_MISSING');
    }
    const id = await requestErasure();
    await processErasures(worker);
    await processErasures(worker);
    expect((await fixture.query('SELECT state FROM app.deliveries')).rows).toEqual([
      { state: 'sending' },
    ]);
    expect(
      await settleDelivery(worker, queue, reservation.fence, {
        kind: 'accepted',
        code: 'accepted',
        providerResponse: 'private-receipt',
      }),
    ).toBe('provider_accepted');
    await drain();
    expect(
      (await fixture.query('SELECT encrypted_secret,public_key,state FROM app.credential_versions'))
        .rows,
    ).toEqual([{ encrypted_secret: '', public_key: null, state: 'retired' }]);
    expect(
      (await fixture.query('SELECT encrypted_target FROM app.endpoint_generations')).rows,
    ).toEqual([{ encrypted_target: '' }]);
    expect((await fixture.query('SELECT request FROM app.notifications')).rows).toEqual([
      { request: '' },
    ]);
    expect((await fixture.query('SELECT external_id FROM app.recipients')).rows).toEqual([
      { external_id: null },
    ]);
    expect((await fixture.query('SELECT installation_id,state FROM app.endpoints')).rows).toEqual([
      { installation_id: null, state: 'disabled' },
    ]);
    expect(
      (await fixture.query('SELECT provider_response FROM app.delivery_attempts')).rows,
    ).toEqual([{ provider_response: null }]);
    expect(
      (
        await fixture.query(
          'SELECT actor_id,completed_at IS NOT NULL AS completed FROM app.erasure_jobs WHERE id=$1',
          [id],
        )
      ).rows,
    ).toEqual([{ actor_id: 'operator', completed: true }]);
    const successor = v7();
    await withTenantTransaction(worker, scope, (transaction) =>
      insertDeliveryJob(queue, transaction, successor, job),
    );
    expect(await reserveDelivery(worker, queue, job, await claim())).toEqual({
      status: 'completed',
      state: 'provider_accepted',
    });
    expect((await fixture.query('SELECT * FROM app.delivery_attempts')).rows).toHaveLength(1);
  });

  it('cancels a transient result immediately after deletion without waiting for cleanup or creating a successor', async () => {
    const reservation = await reserveDelivery(worker, queue, job, await claim());
    if (reservation.status !== 'send') {
      throw new Error('TEST_RESERVATION_MISSING');
    }
    await requestErasure();
    expect(
      await settleDelivery(worker, queue, reservation.fence, {
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
    await drain();
  });

  it('abandons a crashed in-flight attempt at the deadline and rejects late settlement', async () => {
    const reservation = await reserveDelivery(worker, queue, job, await claim());
    if (reservation.status !== 'send') {
      throw new Error('TEST_RESERVATION_MISSING');
    }
    const id = await requestErasure('project');
    await fixture.query(
      "UPDATE app.erasure_jobs SET in_flight_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [id],
    );
    await drain();
    expect((await fixture.query('SELECT state FROM app.deliveries')).rows).toEqual([
      { state: 'canceled' },
    ]);
    expect((await fixture.query('SELECT outcome,code FROM app.delivery_attempts')).rows).toEqual([
      { outcome: 'ambiguous', code: 'DELIVERY_ERASURE_ABANDONED' },
    ]);
    expect((await fixture.query('SELECT pending FROM app.tenant_budgets')).rows).toEqual([
      { pending: 0 },
    ]);
    await expect(
      settleDelivery(worker, queue, reservation.fence, { kind: 'accepted', code: 'accepted' }),
    ).rejects.toThrow('DELIVERY_ATTEMPT_FENCE_LOST');
    expect((await fixture.query('SELECT state FROM pgboss.job')).rows).toEqual([
      { state: 'cancelled' },
    ]);
  });

  it('abandons a late provider receipt even before the cleanup worker reaches the delivery', async () => {
    const reservation = await reserveDelivery(worker, queue, job, await claim());
    if (reservation.status !== 'send') {
      throw new Error('TEST_RESERVATION_MISSING');
    }
    const id = await requestErasure();
    await fixture.query(
      "UPDATE app.erasure_jobs SET in_flight_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [id],
    );
    expect(
      await settleDelivery(worker, queue, reservation.fence, {
        kind: 'accepted',
        code: 'accepted',
        providerResponse: 'late-receipt',
      }),
    ).toBe('canceled');
    expect(
      (await fixture.query('SELECT outcome,code,provider_response FROM app.delivery_attempts'))
        .rows,
    ).toEqual([
      { outcome: 'ambiguous', code: 'DELIVERY_ERASURE_ABANDONED', provider_response: null },
    ]);
    await drain();
  });

  it('serializes a new reservation behind deletion and cancels pending work without sending', async () => {
    const claimValue = await claim();
    const blocker = await api.pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM auth.organizations WHERE id=$1 FOR UPDATE', [
        organizationId,
      ]);
      const reserved = reserveDelivery(worker, queue, job, claimValue);
      await expect
        .poll(
          async () =>
            (
              await fixture.query<{ count: string }>(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'",
                [databaseName],
              )
            ).rows[0]?.count,
        )
        .toBe('1');
      await blocker.query(
        'UPDATE auth.organizations SET disabled_at=clock_timestamp(),deleted_at=clock_timestamp() WHERE id=$1',
        [organizationId],
      );
      await blocker.query('COMMIT');
      expect(await reserved).toEqual({ status: 'completed', state: 'canceled' });
      expect((await fixture.query('SELECT * FROM app.delivery_attempts')).rows).toHaveLength(0);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
  });

  it('erases only a deleted recipient and preserves credentials and sibling tenant data', async () => {
    const otherOrganizationId = v7();
    const otherProjectId = v7();
    const otherEnvironmentId = v7();
    await fixture.query("INSERT INTO auth.organizations(id,name,slug) VALUES($1,'Other','other')", [
      otherOrganizationId,
    ]);
    await fixture.query(
      "INSERT INTO app.projects(id,organization_id,name) VALUES($1,$2,'Other project')",
      [otherProjectId, otherOrganizationId],
    );
    await fixture.query(
      "INSERT INTO app.environments(id,organization_id,project_id,name) VALUES($1,$2,$3,'Other environment')",
      [otherEnvironmentId, otherOrganizationId, otherProjectId],
    );
    await fixture.query(
      "INSERT INTO app.credential_versions(id,organization_id,project_id,environment_id,provider,app_id,encrypted_secret) VALUES($1,$2,$3,$4,'apns','other-app','other-secret')",
      [v7(), otherOrganizationId, otherProjectId, otherEnvironmentId],
    );
    expect(
      await withTenantTransaction(
        api,
        { ...scope, organizationId: otherOrganizationId },
        (transaction) =>
          deleteRecipient(
            transaction,
            { ...scope, organizationId: otherOrganizationId },
            recipientId,
            'operator',
          ),
      ),
    ).toMatchObject({ ok: false, status: 404 });
    const siblingRecipientId = v7();
    const siblingEndpointId = v7();
    const siblingDeliveryId = v7();
    await fixture.query(
      "INSERT INTO app.recipients(id,organization_id,project_id,environment_id,external_id) VALUES($1,$2,$3,$4,'sibling')",
      [siblingRecipientId, organizationId, projectId, environmentId],
    );
    await fixture.query('BEGIN');
    await fixture.query(
      "INSERT INTO app.endpoints(id,organization_id,project_id,environment_id,recipient_id,installation_id,provider,app_id,generation,credential_id,target_hash) VALUES($1,$2,$3,$4,$5,'sibling-installation','apns','app',1,$6,'sibling-hash')",
      [
        siblingEndpointId,
        organizationId,
        projectId,
        environmentId,
        siblingRecipientId,
        credentialId,
      ],
    );
    await fixture.query(
      "INSERT INTO app.endpoint_generations(endpoint_id,generation,credential_id,encrypted_target,organization_id,project_id,environment_id,registered_at) VALUES($1,1,$2,'sibling-target',$3,$4,$5,now())",
      [siblingEndpointId, credentialId, organizationId, projectId, environmentId],
    );
    await fixture.query('COMMIT');
    await fixture.query(
      "INSERT INTO app.deliveries(id,organization_id,project_id,environment_id,notification_id,endpoint_id,generation,credential_id,provider) VALUES($1,$2,$3,$4,$5,$6,1,$7,'apns')",
      [
        siblingDeliveryId,
        organizationId,
        projectId,
        environmentId,
        notificationId,
        siblingEndpointId,
        credentialId,
      ],
    );
    await fixture.query(
      'UPDATE app.tenant_budgets SET pending=2; UPDATE app.admission_reservations SET endpoints=2,remaining=2; UPDATE app.notifications SET delivery_count=2',
    );
    await withTenantTransaction(api, scope, (transaction) =>
      deleteRecipient(transaction, scope, recipientId, 'key-actor'),
    );
    await drain();
    expect(
      (await fixture.query('SELECT encrypted_secret FROM app.credential_versions ORDER BY app_id'))
        .rows,
    ).toEqual([{ encrypted_secret: 'secret' }, { encrypted_secret: 'other-secret' }]);
    expect(
      (
        await fixture.query('SELECT name,deleted_at FROM app.environments WHERE id=$1', [
          otherEnvironmentId,
        ])
      ).rows,
    ).toEqual([{ name: 'Other environment', deleted_at: null }]);
    expect(
      (await fixture.query('SELECT external_id FROM app.recipients WHERE id=$1', [recipientId]))
        .rows,
    ).toEqual([{ external_id: null }]);
    expect(
      (await fixture.query('SELECT state FROM app.deliveries WHERE id=$1', [deliveryId])).rows,
    ).toEqual([{ state: 'canceled' }]);
    expect(
      (await fixture.query('SELECT state FROM app.deliveries WHERE id=$1', [siblingDeliveryId]))
        .rows,
    ).toEqual([{ state: 'canceled' }]);
    expect(
      (
        await fixture.query('SELECT external_id FROM app.recipients WHERE id=$1', [
          siblingRecipientId,
        ])
      ).rows,
    ).toEqual([{ external_id: 'sibling' }]);
    expect(
      (
        await fixture.query(
          'SELECT encrypted_target FROM app.endpoint_generations WHERE endpoint_id=$1',
          [siblingEndpointId],
        )
      ).rows,
    ).toEqual([{ encrypted_target: 'sibling-target' }]);
    expect((await fixture.query('SELECT pending FROM app.tenant_budgets')).rows).toEqual([
      { pending: 0 },
    ]);
    await withTenantTransaction(worker, scope, (transaction) =>
      insertDeliveryJob(queue, transaction, v7(), job),
    );
    expect(await reserveDelivery(worker, queue, job, await claim())).toEqual({
      status: 'completed',
      state: 'canceled',
    });
  });

  it('commits at most 100 rows per stage and resumes across independent worker transactions', async () => {
    await fixture.query(
      "INSERT INTO app.recipients(id,organization_id,project_id,environment_id,external_id) SELECT gen_random_uuid(),$1,$2,$3,'identity-' || index FROM generate_series(1,205) AS index",
      [organizationId, projectId, environmentId],
    );
    const keyId = v7();
    const orphanKeyId = v7();
    await fixture.query(
      "INSERT INTO auth.api_keys(id,reference_id,key,name) VALUES($1,$2,'key-secret','Key'),($3,$2,'orphan-secret','Orphan')",
      [keyId, organizationId, orphanKeyId],
    );
    await fixture.query(
      "INSERT INTO auth.service_key_grants(key_id,organization_id,project_id,environment_id,actions) VALUES($1,$2,$3,$4,ARRAY['notification:send'])",
      [keyId, organizationId, projectId, environmentId],
    );
    const inviterId = v7();
    const invitationId = v7();
    await fixture.query(
      "INSERT INTO auth.users(id,name,email,email_verified) VALUES($1,'Inviter','inviter@example.com',true)",
      [inviterId],
    );
    await fixture.query(
      "INSERT INTO auth.invitations(id,organization_id,email,role,expires_at,inviter_id) VALUES($1,$2,'invitee@example.com','member',clock_timestamp()+interval '1 day',$3)",
      [invitationId, organizationId, inviterId],
    );
    const mailId = await queue.send('auth-email', {
      kind: 'invitation',
      to: 'invitee@example.com',
      name: 'Private org name',
      url: 'https://example.com/api/auth/organization/get-invitation?id=' + invitationId,
      expiresAt: Date.now() + 86_400_000,
    });
    const id = await requestErasure('organization');
    for (let index = 0; index < 20; index += 1) {
      const row = await fixture.query<{ stage: string }>(
        'SELECT stage FROM app.erasure_jobs WHERE id=$1',
        [id],
      );
      if (row.rows[0]?.stage === 'recipients') {
        break;
      }
      await processErasures(worker);
    }
    await withTenantTransaction(worker, { kind: 'organization', organizationId }, (transaction) =>
      advanceErasure(transaction, id),
    );
    expect(
      (
        await fixture.query<{ count: string }>(
          'SELECT count(*) FROM app.recipients WHERE external_id IS NULL',
        )
      ).rows[0]?.count,
    ).toBe('100');
    const { useWorkerDb } = await import('@pipong/database');
    const restarted = await useWorkerDb();
    try {
      await processErasures(restarted);
    } finally {
      await restarted.close();
    }
    expect(
      (
        await fixture.query<{ count: string }>(
          'SELECT count(*) FROM app.recipients WHERE external_id IS NULL',
        )
      ).rows[0]?.count,
    ).toBe('200');
    await drain();
    expect(
      (
        await fixture.query<{ count: string }>(
          'SELECT count(*) FROM app.recipients WHERE external_id IS NULL',
        )
      ).rows[0]?.count,
    ).toBe('206');
    expect(
      (
        await fixture.query(
          'SELECT name,metadata,deleted_at IS NOT NULL AS deleted FROM auth.organizations WHERE id=$1',
          [organizationId],
        )
      ).rows,
    ).toEqual([{ name: 'erased:' + organizationId, metadata: null, deleted: true }]);
    expect(
      (await fixture.query('SELECT key,enabled,name FROM auth.api_keys ORDER BY id')).rows,
    ).toEqual([
      { key: '', enabled: false, name: null },
      { key: '', enabled: false, name: null },
    ]);
    expect(
      (await fixture.query('SELECT data,state FROM pgboss.job WHERE id=$1', [mailId])).rows,
    ).toEqual([{ data: {}, state: 'cancelled' }]);
    expect((await fixture.query('SELECT id FROM auth.invitations')).rows).toHaveLength(0);
    expect(
      (await fixture.query('SELECT deleted_at IS NOT NULL AS deleted FROM auth.service_key_grants'))
        .rows,
    ).toEqual([{ deleted: true }]);
    await expect(api.pool.query('SELECT * FROM app.pending_erasures()')).rejects.toThrow(
      'permission denied',
    );
    await fixture.query(
      "UPDATE app.erasure_jobs SET completed_at=clock_timestamp()-interval '91 days'; DELETE FROM app.delivery_events",
    );
    await fixture.query(
      'INSERT INTO app.event_streams(organization_id,project_id,environment_id,sequence) VALUES($1,$2,$3,205) ON CONFLICT(environment_id) DO UPDATE SET sequence=205,watermark=0',
      [organizationId, projectId, environmentId],
    );
    await fixture.query(
      "INSERT INTO app.delivery_events(organization_id,project_id,environment_id,sequence,notification_id,delivery_id,state,created_at) SELECT $1,$2,$3,index,$4,$5,'canceled',clock_timestamp()-interval '8 days' FROM generate_series(1,205) AS index",
      [organizationId, projectId, environmentId, notificationId, deliveryId],
    );
    await fixture.query(
      "UPDATE app.notifications SET request='old-private-payload',accepted_at=clock_timestamp()-interval '31 days' WHERE id=$1",
      [notificationId],
    );
    await fixture.query(
      "INSERT INTO app.delivery_attempts(organization_id,project_id,environment_id,delivery_id,generation,job_id,retry_count,started_at,finished_at,outcome,code) VALUES($1,$2,$3,$4,1,$5,0,clock_timestamp()-interval '31 days',clock_timestamp()-interval '31 days','permanent','old-code'),($1,$2,$3,$4,2,$6,0,clock_timestamp()-interval '29 days',clock_timestamp()-interval '29 days','permanent','retained-code')",
      [organizationId, projectId, environmentId, deliveryId, v7(), v7()],
    );
    await fixture.query(
      "INSERT INTO app.idempotency_records(organization_id,project_id,environment_id,key,fingerprint,notification_id,response,expires_at) VALUES($1,$2,$3,'expired','digest',$4,'{}',clock_timestamp()-interval '1 second'),($1,$2,$3,'retained','digest',$4,'{}',clock_timestamp()+interval '1 day')",
      [organizationId, projectId, environmentId, notificationId],
    );
    await processRetention(worker);
    expect((await fixture.query('SELECT id FROM app.erasure_jobs')).rows).toHaveLength(0);
    expect((await fixture.query('SELECT request FROM app.notifications')).rows).toEqual([
      { request: '' },
    ]);
    expect((await fixture.query('SELECT code FROM app.delivery_attempts')).rows).toEqual([
      { code: 'retained-code' },
    ]);
    expect((await fixture.query('SELECT key FROM app.idempotency_records')).rows).toEqual([
      { key: 'retained' },
    ]);
    expect(
      (await fixture.query<{ count: string }>('SELECT count(*) FROM app.delivery_events')).rows[0]
        ?.count,
    ).toBe('105');
    expect((await fixture.query('SELECT watermark::text FROM app.event_streams')).rows).toEqual([
      { watermark: '100' },
    ]);
    await processRetention(worker);
    expect(
      (await fixture.query<{ count: string }>('SELECT count(*) FROM app.delivery_events')).rows[0]
        ?.count,
    ).toBe('5');
    await processRetention(worker);
    expect((await fixture.query('SELECT watermark::text FROM app.event_streams')).rows).toEqual([
      { watermark: '205' },
    ]);
  });
  // oxlint-enable eslint/no-await-in-loop
});
