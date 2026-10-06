import { defineConfig } from 'tsdown';

export default defineConfig({
  loader: {
    '.hbs': 'text',
  },
  dts: true,
  exports: {
    devExports: true,
  },
});
