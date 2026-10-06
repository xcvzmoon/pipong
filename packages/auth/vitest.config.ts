import { readFile } from 'node:fs/promises';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      name: 'handlebars-templates',
      enforce: 'pre',
      async load(id) {
        if (!id.endsWith('.hbs')) {
          return null;
        }

        const template = await readFile(id, 'utf8');
        return `export default ${JSON.stringify(template)}`;
      },
    },
  ],
});
