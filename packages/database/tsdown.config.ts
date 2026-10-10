import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/delivery-queue.ts',
    'src/events.ts',
    'src/limits.ts',
    'src/submission.ts',
    'src/attempts.ts',
    'src/recovery.ts',
    'src/helpers/index.ts',
    'src/auth/index.ts',
    'src/tenancy/index.ts',
    'src/authorization/index.ts',
    'src/projects/index.ts',
    'src/environments/index.ts',
    'src/service-keys/index.ts',
    'src/recipients/index.ts',
    'src/credentials/index.ts',
    'src/endpoints/index.ts',
  ],
  dts: true,
  exports: {
    devExports: true,
  },
});
