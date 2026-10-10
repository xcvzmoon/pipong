import type { AuthFixture } from './fixtures/auth-runtime.ts';
import addFormats from 'ajv-formats';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { execFile } from 'node:child_process';
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
const siblingId = '019a0000-0000-7000-8000-000000000122';
const recipientId = '019a0000-0000-7000-8000-000000000131';
const credentialId = '019a0000-0000-7000-8000-000000000151';
const notificationId = '019a0000-0000-7000-8000-000000000161';
const secondNotificationId = '019a0000-0000-7000-8000-000000000162';
const firstEndpointId = '019a0000-0000-7000-8000-000000000171';
const secondEndpointId = '019a0000-0000-7000-8000-000000000172';
const firstDeliveryId = '019a0000-0000-7000-8000-000000000181';
const secondDeliveryId = '019a0000-0000-7000-8000-000000000182';
const jobId = '019a0000-0000-7000-8000-000000000191';
const basePath = `/api/v1/organizations/${organizationId}/projects/${projectId}/environments/${environmentId}`;
const notificationPath = `${basePath}/notifications/${notificationId}`;
const problemSchema = v.object({ status: v.number(), code: v.string() });

async function denied(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toContain('application/problem+json');
  expect(v.parse(problemSchema, await response.json()).code).toBe(code);
}

describe.skipIf(!testUrl)('authoritative notification observation through built HTTP', () => {
  let fixture: AuthFixture;
  let cookie: string;
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  ajv.addKeyword({ keyword: 'components', valid: true });

  function request(path: string, credentials = cookie): Promise<Response> {
    return fetch(`${fixture.baseUrl}${path}`, { headers: { cookie: credentials } });
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
      "INSERT INTO auth.organizations (id,name,slug) VALUES ($1,'First','first')",
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
      v.object({ components: v.object({ schemas: v.record(v.string(), v.looseObject({})) }) }),
      await (await fetch(`${fixture.baseUrl}/_openapi.json`)).json(),
    );
    ajv.addSchema({ $id: 'pipong', components: contract.components });
  }, 60_000);

  beforeEach(async () => {
    await fixture.database.query('BEGIN; SET CONSTRAINTS ALL DEFERRED');
    await fixture.database
      .query(`DELETE FROM auth.service_key_audits; DELETE FROM auth.service_key_grants; DELETE FROM auth.api_keys; DELETE FROM auth.mfa_assurances; DELETE FROM app.delivery_attempts; DELETE FROM app.deliveries; DELETE FROM app.notifications;
      DELETE FROM app.endpoint_generations; DELETE FROM app.endpoints; DELETE FROM app.credential_versions;
      DELETE FROM app.recipients; DELETE FROM app.environments; DELETE FROM app.projects; DELETE FROM auth.members; DELETE FROM auth.rate_limits`);
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
      "INSERT INTO app.credential_versions (id,organization_id,project_id,environment_id,provider,app_id,encrypted_secret,state) VALUES ($1,$2,$3,$4,'fcm','test-project','credential-secret-sentinel','active')",
      [credentialId, organizationId, projectId, environmentId],
    );
    await fixture.database.query(
      "INSERT INTO app.endpoints (id,organization_id,project_id,environment_id,recipient_id,installation_id,provider,app_id,generation,credential_id,target_hash) VALUES ($1,$2,$3,$4,$5,'first','fcm','test-project',1,$7,'first-hash'),($6,$2,$3,$4,$5,'second','fcm','test-project',1,$7,'second-hash')",
      [
        firstEndpointId,
        organizationId,
        projectId,
        environmentId,
        recipientId,
        secondEndpointId,
        credentialId,
      ],
    );
    await fixture.database.query(
      "INSERT INTO app.endpoint_generations (organization_id,project_id,environment_id,endpoint_id,generation,credential_id,encrypted_target,registered_at) VALUES ($1,$2,$3,$4,1,$6,'target-token-sentinel',now()),($1,$2,$3,$5,1,$6,'target-token-sentinel',now())",
      [organizationId, projectId, environmentId, firstEndpointId, secondEndpointId, credentialId],
    );
    await fixture.database.query(
      "INSERT INTO app.notifications (id,organization_id,project_id,environment_id,request,expires_at,delivery_count) VALUES ($1,$2,$3,$4,'{\"payload\":\"payload-sentinel\"}',now()+interval '1 hour',2),($5,$2,$3,$4,'{}',now()+interval '1 hour',1)",
      [notificationId, organizationId, projectId, environmentId, secondNotificationId],
    );
    await fixture.database.query(
      "INSERT INTO app.deliveries (id,organization_id,project_id,environment_id,notification_id,endpoint_id,generation,credential_id,provider,state) VALUES ($1,$2,$3,$4,$5,$7,1,$9,'fcm','failed'),($6,$2,$3,$4,$5,$8,1,$9,'fcm','queued')",
      [
        firstDeliveryId,
        organizationId,
        projectId,
        environmentId,
        notificationId,
        secondDeliveryId,
        firstEndpointId,
        secondEndpointId,
        credentialId,
      ],
    );
    await fixture.database.query(
      "INSERT INTO app.delivery_attempts (organization_id,project_id,environment_id,delivery_id,generation,job_id,retry_count,started_at,finished_at,outcome,code,provider_response) VALUES ($1,$2,$3,$4,1,$5,0,now()-interval '1 second',now(),'permanent','code-sentinel','receipt-sentinel')",
      [organizationId, projectId, environmentId, firstDeliveryId, jobId],
    );
    await fixture.database.query('COMMIT');
  });

  afterAll(async () => {
    await fixture?.close();
  }, 30_000);

  it('counts persisted provider authentication codes in diagnostics', async () => {
    for (const code of ['FCM_AUTH_FAILED', 'WEB_PUSH_HTTP_401', 'WEB_PUSH_HTTP_403']) {
      // oxlint-disable eslint/no-await-in-loop -- Each diagnostic read must observe the preceding committed outcome.
      await fixture.database.query('UPDATE app.delivery_attempts SET code=$1', [code]);
      const result = await fixture.database.query(
        'SELECT app.runtime_diagnostics() AS diagnostics',
      );
      const diagnostics = v.parse(
        v.object({ diagnostics: v.object({ credentialFailures: v.number() }) }),
        result.rows[0],
      );
      expect(diagnostics.diagnostics.credentialFailures).toBe(1);
      // oxlint-enable eslint/no-await-in-loop
    }
  });

  it('returns one-snapshot notification counts and scope-bound cursor pages', async () => {
    const list = await request(`${basePath}/notifications?limit=1`);
    expect(list.status).toBe(200);
    expect(list.headers.get('cache-control')).toBe('no-store');
    const firstPage = v.parse(
      v.strictObject({
        items: v.array(
          v.strictObject({
            id: v.string(),
            acceptedAt: v.string(),
            expiresAt: v.string(),
            canceledAt: v.nullable(v.string()),
            deliveryCount: v.number(),
            counts: v.strictObject({
              pending: v.number(),
              providerAccepted: v.number(),
              failed: v.number(),
              expired: v.number(),
              canceled: v.number(),
            }),
            providerAcceptance: v.strictObject({
              apns: v.number(),
              fcm: v.number(),
              webPush: v.number(),
            }),
          }),
        ),
        nextCursor: v.nullable(v.string()),
      }),
      await list.json(),
    );
    expect(
      ajv.validate({ $ref: 'pipong#/components/schemas/NotificationPage' }, firstPage),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    const summary = v.parse(
      v.looseObject({ id: v.string() }),
      await (await request(notificationPath)).json(),
    );
    expect(
      ajv.validate({ $ref: 'pipong#/components/schemas/NotificationSummary' }, summary),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0]).toMatchObject({
      id: notificationId,
      deliveryCount: 2,
      counts: { pending: 1, failed: 1 },
    });
    expect(firstPage.nextCursor).not.toBeNull();
    await fixture.database.query(
      "UPDATE app.deliveries SET state=CASE WHEN id=$1 THEN 'provider_accepted' ELSE 'canceled' END WHERE notification_id=$2",
      [firstDeliveryId, notificationId],
    );
    const accepted = v.parse(
      v.object({
        counts: v.record(v.string(), v.number()),
        providerAcceptance: v.record(v.string(), v.number()),
      }),
      await (await request(notificationPath)).json(),
    );
    expect(accepted.counts).toEqual({
      pending: 0,
      providerAccepted: 1,
      failed: 0,
      expired: 0,
      canceled: 1,
    });
    expect(accepted.providerAcceptance).toEqual({ apns: 0, fcm: 1, webPush: 0 });
    await fixture.database.query(
      "UPDATE app.deliveries SET state=CASE WHEN id=$1 THEN 'expired' ELSE 'retry_wait' END WHERE notification_id=$2",
      [firstDeliveryId, notificationId],
    );
    const expired = v.parse(
      v.object({ counts: v.record(v.string(), v.number()) }),
      await (await request(notificationPath)).json(),
    );
    expect(expired.counts).toEqual({
      pending: 1,
      providerAccepted: 0,
      failed: 0,
      expired: 1,
      canceled: 0,
    });

    const secondPage = v.parse(
      v.object({
        items: v.array(v.object({ id: v.string() })),
        nextCursor: v.nullable(v.string()),
      }),
      await (
        await request(`${basePath}/notifications?limit=1&cursor=${firstPage.nextCursor}`)
      ).json(),
    );
    expect(secondPage.items.map((item) => item.id)).toEqual([secondNotificationId]);
    await denied(
      await request(`${basePath}/notifications?limit=1&cursor=${firstPage.nextCursor}`, ''),
      401,
      'AUTH_CREDENTIALS_INVALID',
    );
    await denied(await request(`${basePath}/notifications?limit=0`), 422, 'RESOURCE_INPUT_INVALID');
    await denied(
      await request(
        `${basePath.replace(environmentId, siblingId)}/notifications/${notificationId}`,
      ),
      404,
      'NOTIFICATION_NOT_FOUND',
    );
  });

  it('pages deliveries and returns attempts without payload, token, job, code, or receipt fields', async () => {
    const firstResponse = await request(`${notificationPath}/deliveries?limit=1`);
    expect(firstResponse.status).toBe(200);
    const firstPage = v.parse(
      v.strictObject({
        items: v.array(v.strictObject({ id: v.string(), provider: v.string(), state: v.string() })),
        nextCursor: v.nullable(v.string()),
      }),
      await firstResponse.json(),
    );
    expect(
      ajv.validate({ $ref: 'pipong#/components/schemas/DeliveryStatusPage' }, firstPage),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    expect(firstPage.items).toEqual([{ id: firstDeliveryId, provider: 'fcm', state: 'failed' }]);
    expect(firstPage.nextCursor).not.toBeNull();
    await denied(
      await request(
        `${basePath}/notifications/${secondNotificationId}/deliveries?cursor=${firstPage.nextCursor}`,
      ),
      422,
      'RESOURCE_CURSOR_INVALID',
    );
    await denied(
      await request(`${notificationPath}/deliveries?limit=1&limit=2`),
      422,
      'RESOURCE_INPUT_INVALID',
    );
    const next = await request(`${notificationPath}/deliveries?cursor=${firstPage.nextCursor}`);
    expect(
      v.parse(v.object({ items: v.array(v.object({ id: v.string() })) }), await next.json()).items,
    ).toEqual([{ id: secondDeliveryId }]);

    const response = await request(`${basePath}/deliveries/${firstDeliveryId}`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(
      ajv.validate({ $ref: 'pipong#/components/schemas/DeliveryOutcome' }, JSON.parse(body)),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    expect(body).not.toContain(jobId);
    expect(body).not.toContain('payload-sentinel');
    expect(body).not.toContain('target-token-sentinel');
    expect(body).not.toContain('credential-secret-sentinel');
    expect(body).not.toContain('code-sentinel');
    expect(body).not.toContain('receipt-sentinel');
    expect(
      v.parse(
        v.strictObject({
          id: v.string(),
          provider: v.string(),
          state: v.string(),
          attempts: v.array(
            v.strictObject({
              generation: v.number(),
              retryCount: v.number(),
              startedAt: v.string(),
              finishedAt: v.nullable(v.string()),
              outcome: v.nullable(v.string()),
            }),
          ),
        }),
        JSON.parse(body),
      ),
    ).toMatchObject({ id: firstDeliveryId, attempts: [{ generation: 1, outcome: 'permanent' }] });
    await denied(
      await request(`${basePath.replace(environmentId, siblingId)}/deliveries/${firstDeliveryId}`),
      404,
      'DELIVERY_NOT_FOUND',
    );
  });
  it('keeps delivery state and attempt results consistent during concurrent atomic changes', async () => {
    const writer = new Client({
      connectionString: fixture.environment.API_DATABASE_URL?.replace('pipong_api', 'postgres'),
    });
    await writer.connect();
    const shutdown = new AbortController();
    async function write(): Promise<void> {
      // oxlint-disable eslint/no-await-in-loop -- Alternate atomic fixture states while actual HTTP reads run concurrently.
      while (!shutdown.signal.aborted) {
        await writer.query('BEGIN');
        await writer.query("UPDATE app.deliveries SET state='sending' WHERE id=$1", [
          firstDeliveryId,
        ]);
        await writer.query(
          'UPDATE app.delivery_attempts SET finished_at=NULL,outcome=NULL,code=NULL WHERE delivery_id=$1',
          [firstDeliveryId],
        );
        await writer.query('COMMIT');
        await writer.query('BEGIN');
        await writer.query("UPDATE app.deliveries SET state='provider_accepted' WHERE id=$1", [
          firstDeliveryId,
        ]);
        await writer.query(
          "UPDATE app.delivery_attempts SET finished_at=now(),outcome='accepted',code='ACCEPTED' WHERE delivery_id=$1",
          [firstDeliveryId],
        );
        await writer.query('COMMIT');
      }
      // oxlint-enable eslint/no-await-in-loop
    }
    const writing = write();
    try {
      // oxlint-disable eslint/no-await-in-loop -- Sample responses during simultaneous commits through a separate connection.
      for (let index = 0; index < 50; index++) {
        const result = v.parse(
          v.object({
            state: v.string(),
            attempts: v.array(v.object({ outcome: v.nullable(v.string()) })),
          }),
          await (await request(`${basePath}/deliveries/${firstDeliveryId}`)).json(),
        );
        const expected =
          result.state === 'sending' ? null : result.state === 'failed' ? 'permanent' : 'accepted';
        expect(result.attempts[0]?.outcome).toBe(expected);
      }
      // oxlint-enable eslint/no-await-in-loop
    } finally {
      shutdown.abort();
      await writing;
      await writer.end();
    }
  });
  it('checks each operation against live key permissions and membership', async () => {
    await fixture.database.query('UPDATE auth.users SET two_factor_enabled=true');
    await fixture.database.query(
      'INSERT INTO auth.mfa_assurances (session_id,verified_at) SELECT id,now() FROM auth.sessions WHERE user_id=$1',
      [userId],
    );
    async function issue(actions: string[]): Promise<string> {
      const response = await fetch(`${fixture.baseUrl}${basePath}/service-keys`, {
        method: 'POST',
        headers: { cookie, origin: fixture.baseUrl, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Observation', actions, expiresIn: 3600 }),
      });
      expect(response.status).toBe(201);
      return v.parse(v.object({ key: v.string() }), await response.json()).key;
    }
    const deniedKey = await issue(['event:read']);
    const allowedKey = await issue(['notification:read', 'delivery:read']);
    const paths = [
      `${basePath}/notifications`,
      notificationPath,
      `${notificationPath}/deliveries`,
      `${basePath}/deliveries/${firstDeliveryId}`,
    ];
    // oxlint-disable eslint/no-await-in-loop -- Verify every concrete status operation against the same issued grants.
    for (const path of paths) {
      await denied(
        await fetch(`${fixture.baseUrl}${path}`, { headers: { 'x-api-key': deniedKey } }),
        403,
        'AUTH_PERMISSION_DENIED',
      );
      expect(
        (await fetch(`${fixture.baseUrl}${path}`, { headers: { 'x-api-key': allowedKey } })).status,
      ).toBe(200);
    }
    await fixture.database.query('UPDATE auth.api_keys SET enabled=false');
    for (const path of paths) {
      await denied(
        await fetch(`${fixture.baseUrl}${path}`, { headers: { 'x-api-key': allowedKey } }),
        401,
        'AUTH_CREDENTIALS_INVALID',
      );
    }
    await fixture.database.query('DELETE FROM auth.members');
    for (const path of paths) {
      await denied(await request(path), 404, 'AUTH_SCOPE_NOT_FOUND');
    }
    // oxlint-enable eslint/no-await-in-loop
  });
  it('enforces attempt RLS and API write denial independently of HTTP', async () => {
    const script = `
      import assert from 'node:assert/strict';
      const { useApiDb } = await import(${JSON.stringify(new URL('../../../packages/database/src/index.ts', import.meta.url).href)});
      const { withTenantTransaction } = await import(${JSON.stringify(new URL('../../../packages/database/src/tenancy/index.ts', import.meta.url).href)});
      const { readDeliveryOutcome } = await import(${JSON.stringify(new URL('../../../packages/database/src/observation.ts', import.meta.url).href)});
      const { sql } = await import(${JSON.stringify(new URL('../../../packages/database/node_modules/drizzle-orm/index.js', import.meta.url).href)});
      const api = await useApiDb();
      const scope = ${JSON.stringify({ kind: 'environment', organizationId, projectId, environmentId })};
      try {
        const valid = await withTenantTransaction(api, scope, transaction => readDeliveryOutcome(transaction, scope, '${firstDeliveryId}'));
        assert.equal(valid.attempts.length, 1);
        const foreign = { ...scope, environmentId: '${siblingId}' };
        assert.equal(await withTenantTransaction(api, foreign, transaction => readDeliveryOutcome(transaction, scope, '${firstDeliveryId}')), undefined);
        const hidden = await withTenantTransaction(api, foreign, transaction => transaction.execute(sql\`SELECT generation FROM app.delivery_attempts WHERE delivery_id='${firstDeliveryId}'\`));
        assert.equal(hidden.rows.length, 0);
        await assert.rejects(withTenantTransaction(api, scope, transaction => transaction.execute(sql\`UPDATE app.delivery_attempts SET outcome='accepted'\`)), error => error.cause?.code === '42501');
      } finally { await api.close(); }
    `;
    await runCommand(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root,
      env: fixture.environment,
    });
  });
});
