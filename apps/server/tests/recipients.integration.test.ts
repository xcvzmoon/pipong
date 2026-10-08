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
const otherOrganizationId = '019a0000-0000-7000-8000-000000000102';
const projectId = '019a0000-0000-7000-8000-000000000111';
const otherProjectId = '019a0000-0000-7000-8000-000000000112';
const siblingProjectId = '019a0000-0000-7000-8000-000000000113';
const environmentId = '019a0000-0000-7000-8000-000000000121';
const siblingEnvironmentId = '019a0000-0000-7000-8000-000000000122';
const projectsPath = `/api/v1/organizations/${organizationId}/projects`;
const environmentsPath = `${projectsPath}/${projectId}/environments`;
const idSchema = v.pipe(v.string(), v.uuid());
const timestampSchema = v.pipe(v.string(), v.isoTimestamp());
const recipientSchema = v.strictObject({
  id: idSchema,
  organizationId: idSchema,
  projectId: idSchema,
  environmentId: idSchema,
  externalId: v.string(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deletedAt: v.null(),
});
const pageSchema = v.strictObject({
  items: v.array(recipientSchema),
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
const recipientsPath = `${environmentsPath}/${environmentId}/recipients`;

async function denied(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toContain('application/problem+json');
  expect(response.headers.get('cache-control')).toBe('no-store');
  const problem = v.parse(problemSchema, await response.json());
  expect(problem.code).toBe(code);
  expect(problem.status).toBe(status);
  expect(response.headers.get('x-request-id')).toBe(problem.requestId);
}

describe.skipIf(!testUrl)('recipient HTTP operations with real PostgreSQL', () => {
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

  async function recipient(response: Response): Promise<v.InferOutput<typeof recipientSchema>> {
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const result = v.parse(recipientSchema, await response.json());
    expect(
      ajv.validate({ $ref: 'pipong#/components/schemas/Recipient' }, result),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    return result;
  }

  function upsert(externalId: string, path = recipientsPath): Promise<Response> {
    return request(path, 'PUT', JSON.stringify({ externalId }));
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
    for (const name of ['Recipient', 'RecipientInput', 'RecipientPage']) {
      expect(ajv.getSchema(`pipong#/components/schemas/${name}`)).toBeTypeOf('function');
    }
    const prefix =
      '/api/v1/organizations/{organizationId}/projects/{projectId}/environments/{environmentId}/recipients';
    for (const [path, method, operationId] of [
      [prefix, 'put', 'upsertRecipient'],
      [prefix, 'get', 'listRecipients'],
      [`${prefix}/{recipientId}`, 'get', 'readRecipient'],
      [`${prefix}/{recipientId}`, 'delete', 'deleteRecipient'],
    ]) {
      if (!path || !method || !operationId) throw new Error('TEST_OPERATION_MISSING');
      const entry = v.parse(v.object({ operationId: v.string() }), contract.paths[path]?.[method]);
      expect(entry.operationId).toBe(operationId);
    }
  }, 60_000);

  beforeEach(async () => {
    await fixture.database.query(
      'DELETE FROM auth.service_key_audits; DELETE FROM auth.service_key_grants; DELETE FROM auth.api_keys; DELETE FROM app.recipients; DELETE FROM app.environments; DELETE FROM app.projects; DELETE FROM auth.members; DELETE FROM auth.mfa_assurances; DELETE FROM auth.rate_limits',
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
      "INSERT INTO app.environments (id,organization_id,project_id,name) VALUES ($1,$2,$3,'Production'),($4,$2,$3,'Development')",
      [environmentId, organizationId, projectId, siblingEnvironmentId],
    );
  });

  afterAll(async () => {
    if (fixture) {
      await fixture.close();
    }
  });

  it('upserts scoped identities atomically and returns only recipient metadata', async () => {
    const responses = await Promise.all([
      upsert('customer@example.com'),
      upsert('customer@example.com'),
    ]);
    const records = await Promise.all(responses.map((response) => recipient(response)));
    const first = records[0];
    if (!first) throw new Error('TEST_RECIPIENT_MISSING');
    expect(records[1]?.id).toBe(first.id);
    expect(first.id[14]).toBe('7');
    expect(first.externalId).toBe('customer@example.com');
    expect(first.environmentId).toBe(environmentId);
    const repeated = await recipient(await upsert('customer@example.com'));
    expect(repeated.id).toBe(first.id);
    expect(repeated.createdAt).toBe(first.createdAt);
    const sibling = await recipient(
      await upsert(
        'customer@example.com',
        recipientsPath.replace(environmentId, siblingEnvironmentId),
      ),
    );
    expect(sibling.id).not.toBe(first.id);
    expect(sibling.environmentId).toBe(siblingEnvironmentId);
    expect((await recipient(await request(`${recipientsPath}/${first.id}`))).id).toBe(first.id);
    const caseSensitive = await recipient(await upsert('Customer@example.com'));
    expect(caseSensitive.id).not.toBe(first.id);
    const whitespace = await recipient(await upsert(' customer@example.com '));
    expect(whitespace.externalId).toBe(' customer@example.com ');
    const counts = await fixture.database.query<{ count: string }>(
      'SELECT count(*) FROM app.recipients WHERE external_id=$1 AND environment_id=$2',
      ['customer@example.com', environmentId],
    );
    expect(counts.rows[0]?.count).toBe('1');
  });

  it('rejects invalid identities and ambiguous request boundaries with matching OpenAPI validation', async () => {
    // oxlint-disable eslint/no-await-in-loop -- Each case exercises a distinct built HTTP boundary.
    for (const externalId of ['', ' ', 'x'.repeat(201), 'bad\0id', 'bad\nid', '\uD800', '\u0085']) {
      const input = { externalId };
      expect(ajv.validate({ $ref: 'pipong#/components/schemas/RecipientInput' }, input)).toBe(
        false,
      );
      await denied(
        await request(recipientsPath, 'PUT', JSON.stringify(input)),
        422,
        'RESOURCE_INPUT_INVALID',
      );
    }
    for (const externalId of ['😀'.repeat(200), 'customer-42']) {
      expect(
        ajv.validate({ $ref: 'pipong#/components/schemas/RecipientInput' }, { externalId }),
      ).toBe(true);
      expect((await recipient(await upsert(externalId))).externalId).toBe(externalId);
    }
    await denied(await request(recipientsPath, 'PUT', '{'), 422, 'RESOURCE_INPUT_INVALID');
    await denied(
      await request(recipientsPath, 'PUT', JSON.stringify({ externalId: 'valid', organizationId })),
      422,
      'RESOURCE_INPUT_INVALID',
    );
    await denied(await upsert('x'.repeat(5000)), 413, 'RESOURCE_BODY_TOO_LARGE');
    await denied(
      await fetch(`${fixture.baseUrl}${recipientsPath}`, {
        method: 'PUT',
        headers: { cookie, origin: fixture.baseUrl, 'content-type': 'text/plain' },
        body: '{}',
      }),
      415,
      'RESOURCE_CONTENT_TYPE_INVALID',
    );
    for (const query of ['limit=0', 'limit=101', 'limit=1&limit=2', 'extra=true', 'cursor=!']) {
      await denied(await request(`${recipientsPath}?${query}`), 422, 'RESOURCE_INPUT_INVALID');
    }
    await denied(
      await request(recipientsPath.replace(environmentId, 'invalid')),
      422,
      'RESOURCE_PATH_INVALID',
    );
    await denied(await request(`${recipientsPath}/invalid`), 422, 'RESOURCE_PATH_INVALID');
    // oxlint-enable eslint/no-await-in-loop
  });

  it('hides wrong tenants and enforces immutable ownership, row security, and collection-bound pagination', async () => {
    const first = await recipient(await upsert('first'));
    const second = await recipient(await upsert('second'));
    const response = await request(`${recipientsPath}?limit=1`);
    expect(response.status).toBe(200);
    const page = v.parse(pageSchema, await response.json());
    expect(ajv.validate({ $ref: 'pipong#/components/schemas/RecipientPage' }, page)).toBe(true);
    expect(page.items.map(({ id }) => id)).toEqual([first.id]);
    const next = v.parse(
      pageSchema,
      await (await request(`${recipientsPath}?limit=1&cursor=${page.nextCursor}`)).json(),
    );
    expect(next.items.map(({ id }) => id)).toEqual([second.id]);
    expect(next.nextCursor).toBeNull();
    // oxlint-disable eslint/no-await-in-loop -- Verify each tenant and collection boundary.
    for (const path of [
      recipientsPath.replace(environmentId, siblingEnvironmentId),
      recipientsPath.replace(organizationId, otherOrganizationId),
      recipientsPath.replace(projectId, siblingProjectId),
    ]) {
      for (const method of ['GET', 'DELETE']) {
        await denied(
          await request(`${path}/${first.id}`, method),
          404,
          path.includes(siblingEnvironmentId) ? 'RESOURCE_NOT_FOUND' : 'AUTH_SCOPE_NOT_FOUND',
        );
      }
    }
    await denied(
      await request(
        `${recipientsPath.replace(environmentId, siblingEnvironmentId)}?cursor=${page.nextCursor}`,
      ),
      422,
      'RESOURCE_CURSOR_INVALID',
    );
    await denied(await request(`${recipientsPath}?cursor=e30`), 422, 'RESOURCE_CURSOR_INVALID');
    const keyPath = recipientsPath.replace('/recipients', '/service-keys');
    await denied(
      await request(`${keyPath}?cursor=${page.nextCursor}`),
      422,
      'RESOURCE_CURSOR_INVALID',
    );
    const unboundCursor = Buffer.from(
      JSON.stringify({
        version: 1,
        kind: 'environment',
        organizationId,
        projectId,
        environmentId,
        afterId: first.id,
      }),
    ).toString('base64url');
    await denied(
      await request(`${recipientsPath}?cursor=${unboundCursor}`),
      422,
      'RESOURCE_CURSOR_INVALID',
    );
    const runtime = new Client({ connectionString: fixture.environment.API_DATABASE_URL });
    await runtime.connect();
    try {
      expect((await runtime.query('SELECT id FROM app.recipients')).rows).toEqual([]);
      await runtime.query('BEGIN');
      await runtime.query(
        "SELECT set_config('pipong.organization_id',$1,true), set_config('pipong.project_id',$2,true), set_config('pipong.environment_id',$3,true)",
        [organizationId, projectId, siblingEnvironmentId],
      );
      expect((await runtime.query('SELECT id FROM app.recipients')).rows).toEqual([]);
      await runtime.query('ROLLBACK');
      for (const column of ['organization_id', 'project_id', 'environment_id', 'external_id']) {
        await expect(
          runtime.query(`UPDATE app.recipients SET ${column}=$1 WHERE id=$2`, [
            column === 'external_id' ? 'changed' : siblingEnvironmentId,
            first.id,
          ]),
        ).rejects.toMatchObject({ code: '42501' });
      }
      await expect(runtime.query('DELETE FROM app.recipients')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(
        fixture.database.query(
          'INSERT INTO app.recipients (id,organization_id,project_id,environment_id,external_id) VALUES ($1,$2,$3,$4,$5)',
          [otherOrganizationId, otherOrganizationId, projectId, environmentId, 'foreign'],
        ),
      ).rejects.toMatchObject({ code: '23503' });
    } finally {
      await runtime.query('ROLLBACK');
      await runtime.end();
    }
    // oxlint-enable eslint/no-await-in-loop
  });

  it('enforces live human authority and service-key grants, revocation, and suspended scope', async () => {
    const record = await recipient(await upsert('customer'));
    const keysPath = recipientsPath.replace('/recipients', '/service-keys');
    const issuedResponse = await request(
      keysPath,
      'POST',
      JSON.stringify({
        name: 'Recipients',
        actions: ['recipient:read', 'recipient:write'],
        expiresIn: 3600,
      }),
    );
    expect(issuedResponse.status).toBe(201);
    const issued = v.parse(
      v.object({ key: v.string(), metadata: v.object({ id: idSchema }) }),
      await issuedResponse.json(),
    );
    function keyRequest(path: string, method?: string, body?: string): Promise<Response> {
      return fetch(`${fixture.baseUrl}${path}`, {
        method,
        headers: { 'x-api-key': issued.key, 'content-type': 'application/json' },
        body,
      });
    }
    expect((await keyRequest(recipientsPath)).status).toBe(200);
    const keyRecipient = await recipient(
      await keyRequest(recipientsPath, 'PUT', JSON.stringify({ externalId: 'key-recipient' })),
    );
    expect((await keyRequest(`${recipientsPath}/${keyRecipient.id}`, 'DELETE')).status).toBe(204);
    await denied(
      await keyRequest(recipientsPath.replace(environmentId, siblingEnvironmentId)),
      404,
      'AUTH_SCOPE_NOT_FOUND',
    );
    const readOnlyResponse = await request(
      keysPath,
      'POST',
      JSON.stringify({ name: 'Read only', actions: ['recipient:read'], expiresIn: 3600 }),
    );
    const readOnly = v.parse(v.object({ key: v.string() }), await readOnlyResponse.json());
    await denied(
      await fetch(`${fixture.baseUrl}${recipientsPath}`, {
        method: 'PUT',
        headers: { 'x-api-key': readOnly.key, 'content-type': 'application/json' },
        body: JSON.stringify({ externalId: 'denied' }),
      }),
      403,
      'AUTH_PERMISSION_DENIED',
    );
    expect((await request(`${keysPath}/${issued.metadata.id}/revoke`, 'POST')).status).toBe(200);
    await denied(await keyRequest(recipientsPath), 401, 'AUTH_CREDENTIALS_INVALID');
    await fixture.database.query("UPDATE auth.members SET role='member'");
    expect((await request(`${recipientsPath}/${record.id}`)).status).toBe(200);
    await denied(await upsert('denied'), 403, 'AUTH_PERMISSION_DENIED');
    await denied(
      await request(`${recipientsPath}/${record.id}`, 'DELETE'),
      403,
      'AUTH_PERMISSION_DENIED',
    );
    await fixture.database.query(
      "UPDATE auth.members SET role='admin'; DELETE FROM auth.mfa_assurances",
    );
    expect((await upsert('admin-without-mfa')).status).toBe(200);
    await fixture.database.query('UPDATE app.environments SET suspended_at=now() WHERE id=$1', [
      environmentId,
    ]);
    expect((await request(recipientsPath)).status).toBe(200);
    await denied(await upsert('suspended'), 409, 'AUTH_SCOPE_SUSPENDED');
    await fixture.database.query('DELETE FROM auth.members');
    await denied(await request(recipientsPath), 404, 'AUTH_SCOPE_NOT_FOUND');
    await denied(
      await fetch(`${fixture.baseUrl}${recipientsPath}`),
      401,
      'AUTH_CREDENTIALS_INVALID',
    );
  });

  it('deletes one recipient without resurrection or unbounded physical removal, including concurrent upsert', async () => {
    const first = await recipient(await upsert('first'));
    const sibling = await recipient(await upsert('sibling'));
    const responses = await Promise.all([
      request(`${recipientsPath}/${first.id}`, 'DELETE'),
      upsert('first'),
    ]);
    expect(responses[0]?.status).toBe(204);
    expect([200, 409]).toContain(responses[1]?.status);
    await denied(await upsert('first'), 409, 'RECIPIENT_DELETED');
    await denied(await request(`${recipientsPath}/${first.id}`), 404, 'RESOURCE_NOT_FOUND');
    await denied(
      await request(`${recipientsPath}/${first.id}`, 'DELETE'),
      404,
      'RESOURCE_NOT_FOUND',
    );
    const page = v.parse(pageSchema, await (await request(recipientsPath)).json());
    expect(page.items.map(({ id }) => id)).toEqual([sibling.id]);
    const tombstone = await fixture.database.query<{ deleted_at: Date }>(
      'SELECT deleted_at FROM app.recipients WHERE id=$1',
      [first.id],
    );
    expect(tombstone.rows[0]?.deleted_at).toBeInstanceOf(Date);
  });
});
