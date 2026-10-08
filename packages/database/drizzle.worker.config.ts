import { defineConfig } from 'drizzle-kit';
import config from './drizzle.config.ts';
import { env } from './src/env.ts';

if (env.worker.database.url === undefined) {
  throw new Error('DATABASE_CONFIG_INVALID: missing WORKER_DATABASE_URL');
}

export default defineConfig({
  ...config,
  dbCredentials: {
    url: env.worker.database.url,
  },
  schema: ['./src/schema.ts', './src/tenancy/schema.ts', './src/credentials/schema.ts'],
  schemaFilter: ['app', 'pgboss'],
});
