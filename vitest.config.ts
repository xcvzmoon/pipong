import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    isolate: false,
    clearMocks: false,
    passWithNoTests: true,
  },
});
