import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BenchResult } from '../../src/main';

type Debug = { activeMode: string; transitioning: boolean; renderer: import('three/webgpu').WebGPURenderer; bench(seconds: number): Promise<BenchResult> };
const state = (page: Page) => page.evaluate(() => {
  const d = (window as unknown as { __visualizerDebug: Debug }).__visualizerDebug;
  return { mode: d.activeMode, fading: d.transitioning, memory: { ...d.renderer.info.memory } };
});

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== 'stage4-webgpu');
  await page.route('**/api/settings', route => route.fulfill({ json: { version: 1, favoriteModes: [] } }));
});

test('Stage 4 real music, comfort settings, quality tiers and resource soak', async ({ page }, info) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text()); });
  await page.goto('/modern.html?backend=webgpu&mode=circle');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#audio-upload').setInputFiles(resolve('ghost.wav'));
  await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#seek-slider').fill('96'); await page.locator('#play-btn').click();
  await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'playing');
  await page.selectOption('#transition', '0.35');
  await page.locator('#hide').click();
  const memory = [];
  for (const backend of ['webgpu', 'webgl2']) {
    await page.selectOption('#backend', backend, { force: true });
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('#status')).toContainText(backend === 'webgpu' ? 'native WebGPU' : 'WebGL2 compatibility');
    for (const quality of ['compatibility', 'balanced', 'high', 'ultra']) {
      await page.selectOption('#quality', quality, { force: true });
      for (const mode of ['particles', 'godrays', 'boids']) {
        await page.selectOption('#mode', mode, { force: true });
        await expect.poll(async () => (await state(page)).mode).toBe(mode);
        await expect.poll(async () => (await state(page)).fading).toBe(false);
        if (mode === 'boids' && quality === 'balanced') await page.waitForTimeout(3000);
        for (const comfort of ['normal', 'reduced-flash', 'reduced-motion']) {
          await page.evaluate(value => {
            for (const [id, checked] of [['motion', value === 'reduced-motion'], ['reduced-flash', value !== 'normal']] as const) {
              const input = document.getElementById(id) as HTMLInputElement;
              input.checked = checked; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, comfort);
          await page.waitForTimeout(350);
          // Keep the review set bounded: one image per effect/comfort/backend at the default tier.
          if (quality === 'balanced') await page.locator('canvas').screenshot({ path: info.outputPath(`${backend}-${mode}-${comfort}.png`), style: '#quick-controls { visibility: hidden; }' });
        }
        await page.evaluate(() => { const input = document.getElementById('motion') as HTMLInputElement; input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true })); });
      }
    }
  }
  await page.selectOption('#backend', 'webgpu', { force: true });
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.selectOption('#quality', 'balanced', { force: true });
  await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'playing');
  for (let round = 0; round < 12; round++) {
    for (const mode of ['godrays', 'boids', 'particles', 'circle']) {
      await page.selectOption('#mode', mode, { force: true });
      await expect.poll(async () => (await state(page)).mode).toBe(mode);
      await expect.poll(async () => (await state(page)).fading).toBe(false);
    }
    memory.push((await state(page)).memory);
    if (round === 4) { await page.setViewportSize({ width: 390, height: 740 }); await page.setViewportSize({ width: 1280, height: 720 }); }
  }
  const first = memory[2], last = memory.at(-1)!;
  // A complete cycle ends in the same mode. GPU storage and targets must plateau after warmup.
  for (const key of ['storageAttributes', 'renderTargets', 'textures', 'geometries'] as const) expect(last[key], key).toBe(first[key]);
  expect(last.total).toBeLessThanOrEqual(first.total + 65536);
  await writeFile(info.outputPath('resource-soak.json'), JSON.stringify(memory, null, 2));
  await page.locator('#show').click();
  await page.locator('#restart').click();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('canvas')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('Stage 4 one-minute native quality matrix and accelerated WebGL fallback acceptance', async ({ page, browser }, info) => {
  test.skip(process.env.STAGE4_ACCEPTANCE !== '1');
  test.setTimeout(25 * 60 * 1000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text()); });
  const cdp = await browser.newBrowserCDPSession();
  const system = await cdp.send('SystemInfo.getInfo');
  const configurations = [
    { backend: 'webgpu', quality: 'balanced', width: 1920, height: 1080, hz: 60, modes: ['vjRings', 'particles', 'boids', 'kaleidoPlane', 'city', 'starTunnel', 'bloomTunnel', 'godrays'] },
    { backend: 'webgpu', quality: 'high', width: 2560, height: 1440, hz: 60, modes: ['particles', 'boids', 'godrays'] },
    { backend: 'webgpu', quality: 'ultra', width: 3840, height: 2160, hz: 30, modes: ['particles', 'boids', 'godrays'] },
    { backend: 'webgl2', quality: 'balanced', width: 1920, height: 1080, hz: 60, modes: ['particles', 'boids', 'godrays'] },
  ];
  const report = { schemaVersion: 1, recordedAt: new Date().toISOString(), browser: browser.version(), gpu: system.gpu.devices, headless: true, metric: 'rAF cadence plus submission-start to queue-completion upper bound; raw timestamp sums are not elapsed frame time', measurements: [] as unknown[] };
  await mkdir('benchmark-results/stage4', { recursive: true });
  for (const config of configurations) {
    await page.setViewportSize({ width: config.width, height: config.height });
    for (const mode of config.modes) {
      await page.goto(`/modern.html?backend=${config.backend}&quality=${config.quality}&mode=${mode}`);
      await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
      await expect(page.locator('#status')).toContainText(config.backend === 'webgpu' ? 'native WebGPU' : 'WebGL2 compatibility');
      await page.selectOption('#target-hz', String(config.hz));
      await page.selectOption('#scale', '1');
      await page.selectOption('#transition', '0');
      await page.locator('#synthetic').check(); await page.locator('#hide').click();
      await page.waitForTimeout(5000);
      const timings = await page.evaluate(() => (window as unknown as { __visualizerDebug: Debug }).__visualizerDebug.bench(60));
      const resources = (await state(page)).memory;
      report.measurements.push({ ...config, modes: undefined, mode, fixture: 'synthetic bass', seconds: 60, warmupSeconds: 5, ...timings, resources });
      await writeFile('benchmark-results/stage4/acceptance.json', JSON.stringify(report, null, 2));
      console.log(`${config.backend}/${config.quality}/${mode}: rAF p95 ${timings.raf.p95Ms.toFixed(2)}ms, completion p95 ${timings.gpu?.p95Ms.toFixed(2) ?? 'n/a'}ms`);
      expect.soft(timings.drawingBuffer).toEqual({ width: config.width, height: config.height });
      expect.soft(timings.raf.count).toBeGreaterThan(config.hz * 55);
      expect.soft(timings.raf.p95Ms, `${config.quality}/${mode} cadence`).toBeLessThanOrEqual(1100 / config.hz);
      expect.soft(timings.raf.missedFrames / timings.raf.count, `${config.quality}/${mode} missed fraction`).toBeLessThan(0.05);
      if (timings.gpu) expect.soft(timings.gpu.p95Ms, `${config.quality}/${mode} queue completion`).toBeLessThanOrEqual(1000 / config.hz);
    }
  }
  await info.attach('stage4-acceptance.json', { path: 'benchmark-results/stage4/acceptance.json', contentType: 'application/json' });
  expect(errors).toEqual([]);
});

test('Stage 4 prewarming preserves shared renderer state and feedback families', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text()); });
  await page.goto('/modern.html?backend=webgpu&mode=warehouseHall');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  for (const mode of ['redStairwell', 'warehouseHall']) {
    await page.selectOption('#mode', mode);
    await expect.poll(async () => (await state(page)).mode).toBe(mode);
    expect(await page.evaluate(() => (window as unknown as { __visualizerDebug: Debug }).__visualizerDebug.renderer.shadowMap.enabled)).toBe(true);
  }
  for (const mode of ['reactionDiffusion', 'feedback', 'physarum', 'sparkPlume', 'clawHands', 'circle']) {
    await page.selectOption('#mode', mode);
    await expect.poll(async () => (await state(page)).mode).toBe(mode);
    await expect.poll(async () => (await state(page)).fading).toBe(false);
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  }
  expect(await page.evaluate(() => (window as unknown as { __visualizerDebug: Debug }).__visualizerDebug.renderer.shadowMap.enabled)).toBe(false);
  expect(errors).toEqual([]);
});
