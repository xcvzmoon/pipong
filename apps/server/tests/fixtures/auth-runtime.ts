import type { ChildProcess } from 'node:child_process';
import { hashPassword } from 'better-auth/crypto';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from 'pg';
import * as v from 'valibot';

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
  if (child?.exitCode !== null) return;
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
  baseUrl: string;
  environment: NodeJS.ProcessEnv;
  close: () => Promise<void>;
};

export async function startAuthFixture(
  adminUrl: string,
  seedAccounts = true,
  serverEntrypoint = 'apps/server/.output/server/index.mjs',
): Promise<AuthFixture> {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  function roleUrl(role: string): string {
    const url = new URL(adminUrl);
    url.pathname = `/${databaseName}`;
    url.username = role;
    url.password = '';
    return url.href;
  }
  const database = new Client({ connectionString: roleUrl('postgres') });
  let server: ChildProcess | undefined;
  let createdDatabase = false;
  let createdRoles = false;
  async function close(): Promise<void> {
    try {
      await stopProcess(server);
    } finally {
      await database.end();
      if (createdDatabase) await admin.query(`DROP DATABASE ${databaseName} WITH (FORCE)`);
      if (createdRoles) await admin.query('DROP ROLE pipong_api, pipong_worker, pipong_migrator');
      await admin.end();
    }
  }
  try {
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
    const port = await freePort();
    const baseUrl = `http://localhost:${port}`;
    const environment = {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      HOST: '127.0.0.1',
      AUTH_BASE_URL: baseUrl,
      AUTH_SECRET: 'test-auth-secret-at-least-thirty-two-characters',
      CREDENTIAL_KEYRING_REF: 'test://credentials',
      API_DATABASE_URL: roleUrl('pipong_api'),
      WORKER_DATABASE_URL: roleUrl('pipong_worker'),
      API_DATABASE_MAX_POOL: '2',
      WORKER_DATABASE_MAX_POOL: '2',
    };
    server = spawn(process.execPath, [serverEntrypoint], {
      cwd: root,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '';
    server.stdout?.on('data', (chunk: Buffer) => {
      logs = (logs + chunk.toString()).slice(-4000);
    });
    server.stderr?.on('data', (chunk: Buffer) => {
      logs = (logs + chunk.toString()).slice(-4000);
    });
    // oxlint-disable eslint/no-await-in-loop -- Wait between startup probes and stop as soon as the server is ready.
    for (let index = 0; index < 100; index++) {
      if (server.exitCode !== null) throw new Error(`TEST_SERVER_STARTUP_FAILED: ${logs}`);
      try {
        const response = await fetch(`${baseUrl}/api/auth/get-session`);
        if (response.status === 200) return { database, baseUrl, environment, close };
        if (response.status >= 500) throw new Error('TEST_SERVER_RESPONSE_FAILED');
      } catch {
        /* Server has not bound its port yet. */
      }
      await setTimeout(100);
    }
    // oxlint-enable eslint/no-await-in-loop
    throw new Error(`TEST_SERVER_TIMEOUT: ${logs}`);
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
