import type * as WorkerRuntime from '../../../worker/src/runtime.ts';
import { subscribe } from 'node:diagnostics_channel';
import { lookup } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import { ClientRequest } from 'node:http';
import { connect } from 'node:http2';
import * as v from 'valibot';

const runtimeUrl = new URL('../../../worker/dist/runtime.mjs', import.meta.url);
const { runWorker } = v.parse(
  v.object({
    runWorker: v.custom<typeof WorkerRuntime.runWorker>((value) => v.is(v.function(), value)),
  }),
  await import(runtimeUrl.href),
);

const origin = v.parse(v.pipe(v.string(), v.url()), process.env.QUALIFICATION_PROVIDER_ORIGIN);
const certificate = await readFile(
  new URL('../../../../packages/service/tests/fixtures/push-cert.pem', import.meta.url),
);

const httpOrigin = new URL(
  v.parse(v.pipe(v.string(), v.url()), process.env.QUALIFICATION_FCM_ORIGIN),
).origin;
const webPushOrigin = v.parse(
  v.pipe(v.string(), v.url()),
  process.env.QUALIFICATION_WEB_PUSH_ORIGIN,
);
const host = new URL(origin).hostname;
const addresses = await lookup(host, { all: true });

subscribe('http.client.request.start', (message) => {
  const parsed = v.safeParse(v.object({ request: v.instance(ClientRequest) }), message);
  if (!parsed.success) {
    return;
  }
  const started = Date.now();
  parsed.output.request.on('error', (error: Error) => {
    const code = v.safeParse(v.object({ code: v.optional(v.string()) }), error);
    console.error(
      'QUALIFICATION_TRANSPORT_FAILURE',
      JSON.stringify({
        code:
          code.success && code.output.code
            ? code.output.code
            : error.message.startsWith('EGRESS_')
              ? error.message.split(':')[0]
              : error.name,
        milliseconds: Date.now() - started,
      }),
    );
  });
});

await runWorker({
  connectApns: () => connect(origin, { ca: certificate, servername: 'push.test' }),
  requestFcmToken: (_input, init) => fetch(new URL('/token', httpOrigin), init),
  fcmOrigin: httpOrigin,
  webPushOrigin,
  webPushCa: certificate.toString(),
  webPushAddresses: addresses,
});
