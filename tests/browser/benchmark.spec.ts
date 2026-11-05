import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

// Representative easy and expensive modes from the plan's benchmark method (§9).
const modes = ['vjRings', 'particles', 'boids', 'kaleidoPlane', 'city', 'starTunnel', 'bloomTunnel', 'godrays'];

test('benchmark representative modes on native WebGPU @benchmark', async ({ page }, info) => {
  test.skip(info.project.name !== 'benchmark');
  const seconds = Number(process.env.BENCH_SECONDS ?? 60);
  const label = process.env.BENCH_LABEL ?? 'run';
  const results: Record<string, unknown> = {};
  for (const mode of modes) {
    await page.goto(`/?backend=webgpu&quality=balanced&mode=${mode}`);
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
    await page.locator('#synthetic').check();
    await page.selectOption('#scale', '1');
    await page.locator('#hide').click();
    await page.waitForTimeout(5000);
    results[mode] = await page.evaluate((s) => (window as unknown as { __visualizerDebug: { bench(s: number): Promise<unknown> } }).__visualizerDebug.bench(s), seconds);
  }
  const report = { schemaVersion: 2, label, recordedAt: new Date().toISOString(), settings: { backend: 'webgpu', quality: 'balanced', scale: 1, fixture: 'synthetic bass', seconds, viewport: page.viewportSize() }, modes: results };
  const text = JSON.stringify(report, null, 2);
  expect(text).not.toMatch(/Macintosh|Windows NT|Linux x86|userAgent/);
  mkdirSync('benchmark-results', { recursive: true });
  writeFileSync(`benchmark-results/${label}.json`, `${text}\n`);
});
