import type { AuthFixture } from './fixtures/auth-runtime.ts';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as v from 'valibot';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startAuthFixture, stopProcess } from './fixtures/auth-runtime.ts';

const testUrl = process.env.TEST_AUTH_DATABASE_URL;
const runCommand = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const token = 'operator-token-at-least-thirty-two-characters';
const workerId = '019a0000-0000-7000-8000-000000000201';
const organizationId = '019a0000-0000-7000-8000-000000000101';
const userId = '019a0000-0000-7000-8000-000000000011';
const healthSchema = v.object({
  status: v.picklist(['ready', 'unready']),
  database: v.boolean(),
  queues: v.boolean(),
  consumers: v.boolean(),
  configuration: v.boolean(),
});

describe.skipIf(!testUrl)('protected health, metrics, and audit through built HTTP', () => {
  let fixture: AuthFixture;
  let secretDirectory: string;
  const ajv = new Ajv2020({ strict: true });
  let validateHealth: ReturnType<typeof ajv.compile>;
  function request(path: string, authorization = `Bearer ${token}`): Promise<Response> {
    return fetch(`${fixture.baseUrl}${path}`, { headers: { authorization } });
  }
  beforeAll(async () => {
    secretDirectory = await mkdtemp(join(tmpdir(), 'pipong-diagnostics-'));
    const tokenPath = join(secretDirectory, 'token');
    await writeFile(tokenPath, token, { mode: 0o600 });
    vi.stubEnv('DIAGNOSTICS_TOKEN_REF', tokenPath);
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
    vi.unstubAllEnvs();
    const contract = v.parse(
      v.object({ components: v.object({ schemas: v.record(v.string(), v.looseObject({})) }) }),
      await (await fetch(`${fixture.baseUrl}/_openapi.json`)).json(),
    );
    const schema = contract.components.schemas.RuntimeHealth;
    if (!schema) {
      throw new Error('TEST_HEALTH_SCHEMA_MISSING');
    }
    validateHealth = ajv.compile(schema);
  }, 60_000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await fixture?.close();
    if (secretDirectory) {
      await rm(secretDirectory, { recursive: true, force: true });
    }
  });

  it('hides diagnostics from unauthenticated and tenant credentials', async () => {
    await Promise.all(
      ['/health/live', '/health/ready', '/metrics'].map(async (path) => {
        const response = await request(path, 'Bearer tenant-api-key-secret');
        expect(response.status).toBe(404);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.text()).toBe('');
      }),
    );
    expect((await request('/health/live')).status).toBe(200);
  });

  it('requires fresh consumer leases while liveness stays independent', async () => {
    const missing = await request('/health/ready');
    expect(missing.status).toBe(503);
    const health = v.parse(healthSchema, await missing.json());
    expect(validateHealth(health), JSON.stringify(validateHealth.errors)).toBe(true);
    expect(health).toEqual({
      status: 'unready',
      database: true,
      queues: true,
      consumers: false,
      configuration: true,
    });
    await fixture.database.query('SET ROLE pipong_worker');
    try {
      await fixture.database.query(
        "SELECT app.publish_worker_heartbeat($1, ARRAY['auth-email','apns','fcm','web-push'])",
        [workerId],
      );
    } finally {
      await fixture.database.query('RESET ROLE');
    }
    expect((await request('/health/ready')).status).toBe(200);
    const keyringPath = fixture.environment.CREDENTIAL_KEYRING_REF ?? '';
    const keyring = await readFile(keyringPath, 'utf8');
    await writeFile(keyringPath, 'private-invalid-configuration');
    try {
      const invalid = await request('/health/ready');
      expect(invalid.status).toBe(503);
      expect(v.parse(healthSchema, await invalid.json()).configuration).toBe(false);
      expect((await request('/health/live')).status).toBe(200);
      expect(fixture.logs()).not.toContain('private-invalid-configuration');
    } finally {
      await writeFile(keyringPath, keyring);
    }
    await fixture.database.query(
      "UPDATE app.worker_heartbeats SET expires_at=now()-interval '1 second'",
    );
    expect((await request('/health/ready')).status).toBe(503);
    expect((await request('/health/live')).status).toBe(200);
    await fixture.database.query('BEGIN; LOCK app.deliveries IN ACCESS EXCLUSIVE MODE');
    const worker = spawn(process.execPath, ['apps/worker/dist/index.mjs'], {
      cwd: root,
      env: {
        ...fixture.environment,
        AUTH_MAIL_FROM: 'auth@example.com',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '2525',
        SMTP_SECURITY: 'local',
      },
      stdio: 'ignore',
    });
    try {
      await expect
        .poll(
          async () =>
            (
              await fixture.database.query<{ count: string }>(
                'SELECT count(*) FROM app.worker_heartbeats WHERE id <> $1 AND expires_at > clock_timestamp()',
                [workerId],
              )
            ).rows[0]?.count,
          { timeout: 10000 },
        )
        .toBe('1');
      const lease = await fixture.database.query(
        'SELECT expires_at FROM app.worker_heartbeats WHERE id <> $1',
        [workerId],
      );
      const original = v.parse(v.object({ expires_at: v.date() }), lease.rows[0]).expires_at;
      await expect
        .poll(
          async () =>
            (
              await fixture.database.query<{ count: string }>(
                'SELECT count(*) FROM app.worker_heartbeats WHERE id <> $1 AND expires_at > $2',
                [workerId, original],
              )
            ).rows[0]?.count,
          { timeout: 35000, interval: 1000 },
        )
        .toBe('1');
    } finally {
      await fixture.database.query('ROLLBACK');
      await stopProcess(worker);
    }
    expect(
      (
        await fixture.database.query<{ count: string }>(
          'SELECT count(*) FROM app.worker_heartbeats WHERE id <> $1',
          [workerId],
        )
      ).rows[0]?.count,
    ).toBe('0');
  }, 50000);

  it('starts enabled push consumers and removes their leases on graceful shutdown', async () => {
    const worker = spawn(process.execPath, ['apps/worker/dist/index.mjs'], {
      cwd: root,
      env: {
        ...fixture.environment,
        AUTH_MAIL_FROM: 'auth@example.com',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '2525',
        SMTP_SECURITY: 'local',
        PUSH_DELIVERY_ENABLED: 'true',
        WEB_PUSH_SUBJECT: 'mailto:ops@example.com',
      },
      stdio: 'ignore',
    });
    try {
      await expect
        .poll(async () => (await request('/health/ready')).status, { timeout: 10000 })
        .toBe(200);
      const leases = await fixture.database.query(
        'SELECT consumers_ready AS consumers FROM app.worker_heartbeats WHERE id <> $1 AND expires_at > clock_timestamp()',
        [workerId],
      );
      expect(leases.rows).toEqual([{ consumers: ['auth-email', 'apns', 'fcm', 'web-push'] }]);
    } finally {
      await stopProcess(worker);
    }
    expect(worker.exitCode).toBe(0);
    expect(worker.signalCode).toBeNull();
    expect(
      (
        await fixture.database.query('SELECT id FROM app.worker_heartbeats WHERE id <> $1', [
          workerId,
        ])
      ).rows,
    ).toHaveLength(0);
    expect((await request('/health/ready')).status).toBe(503);
  }, 20000);

  it('reports database/schema failure without exposing infrastructure errors', async () => {
    await fixture.database.query(
      'REVOKE EXECUTE ON FUNCTION app.runtime_diagnostics() FROM pipong_api',
    );
    try {
      const response = await request('/health/ready');
      expect(response.status).toBe(503);
      expect(v.parse(healthSchema, await response.json()).database).toBe(false);
      expect((await request('/health/live')).status).toBe(200);
      const metrics = await (await request('/metrics')).text();
      expect(metrics).toContain('pipong_database_available{role="api"} 0');
      expect(metrics).not.toContain('permission denied');
    } finally {
      await fixture.database.query(
        'GRANT EXECUTE ON FUNCTION app.runtime_diagnostics() TO pipong_api',
      );
    }
  });

  it('exposes bounded metric labels and redacted request logs', async () => {
    await Promise.all(
      Array.from({ length: 15 }, (_, index) =>
        request(`/arbitrary-secret-url-${index}?password=private-request-secret`),
      ),
    );
    const response = await request('/metrics');
    expect(response.status).toBe(200);
    const metrics = await response.text();
    expect(metrics).toContain('pipong_http_requests_total');
    expect(metrics).toContain('queue="delivery-fcm"');
    expect(metrics).toContain('pipong_sse_connections');
    expect(metrics).not.toContain('private-request-secret');
    expect(metrics).not.toContain('arbitrary-secret-url');
    expect(fixture.logs()).toContain('http_request');
    expect(fixture.logs()).not.toContain(token);
    expect(fixture.logs()).not.toContain('private-request-secret');
    expect(fixture.logs()).not.toContain('tenant-api-key-secret');
  });

  it('commits scoped privileged audits atomically with API changes and rejects rewriting', async () => {
    await fixture.database.query(
      "INSERT INTO auth.organizations (id,name,slug) VALUES ($1,'Audit','audit')",
      [organizationId],
    );
    await fixture.database.query(
      "INSERT INTO auth.members (id,organization_id,user_id,role) VALUES ($1,$2,$1,'owner')",
      [userId, organizationId],
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
    const cookie = login.headers
      .getSetCookie()
      .map((header) => header.split(';')[0])
      .join('; ');
    await fixture.database.query(
      'INSERT INTO auth.mfa_assurances (session_id,verified_at) SELECT id,now() FROM auth.sessions WHERE user_id=$1',
      [userId],
    );
    await fixture.database.query('UPDATE auth.users SET two_factor_enabled=true WHERE id=$1', [
      userId,
    ]);
    const response = await fetch(
      `${fixture.baseUrl}/api/v1/organizations/${organizationId}/projects`,
      {
        method: 'POST',
        headers: { cookie, origin: fixture.baseUrl, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Audited project' }),
      },
    );
    expect(response.status).toBe(201);
    const audits = await fixture.database.query(
      'SELECT organization_id,user_id,action FROM app.privileged_audits',
    );
    expect(audits.rows).toEqual([
      { organization_id: organizationId, user_id: userId, action: 'project:manage' },
    ]);
    await fixture.database.query('SET ROLE pipong_api');
    try {
      await expect(
        fixture.database.query("UPDATE app.privileged_audits SET action='organization:manage'"),
      ).rejects.toThrow('permission denied');
      await expect(fixture.database.query('DELETE FROM app.privileged_audits')).rejects.toThrow(
        'permission denied',
      );
      await expect(fixture.database.query('SELECT * FROM app.privileged_audits')).rejects.toThrow(
        'permission denied',
      );
    } finally {
      await fixture.database.query('RESET ROLE');
    }
    await fixture.database.query('REVOKE INSERT ON app.privileged_audits FROM pipong_api');
    try {
      const failed = await fetch(
        `${fixture.baseUrl}/api/v1/organizations/${organizationId}/projects`,
        {
          method: 'POST',
          headers: { cookie, origin: fixture.baseUrl, 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Must roll back' }),
        },
      );
      expect(failed.status).toBe(503);
      expect(
        (await fixture.database.query("SELECT id FROM app.projects WHERE name='Must roll back'"))
          .rowCount,
      ).toBe(0);
    } finally {
      await fixture.database.query('GRANT INSERT ON app.privileged_audits TO pipong_api');
    }
    await fixture.database.query(
      "INSERT INTO app.privileged_audits (id,organization_id,user_id,session_id,action,created_at) SELECT $1,$2,$3,id,'project:manage',clock_timestamp()-interval '91 days' FROM auth.sessions WHERE user_id=$3 LIMIT 1",
      ['019a0000-0000-7000-8000-000000000203', organizationId, userId],
    );
    await fixture.database.query('SET ROLE pipong_worker');
    try {
      await expect(fixture.database.query('DELETE FROM app.privileged_audits')).rejects.toThrow(
        'permission denied',
      );
      await fixture.database.query('SELECT app.prune_privileged_audits()');
    } finally {
      await fixture.database.query('RESET ROLE');
    }
    const retained = await fixture.database.query<{ count: string }>(
      'SELECT count(*) FROM app.privileged_audits',
    );
    expect(retained.rows[0]?.count).toBe('1');
  });
});
