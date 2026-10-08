import type { AuthFixture } from './fixtures/auth-runtime.ts';
import addFormats from 'ajv-formats';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { execFile } from 'node:child_process';
import { createECDH } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
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
const otherProjectId = '019a0000-0000-7000-8000-000000000112';
const siblingProjectId = '019a0000-0000-7000-8000-000000000113';
const environmentId = '019a0000-0000-7000-8000-000000000121';
const siblingEnvironmentId = '019a0000-0000-7000-8000-000000000122';
const otherEnvironmentId = '019a0000-0000-7000-8000-000000000123';
const projectsPath = `/api/v1/organizations/${organizationId}/projects`;
const environmentsPath = `${projectsPath}/${projectId}/environments`;
const idSchema = v.pipe(v.string(), v.uuid());
const timestampSchema = v.pipe(v.string(), v.isoTimestamp());
const credentialSchema = v.strictObject({
  id: idSchema,
  organizationId: idSchema,
  projectId: idSchema,
  environmentId: idSchema,
  provider: v.picklist(['apns', 'fcm', 'web-push']),
  appId: v.string(),
  publicKey: v.nullable(v.string()),
  state: v.picklist(['inactive', 'active', 'retired']),
  createdAt: timestampSchema,
  retiredAt: v.nullable(timestampSchema),
});
const pageSchema = v.strictObject({
  items: v.array(credentialSchema),
  nextCursor: v.nullable(v.string()),
});
const problemSchema = v.object({ status: v.number(), code: v.string(), requestId: idSchema });
const contractSchema = v.object({
  components: v.object({
    schemas: v.record(v.string(), v.looseObject({})),
    securitySchemes: v.object({
      serviceKey: v.strictObject({
        type: v.literal('apiKey'),
        in: v.literal('header'),
        name: v.literal('x-api-key'),
      }),
    }),
  }),
  paths: v.record(v.string(), v.looseObject({})),
});
const credentialsPath = `${environmentsPath}/${environmentId}/credentials`;

async function denied(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toContain('application/problem+json');
  expect(response.headers.get('cache-control')).toBe('no-store');
  const problem = v.parse(problemSchema, await response.json());
  expect(problem.code).toBe(code);
  expect(problem.status).toBe(status);
  expect(response.headers.get('x-request-id')).toBe(problem.requestId);
}

describe.skipIf(!testUrl)('credential HTTP operations with real PostgreSQL', () => {
  let fixture: AuthFixture;
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

  async function credential(response: Response): Promise<v.InferOutput<typeof credentialSchema>> {
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const result = v.parse(credentialSchema, await response.json());
    expect(
      ajv.validate({ $ref: 'pipong#/components/schemas/CredentialVersion' }, result),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    return result;
  }

  const vapid = createECDH('prime256v1');
  vapid.generateKeys();
  const privateKey = vapid.getPrivateKey().toString('base64url');
  const input = { provider: 'web-push', appId: 'web-app', secret: { privateKey } };

  function create(path = credentialsPath): Promise<Response> {
    return request(path, 'POST', JSON.stringify(input));
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
      "INSERT INTO auth.organizations (id,name,slug) VALUES ($1,'First','first'),($2,'Second','second')",
      [organizationId, otherOrganizationId],
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
    const contractResponse = await fetch(`${fixture.baseUrl}/_openapi.json`);
    expect(contractResponse.status).toBe(200);
    const contract = v.parse(contractSchema, await contractResponse.json());
    ajv.addSchema({ $id: 'pipong', components: contract.components });
    for (const name of [
      'CredentialVersion',
      'CredentialInput',
      'CredentialPage',
      'VapidPublicKey',
    ]) {
      expect(ajv.getSchema(`pipong#/components/schemas/${name}`)).toBeTypeOf('function');
    }
    const prefix =
      '/api/v1/organizations/{organizationId}/projects/{projectId}/environments/{environmentId}/credentials';
    for (const [path, method, operationId] of [
      [prefix, 'post', 'createCredentialVersion'],
      [prefix, 'get', 'listCredentialVersions'],
      [`${prefix}/{credentialId}`, 'get', 'readCredentialVersion'],
      [`${prefix}/{credentialId}/activate`, 'post', 'activateCredentialVersion'],
      [`${prefix}/{credentialId}/retire`, 'post', 'retireCredentialVersion'],
      [`${prefix}/{credentialId}/rotate-encryption`, 'post', 'rotateCredentialEncryption'],
      [`${prefix}/{credentialId}/public-key`, 'get', 'readVapidPublicKey'],
    ]) {
      if (!path || !method || !operationId) {
        throw new Error('TEST_OPERATION_MISSING');
      }

      const entry = v.parse(v.object({ operationId: v.string() }), contract.paths[path]?.[method]);
      expect(entry.operationId).toBe(operationId);
    }
  }, 60_000);

  beforeEach(async () => {
    await writeFile(
      fixture.environment.CREDENTIAL_KEYRING_REF ?? '',
      JSON.stringify({ activeKeyId: 'first', keys: { first: '11'.repeat(32) } }),
    );
    await fixture.database.query(
      'DELETE FROM auth.service_key_audits; DELETE FROM auth.service_key_grants; DELETE FROM auth.api_keys; DELETE FROM app.credential_versions; DELETE FROM app.recipients; DELETE FROM app.environments; DELETE FROM app.projects; DELETE FROM auth.members; DELETE FROM auth.mfa_assurances; DELETE FROM auth.rate_limits',
    );
    await fixture.database.query(
      "INSERT INTO auth.members (id,organization_id,user_id,role) VALUES ($1,$2,$1,'owner'),($3,$4,$1,'owner')",
      [userId, organizationId, otherOrganizationId, otherOrganizationId],
    );
    await fixture.database.query(
      'INSERT INTO auth.mfa_assurances (session_id,verified_at) SELECT id,now() FROM auth.sessions WHERE user_id=$1',
      [userId],
    );
    await fixture.database.query(
      "INSERT INTO app.projects (id,organization_id,name) VALUES ($1,$2,'First'),($3,$4,'Second'),($5,$2,'Sibling')",
      [projectId, organizationId, otherProjectId, otherOrganizationId, siblingProjectId],
    );
    await fixture.database.query(
      "INSERT INTO app.environments (id,organization_id,project_id,name) VALUES ($1,$2,$3,'Production'),($4,$2,$3,'Development'),($5,$6,$7,'Other')",
      [
        environmentId,
        organizationId,
        projectId,
        siblingEnvironmentId,
        otherEnvironmentId,
        otherOrganizationId,
        otherProjectId,
      ],
    );
  });

  afterAll(async () => {
    if (fixture) {
      await fixture.close();
    }
  });

  it('creates encrypted immutable versions and publishes only active VAPID public keys', async () => {
    expect(ajv.validate({ $ref: 'pipong#/components/schemas/CredentialInput' }, input)).toBe(true);
    const record = await credential(await create());
    expect(record.state).toBe('inactive');
    expect(record.publicKey).toBe(vapid.getPublicKey().toString('base64url'));
    expect(JSON.stringify(record)).not.toContain(privateKey);
    const stored = await fixture.database.query<{ encrypted_secret: string }>(
      'SELECT encrypted_secret FROM app.credential_versions WHERE id=$1',
      [record.id],
    );
    expect(stored.rows[0]?.encrypted_secret).not.toContain(privateKey);
    expect(await credential(await request(`${credentialsPath}/${record.id}`))).toEqual(record);
    await denied(
      await request(`${credentialsPath}/${record.id}/public-key`),
      409,
      'CREDENTIAL_NOT_ACTIVE_WEB_PUSH',
    );
    const active = await credential(
      await request(`${credentialsPath}/${record.id}/activate`, 'POST'),
    );
    expect(active.state).toBe('active');
    const response = await request(`${credentialsPath}/${record.id}/public-key`);
    expect(response.status).toBe(200);
    const publicKey = v.parse(
      v.strictObject({ credentialId: idSchema, publicKey: v.string() }),
      await response.json(),
    );
    expect(publicKey).toEqual({ credentialId: record.id, publicKey: record.publicKey });
    expect(ajv.validate({ $ref: 'pipong#/components/schemas/VapidPublicKey' }, publicKey)).toBe(
      true,
    );
    const pageResponse = await request(credentialsPath);
    const page = v.parse(pageSchema, await pageResponse.json());
    expect(ajv.validate({ $ref: 'pipong#/components/schemas/CredentialPage' }, page)).toBe(true);
    expect(page.items).toEqual([active]);
  });

  it('serializes concurrent activations and permanently retires versions', async () => {
    const first = await credential(await create());
    const second = await credential(await create());
    const responses = await Promise.all([
      request(`${credentialsPath}/${first.id}/activate`, 'POST'),
      request(`${credentialsPath}/${second.id}/activate`, 'POST'),
    ]);

    const activated = await Promise.all(responses.map((response) => credential(response)));

    for (const record of activated) {
      expect(record.state).toBe('active');
    }

    const page = v.parse(pageSchema, await (await request(credentialsPath)).json());
    let activeId = '';
    let activeCount = 0;

    for (const record of page.items) {
      if (record.state === 'active') {
        activeId = record.id;
        activeCount++;
      }
    }

    expect(activeCount).toBe(1);
    expect(page.items.some((record) => record.state === 'inactive')).toBe(true);
    const retired = await credential(
      await request(`${credentialsPath}/${activeId}/retire`, 'POST'),
    );
    expect(retired.state).toBe('retired');
    expect(
      await credential(await request(`${credentialsPath}/${activeId}/retire`, 'POST')),
    ).toEqual(retired);
    await denied(
      await request(`${credentialsPath}/${activeId}/activate`, 'POST'),
      409,
      'CREDENTIAL_RETIRED',
    );
    await denied(
      await request(`${credentialsPath}/${activeId}/public-key`),
      409,
      'CREDENTIAL_NOT_ACTIVE_WEB_PUSH',
    );
  });

  it('rotates encryption in place, fails closed on removed keys, and authenticates provider bindings', async () => {
    const record = await credential(await create());
    const keyringPath = fixture.environment.CREDENTIAL_KEYRING_REF ?? '';
    await writeFile(
      keyringPath,
      JSON.stringify({ activeKeyId: 'second', keys: { second: '22'.repeat(32) } }),
    );
    await denied(
      await request(`${credentialsPath}/${record.id}/activate`, 'POST'),
      503,
      'AUTHORIZATION_UNAVAILABLE',
    );
    await denied(
      await request(`${credentialsPath}/${record.id}/rotate-encryption`, 'POST'),
      503,
      'AUTHORIZATION_UNAVAILABLE',
    );
    expect((await credential(await request(`${credentialsPath}/${record.id}`))).state).toBe(
      'inactive',
    );
    await writeFile(
      keyringPath,
      JSON.stringify({
        activeKeyId: 'second',
        keys: { first: '11'.repeat(32), second: '22'.repeat(32) },
      }),
    );
    expect(
      await credential(await request(`${credentialsPath}/${record.id}/rotate-encryption`, 'POST')),
    ).toEqual(record);
    await writeFile(
      keyringPath,
      JSON.stringify({ activeKeyId: 'second', keys: { second: '22'.repeat(32) } }),
    );
    expect(
      (await credential(await request(`${credentialsPath}/${record.id}/activate`, 'POST'))).state,
    ).toBe('active');
    await fixture.database.query('UPDATE app.credential_versions SET app_id=$2 WHERE id=$1', [
      record.id,
      'changed-binding',
    ]);
    await denied(
      await request(`${credentialsPath}/${record.id}/activate`, 'POST'),
      503,
      'AUTHORIZATION_UNAVAILABLE',
    );
    await fixture.database.query('UPDATE app.credential_versions SET app_id=$2 WHERE id=$1', [
      record.id,
      input.appId,
    ]);
    const otherPath = credentialsPath
      .replace(organizationId, otherOrganizationId)
      .replace(projectId, otherProjectId)
      .replace(environmentId, otherEnvironmentId);
    const copied = await credential(await create(otherPath));
    await fixture.database.query(
      'UPDATE app.credential_versions SET encrypted_secret=(SELECT encrypted_secret FROM app.credential_versions WHERE id=$1) WHERE id=$2',
      [record.id, copied.id],
    );
    await denied(
      await request(`${otherPath}/${copied.id}/activate`, 'POST'),
      503,
      'AUTHORIZATION_UNAVAILABLE',
    );
  });

  it('rejects boundary errors and cursors from other collections and environments', async () => {
    await denied(
      await request(credentialsPath, 'POST', JSON.stringify({ ...input, unexpected: true })),
      422,
      'RESOURCE_INPUT_INVALID',
    );
    await denied(
      await request(
        credentialsPath,
        'POST',
        JSON.stringify({ ...input, secret: { privateKey: 'invalid-secret-value' } }),
      ),
      422,
      'RESOURCE_INPUT_INVALID',
    );
    await denied(
      await request(
        credentialsPath,
        'POST',
        JSON.stringify({ ...input, secret: { privateKey: 'x'.repeat(32768) } }),
      ),
      413,
      'RESOURCE_BODY_TOO_LARGE',
    );
    const wrongType = await fetch(`${fixture.baseUrl}${credentialsPath}`, {
      method: 'POST',
      headers: { cookie, origin: fixture.baseUrl, 'content-type': 'text/plain' },
      body: JSON.stringify(input),
    });
    await denied(wrongType, 415, 'RESOURCE_CONTENT_TYPE_INVALID');
    await credential(await create());
    await credential(await create());
    const page = v.parse(pageSchema, await (await request(`${credentialsPath}?limit=1`)).json());
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTypeOf('string');
    const next = v.parse(
      pageSchema,
      await (await request(`${credentialsPath}?limit=1&cursor=${page.nextCursor}`)).json(),
    );
    expect(next.items).toHaveLength(1);
    expect(next.items[0]?.id).not.toBe(page.items[0]?.id);
    await denied(
      await request(
        `${environmentsPath}/${siblingEnvironmentId}/credentials?cursor=${page.nextCursor}`,
      ),
      422,
      'RESOURCE_CURSOR_INVALID',
    );
    await denied(
      await request(`${environmentsPath}/${environmentId}/recipients?cursor=${page.nextCursor}`),
      422,
      'RESOURCE_CURSOR_INVALID',
    );
    await denied(
      await request(`${credentialsPath}?limit=1&limit=2`),
      422,
      'RESOURCE_INPUT_INVALID',
    );
  });

  it('enforces scope, recent MFA, live authority, RLS, and immutable database ownership', async () => {
    const record = await credential(await create());
    await denied(
      await request(`${environmentsPath}/${siblingEnvironmentId}/credentials/${record.id}`),
      404,
      'RESOURCE_NOT_FOUND',
    );
    await denied(
      await request(credentialsPath.replace(projectId, siblingProjectId)),
      404,
      'AUTH_SCOPE_NOT_FOUND',
    );
    await credential(await request(`${credentialsPath}/${record.id}/activate`, 'POST'));
    const issuedResponse = await request(
      credentialsPath.replace('/credentials', '/service-keys'),
      'POST',
      JSON.stringify({ name: 'Public key reader', actions: ['endpoint:read'], expiresIn: 3600 }),
    );
    expect(issuedResponse.status).toBe(201);
    const issued = v.parse(v.object({ key: v.string() }), await issuedResponse.json());

    function keyRequest(path: string, method?: string, body?: string): Promise<Response> {
      return fetch(`${fixture.baseUrl}${path}`, {
        method,
        headers: { 'x-api-key': issued.key, 'content-type': 'application/json' },
        body,
      });
    }

    expect((await keyRequest(`${credentialsPath}/${record.id}/public-key`)).status).toBe(200);
    await denied(await keyRequest(credentialsPath), 403, 'AUTH_PERMISSION_DENIED');
    await denied(
      await keyRequest(credentialsPath, 'POST', JSON.stringify(input)),
      403,
      'AUTH_PERMISSION_DENIED',
    );
    await denied(
      await keyRequest(`${credentialsPath}/${record.id}/retire`, 'POST'),
      403,
      'AUTH_PERMISSION_DENIED',
    );
    await denied(
      await keyRequest(
        `${environmentsPath}/${siblingEnvironmentId}/credentials/${record.id}/public-key`,
      ),
      404,
      'AUTH_SCOPE_NOT_FOUND',
    );
    await fixture.database.query('DELETE FROM auth.mfa_assurances');
    await denied(await create(), 403, 'AUTH_RECENT_MFA_REQUIRED');
    await denied(
      await request(`${credentialsPath}/${record.id}/activate`, 'POST'),
      403,
      'AUTH_RECENT_MFA_REQUIRED',
    );
    await fixture.database.query("UPDATE auth.members SET role='member' WHERE organization_id=$1", [
      organizationId,
    ]);
    await denied(await request(`${credentialsPath}/${record.id}`), 403, 'AUTH_PERMISSION_DENIED');
    await fixture.database.query('DELETE FROM auth.members WHERE organization_id=$1', [
      organizationId,
    ]);
    await denied(await request(credentialsPath), 404, 'AUTH_SCOPE_NOT_FOUND');
    const api = new Client({ connectionString: fixture.environment.API_DATABASE_URL });
    await api.connect();

    try {
      expect((await api.query('SELECT id FROM app.credential_versions')).rows).toHaveLength(0);
      await api.query('BEGIN');
      await api.query(
        "SELECT set_config('pipong.organization_id',$1,true), set_config('pipong.project_id',$2,true), set_config('pipong.environment_id',$3,true)",
        [organizationId, projectId, siblingEnvironmentId],
      );
      expect((await api.query('SELECT id FROM app.credential_versions')).rows).toHaveLength(0);
      await api.query('ROLLBACK');
      await api.query('BEGIN');
      await api.query(
        "SELECT set_config('pipong.organization_id',$1,true), set_config('pipong.project_id',$2,true), set_config('pipong.environment_id',$3,true)",
        [organizationId, projectId, environmentId],
      );
      await api.query(
        "UPDATE app.credential_versions SET state='retired', retired_at=now() WHERE id=$1",
        [record.id],
      );
      await api.query('COMMIT');
      await api.query('BEGIN');
      await api.query(
        "SELECT set_config('pipong.organization_id',$1,true), set_config('pipong.project_id',$2,true), set_config('pipong.environment_id',$3,true)",
        [organizationId, projectId, environmentId],
      );
      await expect(
        api.query(
          "UPDATE app.credential_versions SET state='active', retired_at=null WHERE id=$1",
          [record.id],
        ),
      ).rejects.toThrow('CREDENTIAL_RETIRED');
      await api.query('ROLLBACK');

      await expect(
        api.query('UPDATE app.credential_versions SET app_id=$1 WHERE id=$2', [
          'changed',
          record.id,
        ]),
      ).rejects.toThrow('permission denied');
      await expect(
        api.query('DELETE FROM app.credential_versions WHERE id=$1', [record.id]),
      ).rejects.toThrow('permission denied');
    } finally {
      await api.end();
    }
  });
});
