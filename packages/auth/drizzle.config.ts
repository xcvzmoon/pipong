import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: '../database/src/auth/schema.ts',
  out: './migrations',
  migrations: { schema: 'pipong_migrations' },
});
