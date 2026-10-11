import type { AuthFixture } from './fixtures/auth-runtime.ts';
import type { FixtureProcess } from './fixtures/backend-process.ts';
import type { Scope, StreamHarness } from './fixtures/load-sse.ts';
import { encryptSecret } from '@pipong/service';
import { createECDH, createSecretKey, generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer, request as httpsRequest } from 'node:https';
import { setTimeout } from 'node:timers/promises';
import { v7 } from 'uuid';
import * as v from 'valibot';
import { expect, it } from 'vitest';
import { freePort, startAuthFixture } from './fixtures/auth-runtime.ts';
import {
  readFixtureRuntime,
  readQualificationCgroupFile,
  sampleFixtureProcesses,
  startFixtureProcess,
} from './fixtures/backend-process.ts';
import { startQualificationProvider } from './fixtures/load-provider.ts';
import { scopePath, startQualificationStreams } from './fixtures/load-sse.ts';

const enabled = process.env.QUALIFICATION_DATABASE_URL;
const duration = v.parse(
  v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(60), v.maxValue(1800)),
  process.env.QUALIFICATION_SECONDS ?? '60',
);
const retainedJobs = v.parse(
  v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(0), v.maxValue(1000000)),
  process.env.QUALIFICATION_RETAINED_JOBS ?? '0',
);
const requestsPerSecond = v.parse(
  v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(3), v.maxValue(50)),
  process.env.QUALIFICATION_REQUESTS_PER_SECOND ?? '50',
);
const streamCount = v.parse(
  v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(40), v.maxValue(1000)),
  process.env.QUALIFICATION_STREAMS ?? '1000',
);
const requestIntervalMs = 1000 / requestsPerSecond;
const streamRequestCount = 30 * requestsPerSecond;
const expectedDeliveries = duration * requestsPerSecond * 2 + 1000 + streamRequestCount * 2 + 2;
const userId = '019a0000-0000-7000-8000-000000000011';

function percentile(values: number[], fraction: number): number {
  return values.toSorted((left, right) => left - right)[Math.floor(values.length * fraction)] ?? 0;
}

it.skipIf(!enabled)(
  'measures sustained HTTP acceptance and mixed-provider dispatch with two replicas',
  async () => {
    let fixture: AuthFixture | undefined;
    const children: FixtureProcess[] = [];
    let streamHarness: StreamHarness | undefined;
    let sampling: Promise<void> | undefined;
    let sampleTimer: ReturnType<typeof setInterval> | undefined;
    let samplingFailures = 0;
    const databaseWaitSamples: Record<string, number> = {};
    const peakResources = new Map<number, { role: string; rssKiB: number; cpuPercent: number }>();
    const cert = await readFile(
      new URL('../../../packages/service/tests/fixtures/push-cert.pem', import.meta.url),
    );
    const key = await readFile(
      new URL('../../../packages/service/tests/fixtures/push-key.pem', import.meta.url),
    );
    const provider = await startQualificationProvider();
    const transportFailures: string[] = [];
    let replicaIndex = 0;
    const urls: string[] = [];
    const proxy = createServer({ key, cert }, (request, response) => {
      const target = urls[replicaIndex++ % urls.length];
      const upstream = httpRequest(
        `${target}${request.url}`,
        { method: request.method, headers: request.headers },
        (incoming) => {
          response.writeHead(incoming.statusCode ?? 502, incoming.headers);
          incoming.pipe(response);
        },
      );
      upstream.on('error', () => response.destroy());
      response.on('close', () => upstream.destroy());
      request.pipe(upstream);
    });
    try {
      fixture = await startAuthFixture(enabled ?? '');
      urls.push(fixture.baseUrl);
      const replicaUrl =
        process.env.QUALIFICATION_API_URL_2 ?? `http://localhost:${await freePort()}`;
      urls.push(replicaUrl);
      children.push(
        await startFixtureProcess('apps/server/.output/server/index.mjs', {
          ...fixture.environment,
          PORT: new URL(replicaUrl).port,
        }),
      );
      await setTimeout(1000);
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
      const keyring = {
        activeKeyId: 'first',
        keys: new Map([['first', createSecretKey(Buffer.from('11'.repeat(32), 'hex'))]]),
      };
      const pem = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({
        type: 'pkcs8',
        format: 'pem',
      });
      const rsaPem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
        type: 'pkcs8',
        format: 'pem',
      });
      const vapid = createECDH('prime256v1');
      vapid.generateKeys();
      const receiver = createECDH('prime256v1');
      receiver.generateKeys();
      const webPushOrigin = provider.webPushOrigin;
      const providerDefinitions = [
        {
          provider: 'apns',
          appId: 'com.pipong.test',
          publicKey: null,
          secret: {
            teamId: 'TEAM000001',
            keyId: 'KEY0000001',
            environment: 'sandbox',
            privateKey: pem,
          },
          target: { token: 'ab'.repeat(32), environment: 'sandbox' },
        },
        {
          provider: 'fcm',
          appId: 'target-project',
          publicKey: null,
          secret: {
            projectId: 'credential-project',
            clientEmail: 'push@example.test',
            privateKey: rsaPem,
          },
          target: { kind: 'registration-token', value: 'registration:token-value_123' },
        },
        {
          provider: 'web-push',
          appId: 'browser-app',
          publicKey: vapid.getPublicKey().toString('base64url'),
          secret: { privateKey: vapid.getPrivateKey().toString('base64url') },
          target: {
            endpoint: `${webPushOrigin}/send`,
            p256dh: receiver.getPublicKey().toString('base64url'),
            auth: Buffer.alloc(16, 4).toString('base64url'),
            applicationServerKey: vapid.getPublicKey().toString('base64url'),
          },
        },
      ] satisfies {
        provider: 'apns' | 'fcm' | 'web-push';
        appId: string;
        publicKey: string | null;
        secret: Record<string, string>;
        target: Record<string, string>;
      }[];
      let endpointSequence = 0;
      async function seed(name: string, endpointCount: number): Promise<Scope> {
        if (!fixture) {
          throw new Error('QUALIFICATION_FIXTURE_MISSING');
        }
        const scope = {
          organizationId: v7(),
          projectId: v7(),
          environmentId: v7(),
          recipientId: v7(),
        };
        await fixture.database.query(
          'INSERT INTO auth.organizations (id,name,slug) VALUES ($1,$2,$2)',
          [scope.organizationId, name],
        );
        await fixture.database.query(
          "INSERT INTO auth.members (id,organization_id,user_id,role) VALUES ($1,$2,$3,'owner')",
          [v7(), scope.organizationId, userId],
        );
        await fixture.database.query(
          'INSERT INTO app.projects (id,organization_id,name) VALUES ($1,$2,$3)',
          [scope.projectId, scope.organizationId, name],
        );
        await fixture.database.query(
          'INSERT INTO app.environments (id,organization_id,project_id,name) VALUES ($1,$2,$3,$4)',
          [scope.environmentId, scope.organizationId, scope.projectId, name],
        );
        await fixture.database.query(
          'INSERT INTO app.recipients (id,organization_id,project_id,environment_id,external_id) VALUES ($1,$2,$3,$4,$5)',
          [scope.recipientId, scope.organizationId, scope.projectId, scope.environmentId, name],
        );
        await fixture.database.query(
          'INSERT INTO app.tenant_budgets (organization_id,request_limit,pending_limit,fanout_limit) VALUES ($1,100000,1000000,1000000)',
          [scope.organizationId],
        );
        const credentials = new Map<string, string>();
        // eslint-disable-next-line no-await-in-loop -- Each endpoint generation is seeded in its required transaction.
        for (let index = 0; index < endpointCount; index++) {
          const definition = providerDefinitions[endpointSequence++ % providerDefinitions.length];
          if (!definition) {
            throw new Error('QUALIFICATION_PROVIDER_MISSING');
          }
          const { provider: endpointProvider, appId, publicKey, secret, target } = definition;
          let credentialId = credentials.get(endpointProvider);
          if (!credentialId) {
            credentialId = v7();
            const encryptedSecret = encryptSecret(
              keyring,
              {
                ...scope,
                resourceId: credentialId,
                purpose: 'credential',
                binding: JSON.stringify([endpointProvider, appId, publicKey]),
              },
              JSON.stringify({ provider: endpointProvider, appId, secret }),
            );
            // eslint-disable-next-line no-await-in-loop -- Each immutable credential precedes its endpoint.
            await fixture.database.query(
              "INSERT INTO app.credential_versions (id,organization_id,project_id,environment_id,provider,app_id,public_key,encrypted_secret,state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')",
              [
                credentialId,
                scope.organizationId,
                scope.projectId,
                scope.environmentId,
                endpointProvider,
                appId,
                publicKey,
                encryptedSecret,
              ],
            );
            credentials.set(endpointProvider, credentialId);
          }
          const endpointId = v7();
          const installation = `phone-${index}`;
          const encryptedTarget = encryptSecret(
            keyring,
            {
              ...scope,
              resourceId: endpointId,
              purpose: 'endpoint',
              binding: JSON.stringify([
                scope.recipientId,
                endpointProvider,
                appId,
                installation,
                1,
                credentialId,
              ]),
            },
            JSON.stringify(target),
          );
          // eslint-disable-next-line no-await-in-loop -- Seed immutable endpoint and generation atomically.
          await fixture.database.query('BEGIN');
          try {
            // eslint-disable-next-line no-await-in-loop -- Same endpoint transaction.
            await fixture.database.query(
              'INSERT INTO app.endpoints (id,organization_id,project_id,environment_id,recipient_id,installation_id,provider,app_id,generation,credential_id,target_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10)',
              [
                endpointId,
                scope.organizationId,
                scope.projectId,
                scope.environmentId,
                scope.recipientId,
                installation,
                endpointProvider,
                appId,
                credentialId,
                endpointId,
              ],
            );
            // eslint-disable-next-line no-await-in-loop -- Same endpoint transaction.
            await fixture.database.query(
              'INSERT INTO app.endpoint_generations (organization_id,project_id,environment_id,endpoint_id,generation,credential_id,encrypted_target,registered_at) VALUES ($1,$2,$3,$4,1,$5,$6,now())',
              [
                scope.organizationId,
                scope.projectId,
                scope.environmentId,
                endpointId,
                credentialId,
                encryptedTarget,
              ],
            );
            // eslint-disable-next-line no-await-in-loop -- Complete endpoint transaction.
            await fixture.database.query('COMMIT');
          } catch (error) {
            // eslint-disable-next-line no-await-in-loop -- Roll back failed endpoint transaction.
            await fixture.database.query('ROLLBACK');
            throw error;
          }
        }
        return scope;
      }
      const noisy = await seed('noisy', 2);
      const noisyScopes = [noisy, await seed('noisy-web-apns', 2), await seed('noisy-fcm-web', 2)];
      const quiet = await seed('quiet', 2);
      const bulk = await seed('bulk', 1000);
      if (retainedJobs > 0) {
        await fixture.database.query(
          `INSERT INTO pgboss.job (name,id,data,state,group_id,completed_on)
            SELECT 'delivery-apns',uuidv7(),'{}'::jsonb,'completed','history',clock_timestamp()
            FROM generate_series(1,$1::integer)`,
          [retainedJobs],
        );
        await fixture.database.query('ANALYZE pgboss.job_common');
      }
      const startupAuditSessionId = v7();
      const periodicAuditId = v7();
      await fixture.database.query(
        "INSERT INTO app.privileged_audits (id,organization_id,user_id,session_id,action,created_at) SELECT uuidv7(),$1,$2,$3,'organization:manage',clock_timestamp()-interval '91 days' FROM generate_series(1,200)",
        [noisy.organizationId, userId, startupAuditSessionId],
      );
      for (let index = 0; index < 2; index++) {
        children.push(
          // eslint-disable-next-line no-await-in-loop -- Track each started consumer before launching the next.
          await startFixtureProcess('apps/server/tests/fixtures/load-worker.ts', {
            ...fixture.environment,
            QUALIFICATION_PROVIDER_ORIGIN: provider.apnsOrigin,
            QUALIFICATION_FCM_ORIGIN: provider.fcmOrigin,
            QUALIFICATION_WEB_PUSH_ORIGIN: webPushOrigin,
            PUSH_DELIVERY_ENABLED: 'true',
            WEB_PUSH_SUBJECT: 'mailto:qualification@example.com',
            AUTH_MAIL_FROM: 'auth@example.com',
            SMTP_HOST: '127.0.0.1',
            SMTP_PORT: '1',
            SMTP_SECURITY: 'local',
          }),
        );
      }
      for (const child of children) {
        child.child.stderr?.on('data', (chunk: Buffer) => {
          for (const line of chunk.toString().split('\n')) {
            if (line.startsWith('QUALIFICATION_TRANSPORT_FAILURE')) {
              transportFailures.push(line);
              console.error(line);
            }
          }
        });
      }
      const processes = new Map<number, string>([[fixture.processId, 'api']]);
      for (const [index, child] of children.entries()) {
        processes.set(child.processId, index === 0 ? 'api' : 'worker');
      }
      const samplingDatabase = fixture.database;
      async function readyWorkers(): Promise<number> {
        const result = await samplingDatabase.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM app.worker_heartbeats WHERE expires_at > clock_timestamp() AND consumers_ready @> ARRAY['auth-email','apns','fcm','web-push']::text[]",
        );
        return result.rows[0]?.count ?? 0;
      }
      await expect.poll(readyWorkers, { timeout: 10000 }).toBe(2);
      async function retainedAuditCount(id: string): Promise<number> {
        const result = await samplingDatabase.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM app.privileged_audits WHERE id=$1',
          [id],
        );
        return result.rows[0]?.count ?? 0;
      }
      await expect
        .poll(
          async () => {
            const result = await samplingDatabase.query<{ count: number }>(
              'SELECT count(*)::int AS count FROM app.privileged_audits WHERE session_id=$1',
              [startupAuditSessionId],
            );
            return result.rows[0]?.count ?? 0;
          },
          { timeout: 10000 },
        )
        .toBe(0);

      let workerReadinessFailures = 0;
      let streamContinuityFailures = 0;
      let sustainedStarted = 0;
      let measuringSustainedStreams = false;

      async function sampleResources(): Promise<void> {
        try {
          if ((await readyWorkers()) !== 2) {
            workerReadinessFailures++;
          }
          if (measuringSustainedStreams && streamHarness && Date.now() - sustainedStarted > 60000) {
            const continuity = streamHarness.report(Date.now() - 60000);
            if (continuity.live !== streamCount || continuity.recentDelivery !== streamCount) {
              streamContinuityFailures++;
            }
          }
          const result = await sampleFixtureProcesses([...processes.keys()]);
          const sampledPids = new Set<number>();
          for (const line of result.trim().split('\n')) {
            const [pid, rssKiB, cpuPercent] = v.parse(
              v.tuple([
                v.pipe(v.string(), v.toNumber()),
                v.pipe(v.string(), v.toNumber()),
                v.pipe(v.string(), v.toNumber()),
              ]),
              line.trim().split(/\s+/),
            );
            sampledPids.add(pid);
            const previous = peakResources.get(pid);
            peakResources.set(pid, {
              role: processes.get(pid) ?? 'missing',
              rssKiB: Math.max(previous?.rssKiB ?? 0, rssKiB),
              cpuPercent: Math.max(previous?.cpuPercent ?? 0, cpuPercent),
            });
          }
          for (const pid of processes.keys()) {
            if (!sampledPids.has(pid)) {
              throw new Error('QUALIFICATION_PROCESS_EXITED');
            }
          }
          const waits = await samplingDatabase.query<{ wait: string; count: number }>(
            "SELECT wait_event_type || ':' || wait_event AS wait,count(*)::integer AS count FROM pg_stat_activity WHERE datname=current_database() AND state='active' AND wait_event IS NOT NULL GROUP BY wait_event_type,wait_event",
          );
          for (const { wait, count } of waits.rows) {
            databaseWaitSamples[wait] = (databaseWaitSamples[wait] ?? 0) + count;
          }
        } catch {
          samplingFailures++;
        }
      }
      sampleTimer = setInterval(() => {
        sampling ??= sampleResources().finally(() => {
          sampling = undefined;
        });
      }, 1000);
      proxy.listen(0, '127.0.0.1');
      await once(proxy, 'listening');
      const port = v.parse(v.object({ port: v.number() }), proxy.address()).port;
      async function submit(scope: Scope): Promise<{ status: number; milliseconds: number }> {
        const started = performance.now();
        return new Promise((resolve, reject) => {
          const request = httpsRequest(
            {
              hostname: '127.0.0.1',
              port,
              servername: 'push.test',
              ca: cert,
              path: `${scopePath(scope)}/notifications`,
              method: 'POST',
              headers: {
                cookie,
                origin: fixture?.baseUrl,
                'content-type': 'application/json',
                'idempotency-key': v7(),
              },
            },
            (response) => {
              response.resume();
              response.on('end', () => {
                resolve({
                  status: response.statusCode ?? 0,
                  milliseconds: performance.now() - started,
                });
              });
            },
          );
          request.on('error', reject);
          request.end(
            JSON.stringify({
              targets: { kind: 'recipients', ids: [scope.recipientId] },
              content: { alert: { title: 'Qualification', body: 'Fixture' } },
              expiresAt: new Date(Date.now() + 3600000).toISOString(),
            }),
          );
        });
      }
      const sseScopes: Scope[] = [];
      // oxlint-disable eslint/no-await-in-loop -- Prepare every environment before the sustained stream measurement.
      for (let index = 0; index < 20; index++) {
        sseScopes.push(await seed(`sse-${index}`, 2));
      }
      // oxlint-enable eslint/no-await-in-loop
      streamHarness = await startQualificationStreams(
        fixture.database,
        fixture.baseUrl,
        port,
        cert,
        sseScopes,
        cookie,
      );
      await streamHarness.open(streamCount);
      await samplingDatabase.query(
        "INSERT INTO app.privileged_audits (id,organization_id,user_id,session_id,action,created_at) VALUES ($1,$2,$3,$4,'organization:manage',clock_timestamp()-interval '91 days')",
        [periodicAuditId, noisy.organizationId, userId, v7()],
      );
      const sustainedStreams = streamHarness;
      const streamsStarted = Date.now();
      sustainedStarted = streamsStarted;
      measuringSustainedStreams = true;
      const acceptance: number[] = [];
      const statuses: Record<string, number> = {};
      const pending: Promise<void>[] = [];
      await provider.startTraffic(duration);
      const started = Date.now();
      let scheduleLagMs = 0;
      // eslint-disable-next-line no-await-in-loop -- Fixed arrival schedule keeps offered load independent of response latency.
      for (let index = 0; index < duration * requestsPerSecond; index++) {
        // eslint-disable-next-line no-await-in-loop -- Maintain the configured arrival rate without serializing requests.
        await setTimeout(Math.max(0, started + index * requestIntervalMs - Date.now()));
        scheduleLagMs = Math.max(scheduleLagMs, Date.now() - (started + index * requestIntervalMs));
        const selectedScope =
          index % requestsPerSecond === 0
            ? quiet
            : index % requestsPerSecond === 1
              ? sseScopes[Math.floor(index / requestsPerSecond) % sseScopes.length]
              : noisyScopes[index % noisyScopes.length];
        if (!selectedScope) {
          throw new Error('QUALIFICATION_SCOPE_MISSING');
        }
        pending.push(
          submit(selectedScope).then((result) => {
            statuses[result.status] = (statuses[result.status] ?? 0) + 1;
            if (result.status === 202) {
              acceptance.push(result.milliseconds);
            }
          }),
        );
      }
      const offeredDurationMs = Date.now() - started;
      await Promise.all(pending);
      await setTimeout(5000);
      const sustainedStreamReport = sustainedStreams.report(
        Date.now() - Math.min(60000, duration * 1000),
      );
      const sustainedHoldMs = Date.now() - streamsStarted;
      measuringSustainedStreams = false;
      const bulkResult = await submit(bulk);
      const drainStarted = Date.now();
      let unfinished = 1000;
      // oxlint-disable eslint/no-await-in-loop -- Measure actual burst drain against a bounded deadline.
      while (unfinished > 0 && Date.now() - drainStarted < 60000) {
        const count = await fixture.database.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM app.deliveries WHERE organization_id=$1 AND state <> 'provider_accepted'",
          [bulk.organizationId],
        );
        unfinished = count.rows[0]?.count ?? 1000;
        if (unfinished > 0) {
          await setTimeout(250);
        }
      }
      // oxlint-enable eslint/no-await-in-loop
      const burstDrainMs = Date.now() - drainStarted;
      const sseAcceptance: number[] = [];
      const sseStatuses: Record<string, number> = {};
      const sseRequests: Promise<void>[] = [];
      const streamLoadStarted = Date.now();
      let streamScheduleLagMs = 0;
      let revocation: ReturnType<StreamHarness['revoke']> | undefined;
      let replay: Promise<boolean> | undefined;
      // oxlint-disable eslint/no-await-in-loop -- Hold the configured streams under fixed-rate acceptance and delivery for 30 seconds.
      for (let index = 0; index < streamRequestCount; index++) {
        if (index === requestsPerSecond * 5) {
          revocation = sustainedStreams.revoke();
        }
        if (index === requestsPerSecond * 10) {
          replay = sustainedStreams.replay(submit);
        }
        await setTimeout(Math.max(0, streamLoadStarted + index * requestIntervalMs - Date.now()));
        streamScheduleLagMs = Math.max(
          streamScheduleLagMs,
          Date.now() - (streamLoadStarted + index * requestIntervalMs),
        );
        sseRequests.push(
          submit(sseScopes[index % sseScopes.length] ?? noisy).then((result) => {
            sseStatuses[result.status] = (sseStatuses[result.status] ?? 0) + 1;
            if (result.status === 202) {
              sseAcceptance.push(result.milliseconds);
            }
          }),
        );
      }
      // oxlint-enable eslint/no-await-in-loop
      const streamOfferedDurationMs = Date.now() - streamLoadStarted;
      await Promise.all(sseRequests);
      await setTimeout(5000);
      const revocationReport = await revocation;
      const replayPassed = await replay;
      const finalStreamReport = sustainedStreams.report(Date.now() - 10000);

      const dispatch = await fixture.database.query<{
        organization_id: string;
        count: number;
        p95: number;
      }>(
        `SELECT deliveries.organization_id,count(*)::int AS count,percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM delivery_attempts.started_at-notifications.accepted_at)*1000) AS p95 FROM app.delivery_attempts JOIN app.deliveries ON deliveries.id=delivery_attempts.delivery_id JOIN app.notifications ON notifications.id=deliveries.notification_id WHERE delivery_attempts.generation=1 GROUP BY deliveries.organization_id`,
      );
      const providerDeliveries = await fixture.database.query<{
        provider: 'apns' | 'fcm' | 'web-push';
        count: number;
        accepted: number;
        p95: number;
      }>(
        `SELECT deliveries.provider,count(*)::int AS count,count(*) FILTER (WHERE deliveries.state='provider_accepted')::int AS accepted,percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM delivery_attempts.started_at-notifications.accepted_at)*1000) FILTER (WHERE deliveries.organization_id<>$1) AS p95 FROM app.deliveries JOIN app.delivery_attempts ON delivery_attempts.delivery_id=deliveries.id AND delivery_attempts.generation=1 JOIN app.notifications ON notifications.id=deliveries.notification_id GROUP BY deliveries.provider`,
        [bulk.organizationId],
      );
      clearInterval(sampleTimer);
      sampleTimer = undefined;
      await sampling;
      const completed = await fixture.database.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM app.deliveries WHERE state='provider_accepted'",
      );
      let cgroup:
        | {
            cpuMax: string;
            cpuSet: string;
            cpu: Record<string, number>;
            memoryMaxBytes: number;
            memoryPeakBytes: number;
            swapMaxBytes: number;
          }
        | undefined;
      if (process.env.QUALIFICATION_CPU_LIMIT) {
        const numberSchema = v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(0));
        cgroup = {
          cpuMax: (await readQualificationCgroupFile('cpu.max')).trim(),
          cpuSet: (await readQualificationCgroupFile('cpuset.cpus.effective')).trim(),
          cpu: v.parse(
            v.record(v.string(), numberSchema),
            Object.fromEntries(
              (await readQualificationCgroupFile('cpu.stat'))
                .trim()
                .split('\n')
                .map((line) => line.split(/\s+/)),
            ),
          ),
          memoryMaxBytes: v.parse(
            numberSchema,
            (await readQualificationCgroupFile('memory.max')).trim(),
          ),
          memoryPeakBytes: v.parse(
            numberSchema,
            (await readQualificationCgroupFile('memory.peak')).trim(),
          ),
          swapMaxBytes: v.parse(
            numberSchema,
            (await readQualificationCgroupFile('memory.swap.max')).trim(),
          ),
        };
      }
      const periodicAuditRemaining = await retainedAuditCount(periodicAuditId);
      const backendRuntime = await readFixtureRuntime();
      const attemptOutcomes = await fixture.database.query<{
        provider: string;
        outcome: string | null;
        code: string | null;
        count: number;
      }>(
        'SELECT deliveries.provider,delivery_attempts.outcome,delivery_attempts.code,count(*)::int AS count FROM app.delivery_attempts JOIN app.deliveries ON deliveries.id=delivery_attempts.delivery_id GROUP BY deliveries.provider,delivery_attempts.outcome,delivery_attempts.code',
      );
      const { providerCounts, providerErrors, oauthRequests, sustainedOauthRefreshes } =
        await provider.stats();
      const providerRequests =
        providerCounts.apns + providerCounts.fcm + providerCounts['web-push'];
      const report = {
        durationSeconds: duration,
        requestsPerSecond,
        offeredDurationMs,
        scheduleLagMs,
        offeredRequests: duration * requestsPerSecond,
        statuses,
        acceptanceP95Ms: percentile(acceptance, 0.95),
        bulk: { ...bulkResult, burstDrainMs, unfinished },
        providerRequests,
        providerCounts,
        providerDeliveries: providerDeliveries.rows,
        oauthRequests,
        sustainedOauthRefreshes,
        providerErrors,
        attemptOutcomes: attemptOutcomes.rows,
        transportFailures,
        completedDeliveries: completed.rows[0]?.count,
        resources: {
          processes: [...peakResources.values()],
          cpuMetric: 'maximum sampled ps lifetime-average percent',
          databaseWaitSamples,
          samplingFailures,
          workerReadinessFailures,
          streamContinuityFailures,
          periodicAuditRemaining,
          cgroup,
        },
        sse: {
          offered: streamCount,
          holdSeconds: duration,
          sustainedHoldMs,
          sustained: sustainedStreamReport,
          final: finalStreamReport,
          revocation: revocationReport,
          replayPassed,
          offeredDurationMs: streamOfferedDurationMs,
          scheduleLagMs: streamScheduleLagMs,
          concurrentRequests: streamRequestCount,
          acceptanceStatuses: sseStatuses,
          acceptanceP95Ms: percentile(sseAcceptance, 0.95),
          environments: 20,
        },
        dispatch: dispatch.rows,
        memory: process.memoryUsage(),
        topology: {
          backend: backendRuntime,
          driver: {
            runtime: process.version,
            platform: process.platform,
            architecture: process.arch,
          },
          cpuLimit: process.env.QUALIFICATION_CPU_LIMIT ?? 'unconstrained',
          memoryLimit: process.env.QUALIFICATION_MEMORY_LIMIT ?? 'unconstrained',
          api: 2,
          workers: 2,
          workerRuntime:
            'built production lifecycle with local APNs, FCM/OAuth, and Web Push transports',
          workerConsumers: ['auth-email', 'apns', 'fcm', 'web-push'],
          retainedJobs,
          environments: 25,
          database: 'PostgreSQL 18',
          provider:
            'separate Linux fixture container in backend network namespace, outside backend resource cap',
        },
      };
      console.info(JSON.stringify(report));
      if (process.env.QUALIFICATION_REPORT) {
        await writeFile(process.env.QUALIFICATION_REPORT, JSON.stringify(report, null, 2));
      }
      for (const child of children) {
        expect.soft(child.child.exitCode).toBeNull();
        expect.soft(child.child.signalCode).toBeNull();
      }
      if (cgroup) {
        expect.soft(cgroup.swapMaxBytes).toBe(0);
      }
      expect.soft(scheduleLagMs).toBeLessThanOrEqual(500);
      expect.soft(offeredDurationMs).toBeLessThanOrEqual(duration * 1000 + 500);
      expect.soft(streamScheduleLagMs).toBeLessThanOrEqual(500);
      expect.soft(streamOfferedDurationMs).toBeLessThanOrEqual(30500);
      expect.soft(samplingFailures).toBe(0);
      expect.soft(workerReadinessFailures).toBe(0);
      expect.soft(streamContinuityFailures).toBe(0);
      expect.soft(periodicAuditRemaining).toBe(0);
      expect.soft(await readyWorkers()).toBe(2);
      expect.soft(peakResources.size).toBe(4);
      expect.soft(completed.rows[0]?.count).toBe(expectedDeliveries);
      expect.soft(providerRequests).toBe(expectedDeliveries);
      expect.soft(providerErrors).toBe(0);
      expect.soft(transportFailures.length).toBe(0);
      for (const row of attemptOutcomes.rows) {
        expect.soft(row.outcome).toBe('accepted');
      }
      expect.soft(oauthRequests).toBeGreaterThan(0);
      if (duration >= 1000) {
        expect.soft(sustainedOauthRefreshes).toBeGreaterThan(0);
      }
      expect.soft(providerDeliveries.rows.length).toBe(3);
      for (const row of providerDeliveries.rows) {
        expect.soft(row.accepted).toBe(row.count);
        expect.soft(providerCounts[row.provider]).toBe(row.count);
        expect.soft(row.p95).toBeLessThanOrEqual(2000);
      }
      for (const count of Object.values(providerCounts)) {
        expect.soft(count).toBeGreaterThan(0);
      }
      expect.soft(sustainedHoldMs).toBeGreaterThanOrEqual(duration * 1000);
      expect.soft(sustainedStreamReport.live).toBe(streamCount);
      expect.soft(sustainedStreamReport.delivered).toBe(streamCount);
      expect.soft(sustainedStreamReport.recentDelivery).toBe(streamCount);
      expect
        .soft(finalStreamReport.live)
        .toBe(streamCount - (revocationReport?.expectedClosed ?? 0));
      expect.soft(finalStreamReport.recentDelivery).toBe(finalStreamReport.live);
      expect.soft(finalStreamReport.unexpectedClosures).toBe(0);
      expect.soft(finalStreamReport.frameErrors).toBe(0);
      expect.soft(finalStreamReport.sequenceGaps).toBe(0);
      expect.soft(finalStreamReport.humanSessions).toBe(20);
      expect.soft(finalStreamReport.serviceKeys).toBe(20);
      expect.soft(sseAcceptance.length).toBe(streamRequestCount);
      expect.soft(percentile(sseAcceptance, 0.95)).toBeLessThanOrEqual(250);
      expect.soft(acceptance.length).toBe(duration * requestsPerSecond);
      expect.soft(percentile(acceptance, 0.95)).toBeLessThanOrEqual(250);
      expect.soft(bulkResult.status).toBe(202);
      expect.soft(unfinished).toBe(0);
      expect
        .soft(dispatch.rows.find((row) => row.organization_id === quiet.organizationId)?.p95)
        .toBeLessThanOrEqual(2000);
      expect
        .soft(dispatch.rows.find((row) => row.organization_id === noisy.organizationId)?.p95)
        .toBeLessThanOrEqual(2000);
      for (const { organizationId } of [...noisyScopes, ...sseScopes]) {
        expect
          .soft(dispatch.rows.find((row) => row.organization_id === organizationId)?.p95)
          .toBeLessThanOrEqual(2000);
      }
      expect.soft(revocationReport?.revokedInWindow).toBe(true);
      expect.soft(revocationReport?.humanReconnectStatus).toBe(404);
      expect.soft(revocationReport?.keyReconnectStatus).toBe(401);
      expect.soft(replayPassed).toBe(true);
      await Promise.all(children.slice(1).map((child) => child.stop()));
      const remainingWorkers = await samplingDatabase.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM app.worker_heartbeats',
      );
      expect.soft(remainingWorkers.rows[0]?.count).toBe(0);
      for (const child of children.slice(1)) {
        expect.soft(child.child.exitCode).toBe(0);
        expect.soft(child.logs()).toContain('worker_stopped');
      }
    } finally {
      clearInterval(sampleTimer);
      await sampling;
      streamHarness?.close();
      await Promise.all(children.map((child) => child.stop()));
      proxy.closeAllConnections();
      proxy.close();
      await provider.close();
      await fixture?.close();
    }
  },
  (duration + 300) * 1000,
);
