import type { ChildProcess } from 'node:child_process';
import type { AuthFixture } from './fixtures/auth-runtime.ts';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SMTPServer } from 'smtp-server';
import * as v from 'valibot';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { freePort, startAuthFixture, startWorker, stopProcess } from './fixtures/auth-runtime.ts';

const testUrl = process.env.TEST_AUTH_DATABASE_URL;
const root = fileURLToPath(new URL('../../../', import.meta.url));
const identitySchema = v.object({ userId: v.string(), organizationId: v.nullable(v.string()) });
const invitationSchema = v.object({ id: v.string() });
const enrollmentSchema = v.object({ totpURI: v.string(), backupCodes: v.array(v.string()) });
const errorSchema = v.object({ code: v.string() });
const password = 'operator-password-long-enough';
type OperatorInput = {
  action: string;
  email: string;
  name: string;
  password: string;
  organizationName?: string;
  organizationSlug?: string;
};
type OperatorResult = { code: number | null; stdout: string; stderr: string };

function operator(environment: NodeJS.ProcessEnv, input: OperatorInput): Promise<OperatorResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['apps/worker/dist/operator.mjs'], {
      cwd: root,
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(JSON.stringify(input));
  });
}

describe.skipIf(!testUrl)('operator enrollment and native invitation policy', () => {
  let fixture: AuthFixture;
  let smtp: SMTPServer;
  let worker: ChildProcess | undefined;
  let smtpPort: number;
  const received: string[] = [];
  let ownerId: string;
  let organizationId: string;
  let secret: string;
  let backupCode: string;
  const ownerCookies = new Map<string, string>();
  const memberCookies = new Map<string, string>();

  async function post(
    path: string,
    body: Record<string, string | boolean>,
    cookies = ownerCookies,
  ): Promise<Response> {
    const response = await fetch(`${fixture.baseUrl}/api/auth${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: fixture.baseUrl,
        cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      },
      body: JSON.stringify(body),
    });
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(';')[0];
      if (!pair) continue;
      const separator = pair.indexOf('=');
      cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return response;
  }

  async function verifyEmail(email: string): Promise<void> {
    const jobs = await fixture.database.query<{ data: { url: string } }>(
      "SELECT data FROM pgboss.job WHERE data->>'to'=$1 AND data->>'kind'='verification' ORDER BY created_on DESC LIMIT 1",
      [email],
    );
    const url = jobs.rows[0]?.data.url;
    if (!url) throw new Error('TEST_VERIFICATION_MISSING');
    expect((await fetch(url, { redirect: 'manual' })).status).toBe(302);
  }

  async function totp(): Promise<string> {
    return createOTP(new TextDecoder().decode(base32.decode(secret))).totp();
  }

  beforeAll(async () => {
    fixture = await startAuthFixture(testUrl ?? '', false);
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
    await fixture.database.query('DELETE FROM auth.rate_limits');
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

  it('serializes concurrent bootstrap and closes it after creating one owner and durable email', async () => {
    const input = {
      action: 'bootstrap',
      email: 'owner@example.com',
      name: 'Owner',
      password,
      organizationName: 'First organization',
      organizationSlug: 'first-organization',
    };
    const results = await Promise.all([
      operator(fixture.environment, input),
      operator(fixture.environment, input),
    ]);
    expect(
      results.map(({ code }) => code).toSorted((left, right) => (left ?? -1) - (right ?? -1)),
    ).toEqual([0, 1]);
    const success = results.find(({ code }) => code === 0);
    const failure = results.find(({ code }) => code === 1);
    if (!success) throw new Error('TEST_BOOTSTRAP_FAILED');
    expect(failure?.stderr).toContain('AUTH_BOOTSTRAP_CLOSED');
    const identity = v.parse(identitySchema, JSON.parse(success.stdout));
    ownerId = identity.userId;
    if (!identity.organizationId) throw new Error('TEST_ORGANIZATION_MISSING');
    organizationId = identity.organizationId;
    const members = await fixture.database.query<{ role: string }>(
      'SELECT role FROM auth.members WHERE user_id=$1',
      [ownerId],
    );
    expect(members.rows).toEqual([{ role: 'owner' }]);
    expect(
      (await fixture.database.query('SELECT id FROM auth.enrollment_audits')).rows,
    ).toHaveLength(1);
    expect((await fixture.database.query('SELECT id FROM pgboss.job')).rows).toHaveLength(1);
    expect(success.stdout).not.toContain(password);
    expect(
      (await post('/sign-up/email', { email: 'remote@example.com', password, name: 'Remote' }))
        .status,
    ).toBe(403);
    await verifyEmail('owner@example.com');
    expect((await post('/sign-in/email', { email: 'owner@example.com', password })).status).toBe(
      200,
    );
  }, 30_000);

  it('rolls back provisioning if durable email fails and rejects duplicate accounts', async () => {
    const invalid = await operator(fixture.environment, {
      action: 'provision',
      email: 'invalid@example.com',
      name: 'Invalid',
      password: 'short',
    });
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain('AUTH_OPERATOR_INPUT_INVALID');
    expect(invalid.stderr).not.toContain('short');
    await fixture.database
      .query(`CREATE FUNCTION pgboss.reject_enrollment_mail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test mail failure'; END $$;
      CREATE TRIGGER reject_enrollment_mail BEFORE INSERT ON pgboss.job FOR EACH ROW EXECUTE FUNCTION pgboss.reject_enrollment_mail()`);
    try {
      const failed = await operator(fixture.environment, {
        action: 'provision',
        email: 'failed@example.com',
        name: 'Failed',
        password,
      });
      expect(failed.code).toBe(1);
      expect(
        (
          await fixture.database.query('SELECT id FROM auth."users" WHERE email=$1', [
            'failed@example.com',
          ])
        ).rows,
      ).toHaveLength(0);
    } finally {
      await fixture.database.query(
        'DROP TRIGGER reject_enrollment_mail ON pgboss.job; DROP FUNCTION pgboss.reject_enrollment_mail()',
      );
    }
    const provision = await operator(fixture.environment, {
      action: 'provision',
      email: 'member@example.com',
      name: 'Member',
      password,
    });
    expect(provision.code, provision.stderr).toBe(0);
    const duplicate = await operator(fixture.environment, {
      action: 'provision',
      email: 'member@example.com',
      name: 'Duplicate',
      password,
    });
    expect(duplicate.code).toBe(1);
    expect(duplicate.stderr).toContain('AUTH_ACCOUNT_EXISTS');
  }, 30_000);

  it('requires owner MFA, denies role escalation, and accepts only the verified invited account', async () => {
    const invitationBody = { email: 'member@example.com', role: 'member', organizationId };
    const denied = await post('/organization/invite-member', invitationBody);
    expect(denied.status).toBe(403);
    expect(v.parse(errorSchema, await denied.json()).code).toBe('AUTH_MFA_ENROLLMENT_REQUIRED');
    const enrollment = v.parse(
      enrollmentSchema,
      await (await post('/two-factor/enable', { password })).json(),
    );
    const enrolledSecret = new URL(enrollment.totpURI).searchParams.get('secret');
    const firstBackupCode = enrollment.backupCodes[0];
    if (!enrolledSecret || !firstBackupCode) throw new Error('TEST_TOTP_MISSING');
    secret = enrolledSecret;
    backupCode = firstBackupCode;
    expect((await post('/two-factor/verify-totp', { code: await totp() })).status).toBe(200);
    expect(
      (await post('/organization/invite-member', { ...invitationBody, role: 'owner' })).status,
    ).toBe(403);
    const invited = await post('/organization/invite-member', invitationBody);
    expect(invited.status).toBe(200);
    const invitationId = v.parse(invitationSchema, await invited.json()).id;
    const mail = await fixture.database.query<{ data: { url: string } }>(
      "SELECT data FROM pgboss.job WHERE data->>'kind'='invitation' ORDER BY created_on DESC LIMIT 1",
    );
    const invitationUrl = mail.rows[0]?.data.url;
    expect(invitationUrl).toContain(invitationId);
    worker = startWorker({
      ...fixture.environment,
      AUTH_MAIL_FROM: 'auth@example.com',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtpPort),
      SMTP_SECURITY: 'local',
    });
    await expect
      .poll(
        () =>
          received.some((message) =>
            message.includes('You have been invited to a Pipong organization'),
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
    expect(
      (await post('/organization/accept-invitation', { invitationId }, ownerCookies)).status,
    ).toBe(403);
    expect(
      (await post('/sign-in/email', { email: 'member@example.com', password }, memberCookies))
        .status,
    ).toBe(403);
    await verifyEmail('member@example.com');
    await fixture.database.query('DELETE FROM auth.rate_limits');
    expect(
      (await post('/sign-in/email', { email: 'member@example.com', password }, memberCookies))
        .status,
    ).toBe(200);
    if (!invitationUrl) throw new Error('TEST_INVITATION_URL_MISSING');
    const details = await fetch(invitationUrl, {
      headers: {
        cookie: [...memberCookies].map(([name, value]) => `${name}=${value}`).join('; '),
      },
    });
    expect(details.status).toBe(200);
    expect(v.parse(invitationSchema, await details.json()).id).toBe(invitationId);
    expect(
      (await post('/organization/accept-invitation', { invitationId }, memberCookies)).status,
    ).toBe(200);
    expect(
      (
        await fixture.database.query(
          'SELECT role FROM auth.members WHERE organization_id=$1 AND user_id<>$2',
          [organizationId, ownerId],
        )
      ).rows,
    ).toEqual([{ role: 'member' }]);
    expect(
      (
        await post(
          '/organization/invite-member',
          { email: 'intruder@example.com', role: 'member', organizationId },
          memberCookies,
        )
      ).status,
    ).toBe(403);
  }, 30_000);

  it('cancels invitations and refuses their later acceptance', async () => {
    expect(
      (
        await operator(fixture.environment, {
          action: 'provision',
          email: 'canceled@example.com',
          name: 'Canceled',
          password,
        })
      ).code,
    ).toBe(0);
    await verifyEmail('canceled@example.com');
    const canceledCookies = new Map<string, string>();
    expect(
      (await post('/sign-in/email', { email: 'canceled@example.com', password }, canceledCookies))
        .status,
    ).toBe(200);
    const invited = await post('/organization/invite-member', {
      email: 'canceled@example.com',
      role: 'member',
      organizationId,
    });
    expect(invited.status).toBe(200);
    const invitationId = v.parse(invitationSchema, await invited.json()).id;
    expect((await post('/organization/cancel-invitation', { invitationId })).status).toBe(200);
    expect(
      (await post('/organization/accept-invitation', { invitationId }, canceledCookies)).status,
    ).toBe(400);
  }, 30_000);

  it('expires MFA assurance, renews it after step-up, and records backup-code recovery', async () => {
    await fixture.database.query(
      "UPDATE auth.mfa_assurances SET verified_at=now()-interval '6 minutes'",
    );
    const body = { email: 'later@example.com', role: 'member', organizationId };
    const stale = await post('/organization/invite-member', body);
    expect(stale.status).toBe(403);
    expect(v.parse(errorSchema, await stale.json()).code).toBe('AUTH_RECENT_MFA_REQUIRED');
    expect((await post('/two-factor/enable', { password })).status).toBe(403);
    expect((await post('/two-factor/get-totp-uri', { password })).status).toBe(403);
    expect((await post('/two-factor/generate-backup-codes', { password })).status).toBe(403);
    expect((await post('/two-factor/disable', { password })).status).toBe(403);
    expect((await post('/two-factor/verify-totp', { code: 'invalid' })).status).toBe(401);
    expect((await post('/organization/invite-member', body)).status).toBe(403);
    await fixture.database.query('DELETE FROM auth.rate_limits');
    expect((await post('/two-factor/verify-totp', { code: await totp() })).status).toBe(200);
    expect((await post('/organization/invite-member', body)).status).toBe(200);
    await fixture.database.query('DELETE FROM auth.rate_limits');
    expect((await post('/two-factor/verify-backup-code', { code: backupCode })).status).toBe(200);
    const audit = await fixture.database.query(
      'SELECT user_id FROM auth.enrollment_audits WHERE action=$1',
      ['backup-code-recovery'],
    );
    expect(audit.rows).toEqual([{ user_id: ownerId }]);
    expect((await post('/two-factor/verify-backup-code', { code: backupCode })).status).toBe(401);
    await fixture.database.query('DELETE FROM auth.rate_limits');
    expect((await post('/two-factor/disable', { password })).status).toBe(200);
    expect((await post('/organization/invite-member', body)).status).toBe(403);
    expect(
      (
        await fixture.database.query(
          "SELECT user_id FROM auth.enrollment_audits WHERE action='two-factor-disabled'",
        )
      ).rows,
    ).toEqual([{ user_id: ownerId }]);
    const replacement = await post('/two-factor/enable', { password });
    expect(replacement.status).toBe(200);
    const replaced = v.parse(enrollmentSchema, await replacement.json());
    const replacementSecret = new URL(replaced.totpURI).searchParams.get('secret');
    if (!replacementSecret) throw new Error('TEST_TOTP_SECRET_MISSING');
    secret = replacementSecret;
    await fixture.database.query('DELETE FROM auth.rate_limits');
    expect((await post('/two-factor/verify-totp', { code: await totp() })).status).toBe(200);
    const regenerated = await post('/two-factor/generate-backup-codes', { password });
    expect(regenerated.status).toBe(200);
    const regeneratedCodes = v.parse(
      v.object({ backupCodes: v.array(v.string()) }),
      await regenerated.json(),
    ).backupCodes;
    const newBackupCode = regeneratedCodes[0];
    if (!newBackupCode) throw new Error('TEST_BACKUP_CODE_MISSING');
    await post('/sign-out', {});
    expect(
      (await fixture.database.query('SELECT session_id FROM auth.mfa_assurances')).rows,
    ).toHaveLength(0);
    await fixture.database.query('DELETE FROM auth.rate_limits');
    expect((await post('/sign-in/email', { email: 'owner@example.com', password })).status).toBe(
      200,
    );
    expect(
      (
        await post('/two-factor/verify-backup-code', {
          code: newBackupCode,
          disableSession: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fixture.database.query(
          "SELECT session_id FROM auth.enrollment_audits WHERE action='backup-code-recovery' AND session_id IS NULL",
        )
      ).rows,
    ).toEqual([{ session_id: null }]);
    expect(
      (await fixture.database.query('SELECT session_id FROM auth.mfa_assurances')).rows,
    ).toHaveLength(0);
  }, 30_000);
});
