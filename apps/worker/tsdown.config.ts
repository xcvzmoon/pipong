import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/migrate.ts'],
  copy: [{ from: '../../packages/database/migrations', to: 'dist' }],
  deps: {
    alwaysBundle: [
      '@pipong/database',
      '@pipong/shared',
      '@xcvzlabs/env',
      'valibot',
      'pg',
      'drizzle-orm',
    ],
  },
});
