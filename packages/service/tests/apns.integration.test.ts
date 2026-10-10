import type { SendReservation } from '@pipong/database/attempts';
import type { ClientHttp2Session, IncomingHttpHeaders, ServerHttp2Stream } from 'node:http2';
import type { ApnsResponse } from '../src/providers/apns-client.ts';
import {
  createPrivateKey,
  createPublicKey,
  createSecretKey,
  generateKeyPairSync,
  verify,
} from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { connect, createSecureServer } from 'node:http2';
import * as v from 'valibot';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApnsRuntime } from '../src/providers/apns.ts';
import { encryptSecret } from '../src/secrets.ts';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const keyring = {
  activeKeyId: 'test',
  keys: new Map([['test', createSecretKey(Buffer.alloc(32, 7))]]),
};
const scope = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  projectId: '00000000-0000-4000-8000-000000000002',
  environmentId: '00000000-0000-4000-8000-000000000003',
};
const credentialId = '00000000-0000-4000-8000-000000000004';
const endpointId = '00000000-0000-4000-8000-000000000005';
const deliveryId = '00000000-0000-4000-8000-000000000006';
const apnsId = '00000000-0000-4000-8000-000000000007';
const baseline = Date.now();

type ReservedSend = Extract<SendReservation, { status: 'send' }>;
function reservation(
  environment: 'sandbox' | 'production' = 'sandbox',
  background = false,
): ReservedSend {
  const target = { token: 'ab'.repeat(32), environment };
  const secret = {
    provider: 'apns',
    appId: 'com.pipong.test',
    secret: { environment, teamId: 'TEAM000001', keyId: 'KEY0000001', privateKey: pem },
  };
  return {
    status: 'send',
    fence: {
      job: { ...scope, notificationId: deliveryId, deliveryId, provider: 'apns' },
      claim: { id: deliveryId, retryCount: 0 },
      generation: 1,
    },
    request: JSON.stringify({
      targets: { kind: 'recipients', ids: [deliveryId] },
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      content: background
        ? { data: { value: '1' } }
        : { alert: { title: 'Hello', body: 'World' }, data: {} },
    }),
    expiresAt: new Date(Date.now() + 3600_000),
    appId: secret.appId,
    endpointId,
    recipientId: deliveryId,
    installationId: 'phone',
    endpointGeneration: 1,
    credentialId,
    publicKey: null,
    encryptedSecret: encryptSecret(
      keyring,
      {
        ...scope,
        resourceId: credentialId,
        purpose: 'credential',
        binding: JSON.stringify(['apns', secret.appId, null]),
      },
      JSON.stringify(secret),
    ),
    encryptedTarget: encryptSecret(
      keyring,
      {
        ...scope,
        resourceId: endpointId,
        purpose: 'endpoint',
        binding: JSON.stringify([deliveryId, 'apns', secret.appId, 'phone', 1, credentialId]),
      },
      JSON.stringify(target),
    ),
  };
}

describe('APNs over local HTTP/2', () => {
  const cert = readFileSync(new URL('./fixtures/push-cert.pem', import.meta.url));
  const key = readFileSync(new URL('./fixtures/push-key.pem', import.meta.url));
  const server = createSecureServer({ key, cert });
  function connection(): ClientHttp2Session {
    return connect(origin, { ca: cert, servername: 'push.test' });
  }
  let origin = '';
  let requests = 0;
  let sessions = 0;
  let handler: (stream: ServerHttp2Stream) => void;
  const received: { headers: Record<string, string | number | undefined>; body: string }[] = [];
  beforeAll(async () => {
    server.on('session', () => {
      sessions += 1;
    });
    server.on('stream', (stream: ServerHttp2Stream, headers: IncomingHttpHeaders) => {
      requests += 1;
      let body = '';
      stream.setEncoding('utf8');
      stream.on('error', () => {});
      stream.on('data', (chunk: string) => {
        body += chunk;
      });
      stream.on('end', () => {
        received.push({
          headers: {
            authorization: String(headers.authorization),
            topic: String(headers['apns-topic']),
            pushType: String(headers['apns-push-type']),
            priority: String(headers['apns-priority']),
            path: String(headers[':path']),
            id: String(headers['apns-id']),
          },
          body,
        });
        handler(stream);
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = v.parse(v.object({ port: v.number() }), server.address());
    origin = `https://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    server.close();
    await once(server, 'close');
  });
  beforeEach(() => {
    requests = 0;
    sessions = 0;
    received.length = 0;
    vi.setSystemTime(baseline);
    handler = (stream) => {
      stream.respond({ ':status': 200, 'apns-id': apnsId });
      stream.end();
    };
  });

  it('rejects an untrusted TLS peer before sending', async () => {
    const runtime = createApnsRuntime(() => connect(origin, { servername: 'push.test' }));
    try {
      expect((await runtime.send(reservation(), keyring)).outcome).toMatchObject({
        kind: 'ambiguous',
        code: 'APNS_TRANSPORT_FAILED',
      });
      expect(requests).toBe(0);
    } finally {
      runtime.close();
    }
  });

  it('sends alert/background headers and signed JWTs without altering the encoded payload', async () => {
    const runtime = createApnsRuntime(connection);
    try {
      expect((await runtime.send(reservation(), keyring)).outcome.kind).toBe('accepted');
      expect((await runtime.send(reservation('sandbox', true), keyring)).outcome.kind).toBe(
        'accepted',
      );
      expect(received[0]?.headers).toMatchObject({
        topic: 'com.pipong.test',
        pushType: 'alert',
        priority: '10',
        id: deliveryId,
      });
      expect(received[1]?.headers).toMatchObject({ pushType: 'background', priority: '5' });
      expect(JSON.parse(received[1]?.body ?? '{}')).toMatchObject({
        aps: { 'content-available': 1 },
        deliveryId,
      });
      const jwt = String(received[0]?.headers.authorization).slice(7);
      const [header, claims, signature] = jwt.split('.');
      expect(JSON.parse(Buffer.from(header ?? '', 'base64url').toString())).toEqual({
        alg: 'ES256',
        kid: 'KEY0000001',
      });
      expect(
        verify(
          'sha256',
          Buffer.from(`${header}.${claims}`),
          { key: createPublicKey(createPrivateKey(pem)), dsaEncoding: 'ieee-p1363' },
          Buffer.from(signature ?? '', 'base64url'),
        ),
      ).toBe(true);
      expect(sessions).toBe(1);
    } finally {
      runtime.close();
    }
  });

  it('isolates environment and tenant bindings and refreshes JWTs after 50 minutes', async () => {
    const environments: string[] = [];
    const runtime = createApnsRuntime((environment) => {
      environments.push(environment);
      return connection();
    });
    try {
      await runtime.send(reservation(), keyring);
      vi.setSystemTime(baseline + 49 * 60_000);
      await runtime.send(reservation(), keyring);
      vi.setSystemTime(baseline + 50 * 60_000);
      await runtime.send(reservation(), keyring);
      await runtime.send(reservation('production'), keyring);
      expect(received[0]?.headers.authorization).toBe(received[1]?.headers.authorization);
      expect(received[2]?.headers.authorization).not.toBe(received[1]?.headers.authorization);
      expect(environments).toEqual(['sandbox', 'production']);
      const tampered = reservation();
      tampered.fence.job.organizationId = '00000000-0000-4000-8000-000000000009';
      await expect(runtime.send(tampered, keyring)).rejects.toThrow('CREDENTIAL_DECRYPT_FAILED');
      expect(requests).toBe(4);
    } finally {
      runtime.close();
      vi.useRealTimers();
    }
  });

  it('preserves 410 reason, provider ID, and millisecond invalidation time', async () => {
    const timestamp = baseline - 1000;
    handler = (stream) => {
      stream.respond({ ':status': 410, 'apns-id': apnsId });
      stream.end(JSON.stringify({ reason: 'Unregistered', timestamp }));
    };
    const runtime = createApnsRuntime(connection);
    try {
      const result = await runtime.send(reservation(), keyring);
      expect(result.outcome).toEqual({ kind: 'permanent', code: 'APNS_Unregistered' });
      expect(result.response).toEqual({
        status: 410,
        apnsId,
        reason: 'Unregistered',
        invalidatedAt: timestamp,
        retryAfter: null,
      } satisfies ApnsResponse);
      expect(requests).toBe(1);
    } finally {
      runtime.close();
    }
  });

  it.each(['1', '1800', new Date(baseline + 1800_000).toUTCString()])(
    'honors 5xx retry floor and Retry-After %s without retrying the transport',
    async (delay) => {
      const runtime = createApnsRuntime(connection);
      try {
        handler = (stream) => {
          stream.respond({ ':status': 503, 'retry-after': delay });
          stream.end('{"reason":"ServiceUnavailable"}');
        };
        const result = await runtime.send(reservation(), keyring);
        expect(result.outcome.kind).toBe('transient');
        if (result.outcome.kind === 'transient') {
          expect(result.outcome.retryAt.getTime()).toBeGreaterThanOrEqual(
            baseline + (delay === '1' ? 900_000 : 1799_000),
          );
        }
        expect(requests).toBe(1);
      } finally {
        runtime.close();
      }
    },
  );

  it('bounds malformed responses and preserves ambiguous failures', async () => {
    const runtime = createApnsRuntime(connection);
    try {
      handler = (stream) => {
        stream.respond({ ':status': 500 });
        stream.end('x'.repeat(9000));
      };
      expect((await runtime.send(reservation(), keyring)).outcome).toMatchObject({
        kind: 'ambiguous',
        code: 'APNS_RESPONSE_INVALID',
      });
      handler = (stream) => {
        stream.respond({ ':status': 403 });
        stream.end('{"reason":"InvalidProviderToken"}');
      };
      expect((await runtime.send(reservation(), keyring)).outcome).toEqual({
        kind: 'permanent',
        code: 'APNS_InvalidProviderToken',
      });
    } finally {
      runtime.close();
    }
  });

  it('reconnects after GOAWAY and closes in-flight sends without a hidden retry', async () => {
    const runtime = createApnsRuntime(connection);
    try {
      handler = (stream) => {
        stream.respond({ ':status': 200, 'apns-id': apnsId });
        stream.session?.goaway();
        stream.end();
      };
      expect((await runtime.send(reservation(), keyring)).outcome.kind).toBe('accepted');
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect((await runtime.send(reservation(), keyring)).outcome.kind).toBe('accepted');
      handler = () => {
        runtime.close();
      };
      expect((await runtime.send(reservation(), keyring)).outcome.kind).toBe('ambiguous');
      await expect(runtime.send(reservation(), keyring)).rejects.toThrow('APNS_RUNTIME_CLOSED');
      expect(requests).toBe(3);
    } finally {
      runtime.close();
    }
  });
});
