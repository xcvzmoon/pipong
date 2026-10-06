import { defineConfig } from 'tsdown';

export default defineConfig({
  deps: {
    alwaysBundle: ['@pipong/shared', '@xcvzlabs/env', 'valibot'],
  },
});
