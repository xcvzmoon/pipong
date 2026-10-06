import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const runCommand = promisify(execFile);
const baseEnv = {
  NODE_ENV: 'test',
  API_DATABASE_URL: 'postgres://pipong_api@localhost/pipong',
  WORKER_DATABASE_URL: 'postgres://pipong_worker@localhost/pipong',
  API_DATABASE_MAX_POOL: '8',
  WORKER_DATABASE_MAX_POOL: '12',
  API_DATABASE_CONNECTION_TIMEOUT: '5000',
  WORKER_DATABASE_CONNECTION_TIMEOUT: '5000',
  API_DATABASE_IDLE_TIMEOUT: '30000',
  WORKER_DATABASE_IDLE_TIMEOUT: '30000',
  API_DATABASE_APPLICATION_NAME: 'pipong_api',
  WORKER_DATABASE_APPLICATION_NAME: 'pipong_worker',
  API_DATABASE_USE_QUERY_LOGGER: 'false',
  WORKER_DATABASE_USE_QUERY_LOGGER: 'false',
};

async function readEnv(overrides: NodeJS.ProcessEnv, body: string): Promise<void> {
  const script = `import assert from 'node:assert/strict'; const { env } = await import(${JSON.stringify(new URL('../src/env.ts', import.meta.url).href)}); ${body}`;
  await runCommand(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, ...baseEnv, ...overrides },
  });
}

describe('nested database environment', () => {
  it('loads migration settings without runtime URLs', async () => {
    await readEnv(
      {
        API_DATABASE_URL: undefined,
        WORKER_DATABASE_URL: undefined,
        MIGRATION_DATABASE_URL: 'postgres://pipong_migrator@localhost/pipong',
      },
      `assert.equal(env.migration.database.url, 'postgres://pipong_migrator@localhost/pipong');`,
    );
  });

  it('requires only the selected runtime URL before opening a pool', async () => {
    await readEnv(
      {
        API_DATABASE_URL: undefined,
        WORKER_DATABASE_URL: undefined,
        MIGRATION_DATABASE_URL: undefined,
      },
      `
      const { useApiDb, useWorkerDb } = await import(${JSON.stringify(new URL('../src/clients.ts', import.meta.url).href)});
      await assert.rejects(useApiDb(), /DATABASE_CONFIG_INVALID: missing API_DATABASE_URL/);
      await assert.rejects(useWorkerDb(), /DATABASE_CONFIG_INVALID: missing WORKER_DATABASE_URL/);
      `,
    );
  });

  it('loads independent settings and logger flags', async () => {
    await readEnv(
      {
        API_DATABASE_MAX_POOL: '4',
        API_DATABASE_USE_QUERY_LOGGER: 'true',
        WORKER_DATABASE_IDLE_TIMEOUT: '9000',
      },
      `
      assert.equal(env.node.env, 'test');
      assert.equal(env.api.database.maxPool, 4);
      assert.equal(env.api.database.useQueryLogger, true);
      assert.equal(env.worker.database.useQueryLogger, false);
      assert.equal(env.worker.database.idleTimeout, 9000);
    `,
    );
  });

  it.each([
    ['API_DATABASE_URL', 'https://localhost'],
    ['MIGRATION_DATABASE_URL', 'https://localhost'],
    ['API_DATABASE_MAX_POOL', '0'],
    ['WORKER_DATABASE_MAX_POOL', '101'],
    ['API_DATABASE_CONNECTION_TIMEOUT', '0'],
    ['WORKER_DATABASE_IDLE_TIMEOUT', '-1'],
    ['API_DATABASE_APPLICATION_NAME', ''],
    ['WORKER_DATABASE_USE_QUERY_LOGGER', 'invalid'],
    ['NODE_ENV', 'invalid'],
  ])('rejects invalid %s', async (variable, value) => {
    await expect(readEnv({ [variable]: value }, '')).rejects.toThrow();
  });

  it('requires remote TLS for both production connections', async () => {
    await expect(readEnv({ NODE_ENV: 'production' }, '')).rejects.toThrow(
      'DATABASE_CONFIG_INVALID',
    );
    await readEnv(
      {
        NODE_ENV: 'production',
        API_DATABASE_URL: 'postgres://pipong_api@db.example/pipong?sslmode=verify-full',
        WORKER_DATABASE_URL: 'postgres://pipong_worker@db.example/pipong?sslmode=require',
      },
      '',
    );
  });
});
