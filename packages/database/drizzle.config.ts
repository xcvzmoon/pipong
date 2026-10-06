import { defineConfig } from 'drizzle-kit';
import { parseDatabaseUrl } from './src/env.ts';

export default defineConfig({
  dialect: 'postgresql',
  dbCredentials: { url: parseDatabaseUrl(process.env, 'MIGRATION_DATABASE_URL') },
  out: './migrations',
  migrations: { schema: 'pipong_migrations' },
});
