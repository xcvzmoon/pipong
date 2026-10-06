import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  deps: {
    alwaysBundle: [
      '@pipong/database',
      '@pipong/shared',
      '@xcvzlabs/env',
      'valibot',
      'pg',
      'drizzle-orm',
      'drizzle-query-logger',
    ],
  },
});
