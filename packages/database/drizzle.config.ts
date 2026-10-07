import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations/foundation',
  migrations: {
    schema: 'pipong_migrations',
  },
});
