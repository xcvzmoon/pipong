import type { ChildProcess } from 'node:child_process';
import type { IncomingMessage, OutgoingHttpHeaders } from 'node:http';
import type { Server } from 'node:https';
import type { AuthFixture } from './fixtures/auth-runtime.ts';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer, request as httpsRequest } from 'node:https';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as v from 'valibot';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { freePort, startAuthFixture, stopProcess } from './fixtures/auth-runtime.ts';

const testUrl = process.env.TEST_AUTH_DATABASE_URL;
const runCommand = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const userId = '019a0000-0000-7000-8000-000000000011';
const organizationId = '019a0000-0000-7000-8000-000000000101';
const projectId = '019a0000-0000-7000-8000-000000000111';
const environmentId = '019a0000-0000-7000-8000-000000000121';
const siblingId = '019a0000-0000-7000-8000-000000000122';
const eventsPath = `/api/v1/organizations/${organizationId}/projects/${projectId}/environments/${environmentId}/events`;
const eventSchema = v.object({ id: v.string(), state: v.string() });

function eventId(sequence: number): string {
  return Buffer.from(`1.${organizationId}.${projectId}.${environmentId}.${sequence}`).toString(
    'base64url',
  );
}

async function nextDelivery(response: IncomingMessage): Promise<v.InferOutput<typeof eventSchema>> {
  let buffer = '';
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      cleanup();
      reject(new Error('TEST_EVENT_TIMEOUT'));
    }, 7000);
    function cleanup(): void {
      clearTimeout(timer);
      response.removeListener('data', onData);
    }
    function onData(chunk: Buffer): void {
      buffer += chunk.toString();
      const messages = buffer.split('\n\n');
      buffer = messages.pop() ?? '';
      for (const message of messages) {
        const line = message.split('\n').find((entry) => entry.startsWith('data: '));
        if (line) {
          cleanup();
          resolve(v.parse(eventSchema, JSON.parse(line.slice(6))));
          return;
        }
      }
    }
    response.on('data', onData);
  });
}

describe.skipIf(!testUrl)('durable SSE through TLS and two built API replicas', () => {
  let fixture: AuthFixture;
  let replica: ChildProcess | undefined;
  let replicaUrl: string;
  let proxy: Server;
  let proxyPort: number;
  let certificate: Buffer;
  let cookie: string;
  const connections = new Set<IncomingMessage>();

  async function stream(
    replicaNumber = 1,
    cursor?: string,
    path = `${eventsPath}/stream`,
    key?: string,
  ): Promise<IncomingMessage> {
    const headers: OutgoingHttpHeaders = { 'x-test-replica': String(replicaNumber) };
    if (key === undefined) {
      headers.cookie = cookie;
    } else {
      headers['x-api-key'] = key;
    }
    if (cursor !== undefined) {
      headers['Last-Event-ID'] = cursor;
    }
    const request = httpsRequest({
      hostname: '127.0.0.1',
      port: proxyPort,
      servername: 'push.test',
      ca: certificate,
      path,
      headers,
    });
    return new Promise<IncomingMessage>((resolve, reject) => {
      request.on('response', (incoming) => {
        connections.add(incoming);
        resolve(incoming);
      });
      request.on('error', reject);
      request.end();
    });
  }

  async function workerEvent(state: 'queued' | 'sending' | 'provider_accepted'): Promise<void> {
    const script = `
      const { useWorkerDb } = await import(${JSON.stringify(new URL('../../../packages/database/src/index.ts', import.meta.url).href)});
      const { withTenantTransaction } = await import(${JSON.stringify(new URL('../../../packages/database/src/tenancy/index.ts', import.meta.url).href)});
      const { recordDeliveryEvent } = await import(${JSON.stringify(new URL('../../../packages/service/src/events.ts', import.meta.url).href)});
      const runtime = await useWorkerDb();
      try { await withTenantTransaction(runtime, ${JSON.stringify({ kind: 'environment', organizationId, projectId, environmentId })}, transaction => recordDeliveryEvent(transaction, ${JSON.stringify({ kind: 'environment', organizationId, projectId, environmentId })}, ${JSON.stringify({ notificationId: projectId, deliveryId: environmentId, state })})); }
      finally { await runtime.close(); }
    `;
    await runCommand(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root,
      env: fixture.environment,
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
      "INSERT INTO auth.organizations (id,name,slug) VALUES ($1,'Streams','streams')",
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
    const port = await freePort();
    replicaUrl = `http://localhost:${port}`;
    replica = spawn(
      process.execPath,
      ['apps/server/tests/fixtures/domain-api/.output/server/index.mjs'],
      {
        cwd: root,
        env: { ...fixture.environment, PORT: String(port) },
        stdio: 'ignore',
      },
    );
    // oxlint-disable eslint/no-await-in-loop -- Wait for the second actual API process to become ready.
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if ((await fetch(`${replicaUrl}/api/auth/get-session`)).status === 200) {
          break;
        }
      } catch {}
      await setTimeout(100);
    }
    // oxlint-enable eslint/no-await-in-loop
    const key = await readFile(
      new URL('../../../packages/service/tests/fixtures/push-key.pem', import.meta.url),
    );
    certificate = await readFile(
      new URL('../../../packages/service/tests/fixtures/push-cert.pem', import.meta.url),
    );
    proxy = createServer({ key, cert: certificate }, (request, response) => {
      const target = request.headers['x-test-replica'] === '2' ? replicaUrl : fixture.baseUrl;
      const headers: OutgoingHttpHeaders = {};
      if (request.headers.cookie !== undefined) {
        headers.cookie = request.headers.cookie;
      }
      if (request.headers['last-event-id'] !== undefined) {
        headers['Last-Event-ID'] = request.headers['last-event-id'];
      }
      if (request.headers['x-api-key'] !== undefined) {
        headers['x-api-key'] = request.headers['x-api-key'];
      }
      const upstream = httpRequest(`${target}${request.url}`, { headers }, (incoming) => {
        response.writeHead(incoming.statusCode ?? 502, incoming.headers);
        incoming.pipe(response);
      });
      upstream.on('error', () => {
        response.destroy();
      });
      response.on('close', () => {
        upstream.destroy();
      });
      upstream.end();
    });
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');
    proxyPort = v.parse(v.object({ port: v.number() }), proxy.address()).port;
  }, 60_000);

  beforeEach(async () => {
    for (const connection of connections) {
      connection.destroy();
    }
    connections.clear();
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
    for (const connection of connections) {
      connection.destroy();
    }
    proxy?.closeAllConnections();
    if (proxy) {
      await new Promise<void>((resolve) => {
        proxy.close(() => {
          resolve();
        });
      });
    }
    await stopProcess(replica);
    await fixture?.close();
  }, 30_000);

  it('initializes concurrent event batches once and rolls back reserved sequences', async () => {
    const script = `
      import assert from 'node:assert/strict';
      const { useWorkerDb } = await import(${JSON.stringify(new URL('../../../packages/database/src/index.ts', import.meta.url).href)});
      const { withTenantTransaction } = await import(${JSON.stringify(new URL('../../../packages/database/src/tenancy/index.ts', import.meta.url).href)});
      const { appendDeliveryEvent, appendDeliveryEvents } = await import(${JSON.stringify(new URL('../../../packages/database/src/events.ts', import.meta.url).href)});
      const runtime = await useWorkerDb();
      const scope = ${JSON.stringify({ kind: 'environment', organizationId, projectId, environmentId })};
      const input = ${JSON.stringify({ notificationId: projectId, deliveryId: environmentId, state: 'queued' })};
      try {
        await assert.rejects(withTenantTransaction(runtime, scope, async transaction => {
          await appendDeliveryEvents(transaction, scope, [input, input]);
          throw new Error('TEST_ROLLBACK');
        }), /TEST_ROLLBACK/);
        await Promise.all(Array.from({ length: 12 }, () => withTenantTransaction(runtime, scope,
          transaction => appendDeliveryEvents(transaction, scope, [input, input]))));
        await assert.rejects(withTenantTransaction(runtime, scope, async transaction => {
          await appendDeliveryEvent(transaction, scope, input);
          throw new Error('TEST_ROLLBACK');
        }), /TEST_ROLLBACK/);
        await withTenantTransaction(runtime, scope, transaction => appendDeliveryEvent(transaction, scope, input));
      } finally { await runtime.close(); }
    `;
    await runCommand(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root,
      env: fixture.environment,
    });
    expect(
      (
        await fixture.database.query(
          'SELECT sequence::integer FROM app.delivery_events ORDER BY sequence',
        )
      ).rows,
    ).toEqual(Array.from({ length: 25 }, (_, index) => ({ sequence: index + 1 })));
    expect(
      (await fixture.database.query('SELECT sequence::integer FROM app.event_streams')).rows,
    ).toEqual([{ sequence: 25 }]);
  });

  it('receives worker events on both replicas and resumes on the other replica without gaps', async () => {
    const first = await stream(1, eventId(0));
    const second = await stream(2, eventId(0));
    expect(first.statusCode).toBe(200);
    expect(first.headers['content-type']).toContain('text/event-stream');
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.headers['x-accel-buffering']).toBe('no');
    const firstEvent = nextDelivery(first);
    const secondEvent = nextDelivery(second);
    await workerEvent('queued');
    expect(await firstEvent).toEqual(await secondEvent);
    first.destroy();
    const resumed = await stream(2, eventId(1));
    const next = nextDelivery(resumed);
    await workerEvent('sending');
    expect(await next).toEqual({ id: eventId(2), state: 'sending' });
    const session = await fixture.database.query<{ id: string }>(
      'SELECT id FROM auth.sessions WHERE user_id=$1',
      [userId],
    );
    const probe = `
      import assert from 'node:assert/strict';
      const { useApiDb, useWorkerDb } = await import(${JSON.stringify(new URL('../../../packages/database/src/index.ts', import.meta.url).href)});
      const { withTenantTransaction } = await import(${JSON.stringify(new URL('../../../packages/database/src/tenancy/index.ts', import.meta.url).href)});
      const { recordDeliveryEvent } = await import(${JSON.stringify(new URL('../../../packages/service/src/events.ts', import.meta.url).href)});
      const { createEventStreamRuntime } = await import(${JSON.stringify(new URL('../../../packages/service/src/event-stream.ts', import.meta.url).href)});
      const api = await useApiDb();
      const worker = await useWorkerDb();
      const streams = createEventStreamRuntime(api);
      const scope = ${JSON.stringify({ kind: 'environment', organizationId, projectId, environmentId })};
      const principal = ${JSON.stringify({ kind: 'human', userId, sessionId: session.rows[0]?.id })};
      try {
        await withTenantTransaction(worker, scope, async transaction => {
          for (let index = 0; index < 300; index++) await recordDeliveryEvent(transaction, scope, ${JSON.stringify({ notificationId: projectId, deliveryId: environmentId, state: 'queued' })});
        });
        let liveReceived;
        const live = new Promise(resolve => { liveReceived = resolve; });
        await streams.subscribe(principal, scope, '${eventId(302)}', async message => {
          if (message.kind === 'delivery') liveReceived(message.value);
        }, () => {});
        await streams.subscribe(principal, scope, '${eventId(252)}', async () => {}, () => {});
        const receipts = Array.from({ length: 8 }, () => []);
        const subscriptions = receipts.map(async (receipt, index) => {
          await new Promise(resolve => setTimeout(resolve, 980 + index * 2));
          return streams.subscribe(principal, scope, '${eventId(2)}', async message => {
            if (message.kind === 'delivery') receipt.push(Number(Buffer.from(message.value.id, 'base64url').toString().split('.').at(-1)));
          }, () => {});
        });
        assert.equal((await Promise.all(subscriptions)).every(result => result.ok), true);
        await withTenantTransaction(worker, scope, transaction => recordDeliveryEvent(transaction, scope, ${JSON.stringify({ notificationId: projectId, deliveryId: environmentId, state: 'queued' })}));
        const liveDeadline = new Promise((_, reject) => globalThis.setTimeout(() => reject(new Error('TEST_LIVE_REPLAY_STARVED')), 1800));
        assert.equal((await Promise.race([live, liveDeadline])).id, '${eventId(303)}');
        const deadline = Date.now() + 7000;
        while (receipts.some(receipt => receipt.length < 301) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
        for (const receipt of receipts) assert.deepEqual(receipt, Array.from({ length: 301 }, (_, index) => index + 3));
      } finally { await streams.close(); await api.close(); await worker.close(); }
    `;
    await runCommand(process.execPath, ['--input-type=module', '-e', probe], {
      cwd: root,
      env: fixture.environment,
      timeout: 12_000,
    });
  }, 20_000);

  it('rejects malformed, conflicting, future, foreign and expired cursors before opening', async () => {
    expect((await stream(1, 'bad')).statusCode).toBe(422);
    expect((await stream(1, eventId(0), `${eventsPath}/stream?cursor=bad`)).statusCode).toBe(422);
    expect((await stream(1, eventId(99))).statusCode).toBe(422);
    expect(
      (await stream(1, eventId(0), `${eventsPath.replace(environmentId, siblingId)}/stream`))
        .statusCode,
    ).toBe(422);
    await workerEvent('queued');
    await fixture.database.query(
      'UPDATE app.event_streams SET watermark=1; DELETE FROM app.delivery_events',
    );
    expect((await stream(1, eventId(0))).statusCode).toBe(410);
  });

  it('disconnects revoked membership and releases connections without retaining database transactions', async () => {
    const response = await stream();
    response.resume();
    const ended = once(response, 'end');
    await fixture.database.query('DELETE FROM auth.members');
    await Promise.race([
      ended,
      setTimeout(5000).then(() => {
        throw new Error('TEST_REVOCATION_TIMEOUT');
      }),
    ]);
    const active = await fixture.database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM pg_stat_activity WHERE usename='pipong_api' AND state='idle in transaction'",
    );
    expect(active.rows[0]?.count).toBe(0);
    await fixture.database.query(
      "INSERT INTO auth.members (id,organization_id,user_id,role) VALUES ($1,$2,$1,'owner')",
      [userId, organizationId],
    );
    await fixture.database.query('UPDATE auth.users SET two_factor_enabled=true');
    await fixture.database.query(
      'INSERT INTO auth.mfa_assurances (session_id,verified_at) SELECT id,now() FROM auth.sessions WHERE user_id=$1',
      [userId],
    );
    const issued = await fetch(
      `${fixture.baseUrl}${eventsPath.replace('/events', '/service-keys')}`,
      {
        method: 'POST',
        headers: { cookie, origin: fixture.baseUrl, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Stream', actions: ['event:read'], expiresIn: 3600 }),
      },
    );
    expect(issued.status).toBe(201);
    const key = v.parse(v.object({ key: v.string() }), await issued.json()).key;
    const keyed = await stream(1, undefined, `${eventsPath}/stream`, key);
    expect(keyed.statusCode).toBe(200);
    keyed.resume();
    const keyEnded = once(keyed, 'end');
    await fixture.database.query('UPDATE auth.api_keys SET enabled=false');
    await Promise.race([
      keyEnded,
      setTimeout(5000).then(() => {
        throw new Error('TEST_KEY_REVOCATION_TIMEOUT');
      }),
    ]);
  });

  it('disconnects slow sinks, enforces connection limits, and reuses disconnected slots', async () => {
    const session = await fixture.database.query<{ id: string }>(
      'SELECT id FROM auth.sessions WHERE user_id=$1',
      [userId],
    );
    const script = `
      import assert from 'node:assert/strict';
      const { useApiDb, useWorkerDb } = await import(${JSON.stringify(new URL('../../../packages/database/src/index.ts', import.meta.url).href)});
      const { withTenantTransaction } = await import(${JSON.stringify(new URL('../../../packages/database/src/tenancy/index.ts', import.meta.url).href)});
      const { recordDeliveryEvent } = await import(${JSON.stringify(new URL('../../../packages/service/src/events.ts', import.meta.url).href)});
      const { createEventStreamRuntime } = await import(${JSON.stringify(new URL('../../../packages/service/src/event-stream.ts', import.meta.url).href)});
      const api = await useApiDb();
      const worker = await useWorkerDb();
      const streams = createEventStreamRuntime(api);
      const scope = ${JSON.stringify({ kind: 'environment', organizationId, projectId, environmentId })};
      const principal = ${JSON.stringify({ kind: 'human', userId, sessionId: session.rows[0]?.id })};
      let unblock;
      let closed = 0;
      const stalled = new Promise(resolve => { unblock = resolve; });
      let received;
      const event = new Promise(resolve => { received = resolve; });
      try {
        assert.equal((await streams.subscribe(principal, scope, undefined, () => stalled, () => { closed++; unblock(); })).ok, true);
        assert.equal((await streams.subscribe(principal, scope, undefined, async message => { if (message.kind === 'delivery') received(message.value); }, () => {})).ok, true);
        await withTenantTransaction(worker, scope, transaction => recordDeliveryEvent(transaction, scope, ${JSON.stringify({ notificationId: projectId, deliveryId: environmentId, state: 'queued' })}));
        assert.equal((await event).state, 'queued');
        await new Promise(resolve => setTimeout(resolve, 5500));
        assert.equal(closed, 1);
        await streams.close();
        await streams.close();
        assert.equal(closed, 1);
      } finally { await streams.close(); await api.close(); await worker.close(); }
    `;
    await runCommand(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root,
      env: fixture.environment,
      timeout: 12_000,
    });
    const opened: IncomingMessage[] = [];
    // oxlint-disable eslint/no-await-in-loop -- Fill the documented per-environment capacity using real TLS connections.
    for (let index = 0; index < 64; index++) {
      const response = await stream();
      expect(response.statusCode).toBe(200);
      response.resume();
      opened.push(response);
    }
    // oxlint-enable eslint/no-await-in-loop
    const denied = await stream();
    expect(denied.statusCode).toBe(429);
    expect(denied.headers['retry-after']).toBe('5');
    for (const response of opened) {
      response.destroy();
    }
    await setTimeout(1200);
    expect((await stream()).statusCode).toBe(200);
  }, 20_000);

  it('bounds held database locks while other environments continue and shutdown completes', async () => {
    const session = await fixture.database.query<{ id: string }>(
      'SELECT id FROM auth.sessions WHERE user_id=$1',
      [userId],
    );
    const script = `
      import assert from 'node:assert/strict';
      import pg from ${JSON.stringify(new URL('../node_modules/pg/lib/index.js', import.meta.url).href)};
      const { useApiDb, useWorkerDb } = await import(${JSON.stringify(new URL('../../../packages/database/src/index.ts', import.meta.url).href)});
      const { withTenantTransaction } = await import(${JSON.stringify(new URL('../../../packages/database/src/tenancy/index.ts', import.meta.url).href)});
      const { recordDeliveryEvent } = await import(${JSON.stringify(new URL('../../../packages/service/src/events.ts', import.meta.url).href)});
      const { createEventStreamRuntime } = await import(${JSON.stringify(new URL('../../../packages/service/src/event-stream.ts', import.meta.url).href)});
      const api = await useApiDb();
      const worker = await useWorkerDb();
      const adminUrl = new URL(process.env.API_DATABASE_URL);
      adminUrl.username = 'postgres';
      const locker = new pg.Client({ connectionString: adminUrl.href });
      const streams = createEventStreamRuntime(api);
      const scope = ${JSON.stringify({ kind: 'environment', organizationId, projectId, environmentId })};
      const sibling = { ...scope, environmentId: '${siblingId}' };
      const principal = ${JSON.stringify({ kind: 'human', userId, sessionId: session.rows[0]?.id })};
      let received;
      const event = new Promise(resolve => { received = resolve; });
      let closed = false;
      try {
        await locker.connect();
        await withTenantTransaction(worker, scope, transaction => recordDeliveryEvent(transaction, scope, ${JSON.stringify({ notificationId: projectId, deliveryId: environmentId, state: 'queued' })}));
        assert.equal((await streams.subscribe(principal, scope, undefined, async () => {}, () => { closed = true; })).ok, true);
        assert.equal((await streams.subscribe(principal, sibling, undefined, async message => { if (message.kind === 'delivery') received(message.value); }, () => {})).ok, true);
        await locker.query('BEGIN');
        await locker.query('SELECT * FROM app.event_streams WHERE environment_id=$1 FOR UPDATE', [scope.environmentId]);
        await withTenantTransaction(worker, sibling, transaction => recordDeliveryEvent(transaction, sibling, ${JSON.stringify({ notificationId: projectId, deliveryId: environmentId, state: 'queued' })}));
        const deadline = new Promise((_, reject) => globalThis.setTimeout(() => reject(new Error('TEST_LOCK_STALL')), 3000));
        assert.equal((await Promise.race([event, deadline])).state, 'queued');
        assert.equal(closed, true);
        await Promise.race([streams.close(), deadline]);
      } finally {
        await locker.query('ROLLBACK');
        await locker.end();
        await streams.close(); await api.close(); await worker.close();
      }
    `;
    await runCommand(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root,
      env: fixture.environment,
      timeout: 8000,
    });
  }, 10_000);

  it('ends active streams during graceful replica shutdown', async () => {
    const response = await stream(2);
    response.resume();
    const ended = once(response, 'end');
    await stopProcess(replica);
    expect(replica?.signalCode).not.toBe('SIGKILL');
    replica = undefined;
    await ended;
    const port = await freePort();
    const disabled = spawn(
      process.execPath,
      ['apps/server/tests/fixtures/domain-api/.output/server/index.mjs'],
      {
        cwd: root,
        env: { ...fixture.environment, PORT: String(port), CI: '1', TEST: '1' },
        stdio: 'ignore',
      },
    );
    try {
      // oxlint-disable eslint/no-await-in-loop -- Exercise the runtime with graceful shutdown disabled as in test/CI processes.
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          if ((await fetch(`http://localhost:${port}/api/auth/get-session`)).status === 200) {
            break;
          }
        } catch {}
        await setTimeout(50);
      }
      // oxlint-enable eslint/no-await-in-loop
      await stopProcess(disabled);
      expect(disabled.signalCode).toBe('SIGTERM');
    } finally {
      await stopProcess(disabled);
    }
  }, 15_000);
});
