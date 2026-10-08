import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/tenancy/schema.ts',
    './src/authorization/schema.ts',
    './src/recipients/schema.ts',
    './src/credentials/schema.ts',
    './src/endpoints/schema.ts',
  ],
  out: './migrations/tenancy',
  migrations: {
    schema: 'pipong_migrations',
  },
});
