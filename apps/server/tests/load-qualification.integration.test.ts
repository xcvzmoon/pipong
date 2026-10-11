import type { IncomingMessage } from 'node:http';
import type { ServerHttp2Stream } from 'node:http2';
import type { AuthFixture } from './fixtures/auth-runtime.ts';
import type { FixtureProcess } from './fixtures/backend-process.ts';
import { encryptSecret } from '@pipong/service';
import { createSecretKey, generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createSecureServer } from 'node:http2';
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

const enabled = process.env.QUALIFICATION_DATABASE_URL;
const duration = v.parse(
  v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(1), v.maxValue(1800)),
  process.env.QUALIFICATION_SECONDS ?? '30',
);
const retainedJobs = v.parse(
  v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(0), v.maxValue(1000000)),
  process.env.QUALIFICATION_RETAINED_JOBS ?? '0',
);
const userId = '019a0000-0000-7000-8000-000000000011';

type Scope = {
  organizationId: string;
  projectId: string;
  environmentId: string;
  recipientId: string;
};
function percentile(values: number[], fraction: number): number {
  return values.toSorted((left, right) => left - right)[Math.floor(values.length * fraction)] ?? 0;
}

it.skipIf(!enabled)(
  'measures sustained HTTP acceptance and TLS provider dispatch with two replicas',
  async () => {
    let fixture: AuthFixture | undefined;
    const children: FixtureProcess[] = [];
    const streams: IncomingMessage[] = [];
    let sampling: Promise<void> | undefined;
    let sampleTimer: ReturnType<typeof setInterval> | undefined;
    let samplingFailures = 0;
    const databaseWaitSamples: Record<string, number> = {};
    const peakResources = new Map<number, { role: string; rssKiB: number; cpuPercent: number }>();
    let streamBytes = 0;
    let liveStreams = 0;
    let deliveredStreams = 0;
    const cert = await readFile(
      new URL('../../../packages/service/tests/fixtures/push-cert.pem', import.meta.url),
    );
    const key = await readFile(
      new URL('../../../packages/service/tests/fixtures/push-key.pem', import.meta.url),
    );
    const provider = createSecureServer({ key, cert });
    let providerRequests = 0;
    provider.on('stream', (stream: ServerHttp2Stream, headers) => {
      stream.on('error', () => {});
      stream.resume();
      stream.on('end', () => {
        providerRequests += 1;
        stream.respond({ ':status': 200, 'apns-id': headers['apns-id'] });
        stream.end();
      });
    });
    provider.listen(0, process.env.QUALIFICATION_CONTAINER ? '0.0.0.0' : '127.0.0.1');
    await once(provider, 'listening');
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
        const credentialId = v7();
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
        const encryptedSecret = encryptSecret(
          keyring,
          {
            ...scope,
            resourceId: credentialId,
            purpose: 'credential',
            binding: JSON.stringify(['apns', 'com.pipong.test', null]),
          },
          JSON.stringify({
            provider: 'apns',
            appId: 'com.pipong.test',
            secret: {
              teamId: 'TEAM000001',
              keyId: 'KEY0000001',
              environment: 'sandbox',
              privateKey: pem,
            },
          }),
        );
        await fixture.database.query(
          "INSERT INTO app.credential_versions (id,organization_id,project_id,environment_id,provider,app_id,encrypted_secret,state) VALUES ($1,$2,$3,$4,'apns','com.pipong.test',$5,'active')",
          [
            credentialId,
            scope.organizationId,
            scope.projectId,
            scope.environmentId,
            encryptedSecret,
          ],
        );
        await fixture.database.query(
          'INSERT INTO app.tenant_budgets (organization_id,request_limit,pending_limit,fanout_limit) VALUES ($1,100000,1000000,1000000)',
          [scope.organizationId],
        );
        // eslint-disable-next-line no-await-in-loop -- Each endpoint generation is seeded in its required transaction.
        for (let index = 0; index < endpointCount; index++) {
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
                'apns',
                'com.pipong.test',
                installation,
                1,
                credentialId,
              ]),
            },
            JSON.stringify({ token: 'ab'.repeat(32), environment: 'sandbox' }),
          );
          // eslint-disable-next-line no-await-in-loop -- Seed immutable endpoint and generation atomically.
          await fixture.database.query('BEGIN');
          try {
            // eslint-disable-next-line no-await-in-loop -- Same endpoint transaction.
            await fixture.database.query(
              "INSERT INTO app.endpoints (id,organization_id,project_id,environment_id,recipient_id,installation_id,provider,app_id,generation,credential_id,target_hash) VALUES ($1,$2,$3,$4,$5,$6,'apns','com.pipong.test',1,$7,$8)",
              [
                endpointId,
                scope.organizationId,
                scope.projectId,
                scope.environmentId,
                scope.recipientId,
                installation,
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
      const providerPort = v.parse(v.object({ port: v.number() }), provider.address()).port;
      for (let index = 0; index < 2; index++) {
        children.push(
          // eslint-disable-next-line no-await-in-loop -- Track each started consumer before launching the next.
          await startFixtureProcess('apps/server/tests/fixtures/load-consumer.ts', {
            ...fixture.environment,
            QUALIFICATION_PROVIDER_ORIGIN: `https://127.0.0.1:${providerPort}`,
          }),
        );
      }
      const processes = new Map<number, string>([[fixture.processId, 'api']]);
      for (const [index, child] of children.entries()) {
        processes.set(child.processId, index === 0 ? 'api' : 'consumer');
      }
      const samplingDatabase = fixture.database;
      async function sampleResources(): Promise<void> {
        try {
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
      function path(scope: Scope): string {
        return `/api/v1/organizations/${scope.organizationId}/projects/${scope.projectId}/environments/${scope.environmentId}`;
      }
      async function submit(scope: Scope): Promise<{ status: number; milliseconds: number }> {
        const started = performance.now();
        return new Promise((resolve, reject) => {
          const request = httpsRequest(
            {
              hostname: '127.0.0.1',
              port,
              servername: 'push.test',
              ca: cert,
              path: `${path(scope)}/notifications`,
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
      const acceptance: number[] = [];
      const statuses: Record<string, number> = {};
      const pending: Promise<void>[] = [];
      const started = Date.now();
      let scheduleLagMs = 0;
      // eslint-disable-next-line no-await-in-loop -- Fixed arrival schedule keeps offered load independent of response latency.
      for (let index = 0; index < duration * 50; index++) {
        // eslint-disable-next-line no-await-in-loop -- Maintain 50 requests per second without serializing requests.
        await setTimeout(Math.max(0, started + index * 20 - Date.now()));
        scheduleLagMs = Math.max(scheduleLagMs, Date.now() - (started + index * 20));
        pending.push(
          submit(index % 50 === 0 ? quiet : noisy).then((result) => {
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
      const sseScopes: Scope[] = [];
      // oxlint-disable eslint/no-await-in-loop -- Setup each bounded environment before measuring connections.
      for (let index = 0; index < 20; index++) {
        sseScopes.push(await seed(`sse-${index}`, 1));
      }
      // oxlint-enable eslint/no-await-in-loop
      const streamStatuses: Record<string, number> = {};
      async function openStream(scope: Scope): Promise<IncomingMessage> {
        return new Promise((resolve, reject) => {
          const request = httpsRequest(
            {
              hostname: '127.0.0.1',
              port,
              servername: 'push.test',
              ca: cert,
              path: `${path(scope)}/events/stream`,
              headers: { cookie },
            },
            (response) => {
              response.on('error', () => {});
              streams.push(response);
              streamStatuses[response.statusCode ?? 0] =
                (streamStatuses[response.statusCode ?? 0] ?? 0) + 1;
              if (response.statusCode === 200) {
                liveStreams++;
                response.once('close', () => {
                  liveStreams--;
                });
                let receivedDelivery = false;
                response.on('data', (chunk: Buffer) => {
                  streamBytes += chunk.length;
                  if (!receivedDelivery && chunk.toString().includes('event: delivery')) {
                    receivedDelivery = true;
                    deliveredStreams++;
                  }
                });
              }
              response.resume();
              resolve(response);
            },
          );
          request.on('error', reject);
          request.setTimeout(30000, () => {
            request.destroy(new Error('QUALIFICATION_SSE_TIMEOUT'));
          });
          request.end();
        });
      }
      const opened: IncomingMessage[] = [];
      let streamErrors = 0;
      // oxlint-disable eslint/no-await-in-loop -- Ramp connections in bounded batches instead of exhausting the local listener backlog.
      for (let batch = 0; batch < 20; batch++) {
        const responses = await Promise.allSettled(
          Array.from({ length: 50 }, (_, index) =>
            openStream(sseScopes[(batch * 50 + index) % sseScopes.length] ?? noisy),
          ),
        );
        for (const response of responses) {
          if (response.status === 'fulfilled') {
            opened.push(response.value);
          } else {
            streamErrors++;
          }
        }
      }
      // oxlint-enable eslint/no-await-in-loop
      const sseAcceptance: number[] = [];
      const sseStatuses: Record<string, number> = {};
      const sseRequests: Promise<void>[] = [];
      const streamLoadStarted = Date.now();
      let streamScheduleLagMs = 0;
      // oxlint-disable eslint/no-await-in-loop -- Hold 1000 streams under fixed-rate acceptance and delivery for 30 seconds.
      for (let index = 0; index < 1500; index++) {
        await setTimeout(Math.max(0, streamLoadStarted + index * 20 - Date.now()));
        streamScheduleLagMs = Math.max(
          streamScheduleLagMs,
          Date.now() - (streamLoadStarted + index * 20),
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
      const liveAfterLoad = liveStreams;
      const revoked: Promise<void>[] = [];
      for (const stream of opened) {
        if (stream.statusCode === 200) {
          revoked.push(
            new Promise<void>((resolve) => {
              stream.once('end', resolve);
              stream.once('close', resolve);
            }),
          );
        }
      }
      await fixture.database.query(
        'DELETE FROM auth.members WHERE organization_id = ANY($1::uuid[])',
        [sseScopes.map((scope) => scope.organizationId)],
      );
      const revokedInWindow = await Promise.race([
        Promise.all(revoked).then(() => true),
        setTimeout(7000).then(() => false),
      ]);
      const reconnect = await openStream(sseScopes[0] ?? noisy);

      const dispatch = await fixture.database.query<{
        organization_id: string;
        count: number;
        p95: number;
      }>(
        `SELECT deliveries.organization_id,count(*)::int AS count,percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM delivery_attempts.started_at-notifications.accepted_at)*1000) AS p95 FROM app.delivery_attempts JOIN app.deliveries ON deliveries.id=delivery_attempts.delivery_id JOIN app.notifications ON notifications.id=deliveries.notification_id GROUP BY deliveries.organization_id`,
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
      const backendRuntime = await readFixtureRuntime();
      const report = {
        durationSeconds: duration,
        offeredDurationMs,
        scheduleLagMs,
        offeredRequests: duration * 50,
        statuses,
        acceptanceP95Ms: percentile(acceptance, 0.95),
        bulk: { ...bulkResult, burstDrainMs, unfinished },
        providerRequests,
        completedDeliveries: completed.rows[0]?.count,
        resources: {
          processes: [...peakResources.values()],
          cpuMetric: 'maximum sampled ps lifetime-average percent',
          databaseWaitSamples,
          samplingFailures,
          cgroup,
        },
        sse: {
          offered: 1000,
          holdSeconds: 30,
          offeredDurationMs: streamOfferedDurationMs,
          scheduleLagMs: streamScheduleLagMs,
          liveAfterLoad,
          deliveredStreams,
          bytes: streamBytes,
          concurrentRequests: 1500,
          acceptanceStatuses: sseStatuses,
          acceptanceP95Ms: percentile(sseAcceptance, 0.95),
          environments: 20,
          statuses: streamStatuses,
          streamErrors,
          revokedInWindow,
          reconnectStatus: reconnect.statusCode,
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
          consumers: 2,
          retainedJobs,
          environments: 3,
          database: 'PostgreSQL 18',
          provider: 'local TLS HTTP/2 APNs fixture',
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
      expect.soft(peakResources.size).toBe(4);
      expect.soft(completed.rows[0]?.count).toBe(duration * 100 + 1000 + 1500);
      expect.soft(providerRequests).toBe(duration * 100 + 1000 + 1500);
      expect.soft(liveAfterLoad).toBe(1000);
      expect.soft(deliveredStreams).toBe(1000);
      expect.soft(sseAcceptance.length).toBe(1500);
      expect.soft(percentile(sseAcceptance, 0.95)).toBeLessThanOrEqual(250);
      expect.soft(acceptance.length).toBe(duration * 50);
      expect.soft(percentile(acceptance, 0.95)).toBeLessThanOrEqual(250);
      expect.soft(bulkResult.status).toBe(202);
      expect.soft(unfinished).toBe(0);
      expect
        .soft(dispatch.rows.find((row) => row.organization_id === quiet.organizationId)?.p95)
        .toBeLessThanOrEqual(2000);
      expect
        .soft(dispatch.rows.find((row) => row.organization_id === noisy.organizationId)?.p95)
        .toBeLessThanOrEqual(2000);
      expect.soft(streamStatuses['200']).toBe(1000);
      expect.soft(streamErrors).toBe(0);
      expect.soft(revokedInWindow).toBe(true);
      expect.soft(reconnect.statusCode).toBe(404);
    } finally {
      clearInterval(sampleTimer);
      await sampling;
      for (const stream of streams) {
        stream.destroy();
      }
      await Promise.all(children.map((child) => child.stop()));
      proxy.closeAllConnections();
      proxy.close();
      provider.close();
      await fixture?.close();
    }
  },
  (duration + 180) * 1000,
);
