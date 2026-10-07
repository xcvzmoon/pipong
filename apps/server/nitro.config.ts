import { defineConfig } from 'nitro';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  compatibilityDate: '2026-10-05',
  preset: 'node_server',
  serverDir: './src',
  rolldownConfig: {
    moduleTypes: {
      '.hbs': 'text',
    },
  },
  alias: {
    '~': fileURLToPath(new URL('./src', import.meta.url)),
  },
});
