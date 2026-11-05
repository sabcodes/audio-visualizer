import { defineConfig } from '@playwright/test';

const staticBuild = process.env.STAGE5_STATIC === '1';
const port = staticBuild ? 5176 : 5175;
const existingServer = process.env.PLAYWRIGHT_BASE_URL;
const run = staticBuild ? 'static' : process.env.STAGE5_SOAK === '1' ? 'soak' : 'matrix';
export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/stage5*.spec.ts',
  timeout: 90000,
  workers: process.env.STAGE5_SOAK === '1' ? 2 : 1,
  outputDir: `test-results/stage5-${run}`,
  reporter: [['list'], ['json', { outputFile: `test-results/stage5-${run}.json` }]],
  use: { channel: 'chrome', headless: true, baseURL: existingServer ?? `http://127.0.0.1:${port}`, viewport: { width: 1280, height: 720 } },
  webServer: existingServer ? undefined : {
    command: staticBuild ? 'node scripts/serve-release.mjs' : 'npm run dev -- --port 5175 --strictPort',
    url: `http://127.0.0.1:${port}/`, reuseExistingServer: false,
  },
  projects: staticBuild ? [{ name: 'release-static' }] : [
    { name: 'release-webgpu', use: { launchOptions: { args: ['--enable-unsafe-webgpu'] } } },
    { name: 'release-webgl2' },
    { name: 'release-software', use: { launchOptions: { args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } }, grepInvert: /@soak/ },
  ],
});
