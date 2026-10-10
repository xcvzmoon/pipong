import type { SendReservation } from '@pipong/database/attempts';
import type { EgressPolicy } from '../src/egress.ts';
import { createECDH, createSecretKey } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import * as v from 'valibot';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import webpush from 'web-push';
import { loadEgressPolicy } from '../src/egress.ts';
import { createWebPushRuntime } from '../src/providers/web-push.ts';
import { encryptSecret } from '../src/secrets.ts';

const vapid = webpush.generateVAPIDKeys();
const receiver = createECDH('prime256v1');
receiver.generateKeys();
const keyring = {
  activeKeyId: 'test',
  keys: new Map([['test', createSecretKey(Buffer.alloc(32, 9))]]),
};
const scope = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  projectId: '00000000-0000-4000-8000-000000000002',
  environmentId: '00000000-0000-4000-8000-000000000003',
};
const credentialId = '00000000-0000-4000-8000-000000000004';
const endpointId = '00000000-0000-4000-8000-000000000005';
const deliveryId = '00000000-0000-4000-8000-000000000006';
type ReservedSend = Extract<SendReservation, { status: 'send' }>;

function reservation(endpoint: string, keys = vapid): ReservedSend {
  const target = {
    endpoint,
    p256dh: receiver.getPublicKey().toString('base64url'),
    auth: Buffer.alloc(16, 4).toString('base64url'),
    applicationServerKey: keys.publicKey,
  };
  const secret = {
    provider: 'web-push',
    appId: 'browser-app',
    secret: { privateKey: keys.privateKey },
  };
  return {
    status: 'send',
    sendUntil: new Date(Date.now() + 120_000),
    fence: {
      job: { ...scope, notificationId: deliveryId, deliveryId, provider: 'web-push' },
      claim: { id: deliveryId, retryCount: 0 },
      generation: 1,
    },
    request: JSON.stringify({
      targets: { kind: 'recipients', ids: [deliveryId] },
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      content: { alert: { title: 'Hello', body: 'World' }, data: { orderId: 'A-1' } },
    }),
    expiresAt: new Date(Date.now() + 3600_000),
    appId: secret.appId,
    endpointId,
    recipientId: deliveryId,
    installationId: 'phone',
    endpointGeneration: 1,
    credentialId,
    publicKey: keys.publicKey,
    encryptedSecret: encryptSecret(
      keyring,
      {
        ...scope,
        resourceId: credentialId,
        purpose: 'credential',
        binding: JSON.stringify(['web-push', secret.appId, keys.publicKey]),
      },
      JSON.stringify(secret),
    ),
    encryptedTarget: encryptSecret(
      keyring,
      {
        ...scope,
        resourceId: endpointId,
        purpose: 'endpoint',
        binding: JSON.stringify([deliveryId, 'web-push', secret.appId, 'phone', 1, credentialId]),
      },
      JSON.stringify(target),
    ),
  };
}

const resolver = () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]);

describe('bound Web Push delivery', () => {
  let origin = '';
  let policy: EgressPolicy;
  let status = 201;
  let retryAfter = '120';
  const received: { authorization: string; body: Buffer; ttl: string }[] = [];
  const server = createServer();
  beforeAll(async () => {
    const key = await readFile(new URL('./fixtures/push-key.pem', import.meta.url));
    const cert = await readFile(new URL('./fixtures/push-cert.pem', import.meta.url));
    server.setSecureContext({ key, cert });
    server.on('request', (request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      request.on('end', () => {
        received.push({
          authorization: request.headers.authorization ?? '',
          body: Buffer.concat(chunks),
          ttl: String(request.headers.ttl),
        });
        response.writeHead(status, { 'retry-after': retryAfter });
        response.end('private provider response');
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = v.parse(v.object({ port: v.number() }), server.address());
    origin = `https://push.test:${address.port}`;
    policy = {
      ...(await loadEgressPolicy()),
      privateOrigins: [{ origin, cidrs: ['127.0.0.1/32'], ca: cert.toString() }],
    };
  });
  afterAll(async () => {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  });
  beforeEach(() => {
    received.length = 0;
    status = 201;
    retryAfter = '120';
  });

  it('encrypts once and binds VAPID audience including the port and the reserved key version', async () => {
    const runtime = createWebPushRuntime('mailto:operator@example.com', policy, resolver);
    const next = webpush.generateVAPIDKeys();
    for (const keys of [vapid, next, vapid]) {
      // eslint-disable-next-line no-await-in-loop -- Verify sequential rotation without global VAPID state.
      const result = await runtime.send(reservation(`${origin}/subscription`, keys), keyring);
      expect(result.outcome.kind).toBe('accepted');
    }
    expect(received).toHaveLength(3);
    for (const [index, entry] of received.entries()) {
      const authorization = entry.authorization;
      const token = authorization.match(/^vapid t=([^,]+), k=(.+)$/);
      expect(token?.[2]).toBe(index === 1 ? next.publicKey : vapid.publicKey);
      const claims = v.parse(
        v.object({ aud: v.string(), sub: v.string() }),
        JSON.parse(Buffer.from(token?.[1]?.split('.')[1] ?? '', 'base64url').toString()),
      );
      expect(claims).toEqual({ aud: origin, sub: 'mailto:operator@example.com' });
      expect(entry.body.length).toBeLessThanOrEqual(4096);
      expect(entry.body.includes(Buffer.from('Hello'))).toBe(false);
      expect(Number(entry.ttl)).toBeGreaterThan(0);
      expect(Number(entry.ttl)).toBeLessThanOrEqual(3600);
    }
  });

  it.each([404, 410, 401, 403, 413])(
    'preserves terminal HTTP %i without exposing provider bodies',
    async (code) => {
      status = code;
      const runtime = createWebPushRuntime('mailto:operator@example.com', policy, resolver);
      const result = await runtime.send(reservation(`${origin}/subscription`), keyring);
      expect(result.outcome).toEqual({ kind: 'permanent', code: `WEB_PUSH_HTTP_${code}` });
      expect(result.response).toEqual({ status: code, retryAfter: '120' });
      expect(received).toHaveLength(1);
    },
  );

  it.each([429, 500, 503])(
    'honors Retry-After for HTTP %i without transport retries',
    async (code) => {
      status = code;
      const before = Date.now();
      const result = await createWebPushRuntime(
        'mailto:operator@example.com',
        policy,
        resolver,
      ).send(reservation(`${origin}/subscription`), keyring);
      expect(result.outcome.kind).toBe('transient');
      if (result.outcome.kind === 'transient') {
        expect(result.outcome.retryAt.getTime()).toBeGreaterThanOrEqual(before + 120_000);
      }
      expect(received).toHaveLength(1);
    },
  );

  it('rejects mismatched bound keys and oversized payloads before connecting', async () => {
    const runtime = createWebPushRuntime('mailto:operator@example.com', policy, resolver);
    const bound = reservation(`${origin}/subscription`);
    bound.publicKey = webpush.generateVAPIDKeys().publicKey;
    await expect(runtime.send(bound, keyring)).rejects.toThrow();
    const large = reservation(`${origin}/subscription`);
    large.request = JSON.stringify({
      targets: { kind: 'recipients', ids: [deliveryId] },
      expiresAt: large.expiresAt.toISOString(),
      content: { data: { value: 'a'.repeat(3900) } },
    });
    expect((await runtime.send(large, keyring)).outcome).toEqual({
      kind: 'permanent',
      code: 'NOTIFICATION_PAYLOAD_TOO_LARGE',
    });
    expect(received).toHaveLength(0);
  });

  it('settles an expired payload without opening a connection', async () => {
    const bound = reservation(`${origin}/subscription`);
    bound.expiresAt = new Date(Date.now() - 1000);
    bound.request = JSON.stringify({
      targets: { kind: 'recipients', ids: [deliveryId] },
      expiresAt: bound.expiresAt.toISOString(),
      content: { data: { orderId: 'expired' } },
    });
    const result = await createWebPushRuntime('mailto:operator@example.com', policy, resolver).send(
      bound,
      keyring,
    );
    expect(result.outcome.kind).toBe('transient');
    expect(result.outcome.code).toBe('NOTIFICATION_EXPIRED');
    expect(received).toHaveLength(0);
  });

  it('returns ambiguous failures when connect-time DNS screening rejects a destination', async () => {
    const runtime = createWebPushRuntime(
      'mailto:operator@example.com',
      await loadEgressPolicy(),
      resolver,
    );
    expect(
      (await runtime.send(reservation('https://push.test/subscription'), keyring)).outcome.kind,
    ).toBe('ambiguous');
    expect(received).toHaveLength(0);
  });
});
