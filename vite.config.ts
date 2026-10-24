import { defineConfig } from 'vitest/config';

// The legacy source stays untouched and served by Vite in development.
// Production intentionally contains only the experimental bundled entry.
export default defineConfig({
  base: './',
  build: { rollupOptions: { input: 'modern.html' } },
  test: { include: ['tests/unit/**/*.test.ts'] },
});
