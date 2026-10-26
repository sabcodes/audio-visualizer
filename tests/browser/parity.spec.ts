import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const allIds = ['circle', 'spiral', 'star', 'cube', 'particles', 'errors', 'lissajous', 'boids', 'fftTunnel', 'kaleidoPlane', 'city', 'glitchRing', 'vjRings', 'neonKaleido', 'starTunnel', 'bloomTunnel', 'glitchFX', 'godrays',
  'epicycles', 'polyhedra', 'pendulumWave', 'voronoi', 'inkMarble', 'aurora', 'ridgeline', 'synthwave', 'galaxy', 'robot', 'neonCity',
  'kraken', 'torusKnot', 'chladni', 'metaballs', 'ocean', 'eventHorizon', 'fireworks', 'abyss', 'disco', 'ferrofluid', 'arena',
  'reactionDiffusion', 'feedback', 'curlFlow', 'attractor', 'physarum', 'snowflake', 'turntable', 'ascii', 'ledAnalyzer', 'storm',
  'swampGiant', 'dragon', 'phoenix', 'crowdMascot', 'skeletonBand', 'jellyBlob',
  'prismBowtie', 'blockBowtie', 'pongOrbs', 'candyOrb', 'moonPond', 'liquidChrome', 'mirrorPlasma', 'grainSmoke', 'anamorphicFlare', 'hairVortex',
  'windfield', 'blackMaze', 'starfallCanopy', 'silkThreads', 'chromeStreaks', 'signalNight', 'beaconRings', 'lightLeakFilm', 'warehouseHall', 'redStairwell',
  'underground', 'endlessStairs', 'templeDescent', 'lavaGolem', 'lightForest', 'redCrystalHall', 'poleSparks', 'bloomTouch', 'emberSmoke',
  'crtSpill', 'tvWall', 'inkDiscs', 'crackedGlobe', 'dotVortex', 'skyShards', 'neonPortal', 'sparkPlume', 'dreamAlley', 'clawHands',
  'relicGlow', 'lanternTree', 'metroCar', 'slitDancer'];
// Compute-shader modes are disabled in the picker on WebGL2.
const gpuOnly = ['sparkPlume'];

test('all 99 modes render silently then during Ghost playback and seeking @hardware', async ({ page }, info) => {
  test.skip(!['compatibility', 'hardware-webgpu'].includes(info.project.name));
  test.setTimeout(900000); // 99 modes twice under software rendering
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text()); });
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }));
  const backend = info.project.name === 'hardware-webgpu' ? 'webgpu' : 'webgl2';
  await page.goto(`/modern.html?backend=${backend}&time=2`);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#status')).toContainText(backend === 'webgpu' ? 'native WebGPU' : 'WebGL2 compatibility');
  await expect(page.locator('#reduced-flash')).toBeChecked();
  await page.locator('#hide').click();
  const ids = backend === 'webgpu' ? allIds : allIds.filter((id) => !gpuOnly.includes(id));
  if (backend === 'webgl2') for (const id of gpuOnly) await expect(page.locator(`#mode option[value="${id}"]`)).toHaveJSProperty('disabled', true);
  // WebGL2 must say timestamps are unavailable rather than report zeros.
  await expect(page.locator('#diagnostics')).toHaveText(backend === 'webgpu' ? /gpu (\d+\.\d+ ms|n\/a)/ : /gpu n\/a/);
  for (const id of ids) {
    await page.selectOption('#mode', id, { force: true });
    await page.waitForTimeout(450);
    await expect(page.locator('#status'), `silent: ${id}`).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('canvas')).toHaveCount(1);
    await page.locator('canvas').screenshot({ path: info.outputPath(`silent-${id}.png`) });
    await expect(page.locator('#viewport-errors')).toHaveCount(id === 'errors' ? 1 : 0);
  }
  // Real fixture is user-supplied and never bundled. Silent coverage still runs without it.
  if (existsSync(resolve('ghost.wav'))) {
    await page.locator('#show').click();
    await page.locator('#freeze').click();
    await page.locator('#audio-upload').setInputFiles(resolve('ghost.wav'));
    await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'ready');
    await page.locator('#seek-slider').fill('96');
    await page.locator('#play-btn').click();
    await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'playing');
    await page.locator('#sensitivity').fill('2.5');
    for (const id of ids) {
      await page.selectOption('#mode', id);
      await page.waitForTimeout(400);
      await expect(page.locator('#status'), `playback: ${id}`).toHaveAttribute('data-state', 'ready');
    }
    await page.locator('#play-btn').click();
    await page.locator('#seek-slider').fill('120');
    await page.locator('#play-btn').click();
    await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'playing');
  }
  for (const id of [...ids].reverse()) await page.selectOption('#mode', id, { force: true });
  await page.setViewportSize({ width: 390, height: 740 });
  await page.selectOption('#mode', 'city', { force: true });
  await page.selectOption('#mode', 'circle', { force: true });
  await page.waitForTimeout(500);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  expect(errors).toEqual([]);
});

test('Win95 windows drag, dismiss, remain bounded, and clean up @hardware', async ({ page }, info) => {
  test.skip(!['compatibility', 'hardware-webgpu'].includes(info.project.name));
  const backend = info.project.name === 'hardware-webgpu' ? 'webgpu' : 'webgl2';
  await page.goto(`/modern.html?backend=${backend}&mode=errors`);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#motion').check();
  await page.locator('#hide').click();
  const title = page.locator('.win95-title').first();
  const box = await title.boundingBox(); expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 30, box!.y + 10); await page.mouse.down();
  await page.mouse.move(100, 100); await page.mouse.up();
  const moved = await title.boundingBox(); expect(moved!.x).toBeLessThan(110);
  const before = await page.locator('.win95-window').count();
  await page.locator('.win95-title button').first().click();
  await expect(page.locator('.win95-window')).toHaveCount(before - 1);
  await page.selectOption('#mode', 'circle', { force: true });
  await expect(page.locator('#viewport-errors')).toHaveCount(0);
});

test('rapid mode changes settle on the last request without leaks @hardware', async ({ page }, info) => {
  test.skip(!['compatibility', 'hardware-webgpu'].includes(info.project.name));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const backend = info.project.name === 'hardware-webgpu' ? 'webgpu' : 'webgl2';
  await page.goto(`/modern.html?backend=${backend}&mode=circle`);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#hide').click();
  for (const id of ['kaleidoPlane', 'city', 'godrays', 'particles']) await page.selectOption('#mode', id, { force: true });
  await page.waitForTimeout(1000);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#viewport-errors')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __visualizerDebug: { activeMode: string } }).__visualizerDebug.activeMode)).toBe('particles');
  expect(errors).toEqual([]);
});

test('AgX tone mapping and SMAA render every mode family without errors @hardware', async ({ page }, info) => {
  test.skip(!['compatibility', 'hardware-webgpu'].includes(info.project.name));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text()); });
  const backend = info.project.name === 'hardware-webgpu' ? 'webgpu' : 'webgl2';
  await page.goto(`/modern.html?backend=${backend}&tone=agx&aa=smaa&mode=circle`);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#tone-mapping')).toHaveValue('agx');
  await expect(page.locator('#aa')).toHaveValue('smaa');
  for (const id of ['particles', 'kaleidoPlane', 'vjRings', 'glitchFX', 'city']) {
    await page.selectOption('#mode', id);
    await page.waitForTimeout(300);
  }
  await page.selectOption('#aa', 'none');
  await page.selectOption('#aa', 'fxaa');
  await page.waitForTimeout(300);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  expect(errors).toEqual([]);
});

type Debug = { activeMode: string; pipelineAa: string; adaptiveHolding: boolean; adaptiveLocked: boolean };
const slowCompiles = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { __visualizerDebug: { setCompileDelay(ms: number): void } }).__visualizerDebug.setCompileDelay(1500));
const debug = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { __visualizerDebug: Debug }).__visualizerDebug).then((d) => d);

test('changing quality while a mode compiles keeps the newly requested mode @hardware', async ({ page }, info) => {
  test.skip(!['compatibility', 'hardware-webgpu'].includes(info.project.name));
  const backend = info.project.name === 'hardware-webgpu' ? 'webgpu' : 'webgl2';
  await page.goto(`/modern.html?backend=${backend}&mode=circle`);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await slowCompiles(page);
  await page.selectOption('#mode', 'kaleidoPlane');
  await page.selectOption('#quality', 'high');
  await page.waitForTimeout(4000);
  expect((await debug(page)).activeMode).toBe('kaleidoPlane');
});

test('changing antialiasing while a mode compiles applies to the swapped-in mode @hardware', async ({ page }, info) => {
  test.skip(!['compatibility', 'hardware-webgpu'].includes(info.project.name));
  const backend = info.project.name === 'hardware-webgpu' ? 'webgpu' : 'webgl2';
  await page.goto(`/modern.html?backend=${backend}&mode=circle`);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await slowCompiles(page);
  await page.selectOption('#mode', 'kaleidoPlane');
  await page.selectOption('#aa', 'smaa');
  await page.waitForTimeout(2500);
  expect((await debug(page)).activeMode).toBe('kaleidoPlane');
  expect((await debug(page)).pipelineAa).toBe('smaa');
});

test('a mode switch pauses adaptive scaling while the new mode compiles @hardware', async ({ page }, info) => {
  test.skip(!['compatibility', 'hardware-webgpu'].includes(info.project.name));
  const backend = info.project.name === 'hardware-webgpu' ? 'webgpu' : 'webgl2';
  await page.goto(`/modern.html?backend=${backend}&mode=circle`);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.waitForTimeout(5500);
  await slowCompiles(page);
  expect((await debug(page)).adaptiveHolding).toBe(false);
  await page.selectOption('#mode', 'kaleidoPlane');
  expect((await debug(page)).adaptiveHolding).toBe(true);
});

test('the 60 s benchmark locks adaptive scaling for its duration @hardware', async ({ page }, info) => {
  test.skip(!['compatibility', 'hardware-webgpu'].includes(info.project.name));
  const backend = info.project.name === 'hardware-webgpu' ? 'webgpu' : 'webgl2';
  await page.goto(`/modern.html?backend=${backend}&mode=circle`);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#benchmark').click();
  expect((await debug(page)).adaptiveLocked).toBe(true);
  await page.locator('#exposure').fill('1.2'); // any setting change cancels the run
  expect((await debug(page)).adaptiveLocked).toBe(false);
});
