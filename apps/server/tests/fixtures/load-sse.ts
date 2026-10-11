import type { IncomingMessage } from 'node:http';
import type { Client } from 'pg';
import { once } from 'node:events';
import { request } from 'node:https';
import { setTimeout } from 'node:timers/promises';
import { v7 } from 'uuid';
import * as v from 'valibot';
import { expect } from 'vitest';

export type Scope = {
  organizationId: string;
  projectId: string;
  environmentId: string;
  recipientId: string;
};
type Reader = { scope: Scope } & (
  | { kind: 'human'; userId: string; headers: { cookie: string } }
  | { kind: 'service-key'; keyId: string; headers: { 'x-api-key': string } }
);
type StreamHeaders = { cookie?: string; 'x-api-key'?: string; 'last-event-id'?: string };
type Connection = {
  readerIndex: number;
  response: IncomingMessage;
  live: boolean;
  expectedClose: boolean;
  lastCursor: string;
  sequence: bigint;
  events: number;
  lastDeliveryAt: number;
};
type StreamReport = {
  live: number;
  delivered: number;
  recentDelivery: number;
  events: number;
  bytes: number;
  unexpectedClosures: number;
  frameErrors: number;
  sequenceGaps: number;
  humanSessions: number;
  serviceKeys: number;
};
type RevocationReport = {
  expectedClosed: number;
  revokedInWindow: boolean;
  milliseconds: number;
  humanReconnectStatus: number | undefined;
  keyReconnectStatus: number | undefined;
};
export type StreamHarness = {
  open: (count: number) => Promise<void>;
  report: (cutoff?: number) => StreamReport;
  revoke: () => Promise<RevocationReport>;
  replay: (submit: (scope: Scope) => Promise<{ status: number }>) => Promise<boolean>;
  close: () => void;
};
const cursorSchema = v.tuple([
  v.literal('1'),
  v.pipe(v.string(), v.uuid()),
  v.pipe(v.string(), v.uuid()),
  v.pipe(v.string(), v.uuid()),
  v.pipe(v.string(), v.regex(/^\d+$/), v.toBigint()),
]);

export function scopePath(scope: Scope): string {
  return `/api/v1/organizations/${scope.organizationId}/projects/${scope.projectId}/environments/${scope.environmentId}`;
}

export async function startQualificationStreams(
  database: Client,
  baseUrl: string,
  port: number,
  certificate: Buffer,
  scopes: Scope[],
  cookie: string,
): Promise<StreamHarness> {
  const readers: Reader[] = [];
  const password = await database.query<{ password: string }>(
    "SELECT password FROM auth.accounts WHERE user_id=$1 AND provider_id='credential'",
    ['019a0000-0000-7000-8000-000000000011'],
  );
  const passwordHash = v.parse(v.string(), password.rows[0]?.password);
  await database.query('UPDATE auth.users SET two_factor_enabled=true WHERE id=$1', [
    '019a0000-0000-7000-8000-000000000011',
  ]);
  await database.query(
    'INSERT INTO auth.mfa_assurances (session_id,verified_at) SELECT id,now() FROM auth.sessions WHERE user_id=$1 ON CONFLICT DO NOTHING',
    ['019a0000-0000-7000-8000-000000000011'],
  );
  // oxlint-disable eslint/no-await-in-loop -- Each independent principal is provisioned before its streams open.
  for (const [index, scope] of scopes.entries()) {
    const userId = v7();
    const email = `stream-${index}@example.com`;
    await database.query(
      'INSERT INTO auth.users (id,name,email,email_verified) VALUES ($1,$2,$2,true)',
      [userId, email],
    );
    await database.query(
      "INSERT INTO auth.accounts (id,account_id,provider_id,user_id,password,updated_at) VALUES ($1,$2::text,'credential',$2::uuid,$3,now())",
      [v7(), userId, passwordHash],
    );
    await database.query(
      "INSERT INTO auth.members (id,organization_id,user_id,role) VALUES ($1,$2,$3,'member')",
      [v7(), scope.organizationId, userId],
    );
    if (index % 3 === 0) {
      await setTimeout(11000);
    }
    const login = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { origin: baseUrl, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'test-password-long-enough' }),
    });
    expect(login.status).toBe(200);
    const sessionCookie = login.headers
      .getSetCookie()
      .map((header) => header.split(';')[0])
      .join('; ');
    readers.push({ kind: 'human', userId, scope, headers: { cookie: sessionCookie } });
    const issued = await fetch(`${baseUrl}${scopePath(scope)}/service-keys`, {
      method: 'POST',
      headers: { cookie, origin: baseUrl, 'content-type': 'application/json' },
      body: JSON.stringify({ name: `Stream ${index}`, actions: ['event:read'], expiresIn: 3600 }),
    });
    expect(issued.status).toBe(201);
    const key = v.parse(
      v.object({ key: v.string(), metadata: v.object({ id: v.string() }) }),
      await issued.json(),
    );
    readers.push({
      kind: 'service-key',
      keyId: key.metadata.id,
      scope,
      headers: { 'x-api-key': key.key },
    });
  }
  // oxlint-enable eslint/no-await-in-loop
  return createStreams(database, port, certificate, readers);
}

function createStreams(
  database: Client,
  port: number,
  certificate: Buffer,
  readers: Reader[],
): StreamHarness {
  const connections: Connection[] = [];
  const responses: IncomingMessage[] = [];
  let bytes = 0;
  let unexpectedClosures = 0;
  let frameErrors = 0;
  let sequenceGaps = 0;
  let closing = false;

  function readerAt(index: number): Reader {
    const reader = readers[index];
    if (!reader) {
      throw new Error('QUALIFICATION_READER_MISSING');
    }
    return reader;
  }
  async function connect(readerIndex: number, cursor?: string): Promise<IncomingMessage> {
    const reader = readerAt(readerIndex);
    const headers: StreamHeaders = { ...reader.headers };
    if (cursor) {
      headers['last-event-id'] = cursor;
    }
    return new Promise((resolve, reject) => {
      const outgoing = request(
        {
          hostname: '127.0.0.1',
          port,
          servername: 'push.test',
          ca: certificate,
          path: `${scopePath(reader.scope)}/events/stream`,
          headers,
        },
        (response) => {
          responses.push(response);
          response.on('error', () => {});
          outgoing.setTimeout(0);
          resolve(response);
        },
      );
      outgoing.on('error', reject);
      outgoing.setTimeout(30000, () => outgoing.destroy(new Error('QUALIFICATION_SSE_TIMEOUT')));
      outgoing.end();
    });
  }
  function observe(connection: Connection): void {
    const response = connection.response;
    let buffered = '';
    response.once('close', () => {
      connection.live = false;
      if (!closing && !connection.expectedClose) {
        unexpectedClosures++;
      }
    });
    response.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      buffered += chunk.toString();
      let boundary = buffered.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffered.slice(0, boundary);
        buffered = buffered.slice(boundary + 2);
        if (frame.includes('event: delivery')) {
          try {
            const cursor = v.parse(v.string(), frame.match(/(?:^|\n)id: ?([^\n]+)/)?.[1]);
            const [_version, organizationId, projectId, environmentId, sequence] = v.parse(
              cursorSchema,
              Buffer.from(cursor, 'base64url').toString().split('.'),
            );
            const { scope } = readerAt(connection.readerIndex);
            if (
              organizationId !== scope.organizationId ||
              projectId !== scope.projectId ||
              environmentId !== scope.environmentId
            ) {
              throw new Error('QUALIFICATION_WRONG_STREAM');
            }
            if (sequence !== connection.sequence + 1n) {
              sequenceGaps++;
            }
            connection.sequence = sequence;
            connection.lastCursor = cursor;
            connection.events++;
            connection.lastDeliveryAt = Date.now();
          } catch {
            frameErrors++;
            response.destroy();
          }
        }
        boundary = buffered.indexOf('\n\n');
      }
      if (buffered.length > 65536) {
        frameErrors++;
        response.destroy();
      }
    });
    response.resume();
  }
  async function open(count: number): Promise<void> {
    // oxlint-disable eslint/no-await-in-loop -- Bound connection ramp-up without exhausting listener backlog.
    for (let offset = 0; offset < count; offset += 40) {
      await Promise.all(
        Array.from({ length: Math.min(40, count - offset) }, async (_, index) => {
          const readerIndex = (offset + index) % readers.length;
          const response = await connect(readerIndex);
          expect(response.statusCode).toBe(200);
          const connection: Connection = {
            readerIndex,
            response,
            live: true,
            expectedClose: false,
            lastCursor: '',
            sequence: 0n,
            events: 0,
            lastDeliveryAt: 0,
          };
          connections.push(connection);
          observe(connection);
        }),
      );
    }
    // oxlint-enable eslint/no-await-in-loop
  }
  function report(cutoff = 0): StreamReport {
    let live = 0;
    let delivered = 0;
    let recentDelivery = 0;
    let events = 0;
    for (const connection of connections) {
      if (connection.live) {
        live++;
      }
      if (connection.events > 0) {
        delivered++;
      }
      if (connection.lastDeliveryAt >= cutoff && connection.events > 0) {
        recentDelivery++;
      }
      events += connection.events;
    }
    return {
      live,
      delivered,
      recentDelivery,
      events,
      bytes,
      unexpectedClosures,
      frameErrors,
      sequenceGaps,
      humanSessions: scopesCount('human'),
      serviceKeys: scopesCount('service-key'),
    };
  }
  function scopesCount(kind: Reader['kind']): number {
    let count = 0;
    for (const reader of readers) {
      if (reader.kind === kind) {
        count++;
      }
    }
    return count;
  }
  async function revoke(): Promise<RevocationReport> {
    const human = readerAt(0);
    const key = readerAt(3);
    if (human.kind !== 'human' || key.kind !== 'service-key') {
      throw new Error('QUALIFICATION_PRINCIPAL_KIND_INVALID');
    }
    const closed: Promise<void>[] = [];
    let expectedClosed = 0;
    for (const connection of connections) {
      if (connection.readerIndex === 0 || connection.readerIndex === 3) {
        connection.expectedClose = true;
        expectedClosed++;
        closed.push(new Promise((resolve) => connection.response.once('close', resolve)));
      }
    }
    const started = Date.now();
    await database.query('DELETE FROM auth.members WHERE user_id=$1 AND organization_id=$2', [
      human.userId,
      human.scope.organizationId,
    ]);
    await database.query('UPDATE auth.api_keys SET enabled=false WHERE id=$1', [key.keyId]);
    const revokedInWindow = await Promise.race([
      Promise.all(closed).then(() => true),
      setTimeout(7000).then(() => false),
    ]);
    const humanReconnect = await connect(0);
    const keyReconnect = await connect(3);
    humanReconnect.resume();
    keyReconnect.resume();
    return {
      expectedClosed,
      revokedInWindow,
      milliseconds: Date.now() - started,
      humanReconnectStatus: humanReconnect.statusCode,
      keyReconnectStatus: keyReconnect.statusCode,
    };
  }
  async function replay(submit: (scope: Scope) => Promise<{ status: number }>): Promise<boolean> {
    const connection = connections.find((entry) => entry.readerIndex === 2 && entry.live);
    if (!connection?.lastCursor) {
      throw new Error('QUALIFICATION_REPLAY_CURSOR_MISSING');
    }
    const cursor = connection.lastCursor;
    const previousSequence = connection.sequence;
    connection.expectedClose = true;
    const closed = once(connection.response, 'close');
    connection.response.destroy();
    await closed;
    await setTimeout(500);
    expect((await submit(readerAt(2).scope)).status).toBe(202);
    connection.response = await connect(2, cursor);
    expect(connection.response.statusCode).toBe(200);
    connection.live = true;
    connection.expectedClose = false;
    observe(connection);
    await expect.poll(() => connection.sequence > previousSequence, { timeout: 10000 }).toBe(true);
    return true;
  }
  function close(): void {
    closing = true;
    for (const response of responses) {
      response.destroy();
    }
  }
  return { open, report, revoke, replay, close };
}
