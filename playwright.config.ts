import { defineConfig } from '@playwright/test';

const existingServer = process.env.PLAYWRIGHT_BASE_URL;

// Uses installed Chrome: no browser binary is downloaded by this project.
// Explicitly select the headed project to validate a physical GPU separately.
export default defineConfig({
  testDir: './tests/browser',
  timeout: 90000,
  workers: 1,
  use: { baseURL: existingServer ?? 'http://127.0.0.1:5174', viewport: { width: 1280, height: 720 } },
  webServer: existingServer ? undefined : { command: 'npm run dev -- --port 5174 --strictPort', url: 'http://127.0.0.1:5174/modern.html', reuseExistingServer: false },
  projects: [
    { name: 'compatibility', use: { channel: 'chrome', headless: true, launchOptions: { args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } } },
    { name: 'unsupported', testMatch: '**/unsupported.spec.ts', use: { channel: 'chrome', headless: true, launchOptions: { args: ['--disable-webgl', '--disable-webgpu'] } } },
    { name: 'hardware-webgpu', use: { channel: 'chrome', headless: false }, grep: /@hardware/ },
    { name: 'benchmark', testMatch: '**/benchmark.spec.ts', timeout: 15 * 60 * 1000, use: { channel: 'chrome', headless: false, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }, grep: /@benchmark/ },
  ],
});
