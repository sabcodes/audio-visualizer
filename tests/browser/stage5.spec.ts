import { test, expect, type Page } from '@playwright/test';

const isStatic = process.env.STAGE5_STATIC === '1';
const backend = (name: string) => ['release-webgpu', 'release-static'].includes(name) ? 'webgpu' : 'webgl2';
const debug = (page: Page) => page.evaluate(() => {
  const d = (window as any).__visualizerDebug;
  return { mode: d.activeMode, frame: d.renderer?.info.render.calls, memory: { ...d.renderer?.info.memory } };
});
const ready = (page: Page) => expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');

import { tone } from './fixtures/releaseAudio';

test.beforeEach(async ({ page }) => {
  test.skip(process.env.STAGE5_SOAK === '1' || !['release-webgpu', 'release-webgl2', 'release-software', 'release-static'].includes(test.info().project.name));
  if (!isStatic) await page.route('**/api/settings', route => route.fulfill({ json: { version: 1, favoriteModes: [] } }));
});

test('root entry loads the visualizer with parameters and no legacy assets', async ({ page }, info) => {
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) external.push(request.url()); });
  await page.goto(`/?backend=${backend(info.project.name)}&mode=particles&quality=balanced`);
  await ready(page);
  await expect(page.locator('#status')).toContainText(backend(info.project.name) === 'webgpu' ? 'native WebGPU' : 'WebGL2 compatibility');
  await expect(page.locator('#mode')).toHaveValue('particles');
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.locator('#viewport')).toHaveAttribute('aria-label', 'Music visualizer canvas');
  await page.goto(`/?backend=${backend(info.project.name)}&mode=city&aa=none#bookmark`);
  await ready(page);
  await expect(page).toHaveURL(/\/\?backend=.*mode=city&aa=none#bookmark/);
  await expect(page.locator('#mode')).toHaveValue('city');
  await expect(page.locator('#aa')).toHaveValue('none');
  await expect(page.locator('a[href*="legacy"]')).toHaveCount(0);
  if (isStatic) for (const path of ['/modern.html', '/legacy.html', '/script.js', '/style.css']) {
    expect((await page.request.get(path)).status(), path).toBe(404);
  }
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  if (isStatic) expect(await page.evaluate(() => '__visualizerDebug' in window)).toBe(false);
});

test('static favorites persist, migrate once, and report storage failures honestly', async ({ page }) => {
  test.skip(!isStatic);
  await page.goto('/?backend=webgl2&mode=circle'); await ready(page);
  await page.evaluate(() => localStorage.setItem('visualizer.favoriteModes', JSON.stringify(['circle', 'city', 'missing'])));
  await page.reload(); await expect(page.locator('#favorite')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#favorite').click(); await expect(page.locator('#favorite')).toHaveAttribute('aria-pressed', 'false');
  await page.reload(); await expect(page.locator('#favorite')).toBeEnabled();
  await expect(page.locator('#favorite')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#favorite-modes option[value="city"]')).toHaveCount(1);
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); }; });
  await page.locator('#favorite').click();
  await expect(page.locator('#settings-status')).toContainText('Could not save favorites');
  await expect(page.locator('#favorite')).toHaveAttribute('aria-pressed', 'false');
});

test('denied native adapter falls back automatically and strict native can recover', async ({ page }, info) => {
  test.skip(isStatic || info.project.name === 'release-software');
  await page.addInitScript(() => { const gpu = (navigator as any).gpu; if (gpu) gpu.requestAdapter = async () => null; });
  await page.goto('/?backend=auto&mode=circle'); await ready(page);
  await expect(page.locator('#status')).toContainText('WebGL2 compatibility');
  await page.goto('/?backend=webgpu&mode=circle');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'error');
  await page.locator('#compatibility').click(); await ready(page);
  await expect(page.locator('#status')).toContainText('WebGL2 compatibility');
});

test('actual graphics loss stops rendering and compatibility restart preserves player and picture settings', async ({ page }, info) => {
  test.skip(isStatic);
  if (info.project.name === 'release-webgpu') await page.addInitScript(() => {
    // Destroy a real test device; map its intentional-loss reason to the unexpected-loss path.
    // Three.js deliberately suppresses intentional destruction in production.
    const adapter = (window as any).GPUAdapter.prototype;
    const request = adapter.requestDevice;
    adapter.requestDevice = async function (...args: unknown[]) {
      const device = await request.apply(this, args);
      const lost = device.lost.then(() => ({ reason: 'unknown', message: 'Release test device loss' }));
      Object.defineProperty(device, 'lost', { value: lost });
      return device;
    };
  });
  await page.goto(`/?backend=${backend(info.project.name)}&mode=city`); await ready(page);
  await page.selectOption('#quality', 'high');
  await expect.poll(async () => (await debug(page)).mode).toBe('city');
  await page.locator('#exposure').fill('1.25'); await page.selectOption('#aa', 'none');
  await page.locator('#audio-upload').setInputFiles(tone());
  await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#seek-slider').fill('5'); await page.locator('#play-btn').click();
  await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'playing');
  await page.evaluate(native => {
    const renderer = (window as any).__visualizerDebug.renderer;
    if (native) renderer.backend.device.destroy();
    else renderer.backend.gl.getExtension('WEBGL_lose_context').loseContext();
  }, info.project.name === 'release-webgpu');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#status')).toContainText('Graphics device lost');
  const stoppedFrame = (await debug(page)).frame; await page.waitForTimeout(250);
  expect((await debug(page)).frame).toBe(stoppedFrame);
  await page.locator('#compatibility').click(); await ready(page);
  await expect(page.locator('#status')).toContainText('WebGL2 compatibility');
  await expect(page.locator('#mode')).toHaveValue('city'); await expect(page.locator('#quality')).toHaveValue('high');
  await expect(page.locator('#exposure')).toHaveValue('1.25'); await expect(page.locator('#aa')).toHaveValue('none');
  await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'playing');
  await expect(page.locator('#track-name')).toHaveText('release.wav');
  await expect(page.locator('canvas')).toHaveCount(1);
});

test('compile and submission failures recover; stale selection errors cannot poison a restart', async ({ page }, info) => {
  test.skip(isStatic);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/?backend=${backend(info.project.name)}&mode=circle`); await ready(page);
  await page.evaluate(() => { (window as any).__visualizerDebug.renderer.compileAsync = async () => { throw new Error('Injected shader compile failure'); }; });
  await page.selectOption('#mode', 'city');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#status')).toContainText('Injected shader compile failure');
  await page.locator('#restart').click(); await ready(page);
  await page.evaluate(() => { (window as any).__visualizerDebug.renderer.render = () => { throw new Error('Injected submission failure'); }; });
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#status')).toContainText('Injected submission failure');
  await page.locator('#restart').click(); await ready(page);
  await page.evaluate(() => {
    (window as any).__visualizerDebug.renderer.compileAsync = () => new Promise((_, reject) => setTimeout(() => reject(new Error('Obsolete compile')), 600));
  });
  await page.selectOption('#mode', 'particles'); await page.waitForTimeout(100);
  await page.locator('#restart').click(); await ready(page);
  await page.waitForTimeout(800); await ready(page);
  await expect.poll(async () => (await debug(page)).mode).toBe('particles');
  await expect(page.locator('canvas')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('visibility suspension and cached-page restore leave one active renderer', async ({ page }, info) => {
  test.skip(isStatic);
  await page.goto(`/?backend=${backend(info.project.name)}&mode=errors`); await ready(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const frame = (await debug(page)).frame; await page.waitForTimeout(250);
  expect((await debug(page)).frame).toBe(frame);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await debug(page)).frame).toBeGreaterThan(frame);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.locator('#viewport-errors')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await ready(page); await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.locator('#viewport-errors')).toHaveCount(1);
});

test('static build supports playback, comfort controls, resize, reload and compatibility restart', async ({ page }) => {
  test.skip(!isStatic);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?backend=webgl2&mode=particles'); await ready(page);
  await page.locator('#audio-upload').setInputFiles(tone());
  await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#play-btn').click(); await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'playing');
  await page.locator('#motion').check(); await page.locator('#exposure').fill('1.2');
  for (const mode of ['godrays', 'boids', 'city', 'errors', 'circle']) {
    await page.selectOption('#mode', mode); await page.waitForTimeout(350); await ready(page);
  }
  await page.setViewportSize({ width: 390, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#restart').click(); await ready(page);
  await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'playing');
  await page.reload(); await ready(page);
  await expect(page.locator('#motion')).toBeChecked(); await expect(page.locator('#exposure')).toHaveValue('1.2');
  expect(errors).toEqual([]);
});


test('final reference captures cover scene, fullscreen, particles and compatibility treatments', async ({ page }, info) => {
  test.skip(isStatic || info.project.name === 'release-software');
  const native = info.project.name === 'release-webgpu';
  await page.goto(`/?backend=${native ? 'webgpu' : 'webgl2'}&mode=circle&time=2`); await ready(page);
  await page.selectOption('#transition', '0'); await page.locator('#synthetic').check();
  await page.locator('#hide').click();
  for (const mode of ['circle', 'particles', 'godrays', 'boids', 'vjRings', 'city']) {
    await page.selectOption('#mode', mode, { force: true });
    await expect.poll(async () => (await debug(page)).mode).toBe(mode);
    await page.waitForTimeout(400);
    await page.locator('canvas').screenshot({ path: info.outputPath(`${mode}.png`), style: '#quick-controls { visibility: hidden; }' });
  }
});

test('no WebGPU API uses compatibility; no usable APIs produce actionable production recovery', async ({ page }) => {
  test.skip(!isStatic);
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true }));
  await page.goto('/?backend=auto&mode=circle'); await ready(page);
  await expect(page.locator('#status')).toContainText('WebGL2 compatibility');
  await page.addInitScript(() => {
    const context = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: any[]) {
      return String(args[0]).startsWith('webgl') ? null : Reflect.apply(context, this, args);
    } as typeof context;
  });
  await page.reload();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#status')).toContainText('localhost/HTTPS');
  await expect(page.locator('#compatibility')).toBeVisible(); await expect(page.locator('#restart')).toBeEnabled();
});

test('Spark Plume releases both compute buffers and kernels when switched away or superseded', async ({ page }, info) => {
  test.skip(isStatic || info.project.name !== 'release-webgpu');
  await page.goto('/?backend=webgpu&mode=circle'); await ready(page);
  for (let round = 0; round < 3; round++) {
    await page.selectOption('#mode', 'sparkPlume');
    await expect.poll(async () => (await debug(page)).mode).toBe('sparkPlume');
    await expect.poll(async () => (await debug(page)).memory.storageAttributes).toBe(2);
    await page.selectOption('#mode', 'circle');
    await expect.poll(async () => (await debug(page)).mode).toBe('circle');
    expect((await debug(page)).memory.storageAttributes).toBe(0);
  }
  await page.evaluate(() => (window as any).__visualizerDebug.setCompileDelay(1000));
  await page.selectOption('#mode', 'sparkPlume');
  await expect.poll(async () => (await debug(page)).memory.storageAttributes).toBe(2);
  await page.selectOption('#mode', 'particles');
  await expect.poll(async () => (await debug(page)).mode).toBe('particles');
  expect((await debug(page)).memory.storageAttributes).toBe(0);
});

test('failed backend initialization and repeated retries produce no unhandled rejections', async ({ page }, info) => {
  test.skip(isStatic || info.project.name !== 'release-webgpu');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true });
    const context = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: any[]) {
      return String(args[0]).startsWith('webgl') ? null : Reflect.apply(context, this, args);
    } as typeof context;
  });
  await page.goto('/?backend=auto');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'error');
  await page.locator('#restart').click();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'error');
  await page.waitForTimeout(250);
  expect(errors).toEqual([]);
});

test('cached model scenes survive repeat visits and overlapping preparation', async ({ page }, info) => {
  test.skip(isStatic || !['release-webgpu', 'release-webgl2'].includes(info.project.name));
  test.setTimeout(360000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.text().includes('Model load failed:')) errors.push(message.text()); });
  const modes = ['swampGiant', 'dragon', 'highPolyDragon', 'phoenix', 'lowPolyWesternPhoenix', 'westernPhoenix', 'crowdMascot', 'skeletonBand', 'jellyBlob', 'goldenGate', 'lasNoches', 'evilPumpkin', 'nightRider', 'nightRiderV2', 'akira', 'water7', 'ichiraku', 'spaceShip'];
  await page.goto(`/?backend=${backend(info.project.name)}&mode=circle`); await ready(page);
  await page.selectOption('#scale', '0.5'); await page.selectOption('#transition', '0');
  for (let round = 0; round < 2; round++) for (const mode of [...modes, 'circle']) {
    console.log(`model revisit ${info.project.name}/${round}/${mode}`);
    await page.selectOption('#mode', mode);
    await expect.poll(async () => (await debug(page)).mode, { timeout: 120000 }).toBe(mode);
    await page.waitForTimeout(200);
    await expect(page.locator('#status'), `${round}/${mode}`).toHaveAttribute('data-state', 'ready');
  }
  expect(errors).toEqual([]);
});

test('shadow and skinned scene resources plateau on every revisit', async ({ page }, info) => {
  test.skip(isStatic || info.project.name !== 'release-webgpu');
  test.setTimeout(120000);
  await page.goto('/?backend=webgpu&mode=circle'); await ready(page);
  await page.selectOption('#scale', '0.5'); await page.selectOption('#transition', '0');
  const samples: any[] = [];
  for (let round = 0; round < 3; round++) {
    for (const mode of ['warehouseHall', 'redStairwell', 'redCrystalHall', 'lavaGolem', 'swampGiant', 'skeletonBand', 'eventHorizon', 'circle']) {
      await page.selectOption('#mode', mode);
      await expect.poll(async () => (await debug(page)).mode).toBe(mode);
      await page.waitForTimeout(200);
    }
    samples.push((await debug(page)).memory);
    console.log('resource revisit', round, JSON.stringify(samples.at(-1)));
  }
  for (const sample of samples.slice(1)) for (const key of ['geometries', 'textures', 'renderTargets', 'storageAttributes', 'total']) expect(sample[key], key).toBe(samples[0][key]);
});

test('Golden Gate instance buffers return to the same baseline after every visit', async ({ page }, info) => {
  test.skip(isStatic || info.project.name !== 'release-webgpu');
  test.setTimeout(120000);
  await page.goto('/?backend=webgpu&mode=circle'); await ready(page);
  await page.selectOption('#scale', '0.5'); await page.selectOption('#transition', '0');
  const samples: any[] = [];
  for (let round = 0; round < 3; round++) {
    await page.selectOption('#mode', 'goldenGate');
    await expect.poll(async () => (await debug(page)).mode, { timeout: 60000 }).toBe('goldenGate');
    await page.waitForTimeout(200);
    await page.selectOption('#mode', 'windfield');
    await expect.poll(async () => (await debug(page)).mode).toBe('windfield');
    await page.selectOption('#aa', round % 2 ? 'smaa' : 'fxaa');
    await page.waitForTimeout(200); await page.selectOption('#mode', 'circle');
    await expect.poll(async () => (await debug(page)).mode).toBe('circle');
    samples.push((await debug(page)).memory);
    console.log('bridge buffers', round, samples.at(-1).attributesSize);
  }
  expect(samples[1].attributesSize).toBe(samples[0].attributesSize);
  expect(samples[2].attributesSize).toBe(samples[0].attributesSize);
});

test('renderer restart preserves custom bloom on scenes with an authored bloom default', async ({ page }, info) => {
  test.skip(isStatic || !['release-webgpu', 'release-webgl2'].includes(info.project.name));
  await page.goto(`/?backend=${backend(info.project.name)}&mode=toonBlaze`); await ready(page);
  await expect(page.locator('#bloom')).toHaveValue('0');
  await page.locator('#bloom').fill('1.1');
  await page.locator('#exposure').fill('1.25');
  await page.locator('#restart').click(); await ready(page);
  await expect(page.locator('#bloom')).toHaveValue('1.1');
  await expect(page.locator('#quick-bloom')).toHaveValue('1.1');
  await expect(page.locator('#exposure')).toHaveValue('1.25');
});
