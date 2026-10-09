import type { NotificationRequest } from '../src/notification-contract.ts';
import type { PayloadDestination } from '../src/provider-payloads.ts';
import { createECDH, randomBytes } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import webpush from 'web-push';
import {
  boundNotificationTargets,
  notificationRequestSchema,
  parseNotificationRequest,
} from '../src/notification-contract.ts';
import { encodeProviderPayload } from '../src/provider-payloads.ts';

const now = Date.parse('2026-10-09T00:00:00.000Z');
const id = '00000000-0000-4000-8000-000000000001';
const identity = { notificationId: id, deliveryId: '00000000-0000-4000-8000-000000000002' };
const input = {
  targets: { kind: 'recipients', ids: [id] },
  content: { alert: { title: 'Hello', body: '世界' }, data: { event: 'created' } },
  expiresAt: '2026-10-09T00:01:00.999Z',
};
function parsed(): NotificationRequest {
  return v.parse(notificationRequestSchema, input);
}
const destinations: PayloadDestination[] = [
  { provider: 'apns', topic: 'com.example.app' },
  { provider: 'fcm', target: { kind: 'fid', value: 'c1234567890123456789012' } },
  { provider: 'web-push' },
];

describe('notification contract', () => {
  it('rejects malformed, unknown, reserved, and unsupported content without echoing secrets', () => {
    expect(parseNotificationRequest('{', now, 'request').ok).toBe(false);
    for (const body of [
      { ...input, secret: 'do-not-echo' },
      { ...input, content: { data: {} } },
      { ...input, content: { data: { event: '\ud800' } } },
      { ...input, overrides: { apns: { pushType: 'voip' } } },
      { ...input, overrides: { apns: { pushType: 'background', priority: 10 } } },
      { ...input, overrides: { apns: { pushType: 'background' } } },
      { ...input, overrides: { webPush: { topic: 'a'.repeat(33) } } },
      { ...input, overrides: { fcm: { ttl: 200 } } },
    ]) {
      const result = parseNotificationRequest(JSON.stringify(body), now, 'request');
      expect(result).toMatchObject({
        ok: false,
        problem: { status: 422, code: 'NOTIFICATION_INVALID', requestId: 'request' },
      });
      expect(JSON.stringify(result)).not.toContain('do-not-echo');
      if (result.ok || !result.problem.invalidParams) {
        throw new Error('Expected safe validation pointers');
      }
      expect(result.problem.invalidParams.length).toBeGreaterThan(0);
      for (const { pointer } of result.problem.invalidParams) {
        expect(pointer).toMatch(/^(|\/(targets|content|expiresAt|overrides))$/);
      }
    }
    for (const key of [
      'aps',
      'notificationId',
      'deliveryId',
      'google.test',
      'gcm.notification.test',
      'from',
      'message_type',
      'collapse_key',
    ]) {
      expect(
        parseNotificationRequest(
          JSON.stringify({ ...input, content: { data: { [key]: 'value' } } }),
          now,
          'request',
        ).ok,
      ).toBe(false);
    }
    expect(
      parseNotificationRequest(
        JSON.stringify({
          ...input,
          overrides: { apns: { pushType: 'alert', collapseId: '界'.repeat(22) } },
        }),
        now,
        'request',
      ).ok,
    ).toBe(false);
  });

  it('bounds raw UTF-8 bodies, explicit targets, deduplicated expansion, and expiry', () => {
    const body = JSON.stringify(input);
    expect(
      parseNotificationRequest(body + ' '.repeat(65536 - Buffer.byteLength(body)), now, 'request')
        .ok,
    ).toBe(true);
    expect(
      parseNotificationRequest(body + ' '.repeat(65537 - Buffer.byteLength(body)), now, 'request'),
    ).toMatchObject({ ok: false, problem: { status: 413 } });
    expect(
      parseNotificationRequest(
        JSON.stringify({ ...input, content: { data: { text: '界'.repeat(22000) } } }),
        now,
        'request',
      ),
    ).toMatchObject({ ok: false, problem: { status: 413 } });
    for (const expiresAt of [
      new Date(now).toISOString(),
      new Date(now + 999).toISOString(),
      new Date(now + 2419200001).toISOString(),
      'invalid',
      '2026-02-30T00:00:00.000Z',
    ]) {
      expect(
        parseNotificationRequest(JSON.stringify({ ...input, expiresAt }), now, 'request').ok,
      ).toBe(false);
    }
    expect(
      parseNotificationRequest(
        JSON.stringify({ ...input, expiresAt: new Date(now + 2419200000).toISOString() }),
        now,
        'request',
      ).ok,
    ).toBe(true);
    expect(parseNotificationRequest(body, Number.NaN, 'request').ok).toBe(false);
    expect(
      parseNotificationRequest(
        JSON.stringify({ ...input, expiresAt: '2026-10-09T01:01:00.999+01:00' }),
        now,
        'request',
      ),
    ).toMatchObject({ ok: true, value: { expiresAt: input.expiresAt } });
    for (const targets of [
      { kind: 'recipients', ids: Array.from({ length: 101 }, () => id) },
      { kind: 'endpoints', ids: Array.from({ length: 1001 }, () => id) },
      { kind: 'recipients', ids: [] },
    ]) {
      expect(
        parseNotificationRequest(JSON.stringify({ ...input, targets }), now, 'request').ok,
      ).toBe(false);
    }
    expect(boundNotificationTargets([id, id], 'request')).toEqual({ ok: true, value: [id] });
    expect(boundNotificationTargets([], 'request')).toMatchObject({
      ok: false,
      problem: { code: 'NOTIFICATION_NO_TARGETS' },
    });
    expect(
      boundNotificationTargets(
        Array.from({ length: 1000 }, (_entry, index) => String(index)),
        'request',
      ).ok,
    ).toBe(true);
    expect(
      boundNotificationTargets(
        Array.from({ length: 1001 }, (_entry, index) => String(index)),
        'request',
      ),
    ).toMatchObject({ ok: false, problem: { code: 'NOTIFICATION_TARGET_LIMIT_EXCEEDED' } });
  });

  it('encodes metadata and expiry in provider units and supports both FCM identities', () => {
    for (const destination of destinations) {
      const result = encodeProviderPayload(parsed(), destination, identity, now + 1000, 'request');
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error('Expected encoded payload');
      }
      expect(result.value.body).toContain(identity.deliveryId);
      if (result.value.provider === 'apns') {
        expect(result.value.headers).toMatchObject({
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'apns-expiration': String(Math.floor(Date.parse(input.expiresAt) / 1000)),
        });
      } else if (result.value.provider === 'fcm') {
        expect(JSON.parse(result.value.body)).toMatchObject({
          message: {
            fid: 'c1234567890123456789012',
            android: { ttl: '59s' },
            webpush: { headers: { TTL: '59' } },
          },
        });
        expect(result.value.body).not.toContain('"token"');
      } else {
        expect(result.value.options).toMatchObject({ TTL: 59, contentEncoding: 'aes128gcm' });
      }
      expect(
        encodeProviderPayload(
          parsed(),
          destination,
          identity,
          Date.parse(input.expiresAt),
          'request',
        ),
      ).toMatchObject({ ok: false, problem: { code: 'NOTIFICATION_EXPIRY_INVALID' } });
    }
    const token = encodeProviderPayload(
      parsed(),
      { provider: 'fcm', target: { kind: 'registration-token', value: 'registration' } },
      identity,
      now,
      'request',
    );
    expect(token.ok && token.value.body).toContain('"token":"registration"');
    const background = v.parse(notificationRequestSchema, {
      ...input,
      content: { data: { action: 'refresh' } },
      overrides: { apns: { pushType: 'background' } },
    });
    const payload = encodeProviderPayload(
      background,
      destinations[0] ?? { provider: 'web-push' },
      identity,
      now,
      'request',
    );
    expect(payload).toMatchObject({
      ok: true,
      value: { headers: { 'apns-push-type': 'background', 'apns-priority': '5' } },
    });
    expect(payload.ok && JSON.parse(payload.value.body)).toMatchObject({
      aps: { 'content-available': 1 },
    });
  });

  it('enforces exact final byte boundaries including metadata, multibyte text and JSON escaping', () => {
    for (const destination of destinations) {
      const request = v.parse(notificationRequestSchema, {
        ...input,
        content: { data: { value: '界' } },
      });
      const baseline = encodeProviderPayload(request, destination, identity, now, 'request');
      if (!baseline.ok) {
        throw new Error('Expected baseline payload');
      }
      const limit = destination.provider === 'web-push' ? 3993 : 4096;
      request.content.data.value += 'a'.repeat(limit - baseline.value.bytes);
      expect(encodeProviderPayload(request, destination, identity, now, 'request')).toMatchObject({
        ok: true,
        value: { bytes: limit },
      });
      request.content.data.value += '界';
      expect(encodeProviderPayload(request, destination, identity, now, 'request')).toMatchObject({
        ok: false,
        problem: { code: 'NOTIFICATION_PAYLOAD_TOO_LARGE' },
      });
      request.content.data.value = '\n'.repeat(2100);
      expect(encodeProviderPayload(request, destination, identity, now, 'request').ok).toBe(false);
    }
  });

  it('produces provider request bodies consumed by a local protocol fixture and portable encrypted Web Push', async () => {
    const server = createServer((incoming, response) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      incoming.on('end', () => {
        const body = Buffer.concat(chunks);
        if (incoming.url === '/web-push') {
          expect(incoming.headers['content-encoding']).toBe('aes128gcm');
          expect(incoming.headers.ttl).toBe('60');
          expect(body.length).toBeLessThanOrEqual(4096);
          response.writeHead(201);
        } else {
          const dataSchema = v.object({
            notificationId: v.literal(identity.notificationId),
            deliveryId: v.literal(identity.deliveryId),
          });
          const schema =
            incoming.url === '/fcm'
              ? v.object({
                  message: v.object({
                    fid: v.string(),
                    notification: v.object({ title: v.string(), body: v.string() }),
                    data: dataSchema,
                    android: v.object({ ttl: v.literal('60s') }),
                  }),
                })
              : v.object({
                  notificationId: v.literal(identity.notificationId),
                  deliveryId: v.literal(identity.deliveryId),
                  aps: v.object({ alert: v.object({ title: v.string(), body: v.string() }) }),
                });
          expect(v.safeParse(schema, JSON.parse(body.toString('utf8'))).success).toBe(true);
          response.writeHead(200);
        }
        response.end();
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = v.parse(v.object({ port: v.number() }), server.address());
      if (!address) {
        throw new Error('Missing fixture address');
      }
      const key = createECDH('prime256v1');
      key.generateKeys();
      const vapid = webpush.generateVAPIDKeys();
      await Promise.all(
        destinations.map(async (destination) => {
          const result = encodeProviderPayload(parsed(), destination, identity, now, 'request');
          if (!result.ok) {
            throw new Error('Expected payload');
          }
          let body: string | Buffer = result.value.body;
          let headers: Record<string, string | number> = {};
          if (result.value.provider === 'web-push') {
            const boundary = v.parse(notificationRequestSchema, {
              ...input,
              content: { data: { value: '' } },
            });
            const base = encodeProviderPayload(boundary, destination, identity, now, 'request');
            if (!base.ok) {
              throw new Error('Expected baseline');
            }
            boundary.content.data.value = 'a'.repeat(3993 - base.value.bytes);
            const encoded = encodeProviderPayload(boundary, destination, identity, now, 'request');
            if (!encoded.ok || encoded.value.provider !== 'web-push') {
              throw new Error('Expected Web Push boundary');
            }
            const details = webpush.generateRequestDetails(
              {
                endpoint: 'https://push.example.test/send',
                keys: {
                  p256dh: key.getPublicKey().toString('base64url'),
                  auth: randomBytes(16).toString('base64url'),
                },
              },
              encoded.value.body,
              {
                ...encoded.value.options,
                vapidDetails: {
                  subject: 'mailto:operator@example.test',
                  publicKey: vapid.publicKey,
                  privateKey: vapid.privateKey,
                },
              },
            );
            if (!details.body) {
              throw new Error('Missing encrypted body');
            }
            body = details.body;
            headers = details.headers;
            expect(body.length).toBe(Buffer.byteLength(encoded.value.body) + 103);
          }
          const status = await new Promise<number>((resolve, reject) => {
            const outgoing = httpRequest(
              {
                hostname: '127.0.0.1',
                port: address.port,
                path: `/${destination.provider}`,
                method: 'POST',
                headers,
              },
              (response) => {
                response.resume();
                response.on('end', () => {
                  resolve(response.statusCode ?? 0);
                });
              },
            );
            outgoing.on('error', reject);
            outgoing.end(body);
          });
          expect(status).toBe(destination.provider === 'web-push' ? 201 : 200);
        }),
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    }
  });
});
