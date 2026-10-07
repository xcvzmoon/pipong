import { defineConfig } from 'drizzle-kit';
import config from './drizzle.auth.config.ts';
import { env } from './src/env.ts';

if (env.migration.database.url === undefined) {
  throw new Error('DATABASE_CONFIG_INVALID: missing MIGRATION_DATABASE_URL');
}

export default defineConfig({
  ...config,
  dbCredentials: {
    url: env.migration.database.url,
  },
});
