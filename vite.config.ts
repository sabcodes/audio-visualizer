import { defineConfig } from 'vitest/config';
import { localSettings } from './server/settings';

export default defineConfig({
  base: './',
  // Reliability runs must not reload when filesystem providers emit metadata events.
  server: process.env.STAGE5_SOAK === '1' ? { hmr: false, watch: null } : undefined,
  plugins: [localSettings()],
  test: { include: ['tests/unit/**/*.test.ts'] },
});
