import { defineConfig } from 'vitest/config';
import { localSettings } from './server/settings';

// The legacy source stays untouched and served by Vite in development.
// Production intentionally contains only the experimental bundled entry.
export default defineConfig({
  base: './',
  plugins: [localSettings()],
  build: { rollupOptions: { input: 'modern.html' } },
  test: { include: ['tests/unit/**/*.test.ts'] },
});
