import type { AuthFixture } from './fixtures/auth-runtime.ts';
import { encryptSecret } from '@pipong/service';
import addFormats from 'ajv-formats';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { execFile } from 'node:child_process';
import { createSecretKey } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from 'pg';
import * as v from 'valibot';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startAuthFixture } from './fixtures/auth-runtime.ts';

const testUrl = process.env.TEST_AUTH_DATABASE_URL;
const root = fileURLToPath(new URL('../../../', import.meta.url));
const runCommand = promisify(execFile);
const userId = '019a0000-0000-7000-8000-000000000011';
const organizationId = '019a0000-0000-7000-8000-000000000101';
const projectId = '019a0000-0000-7000-8000-000000000111';
const environmentId = '019a0000-0000-7000-8000-000000000121';
const recipientId = '019a0000-0000-7000-8000-000000000131';
const endpointId = '019a0000-0000-7000-8000-000000000141';
const credentialId = '019a0000-0000-7000-8000-000000000151';
const siblingId = '019a0000-0000-7000-8000-000000000122';
const scope = { organizationId, projectId, environmentId };
const path = `/api/v1/organizations/${organizationId}/projects/${projectId}/environments/${environmentId}/notifications`;
const acceptanceSchema = v.strictObject({
  notificationId: v.pipe(v.string(), v.uuid()),
  acceptedAt: v.pipe(v.string(), v.isoTimestamp()),
  deliveryCount: v.number(),
});
const problemSchema = v.object({ status: v.number(), code: v.string() });

async function denied(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toContain('application/problem+json');
  expect(v.parse(problemSchema, await response.json()).code).toBe(code);
}

describe.skipIf(!testUrl)('atomic idempotent submission through built HTTP', () => {
  let fixture: AuthFixture;
  let cookie: string;
  let body: string;
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  ajv.addKeyword({ keyword: 'components', valid: true });

  function request(
    key = 'same-key',
    input = body,
    target = path,
    credentials = cookie,
  ): Promise<Response> {
    return fetch(`${fixture.baseUrl}${target}`, {
      method: 'POST',
      headers: {
        cookie: credentials,
        origin: fixture.baseUrl,
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: input,
    });
  }

  async function accepted(response: Response): Promise<v.InferOutput<typeof acceptanceSchema>> {
    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const result = v.parse(acceptanceSchema, await response.json());
    expect(response.headers.get('location')).toBe(`${path}/${result.notificationId}`);
    expect(
      ajv.validate({ $ref: 'pipong#/components/schemas/NotificationAcceptance' }, result),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    return result;
  }

  async function cardinality(notifications: number, count = notifications): Promise<void> {
    const result = await fixture.database.query<{
      notifications: number;
      deliveries: number;
      events: number;
      jobs: number;
      pending: number;
    }>(
      `SELECT
      (SELECT count(*)::int FROM app.notifications) AS notifications,
      (SELECT count(*)::int FROM app.deliveries) AS deliveries,
      (SELECT count(*)::int FROM app.delivery_events) AS events,
      (SELECT count(*)::int FROM pgboss.job WHERE name LIKE 'delivery-%') AS jobs,
      coalesce((SELECT pending FROM app.tenant_budgets WHERE organization_id=$1),0)::int AS pending`,
      [organizationId],
    );
    expect(result.rows[0]).toEqual({
      notifications,
      deliveries: count,
      events: count,
      jobs: count,
      pending: count,
    });
  }

  beforeAll(async () => {
    await runCommand(
      'pnpm',
      ['--filter', 'pipong-server', 'exec', 'nitro', 'build', 'tests/fixtures/domain-api'],
      { cwd: root },
    );
    fixture = await startAuthFixture(
      testUrl ?? '',
      true,
      'apps/server/tests/fixtures/domain-api/.output/server/index.mjs',
    );
    await fixture.database.query(
      "INSERT INTO auth.organizations (id,name,slug) VALUES ($1,'Submission','submission')",
      [organizationId],
    );
    const login = await fetch(`${fixture.baseUrl}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: fixture.baseUrl },
      body: JSON.stringify({
        email: 'verified@example.com',
        password: 'test-password-long-enough',
      }),
    });
    expect(login.status).toBe(200);
    cookie = login.headers
      .getSetCookie()
      .map((header) => header.split(';')[0])
      .join('; ');
    const contract = v.parse(
      v.object({
        components: v.object({ schemas: v.record(v.string(), v.looseObject({})) }),
        paths: v.record(v.string(), v.looseObject({})),
      }),
      await (await fetch(`${fixture.baseUrl}/_openapi.json`)).json(),
    );
    ajv.addSchema({ $id: 'pipong', components: contract.components });
    expect(
      v.parse(
        v.object({ operationId: v.string() }),
        contract.paths[
          '/api/v1/organizations/{organizationId}/projects/{projectId}/environments/{environmentId}/notifications'
        ]?.post,
      ).operationId,
    ).toBe('submitNotification');
    expect(ajv.getSchema('pipong#/components/schemas/NotificationRequest')).toBeTypeOf('function');
    for (const [resource, identifier, operation, status] of [
      ['notifications', 'notificationId', 'cancelNotification', '200'],
      ['deliveries', 'deliveryId', 'redriveDelivery', '202'],
    ] as const) {
      const recoveryPath = `/api/v1/organizations/{organizationId}/projects/{projectId}/environments/{environmentId}/${resource}/{${identifier}}/${status === '200' ? 'cancel' : 'redrive'}`;
      const recoveryOperation = v.parse(
        v.object({
          operationId: v.string(),
          responses: v.record(
            v.string(),
            v.object({ content: v.record(v.string(), v.object({ schema: v.looseObject({}) })) }),
          ),
        }),
        contract.paths[recoveryPath]?.post,
      );
      expect(recoveryOperation.operationId).toBe(operation);
      const schema = recoveryOperation.responses[status]?.content['application/json']?.schema;
      expect(schema).toBeDefined();
      ajv.addSchema({ ...schema, $id: operation });
    }
  }, 60_000);

  beforeEach(async () => {
    await fixture.database
      .query(`DELETE FROM pgboss.job WHERE name LIKE 'delivery-%'; DELETE FROM app.idempotency_records; DELETE FROM app.delivery_redrives; DELETE FROM app.deliveries; DELETE FROM app.notifications;
      DELETE FROM app.admission_reservations; DELETE FROM app.key_budgets; DELETE FROM app.tenant_budgets;
      DELETE FROM app.delivery_events; DELETE FROM app.event_streams; DELETE FROM app.endpoint_generations; DELETE FROM app.endpoints; DELETE FROM app.credential_versions;
      DELETE FROM app.recipients; DELETE FROM auth.service_key_audits; DELETE FROM auth.service_key_grants; DELETE FROM auth.api_keys; DELETE FROM app.environments; DELETE FROM app.projects; DELETE FROM auth.members; DELETE FROM auth.rate_limits`);
    await fixture.database.query(
      "INSERT INTO auth.members (id,organization_id,user_id,role) VALUES ($1,$2,$1,'owner')",
      [userId, organizationId],
    );
    await fixture.database.query(
      "INSERT INTO app.projects (id,organization_id,name) VALUES ($1,$2,'Project')",
      [projectId, organizationId],
    );
    await fixture.database.query(
      "INSERT INTO app.environments (id,organization_id,project_id,name) VALUES ($1,$2,$3,'Production'),($4,$2,$3,'Sibling')",
      [environmentId, organizationId, projectId, siblingId],
    );
    await fixture.database.query(
      "INSERT INTO app.recipients (id,organization_id,project_id,environment_id,external_id) VALUES ($1,$2,$3,$4,'customer')",
      [recipientId, organizationId, projectId, environmentId],
    );
    await fixture.database.query(
      "INSERT INTO app.credential_versions (id,organization_id,project_id,environment_id,provider,app_id,encrypted_secret,state) VALUES ($1,$2,$3,$4,'fcm','test-project','fixture-not-read','active')",
      [credentialId, organizationId, projectId, environmentId],
    );
    const target = encryptSecret(
      {
        activeKeyId: 'first',
        keys: new Map([['first', createSecretKey(Buffer.from('11'.repeat(32), 'hex'))]]),
      },
      {
        ...scope,
        resourceId: endpointId,
        purpose: 'endpoint',
        binding: JSON.stringify([recipientId, 'fcm', 'test-project', 'phone', 1, credentialId]),
      },
      JSON.stringify({ kind: 'registration-token', value: 'test-registration-token' }),
    );
    await fixture.database.query('BEGIN');
    try {
      await fixture.database.query(
        "INSERT INTO app.endpoints (id,organization_id,project_id,environment_id,recipient_id,installation_id,provider,app_id,generation,credential_id,target_hash) VALUES ($1,$2,$3,$4,$5,'phone','fcm','test-project',1,$6,'fixture-hash')",
        [endpointId, organizationId, projectId, environmentId, recipientId, credentialId],
      );
      await fixture.database.query(
        'INSERT INTO app.endpoint_generations (organization_id,project_id,environment_id,endpoint_id,generation,credential_id,encrypted_target,registered_at) VALUES ($1,$2,$3,$4,1,$5,$6,now())',
        [organizationId, projectId, environmentId, endpointId, credentialId, target],
      );
      await fixture.database.query('COMMIT');
    } catch (error) {
      await fixture.database.query('ROLLBACK');
      throw error;
    }
    body = JSON.stringify({
      targets: { kind: 'recipients', ids: [recipientId, recipientId] },
      content: { data: { second: '2', first: '1' } },
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      overrides: { fcm: { priority: 'HIGH' } },
    });
    expect(
      ajv.validate({ $ref: 'pipong#/components/schemas/NotificationRequest' }, JSON.parse(body)),
      JSON.stringify(ajv.errors),
    ).toBe(true);
  });

  afterAll(async () => {
    await fixture?.close();
  });

  it('races duplicates into one immutable acceptance and replays canonical requests after target changes', async () => {
    const originalExpiry = v.parse(v.object({ expiresAt: v.string() }), JSON.parse(body)).expiresAt;
    const shortExpiry = new Date(Date.now() + 3000).toISOString();
    body = body.replace(originalExpiry, shortExpiry);
    const responses = await Promise.all(Array.from({ length: 8 }, () => request()));
    const results = await Promise.all(responses.map(accepted));
    for (const result of results) {
      expect(result).toEqual(results[0]);
    }
    expect(results[0]?.deliveryCount).toBe(1);
    await cardinality(1);
    await fixture.database.query("UPDATE app.endpoints SET state='disabled',disabled_at=now()");
    const parsed = v.parse(v.object({ expiresAt: v.string() }), JSON.parse(body));
    await setTimeout(Math.max(0, Date.parse(shortExpiry) - Date.now() + 10));
    const canonical = JSON.stringify({
      overrides: { fcm: { priority: 'HIGH' } },
      expiresAt: parsed.expiresAt,
      content: { data: { first: '1', second: '2' } },
      targets: { ids: [recipientId], kind: 'recipients' },
    });
    expect(await accepted(await request('same-key', canonical))).toEqual(results[0]);
    await fixture.database.query(
      "UPDATE app.idempotency_records SET expires_at=now()-interval '1 second'",
    );
    await denied(await request(), 422, 'NOTIFICATION_EXPIRY_INVALID');
    await fixture.database.query("UPDATE app.endpoints SET state='active',disabled_at=null");
    body = body.replace(shortExpiry, new Date(Date.now() + 3600000).toISOString());
    expect((await accepted(await request())).notificationId).not.toBe(results[0]?.notificationId);
    await cardinality(2);
    const jobs = await fixture.database.query<{ data: Record<string, string> }>(
      "SELECT data FROM pgboss.job WHERE name='delivery-fcm'",
    );
    expect(Object.keys(jobs.rows[0]?.data ?? {}).toSorted()).toEqual([
      'deliveryId',
      'environmentId',
      'notificationId',
      'organizationId',
      'projectId',
      'provider',
    ]);
  });

  it('rejects conflicting fingerprints, invalid boundaries, empty targets, and final provider size without work', async () => {
    const original = await accepted(await request());
    await denied(
      await request('same-key', body.replace('"first":"1"', '"first":"changed"')),
      409,
      'idempotency_conflict',
    );
    expect(await accepted(await request())).toEqual(original);
    await denied(await request(''), 422, 'NOTIFICATION_IDEMPOTENCY_KEY_INVALID');
    await denied(await request('bad-body', '{}'), 422, 'NOTIFICATION_INVALID');
    await denied(await request('too-large', ' '.repeat(65537)), 413, 'NOTIFICATION_BODY_TOO_LARGE');
    await denied(
      await request('foreign-target', body.replaceAll(recipientId, siblingId)),
      422,
      'NOTIFICATION_NO_TARGETS',
    );
    await denied(
      await request('payload-size', body.replace('"first":"1"', `"first":"${'x'.repeat(4096)}"`)),
      422,
      'NOTIFICATION_PAYLOAD_TOO_LARGE',
    );
    const parsed = v.parse(v.object({ expiresAt: v.string() }), JSON.parse(body));
    await denied(
      await request(
        'expired',
        body.replace(parsed.expiresAt, new Date(Date.now() - 1000).toISOString()),
      ),
      422,
      'NOTIFICATION_EXPIRY_INVALID',
    );
    await cardinality(1);
    await fixture.database.query('BEGIN');
    try {
      await fixture.database.query(
        `INSERT INTO app.endpoints (id,organization_id,project_id,environment_id,recipient_id,installation_id,provider,app_id,generation,credential_id,target_hash)
        SELECT uuidv7(),$1,$2,$3,$4,'expanded-'||index,'fcm','test-project',1,$5,'hash-'||index FROM generate_series(1,1000) AS index`,
        [organizationId, projectId, environmentId, recipientId, credentialId],
      );
      await fixture.database
        .query(`INSERT INTO app.endpoint_generations (organization_id,project_id,environment_id,endpoint_id,generation,credential_id,encrypted_target,registered_at)
        SELECT organization_id,project_id,environment_id,id,generation,credential_id,'fixture',now() FROM app.endpoints WHERE installation_id LIKE 'expanded-%'`);
      await fixture.database.query('COMMIT');
    } catch (error) {
      await fixture.database.query('ROLLBACK');
      throw error;
    }
    await denied(await request('expanded'), 422, 'NOTIFICATION_TARGET_LIMIT_EXCEEDED');
    await cardinality(1);
  });

  it('rolls back notifications, events, quota, and replay records when queue insertion fails', async () => {
    await fixture.database.query(
      "CREATE FUNCTION app.test_reject_enqueue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_ENQUEUE_FAILURE'; END $$; CREATE TRIGGER test_reject_enqueue BEFORE INSERT ON pgboss.job FOR EACH ROW EXECUTE FUNCTION app.test_reject_enqueue()",
    );
    try {
      await denied(await request(), 503, 'AUTHORIZATION_UNAVAILABLE');
      await cardinality(0);
      expect((await fixture.database.query('SELECT * FROM app.idempotency_records')).rowCount).toBe(
        0,
      );
      expect(
        (await fixture.database.query('SELECT * FROM app.admission_reservations')).rowCount,
      ).toBe(0);
    } finally {
      await fixture.database.query(
        'DROP TRIGGER test_reject_enqueue ON pgboss.job; DROP FUNCTION app.test_reject_enqueue()',
      );
    }
    await accepted(await request());
    await cardinality(1);
  });

  it('returns admission 429 with Retry-After and charges replay requests without extra delivery slots', async () => {
    await fixture.database.query(
      'INSERT INTO app.tenant_budgets (organization_id,request_limit,pending_limit,fanout_limit) VALUES ($1,3,1,10)',
      [organizationId],
    );
    const first = await accepted(await request());
    const pending = await request('new-key');
    await denied(pending, 429, 'ADMISSION_PENDING_LIMIT');
    expect(pending.headers.get('retry-after')).toBe('1');
    expect(await accepted(await request())).toEqual(first);
    const exhausted = await request();
    await denied(exhausted, 429, 'ADMISSION_REQUEST_LIMIT');
    expect(Number(exhausted.headers.get('retry-after'))).toBeGreaterThan(0);
    await cardinality(1);
  });

  it('checks nested scope, live permission, revocation, and environment RLS before replay', async () => {
    await denied(await request('unauthenticated', body, path, ''), 401, 'AUTH_CREDENTIALS_INVALID');
    await denied(
      await request('bad-scope', body, path.replace(projectId, siblingId)),
      404,
      'AUTH_SCOPE_NOT_FOUND',
    );
    await fixture.database.query("UPDATE auth.members SET role='member'");
    await denied(await request(), 403, 'AUTH_PERMISSION_DENIED');
    await fixture.database.query(
      "UPDATE auth.members SET role='owner'; UPDATE auth.users SET two_factor_enabled=true",
    );
    await fixture.database.query(
      'INSERT INTO auth.mfa_assurances (session_id,verified_at) SELECT id,now() FROM auth.sessions WHERE user_id=$1 ON CONFLICT DO NOTHING',
      [userId],
    );
    const issue = await fetch(
      `${fixture.baseUrl}${path.replace('/notifications', '/service-keys')}`,
      {
        method: 'POST',
        headers: { cookie, origin: fixture.baseUrl, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Send', actions: ['notification:send'], expiresIn: 3600 }),
      },
    );
    expect(issue.status).toBe(201);
    const key = v.parse(v.object({ key: v.string() }), await issue.json()).key;
    function keyRequest(): Promise<Response> {
      return fetch(`${fixture.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'content-type': 'application/json',
          'idempotency-key': 'service-key',
        },
        body,
      });
    }
    await accepted(await keyRequest());
    expect((await fixture.database.query('SELECT requests FROM app.key_budgets')).rows).toEqual([
      { requests: 1 },
    ]);
    await fixture.database.query('UPDATE auth.api_keys SET enabled=false');
    await denied(await keyRequest(), 401, 'AUTH_CREDENTIALS_INVALID');
    await fixture.database.query('DELETE FROM auth.members');
    await denied(await request('service-key'), 404, 'AUTH_SCOPE_NOT_FOUND');
    await cardinality(1);
    const policies = await fixture.database.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('app.notifications'::regclass,'app.deliveries'::regclass,'app.idempotency_records'::regclass) ORDER BY relname",
    );
    expect(policies.rows).toEqual([
      { relname: 'deliveries', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'idempotency_records', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'notifications', relrowsecurity: true, relforcerowsecurity: true },
    ]);
    const api = new Client({
      connectionString: v.parse(v.string(), fixture.environment.API_DATABASE_URL),
    });
    await api.connect();
    try {
      await api.query('BEGIN');
      await api.query(
        "SELECT set_config('pipong.organization_id',$1,true),set_config('pipong.project_id',$2,true),set_config('pipong.environment_id',$3,true)",
        [organizationId, projectId, siblingId],
      );
      expect((await api.query('SELECT * FROM app.notifications')).rows).toEqual([]);
      expect((await api.query('SELECT * FROM app.deliveries')).rows).toEqual([]);
      expect((await api.query('SELECT * FROM app.idempotency_records')).rows).toEqual([]);
      await api.query("SELECT set_config('pipong.environment_id',$1,true)", [environmentId]);
      expect((await api.query('SELECT generation FROM app.deliveries')).rows).toEqual([
        { generation: 1 },
      ]);
      await expect(api.query("UPDATE app.notifications SET request='{}'")).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await api.query('ROLLBACK');
      await api.end();
    }
  });

  it('cancels queued deliveries through scoped HTTP and permits repeat cancellation', async () => {
    const original = await accepted(await request());
    const cancelPath = `${path}/${original.notificationId}/cancel`;
    await denied(await request('cancel', '{}', cancelPath, ''), 401, 'AUTH_CREDENTIALS_INVALID');
    await fixture.database.query("UPDATE auth.members SET role='member'");
    await denied(await request('cancel', '{}', cancelPath), 403, 'AUTH_PERMISSION_DENIED');
    await fixture.database.query("UPDATE auth.members SET role='owner'");
    await denied(
      await request('cancel', '{}', cancelPath.replace(environmentId, siblingId)),
      404,
      'NOTIFICATION_NOT_FOUND',
    );
    const canceled = await request('cancel', '{}', cancelPath);
    expect(canceled.status).toBe(200);
    expect(canceled.headers.get('cache-control')).toBe('no-store');
    const cancellation = v.parse(
      v.strictObject({ notificationId: v.string(), canceledCount: v.number() }),
      await canceled.json(),
    );
    expect(cancellation).toEqual({ notificationId: original.notificationId, canceledCount: 1 });
    expect(ajv.validate('cancelNotification', cancellation), JSON.stringify(ajv.errors)).toBe(true);
    expect((await fixture.database.query('SELECT state FROM app.deliveries')).rows).toEqual([
      { state: 'canceled' },
    ]);
    const repeated = await request('cancel', '{}', cancelPath);
    expect(repeated.status).toBe(200);
    expect(
      v.parse(v.object({ canceledCount: v.number() }), await repeated.json()).canceledCount,
    ).toBe(0);
    expect((await fixture.database.query('SELECT pending FROM app.tenant_budgets')).rows).toEqual([
      { pending: 0 },
    ]);
  });

  it('redrives a terminal delivery with recent MFA, fresh IDs, and bounded input', async () => {
    const original = await accepted(await request());
    const delivery = (await fixture.database.query<{ id: string }>('SELECT id FROM app.deliveries'))
      .rows[0];
    expect(delivery).toBeDefined();
    const deliveryId = v.parse(v.string(), delivery?.id);
    const redrivePath = `${path.replace('/notifications', '/deliveries')}/${deliveryId}/redrive`;
    const input = JSON.stringify({
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      reason: 'Provider outage resolved',
    });
    await fixture.database.query(
      'DELETE FROM auth.mfa_assurances; UPDATE auth.users SET two_factor_enabled=true',
    );
    await denied(await request('redrive', input, redrivePath), 403, 'AUTH_RECENT_MFA_REQUIRED');
    await fixture.database.query(
      'INSERT INTO auth.mfa_assurances (session_id,verified_at) SELECT id,now() FROM auth.sessions WHERE user_id=$1 ON CONFLICT DO NOTHING',
      [userId],
    );
    await denied(await request('redrive', '{}', redrivePath), 422, 'DELIVERY_REDRIVE_INVALID');
    await denied(
      await request('redrive', input, redrivePath),
      409,
      'DELIVERY_REDRIVE_NOT_TERMINAL',
    );
    await denied(
      await request(
        'redrive',
        input.replace('Provider outage resolved', 'x'.repeat(501)),
        redrivePath,
      ),
      422,
      'DELIVERY_REDRIVE_INVALID',
    );
    await denied(
      await request('redrive', ' '.repeat(4097), redrivePath),
      413,
      'RESOURCE_BODY_TOO_LARGE',
    );
    expect(
      (await request('cancel', '{}', `${path}/${original.notificationId}/cancel`)).status,
    ).toBe(200);
    await denied(
      await request(
        'redrive',
        JSON.stringify({ expiresAt: new Date(Date.now() - 1000).toISOString(), reason: 'Retry' }),
        redrivePath,
      ),
      409,
      'DELIVERY_REDRIVE_EXPIRY_INVALID',
    );
    await denied(
      await request('redrive', input, redrivePath.replace(environmentId, siblingId)),
      404,
      'DELIVERY_NOT_FOUND',
    );
    const response = await request('redrive', input, redrivePath);
    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const redriven = v.parse(
      v.strictObject({
        notificationId: v.pipe(v.string(), v.uuid()),
        deliveryId: v.pipe(v.string(), v.uuid()),
        sourceDeliveryId: v.pipe(v.string(), v.uuid()),
      }),
      await response.json(),
    );
    expect(ajv.validate('redriveDelivery', redriven), JSON.stringify(ajv.errors)).toBe(true);
    expect(redriven.notificationId).not.toBe(original.notificationId);
    expect(redriven.deliveryId).not.toBe(deliveryId);
    expect(redriven.sourceDeliveryId).toBe(deliveryId);
    expect(
      (await fixture.database.query('SELECT actor_id,reason FROM app.delivery_redrives')).rows,
    ).toEqual([{ actor_id: userId, reason: 'Provider outage resolved' }]);
    await denied(await request('redrive', input, redrivePath), 409, 'DELIVERY_ALREADY_REDRIVEN');
    expect(
      (await fixture.database.query('SELECT state FROM app.deliveries ORDER BY id')).rows,
    ).toEqual([{ state: 'canceled' }, { state: 'queued' }]);
    expect(
      (
        await fixture.database.query(
          'SELECT source_delivery_id FROM app.delivery_redrives WHERE delivery_id=$1',
          [redriven.deliveryId],
        )
      ).rows,
    ).toEqual([{ source_delivery_id: deliveryId }]);
  });
});
