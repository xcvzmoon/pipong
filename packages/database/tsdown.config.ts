import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/helpers/index.ts'],
  dts: true,
  exports: {
    devExports: true,
  },
});
