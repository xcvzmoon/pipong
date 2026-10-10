import type { KeyObject } from 'node:crypto';
import type { ClientHttp2Session, IncomingHttpHeaders } from 'node:http2';
import type { ProviderPayload } from '../provider-payloads.ts';
import { createPrivateKey, sign } from 'node:crypto';
import { connect, constants } from 'node:http2';
import * as v from 'valibot';

export type ApnsBinding = {
  organizationId: string;
  projectId: string;
  environmentId: string;
  credentialId: string;
  topic: string;
  environment: 'sandbox' | 'production';
  teamId: string;
  keyId: string;
  privateKey: string;
};
export type ApnsResponse = {
  status: number;
  apnsId: string | null;
  reason: string | null;
  invalidatedAt: number | null;
  retryAfter: string | null;
};
export type ApnsTransportResult =
  | { kind: 'response'; response: ApnsResponse }
  | { kind: 'ambiguous'; code: 'APNS_TRANSPORT_FAILED' | 'APNS_RESPONSE_INVALID' };
export type ApnsConnection = (environment: ApnsBinding['environment']) => ClientHttp2Session;
export type ApnsClient = {
  send: (
    payload: Extract<ProviderPayload, { provider: 'apns' }>,
    token: string,
    id: string,
    sendUntil: Date,
  ) => Promise<ApnsTransportResult>;
  close: () => void;
  busy: () => boolean;
};
const errorSchema = v.object({
  reason: v.pipe(v.string(), v.regex(/^[A-Za-z0-9]{1,100}$/)),
  timestamp: v.optional(
    v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(8640000000000000)),
  ),
});

export function connectApns(environment: ApnsBinding['environment']): ClientHttp2Session {
  return connect(
    environment === 'production'
      ? 'https://api.push.apple.com'
      : 'https://api.sandbox.push.apple.com',
  );
}

export function createApnsClient(binding: ApnsBinding, connection: ApnsConnection): ApnsClient {
  const key: KeyObject = createPrivateKey(binding.privateKey);
  let session: ClientHttp2Session | undefined;
  let jwt = '';
  let issuedAt = 0;
  let active = false;
  let closed = false;

  function authorization(): string {
    const now = Math.floor(Date.now() / 1000);
    if (!jwt || now - issuedAt >= 3000 || now < issuedAt) {
      const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: binding.keyId })).toString(
        'base64url',
      );
      const claims = Buffer.from(JSON.stringify({ iss: binding.teamId, iat: now })).toString(
        'base64url',
      );
      const unsigned = `${header}.${claims}`;
      jwt = `${unsigned}.${sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
      issuedAt = now;
    }
    return `bearer ${jwt}`;
  }

  function close(): void {
    closed = true;
    session?.destroy();
    jwt = '';
  }

  async function send(
    payload: Extract<ProviderPayload, { provider: 'apns' }>,
    token: string,
    id: string,
    sendUntil: Date,
  ): Promise<ApnsTransportResult> {
    if (sendUntil.getTime() <= Date.now()) {
      return { kind: 'ambiguous', code: 'APNS_TRANSPORT_FAILED' };
    }
    if (closed || active) {
      throw new Error('APNS_CLIENT_UNAVAILABLE');
    }
    if (
      payload.headers['apns-topic'] !== binding.topic ||
      Buffer.byteLength(payload.body) > 4096 ||
      !/^(?:[a-f0-9]{2}){1,512}$/.test(token)
    ) {
      throw new Error('APNS_BINDING_INVALID');
    }
    active = true;
    try {
      if (!session || session.closed || session.destroyed) {
        session = connection(binding.environment);
        const current = session;
        current.on('error', () => {
          current.destroy();
        });
        current.on('goaway', () => {
          current.close();
        });
      }
      const current = session;
      const headers: IncomingHttpHeaders = {
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        authorization: authorization(),
        'apns-id': id,
      };
      for (const [name, value] of Object.entries(payload.headers)) {
        if (value !== undefined) {
          headers[name] = value;
        }
      }
      return await new Promise<ApnsTransportResult>((resolve) => {
        const stream = current.request(headers);
        let received: IncomingHttpHeaders | undefined;
        let body = '';
        let bytes = 0;
        let settled = false;
        const deadline = setTimeout(
          () => {
            finish({ kind: 'ambiguous', code: 'APNS_TRANSPORT_FAILED' });
            current.destroy();
          },
          Math.min(10_000, Math.max(1, sendUntil.getTime() - Date.now())),
        );
        function finish(result: ApnsTransportResult): void {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(deadline);
          resolve(result);
        }
        stream.setEncoding('utf8');
        stream.on('response', (responseHeaders) => {
          received = responseHeaders;
        });
        stream.on('data', (chunk: string) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > 8192) {
            finish({ kind: 'ambiguous', code: 'APNS_RESPONSE_INVALID' });
            stream.close(constants.NGHTTP2_CANCEL);
          } else {
            body += chunk;
          }
        });
        stream.on('error', () => {
          finish({ kind: 'ambiguous', code: 'APNS_TRANSPORT_FAILED' });
        });
        stream.on('close', () => {
          finish({ kind: 'ambiguous', code: 'APNS_TRANSPORT_FAILED' });
        });
        stream.on('end', () => {
          try {
            const status = v.parse(
              v.pipe(v.number(), v.integer(), v.minValue(100), v.maxValue(599)),
              received?.[':status'],
            );
            const apnsId = v.parse(
              v.nullable(v.pipe(v.string(), v.uuid())),
              received?.['apns-id'] ?? null,
            );
            const retryAfter = v.parse(
              v.nullable(v.pipe(v.string(), v.maxLength(128))),
              received?.['retry-after'] ?? null,
            );
            const error = status === 200 ? undefined : v.parse(errorSchema, JSON.parse(body));
            finish({
              kind: 'response',
              response: {
                status,
                apnsId,
                reason: error?.reason ?? null,
                invalidatedAt: error?.timestamp ?? null,
                retryAfter,
              },
            });
          } catch {
            finish({ kind: 'ambiguous', code: 'APNS_RESPONSE_INVALID' });
          }
        });
        stream.end(payload.body);
      });
    } catch {
      session?.destroy();
      return { kind: 'ambiguous', code: 'APNS_TRANSPORT_FAILED' };
    } finally {
      active = false;
    }
  }
  return { send, close, busy: () => active };
}
