import type { ServerHttp2Stream } from 'node:http2';
import { readFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createSecureServer } from 'node:http2';
import { createServer } from 'node:https';
import * as v from 'valibot';

const cert = await readFile(
  new URL('../../../../packages/service/tests/fixtures/push-cert.pem', import.meta.url),
);
const key = await readFile(
  new URL('../../../../packages/service/tests/fixtures/push-key.pem', import.meta.url),
);
const providerCounts = { apns: 0, fcm: 0, 'web-push': 0 };
let providerErrors = 0;
let oauthRequests = 0;
let sustainedOauthRefreshes = 0;
let trafficStarted = 0;
let duration = 0;
const apns = createSecureServer({ key, cert });
apns.on('stream', (stream: ServerHttp2Stream, headers) => {
  stream.on('error', () => {});
  stream.resume();
  stream.on('end', () => {
    providerCounts.apns++;
    stream.respond({ ':status': 200, 'apns-id': headers['apns-id'] });
    stream.end();
  });
});
const webPush = createServer({ key, cert }, (request, response) => {
  let bytes = 0;
  request.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
  });
  request.on('end', () => {
    if (
      !request.headers.authorization?.startsWith('vapid ') ||
      request.headers['content-encoding'] !== 'aes128gcm' ||
      bytes === 0
    ) {
      providerErrors++;
    }
    providerCounts['web-push']++;
    response.writeHead(201);
    response.end();
  });
});
const fcm = createHttpServer((request, response) => {
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk: string) => {
    body += chunk;
  });
  request.on('end', () => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/stats') {
      response.end(
        JSON.stringify({ providerCounts, providerErrors, oauthRequests, sustainedOauthRefreshes }),
      );
      return;
    }
    if (request.url === '/start') {
      duration = v.parse(
        v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(60), v.maxValue(1800)),
        body,
      );
      trafficStarted = Date.now();
      response.end('{}');
      return;
    }
    if (request.url === '/token') {
      oauthRequests++;
      const elapsed = Date.now() - trafficStarted;
      if (trafficStarted > 0 && elapsed >= 600000 && elapsed < duration * 1000) {
        sustainedOauthRefreshes++;
      }
      if (!new URLSearchParams(body).get('assertion')) {
        providerErrors++;
      }
      response.end(
        JSON.stringify({
          access_token: 'qualification-token',
          token_type: 'Bearer',
          expires_in: 900,
        }),
      );
      return;
    }
    try {
      const message = v.safeParse(
        v.object({ message: v.object({ token: v.string() }) }),
        JSON.parse(body),
      );
      if (
        !message.success ||
        request.headers.authorization !== 'Bearer qualification-token' ||
        request.url !== '/v1/projects/target-project/messages:send'
      ) {
        providerErrors++;
      }
    } catch {
      providerErrors++;
    }
    providerCounts.fcm++;
    response.end(JSON.stringify({ name: 'projects/target-project/messages/qualification' }));
  });
});
apns.listen(3040, '0.0.0.0');
webPush.listen(3041, '0.0.0.0');
fcm.listen(3042, '0.0.0.0');
