import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/tenancy/schema.ts',
  out: './migrations/tenancy',
  migrations: {
    schema: 'pipong_migrations',
  },
});
