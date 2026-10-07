import { defineConfig } from 'nitro';
import { fileURLToPath } from 'node:url';
import config from '../../../nitro.config.ts';

export default defineConfig({
  ...config,
  openAPI: { production: 'runtime', ui: { scalar: false, swagger: false } },
  serverDir: fileURLToPath(new URL('../../../src', import.meta.url)),
  scanDirs: [fileURLToPath(new URL('./src', import.meta.url))],
});
