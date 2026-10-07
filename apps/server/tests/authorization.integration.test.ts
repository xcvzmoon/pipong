import type { TenantScope } from '@pipong/database/tenancy';
import type { DomainAction } from '@pipong/service';
import type { AuthFixture } from './fixtures/auth-runtime.ts';
import { defaultKeyHasher } from '@better-auth/api-key';
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
const otherOrganizationId = '019a0000-0000-7000-8000-000000000102';
const projectId = '019a0000-0000-7000-8000-000000000111';
const environmentId = '019a0000-0000-7000-8000-000000000121';
const siblingEnvironmentId = '019a0000-0000-7000-8000-000000000122';
const keyId = '019a0000-0000-7000-8000-000000000131';
const key = 'pipong-test-environment-key-long-enough';
const scope: TenantScope = { kind: 'environment', organizationId, projectId, environmentId };
const errorSchema = v.object({ code: v.string(), requestId: v.pipe(v.string(), v.uuid()) });

const actions: DomainAction[] = [
  'organization:manage',
  'project:read',
  'project:manage',
  'environment:read',
  'environment:manage',
  'recipient:read',
  'recipient:write',
  'endpoint:read',
  'endpoint:write',
  'credential:read',
  'credential:manage',
  'service-key:read',
  'service-key:manage',
  'notification:read',
  'notification:send',
  'notification:cancel',
  'delivery:read',
  'delivery:redrive',
  'event:read',
];
const memberActions = new Set<DomainAction>([
  'project:read',
  'environment:read',
  'recipient:read',
  'endpoint:read',
  'notification:read',
  'delivery:read',
  'event:read',
]);

function actionScope(action: DomainAction): TenantScope {
  if (action === 'organization:manage') {
    return { kind: 'organization', organizationId };
  }

  if (action === 'project:read' || action === 'project:manage') {
    return { kind: 'project', organizationId, projectId };
  }

  return scope;
}

async function denied(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toContain('application/problem+json');
  expect(response.headers.get('cache-control')).toBe('no-store');
  const problem = v.parse(errorSchema, await response.json());
  expect(problem.code).toBe(code);
  expect(response.headers.get('x-request-id')).toBe(problem.requestId);
}

describe.skipIf(!testUrl)('live domain authorization through the built HTTP boundary', () => {
  let fixture: AuthFixture;
  let cookie: string;

  async function authorize(
    action: DomainAction,
    requestedScope = actionScope(action),
    headers: Record<string, string> = { cookie },
    hold = false,
  ): Promise<Response> {
    return fetch(`${fixture.baseUrl}/api/v1/authorize${hold ? '?hold=true' : ''}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: fixture.baseUrl, ...headers },
      body: JSON.stringify({ action, scope: requestedScope }),
    });
  }

  async function revocationWaits(
    statement: string,
    id: string,
    headers: Record<string, string>,
  ): Promise<void> {
    const revoker = new Client({ connectionString: fixture.environment.API_DATABASE_URL });
    await revoker.connect();

    try {
      await revoker.query("SET lock_timeout = '150ms'");
      await fixture.database.query('SELECT pg_advisory_lock(80808)');
      const pending = authorize('notification:read', scope, headers, true);

      try {
        await expect
          .poll(async () => {
            const result = await fixture.database.query(
              "SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=80808 AND NOT granted",
            );
            return result.rowCount;
          })
          .toBe(1);
        await expect(revoker.query(statement, [id])).rejects.toMatchObject({ code: '55P03' });
      } finally {
        await fixture.database.query('SELECT pg_advisory_unlock(80808)');
        expect((await pending).status).toBe(200);
      }

      await revoker.query(statement, [id]);
    } finally {
      await revoker.end();
    }
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
      `
      INSERT INTO auth.organizations (id,name,slug) VALUES ($1,'First','first'),($2,'Second','second');
    `,
      [organizationId, otherOrganizationId],
    );
    await fixture.database.query(
      'INSERT INTO app.projects (id,organization_id,name) VALUES ($1,$2,$3)',
      [projectId, organizationId, 'Project'],
    );
    await fixture.database.query(
      'INSERT INTO app.environments (id,organization_id,project_id,name) VALUES ($1,$2,$3,$4),($5,$2,$3,$6)',
      [environmentId, organizationId, projectId, 'Production', siblingEnvironmentId, 'Development'],
    );
    await fixture.database.query(
      'INSERT INTO auth.api_keys (id,reference_id,key,rate_limit_enabled) VALUES ($1,$2,$3,false)',
      [keyId, organizationId, await defaultKeyHasher(key)],
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
    await fixture.database.query('UPDATE auth.users SET two_factor_enabled=true WHERE id=$1', [
      userId,
    ]);
  }, 60_000);

  beforeEach(async () => {
    await fixture.database.query(
      'DELETE FROM auth.members; DELETE FROM auth.service_key_grants; DELETE FROM auth.mfa_assurances; DELETE FROM auth.rate_limits',
    );
    await fixture.database.query(
      'INSERT INTO auth.members (id,organization_id,user_id,role) VALUES ($1,$2,$3,$4)',
      [userId, organizationId, userId, 'owner'],
    );
    await fixture.database.query(
      'INSERT INTO auth.mfa_assurances (session_id,verified_at) SELECT id,now() FROM auth.sessions WHERE user_id=$1',
      [userId],
    );
    await fixture.database.query('UPDATE auth.organizations SET disabled_at=NULL,deleted_at=NULL');
    await fixture.database.query(
      'INSERT INTO auth.api_keys (id,reference_id,key,rate_limit_enabled) VALUES ($1,$2,$3,false) ON CONFLICT (id) DO UPDATE SET enabled=true,expires_at=NULL,deleted_at=NULL',
      [keyId, organizationId, await defaultKeyHasher(key)],
    );
    await fixture.database.query(
      'INSERT INTO auth.service_key_grants (key_id,organization_id,project_id,environment_id,actions) VALUES ($1,$2,$3,$4,$5)',
      [
        keyId,
        organizationId,
        projectId,
        environmentId,
        ['notification:send', 'notification:read', 'event:read'],
      ],
    );
  });

  afterAll(async () => {
    if (fixture) await fixture.close();
  });

  it('enforces the owner/admin/member matrix and denies unknown or combined roles', async () => {
    // oxlint-disable eslint/no-await-in-loop -- Each request follows a committed role change in the shared fixture.
    for (const role of ['owner', 'admin', 'member', 'custom', 'owner,member']) {
      await fixture.database.query('UPDATE auth.members SET role=$1 WHERE user_id=$2', [
        role,
        userId,
      ]);
      for (const action of actions) {
        const permitted =
          role === 'owner' ||
          (role === 'admin' && action !== 'organization:manage') ||
          (role === 'member' && memberActions.has(action));
        const response = await authorize(action);
        if (permitted) {
          expect(response.status, `${role} ${action}`).toBe(200);
        } else {
          await denied(response, 403, 'AUTH_PERMISSION_DENIED');
        }
      }
    }
    // oxlint-enable eslint/no-await-in-loop
  });

  it('ignores active organization and client authority claims, and rechecks removal and demotion', async () => {
    await fixture.database.query(
      'UPDATE auth.sessions SET active_organization_id=$1 WHERE user_id=$2',
      [otherOrganizationId, userId],
    );
    expect((await authorize('notification:read')).status).toBe(200);
    await revocationWaits('DELETE FROM auth.members WHERE user_id=$1', userId, { cookie });
    await denied(await authorize('notification:read'), 404, 'AUTH_SCOPE_NOT_FOUND');
    await fixture.database.query(
      'INSERT INTO auth.members (id,organization_id,user_id,role) VALUES ($1,$2,$3,$4)',
      [userId, organizationId, userId, 'owner'],
    );
    await denied(
      await authorize(
        'notification:read',
        { ...scope, organizationId: otherOrganizationId },
        { cookie, 'x-pipong-role': 'owner', 'x-pipong-mfa-verified': 'true' },
      ),
      404,
      'AUTH_SCOPE_NOT_FOUND',
    );
    await fixture.database.query('UPDATE auth.members SET role=$1 WHERE user_id=$2', [
      'member',
      userId,
    ]);
    await denied(await authorize('notification:send'), 403, 'AUTH_PERMISSION_DENIED');
    await fixture.database.query('DELETE FROM auth.members WHERE user_id=$1', [userId]);
    await denied(await authorize('notification:read'), 404, 'AUTH_SCOPE_NOT_FOUND');
    await denied(await authorize('project:manage', scope), 403, 'AUTH_PERMISSION_DENIED');
  });

  it('requires server-observed recent MFA and rejects disabled organizations and mismatched resource ownership', async () => {
    await fixture.database.query(
      "UPDATE auth.mfa_assurances SET verified_at=now()-interval '6 minutes'",
    );
    await denied(await authorize('credential:manage'), 403, 'AUTH_RECENT_MFA_REQUIRED');
    expect((await authorize('notification:read')).status).toBe(200);
    await fixture.database.query(
      "UPDATE auth.mfa_assurances SET verified_at=now()+interval '1 minute'",
    );
    await denied(await authorize('service-key:manage'), 403, 'AUTH_RECENT_MFA_REQUIRED');
    await fixture.database.query('UPDATE auth.mfa_assurances SET verified_at=now()');
    expect((await authorize('service-key:manage')).status).toBe(200);
    await fixture.database.query('UPDATE auth.users SET two_factor_enabled=false WHERE id=$1', [
      userId,
    ]);
    await denied(await authorize('credential:manage'), 403, 'AUTH_RECENT_MFA_REQUIRED');
    await fixture.database.query('UPDATE auth.users SET two_factor_enabled=true WHERE id=$1', [
      userId,
    ]);
    await fixture.database.query('UPDATE auth.organizations SET disabled_at=now() WHERE id=$1', [
      organizationId,
    ]);
    await denied(await authorize('notification:read'), 403, 'AUTH_ORGANIZATION_DISABLED');
    await denied(
      await authorize('notification:read', scope, { authorization: `Bearer ${key}` }),
      403,
      'AUTH_ORGANIZATION_DISABLED',
    );
    await fixture.database.query('UPDATE auth.organizations SET disabled_at=NULL WHERE id=$1', [
      organizationId,
    ]);
    await denied(
      await authorize('notification:read', {
        ...scope,
        projectId: '019a0000-0000-7000-8000-000000000112',
      }),
      404,
      'AUTH_SCOPE_NOT_FOUND',
    );
    const response = await authorize('notification:read');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authorized: true,
      scope: {
        organization_id: organizationId,
        project_id: projectId,
        environment_id: environmentId,
      },
    });
  });

  it('requires a committed exact environment grant and live enabled, unexpired keys', async () => {
    const headers = { authorization: `Bearer ${key}` };
    expect((await authorize('notification:send', scope, headers)).status).toBe(200);
    expect((await authorize('notification:read', scope, { 'x-api-key': key })).status).toBe(200);
    await expect(
      fixture.database.query(
        'UPDATE auth.service_key_grants SET organization_id=$1 WHERE key_id=$2',
        [otherOrganizationId, keyId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      fixture.database.query(
        "UPDATE auth.service_key_grants SET actions=actions || ARRAY['credential:manage','service-key:manage','delivery:redrive','*'] WHERE key_id=$1",
        [keyId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await denied(
      await authorize(
        'notification:send',
        { ...scope, environmentId: siblingEnvironmentId },
        headers,
      ),
      404,
      'AUTH_SCOPE_NOT_FOUND',
    );
    await denied(
      await authorize('credential:manage', scope, headers),
      403,
      'AUTH_PERMISSION_DENIED',
    );
    await denied(
      await authorize('service-key:manage', scope, headers),
      403,
      'AUTH_PERMISSION_DENIED',
    );
    await denied(
      await authorize('delivery:redrive', scope, headers),
      403,
      'AUTH_PERMISSION_DENIED',
    );
    await denied(
      await authorize('notification:cancel', scope, headers),
      403,
      'AUTH_PERMISSION_DENIED',
    );
    await fixture.database.query('DELETE FROM auth.members');
    expect((await authorize('notification:send', scope, headers)).status).toBe(200);
    await fixture.database.query(
      'UPDATE auth.api_keys SET rate_limit_enabled=true,request_count=1,rate_limit_max=1,rate_limit_time_window=60000,last_request=now() WHERE id=$1',
      [keyId],
    );
    const throttled = await authorize('notification:send', scope, headers);
    expect(Number(throttled.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(Number(throttled.headers.get('retry-after'))).toBeLessThanOrEqual(60);
    await denied(throttled, 429, 'AUTH_KEY_RATE_LIMITED');
    await fixture.database.query('UPDATE auth.api_keys SET rate_limit_enabled=false WHERE id=$1', [
      keyId,
    ]);
    await revocationWaits('UPDATE auth.api_keys SET enabled=false WHERE id=$1', keyId, headers);
    await denied(
      await authorize('notification:send', scope, headers),
      401,
      'AUTH_CREDENTIALS_INVALID',
    );
    await fixture.database.query(
      "UPDATE auth.api_keys SET enabled=true,expires_at=now()-interval '1 minute' WHERE id=$1",
      [keyId],
    );
    await denied(
      await authorize('notification:send', scope, headers),
      401,
      'AUTH_CREDENTIALS_INVALID',
    );
  });

  it('rejects missing, forged, ambiguous credentials and unsafe cookie origins before domain work', async () => {
    await denied(await authorize('notification:read', scope, {}), 401, 'AUTH_CREDENTIALS_INVALID');
    await denied(
      await authorize('notification:read', scope, { cookie: 'better-auth.session_token=forged' }),
      401,
      'AUTH_CREDENTIALS_INVALID',
    );
    await denied(
      await authorize('notification:read', scope, { cookie, authorization: `Bearer ${key}` }),
      401,
      'AUTH_CREDENTIALS_AMBIGUOUS',
    );
    await denied(
      await authorize('notification:read', scope, {
        cookie: 'better-auth.session_token=forged',
        'x-api-key': key,
      }),
      401,
      'AUTH_CREDENTIALS_AMBIGUOUS',
    );
    await denied(
      await authorize('notification:read', scope, {
        authorization: `Bearer ${key}`,
        'x-api-key': key,
      }),
      401,
      'AUTH_CREDENTIALS_AMBIGUOUS',
    );
    await denied(
      await authorize('notification:read', scope, { authorization: 'Basic forged' }),
      401,
      'AUTH_CREDENTIALS_INVALID',
    );
    await denied(
      await authorize('notification:read', scope, { cookie, origin: 'https://attacker.example' }),
      403,
      'AUTH_ORIGIN_INVALID',
    );
    await denied(
      await authorize('notification:read', scope, { cookie, origin: '' }),
      403,
      'AUTH_ORIGIN_INVALID',
    );
    await fixture.database.query('DELETE FROM auth.sessions WHERE user_id=$1', [userId]);
    await denied(await authorize('notification:read'), 401, 'AUTH_CREDENTIALS_INVALID');
  });
});
