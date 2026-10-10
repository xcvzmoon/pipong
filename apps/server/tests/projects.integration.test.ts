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
const projectSchema = v.strictObject({
  id: idSchema,
  organizationId: idSchema,
  name: v.string(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deletedAt: v.nullable(timestampSchema),
  suspendedAt: v.nullable(timestampSchema),
});
const environmentSchema = v.strictObject({ ...projectSchema.entries, projectId: idSchema });
const projectPageSchema = v.strictObject({
  items: v.array(projectSchema),
  nextCursor: v.nullable(v.string()),
});
const environmentPageSchema = v.strictObject({
  items: v.array(environmentSchema),
  nextCursor: v.nullable(v.string()),
});
const problemSchema = v.strictObject({
  type: v.string(),
  title: v.string(),
  status: v.number(),
  code: v.string(),
  requestId: idSchema,
});
const contractSchema = v.object({
  openapi: v.string(),
  components: v.object({ schemas: v.record(v.string(), v.looseObject({})) }),
  paths: v.record(v.string(), v.looseObject({})),
});

async function denied(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toContain('application/problem+json');
  expect(response.headers.get('cache-control')).toBe('no-store');
  const problem = v.parse(problemSchema, await response.json());
  expect(problem.code).toBe(code);
  expect(problem.status).toBe(status);
  expect(response.headers.get('x-request-id')).toBe(problem.requestId);
}

describe.skipIf(!testUrl)('project and environment HTTP operations with real PostgreSQL', () => {
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

  async function project(
    response: Response,
    status = 200,
  ): Promise<v.InferOutput<typeof projectSchema>> {
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const result = v.parse(projectSchema, await response.json());
    expect(
      ajv.validate({ $ref: 'pipong#/components/schemas/Project' }, result),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    return result;
  }

  async function environment(
    response: Response,
    status = 200,
  ): Promise<v.InferOutput<typeof environmentSchema>> {
    expect(response.status).toBe(status);
    const result = v.parse(environmentSchema, await response.json());
    expect(
      ajv.validate({ $ref: 'pipong#/components/schemas/Environment' }, result),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    return result;
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
    expect(contract.openapi).toBe('3.1.0');
    ajv.addSchema({ $id: 'pipong', components: contract.components });
    for (const name of Object.keys(contract.components.schemas)) {
      expect(ajv.getSchema(`pipong#/components/schemas/${name}`)).toBeTypeOf('function');
    }
    for (const prefix of [
      '/api/v1/organizations/{organizationId}/projects',
      '/api/v1/organizations/{organizationId}/projects/{projectId}/environments',
    ]) {
      const resource = prefix.endsWith('environments') ? 'Environment' : 'Project';
      for (const [path, method, operation] of [
        [prefix, 'post', `create${resource}`],
        [prefix, 'get', `list${resource}s`],
        [`${prefix}/{${resource.toLowerCase()}Id}`, 'get', `read${resource}`],
        [`${prefix}/{${resource.toLowerCase()}Id}`, 'patch', `update${resource}`],
        [`${prefix}/{${resource.toLowerCase()}Id}`, 'delete', `delete${resource}`],
        [`${prefix}/{${resource.toLowerCase()}Id}/suspend`, 'post', `suspend${resource}`],
      ]) {
        if (!path || !method || !operation) throw new Error('TEST_OPERATION_MISSING');
        const entry = v.parse(
          v.object({ operationId: v.string() }),
          contract.paths[path]?.[method],
        );
        expect(entry.operationId).toBe(operation);
      }
    }
  }, 60_000);

  beforeEach(async () => {
    await fixture.database.query('UPDATE auth.organizations SET disabled_at=NULL,deleted_at=NULL');
    await fixture.database.query(
      'DELETE FROM app.erasure_jobs; DELETE FROM app.environments; DELETE FROM app.projects; DELETE FROM auth.members; DELETE FROM auth.mfa_assurances; DELETE FROM auth.rate_limits',
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

  it('creates, reads, renames, and lists scoped resources with schemas matching the generated contract', async () => {
    const createdResponse = await request(
      projectsPath,
      'POST',
      JSON.stringify({ name: '  Mobile app  ' }),
    );
    const created = await project(createdResponse, 201);
    expect(created.id[14]).toBe('7');
    expect(created.name).toBe('Mobile app');
    expect(created.organizationId).toBe(organizationId);
    expect(createdResponse.headers.get('location')).toBe(`${projectsPath}/${created.id}`);
    expect((await project(await request(`${projectsPath}/${created.id}`))).id).toBe(created.id);
    const updated = await project(
      await request(`${projectsPath}/${created.id}`, 'PATCH', JSON.stringify({ name: 'Renamed' })),
    );
    expect(updated.name).toBe('Renamed');
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt >= created.updatedAt).toBe(true);
    const page = v.parse(projectPageSchema, await (await request(projectsPath)).json());
    expect(page.items.map(({ name }) => name)).toEqual(['First', 'Sibling', 'Renamed']);
    expect(page.nextCursor).toBeNull();
    expect(ajv.validate({ $ref: 'pipong#/components/schemas/ProjectPage' }, page)).toBe(true);
    const createdEnvironmentResponse = await request(
      environmentsPath,
      'POST',
      JSON.stringify({ name: 'Staging' }),
    );
    const createdEnvironment = await environment(createdEnvironmentResponse, 201);
    expect(createdEnvironment.projectId).toBe(projectId);
    expect(createdEnvironmentResponse.headers.get('location')).toBe(
      `${environmentsPath}/${createdEnvironment.id}`,
    );
    expect(
      (await environment(await request(`${environmentsPath}/${createdEnvironment.id}`))).id,
    ).toBe(createdEnvironment.id);
    expect(
      (
        await environment(
          await request(
            `${environmentsPath}/${createdEnvironment.id}`,
            'PATCH',
            JSON.stringify({ name: 'Preview' }),
          ),
        )
      ).name,
    ).toBe('Preview');
    const environments = v.parse(
      environmentPageSchema,
      await (await request(environmentsPath)).json(),
    );
    expect(environments.items.map(({ name }) => name)).toEqual([
      'Production',
      'Development',
      'Preview',
    ]);
    expect(ajv.validate({ $ref: 'pipong#/components/schemas/EnvironmentPage' }, environments)).toBe(
      true,
    );
    expect(
      ajv.validate({ $ref: 'pipong#/components/schemas/ResourceInput' }, { name: 'Valid' }),
    ).toBe(true);
    expect(
      ajv.validate(
        { $ref: 'pipong#/components/schemas/ResourceInput' },
        { name: 'Valid', organizationId },
      ),
    ).toBe(false);
  });

  it('rejects invalid boundaries, unknown fields, malformed JSON, oversized and non-JSON bodies', async () => {
    // oxlint-disable eslint/no-await-in-loop -- Each case exercises a separate HTTP boundary against the shared server.
    for (const path of [
      projectsPath,
      environmentsPath,
      `${projectsPath}/${projectId}`,
      `${environmentsPath}/${environmentId}`,
    ]) {
      const method = path === projectsPath || path === environmentsPath ? 'POST' : 'PATCH';
      for (const body of [
        '{',
        JSON.stringify({ name: ' ' }),
        JSON.stringify({ name: 'x'.repeat(101) }),
        JSON.stringify({ name: 'Valid', organizationId: otherOrganizationId }),
      ]) {
        await denied(await request(path, method, body), 422, 'RESOURCE_INPUT_INVALID');
      }
      await denied(
        await request(path, method, JSON.stringify({ name: 'x'.repeat(5000) })),
        413,
        'RESOURCE_BODY_TOO_LARGE',
      );
      await denied(
        await fetch(`${fixture.baseUrl}${path}`, {
          method,
          headers: { cookie, origin: fixture.baseUrl, 'content-type': 'text/plain' },
          body: '{}',
        }),
        415,
        'RESOURCE_CONTENT_TYPE_INVALID',
      );
    }
    for (const query of [
      'limit=0',
      'limit=101',
      'limit=1&limit=2',
      'extra=true',
      'cursor=!',
      'cursor=e30',
    ]) {
      await denied(
        await request(`${projectsPath}?${query}`),
        422,
        query === 'cursor=e30' ? 'RESOURCE_CURSOR_INVALID' : 'RESOURCE_INPUT_INVALID',
      );
    }
    for (const name of [' ', `${'x'.repeat(100)} `, 'invalid\0name', '\uD800']) {
      expect(ajv.validate({ $ref: 'pipong#/components/schemas/ResourceInput' }, { name })).toBe(
        false,
      );
      await denied(
        await request(projectsPath, 'POST', JSON.stringify({ name })),
        422,
        'RESOURCE_INPUT_INVALID',
      );
    }
    for (const name of [`${' '.repeat(99)}x`, '😀'.repeat(100)]) {
      expect(ajv.validate({ $ref: 'pipong#/components/schemas/ResourceInput' }, { name })).toBe(
        true,
      );
      expect(
        (await project(await request(projectsPath, 'POST', JSON.stringify({ name })), 201)).name,
      ).toBe(name.trim());
    }
    await denied(
      await request('/api/v1/organizations/invalid/projects'),
      422,
      'RESOURCE_PATH_INVALID',
    );
    // oxlint-enable eslint/no-await-in-loop
  });

  it('hides mismatched ownership and enforces immutable scope and collection-bound pagination', async () => {
    // oxlint-disable eslint/no-await-in-loop -- Verify each concrete method route against mismatched nested ownership.
    for (const path of [
      `${projectsPath}/${otherProjectId}`,
      `${projectsPath}/${siblingProjectId}/environments/${environmentId}`,
    ]) {
      for (const method of ['GET', 'PATCH', 'DELETE']) {
        await denied(
          await request(
            path,
            method,
            method === 'PATCH' ? JSON.stringify({ name: 'Denied' }) : undefined,
          ),
          404,
          'AUTH_SCOPE_NOT_FOUND',
        );
      }
      await denied(await request(`${path}/suspend`, 'POST'), 404, 'AUTH_SCOPE_NOT_FOUND');
    }
    await denied(
      await request(
        `${projectsPath}/${otherProjectId}/environments`,
        'POST',
        JSON.stringify({ name: 'Denied' }),
      ),
      404,
      'AUTH_SCOPE_NOT_FOUND',
    );
    const first = v.parse(
      projectPageSchema,
      await (await request(`${projectsPath}?limit=1`)).json(),
    );
    expect(first.items.map(({ id }) => id)).toEqual([projectId]);
    expect(first.nextCursor).toBeTypeOf('string');
    const second = v.parse(
      projectPageSchema,
      await (await request(`${projectsPath}?limit=1&cursor=${first.nextCursor}`)).json(),
    );
    expect(second.items.map(({ id }) => id)).toEqual([siblingProjectId]);
    expect(second.nextCursor).toBeNull();
    await denied(
      await request(
        `/api/v1/organizations/${otherOrganizationId}/projects?cursor=${first.nextCursor}`,
      ),
      422,
      'RESOURCE_CURSOR_INVALID',
    );
    const environmentPage = v.parse(
      environmentPageSchema,
      await (await request(`${environmentsPath}?limit=1`)).json(),
    );
    expect(environmentPage.items.map(({ id }) => id)).toEqual([environmentId]);
    const environmentNext = v.parse(
      environmentPageSchema,
      await (await request(`${environmentsPath}?cursor=${environmentPage.nextCursor}`)).json(),
    );
    expect(environmentNext.items.map(({ id }) => id)).toEqual([siblingEnvironmentId]);
    await denied(
      await request(
        `${projectsPath}/${siblingProjectId}/environments?cursor=${environmentPage.nextCursor}`,
      ),
      422,
      'RESOURCE_CURSOR_INVALID',
    );
    await denied(
      await request(`${projectsPath}?cursor=${environmentPage.nextCursor}`),
      422,
      'RESOURCE_CURSOR_INVALID',
    );
    const api = new Client({ connectionString: fixture.environment.API_DATABASE_URL });
    await api.connect();
    try {
      await api.query('BEGIN');
      await api.query("SELECT set_config('pipong.organization_id',$1,true)", [organizationId]);
      await expect(
        api.query('UPDATE app.projects SET organization_id=$1 WHERE id=$2', [
          otherOrganizationId,
          siblingProjectId,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await api.query('ROLLBACK');
      await api.query('BEGIN');
      await api.query("SELECT set_config('pipong.organization_id',$1,true)", [organizationId]);
      await expect(
        api.query('UPDATE app.environments SET project_id=$1 WHERE id=$2', [
          siblingProjectId,
          environmentId,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await api.query('ROLLBACK');
      await api.end();
    }
    // oxlint-enable eslint/no-await-in-loop
  });

  it('requires live authority and recent MFA for every mutation while allowing member reads', async () => {
    await fixture.database.query("UPDATE auth.members SET role='member' WHERE user_id=$1", [
      userId,
    ]);
    // oxlint-disable eslint/no-await-in-loop -- Each request checks one operation in the member and revoked-authority matrix.
    for (const collection of [projectsPath, environmentsPath]) {
      const item =
        collection === projectsPath
          ? `${collection}/${projectId}`
          : `${collection}/${environmentId}`;
      expect((await request(collection)).status).toBe(200);
      expect((await request(item)).status).toBe(200);
      await denied(
        await request(collection, 'POST', JSON.stringify({ name: 'Denied' })),
        403,
        'AUTH_PERMISSION_DENIED',
      );
      await denied(
        await request(item, 'PATCH', JSON.stringify({ name: 'Denied' })),
        403,
        'AUTH_PERMISSION_DENIED',
      );
      await denied(await request(`${item}/suspend`, 'POST'), 403, 'AUTH_PERMISSION_DENIED');
      await denied(await request(item, 'DELETE'), 403, 'AUTH_PERMISSION_DENIED');
    }
    await fixture.database.query(
      "UPDATE auth.members SET role='owner'; DELETE FROM auth.mfa_assurances",
    );
    await denied(
      await request(projectsPath, 'POST', JSON.stringify({ name: 'Denied' })),
      403,
      'AUTH_RECENT_MFA_REQUIRED',
    );
    await denied(
      await request(`${environmentsPath}/${environmentId}/suspend`, 'POST'),
      403,
      'AUTH_RECENT_MFA_REQUIRED',
    );
    await fixture.database.query('DELETE FROM auth.members WHERE user_id=$1', [userId]);
    for (const collection of [projectsPath, environmentsPath]) {
      await denied(await request(collection), 404, 'AUTH_SCOPE_NOT_FOUND');
      await denied(
        await request(collection, 'POST', JSON.stringify({ name: 'Denied' })),
        404,
        'AUTH_SCOPE_NOT_FOUND',
      );
    }
    // oxlint-enable eslint/no-await-in-loop
  });

  it('serializes duplicate names and suspension, keeps siblings independent, and requests bounded erasure', async () => {
    const responses = await Promise.all([
      request(projectsPath, 'POST', JSON.stringify({ name: 'Concurrent' })),
      request(projectsPath, 'POST', JSON.stringify({ name: 'Concurrent' })),
    ]);
    expect(
      responses.map(({ status }) => status).toSorted((first, second) => first - second),
    ).toEqual([201, 409]);
    const conflicting = responses.find(({ status }) => status === 409);
    if (!conflicting) throw new Error('TEST_CONFLICT_MISSING');
    await denied(conflicting, 409, 'RESOURCE_NAME_CONFLICT');
    await denied(
      await request(
        `${projectsPath}/${siblingProjectId}`,
        'PATCH',
        JSON.stringify({ name: 'First' }),
      ),
      409,
      'RESOURCE_NAME_CONFLICT',
    );
    await denied(
      await request(environmentsPath, 'POST', JSON.stringify({ name: 'Production' })),
      409,
      'RESOURCE_NAME_CONFLICT',
    );
    await denied(
      await request(
        `${environmentsPath}/${siblingEnvironmentId}`,
        'PATCH',
        JSON.stringify({ name: 'Production' }),
      ),
      409,
      'RESOURCE_NAME_CONFLICT',
    );
    expect(
      (
        await project(
          await request(
            `/api/v1/organizations/${otherOrganizationId}/projects`,
            'POST',
            JSON.stringify({ name: 'First' }),
          ),
          201,
        )
      ).name,
    ).toBe('First');
    expect(
      (
        await environment(
          await request(
            `${projectsPath}/${siblingProjectId}/environments`,
            'POST',
            JSON.stringify({ name: 'Production' }),
          ),
          201,
        )
      ).name,
    ).toBe('Production');
    const suspended = await environment(
      await request(`${environmentsPath}/${environmentId}/suspend`, 'POST'),
    );
    expect(suspended.suspendedAt).not.toBeNull();
    expect(
      (await environment(await request(`${environmentsPath}/${environmentId}/suspend`, 'POST')))
        .suspendedAt,
    ).toBe(suspended.suspendedAt);
    expect(
      (await environment(await request(`${environmentsPath}/${siblingEnvironmentId}`))).suspendedAt,
    ).toBeNull();
    const scope = { kind: 'environment', organizationId, projectId, environmentId };
    await denied(
      await request(
        '/api/v1/authorize',
        'POST',
        JSON.stringify({ action: 'notification:send', scope }),
      ),
      409,
      'AUTH_SCOPE_SUSPENDED',
    );
    expect(
      (
        await request(
          '/api/v1/authorize',
          'POST',
          JSON.stringify({ action: 'notification:read', scope }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          '/api/v1/authorize',
          'POST',
          JSON.stringify({ action: 'notification:cancel', scope }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          '/api/v1/authorize',
          'POST',
          JSON.stringify({
            action: 'notification:send',
            scope: { ...scope, environmentId: siblingEnvironmentId },
          }),
        )
      ).status,
    ).toBe(200);
    expect((await request(`${environmentsPath}/${environmentId}`, 'DELETE')).status).toBe(202);
    const blocker = new Client({ connectionString: fixture.environment.API_DATABASE_URL });
    await blocker.connect();
    let suspension: Promise<Response> | undefined;

    try {
      await blocker.query('BEGIN');
      await blocker.query("SELECT set_config('pipong.organization_id',$1,true)", [organizationId]);
      await blocker.query('SELECT id FROM app.projects WHERE id=$1 FOR SHARE', [projectId]);
      suspension = request(`${projectsPath}/${projectId}/suspend`, 'POST');
      await expect
        .poll(async () => {
          const waiting = await fixture.database.query<{ count: string }>(
            "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND usename='pipong_api' AND wait_event_type='Lock' AND query LIKE '%projects%'",
          );
          return Number(waiting.rows[0]?.count);
        })
        .toBe(1);
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
      await suspension;
    }

    if (suspension === undefined) {
      throw new Error('TEST_SUSPENSION_RACE_MISSING');
    }

    const suspendedProject = await project(await suspension);
    await denied(
      await request(environmentsPath, 'POST', JSON.stringify({ name: 'After suspension' })),
      409,
      'RESOURCE_SUSPENDED',
    );
    expect(suspendedProject.suspendedAt).not.toBeNull();
    expect(
      (await project(await request(`${projectsPath}/${projectId}/suspend`, 'POST'))).suspendedAt,
    ).toBe(suspendedProject.suspendedAt);
    await denied(
      await request(environmentsPath, 'POST', JSON.stringify({ name: 'Blocked' })),
      409,
      'RESOURCE_SUSPENDED',
    );
    await denied(
      await request(
        '/api/v1/authorize',
        'POST',
        JSON.stringify({
          action: 'notification:send',
          scope: { ...scope, environmentId: siblingEnvironmentId },
        }),
      ),
      409,
      'AUTH_SCOPE_SUSPENDED',
    );
    expect((await request(`${projectsPath}/${projectId}`, 'DELETE')).status).toBe(202);
    expect(
      (await project(await request(`${projectsPath}/${siblingProjectId}`))).suspendedAt,
    ).toBeNull();
    const counts = await fixture.database.query<{ count: string }>(
      'SELECT count(*) FROM app.environments WHERE project_id=$1',
      [projectId],
    );
    expect(counts.rows[0]?.count).toBe('2');
  });
  it('requires an owner with recent MFA for organization erasure and denies native bypasses and later writes', async () => {
    const path = `/api/v1/organizations/${organizationId}`;
    await fixture.database.query("UPDATE auth.members SET role='admin' WHERE organization_id=$1", [
      organizationId,
    ]);
    await denied(await request(path, 'DELETE'), 403, 'AUTH_PERMISSION_DENIED');
    await fixture.database.query("UPDATE auth.members SET role='owner' WHERE organization_id=$1;", [
      organizationId,
    ]);
    await fixture.database.query('DELETE FROM auth.mfa_assurances');
    await denied(await request(path, 'DELETE'), 403, 'AUTH_RECENT_MFA_REQUIRED');
    await fixture.database.query(
      'INSERT INTO auth.mfa_assurances(session_id,verified_at) SELECT id,now() FROM auth.sessions WHERE user_id=$1',
      [userId],
    );
    const nativeDelete = await request(
      '/api/auth/organization/delete',
      'POST',
      JSON.stringify({ organizationId }),
    );
    expect(nativeDelete.status).toBe(403);
    const response = await request(path, 'DELETE');
    expect(response.status).toBe(202);
    const receipt = v.parse(
      v.strictObject({
        erasureId: idSchema,
        requestedAt: timestampSchema,
        inFlightUntil: timestampSchema,
      }),
      await response.json(),
    );
    expect(Date.parse(receipt.inFlightUntil) - Date.parse(receipt.requestedAt)).toBeLessThanOrEqual(
      120_001,
    );
    const contract = v.parse(
      contractSchema,
      await (await fetch(`${fixture.baseUrl}/_openapi.json`)).json(),
    );
    const operation = v.parse(
      v.object({
        operationId: v.literal('deleteOrganization'),
        responses: v.object({
          '202': v.object({
            content: v.object({ 'application/json': v.object({ schema: v.looseObject({}) }) }),
          }),
        }),
      }),
      contract.paths['/api/v1/organizations/{organizationId}']?.delete,
    );
    expect(
      ajv.validate(operation.responses['202'].content['application/json'].schema, receipt),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    await denied(await request(projectsPath), 403, 'AUTH_ORGANIZATION_DISABLED');
    await denied(
      await request(projectsPath, 'POST', JSON.stringify({ name: 'After erasure' })),
      403,
      'AUTH_ORGANIZATION_DISABLED',
    );
    const invitation = await request(
      '/api/auth/organization/invite-member',
      'POST',
      JSON.stringify({ organizationId, email: 'invitee@example.com', role: 'member' }),
    );
    expect(invitation.status).toBe(403);
    expect(v.parse(v.object({ code: v.string() }), await invitation.json()).code).toBe(
      'AUTH_ORGANIZATION_DISABLED',
    );
    expect((await request(`/api/v1/organizations/${otherOrganizationId}/projects`)).status).toBe(
      200,
    );
    expect(
      (
        await fixture.database.query(
          'SELECT actor_id,target_id FROM app.erasure_jobs WHERE id=$1',
          [receipt.erasureId],
        )
      ).rows,
    ).toEqual([{ actor_id: userId, target_id: organizationId }]);
  });
});
