import type { ChildProcess } from 'node:child_process';
import { decryptSecret, encryptSecret, loadSecretKeyring } from '@pipong/service';
import { execFile, spawn } from 'node:child_process';
import { createECDH } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from 'pg';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { startAuthFixture, startWorker, stopProcess } from './fixtures/auth-runtime.ts';

const testUrl = process.env.TEST_AUTH_DATABASE_URL;
const root = fileURLToPath(new URL('../../../', import.meta.url));
const runCommand = promisify(execFile);
const userId = '019a0000-0000-7000-8000-000000000011';
const organizationId = '019a0000-0000-7000-8000-000000000101';
const projectId = '019a0000-0000-7000-8000-000000000111';
const environmentId = '019a0000-0000-7000-8000-000000000121';
const erasedEnvironmentId = '019a0000-0000-7000-8000-000000000122';
const recipientId = '019a0000-0000-7000-8000-000000000131';
const endpointId = '019a0000-0000-7000-8000-000000000141';
const credentialId = '019a0000-0000-7000-8000-000000000151';
const scope = { organizationId, projectId, environmentId };
const path = `/api/v1/organizations/${organizationId}/projects/${projectId}/environments/${environmentId}`;
const acceptanceSchema = v.object({
  notificationId: v.string(),
  acceptedAt: v.string(),
  deliveryCount: v.number(),
});
const eventSchema = v.object({ id: v.string(), notificationId: v.string(), state: v.string() });
const eventsSchema = v.object({ items: v.array(eventSchema), nextCursor: v.string() });

async function streamEvent(response: Response): Promise<v.InferOutput<typeof eventSchema>> {
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('TEST_STREAM_BODY_MISSING');
  }
  let buffer = '';
  const decoder = new TextDecoder();
  try {
    // oxlint-disable eslint/no-await-in-loop -- Read complete SSE frames across arbitrary transport chunks.
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        throw new Error('TEST_STREAM_ENDED');
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      const messages = buffer.split('\n\n');
      buffer = messages.pop() ?? '';
      for (const message of messages) {
        const data = message.split('\n').find((line) => line.startsWith('data: '));
        if (data) {
          return v.parse(eventSchema, JSON.parse(data.slice(6)));
        }
      }
    }
    // oxlint-enable eslint/no-await-in-loop
  } finally {
    await reader.cancel();
  }
}

describe.skipIf(!testUrl)(
  'built API and worker recovery from separate database/key backups',
  () => {
    it('reconciles post-snapshot revocation and erasure before restoring sessions, replay and work', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'pipong-runtime-restore-'));
      const databaseName = `pipong_runtime_restored_${process.pid}`;
      const fixture = await startAuthFixture(testUrl ?? '').catch(async (error: Error) => {
        await rm(directory, { recursive: true, force: true });
        throw error;
      });
      const sourceUrl = v.parse(v.string(), fixture.environment.API_DATABASE_URL);
      function databaseUrl(database: string, role: string): string {
        const url = new URL(sourceUrl);
        url.pathname = `/${database}`;
        url.username = role;
        return url.href;
      }
      const admin = new Client({ connectionString: testUrl });
      const restored = new Client({ connectionString: databaseUrl(databaseName, 'postgres') });
      let api: ChildProcess | undefined;
      let worker: ChildProcess | undefined;
      let databaseCreated = false;
      let apiLogs = '';
      const vapid = createECDH('prime256v1');
      vapid.generateKeys();
      const receiver = createECDH('prime256v1');
      receiver.generateKeys();
      const publicKey = vapid.getPublicKey().toString('base64url');
      const provider = createServer();
      let providerRequests = 0;
      let holdProvider = true;
      provider.on('request', (request, response) => {
        request.resume();
        request.on('end', () => {
          providerRequests += 1;
          if (!holdProvider) {
            response.writeHead(201);
            response.end();
          }
        });
      });
      try {
        await admin.connect();
        await runCommand('openssl', [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-days',
          '1',
          '-subj',
          '/CN=127.0.0.1',
          '-addext',
          'subjectAltName=IP:127.0.0.1',
          '-keyout',
          join(directory, 'provider.key'),
          '-out',
          join(directory, 'provider.crt'),
        ]);
        const certificate = await readFile(join(directory, 'provider.crt'), 'utf8');
        provider.setSecureContext({
          key: await readFile(join(directory, 'provider.key')),
          cert: certificate,
        });
        provider.listen(0, '127.0.0.1');
        await once(provider, 'listening');
        const providerPort = v.parse(v.object({ port: v.number() }), provider.address()).port;
        const providerOrigin = `https://127.0.0.1:${providerPort}`;
        const policyPath = join(directory, 'egress.json');
        await writeFile(
          policyPath,
          JSON.stringify({
            privateOrigins: [{ origin: providerOrigin, cidrs: ['127.0.0.1/32'], ca: certificate }],
            totalTimeoutMs: 60000,
            idleTimeoutMs: 60000,
          }),
        );
        const pushEnvironment = {
          ...fixture.environment,
          PUSH_DELIVERY_ENABLED: 'true',
          WEB_PUSH_SUBJECT: 'mailto:operator@example.com',
          WEB_PUSH_EGRESS_POLICY_REF: policyPath,
          AUTH_MAIL_FROM: 'auth@example.com',
          SMTP_HOST: '127.0.0.1',
          SMTP_PORT: '1',
          SMTP_SECURITY: 'local',
        };
        const keyPath = v.parse(v.string(), fixture.environment.CREDENTIAL_KEYRING_REF);
        const keyring = await loadSecretKeyring(keyPath);
        const credentialContext = {
          ...scope,
          resourceId: credentialId,
          purpose: 'credential',
          binding: JSON.stringify(['web-push', 'test-project', publicKey]),
        } as const;
        const encryptedCredential = encryptSecret(
          keyring,
          credentialContext,
          JSON.stringify({
            provider: 'web-push',
            appId: 'test-project',
            secret: { privateKey: vapid.getPrivateKey().toString('base64url') },
          }),
        );
        const encryptedTarget = encryptSecret(
          keyring,
          {
            ...scope,
            resourceId: endpointId,
            purpose: 'endpoint',
            binding: JSON.stringify([
              recipientId,
              'web-push',
              'test-project',
              'phone',
              1,
              credentialId,
            ]),
          },
          JSON.stringify({
            endpoint: `${providerOrigin}/send`,
            p256dh: receiver.getPublicKey().toString('base64url'),
            auth: Buffer.alloc(16, 4).toString('base64url'),
            applicationServerKey: publicKey,
          }),
        );
        await fixture.database.query(
          "INSERT INTO auth.organizations (id,name,slug) VALUES ($1,'Restore','restore')",
          [organizationId],
        );
        await fixture.database.query(
          "INSERT INTO auth.members (id,organization_id,user_id,role) VALUES ($1,$2,$1,'owner')",
          [userId, organizationId],
        );
        await fixture.database.query(
          "INSERT INTO app.projects (id,organization_id,name) VALUES ($1,$2,'Project')",
          [projectId, organizationId],
        );
        await fixture.database.query(
          "INSERT INTO app.environments (id,organization_id,project_id,name) VALUES ($1,$2,$3,'Active'),($4,$2,$3,'Erase')",
          [environmentId, organizationId, projectId, erasedEnvironmentId],
        );
        await fixture.database.query(
          "INSERT INTO app.recipients (id,organization_id,project_id,environment_id,external_id) VALUES ($1,$2,$3,$4,'customer')",
          [recipientId, organizationId, projectId, environmentId],
        );
        await fixture.database.query(
          "INSERT INTO app.recipients (id,organization_id,project_id,environment_id,external_id) VALUES (uuidv7(),$1,$2,$3,'erase-restored-identity')",
          [organizationId, projectId, erasedEnvironmentId],
        );
        await fixture.database.query(
          "INSERT INTO app.credential_versions (id,organization_id,project_id,environment_id,provider,app_id,encrypted_secret,state,public_key) VALUES ($1,$2,$3,$4,'web-push','test-project',$5,'active',$6)",
          [credentialId, organizationId, projectId, environmentId, encryptedCredential, publicKey],
        );
        await fixture.database.query('BEGIN');
        await fixture.database.query(
          "INSERT INTO app.endpoints (id,organization_id,project_id,environment_id,recipient_id,installation_id,provider,app_id,generation,credential_id,target_hash) VALUES ($1,$2,$3,$4,$5,'phone','web-push','test-project',1,$6,'restore-hash')",
          [endpointId, organizationId, projectId, environmentId, recipientId, credentialId],
        );
        await fixture.database.query(
          'INSERT INTO app.endpoint_generations (organization_id,project_id,environment_id,endpoint_id,generation,credential_id,encrypted_target,registered_at) VALUES ($1,$2,$3,$4,1,$5,$6,now())',
          [organizationId, projectId, environmentId, endpointId, credentialId, encryptedTarget],
        );
        await fixture.database.query('COMMIT');
        const login = await fetch(`${fixture.baseUrl}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: fixture.baseUrl },
          body: JSON.stringify({
            email: 'verified@example.com',
            password: 'test-password-long-enough',
          }),
        });
        expect(login.status).toBe(200);
        const cookie = login.headers
          .getSetCookie()
          .map((header) => header.split(';')[0])
          .join('; ');
        function request(
          resource: string,
          method = 'GET',
          body?: string,
          key?: string,
        ): Promise<Response> {
          const headers = new Headers({
            cookie,
            origin: fixture.baseUrl,
            'content-type': 'application/json',
          });
          if (key) {
            headers.set('idempotency-key', key);
          }
          const options: RequestInit = {
            method,
            headers,
            signal: AbortSignal.timeout(10_000),
          };
          if (body !== undefined) {
            options.body = body;
          }
          return fetch(`${fixture.baseUrl}${resource}`, options);
        }
        const body = JSON.stringify({
          targets: { kind: 'recipients', ids: [recipientId] },
          content: { data: { message: 'restore' } },
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        });
        const first = await request(`${path}/notifications`, 'POST', body, 'pending');
        expect(first.status).toBe(202);
        const acceptance = v.parse(acceptanceSchema, await first.json());
        const second = await request(`${path}/notifications`, 'POST', body, 'in-flight');
        expect(second.status).toBe(202);
        const crashed = v.parse(acceptanceSchema, await second.json());
        const events = v.parse(
          eventsSchema,
          await (await request(`${path}/events?limit=1`)).json(),
        );
        expect(events.items[0]?.notificationId).toBe(acceptance.notificationId);
        await fixture.database.query('UPDATE auth.users SET two_factor_enabled=true');
        await fixture.database.query(
          'INSERT INTO auth.mfa_assurances (session_id,verified_at) SELECT id,now() FROM auth.sessions WHERE user_id=$1',
          [userId],
        );
        const issued = await request(
          `${path}/service-keys`,
          'POST',
          JSON.stringify({
            name: 'Revoked after backup',
            actions: ['notification:read'],
            expiresIn: 3600,
          }),
        );
        expect(issued.status).toBe(201);
        const issuedKey = v.parse(
          v.object({ key: v.string(), metadata: v.object({ id: v.string() }) }),
          await issued.json(),
        );
        const revokedKey = issuedKey.key;
        await fixture.database.query(
          "UPDATE app.deliveries SET state='sending',attempt_generation=1 WHERE notification_id=$1",
          [crashed.notificationId],
        );
        await fixture.database.query(
          `INSERT INTO app.delivery_attempts (organization_id,project_id,environment_id,delivery_id,generation,job_id,retry_count,started_at)
        SELECT $1,$2,$3,delivery.id,1,job.id,0,clock_timestamp() FROM app.deliveries delivery JOIN pgboss.job job ON job.data->>'deliveryId'=delivery.id::text WHERE delivery.notification_id=$4`,
          [organizationId, projectId, environmentId, crashed.notificationId],
        );
        await fixture.database.query(
          "UPDATE pgboss.job SET state='failed',completed_on=clock_timestamp() WHERE data->>'notificationId'=$1",
          [crashed.notificationId],
        );
        worker = startWorker(pushEnvironment);
        await expect.poll(() => providerRequests, { timeout: 10000 }).toBe(1);
        expect(
          (
            await fixture.database.query(
              'SELECT state FROM app.deliveries WHERE notification_id=$1',
              [acceptance.notificationId],
            )
          ).rows,
        ).toEqual([{ state: 'sending' }]);
        expect(
          (
            await fixture.database.query(
              "SELECT state FROM pgboss.job WHERE data->>'notificationId'=$1",
              [acceptance.notificationId],
            )
          ).rows,
        ).toEqual([{ state: 'active' }]);
        const snapshotStarted = Date.now();
        const dumpPath = join(directory, 'database.dump');
        await runCommand('pg_dump', [
          '--dbname',
          databaseUrl(new URL(sourceUrl).pathname.slice(1), 'postgres'),
          '--format=custom',
          '--file',
          dumpPath,
        ]);
        const backupKeyPath = join(directory, 'keyring.json');
        await copyFile(keyPath, backupKeyPath);
        expect(
          (await request(`${path}/service-keys/${issuedKey.metadata.id}/revoke`, 'POST')).status,
        ).toBe(200);
        const erasure = await request(path.replace(environmentId, erasedEnvironmentId), 'DELETE');
        expect(erasure.status).toBe(202);
        const erasureId = v.parse(
          v.object({ erasureId: v.string() }),
          await erasure.json(),
        ).erasureId;
        await fixture.database.query(
          "UPDATE app.erasure_jobs SET in_flight_until=clock_timestamp()-interval '1 second' WHERE id=$1",
          [erasureId],
        );
        const incidentLedgerPath = join(directory, 'incident-ledger.json');
        await writeFile(
          incidentLedgerPath,
          JSON.stringify({ revokedKeyId: issuedKey.metadata.id, erasureId }),
          { mode: 0o600 },
        );
        const afterSnapshot = await request(
          `${path}/notifications`,
          'POST',
          body,
          'after-snapshot',
        );
        expect(afterSnapshot.status).toBe(202);
        const lost = v.parse(acceptanceSchema, await afterSnapshot.json());
        const incidentAt = Date.now();
        const workerExited = once(worker, 'exit');
        worker.kill('SIGKILL');
        await workerExited;
        worker = undefined;
        holdProvider = false;
        provider.closeAllConnections();
        await fixture.stopServer();
        await rm(keyPath);
        const recoveryStarted = performance.now();
        await admin.query(`CREATE DATABASE ${databaseName}`);
        databaseCreated = true;
        await admin.query(`REVOKE CREATE, TEMPORARY ON DATABASE ${databaseName} FROM PUBLIC`);
        await admin.query(`GRANT CONNECT, CREATE ON DATABASE ${databaseName} TO pipong_migrator`);
        await admin.query(`GRANT CONNECT ON DATABASE ${databaseName} TO pipong_api, pipong_worker`);
        await runCommand('pg_restore', [
          '--dbname',
          databaseUrl(databaseName, 'postgres'),
          '--exit-on-error',
          dumpPath,
        ]);
        await runCommand('pnpm', ['migrate'], {
          cwd: root,
          env: {
            ...process.env,
            NODE_ENV: 'test',
            MIGRATION_DATABASE_URL: databaseUrl(databaseName, 'pipong_migrator'),
          },
        });
        await restored.connect();
        expect(
          (
            await restored.query('SELECT enabled FROM auth.api_keys WHERE id=$1', [
              issuedKey.metadata.id,
            ])
          ).rows,
        ).toEqual([{ enabled: true }]);
        expect(
          (
            await restored.query('SELECT deleted_at FROM app.environments WHERE id=$1', [
              erasedEnvironmentId,
            ])
          ).rows,
        ).toEqual([{ deleted_at: null }]);
        const incidentLedger = v.parse(
          v.object({ revokedKeyId: v.string(), erasureId: v.string() }),
          JSON.parse(await readFile(incidentLedgerPath, 'utf8')),
        );
        await restored.query('BEGIN');
        try {
          await restored.query('UPDATE auth.api_keys SET enabled=false WHERE id=$1', [
            incidentLedger.revokedKeyId,
          ]);
          await restored.query(
            'UPDATE app.environments SET suspended_at=clock_timestamp(),deleted_at=clock_timestamp() WHERE id=$1',
            [erasedEnvironmentId],
          );
          await restored.query(
            "INSERT INTO app.erasure_jobs (id,organization_id,project_id,environment_id,target_id,kind,actor_id,in_flight_until) VALUES ($1,$2,$3,$4,$4,'environment',$5,clock_timestamp()-interval '1 second')",
            [incidentLedger.erasureId, organizationId, projectId, erasedEnvironmentId, userId],
          );
          await restored.query('COMMIT');
        } catch (error) {
          await restored.query('ROLLBACK');
          throw error;
        }
        await restored.query('DELETE FROM app.worker_heartbeats');
        const credential = await restored.query<{ encrypted_secret: string }>(
          'SELECT encrypted_secret FROM app.credential_versions WHERE id=$1',
          [credentialId],
        );
        expect(
          decryptSecret(
            await loadSecretKeyring(backupKeyPath),
            credentialContext,
            v.parse(v.string(), credential.rows[0]?.encrypted_secret),
          ),
        ).toBe(
          JSON.stringify({
            provider: 'web-push',
            appId: 'test-project',
            secret: { privateKey: vapid.getPrivateKey().toString('base64url') },
          }),
        );
        expect(
          (
            await restored.query('SELECT id FROM app.notifications WHERE id=$1', [
              lost.notificationId,
            ])
          ).rows,
        ).toEqual([]);
        expect(
          (
            await restored.query(
              "SELECT state FROM pgboss.job WHERE name='delivery-web-push' ORDER BY created_on",
            )
          ).rows,
        ).toEqual([{ state: 'active' }, { state: 'failed' }]);
        const environment = {
          ...pushEnvironment,
          API_DATABASE_URL: databaseUrl(databaseName, 'pipong_api'),
          WORKER_DATABASE_URL: databaseUrl(databaseName, 'pipong_worker'),
          CREDENTIAL_KEYRING_REF: backupKeyPath,
          AUTH_MAIL_FROM: 'auth@example.com',
          SMTP_HOST: '127.0.0.1',
          SMTP_PORT: '1',
          SMTP_SECURITY: 'local',
        };
        api = spawn(process.execPath, ['apps/server/.output/server/index.mjs'], {
          cwd: root,
          env: environment,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        api.stdout?.resume();
        api.stderr?.on('data', (chunk: Buffer) => {
          apiLogs = (apiLogs + chunk.toString()).slice(-4000);
        });
        await expect
          .poll(
            async () => {
              try {
                return (await request('/api/auth/get-session')).status;
              } catch {
                return 0;
              }
            },
            { timeout: 10_000, message: apiLogs },
          )
          .toBe(200);
        const session = v.parse(
          v.object({ user: v.object({ id: v.string() }) }),
          await (await request('/api/auth/get-session')).json(),
        );
        expect(session.user.id).toBe(userId);
        const replay = await request(`${path}/notifications`, 'POST', body, 'pending');
        expect(replay.status).toBe(202);
        expect(v.parse(acceptanceSchema, await replay.json())).toEqual(acceptance);
        expect(
          (
            await fetch(`${fixture.baseUrl}${path}/notifications`, {
              headers: { 'x-api-key': revokedKey },
            })
          ).status,
        ).toBe(401);
        expect((await request(path.replace(environmentId, erasedEnvironmentId))).status).toBe(404);
        const resumedEvents = v.parse(
          eventsSchema,
          await (await request(`${path}/events?cursor=${events.nextCursor}`)).json(),
        );
        expect(resumedEvents.items[0]?.notificationId).toBe(crashed.notificationId);
        const stream = await fetch(`${fixture.baseUrl}${path}/events/stream`, {
          headers: { cookie, 'Last-Event-ID': events.nextCursor },
          signal: AbortSignal.timeout(10_000),
        });
        expect((await streamEvent(stream)).notificationId).toBe(crashed.notificationId);
        await restored.query(
          "UPDATE pgboss.job SET started_on=clock_timestamp()-interval '10 minutes' WHERE state='active'",
        );
        await restored.query(
          "UPDATE pgboss.queue SET maintain_on=clock_timestamp()-interval '10 minutes',monitor_claim_on=clock_timestamp()-interval '10 minutes',monitor_on=clock_timestamp()-interval '10 minutes' WHERE name='delivery-web-push'",
        );
        worker = startWorker(environment);
        await expect
          .poll(
            async () =>
              (
                await restored.query<{ count: number }>(
                  'SELECT count(*)::int AS count FROM app.worker_heartbeats WHERE expires_at>now()',
                )
              ).rows[0]?.count,
            { timeout: 10_000 },
          )
          .toBe(1);
        await expect
          .poll(
            async () =>
              (
                await restored.query<{ stage: string }>(
                  'SELECT stage FROM app.erasure_jobs WHERE id=$1',
                  [erasureId],
                )
              ).rows[0]?.stage,
            { timeout: 10_000 },
          )
          .toBe('deliveries');
        // oxlint-disable eslint/no-await-in-loop -- Restart the real worker after each committed batch to prove erasure resumes durably.
        for (let batch = 0; batch < 12; batch++) {
          const progress = v.parse(
            v.object({ updated: v.string(), completed: v.boolean() }),
            (
              await restored.query(
                'SELECT updated_at::text AS updated,completed_at IS NOT NULL AS completed FROM app.erasure_jobs WHERE id=$1',
                [erasureId],
              )
            ).rows[0],
          );
          if (progress.completed) {
            break;
          }
          await stopProcess(worker);
          worker = startWorker(environment);
          await expect
            .poll(
              async () => {
                const next = v.parse(
                  v.object({ updated: v.string(), completed: v.boolean() }),
                  (
                    await restored.query(
                      'SELECT updated_at::text AS updated,completed_at IS NOT NULL AS completed FROM app.erasure_jobs WHERE id=$1',
                      [erasureId],
                    )
                  ).rows[0],
                );
                return next.completed || next.updated !== progress.updated;
              },
              { timeout: 10_000 },
            )
            .toBe(true);
        }
        // oxlint-enable eslint/no-await-in-loop
        expect(
          (
            await restored.query(
              'SELECT completed_at IS NOT NULL AS completed FROM app.erasure_jobs WHERE id=$1',
              [erasureId],
            )
          ).rows,
        ).toEqual([{ completed: true }]);
        expect(
          (
            await restored.query('SELECT external_id FROM app.recipients WHERE environment_id=$1', [
              erasedEnvironmentId,
            ])
          ).rows,
        ).toEqual([{ external_id: null }]);
        await expect
          .poll(
            async () =>
              (
                await restored.query<{ state: string }>(
                  'SELECT state FROM app.deliveries WHERE notification_id=$1',
                  [crashed.notificationId],
                )
              ).rows[0]?.state,
            { timeout: 10_000 },
          )
          .toBe('failed');
        expect(
          (
            await restored.query(
              'SELECT outcome,code FROM app.delivery_attempts WHERE delivery_id IN (SELECT id FROM app.deliveries WHERE notification_id=$1)',
              [crashed.notificationId],
            )
          ).rows,
        ).toEqual([{ outcome: 'ambiguous', code: 'DELIVERY_RECOVERY_EXHAUSTED' }]);
        await expect
          .poll(
            async () =>
              (
                await restored.query<{ state: string }>(
                  'SELECT state FROM app.deliveries WHERE notification_id=$1',
                  [acceptance.notificationId],
                )
              ).rows[0]?.state,
            { timeout: 90000 },
          )
          .toBe('provider_accepted');
        expect(providerRequests).toBe(2);
        expect(
          (
            await restored.query(
              'SELECT outcome,code FROM app.delivery_attempts WHERE delivery_id IN (SELECT id FROM app.deliveries WHERE notification_id=$1) ORDER BY generation',
              [acceptance.notificationId],
            )
          ).rows,
        ).toEqual([
          { outcome: 'ambiguous', code: 'DELIVERY_CRASH_RECOVERED' },
          { outcome: 'accepted', code: 'WEB_PUSH_ACCEPTED' },
        ]);
        const status = await request(`${path}/notifications/${acceptance.notificationId}`);
        expect(status.status).toBe(200);
        expect(
          v.parse(v.object({ counts: v.object({ pending: v.number() }) }), await status.json())
            .counts.pending,
        ).toBe(0);
        expect((await restored.query('SELECT pending FROM app.tenant_budgets')).rows).toEqual([
          { pending: 0 },
        ]);
        expect(
          (
            await restored.query(
              "SELECT state FROM pgboss.job WHERE name='delivery-web-push' ORDER BY created_on",
            )
          ).rows,
        ).toEqual([{ state: 'completed' }, { state: 'failed' }]);
        console.info(
          `Runtime restore: ${Math.round(performance.now() - recoveryStarted)} ms recovery; ${incidentAt - snapshotStarted} ms conservative snapshot loss window; one post-snapshot acceptance absent; post-snapshot revocation/erasure reconciled before startup; active TLS Web Push crash/lease recovery passed; first provider request ambiguous; second accepted`,
        );
        await stopProcess(worker);
        worker = undefined;
        expect(
          (
            await restored.query(
              'SELECT id FROM app.worker_heartbeats WHERE expires_at>clock_timestamp()',
            )
          ).rows,
        ).toEqual([]);
      } finally {
        await stopProcess(worker);
        await stopProcess(api);
        provider.closeAllConnections();
        await new Promise<void>((resolve) => {
          provider.close(() => {
            resolve();
          });
        });
        await restored.end();
        if (databaseCreated) {
          await admin.query(`DROP DATABASE ${databaseName} WITH (FORCE)`);
        }
        await admin.end();
        await fixture.close();
        await rm(directory, { recursive: true, force: true });
      }
    }, 150_000);
  },
);
