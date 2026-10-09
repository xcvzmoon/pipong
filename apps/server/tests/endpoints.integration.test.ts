import type { AuthFixture } from './fixtures/auth-runtime.ts';
import { decryptSecret, loadSecretKeyring } from '@pipong/service';
import addFormats from 'ajv-formats';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { execFile } from 'node:child_process';
import { createECDH, generateKeyPairSync } from 'node:crypto';
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

const endpointSchema = v.strictObject({
  id: idSchema,
  organizationId: idSchema,
  projectId: idSchema,
  environmentId: idSchema,
  recipientId: idSchema,
  installationId: v.string(),
  provider: v.picklist(['apns', 'fcm', 'web-push']),
  appId: v.string(),
  generation: v.number(),
  credentialId: idSchema,
  state: v.picklist(['active', 'disabled']),
  registeredAt: timestampSchema,
  disabledAt: v.nullable(timestampSchema),
  createdAt: timestampSchema,
});
const endpointPageSchema = v.strictObject({
  items: v.array(endpointSchema),
  nextCursor: v.nullable(v.string()),
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

function endpointPath(recipientId: string): string {
  return `${environmentsPath}/${environmentId}/recipients/${recipientId}/endpoints`;
}

describe.skipIf(!testUrl)('endpoint HTTP operations with real PostgreSQL', () => {
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

  async function endpoint(response: Response): Promise<v.InferOutput<typeof endpointSchema>> {
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const record = v.parse(endpointSchema, await response.json());
    expect(
      ajv.validate({ $ref: 'pipong#/components/schemas/Endpoint' }, record),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    return record;
  }
  async function activeCredential(body: {
    provider: string;
    appId: string;
    secret: Record<string, string>;
  }): Promise<string> {
    const record = await credential(await request(credentialsPath, 'POST', JSON.stringify(body)));
    await credential(await request(`${credentialsPath}/${record.id}/activate`, 'POST'));
    return record.id;
  }
  async function recipient(externalId: string): Promise<string> {
    const response = await request(
      credentialsPath.replace('/credentials', '/recipients'),
      'PUT',
      JSON.stringify({ externalId }),
    );
    expect(response.status).toBe(200);
    return v.parse(v.object({ id: idSchema }), await response.json()).id;
  }
  async function setup() {
    const recipientId = await recipient('customer-42');
    const credentialId = await activeCredential(input);
    const subscriptionKey = createECDH('prime256v1');
    subscriptionKey.generateKeys();
    const endpointInput = {
      provider: 'web-push',
      appId: 'web-app',
      installationId: 'browser-1',
      credentialId,
      target: {
        endpoint: 'https://8.8.8.8/subscription-1',
        p256dh: subscriptionKey.getPublicKey().toString('base64url'),
        auth: Buffer.alloc(16, 7).toString('base64url'),
        expirationTime: null,
        applicationServerKey: vapid.getPublicKey().toString('base64url'),
      },
    };
    return { recipientId, endpointInput };
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
      'Endpoint',
      'EndpointInput',
      'EndpointPage',
      'EndpointDisableInput',
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
      [
        prefix.replace('/credentials', '/recipients/{recipientId}/endpoints'),
        'put',
        'registerEndpoint',
      ],
      [
        prefix.replace('/credentials', '/recipients/{recipientId}/endpoints'),
        'get',
        'listEndpoints',
      ],
      [
        `${prefix.replace('/credentials', '/recipients/{recipientId}/endpoints')}/{endpointId}`,
        'get',
        'readEndpoint',
      ],
      [
        `${prefix.replace('/credentials', '/recipients/{recipientId}/endpoints')}/{endpointId}/disable`,
        'post',
        'disableEndpoint',
      ],
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
      'TRUNCATE app.idempotency_records, app.notifications, app.deliveries, app.endpoints, app.endpoint_generations; DELETE FROM auth.service_key_audits; DELETE FROM auth.service_key_grants; DELETE FROM auth.api_keys; DELETE FROM app.credential_versions; DELETE FROM app.recipients; DELETE FROM app.environments; DELETE FROM app.projects; DELETE FROM auth.members; DELETE FROM auth.mfa_assurances; DELETE FROM auth.rate_limits',
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

  it('registers encrypted typed endpoints, refreshes the same target, and preserves old generations', async () => {
    const { recipientId, endpointInput } = await setup();
    const path = endpointPath(recipientId);
    const first = await endpoint(await request(path, 'PUT', JSON.stringify(endpointInput)));
    expect(first.generation).toBe(1);
    expect(first.state).toBe('active');
    expect(ajv.validate({ $ref: 'pipong#/components/schemas/EndpointInput' }, endpointInput)).toBe(
      true,
    );
    const encrypted = await fixture.database.query<{ encrypted_target: string }>(
      'SELECT encrypted_target FROM app.endpoint_generations WHERE endpoint_id=$1',
      [first.id],
    );
    const stored = encrypted.rows[0]?.encrypted_target ?? '';
    expect(stored).not.toContain(endpointInput.target.auth);
    expect(stored).not.toContain(endpointInput.target.endpoint);
    const plaintext = decryptSecret(
      await loadSecretKeyring(fixture.environment.CREDENTIAL_KEYRING_REF ?? ''),
      {
        organizationId,
        projectId,
        environmentId,
        resourceId: first.id,
        purpose: 'endpoint',
        binding: JSON.stringify([
          recipientId,
          'web-push',
          'web-app',
          'browser-1',
          1,
          endpointInput.credentialId,
        ]),
      },
      stored,
    );
    expect(JSON.parse(plaintext)).toEqual(endpointInput.target);
    expect(() =>
      decryptSecret(
        { activeKeyId: 'first', keys: new Map() },
        {
          organizationId,
          projectId,
          environmentId,
          resourceId: first.id,
          purpose: 'endpoint',
          binding: 'wrong',
        },
        stored,
      ),
    ).toThrow('CREDENTIAL_KEY_UNAVAILABLE');
    const keyring = await loadSecretKeyring(fixture.environment.CREDENTIAL_KEYRING_REF ?? '');
    expect(() =>
      decryptSecret(
        keyring,
        {
          organizationId,
          projectId,
          environmentId,
          resourceId: first.id,
          purpose: 'endpoint',
          binding: 'wrong',
        },
        stored,
      ),
    ).toThrow('CREDENTIAL_DECRYPT_FAILED');
    const refreshed = await endpoint(await request(path, 'PUT', JSON.stringify(endpointInput)));
    expect(refreshed.id).toBe(first.id);
    expect(refreshed.generation).toBe(2);
    expect(
      (
        await fixture.database.query(
          'SELECT generation FROM app.endpoint_generations WHERE endpoint_id=$1',
          [first.id],
        )
      ).rows,
    ).toHaveLength(2);
    await denied(
      await request(`${path}/${first.id}/disable`, 'POST', JSON.stringify({ generation: 1 })),
      409,
      'ENDPOINT_GENERATION_STALE',
    );
    const disabled = await endpoint(
      await request(`${path}/${first.id}/disable`, 'POST', JSON.stringify({ generation: 2 })),
    );
    expect(disabled.state).toBe('disabled');
    expect(
      await endpoint(
        await request(`${path}/${first.id}/disable`, 'POST', JSON.stringify({ generation: 2 })),
      ),
    ).toEqual(disabled);
    const reactivated = await endpoint(await request(path, 'PUT', JSON.stringify(endpointInput)));
    expect(reactivated.generation).toBe(3);
    expect(reactivated.disabledAt).toBeNull();
    expect(await endpoint(await request(`${path}/${first.id}`))).toEqual(reactivated);
    const other = await recipient('other-customer');
    await denied(await request(`${endpointPath(other)}/${first.id}`), 404, 'RESOURCE_NOT_FOUND');
    await denied(
      await request(
        `${endpointPath(other)}/${first.id}/disable`,
        'POST',
        JSON.stringify({ generation: 3 }),
      ),
      404,
      'RESOURCE_NOT_FOUND',
    );
    await denied(
      await request(endpointPath(other), 'PUT', JSON.stringify(endpointInput)),
      409,
      'ENDPOINT_INSTALLATION_CONFLICT',
    );
    await denied(
      await request(
        path,
        'PUT',
        JSON.stringify({ ...endpointInput, installationId: 'duplicate-target' }),
      ),
      409,
      'ENDPOINT_TARGET_CONFLICT',
    );
    expect(
      (
        await fixture.database.query(
          'SELECT generation FROM app.endpoint_generations WHERE endpoint_id=$1',
          [first.id],
        )
      ).rows,
    ).toHaveLength(3);
  });

  it('serializes concurrent confirmations and disable ordering, and guards APNs invalidation timestamps', async () => {
    const { recipientId, endpointInput } = await setup();
    const path = endpointPath(recipientId);
    const first = await endpoint(await request(path, 'PUT', JSON.stringify(endpointInput)));
    const records = await Promise.all(
      (
        await Promise.all([
          request(path, 'PUT', JSON.stringify(endpointInput)),
          request(path, 'PUT', JSON.stringify(endpointInput)),
        ])
      ).map((response) => endpoint(response)),
    );
    expect(
      records.map((record) => record.generation).toSorted((left, right) => left - right),
    ).toEqual([2, 3]);
    const [confirmation, disable] = await Promise.all([
      request(path, 'PUT', JSON.stringify(endpointInput)),
      request(`${path}/${first.id}/disable`, 'POST', JSON.stringify({ generation: 3 })),
    ]);
    expect((await endpoint(confirmation)).generation).toBe(4);
    expect([200, 409]).toContain(disable.status);
    expect((await endpoint(await request(`${path}/${first.id}`))).state).toBe('active');
    const apnsKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    });
    const credentialId = await activeCredential({
      provider: 'apns',
      appId: 'com.example.app',
      secret: {
        teamId: 'ABCDEFGHIJ',
        keyId: 'KLMNOPQRST',
        environment: 'sandbox',
        privateKey: apnsKey,
      },
    });
    const apnsInput = {
      provider: 'apns',
      credentialId,
      appId: 'com.example.app',
      installationId: 'phone-1',
      target: { token: 'AB'.repeat(32), environment: 'sandbox' },
    };
    const apns = await endpoint(await request(path, 'PUT', JSON.stringify(apnsInput)));
    await denied(
      await request(
        path,
        'PUT',
        JSON.stringify({
          ...apnsInput,
          target: { ...apnsInput.target, environment: 'production' },
        }),
      ),
      409,
      'ENDPOINT_BINDING_INVALID',
    );
    const invalidationPath = `${path}/${apns.id}/test-invalidate`;
    await denied(
      await request(
        invalidationPath,
        'POST',
        JSON.stringify({ generation: 1, invalidatedAt: Date.parse(apns.registeredAt) - 1 }),
      ),
      409,
      'ENDPOINT_GENERATION_STALE',
    );
    const invalidated = await endpoint(
      await request(
        invalidationPath,
        'POST',
        JSON.stringify({ generation: 1, invalidatedAt: Date.parse(apns.registeredAt) }),
      ),
    );
    expect(invalidated.state).toBe('disabled');
    const refreshed = await endpoint(await request(path, 'PUT', JSON.stringify(apnsInput)));
    expect(refreshed.generation).toBe(2);
    const longerToken = await endpoint(
      await request(
        path,
        'PUT',
        JSON.stringify({ ...apnsInput, target: { ...apnsInput.target, token: 'CD'.repeat(48) } }),
      ),
    );
    expect(longerToken.generation).toBe(3);
    await denied(
      await request(
        invalidationPath,
        'POST',
        JSON.stringify({ generation: 1, invalidatedAt: Date.now() }),
      ),
      409,
      'ENDPOINT_GENERATION_STALE',
    );
  });

  it('binds active credentials and VAPID keys, rejects unsafe destinations, and accepts FCM FIDs and registration tokens', async () => {
    const { recipientId, endpointInput } = await setup();
    const path = endpointPath(recipientId);
    const wrongKey = createECDH('prime256v1');
    wrongKey.generateKeys();
    await denied(
      await request(
        path,
        'PUT',
        JSON.stringify({
          ...endpointInput,
          target: {
            ...endpointInput.target,
            applicationServerKey: wrongKey.getPublicKey().toString('base64url'),
          },
        }),
      ),
      409,
      'ENDPOINT_BINDING_INVALID',
    );
    await denied(
      await request(path, 'PUT', JSON.stringify({ ...endpointInput, appId: 'other-app' })),
      409,
      'ENDPOINT_BINDING_INVALID',
    );
    await denied(
      await request(
        path,
        'PUT',
        JSON.stringify({
          ...endpointInput,
          target: { ...endpointInput.target, endpoint: 'https://127.0.0.1/subscription' },
        }),
      ),
      422,
      'EGRESS_DESTINATION_BLOCKED',
    );
    await denied(
      await request(
        path,
        'PUT',
        JSON.stringify({
          ...endpointInput,
          target: { ...endpointInput.target, endpoint: 'http://8.8.8.8/subscription' },
        }),
      ),
      422,
      'EGRESS_DESTINATION_INVALID',
    );
    await denied(
      await request(
        path,
        'PUT',
        JSON.stringify({
          ...endpointInput,
          target: { ...endpointInput.target, p256dh: 'A'.repeat(87) },
        }),
      ),
      422,
      'RESOURCE_INPUT_INVALID',
    );
    expect((await fixture.database.query('SELECT id FROM app.endpoints')).rows).toHaveLength(0);
    const subscribed = await endpoint(await request(path, 'PUT', JSON.stringify(endpointInput)));
    const nextCredentialId = await activeCredential({
      provider: 'web-push',
      appId: 'web-app',
      secret: { privateKey: wrongKey.getPrivateKey().toString('base64url') },
    });
    await denied(
      await request(path, 'PUT', JSON.stringify(endpointInput)),
      409,
      'ENDPOINT_BINDING_INVALID',
    );
    await denied(
      await request(
        path,
        'PUT',
        JSON.stringify({ ...endpointInput, credentialId: nextCredentialId }),
      ),
      409,
      'ENDPOINT_BINDING_INVALID',
    );
    const { expirationTime: _expirationTime, ...subscription } = endpointInput.target;
    const reboundInput = {
      ...endpointInput,
      credentialId: nextCredentialId,
      target: {
        ...subscription,
        applicationServerKey: wrongKey.getPublicKey().toString('base64url'),
      },
    };
    expect(ajv.validate({ $ref: 'pipong#/components/schemas/EndpointInput' }, reboundInput)).toBe(
      true,
    );
    const rebound = await endpoint(await request(path, 'PUT', JSON.stringify(reboundInput)));
    expect(rebound.id).toBe(subscribed.id);
    expect(rebound.generation).toBe(2);
    expect(rebound.credentialId).toBe(nextCredentialId);
    const versions = await fixture.database.query<{ credential_id: string }>(
      'SELECT credential_id FROM app.endpoint_generations WHERE endpoint_id=$1 ORDER BY generation',
      [subscribed.id],
    );
    expect(versions.rows.map(({ credential_id }) => credential_id)).toEqual([
      endpointInput.credentialId,
      nextCredentialId,
    ]);
    await credential(await request(`${credentialsPath}/${nextCredentialId}/retire`, 'POST'));
    await denied(
      await request(path, 'PUT', JSON.stringify(reboundInput)),
      409,
      'ENDPOINT_BINDING_INVALID',
    );
    await denied(
      await request(path, 'PUT', JSON.stringify(endpointInput)),
      409,
      'ENDPOINT_BINDING_INVALID',
    );
    const rsaKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    });
    const credentialId = await activeCredential({
      provider: 'fcm',
      appId: 'sample-project',
      secret: {
        projectId: 'sender-project',
        clientEmail: 'sender@example.com',
        privateKey: rsaKey,
      },
    });
    const fcm = {
      provider: 'fcm',
      credentialId,
      appId: 'sample-project',
      installationId: 'android-1',
      target: { kind: 'fid', value: 'c' + 'a'.repeat(21) },
    };
    const fid = await endpoint(await request(path, 'PUT', JSON.stringify(fcm)));
    expect(fid.provider).toBe('fcm');
    const token = await endpoint(
      await request(
        path,
        'PUT',
        JSON.stringify({
          ...fcm,
          target: { kind: 'registration-token', value: 'registration:token-1' },
        }),
      ),
    );
    expect(token.id).toBe(fid.id);
    expect(token.generation).toBe(2);
    await denied(
      await request(
        path,
        'PUT',
        JSON.stringify({ ...fcm, target: { kind: 'fid', value: 'invalid' } }),
      ),
      422,
      'RESOURCE_INPUT_INVALID',
    );
  });

  it('publishes paginated redacted metadata bound to recipient and environment', async () => {
    const { recipientId, endpointInput } = await setup();
    const path = endpointPath(recipientId);
    await endpoint(await request(path, 'PUT', JSON.stringify(endpointInput)));
    await endpoint(
      await request(
        path,
        'PUT',
        JSON.stringify({
          ...endpointInput,
          installationId: 'browser-2',
          target: { ...endpointInput.target, endpoint: 'https://8.8.8.8/subscription-2' },
        }),
      ),
    );
    const response = await request(`${path}?limit=1`);
    expect(response.status).toBe(200);
    const page = v.parse(endpointPageSchema, await response.json());
    expect(ajv.validate({ $ref: 'pipong#/components/schemas/EndpointPage' }, page)).toBe(true);
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTypeOf('string');
    const next = v.parse(
      endpointPageSchema,
      await (await request(`${path}?limit=1&cursor=${page.nextCursor}`)).json(),
    );
    expect(next.items).toHaveLength(1);
    expect(next.items[0]?.id).not.toBe(page.items[0]?.id);
    const other = await recipient('other-customer');
    await denied(
      await request(`${endpointPath(other)}?cursor=${page.nextCursor}`),
      422,
      'RESOURCE_CURSOR_INVALID',
    );
    await denied(
      await request(
        `${path.replace(environmentId, siblingEnvironmentId)}?cursor=${page.nextCursor}`,
      ),
      422,
      'RESOURCE_CURSOR_INVALID',
    );
    await denied(
      await request(`${credentialsPath}?cursor=${page.nextCursor}`),
      422,
      'RESOURCE_CURSOR_INVALID',
    );
    await denied(await request(`${path}?limit=1&limit=2`), 422, 'RESOURCE_INPUT_INVALID');
    await denied(
      await request(path, 'PUT', JSON.stringify({ ...endpointInput, unexpected: true })),
      422,
      'RESOURCE_INPUT_INVALID',
    );
    await denied(
      await request(
        path,
        'PUT',
        JSON.stringify({ ...endpointInput, installationId: 'x'.repeat(20000) }),
      ),
      413,
      'RESOURCE_BODY_TOO_LARGE',
    );
    const wrongType = await fetch(`${fixture.baseUrl}${path}`, {
      method: 'PUT',
      headers: { cookie, origin: fixture.baseUrl, 'content-type': 'text/plain' },
      body: JSON.stringify(endpointInput),
    });
    await denied(wrongType, 415, 'RESOURCE_CONTENT_TYPE_INVALID');
    await denied(await request(`${path}/${organizationId}`), 404, 'RESOURCE_NOT_FOUND');
  });

  it('requires live trusted-backend authority and active recipients, with RLS and immutable ownership', async () => {
    const { recipientId, endpointInput } = await setup();
    const path = endpointPath(recipientId);
    const record = await endpoint(await request(path, 'PUT', JSON.stringify(endpointInput)));
    await denied(
      await request(`${path.replace(environmentId, siblingEnvironmentId)}/${record.id}`),
      404,
      'RESOURCE_NOT_FOUND',
    );
    const siblingCredential = await credential(
      await request(
        credentialsPath.replace(environmentId, siblingEnvironmentId),
        'POST',
        JSON.stringify(input),
      ),
    );
    await denied(
      await request(
        path,
        'PUT',
        JSON.stringify({ ...endpointInput, credentialId: siblingCredential.id }),
      ),
      404,
      'RESOURCE_NOT_FOUND',
    );
    const siblingRecipientResponse = await request(
      credentialsPath
        .replace('/credentials', '/recipients')
        .replace(environmentId, siblingEnvironmentId),
      'PUT',
      JSON.stringify({ externalId: 'sibling-recipient' }),
    );
    const siblingRecipient = v.parse(
      v.object({ id: idSchema }),
      await siblingRecipientResponse.json(),
    );
    await expect(
      fixture.database.query('UPDATE app.endpoints SET recipient_id=$1 WHERE id=$2', [
        siblingRecipient.id,
        record.id,
      ]),
    ).rejects.toMatchObject({ code: '23503', constraint: 'endpoints_recipient_ownership_fk' });
    await expect(
      fixture.database.query('UPDATE app.endpoints SET credential_id=$1 WHERE id=$2', [
        siblingCredential.id,
        record.id,
      ]),
    ).rejects.toMatchObject({ code: '23503' });
    const issuedResponse = await request(
      credentialsPath.replace('/credentials', '/service-keys'),
      'POST',
      JSON.stringify({
        name: 'Endpoint backend',
        actions: ['endpoint:read', 'endpoint:write'],
        expiresIn: 3600,
      }),
    );
    expect(issuedResponse.status).toBe(201);
    const issued = v.parse(v.object({ key: v.string() }), await issuedResponse.json());
    function keyRequest(requestPath: string, method?: string, body?: string): Promise<Response> {
      return fetch(`${fixture.baseUrl}${requestPath}`, {
        method,
        headers: { 'x-api-key': issued.key, 'content-type': 'application/json' },
        body,
      });
    }
    expect((await keyRequest(path)).status).toBe(200);
    expect(
      (await endpoint(await keyRequest(path, 'PUT', JSON.stringify(endpointInput)))).generation,
    ).toBe(2);
    await denied(
      await keyRequest(path.replace(environmentId, siblingEnvironmentId)),
      404,
      'AUTH_SCOPE_NOT_FOUND',
    );
    const unauthenticated = await fetch(`${fixture.baseUrl}${path}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(endpointInput),
    });
    await denied(unauthenticated, 401, 'AUTH_CREDENTIALS_INVALID');
    const api = new Client({ connectionString: fixture.environment.API_DATABASE_URL });
    await api.connect();
    try {
      expect((await api.query('SELECT id FROM app.endpoints')).rows).toHaveLength(0);
      expect(
        (await api.query('SELECT endpoint_id FROM app.endpoint_generations')).rows,
      ).toHaveLength(0);
      await api.query('BEGIN');
      await api.query(
        "SELECT set_config('pipong.organization_id',$1,true), set_config('pipong.project_id',$2,true), set_config('pipong.environment_id',$3,true)",
        [organizationId, projectId, environmentId],
      );
      expect((await api.query('SELECT id FROM app.endpoints')).rows).toHaveLength(1);
      await expect(
        api.query('UPDATE app.endpoints SET recipient_id=$1 WHERE id=$2', [
          organizationId,
          record.id,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await api.query('ROLLBACK');
      await expect(
        api.query("UPDATE app.endpoint_generations SET encrypted_target='tampered'"),
      ).rejects.toMatchObject({ code: '42501' });
      const flags = await fixture.database.query<{ relforcerowsecurity: boolean }>(
        "SELECT relforcerowsecurity FROM pg_class WHERE oid IN ('app.endpoints'::regclass,'app.endpoint_generations'::regclass)",
      );
      expect(flags.rows).toEqual([{ relforcerowsecurity: true }, { relforcerowsecurity: true }]);
    } finally {
      await api.end();
    }
    await fixture.database.query('UPDATE app.environments SET suspended_at=now() WHERE id=$1', [
      environmentId,
    ]);
    await denied(
      await keyRequest(path, 'PUT', JSON.stringify(endpointInput)),
      409,
      'AUTH_SCOPE_SUSPENDED',
    );
    await fixture.database.query('UPDATE app.environments SET suspended_at=NULL WHERE id=$1', [
      environmentId,
    ]);
    expect((await request(path.replace('/endpoints', ''), 'DELETE')).status).toBe(204);
    await denied(
      await keyRequest(path, 'PUT', JSON.stringify(endpointInput)),
      404,
      'RESOURCE_NOT_FOUND',
    );
    await denied(
      await keyRequest(`${path}/${record.id}/disable`, 'POST', JSON.stringify({ generation: 2 })),
      404,
      'RESOURCE_NOT_FOUND',
    );
    await denied(await keyRequest(path), 404, 'RESOURCE_NOT_FOUND');
    await fixture.database.query('UPDATE auth.api_keys SET enabled=false');
    await denied(await keyRequest(path), 401, 'AUTH_CREDENTIALS_INVALID');
  });
});
