import type { Server } from 'node:https';
import type { EgressPolicy } from '../src/egress.ts';
import { createECDH, randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { Resolver } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import * as v from 'valibot';
import { afterAll, beforeAll, expect, test } from 'vitest';
import webpush from 'web-push';
import { loadEgressPolicy, validateDestination } from '../src/egress.ts';
import { sendWebPushRequest } from '../src/web-push-transport.ts';

let server: Server;
let origin: string;
let policy: EgressPolicy;
let requests = 0;
const resolver = () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]);

beforeAll(async () => {
  const key = await readFile(new URL('./fixtures/push-key.pem', import.meta.url));
  const cert = await readFile(new URL('./fixtures/push-cert.pem', import.meta.url));
  server = createServer({ key, cert }, (request, response) => {
    requests += 1;

    if (request.url === '/redirect') {
      response.writeHead(307, { location: '/accepted' });
      response.end();
    } else if (request.url === '/large') {
      response.end(Buffer.alloc(9000));
    } else if (request.url === '/slow') {
      response.writeHead(201);
      response.write('a');
      const timer = setInterval(() => response.write('a'), 10);
      response.on('close', () => {
        clearInterval(timer);
      });
    } else {
      response.writeHead(201, { 'retry-after': '60' });
      request.resume();
      request.on('end', () => {
        response.end('accepted');
      });
    }
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = v.parse(v.object({ port: v.number() }), server.address());

  origin = `https://push.test:${address.port}`;
  policy = {
    ...(await loadEgressPolicy()),
    privateOrigins: [{ origin, cidrs: ['127.0.0.1/32'], ca: cert.toString() }],
  };
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
});

function details(path: string): ReturnType<typeof webpush.generateRequestDetails> {
  const receiver = createECDH('prime256v1');
  receiver.generateKeys();
  const vapid = webpush.generateVAPIDKeys();
  return webpush.generateRequestDetails(
    {
      endpoint: `${origin}${path}`,
      keys: {
        p256dh: receiver.getPublicKey().toString('base64url'),
        auth: randomBytes(16).toString('base64url'),
      },
    },
    'hello',
    {
      contentEncoding: 'aes128gcm',
      vapidDetails: { ...vapid, subject: 'mailto:operator@example.com' },
    },
  );
}

test('rejects private, mapped, metadata, mixed DNS and invalid URLs', async () => {
  const defaults = await loadEgressPolicy();

  const endpoints = [
    'http://push.test/x',
    'https://user:secret@push.test/x',
    'https://push.test/x#fragment',
    'https://127.0.0.1/x',
    'https://[::ffff:127.0.0.1]/x',
    'https://169.254.169.254/x',
    'https://push.test:8443/x',
  ];
  await Promise.all(
    endpoints.map((endpoint) =>
      expect(validateDestination(endpoint, defaults, resolver)).rejects.toThrow('EGRESS_'),
    ),
  );

  await expect(
    validateDestination('https://push.test/x', defaults, () =>
      Promise.resolve([
        { address: '8.8.8.8', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ]),
    ),
  ).rejects.toThrow('EGRESS_DESTINATION_BLOCKED');
  expect(
    (
      await validateDestination('https://push.test/x', defaults, () =>
        Promise.resolve([{ address: '2606:4700:4700::1111', family: 6 }]),
      )
    ).family,
  ).toBe(6);
});

test('pins one screened DNS result and rechecks DNS on the next send', async () => {
  let calls = 0;
  const changingResolver = () => {
    calls += 1;
    return Promise.resolve([{ address: calls === 1 ? '127.0.0.1' : '10.0.0.1', family: 4 }]);
  };
  const response = await sendWebPushRequest(details('/accepted'), policy, changingResolver);
  expect(response.statusCode).toBe(201);
  expect(response.headers['retry-after']).toBe('60');
  expect(response.body.toString()).toBe('accepted');
  expect(calls).toBe(1);
  await expect(sendWebPushRequest(details('/accepted'), policy, changingResolver)).rejects.toThrow(
    'EGRESS_DESTINATION_BLOCKED',
  );
  expect(calls).toBe(2);
});

test('rejects redirects without following them and caps response bytes', async () => {
  const before = requests;
  await expect(sendWebPushRequest(details('/redirect'), policy, resolver)).rejects.toThrow(
    'EGRESS_REDIRECT',
  );
  expect(requests).toBe(before + 1);
  await expect(sendWebPushRequest(details('/large'), policy, resolver)).rejects.toThrow(
    'EGRESS_RESPONSE_LIMIT',
  );
});

test('enforces total deadline during DNS and a continuously streaming response', async () => {
  const bounded = { ...policy, totalTimeoutMs: 100, idleTimeoutMs: 1000 };
  await expect(sendWebPushRequest(details('/slow'), bounded, resolver)).rejects.toThrow(
    'EGRESS_DEADLINE',
  );
  await expect(
    sendWebPushRequest(details('/accepted'), bounded, async () => new Promise(() => {})),
  ).rejects.toThrow('EGRESS_DEADLINE');
});

test('requires trusted TLS and matching hostname even with a private exception', async () => {
  const noTrust = { ...policy, privateOrigins: [{ origin, cidrs: ['127.0.0.1/32'] }] };
  await expect(sendWebPushRequest(details('/accepted'), noTrust, resolver)).rejects.toThrow(
    'EGRESS_NETWORK_FAILED',
  );
  const wrongOrigin = origin.replace('push.test', 'wrong.test');
  const wrongPolicy = {
    ...policy,
    privateOrigins: [{ ...policy.privateOrigins[0], origin: wrongOrigin, cidrs: ['127.0.0.1/32'] }],
  };
  await expect(
    sendWebPushRequest(
      { ...details('/accepted'), endpoint: `${wrongOrigin}/accepted` },
      wrongPolicy,
      resolver,
    ),
  ).rejects.toThrow('EGRESS_NETWORK_FAILED');
});

test('resolves through a controlled DNS server before connecting over HTTPS', async () => {
  const dns = createSocket('udp4');
  let queries = 0;
  dns.on('message', (query, remote) => {
    queries += 1;
    const header = Buffer.from(query.subarray(0, 12));
    header.writeUInt16BE(0x8180, 2);
    header.writeUInt16BE(1, 6);
    header.writeUInt16BE(0, 8);
    header.writeUInt16BE(0, 10);
    const answer = Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 1, 0, 4, 127, 0, 0, 1]);
    dns.send(Buffer.concat([header, query.subarray(12), answer]), remote.port, remote.address);
  });
  await new Promise<void>((resolve) => {
    dns.bind(0, '127.0.0.1', resolve);
  });

  try {
    const dnsResolver = new Resolver();
    dnsResolver.setServers([`127.0.0.1:${dns.address().port}`]);
    const response = await sendWebPushRequest(details('/accepted'), policy, async (hostname) => {
      const addresses = await dnsResolver.resolve4(hostname);
      return addresses.map((address) => ({ address, family: 4 }));
    });
    expect(response.statusCode).toBe(201);
    expect(queries).toBe(1);
  } finally {
    await new Promise<void>((resolve) => {
      dns.close(resolve);
    });
  }
});
