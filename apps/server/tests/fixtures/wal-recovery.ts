import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { freePort } from './auth-runtime.ts';

const runCommand = promisify(execFile);

export type WalRecovery = {
  sourceUrl: string;
  restoredPort: number;
  backup: () => Promise<void>;
  target: () => Promise<number>;
  restore: () => Promise<void>;
  close: () => Promise<void>;
};

export async function startWalRecovery(): Promise<WalRecovery> {
  const { stdout } = await runCommand('postgres', ['--version']);
  if (!stdout.includes(' 18.')) {
    throw new Error('WAL_RECOVERY_REQUIRES_POSTGRESQL_18');
  }
  const directory = await mkdtemp(join(tmpdir(), 'pipong-app-wal-'));
  const source = join(directory, 'source');
  const restored = join(directory, 'restored');
  const archive = join(directory, 'archive');
  const sourcePort = await freePort();
  const restoredPort = await freePort();
  const sourceUrl = `postgres://postgres@127.0.0.1:${sourcePort}/postgres`;
  const admin = new Client({ connectionString: sourceUrl });

  async function close(): Promise<void> {
    await admin.end();
    for (const data of [restored, source]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Stop both disposable clusters before removing their data.
      await runCommand('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']).catch(() => {});
    }
    await rm(directory, { recursive: true, force: true });
  }

  try {
    await mkdir(archive);
    await runCommand('initdb', [
      '-D',
      source,
      '-U',
      'postgres',
      '--encoding=UTF8',
      '--locale=C',
      '--auth=trust',
    ]);
    const config = await readFile(join(source, 'postgresql.conf'), 'utf8');
    await writeFile(
      join(source, 'postgresql.conf'),
      `${config}\nlisten_addresses = '127.0.0.1'\nport = ${sourcePort}\nunix_socket_directories = '${directory}'\nwal_level = replica\narchive_mode = on\narchive_command = 'test ! -f ${archive}/%f && cp %p ${archive}/%f'\n`,
    );
    await runCommand('pg_ctl', ['-D', source, '-l', join(directory, 'source.log'), '-w', 'start']);
    await admin.connect();
    return {
      sourceUrl,
      restoredPort,
      async backup(): Promise<void> {
        await runCommand('pg_basebackup', [
          '--dbname',
          sourceUrl,
          '-D',
          restored,
          '--checkpoint=fast',
          '--wal-method=stream',
        ]);
        await runCommand('pg_verifybackup', [restored]);
      },
      async target(): Promise<number> {
        const started = Date.now();
        await admin.query("SELECT pg_create_restore_point('pipong_application_target')");
        return started;
      },
      async restore(): Promise<void> {
        const result = await admin.query<{ segment: string }>(
          'SELECT pg_walfile_name(pg_switch_wal()) AS segment',
        );
        const segment = result.rows[0]?.segment;
        if (!segment) {
          throw new Error('WAL_RECOVERY_SEGMENT_MISSING');
        }
        let archived = false;
        // oxlint-disable eslint/no-await-in-loop -- Wait for the actual WAL segment before starting physical recovery.
        for (let attempt = 0; attempt < 60; attempt++) {
          const state = await admin.query<{ archived: boolean }>(
            'SELECT last_archived_wal=$1 AS archived FROM pg_stat_archiver',
            [segment],
          );
          if (state.rows[0]?.archived) {
            archived = true;
            break;
          }
          await setTimeout(1000);
        }
        // oxlint-enable eslint/no-await-in-loop
        if (!archived) {
          throw new Error('WAL_RECOVERY_ARCHIVE_TIMEOUT');
        }
        const backupConfig = await readFile(join(restored, 'postgresql.conf'), 'utf8');
        await writeFile(
          join(restored, 'postgresql.conf'),
          `${backupConfig}\nport = ${restoredPort}\narchive_mode = off\nrestore_command = 'cp ${archive}/%f %p'\nrecovery_target_name = 'pipong_application_target'\nrecovery_target_action = 'promote'\n`,
        );
        await writeFile(join(restored, 'recovery.signal'), '');
        await runCommand('pg_ctl', [
          '-D',
          restored,
          '-l',
          join(directory, 'restored.log'),
          '-w',
          'start',
        ]);
        const recovered = new Client({
          connectionString: `postgres://postgres@127.0.0.1:${restoredPort}/postgres`,
        });
        try {
          await recovered.connect();
          const state = await recovered.query<{ recovering: boolean }>(
            'SELECT pg_is_in_recovery() AS recovering',
          );
          if (!state.rows[0] || state.rows[0].recovering) {
            throw new Error('WAL_RECOVERY_NOT_PROMOTED');
          }
        } finally {
          await recovered.end();
        }
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
