import { defineConfig } from 'tsdown';

export default defineConfig({
  loader: {
    '.hbs': 'text',
  },
  entry: ['src/index.ts'],
  deps: {
    alwaysBundle: [
      '@pipong/auth',
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
