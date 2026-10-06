import { defineConfig } from 'drizzle-kit';
import { env } from './src/env.ts';

export default defineConfig({
  dialect: 'postgresql',
  dbCredentials: {
    url: env.database.url,
  },
  out: './migrations',
});
