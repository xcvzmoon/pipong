import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/helpers/index.ts', 'src/auth/index.ts', 'src/tenancy/index.ts'],
  dts: true,
  exports: {
    devExports: true,
  },
});
