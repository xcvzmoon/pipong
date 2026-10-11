import type { ChildProcess } from 'node:child_process';
import type { FixtureProcess } from './backend-process.ts';
import { hashPassword } from 'better-auth/crypto';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from 'pg';
import * as v from 'valibot';
import { startFixtureProcess } from './backend-process.ts';

const runCommand = promisify(execFile);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const databaseName = `pipong_auth_test_${process.pid}`;

export async function freePort(): Promise<number> {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  const port = v.parse(v.object({ port: v.number() }), address).port;
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => {
      if (error) reject(error);
      else resolve();
    }),
  );
  return port;
}

export async function stopProcess(child: ChildProcess | undefined): Promise<void> {
  if (child?.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timeout = globalThis.setTimeout(() => child.kill('SIGKILL'), 10_000);
  try {
    await exited;
  } finally {
    clearTimeout(timeout);
  }
}

export type AuthFixture = {
  database: Client;
  processId: number;
  baseUrl: string;
  environment: NodeJS.ProcessEnv;
  close: () => Promise<void>;
  logs: () => string;
  stopServer: () => Promise<void>;
};

export async function startAuthFixture(
  adminUrl: string,
  seedAccounts = true,
  serverEntrypoint = 'apps/server/.output/server/index.mjs',
): Promise<AuthFixture> {
  const secretDirectory = await mkdtemp(join(tmpdir(), 'pipong-credentials-'));
  const keyringPath = join(secretDirectory, 'keyring.json');
  const admin = new Client({ connectionString: adminUrl });
  try {
    await admin.connect();
  } catch (error) {
    await rm(secretDirectory, { recursive: true, force: true });
    throw error;
  }
  function roleUrl(role: string): string {
    const url = new URL(adminUrl);
    url.pathname = `/${databaseName}`;
    url.username = role;
    url.password = '';
    return url.href;
  }
  const database = new Client({ connectionString: roleUrl('postgres') });
  let server: FixtureProcess | undefined;
  let createdDatabase = false;
  let createdRoles = false;
  async function close(): Promise<void> {
    try {
      await server?.stop();
    } finally {
      await database.end();
      if (createdDatabase) await admin.query(`DROP DATABASE ${databaseName} WITH (FORCE)`);
      if (createdRoles) await admin.query('DROP ROLE pipong_api, pipong_worker, pipong_migrator');
      await admin.end();
      await rm(secretDirectory, { recursive: true, force: true });
    }
  }
  try {
    await writeFile(
      keyringPath,
      JSON.stringify({ activeKeyId: 'first', keys: { first: '11'.repeat(32) } }),
      { mode: 0o600 },
    );
    await admin.query(`CREATE DATABASE ${databaseName}`);
    createdDatabase = true;
    await database.connect();
    const provision = await readFile(`${root}/packages/database/provision.sql`, 'utf8');
    await database.query(provision.replaceAll(':"DBNAME"', `"${databaseName}"`));
    createdRoles = true;
    await runCommand('pnpm', ['migrate'], {
      cwd: root,
      env: { ...process.env, MIGRATION_DATABASE_URL: roleUrl('pipong_migrator'), NODE_ENV: 'test' },
    });
    if (seedAccounts) {
      const password = await hashPassword('test-password-long-enough');
      await database.query(`INSERT INTO auth."users" (id,name,email,email_verified) VALUES
      ('019a0000-0000-7000-8000-000000000011','Verified <person>','verified@example.com',true),
      ('019a0000-0000-7000-8000-000000000012','Unverified','unverified@example.com',false)`);
      await database.query(
        `INSERT INTO auth.accounts (id,account_id,provider_id,user_id,password,updated_at)
      VALUES ('019a0000-0000-7000-8000-000000000011','019a0000-0000-7000-8000-000000000011','credential','019a0000-0000-7000-8000-000000000011',$1,now()),
             ('019a0000-0000-7000-8000-000000000012','019a0000-0000-7000-8000-000000000012','credential','019a0000-0000-7000-8000-000000000012',$1,now())`,
        [password],
      );
    }
    const qualificationUrl = v.parse(
      v.optional(v.pipe(v.string(), v.url())),
      process.env.QUALIFICATION_API_URL_1,
    );
    const port = qualificationUrl ? Number(new URL(qualificationUrl).port) : await freePort();
    const baseUrl = qualificationUrl ?? `http://localhost:${port}`;
    const environment = {
      ...process.env,
      NODE_ENV: 'test',
      CI: '',
      TEST: '',
      PORT: String(port),
      HOST: '127.0.0.1',
      AUTH_BASE_URL: baseUrl,
      AUTH_SECRET: 'test-auth-secret-at-least-thirty-two-characters',
      CREDENTIAL_KEYRING_REF: keyringPath,
      API_DATABASE_URL: roleUrl('pipong_api'),
      WORKER_DATABASE_URL: roleUrl('pipong_worker'),
      API_DATABASE_MAX_POOL: '2',
      WORKER_DATABASE_MAX_POOL: '2',
    };
    server = await startFixtureProcess(serverEntrypoint, environment);
    // oxlint-disable eslint/no-await-in-loop -- Wait between startup probes and stop as soon as the server is ready.
    for (let index = 0; index < 100; index++) {
      if (server.child.exitCode !== null) {
        throw new Error(`TEST_SERVER_STARTUP_FAILED: ${server.logs()}`);
      }
      try {
        const response = await fetch(`${baseUrl}/api/auth/get-session`);
        if (response.status === 200) {
          return {
            database,
            processId: server.processId,
            baseUrl,
            environment,
            close,
            logs: server.logs,
            stopServer: server.stop,
          };
        }
        if (response.status >= 500) throw new Error('TEST_SERVER_RESPONSE_FAILED');
      } catch {}
      await setTimeout(100);
    }
    // oxlint-enable eslint/no-await-in-loop
    throw new Error(`TEST_SERVER_TIMEOUT: ${server.logs()}`);
  } catch (error) {
    await close();
    throw error;
  }
}

export function startWorker(environment: NodeJS.ProcessEnv): ChildProcess {
  const worker = spawn(process.execPath, ['apps/worker/dist/index.mjs'], {
    cwd: root,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout?.resume();
  worker.stderr?.resume();
  return worker;
}
