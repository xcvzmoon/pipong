import type { ChildProcess } from 'node:child_process';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as v from 'valibot';

export type FixtureProcess = {
  processId: number;
  child: ChildProcess;
  stop: () => Promise<void>;
  logs: () => string;
};
type FixtureRuntime = { runtime: string; platform: string; architecture: string };
type CgroupFile =
  | 'cpu.max'
  | 'cpu.stat'
  | 'cpuset.cpus.effective'
  | 'memory.max'
  | 'memory.peak'
  | 'memory.swap.max';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const runCommand = promisify(execFile);
const remoteVariables = [
  'NODE_ENV',
  'CI',
  'TEST',
  'PORT',
  'HOST',
  'AUTH_BASE_URL',
  'AUTH_SECRET',
  'CREDENTIAL_KEYRING_REF',
  'API_DATABASE_URL',
  'WORKER_DATABASE_URL',
  'API_DATABASE_MAX_POOL',
  'WORKER_DATABASE_MAX_POOL',
  'QUALIFICATION_PROVIDER_ORIGIN',
];
const bootstrap = `
  import { writeFile } from 'node:fs/promises';
  import { pathToFileURL } from 'node:url';
  import * as v from 'valibot';
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 65536) { throw new Error('QUALIFICATION_PROCESS_INPUT_TOO_LARGE'); }
  }
  const configuration = v.parse(v.object({
    entrypoint: v.string(),
    environment: v.record(v.string(), v.string()),
    pidPath: v.string(),
  }), JSON.parse(input));
  Object.assign(process.env, configuration.environment);
  await writeFile(configuration.pidPath, String(process.pid), { mode: 0o600 });
  process.stdout.write('__PIPONG_PID__:' + process.pid + '\\n');
  await import(pathToFileURL('/workspace/' + configuration.entrypoint).href);
`;

export async function startFixtureProcess(
  entrypoint: string,
  environment: NodeJS.ProcessEnv,
): Promise<FixtureProcess> {
  const container = process.env.QUALIFICATION_CONTAINER;
  const pidPath = `/tmp/pipong-process-${randomUUID()}.pid`;
  let remoteEnvironment: Record<string, string> | undefined;
  if (container) {
    remoteEnvironment = {};
    for (const name of remoteVariables) {
      const value = environment[name];
      if (value !== undefined) {
        remoteEnvironment[name] = value;
      }
    }
    for (const name of ['API_DATABASE_URL', 'WORKER_DATABASE_URL']) {
      const value = remoteEnvironment[name];
      if (value) {
        const url = new URL(value);
        url.hostname = '127.0.0.1';
        url.port = '5432';
        remoteEnvironment[name] = url.href;
      }
    }
    remoteEnvironment.HOST = '0.0.0.0';
    const firstPort = new URL(v.parse(v.string(), process.env.QUALIFICATION_API_URL_1)).port;
    remoteEnvironment.PORT = environment.PORT === firstPort ? '3000' : '3001';
    const providerOrigin = remoteEnvironment.QUALIFICATION_PROVIDER_ORIGIN;
    if (providerOrigin) {
      const url = new URL(providerOrigin);
      url.hostname = 'host.docker.internal';
      remoteEnvironment.QUALIFICATION_PROVIDER_ORIGIN = url.href;
    }
    const keyring = v.parse(v.string(), environment.CREDENTIAL_KEYRING_REF);
    const remoteKeyring = `/tmp/pipong-keyring-${randomUUID()}.json`;
    await runCommand('docker', ['cp', keyring, `${container}:${remoteKeyring}`]);
    try {
      await runCommand('docker', [
        'exec',
        '--user',
        'root',
        container,
        'chown',
        'postgres:postgres',
        remoteKeyring,
      ]);
      await runCommand('docker', [
        'exec',
        '--user',
        'root',
        container,
        'chmod',
        '600',
        remoteKeyring,
      ]);
    } catch (error) {
      await runCommand('docker', ['exec', '--user', 'root', container, 'rm', remoteKeyring]);
      throw error;
    }
    remoteEnvironment.CREDENTIAL_KEYRING_REF = remoteKeyring;
  }
  const child = container
    ? spawn(
        'docker',
        [
          'exec',
          '-i',
          '--workdir',
          '/workspace/apps/server',
          container,
          'node',
          '--input-type=module',
          '-e',
          bootstrap,
        ],
        {
          cwd: root,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      )
    : spawn(process.execPath, [entrypoint], {
        cwd: root,
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
  let logs = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    logs = (logs + chunk.toString()).slice(-4000);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    logs = (logs + chunk.toString()).slice(-4000);
  });
  let processId = child.pid;
  if (container) {
    try {
      processId = await new Promise<number>((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`QUALIFICATION_PROCESS_START_TIMEOUT: ${logs}`));
        }, 10000);
        function cleanup(): void {
          clearTimeout(timer);
          child.stdout?.removeListener('data', receive);
          child.removeListener('error', fail);
          child.removeListener('exit', exited);
        }
        function receive(chunk: Buffer): void {
          output += chunk.toString();
          const match = output.match(/__PIPONG_PID__:(\d+)\n/);
          if (match) {
            cleanup();
            resolve(
              v.parse(v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(1)), match[1]),
            );
          }
        }
        function fail(error: Error): void {
          cleanup();
          reject(error);
        }
        function exited(): void {
          cleanup();
          reject(new Error(`QUALIFICATION_PROCESS_START_FAILED: ${logs}`));
        }
        child.stdout?.on('data', receive);
        child.once('error', fail);
        child.once('exit', exited);
        child.stdin?.end(JSON.stringify({ entrypoint, environment: remoteEnvironment, pidPath }));
      });
    } catch (error) {
      try {
        await runCommand(
          'docker',
          [
            'exec',
            container,
            'node',
            '-e',
            `
          const fs = require('node:fs');
          try { process.kill(Number(fs.readFileSync(process.argv[1], 'utf8')), 'SIGKILL'); }
          catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ESRCH') { throw error; } }
        `,
            pidPath,
          ],
          { timeout: 10000 },
        );
      } finally {
        child.kill('SIGKILL');
        await cleanupRemoteFiles();
      }
      throw error;
    }
  }
  const pid = v.parse(v.pipe(v.number(), v.integer(), v.minValue(1)), processId);
  async function cleanupRemoteFiles(): Promise<void> {
    if (container && remoteEnvironment) {
      await runCommand(
        'docker',
        [
          'exec',
          container,
          'node',
          '-e',
          `
        const fs = require('node:fs');
        for (const path of process.argv.slice(1)) { fs.rmSync(path, { force: true }); }
      `,
          remoteEnvironment.CREDENTIAL_KEYRING_REF ?? pidPath,
          pidPath,
        ],
        { timeout: 10000 },
      );
    }
  }
  async function signalRemote(signal: 'SIGTERM' | 'SIGKILL'): Promise<void> {
    if (container) {
      await runCommand(
        'docker',
        [
          'exec',
          container,
          'node',
          '-e',
          `
        try { process.kill(Number(process.argv[1]), process.argv[2]); }
        catch (error) { if (error.code !== 'ESRCH') { throw error; } }
      `,
          String(pid),
          signal,
        ],
        { timeout: 10000 },
      );
    }
  }
  async function stop(): Promise<void> {
    try {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      const exited = once(child, 'exit');
      if (container) {
        await signalRemote('SIGTERM');
      } else {
        child.kill('SIGTERM');
      }
      const timer = setTimeout(() => {
        if (container) {
          void signalRemote('SIGKILL').catch(() => {
            child.kill('SIGKILL');
          });
        } else {
          child.kill('SIGKILL');
        }
      }, 10000);
      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
    } finally {
      await cleanupRemoteFiles();
    }
  }

  return { processId: pid, child, stop, logs: () => logs };
}

export async function sampleFixtureProcesses(processIds: number[]): Promise<string> {
  const commandArguments = ['-p', processIds.join(','), '-o', 'pid=,rss=,pcpu='];
  const container = process.env.QUALIFICATION_CONTAINER;
  const result = container
    ? await runCommand('docker', ['exec', container, 'ps', ...commandArguments])
    : await runCommand('ps', commandArguments);
  return result.stdout;
}

export async function readQualificationCgroupFile(name: CgroupFile): Promise<string> {
  const path = `/sys/fs/cgroup/${name}`;
  const container = process.env.QUALIFICATION_CONTAINER;
  if (container) {
    return (await runCommand('docker', ['exec', container, 'cat', path])).stdout;
  }
  return readFile(path, 'utf8');
}

export async function readFixtureRuntime(): Promise<FixtureRuntime> {
  const container = process.env.QUALIFICATION_CONTAINER;
  if (!container) {
    return { runtime: process.version, platform: process.platform, architecture: process.arch };
  }
  const result = await runCommand('docker', [
    'exec',
    container,
    'node',
    '-e',
    'process.stdout.write(JSON.stringify({runtime:process.version,platform:process.platform,architecture:process.arch}))',
  ]);
  return v.parse(
    v.object({ runtime: v.string(), platform: v.string(), architecture: v.string() }),
    JSON.parse(result.stdout),
  );
}
