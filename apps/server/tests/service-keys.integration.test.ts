import type { ChildProcess } from 'node:child_process';
import type { AuthFixture } from './fixtures/auth-runtime.ts';
import addFormats from 'ajv-formats';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from 'pg';
import * as v from 'valibot';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { freePort, startAuthFixture, stopProcess } from './fixtures/auth-runtime.ts';

const testUrl = process.env.TEST_AUTH_DATABASE_URL;
const root = fileURLToPath(new URL('../../../', import.meta.url));
const runCommand = promisify(execFile);
const entrypoint = 'apps/server/tests/fixtures/domain-api/.output/server/index.mjs';
const userId = '019a0000-0000-7000-8000-000000000011';
const organizationId = '019a0000-0000-7000-8000-000000000101';
const otherOrganizationId = '019a0000-0000-7000-8000-000000000102';
const projectId = '019a0000-0000-7000-8000-000000000111';
const otherProjectId = '019a0000-0000-7000-8000-000000000112';
const environmentId = '019a0000-0000-7000-8000-000000000121';
const siblingEnvironmentId = '019a0000-0000-7000-8000-000000000122';
const keysPath = `/api/v1/organizations/${organizationId}/projects/${projectId}/environments/${environmentId}/service-keys`;
const scope = { kind: 'environment', organizationId, projectId, environmentId };
const input = {
  name: 'Backend',
  actions: ['notification:read', 'notification:send'],
  expiresIn: 3600,
};
const idSchema = v.pipe(v.string(), v.uuid());
const timestampSchema = v.pipe(v.string(), v.isoTimestamp());
const keyMetadataSchema = v.strictObject({
  id: idSchema,
  organizationId: idSchema,
  projectId: idSchema,
  environmentId: idSchema,
  name: v.nullable(v.string()),
  actions: v.array(v.string()),
  enabled: v.nullable(v.boolean()),
  expiresAt: v.nullable(timestampSchema),
  createdAt: timestampSchema,
  rotatedAt: v.nullable(timestampSchema),
});
const issuedSchema = v.strictObject({ key: v.string(), metadata: keyMetadataSchema });
const rotatedSchema = v.strictObject({
  ...issuedSchema.entries,
  previousKeyExpiresAt: timestampSchema,
});
const pageSchema = v.strictObject({
  items: v.array(keyMetadataSchema),
  nextCursor: v.nullable(v.string()),
});
const problemSchema = v.object({ status: v.number(), code: v.string(), requestId: idSchema });

async function denied(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toContain('application/problem+json');
  expect(response.headers.get('cache-control')).toBe('no-store');
  const problem = v.parse(problemSchema, await response.json());
  expect(problem.code).toBe(code);
  expect(problem.status).toBe(status);
  expect(response.headers.get('x-request-id')).toBe(problem.requestId);
}

describe.skipIf(!testUrl)('service-key HTTP lifecycle with real PostgreSQL', () => {
  let fixture: AuthFixture;
  let replica: ChildProcess | undefined;
  let replicaUrl: string;
  let cookie: string;
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  ajv.addKeyword({ keyword: 'components', valid: true });

  function request(path: string, method?: string, body?: string): Promise<Response> {
    return fetch(`${fixture.baseUrl}${path}`, {
      method,
      headers: { cookie, origin: fixture.baseUrl, 'content-type': 'application/json' },
      body,
    });
  }

  function authorize(
    key: string,
    targetScope = scope,
    action = 'notification:read',
    baseUrl?: string,
  ): Promise<Response> {
    return fetch(`${baseUrl ?? fixture.baseUrl}/api/v1/authorize`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ action, scope: targetScope }),
    });
  }

  function contract(
    schema: string,
    result:
      | v.InferOutput<typeof issuedSchema>
      | v.InferOutput<typeof rotatedSchema>
      | v.InferOutput<typeof pageSchema>,
  ): void {
    expect(
      ajv.validate({ $ref: `pipong#/components/schemas/${schema}` }, result),
      JSON.stringify(ajv.errors),
    ).toBe(true);
  }

  async function issue(expiresIn = 3600): Promise<v.InferOutput<typeof issuedSchema>> {
    const response = await request(keysPath, 'POST', JSON.stringify({ ...input, expiresIn }));
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const result = v.parse(issuedSchema, await response.json());
    contract('IssuedServiceKey', result);
    return result;
  }

  beforeAll(async () => {
    await runCommand(
      'pnpm',
      ['--filter', 'pipong-server', 'exec', 'nitro', 'build', 'tests/fixtures/domain-api'],
      { cwd: root },
    );
    fixture = await startAuthFixture(testUrl ?? '', true, entrypoint);
    await fixture.database.query(
      "INSERT INTO auth.organizations (id,name,slug) VALUES ($1,'First','first'),($2,'Second','second')",
      [organizationId, otherOrganizationId],
    );
    const login = await request(
      '/api/auth/sign-in/email',
      'POST',
      JSON.stringify({ email: 'verified@example.com', password: 'test-password-long-enough' }),
    );
    expect(login.status).toBe(200);
    cookie = login.headers
      .getSetCookie()
      .map((entry) => entry.split(';')[0])
      .join('; ');
    await fixture.database.query('UPDATE auth.users SET two_factor_enabled=true WHERE id=$1', [
      userId,
    ]);
    const response = await fetch(`${fixture.baseUrl}/_openapi.json`);
    const specification = v.parse(
      v.object({
        components: v.object({ schemas: v.record(v.string(), v.looseObject({})) }),
        paths: v.record(v.string(), v.looseObject({})),
      }),
      await response.json(),
    );
    ajv.addSchema({ components: specification.components, $id: 'pipong' });
    for (const schema of [
      'ServiceKey',
      'IssuedServiceKey',
      'ServiceKeyInput',
      'ServiceKeyRotation',
      'RotatedServiceKey',
      'ServiceKeyPage',
      'RevokedServiceKey',
    ]) {
      expect(ajv.getSchema(`pipong#/components/schemas/${schema}`)).toBeTypeOf('function');
    }
    const contractPath =
      '/api/v1/organizations/{organizationId}/projects/{projectId}/environments/{environmentId}/service-keys';
    for (const [path, method, operationId] of [
      [contractPath, 'post', 'issueServiceKey'],
      [contractPath, 'get', 'listServiceKeys'],
      [`${contractPath}/{keyId}/rotate`, 'post', 'rotateServiceKey'],
      [`${contractPath}/{keyId}/revoke`, 'post', 'revokeServiceKey'],
    ]) {
      if (!path || !method || !operationId) {
        throw new Error('TEST_OPERATION_MISSING');
      }

      expect(
        v.parse(v.object({ operationId: v.string() }), specification.paths[path]?.[method])
          .operationId,
      ).toBe(operationId);
    }
    const port = await freePort();
    replicaUrl = `http://localhost:${port}`;
    replica = spawn(process.execPath, [entrypoint], {
      cwd: root,
      env: { ...fixture.environment, PORT: String(port) },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    await vi.waitFor(
      async () => {
        expect((await fetch(`${replicaUrl}/api/auth/get-session`)).status).toBe(200);
      },
      { timeout: 10_000, interval: 100 },
    );
  }, 60_000);

  beforeEach(async () => {
    await fixture.database.query(
      'DELETE FROM auth.service_key_audits; DELETE FROM auth.service_key_grants; DELETE FROM auth.api_keys; DELETE FROM app.environments; DELETE FROM app.projects; DELETE FROM auth.members; DELETE FROM auth.mfa_assurances; DELETE FROM auth.rate_limits',
    );
    await fixture.database.query(
      "INSERT INTO auth.members (id,organization_id,user_id,role) VALUES ($1,$2,$1,'owner')",
      [userId, organizationId],
    );
    await fixture.database.query(
      'INSERT INTO auth.mfa_assurances (session_id,verified_at) SELECT id,now() FROM auth.sessions WHERE user_id=$1',
      [userId],
    );
    await fixture.database.query(
      "INSERT INTO app.projects (id,organization_id,name) VALUES ($1,$2,'First'),($3,$4,'Second')",
      [projectId, organizationId, otherProjectId, otherOrganizationId],
    );
    await fixture.database.query(
      "INSERT INTO app.environments (id,organization_id,project_id,name) VALUES ($1,$2,$3,'Production'),($4,$2,$3,'Development')",
      [environmentId, organizationId, projectId, siblingEnvironmentId],
    );
  });

  afterAll(async () => {
    try {
      await stopProcess(replica);
    } finally {
      if (fixture) {
        await fixture.close();
      }
    }
  });

  it('issues once-visible keys, stores hashes, and lists only scoped metadata with expiry in seconds', async () => {
    const startedAt = Date.now();
    const first = await issue(60);
    expect(first.key.startsWith('pipong_')).toBe(true);
    expect(first.metadata.id[14]).toBe('7');
    expect(first.metadata).toMatchObject({
      organizationId,
      projectId,
      environmentId,
      actions: input.actions,
    });
    const expiry = Date.parse(first.metadata.expiresAt ?? '');
    expect(expiry - startedAt).toBeGreaterThanOrEqual(59_000);
    expect(expiry - startedAt).toBeLessThan(65_000);
    const stored = await fixture.database.query<{ key: string; start: string | null }>(
      'SELECT key,start FROM auth.api_keys WHERE id=$1',
      [first.metadata.id],
    );
    expect(stored.rows[0]?.key).not.toBe(first.key);
    expect(stored.rows[0]?.start).toBeNull();
    expect((await authorize(first.key)).status).toBe(200);
    await issue();
    const firstPage = v.parse(pageSchema, await (await request(`${keysPath}?limit=1`)).json());
    contract('ServiceKeyPage', firstPage);
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = v.parse(
      pageSchema,
      await (await request(`${keysPath}?limit=1&cursor=${firstPage.nextCursor}`)).json(),
    );
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);
    expect(secondPage.nextCursor).toBeNull();
    await denied(
      await request(
        `${keysPath.replace(environmentId, siblingEnvironmentId)}?cursor=${firstPage.nextCursor}`,
      ),
      422,
      'RESOURCE_CURSOR_INVALID',
    );
  });

  it('rejects grant escalation, ambiguous bodies, invalid expiry, and native key mutation endpoints', async () => {
    // oxlint-disable eslint/no-await-in-loop -- Exercise independent invalid boundary cases against the built routes.
    for (const body of [
      { ...input, actions: ['service-key:manage'] },
      { ...input, actions: [] },
      { ...input, actions: ['notification:read', 'notification:read'] },
      { ...input, actions: ['notification:read'], organizationId: otherOrganizationId },
      { ...input, expiresIn: 59 },
      { ...input, expiresIn: 31_536_001 },
      { ...input, expiresIn: 60.5 },
      { ...input, expiresIn: null },
      { ...input, name: ' ' },
      { ...input, name: '\0' },
    ]) {
      await denied(
        await request(keysPath, 'POST', JSON.stringify(body)),
        422,
        'SERVICE_KEY_INPUT_INVALID',
      );
      expect(ajv.validate({ $ref: 'pipong#/components/schemas/ServiceKeyInput' }, body)).toBe(
        false,
      );
    }
    await denied(await request(keysPath, 'POST', '{'), 422, 'SERVICE_KEY_INPUT_INVALID');
    await denied(
      await request(keysPath.replace(environmentId, 'invalid')),
      422,
      'RESOURCE_PATH_INVALID',
    );
    await denied(await request(`${keysPath}?limit=0`), 422, 'RESOURCE_QUERY_INVALID');
    const missingType = await fetch(`${fixture.baseUrl}${keysPath}`, {
      method: 'POST',
      headers: { cookie, origin: fixture.baseUrl },
      body: JSON.stringify(input),
    });
    await denied(missingType, 415, 'RESOURCE_CONTENT_TYPE_INVALID');
    await denied(
      await request(keysPath, 'POST', JSON.stringify({ ...input, name: 'x'.repeat(5000) })),
      413,
      'RESOURCE_BODY_TOO_LARGE',
    );
    const issued = await issue();
    for (const body of [
      { expiresIn: 3600, overlapSeconds: -1 },
      { expiresIn: 3600, overlapSeconds: 86_401 },
      { expiresIn: 3600, overlapSeconds: 0, actions: ['notification:send'] },
    ]) {
      await denied(
        await request(`${keysPath}/${issued.metadata.id}/rotate`, 'POST', JSON.stringify(body)),
        422,
        'SERVICE_KEY_INPUT_INVALID',
      );
      expect(ajv.validate({ $ref: 'pipong#/components/schemas/ServiceKeyRotation' }, body)).toBe(
        false,
      );
    }
    for (const operation of ['create', 'update', 'delete', 'delete-all-expired-api-keys']) {
      const response = await request(`/api/auth/api-key/${operation}`, 'POST', '{}');
      expect(response.status).toBe(403);
      expect(v.parse(v.object({ code: v.string() }), await response.json()).code).toBe(
        'AUTH_ENDPOINT_DISABLED',
      );
    }
    // oxlint-enable eslint/no-await-in-loop
  });

  it('enforces nested ownership, human roles, recent MFA, and immutable key grants', async () => {
    const issued = await issue();
    await denied(
      await authorize(issued.key, { ...scope, environmentId: siblingEnvironmentId }),
      404,
      'AUTH_SCOPE_NOT_FOUND',
    );
    await denied(
      await authorize(issued.key, scope, 'recipient:write'),
      403,
      'AUTH_PERMISSION_DENIED',
    );
    const keyList = await fetch(`${fixture.baseUrl}${keysPath}`, {
      headers: { 'x-api-key': issued.key },
    });
    await denied(keyList, 403, 'AUTH_PERMISSION_DENIED');
    await denied(
      await request(keysPath.replace(organizationId, otherOrganizationId)),
      404,
      'AUTH_SCOPE_NOT_FOUND',
    );
    await denied(
      await request(
        `${keysPath.replace(environmentId, siblingEnvironmentId)}/${issued.metadata.id}/revoke`,
        'POST',
      ),
      404,
      'SERVICE_KEY_NOT_FOUND',
    );
    await fixture.database.query("UPDATE auth.members SET role='member'");
    await denied(await request(keysPath), 403, 'AUTH_PERMISSION_DENIED');
    await denied(
      await request(keysPath, 'POST', JSON.stringify(input)),
      403,
      'AUTH_PERMISSION_DENIED',
    );
    await fixture.database.query(
      "UPDATE auth.members SET role='admin'; DELETE FROM auth.mfa_assurances",
    );
    expect((await request(keysPath)).status).toBe(200);
    await denied(
      await request(`${keysPath}/${issued.metadata.id}/revoke`, 'POST'),
      403,
      'AUTH_RECENT_MFA_REQUIRED',
    );
    await denied(
      await request(
        `${keysPath}/${issued.metadata.id}/rotate`,
        'POST',
        JSON.stringify({ expiresIn: 3600, overlapSeconds: 0 }),
      ),
      403,
      'AUTH_RECENT_MFA_REQUIRED',
    );
    const runtime = new Client({ connectionString: fixture.environment.API_DATABASE_URL });
    await runtime.connect();

    try {
      await expect(
        runtime.query(
          "UPDATE auth.service_key_grants SET actions=ARRAY['notification:send'] WHERE key_id=$1",
          [issued.metadata.id],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        runtime.query('UPDATE auth.service_key_grants SET environment_id=$1 WHERE key_id=$2', [
          siblingEnvironmentId,
          issued.metadata.id,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        runtime.query('UPDATE auth.api_keys SET reference_id=$1 WHERE id=$2', [
          otherOrganizationId,
          issued.metadata.id,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        runtime.query('DELETE FROM auth.api_keys WHERE id=$1', [issued.metadata.id]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(runtime.query('DELETE FROM auth.service_key_audits')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await runtime.end();
    }
  });

  it('preserves integrations after creator departure and observes overlap, expiry, and revocation across replicas', async () => {
    const issued = await issue();
    await fixture.database.query('DELETE FROM auth.members WHERE user_id=$1', [userId]);
    expect((await authorize(issued.key, scope, 'notification:read', replicaUrl)).status).toBe(200);
    await fixture.database.query(
      "INSERT INTO auth.members (id,organization_id,user_id,role) VALUES ($1,$2,$1,'owner')",
      [userId, organizationId],
    );
    const response = await request(
      `${keysPath}/${issued.metadata.id}/rotate`,
      'POST',
      JSON.stringify({ expiresIn: 3600, overlapSeconds: 2 }),
    );
    expect(response.status).toBe(201);
    const rotated = v.parse(rotatedSchema, await response.json());
    contract('RotatedServiceKey', rotated);
    expect(rotated.metadata.actions).toEqual(issued.metadata.actions);
    expect((await authorize(issued.key)).status).toBe(200);
    expect((await authorize(rotated.key, scope, 'notification:read', replicaUrl)).status).toBe(200);
    await expect
      .poll(
        async () => (await authorize(issued.key, scope, 'notification:read', replicaUrl)).status,
        { timeout: 5000 },
      )
      .toBe(401);
    await denied(await authorize(issued.key), 401, 'AUTH_CREDENTIALS_INVALID');
    const retained = v.parse(pageSchema, await (await request(keysPath)).json());
    expect(retained.items).toHaveLength(2);
    expect(retained.items.find(({ id }) => id === issued.metadata.id)?.rotatedAt).not.toBeNull();
    const revoked = await request(`${keysPath}/${rotated.metadata.id}/revoke`, 'POST');
    expect(revoked.status).toBe(200);
    const result = v.parse(
      v.strictObject({ id: idSchema, revoked: v.literal(true) }),
      await revoked.json(),
    );
    expect(ajv.validate({ $ref: 'pipong#/components/schemas/RevokedServiceKey' }, result)).toBe(
      true,
    );
    await denied(
      await authorize(rotated.key, scope, 'notification:read', replicaUrl),
      401,
      'AUTH_CREDENTIALS_INVALID',
    );
    expect((await request(`${keysPath}/${rotated.metadata.id}/revoke`, 'POST')).status).toBe(200);
    const audit = await fixture.database.query<{ count: string }>(
      "SELECT count(*) FROM auth.service_key_audits WHERE key_id=$1 AND action='revoked'",
      [rotated.metadata.id],
    );
    expect(audit.rows[0]?.count).toBe('1');
    await denied(
      await request(
        `${keysPath}/${rotated.metadata.id}/rotate`,
        'POST',
        JSON.stringify({ expiresIn: 3600, overlapSeconds: 0 }),
      ),
      409,
      'SERVICE_KEY_INACTIVE',
    );
  });

  it('rolls back failed issuance, rejects unbound keys, and serializes concurrent lifecycle changes', async () => {
    await fixture.database.query(
      "CREATE FUNCTION auth.reject_key_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$; CREATE TRIGGER reject_key_audit BEFORE INSERT ON auth.service_key_audits FOR EACH ROW EXECUTE FUNCTION auth.reject_key_audit()",
    );

    try {
      await denied(
        await request(keysPath, 'POST', JSON.stringify(input)),
        503,
        'AUTHORIZATION_UNAVAILABLE',
      );
      const counts = await fixture.database.query<{ keys: string; grants: string }>(
        'SELECT (SELECT count(*) FROM auth.api_keys) AS keys, (SELECT count(*) FROM auth.service_key_grants) AS grants',
      );
      expect(counts.rows[0]).toEqual({ keys: '0', grants: '0' });
    } finally {
      await fixture.database.query(
        'DROP TRIGGER reject_key_audit ON auth.service_key_audits; DROP FUNCTION auth.reject_key_audit()',
      );
    }

    const orphan = await issue();
    await fixture.database.query('DELETE FROM auth.service_key_grants WHERE key_id=$1', [
      orphan.metadata.id,
    ]);
    await denied(await authorize(orphan.key), 404, 'AUTH_SCOPE_NOT_FOUND');
    const issued = await issue();
    const responses = await Promise.all([
      request(
        `${keysPath}/${issued.metadata.id}/rotate`,
        'POST',
        JSON.stringify({ expiresIn: 3600, overlapSeconds: 60 }),
      ),
      request(
        `${keysPath}/${issued.metadata.id}/rotate`,
        'POST',
        JSON.stringify({ expiresIn: 3600, overlapSeconds: 60 }),
      ),
    ]);
    expect(
      responses.map(({ status }) => status).toSorted((first, second) => first - second),
    ).toEqual([201, 409]);
    const conflicting = responses.find(({ status }) => status === 409);

    if (!conflicting) {
      throw new Error('TEST_CONFLICT_MISSING');
    }

    await denied(conflicting, 409, 'SERVICE_KEY_ALREADY_ROTATED');
    const blocker = new Client({ connectionString: fixture.environment.API_DATABASE_URL });
    await blocker.connect();
    let revocation: Promise<Response> | undefined;

    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM auth.api_keys WHERE id=$1 FOR SHARE', [
        issued.metadata.id,
      ]);
      revocation = request(`${keysPath}/${issued.metadata.id}/revoke`, 'POST');
      await expect
        .poll(async () => {
          const waiting = await fixture.database.query<{ count: string }>(
            "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND usename='pipong_api' AND wait_event_type='Lock' AND query LIKE '%api_keys%'",
          );
          return Number(waiting.rows[0]?.count);
        })
        .toBe(1);
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
      await revocation;
    }

    if (revocation === undefined) {
      throw new Error('TEST_REVOCATION_MISSING');
    }

    expect((await revocation).status).toBe(200);
    await denied(
      await authorize(issued.key, scope, 'notification:read', replicaUrl),
      401,
      'AUTH_CREDENTIALS_INVALID',
    );
    const audits = await fixture.database.query<{ action: string }>(
      'SELECT action FROM auth.service_key_audits WHERE key_id=$1 ORDER BY created_at,id',
      [issued.metadata.id],
    );
    expect(audits.rows.map(({ action }) => action)).toEqual(['issued', 'rotated', 'revoked']);
  });
});
