import type { SecretContext } from '../src/secrets.ts';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { v7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, loadSecretKeyring } from '../src/secrets.ts';

const testUrl = process.env.TEST_DELIVERY_DATABASE_URL;
const runCommand = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));

describe.skipIf(!testUrl)('release restore rehearsal on disposable PostgreSQL', () => {
  it('restores credential ciphertext, ownership, migrations, and separately backed-up keys', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pipong-restore-'));
    const sourceName = `pipong_backup_${process.pid}`;
    const restoredName = `pipong_restored_${process.pid}`;
    const admin = new Client({ connectionString: testUrl });
    const context: SecretContext = {
      organizationId: v7(),
      projectId: v7(),
      environmentId: v7(),
      resourceId: v7(),
      purpose: 'credential',
      binding: 'apns:app',
    };
    function databaseUrl(database: string, role: string): string {
      const url = new URL(testUrl ?? 'postgres://postgres@localhost/postgres');
      url.pathname = `/${database}`;
      url.username = role;
      url.password = '';
      return url.href;
    }
    const source = new Client({ connectionString: databaseUrl(sourceName, 'postgres') });
    const restored = new Client({ connectionString: databaseUrl(restoredName, 'postgres') });
    const api = new Client({ connectionString: databaseUrl(restoredName, 'pipong_api') });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE ${sourceName}`);
      await admin.query(`CREATE DATABASE ${restoredName}`);
      await source.connect();
      const provision = await readFile(
        new URL('../../database/provision.sql', import.meta.url),
        'utf8',
      );
      await source.query(provision.replaceAll(':"DBNAME"', `"${sourceName}"`));
      await admin.query(`REVOKE CREATE, TEMPORARY ON DATABASE ${restoredName} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT, CREATE ON DATABASE ${restoredName} TO pipong_migrator`);
      await admin.query(`GRANT CONNECT ON DATABASE ${restoredName} TO pipong_api, pipong_worker`);
      await runCommand('pnpm', ['migrate'], {
        cwd: root,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          MIGRATION_DATABASE_URL: databaseUrl(sourceName, 'pipong_migrator'),
        },
      });
      const keyPath = join(directory, 'keyring.json');
      await writeFile(
        keyPath,
        JSON.stringify({
          activeKeyId: 'backup',
          keys: { backup: randomBytes(32).toString('hex') },
        }),
        { mode: 0o600 },
      );
      const keyring = await loadSecretKeyring(keyPath);
      const encrypted = encryptSecret(keyring, context, 'restore-fixture-private-key');
      await source.query(
        "INSERT INTO auth.organizations (id,name,slug) VALUES ($1,'Restore','restore')",
        [context.organizationId],
      );
      await source.query(
        "INSERT INTO app.projects (id,organization_id,name) VALUES ($1,$2,'Project')",
        [context.projectId, context.organizationId],
      );
      await source.query(
        "INSERT INTO app.environments (id,organization_id,project_id,name) VALUES ($1,$2,$3,'Environment')",
        [context.environmentId, context.organizationId, context.projectId],
      );
      await source.query(
        "INSERT INTO app.credential_versions (id,organization_id,project_id,environment_id,provider,app_id,encrypted_secret,state) VALUES ($1,$2,$3,$4,'apns','app',$5,'active')",
        [
          context.resourceId,
          context.organizationId,
          context.projectId,
          context.environmentId,
          encrypted,
        ],
      );
      const dumpPath = join(directory, 'database.dump');
      await runCommand('pg_dump', [
        '--dbname',
        databaseUrl(sourceName, 'postgres'),
        '--format=custom',
        '--file',
        dumpPath,
      ]);
      const backupKeyPath = join(directory, 'backup-keyring.json');
      await copyFile(keyPath, backupKeyPath);
      await rm(keyPath);
      await source.query('DELETE FROM app.credential_versions');
      const started = performance.now();
      await runCommand('pg_restore', [
        '--dbname',
        databaseUrl(restoredName, 'postgres'),
        '--exit-on-error',
        dumpPath,
      ]);
      await runCommand('pnpm', ['migrate'], {
        cwd: root,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          MIGRATION_DATABASE_URL: databaseUrl(restoredName, 'pipong_migrator'),
        },
      });
      await restored.connect();
      const result = await restored.query<{ encrypted_secret: string }>(
        'SELECT encrypted_secret FROM app.credential_versions WHERE id=$1',
        [context.resourceId],
      );
      const value = result.rows[0]?.encrypted_secret;
      expect(value).toBe(encrypted);
      if (!value) {
        throw new Error('TEST_RESTORED_CREDENTIAL_MISSING');
      }
      expect(() =>
        decryptSecret({ activeKeyId: 'backup', keys: new Map() }, context, value),
      ).toThrow('CREDENTIAL_KEY_UNAVAILABLE');
      expect(decryptSecret(await loadSecretKeyring(backupKeyPath), context, value)).toBe(
        'restore-fixture-private-key',
      );
      expect(() => decryptSecret(keyring, { ...context, organizationId: v7() }, value)).toThrow(
        'CREDENTIAL_DECRYPT_FAILED',
      );
      await api.connect();
      expect((await api.query('SELECT id FROM app.credential_versions')).rows).toEqual([]);
      await expect(api.query('CREATE TABLE app.restore_probe (id text)')).rejects.toThrow();
      console.info(
        `Restore fixture completed in ${Math.round(performance.now() - started)} ms; capacity and production RTO are unqualified`,
      );
    } finally {
      try {
        await Promise.all([source.end(), restored.end(), api.end()]);
        await admin.query(`DROP DATABASE IF EXISTS ${sourceName} WITH (FORCE)`);
        await admin.query(`DROP DATABASE IF EXISTS ${restoredName} WITH (FORCE)`);
        await admin.query('DROP ROLE IF EXISTS pipong_api, pipong_worker, pipong_migrator');
      } finally {
        await admin.end();
        await rm(directory, { recursive: true, force: true });
      }
    }
  }, 60_000);
});
