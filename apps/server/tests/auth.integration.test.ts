import type { ChildProcess } from 'node:child_process';
import type { AuthFixture } from './fixtures/auth-runtime.ts';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { SMTPServer } from 'smtp-server';
import * as v from 'valibot';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { freePort, startAuthFixture, startWorker, stopProcess } from './fixtures/auth-runtime.ts';

const testUrl = process.env.TEST_AUTH_DATABASE_URL;
const sessionSchema = v.object({
  user: v.object({ id: v.string() }),
  session: v.object({ token: v.string() }),
});
const enableSchema = v.object({ totpURI: v.string() });
const challengeSchema = v.object({ twoFactorRedirect: v.literal(true) });
const errorSchema = v.object({ code: v.string() });
type PostBody = Record<string, string | boolean>;
type CookieJar = Map<string, string>;

function saveCookies(response: Response, cookies: CookieJar): void {
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(';')[0];
    if (!pair) continue;
    const separator = pair.indexOf('=');
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader(cookies: CookieJar): string {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

function sessionCookie(cookies: CookieJar): string | undefined {
  return cookies.get('better-auth.session_token');
}

describe.skipIf(!testUrl)('built authentication and email runtimes (disposable PostgreSQL)', () => {
  let fixture: AuthFixture;
  let worker: ChildProcess | undefined;
  let smtp: SMTPServer;
  let smtpPort: number;
  let rejectTemporarily = false;
  let rejectPermanently = false;
  let attempts = 0;
  const received: string[] = [];

  async function post(
    path: string,
    body: PostBody,
    cookies: CookieJar = new Map(),
  ): Promise<Response> {
    const response = await fetch(`${fixture.baseUrl}/api/auth${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: fixture.baseUrl,
        cookie: cookieHeader(cookies),
        'x-pipong-client-ip': '198.51.100.9',
      },
      body: JSON.stringify(body),
    });
    saveCookies(response, cookies);
    return response;
  }

  async function getSession(cookies: CookieJar): Promise<Response> {
    return fetch(`${fixture.baseUrl}/api/auth/get-session`, {
      headers: { cookie: cookieHeader(cookies) },
    });
  }

  beforeAll(async () => {
    fixture = await startAuthFixture(testUrl ?? '');
    smtpPort = await freePort();
    smtp = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      onData(stream, _session, callback) {
        let message = '';
        stream.on('data', (chunk: Buffer) => {
          message += chunk.toString();
        });
        stream.on('end', () => {
          attempts++;
          if (rejectPermanently) {
            callback(Object.assign(new Error('Permanent delivery failure'), { responseCode: 550 }));
            return;
          }
          if (rejectTemporarily) {
            callback(Object.assign(new Error('Temporary delivery failure'), { responseCode: 451 }));
            return;
          }
          received.push(message);
          callback();
        });
      },
    });
    await new Promise<void>((resolve) => {
      smtp.listen(smtpPort, '127.0.0.1', resolve);
    });
  }, 30_000);

  beforeEach(async () => {
    await fixture.database.query('DELETE FROM auth.rate_limit');
  });

  afterAll(async () => {
    try {
      await stopProcess(worker);
      if (smtp)
        await new Promise<void>((resolve) => {
          smtp.close(resolve);
        });
    } finally {
      if (fixture) await fixture.close();
    }
  });

  it('preserves login cookies and request bodies, persists sessions, and revokes logout sessions', async () => {
    const cookies: CookieJar = new Map();
    const login = await post(
      '/sign-in/email',
      { email: 'verified@example.com', password: 'test-password-long-enough' },
      cookies,
    );
    expect(login.status).toBe(200);
    expect(login.headers.get('cache-control')).toBe('no-store');
    expect(login.headers.getSetCookie().some((value) => value.includes('HttpOnly'))).toBe(true);
    expect(sessionCookie(cookies)).toBeTruthy();
    const session = v.parse(sessionSchema, await (await getSession(cookies)).json());
    expect(session.user.id).toBe('019a0000-0000-7000-8000-000000000011');
    const row = await fixture.database.query<{ id: string; ip_address: string }>(
      'SELECT id, ip_address FROM auth.session WHERE token=$1',
      [session.session.token],
    );
    expect(row.rows[0]?.ip_address).toBe('127.0.0.1');
    expect(row.rows[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const oldCookies = new Map(cookies);
    expect((await post('/sign-out', {}, cookies)).status).toBe(200);
    expect(await (await getSession(oldCookies)).json()).toBeNull();
    expect(sessionCookie(cookies)).toBe('');
  });

  it('denies public signup and all native operations that bypass enrollment, keys, or deletion', async () => {
    for (const path of [
      '/sign-up/email',
      '/organization/create',
      '/organization/delete',
      '/organization/invite-member',
      '/api-key/create',
      '/api-key/update',
      '/api-key/delete',
      '/delete-user',
      '/two-factor/disable',
      '/admin/create-user',
    ]) {
      const response = await post(path, {
        email: 'intruder@example.com',
        password: 'test-password-long-enough',
        name: 'Intruder',
      });
      expect(response.status, path).toBe(403);
      expect(v.parse(errorSchema, await response.json()).code).toBe('AUTH_ENDPOINT_DISABLED');
    }
    expect(
      (
        await fixture.database.query<{ count: string }>(
          'SELECT count(*) FROM auth."user" WHERE email=\'intruder@example.com\'',
        )
      ).rows[0]?.count,
    ).toBe('0');
  });

  it('requires TOTP after enrollment and propagates all challenge and completion cookies', async () => {
    const cookies: CookieJar = new Map();
    expect(
      (
        await post(
          '/sign-in/email',
          { email: 'verified@example.com', password: 'test-password-long-enough' },
          cookies,
        )
      ).status,
    ).toBe(200);
    const enabling = await post(
      '/two-factor/enable',
      { password: 'test-password-long-enough' },
      cookies,
    );
    expect(enabling.status).toBe(200);
    const secret = new URL(v.parse(enableSchema, await enabling.json()).totpURI).searchParams.get(
      'secret',
    );
    if (!secret) throw new Error('TEST_TOTP_SECRET_MISSING');
    expect(
      (
        await post(
          '/two-factor/verify-totp',
          { code: await createOTP(new TextDecoder().decode(base32.decode(secret))).totp() },
          cookies,
        )
      ).status,
    ).toBe(200);
    await post('/sign-out', {}, cookies);
    const challenge = await post(
      '/sign-in/email',
      { email: 'verified@example.com', password: 'test-password-long-enough' },
      cookies,
    );
    expect(challenge.status).toBe(200);
    v.parse(challengeSchema, await challenge.json());
    const setCookies = challenge.headers.getSetCookie();
    expect(setCookies.some((value) => value.startsWith('better-auth.session_token=;'))).toBe(true);
    expect(setCookies.some((value) => value.startsWith('better-auth.two_factor='))).toBe(true);
    expect(await (await getSession(cookies)).json()).toBeNull();
    expect((await post('/two-factor/verify-totp', { code: 'invalid' }, cookies)).status).toBe(401);
    expect(
      (
        await post(
          '/two-factor/verify-totp',
          { code: await createOTP(new TextDecoder().decode(base32.decode(secret))).totp() },
          cookies,
        )
      ).status,
    ).toBe(200);
    expect(v.parse(sessionSchema, await (await getSession(cookies)).json()).user.id).toBe(
      '019a0000-0000-7000-8000-000000000011',
    );
  });

  it('rejects untrusted origins and stores rate limits without trusting spoofed client headers', async () => {
    const response = await fetch(`${fixture.baseUrl}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
      body: JSON.stringify({
        email: 'verified@example.com',
        password: 'test-password-long-enough',
      }),
    });
    expect(response.status).toBe(403);
    const statuses: number[] = [];
    for (let index = 0; index < 6; index++) {
      statuses.push(
        (
          await post('/sign-in/email', {
            email: 'verified@example.com',
            password: 'incorrect-password',
          })
        ).status,
      );
    }
    expect(statuses).toContain(429);
    const counters = await fixture.database.query<{ key: string }>(
      'SELECT key FROM auth.rate_limit',
    );
    expect(counters.rows.length).toBeGreaterThan(0);
    expect(counters.rows.some(({ key }) => key.includes('198.51.100.9'))).toBe(false);
  });

  it('queues verification mail, survives worker restart, and sends escaped Handlebars content', async () => {
    expect(
      (
        await post('/sign-in/email', {
          email: 'unverified@example.com',
          password: 'test-password-long-enough',
        })
      ).status,
    ).toBe(403);
    expect(received).toHaveLength(0);
    const environment = {
      ...fixture.environment,
      AUTH_MAIL_FROM: 'auth@example.com',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtpPort),
      SMTP_SECURITY: 'local',
    };
    worker = startWorker(environment);
    await expect.poll(() => received.length, { timeout: 15_000 }).toBe(1);
    await stopProcess(worker);
    const verification = await fixture.database.query<{ data: { url: string } }>(
      "SELECT data FROM pgboss.job WHERE name='auth-email' ORDER BY created_on LIMIT 1",
    );
    const verificationUrl = verification.rows[0]?.data.url;
    if (!verificationUrl) throw new Error('TEST_VERIFICATION_URL_MISSING');
    await fetch(verificationUrl);
    expect(
      (
        await fixture.database.query<{ email_verified: boolean }>(
          'SELECT email_verified FROM auth."user" WHERE id=\'019a0000-0000-7000-8000-000000000012\'',
        )
      ).rows[0]?.email_verified,
    ).toBe(true);
    const reset = await post('/request-password-reset', {
      email: 'verified@example.com',
      redirectTo: `${fixture.baseUrl}/reset-password`,
    });
    expect(reset.status).toBe(200);
    worker = startWorker(environment);
    await expect.poll(() => received.length, { timeout: 15_000 }).toBe(2);
    expect(received[1]).toContain('Reset your Pipong password');
    expect(received[1]).toContain('Verified &lt;person&gt;');
    expect(received[1]).not.toContain('<p>Hello Verified <person>');
    await stopProcess(worker);
    worker = undefined;
  }, 40_000);

  it('retries temporary SMTP failures using persisted bounded queue policy', async () => {
    rejectTemporarily = true;
    const beforeAttempts = attempts;
    const beforeReceived = received.length;
    expect(
      (
        await post('/request-password-reset', {
          email: 'verified@example.com',
          redirectTo: `${fixture.baseUrl}/reset-password`,
        })
      ).status,
    ).toBe(200);
    worker = startWorker({
      ...fixture.environment,
      AUTH_MAIL_FROM: 'auth@example.com',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtpPort),
      SMTP_SECURITY: 'local',
    });
    await expect.poll(() => attempts, { timeout: 15_000 }).toBeGreaterThan(beforeAttempts);
    rejectTemporarily = false;
    await expect.poll(() => received.length, { timeout: 20_000 }).toBe(beforeReceived + 1);
    const policy = await fixture.database.query<{ retry_count: number; retry_limit: number }>(
      "SELECT retry_count,retry_limit FROM pgboss.job WHERE name='auth-email' ORDER BY created_on DESC LIMIT 1",
    );
    expect(policy.rows[0]?.retry_count).toBeGreaterThan(0);
    expect(policy.rows[0]?.retry_limit).toBe(5);
  }, 40_000);

  it('cancels permanent SMTP failures without retrying them', async () => {
    rejectPermanently = true;
    const beforeAttempts = attempts;
    const beforeReceived = received.length;
    expect(
      (
        await post('/request-password-reset', {
          email: 'verified@example.com',
          redirectTo: `${fixture.baseUrl}/reset-password`,
        })
      ).status,
    ).toBe(200);
    await expect
      .poll(
        async () => {
          const result = await fixture.database.query<{ state: string }>(
            "SELECT state FROM pgboss.job WHERE name='auth-email' ORDER BY created_on DESC LIMIT 1",
          );
          return result.rows[0]?.state;
        },
        { timeout: 15_000 },
      )
      .toBe('cancelled');
    expect(attempts).toBe(beforeAttempts + 1);
    expect(received.length).toBe(beforeReceived);
    const result = await fixture.database.query<{ retry_count: number }>(
      "SELECT retry_count FROM pgboss.job WHERE name='auth-email' ORDER BY created_on DESC LIMIT 1",
    );
    expect(result.rows[0]?.retry_count).toBe(0);
  }, 20_000);

  it('cancels expired and invalid queued mail without contacting SMTP', async () => {
    await stopProcess(worker);
    worker = undefined;
    rejectPermanently = false;
    const beforeAttempts = attempts;
    await post('/request-password-reset', {
      email: 'verified@example.com',
      redirectTo: `${fixture.baseUrl}/reset-password`,
    });
    await fixture.database.query(
      "UPDATE pgboss.job SET data='{}'::jsonb WHERE id=(SELECT id FROM pgboss.job ORDER BY created_on DESC LIMIT 1)",
    );
    await post('/request-password-reset', {
      email: 'verified@example.com',
      redirectTo: `${fixture.baseUrl}/reset-password`,
    });
    await fixture.database.query(
      "UPDATE pgboss.job SET data=jsonb_set(data,'{expiresAt}','0'::jsonb) WHERE id=(SELECT id FROM pgboss.job ORDER BY created_on DESC LIMIT 1)",
    );
    worker = startWorker({
      ...fixture.environment,
      AUTH_MAIL_FROM: 'auth@example.com',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtpPort),
      SMTP_SECURITY: 'local',
    });
    await expect
      .poll(
        async () => {
          const result = await fixture.database.query<{ count: string }>(
            "SELECT count(*) FROM pgboss.job WHERE state='cancelled' AND (data='{}'::jsonb OR data->>'expiresAt'='0')",
          );
          return result.rows[0]?.count;
        },
        { timeout: 15_000 },
      )
      .toBe('2');
    expect(attempts).toBe(beforeAttempts);
  }, 20_000);

  it('completes the emailed password-reset callback, revokes sessions, and consumes the token once', async () => {
    const cookies: CookieJar = new Map();
    expect(
      (
        await post(
          '/sign-in/email',
          { email: 'unverified@example.com', password: 'test-password-long-enough' },
          cookies,
        )
      ).status,
    ).toBe(200);
    const beforeReceived = received.length;
    expect(
      (
        await post('/request-password-reset', {
          email: 'unverified@example.com',
          redirectTo: `${fixture.baseUrl}/reset-password`,
        })
      ).status,
    ).toBe(200);
    await expect.poll(() => received.length, { timeout: 15_000 }).toBe(beforeReceived + 1);
    const job = await fixture.database.query<{ data: { url: string } }>(
      "SELECT data FROM pgboss.job WHERE name='auth-email' ORDER BY created_on DESC LIMIT 1",
    );
    const url = job.rows[0]?.data.url;
    if (!url) throw new Error('TEST_RESET_URL_MISSING');
    const callback = await fetch(url, { redirect: 'manual' });
    expect(callback.status).toBe(302);
    const redirect = callback.headers.get('location');
    if (!redirect) throw new Error('TEST_RESET_CALLBACK_MISSING');
    const token = new URL(redirect).searchParams.get('token');
    if (!token) throw new Error('TEST_RESET_TOKEN_MISSING');
    const body = { token, newPassword: 'changed-password-long-enough' };
    expect((await post('/reset-password', body)).status).toBe(200);
    expect(await (await getSession(cookies)).json()).toBeNull();
    expect((await post('/reset-password', body)).status).toBe(400);
    expect(
      (
        await post('/sign-in/email', {
          email: 'unverified@example.com',
          password: 'test-password-long-enough',
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await post('/sign-in/email', {
          email: 'unverified@example.com',
          password: 'changed-password-long-enough',
        })
      ).status,
    ).toBe(200);
  }, 20_000);
});
