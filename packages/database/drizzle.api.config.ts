import { defineConfig } from 'drizzle-kit';
import config from './drizzle.config.ts';
import { env } from './src/env.ts';

if (env.api.database.url === undefined) {
  throw new Error('DATABASE_CONFIG_INVALID: missing API_DATABASE_URL');
}

export default defineConfig({
  ...config,
  dbCredentials: {
    url: env.api.database.url,
  },
  schema: ['./src/schema.ts', './src/auth/schema.ts', './src/tenancy/schema.ts'],
  schemaFilter: ['auth', 'app', 'pgboss'],
});
