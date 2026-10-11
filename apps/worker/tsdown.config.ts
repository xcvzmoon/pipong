import { defineConfig } from 'tsdown';

export default defineConfig({
  loader: {
    '.hbs': 'text',
  },
  entry: ['src/index.ts', 'src/operator.ts', 'src/runtime.ts'],
  deps: {
    alwaysBundle: [
      '@pipong/auth',
      /^@pipong\/database(?:\/|$)/,
      '@pipong/service',
      '@pipong/shared',
      '@xcvzlabs/env',
      'valibot',
      'pg',
      'drizzle-orm',
      'drizzle-query-logger',
    ],
  },
});
