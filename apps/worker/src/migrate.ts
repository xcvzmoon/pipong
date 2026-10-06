import { parseDatabaseUrl, runMigrations } from '@pipong/database';
import { fileURLToPath } from 'node:url';

await runMigrations(
  parseDatabaseUrl(process.env, 'MIGRATION_DATABASE_URL'),
  fileURLToPath(new URL('./migrations/', import.meta.url)),
);
console.info('Database migrations completed');
