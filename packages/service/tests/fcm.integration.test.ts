import type { SendReservation } from '@pipong/database/attempts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createSecretKey, generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import * as v from 'valibot';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFcmAuth } from '../src/providers/fcm-auth.ts';
import { createFcmRuntime } from '../src/providers/fcm.ts';
import { encryptSecret } from '../src/secrets.ts';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
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
const messageSchema = v.object({
  message: v.object({ fid: v.optional(v.string()), token: v.optional(v.string()) }),
});
type ReservedSend = Extract<SendReservation, { status: 'send' }>;

function reservation(kind: 'fid' | 'registration-token'): ReservedSend {
  const target = {
    kind,
    value: kind === 'fid' ? `c${'A'.repeat(21)}` : 'registration:token-value_123',
  };
  const secret = {
    provider: 'fcm',
    appId: 'target-project',
    secret: { projectId: 'credential-project', clientEmail: 'push@example.test', privateKey: pem },
  };
  return {
    status: 'send',
    sendUntil: new Date(Date.now() + 120_000),
    fence: {
      job: { ...scope, notificationId: deliveryId, deliveryId, provider: 'fcm' },
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
    publicKey: null,
    encryptedSecret: encryptSecret(
      keyring,
      {
        ...scope,
        resourceId: credentialId,
        purpose: 'credential',
        binding: JSON.stringify(['fcm', secret.appId, null]),
      },
      JSON.stringify(secret),
    ),
    encryptedTarget: encryptSecret(
      keyring,
      {
        ...scope,
        resourceId: endpointId,
        purpose: 'endpoint',
        binding: JSON.stringify([deliveryId, 'fcm', secret.appId, 'phone', 1, credentialId]),
      },
      JSON.stringify(target),
    ),
  };
}

describe('FCM HTTP v1', () => {
  const server = createServer();
  let origin = '';
  let handler: (request: IncomingMessage, response: ServerResponse) => void;
  const received: { path: string; authorization: string; body: string }[] = [];
  beforeAll(async () => {
    server.on('request', (request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        body += chunk;
      });
      request.on('end', () => {
        received.push({
          path: request.url ?? '',
          authorization: request.headers.authorization ?? '',
          body,
        });
        handler(request, response);
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = v.parse(v.object({ port: v.number() }), server.address());
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    server.close();
    await once(server, 'close');
  });
  beforeEach(() => {
    received.length = 0;
    handler = (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ name: 'projects/target-project/messages/123' }));
    };
  });

  it('refuses a paused reservation after its send deadline before OAuth or provider I/O', async () => {
    const expired = { ...reservation('fid'), sendUntil: new Date(0) };
    const runtime = createFcmRuntime(
      fetch,
      () => {
        throw new Error('TEST_UNEXPECTED_AUTH');
      },
      origin,
    );
    try {
      expect((await runtime.send(expired, keyring)).outcome).toMatchObject({
        kind: 'transient',
        code: 'DELIVERY_RESERVATION_EXPIRED',
      });
      expect(received).toHaveLength(0);
    } finally {
      runtime.close();
    }
  });

  it('sends FID and registration targets to the explicit target project with refreshed bearer tokens', async () => {
    let tokenVersion = 0;
    const authAccounts: string[] = [];
    const runtime = createFcmRuntime(
      fetch,
      (email, key) => {
        authAccounts.push(`${email}:${key === pem}`);
        return { getAccessToken: () => Promise.resolve(`token-${++tokenVersion}`) };
      },
      origin,
    );
    try {
      expect((await runtime.send(reservation('fid'), keyring)).outcome.kind).toBe('accepted');
      expect((await runtime.send(reservation('registration-token'), keyring)).outcome.kind).toBe(
        'accepted',
      );
      expect(received.map((entry) => entry.path)).toEqual([
        '/v1/projects/target-project/messages:send',
        '/v1/projects/target-project/messages:send',
      ]);
      expect(received.map((entry) => entry.authorization)).toEqual([
        'Bearer token-1',
        'Bearer token-2',
      ]);
      expect(v.parse(messageSchema, JSON.parse(received[0]?.body ?? '{}')).message).toMatchObject({
        fid: `c${'A'.repeat(21)}`,
      });
      expect(v.parse(messageSchema, JSON.parse(received[1]?.body ?? '{}')).message).toMatchObject({
        token: 'registration:token-value_123',
      });
      expect(authAccounts).toEqual([`push@example.test:true`]);
    } finally {
      runtime.close();
    }
  });

  it('exercises the real Google JWT OAuth exchange through Gaxios with retries disabled', async () => {
    handler = (request, response) => {
      if (request.url === '/token') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({ access_token: 'google-token', expires_in: 3600, token_type: 'Bearer' }),
        );
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ name: 'projects/target-project/messages/123' }));
    };
    const runtime = createFcmRuntime(
      fetch,
      (email, key) =>
        createFcmAuth(email, key, (_input, init) => fetch(new URL('/token', origin), init)),
      origin,
    );
    try {
      expect((await runtime.send(reservation('fid'), keyring)).outcome.kind).toBe('accepted');
      expect(received).toHaveLength(2);
      expect(received[0]?.path).toBe('/token');
      expect(received[0]?.body).toContain('assertion=');
      expect(received[1]?.authorization).toBe('Bearer google-token');
    } finally {
      runtime.close();
    }
  });

  it('does not retry a transient Google OAuth HTTP response', async () => {
    handler = (_request, response) => {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'temporarily_unavailable' }));
    };
    const runtime = createFcmRuntime(
      fetch,
      (email, key) =>
        createFcmAuth(email, key, (_input, init) => fetch(new URL('/token', origin), init)),
      origin,
    );
    try {
      const result = await runtime.send(reservation('fid'), keyring);
      expect(result.outcome.kind).toBe('transient');
      expect(result.response).toMatchObject({
        status: null,
        authStatus: 503,
      });
      expect(received).toHaveLength(1);
      expect(received[0]?.path).toBe('/token');
    } finally {
      runtime.close();
    }
  });

  it('preserves quota reason and Retry-After while applying FCM quota minimum delay', async () => {
    handler = (_request, response) => {
      response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '5' });
      response.end(
        JSON.stringify({
          error: {
            status: 'RESOURCE_EXHAUSTED',
            details: [
              {
                '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
                errorCode: 'QUOTA_EXCEEDED',
              },
              {
                '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
                violations: [
                  {
                    subject: 'projects/secret-project/quotas/device_messages',
                    description: 'raw device id must not persist',
                  },
                ],
              },
            ],
          },
        }),
      );
    };
    const runtime = createFcmRuntime(
      fetch,
      () => ({ getAccessToken: () => Promise.resolve('token') }),
      origin,
    );
    try {
      const result = await runtime.send(reservation('fid'), keyring);
      expect(result.outcome.kind).toBe('transient');
      expect(result.outcome.code).toBe('FCM_QUOTA_EXCEEDED');
      expect(result.response).toMatchObject({
        status: 429,
        quotaReason: 'FCM_QUOTA_EXCEEDED',
        retryAfter: '5',
      });
      if (result.outcome.kind === 'transient') {
        expect(result.outcome.retryAt.getTime()).toBeGreaterThanOrEqual(Date.now() + 59_000);
      }
    } finally {
      runtime.close();
    }
  });

  it('stores only fixed quota categories when quota evidence contains identifiers', async () => {
    handler = (_request, response) => {
      response.writeHead(429, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          error: {
            status: 'RESOURCE_EXHAUSTED',
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
                violations: [
                  {
                    subject: 'projects/private-project/quotas/registration_token_123',
                    description: 'user@example.test: private-project',
                  },
                ],
              },
              {
                '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
                reason: 'private-reason-registration_token_123',
              },
            ],
          },
        }),
      );
    };
    const runtime = createFcmRuntime(
      fetch,
      () => ({ getAccessToken: () => Promise.resolve('token') }),
      origin,
    );
    try {
      const result = await runtime.send(reservation('fid'), keyring);
      expect(result.outcome.code).toBe('FCM_QUOTA_LIMIT');
      expect(JSON.stringify(result)).not.toMatch(
        /private-project|registration_token_123|private-reason|user@example/,
      );
    } finally {
      runtime.close();
    }
  });

  it('honors a longer Retry-After on service errors and leaves invalid arguments non-invalidating', async () => {
    handler = (_request, response) => {
      response.writeHead(503, { 'content-type': 'application/json', 'retry-after': '120' });
      response.end(JSON.stringify({ error: { status: 'UNAVAILABLE' } }));
    };
    const runtime = createFcmRuntime(
      fetch,
      () => ({ getAccessToken: () => Promise.resolve('token') }),
      origin,
    );
    try {
      const result = await runtime.send(reservation('fid'), keyring);
      expect(result.outcome.kind).toBe('transient');
      expect(result.response).toMatchObject({
        status: 503,
        errorStatus: 'UNAVAILABLE',
        retryAfter: '120',
      });
      if (result.outcome.kind === 'transient') {
        expect(result.outcome.retryAt.getTime()).toBeGreaterThanOrEqual(Date.now() + 119_000);
      }
    } finally {
      runtime.close();
    }
  });

  it('classifies UNREGISTERED separately from invalid request errors', async () => {
    handler = (_request, response) => {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          error: {
            status: 'NOT_FOUND',
            details: [
              {
                '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
                errorCode: 'UNREGISTERED',
              },
            ],
          },
        }),
      );
    };
    const runtime = createFcmRuntime(
      fetch,
      () => ({ getAccessToken: () => Promise.resolve('token') }),
      origin,
    );
    try {
      const result = await runtime.send(reservation('fid'), keyring);
      expect(result.outcome).toMatchObject({ kind: 'permanent', code: 'UNREGISTERED' });
      expect(result.response?.errorCode).toBe('UNREGISTERED');
    } finally {
      runtime.close();
    }
  });

  it.each([
    { name: '', error: undefined },
    {
      name: 'projects/target-project/messages/123',
      error: {
        code: 404,
        message: 'error only',
      },
    },
    {
      name: 'projects/target-project/messages/123',
      error: {},
    },
    {
      name: 'projects/target-project/messages/123',
      error: {
        status: 'NOT_FOUND',
        details: [
          {
            '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
            errorCode: 'UNREGISTERED',
          },
        ],
      },
    },
  ])('rejects malformed or contradictory success receipts', async (body) => {
    handler = (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify(body.error ? { name: body.name, error: body.error } : { name: body.name }),
      );
    };
    const runtime = createFcmRuntime(
      fetch,
      () => ({ getAccessToken: () => Promise.resolve('token') }),
      origin,
    );
    try {
      expect((await runtime.send(reservation('fid'), keyring)).outcome.kind).toBe('ambiguous');
    } finally {
      runtime.close();
    }
  });

  it('transmits encoder-approved messages when only the outer envelope exceeds 4096 bytes', async () => {
    const send = reservation('fid');
    send.request = send.request.replace('"orderId":"A-1"', `"orderId":"${'x'.repeat(3740)}"`);
    const runtime = createFcmRuntime(
      fetch,
      () => ({ getAccessToken: () => Promise.resolve('token') }),
      origin,
    );
    try {
      const result = await runtime.send(send, keyring);
      expect(result.outcome.kind).toBe('accepted');
      expect(received).toHaveLength(1);
      expect(Buffer.byteLength(received[0]?.body ?? '')).toBeGreaterThan(4096);
    } finally {
      runtime.close();
    }
  });

  it.each(['redirect', 'oversized', 'missing-receipt'] as const)(
    'treats %s responses as ambiguous without a second send',
    async (scenario) => {
      handler = (_request, response) => {
        if (scenario === 'redirect') {
          response.writeHead(302, { location: `${origin}/redirect` });
          response.end();
        } else if (scenario === 'missing-receipt') {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end('{}');
        } else {
          response.writeHead(200, { 'content-type': 'text/plain' });
          response.end('x'.repeat(8193));
        }
      };
      const runtime = createFcmRuntime(
        fetch,
        () => ({ getAccessToken: () => Promise.resolve('token') }),
        origin,
      );
      try {
        const result = await runtime.send(reservation('fid'), keyring);
        expect(result.outcome.kind).toBe('ambiguous');
        if (scenario !== 'redirect') {
          expect(result.response).toMatchObject({ status: 200 });
        }
        expect(received).toHaveLength(1);
      } finally {
        runtime.close();
      }
    },
  );

  it('aborts an outstanding HTTP request when the runtime closes', async () => {
    let resolveRequestStarted: (() => void) | undefined;
    const requestStarted = new Promise<void>((resolve) => {
      resolveRequestStarted = resolve;
    });
    handler = (_request, _response) => {
      resolveRequestStarted?.();
    };
    const runtime = createFcmRuntime(
      fetch,
      () => ({ getAccessToken: () => Promise.resolve('token') }),
      origin,
    );
    const sending = runtime.send(reservation('fid'), keyring);
    await requestStarted;
    runtime.close();
    expect((await sending).outcome.kind).toBe('ambiguous');
    expect(received).toHaveLength(1);
  });

  it('cancels the real Gaxios OAuth request when the runtime closes', async () => {
    let oauthResponseClosed = false;
    let resolveOauthStarted: (() => void) | undefined;
    const oauthStarted = new Promise<void>((resolve) => {
      resolveOauthStarted = resolve;
    });
    handler = (request, response) => {
      if (request.url === '/token') {
        response.on('close', () => {
          oauthResponseClosed = true;
        });
        resolveOauthStarted?.();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ name: 'projects/target-project/messages/123' }));
    };
    const runtime = createFcmRuntime(
      fetch,
      (email, key) =>
        createFcmAuth(email, key, (_input, init) => fetch(new URL('/token', origin), init)),
      origin,
    );
    const sending = runtime.send(reservation('fid'), keyring);
    await oauthStarted;
    runtime.close();
    expect((await sending).outcome.kind).toBe('ambiguous');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(oauthResponseClosed).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]?.path).toBe('/token');
  });

  it('cancels the real Gaxios OAuth request when the operation deadline expires', async () => {
    let oauthResponseClosed = false;
    let resolveOauthStarted: (() => void) | undefined;
    const oauthStarted = new Promise<void>((resolve) => {
      resolveOauthStarted = resolve;
    });
    handler = (request, response) => {
      if (request.url === '/token') {
        response.on('close', () => {
          oauthResponseClosed = true;
        });
        resolveOauthStarted?.();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ name: 'projects/target-project/messages/123' }));
    };
    const runtime = createFcmRuntime(
      fetch,
      (email, key) =>
        createFcmAuth(email, key, (_input, init) => fetch(new URL('/token', origin), init)),
      origin,
      50,
    );
    try {
      const sending = runtime.send(reservation('fid'), keyring);
      await oauthStarted;
      expect((await sending).outcome.kind).toBe('transient');
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(oauthResponseClosed).toBe(true);
      expect(received).toHaveLength(1);
      expect(received[0]?.path).toBe('/token');
    } finally {
      runtime.close();
    }
  });

  it('keeps a shared OAuth refresh alive for a later send with a longer deadline', async () => {
    let oauthCount = 0;
    let resolveOauthStarted: (() => void) | undefined;
    const oauthStarted = new Promise<void>((resolve) => {
      resolveOauthStarted = resolve;
    });
    handler = (request, response) => {
      if (request.url === '/token') {
        oauthCount += 1;
        resolveOauthStarted?.();
        setTimeout(() => {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              access_token: 'shared-token',
              expires_in: 3600,
              token_type: 'Bearer',
            }),
          );
        }, 600);
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ name: 'projects/target-project/messages/123' }));
    };
    const runtime = createFcmRuntime(
      fetch,
      (email, key) =>
        createFcmAuth(email, key, (_input, init) => fetch(new URL('/token', origin), init)),
      origin,
      500,
    );
    try {
      const firstSend = runtime.send(reservation('fid'), keyring);
      await oauthStarted;
      await new Promise((resolve) => setTimeout(resolve, 250));
      const secondSend = runtime.send(reservation('registration-token'), keyring);
      const firstResult = await firstSend;
      expect(firstResult.outcome.kind).toBe('transient');
      expect((await secondSend).outcome.kind).toBe('accepted');
      expect(oauthCount).toBe(1);
      expect(received.filter((entry) => entry.path === '/token')).toHaveLength(1);
      expect(
        received.filter((entry) => entry.path === '/v1/projects/target-project/messages:send'),
      ).toHaveLength(1);
    } finally {
      runtime.close();
    }
  });

  it('starts a fresh OAuth exchange after every waiter cancels the prior exchange', async () => {
    let oauthCount = 0;
    let oauthResponseClosed = false;
    let resolveOauthStarted: (() => void) | undefined;
    const oauthStarted = new Promise<void>((resolve) => {
      resolveOauthStarted = resolve;
    });
    handler = (request, response) => {
      if (request.url === '/token') {
        oauthCount += 1;
        if (oauthCount === 1) {
          response.on('close', () => {
            oauthResponseClosed = true;
          });
          resolveOauthStarted?.();
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({ access_token: 'fresh-token', expires_in: 3600, token_type: 'Bearer' }),
        );
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ name: 'projects/target-project/messages/123' }));
    };
    const runtime = createFcmRuntime(
      fetch,
      (email, key) =>
        createFcmAuth(email, key, (_input, init) => fetch(new URL('/token', origin), init)),
      origin,
      50,
    );
    try {
      const firstResult = runtime.send(reservation('fid'), keyring);
      await oauthStarted;
      expect((await firstResult).outcome.kind).toBe('transient');
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(oauthResponseClosed).toBe(true);
      expect((await runtime.send(reservation('fid'), keyring)).outcome.kind).toBe('accepted');
      expect(oauthCount).toBe(2);
    } finally {
      runtime.close();
    }
  });

  it('does not start an HTTP send when shutdown happens during OAuth refresh', async () => {
    let finishAuthentication: ((token: string) => void) | undefined;
    const runtime = createFcmRuntime(
      fetch,
      () => ({
        getAccessToken: () =>
          new Promise((resolve) => {
            finishAuthentication = resolve;
          }),
      }),
      origin,
    );
    const sending = runtime.send(reservation('fid'), keyring);
    await new Promise((resolve) => setTimeout(resolve, 10));
    runtime.close();
    finishAuthentication?.('late-token');
    await sending;
    expect(received).toHaveLength(0);
  });

  it('treats temporary OAuth failures as retryable and bounds the auth phase by the send deadline', async () => {
    const transientRuntime = createFcmRuntime(
      fetch,
      () => ({ getAccessToken: () => Promise.reject(new Error('ETIMEDOUT')) }),
      origin,
    );
    const transient = await transientRuntime.send(reservation('fid'), keyring);
    expect(transient.outcome).toMatchObject({ kind: 'transient', code: 'FCM_AUTH_UNAVAILABLE' });
    transientRuntime.close();

    const deadlineRuntime = createFcmRuntime(
      fetch,
      () => ({ getAccessToken: () => new Promise(() => undefined) }),
      origin,
      30,
    );
    const timedOut = await deadlineRuntime.send(reservation('fid'), keyring);
    expect(timedOut.outcome.kind).toBe('transient');
    expect(received).toHaveLength(0);
    deadlineRuntime.close();
  });

  it('expires a delivery while OAuth is refreshing without sending it', async () => {
    let finishAuthentication: ((token: string) => void) | undefined;
    const expiring = reservation('fid');
    expiring.request = expiring.request.replace(
      /"expiresAt":"[^"]+"/,
      `"expiresAt":"${new Date(Date.now() + 1500).toISOString()}"`,
    );
    const runtime = createFcmRuntime(
      fetch,
      () => ({
        getAccessToken: () =>
          new Promise((resolve) => {
            finishAuthentication = resolve;
          }),
      }),
      origin,
    );
    const sending = runtime.send(expiring, keyring);
    await new Promise((resolve) => setTimeout(resolve, 1600));
    finishAuthentication?.('late-token');
    expect((await sending).outcome).toMatchObject({
      kind: 'transient',
      code: 'NOTIFICATION_EXPIRED',
    });
    expect(received).toHaveLength(0);
    runtime.close();
  });

  it('settles expired work as expired when OAuth fails after its deadline', async () => {
    const expiring = reservation('fid');
    expiring.request = expiring.request.replace(
      /"expiresAt":"[^"]+"/,
      `"expiresAt":"${new Date(Date.now() + 1100).toISOString()}"`,
    );
    const runtime = createFcmRuntime(
      fetch,
      () => ({
        getAccessToken: () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => {
              reject(new Error('ETIMEDOUT'));
            }, 1200);
          }),
      }),
      origin,
    );
    expect((await runtime.send(expiring, keyring)).outcome).toMatchObject({
      kind: 'transient',
      code: 'NOTIFICATION_EXPIRED',
    });
    expect(received).toHaveLength(0);
    runtime.close();
  });

  it.each([429, 503])(
    'retains retry scheduling when the %s response body stalls',
    async (status) => {
      handler = (_request, response) => {
        response.writeHead(status, { 'retry-after': '120' });
        response.flushHeaders();
      };
      const runtime = createFcmRuntime(
        fetch,
        () => ({ getAccessToken: () => Promise.resolve('token') }),
        origin,
        30,
      );
      try {
        const result = await runtime.send(reservation('fid'), keyring);
        expect(result.response).toMatchObject({ status, retryAfter: '120' });
        expect(result.outcome.kind).toBe('transient');
        if (result.outcome.kind === 'transient') {
          expect(result.outcome.retryAt.getTime()).toBeGreaterThanOrEqual(Date.now() + 119_000);
        }
      } finally {
        runtime.close();
      }
    },
  );
});
