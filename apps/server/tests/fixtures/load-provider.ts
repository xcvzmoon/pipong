import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as v from 'valibot';

const runCommand = promisify(execFile);
const statsSchema = v.object({
  providerCounts: v.object({ apns: v.number(), fcm: v.number(), 'web-push': v.number() }),
  providerErrors: v.number(),
  oauthRequests: v.number(),
  sustainedOauthRefreshes: v.number(),
});
type ProviderStats = v.InferOutput<typeof statsSchema>;
type QualificationProvider = {
  apnsOrigin: string;
  fcmOrigin: string;
  webPushOrigin: string;
  startTraffic: (seconds: number) => Promise<void>;
  stats: () => Promise<ProviderStats>;
  close: () => Promise<void>;
};

export async function startQualificationProvider(): Promise<QualificationProvider> {
  const backend = v.parse(v.string(), process.env.QUALIFICATION_CONTAINER);
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const name = `pipong-provider-${randomUUID()}`;
  await runCommand('docker', [
    'run',
    '--detach',
    '--name',
    name,
    '--label',
    `pipong.qualification.backend=${backend}`,
    '--network',
    `container:${backend}`,
    '--cpus',
    '1',
    '--cpuset-cpus',
    '2',
    '--memory',
    '256m',
    '--memory-swap',
    '256m',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--user',
    'node',
    '--volume',
    `${root}:/workspace:ro`,
    'node:24-bookworm-slim',
    'node',
    '/workspace/apps/server/tests/fixtures/load-provider-server.ts',
  ]);
  async function close(): Promise<void> {
    try {
      await runCommand('docker', ['stop', '--time', '5', name]).catch(() => undefined);
    } finally {
      await runCommand('docker', ['rm', '--force', name]).catch(() => undefined);
    }
  }
  async function stats(): Promise<ProviderStats> {
    const result = await runCommand(
      'docker',
      [
        'exec',
        name,
        'node',
        '-e',
        "fetch('http://127.0.0.1:3042/stats').then(r=>r.text()).then(t=>process.stdout.write(t))",
      ],
      { timeout: 5000 },
    );
    return v.parse(statsSchema, JSON.parse(result.stdout));
  }
  try {
    let ready = false;
    for (let index = 0; index < 20; index++) {
      try {
        // eslint-disable-next-line no-await-in-loop -- The provider must be listening before workers connect.
        await stats();
        ready = true;
        break;
      } catch {
        // eslint-disable-next-line no-await-in-loop -- Bound provider startup probes.
        await setTimeout(250);
      }
    }
    if (!ready) {
      const logs = await runCommand('docker', ['logs', name]);
      throw new Error(`QUALIFICATION_PROVIDER_START_FAILED: ${logs.stdout}${logs.stderr}`);
    }
    return {
      apnsOrigin: 'https://127.0.0.1:3040',
      fcmOrigin: 'http://127.0.0.1:3042',
      webPushOrigin: 'https://push.test:3041',
      stats,
      startTraffic: async (seconds) => {
        await runCommand(
          'docker',
          [
            'exec',
            name,
            'node',
            '-e',
            "fetch('http://127.0.0.1:3042/start',{method:'POST',body:process.argv[1]}).then(r=>{if(!r.ok)throw new Error('QUALIFICATION_PROVIDER_START_REJECTED')})",
            String(seconds),
          ],
          { timeout: 5000 },
        );
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
