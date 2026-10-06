import { defineConfig } from 'nitro';

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
    '~': './src',
  },
});
