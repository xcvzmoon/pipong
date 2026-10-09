import type { AuthFixture } from './fixtures/auth-runtime.ts';
import addFormats from 'ajv-formats';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
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
const eventsPath = `/api/v1/organizations/${organizationId}/projects/${projectId}/environments/${environmentId}/events`;
const eventSchema = v.strictObject({
  id: v.string(),
  notificationId: v.string(),
  deliveryId: v.string(),
  state: v.string(),
  createdAt: v.string(),
});
const pageSchema = v.strictObject({
  items: v.array(eventSchema),
  nextCursor: v.string(),
  watermark: v.string(),
  hasMore: v.boolean(),
});
const problemSchema = v.object({ status: v.number(), code: v.string() });

async function denied(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toContain('application/problem+json');
  expect(v.parse(problemSchema, await response.json()).code).toBe(code);
}

describe.skipIf(!testUrl)('commit-ordered event replay through built HTTP', () => {
  let fixture: AuthFixture;
  let cookie: string;
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  ajv.addKeyword({ keyword: 'components', valid: true });

  function request(query = '', path = eventsPath): Promise<Response> {
    return fetch(`${fixture.baseUrl}${path}${query}`, { headers: { cookie } });
  }

  async function page(response: Response): Promise<v.InferOutput<typeof pageSchema>> {
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const result = v.parse(pageSchema, await response.json());
    expect(
      ajv.validate({ $ref: 'pipong#/components/schemas/EventPage' }, result),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    return result;
  }

  async function runWorker(body: string): Promise<void> {
    const script = `
      import assert from 'node:assert/strict';
      import { sql } from ${JSON.stringify(new URL('../../../packages/database/node_modules/drizzle-orm/index.js', import.meta.url).href)};
      const { useWorkerDb } = await import(${JSON.stringify(new URL('../../../packages/database/src/index.ts', import.meta.url).href)});
      const { withTenantTransaction } = await import(${JSON.stringify(new URL('../../../packages/database/src/tenancy/index.ts', import.meta.url).href)});
      const { recordDeliveryEvent } = await import(${JSON.stringify(new URL('../../../packages/service/src/events.ts', import.meta.url).href)});
      const { pruneDeliveryEvents } = await import(${JSON.stringify(new URL('../../../packages/database/src/events.ts', import.meta.url).href)});
      const runtime = await useWorkerDb();
      const scope = ${JSON.stringify({ kind: 'environment', organizationId, projectId, environmentId })};
      const input = { notificationId: '${projectId}', deliveryId: '${environmentId}', state: 'queued' };
      try { ${body} } finally { await runtime.close(); }
    `;
    await runCommand(process.execPath, ['--input-type=module', '-e', script], {
      env: fixture.environment,
      cwd: root,
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
      v.object({
        components: v.object({ schemas: v.record(v.string(), v.looseObject({})) }),
        paths: v.record(v.string(), v.looseObject({})),
      }),
      await (await fetch(`${fixture.baseUrl}/_openapi.json`)).json(),
    );
    ajv.addSchema({ $id: 'pipong', components: contract.components });
    const path =
      '/api/v1/organizations/{organizationId}/projects/{projectId}/environments/{environmentId}/events';
    expect(
      v.parse(v.object({ operationId: v.string() }), contract.paths[path]?.get).operationId,
    ).toBe('replayDeliveryEvents');
  }, 60_000);

  beforeEach(async () => {
    await fixture.database.query(
      'DELETE FROM auth.service_key_audits; DELETE FROM auth.service_key_grants; DELETE FROM auth.api_keys; DELETE FROM auth.mfa_assurances; DELETE FROM app.delivery_events; DELETE FROM app.event_streams; DELETE FROM app.environments; DELETE FROM app.projects; DELETE FROM auth.members; DELETE FROM auth.rate_limits',
    );
    await fixture.database.query(
      "INSERT INTO auth.members (id,organization_id,user_id,role) VALUES ($1,$2,$1,'member')",
      [userId, organizationId],
    );
    await fixture.database.query(
      "INSERT INTO app.projects (id,organization_id,name) VALUES ($1,$2,'First')",
      [projectId, organizationId],
    );
    await fixture.database.query(
      "INSERT INTO app.environments (id,organization_id,project_id,name) VALUES ($1,$2,$3,'Production'),($4,$2,$3,'Development')",
      [environmentId, organizationId, projectId, siblingId],
    );
  });

  afterAll(async () => {
    await fixture?.close();
  });

  it('blocks a later writer until the earlier transaction commits, then replays both from another process', async () => {
    await runWorker(`
      let releaseFirst;
      let firstReady;
      const gate = new Promise(resolve => { releaseFirst = resolve; });
      const ready = new Promise(resolve => { firstReady = resolve; });
      const first = withTenantTransaction(runtime, scope, async transaction => {
        const event = await recordDeliveryEvent(transaction, scope, input);
        firstReady();
        await gate;
        return event;
      });
      await ready;
      const observer = await useWorkerDb();
      let secondCommitted = false;
      const second = withTenantTransaction(runtime, scope, transaction => recordDeliveryEvent(transaction, scope, { ...input, state: 'sending' })).then(event => { secondCommitted = true; return event; });
      try {
        const deadline = Date.now() + 5000;
        let waiting = false;
        while (Date.now() < deadline) {
          const result = await observer.pool.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE usename='pipong_worker' AND wait_event_type='Lock'");
          if (result.rows[0].count > 0) { waiting = true; break; }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(waiting, true);
        assert.equal(secondCommitted, false);
      } finally { releaseFirst(); await observer.close(); }
      const [a, b] = await Promise.all([first, second]);
      assert.notEqual(a.id, b.id);
    `);
    const first = await page(await request('?limit=1'));
    expect(first.items.map(({ state }) => state)).toEqual(['queued']);
    expect(first.hasMore).toBe(true);
    const second = await page(await request(`?cursor=${first.nextCursor}`));
    expect(second.items.map(({ state }) => state)).toEqual(['sending']);
    expect(second.hasMore).toBe(false);
  }, 15_000);

  it('rolls back state and event together without consuming a sequence', async () => {
    await runWorker(`
      await assert.rejects(withTenantTransaction(runtime, scope, async transaction => {
        await transaction.execute(sql\`UPDATE app.environments SET name='Rolled back' WHERE id=\${scope.environmentId}::uuid\`);
        await recordDeliveryEvent(transaction, scope, input);
        throw new Error('TEST_ROLLBACK');
      }), /TEST_ROLLBACK/);
    `);
    expect((await page(await request())).items).toEqual([]);
    expect(
      (
        await fixture.database.query<{ name: string }>(
          'SELECT name FROM app.environments WHERE id=$1',
          [environmentId],
        )
      ).rows[0]?.name,
    ).toBe('Production');
    await runWorker(
      'await withTenantTransaction(runtime, scope, transaction => recordDeliveryEvent(transaction, scope, input));',
    );
    const result = await page(await request());
    expect(Buffer.from(result.nextCursor, 'base64url').toString().endsWith('.1')).toBe(true);
  });

  it('rejects wrong-stream, malformed, future, and invalid query cursors', async () => {
    const empty = await page(await request());
    await denied(
      await request(`?cursor=${empty.nextCursor}`, eventsPath.replace(environmentId, siblingId)),
      422,
      'event_cursor_invalid',
    );
    await denied(await request('?cursor=bad'), 422, 'event_cursor_invalid');
    const future = Buffer.from(`1.${organizationId}.${projectId}.${environmentId}.99`).toString(
      'base64url',
    );
    await denied(await request(`?cursor=${future}`), 422, 'event_cursor_invalid');
    await denied(await request('?limit=101'), 422, 'RESOURCE_INPUT_INVALID');
    await denied(await request('?limit=1&limit=2'), 422, 'RESOURCE_INPUT_INVALID');
  });

  it('expires pruned cursors, preserves the retained suffix, and permits duplicate replay', async () => {
    const before = await page(await request());
    await runWorker(`await withTenantTransaction(runtime, scope, async transaction => {
      await recordDeliveryEvent(transaction, scope, input);
      await recordDeliveryEvent(transaction, scope, { ...input, state: 'sending' });
    });`);
    const original = await page(await request());
    const repeated = await page(await request(`?cursor=${before.nextCursor}`));
    expect(repeated).toEqual(original);
    await fixture.database.query(
      "UPDATE app.delivery_events SET created_at=now()-interval '8 days' WHERE sequence=1",
    );
    await runWorker(
      'assert.equal(await withTenantTransaction(runtime, scope, transaction => pruneDeliveryEvents(transaction, scope)), 1n);',
    );
    await denied(await request(`?cursor=${before.nextCursor}`), 410, 'event_cursor_expired');
    const retained = await page(await request());
    expect(retained.items.map(({ state }) => state)).toEqual(['sending']);
    expect((await page(await request(`?cursor=${retained.watermark}`))).items).toEqual(
      retained.items,
    );
    await runWorker(
      'assert.equal(await withTenantTransaction(runtime, scope, transaction => pruneDeliveryEvents(transaction, scope)), 1n);',
    );
    expect((await page(await request())).watermark).toBe(retained.watermark);
  });

  it('checks live authority and nested scope and denies runtime mutation of event history', async () => {
    await denied(await fetch(`${fixture.baseUrl}${eventsPath}`), 401, 'AUTH_CREDENTIALS_INVALID');
    await denied(
      await request('', eventsPath.replace(projectId, siblingId)),
      404,
      'AUTH_SCOPE_NOT_FOUND',
    );
    await runWorker(`
      await withTenantTransaction(runtime, scope, transaction => recordDeliveryEvent(transaction, scope, input));
      await assert.rejects(withTenantTransaction(runtime, scope, transaction => transaction.execute(sql\`UPDATE app.delivery_events SET state='failed'\`)), error => error.cause?.code === '42501');
      const other = { ...scope, environmentId: '${siblingId}' };
      const { readDeliveryEvents } = await import(${JSON.stringify(new URL('../../../packages/database/src/events.ts', import.meta.url).href)});
      assert.equal((await withTenantTransaction(runtime, other, transaction => readDeliveryEvents(transaction, scope, undefined, 50))).items.length, 0);
    `);
    await fixture.database.query(
      "UPDATE auth.members SET role='owner'; UPDATE auth.users SET two_factor_enabled=true",
    );
    await fixture.database.query(
      'INSERT INTO auth.mfa_assurances (session_id,verified_at) SELECT id,now() FROM auth.sessions WHERE user_id=$1',
      [userId],
    );
    async function issueKey(actions: string[]): Promise<string> {
      const response = await fetch(
        `${fixture.baseUrl}${eventsPath.replace('/events', '/service-keys')}`,
        {
          method: 'POST',
          headers: { cookie, origin: fixture.baseUrl, 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Replay', actions, expiresIn: 3600 }),
        },
      );
      expect(response.status).toBe(201);
      return v.parse(v.object({ key: v.string() }), await response.json()).key;
    }
    const permitted = await issueKey(['event:read']);
    const forbidden = await issueKey(['notification:read']);
    function keyRequest(key: string, path = eventsPath): Promise<Response> {
      return fetch(`${fixture.baseUrl}${path}`, { headers: { 'x-api-key': key } });
    }
    expect((await page(await keyRequest(permitted))).items).toHaveLength(1);
    await denied(await keyRequest(forbidden), 403, 'AUTH_PERMISSION_DENIED');
    await denied(
      await keyRequest(permitted, eventsPath.replace(environmentId, siblingId)),
      404,
      'AUTH_SCOPE_NOT_FOUND',
    );
    await fixture.database.query('UPDATE auth.api_keys SET enabled=false');
    await denied(await keyRequest(permitted), 401, 'AUTH_CREDENTIALS_INVALID');
    await fixture.database.query('DELETE FROM auth.members');
    await denied(await request(), 404, 'AUTH_SCOPE_NOT_FOUND');
  });
});
