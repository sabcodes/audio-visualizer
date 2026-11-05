import { test, expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const debug = (page: Page) => page.evaluate(() => {
  const state = (window as unknown as { __visualizerDebug: { activeMode: string; transitioning: boolean; pipelineAa: string } }).__visualizerDebug;
  return { mode: state.activeMode, fading: state.transitioning, aa: state.pipelineAa };
});

test.beforeEach(async ({ page }, info) => {
  test.skip(!['compatibility', 'stage4-webgpu'].includes(info.project.name));
  await page.route('**/api/settings', route => route.fulfill({ json: { version: 1, favoriteModes: [] } }));
});

test('Stage 4 renders particles and the appropriate light-shaft tier without errors', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text()); });
  const native = info.project.name === 'stage4-webgpu';
  await page.goto(`/modern.html?backend=${native ? 'webgpu' : 'webgl2'}&mode=godrays&time=2`);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#scene-detail')).toContainText(native ? '24 samples' : 'Stylized');
  await page.locator('#hide').click();
  await page.locator('canvas').screenshot({ path: info.outputPath('light-shafts.png'), style: '#quick-controls { visibility: hidden; }' });
  await page.selectOption('#quality', 'high', { force: true });
  await expect(page.locator('#scene-detail')).toContainText(native ? '40 samples' : 'Stylized');
  await page.selectOption('#quality', 'ultra', { force: true });
  await expect(page.locator('#scene-detail')).toContainText(native ? '64 samples' : 'Stylized');
  await page.selectOption('#quality', 'compatibility', { force: true });
  await expect(page.locator('#scene-detail')).toContainText('Stylized');
  await page.selectOption('#quality', 'balanced', { force: true });
  await page.selectOption('#mode', 'particles', { force: true });
  await expect.poll(async () => (await debug(page)).mode).toBe('particles');
  await page.waitForTimeout(900);
  await page.locator('canvas').screenshot({ path: info.outputPath('curl-particles.png'), style: '#quick-controls { visibility: hidden; }' });
  await page.selectOption('#aa', 'smaa', { force: true });
  await page.selectOption('#mode', 'godrays', { force: true });
  await expect.poll(async () => (await debug(page)).mode).toBe('godrays');
  await page.waitForTimeout(900);
  expect((await debug(page)).aa).toBe('smaa');
  expect(errors).toEqual([]);
});

test('Stage 4 fades finish, rapid switches settle, and reduced motion and DOM scenes cut', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/modern.html?backend=${info.project.name === 'stage4-webgpu' ? 'webgpu' : 'webgl2'}&mode=circle&time=2`);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.selectOption('#transition', '0.7');
  await page.selectOption('#mode', 'spiral');
  await expect.poll(async () => (await debug(page)).fading).toBe(true);
  await expect.poll(async () => (await debug(page)).fading).toBe(false);
  for (const mode of ['city', 'particles', 'fftTunnel', 'circle']) await page.selectOption('#mode', mode);
  await expect.poll(async () => (await debug(page)).mode).toBe('circle');
  await expect.poll(async () => (await debug(page)).fading).toBe(false);
  await page.locator('#motion').check();
  await page.selectOption('#mode', 'particles');
  await expect.poll(async () => (await debug(page)).mode).toBe('particles');
  expect((await debug(page)).fading).toBe(false);
  await page.locator('#motion').uncheck();
  await page.selectOption('#mode', 'errors');
  await expect.poll(async () => (await debug(page)).mode).toBe('errors');
  expect((await debug(page)).fading).toBe(false);
  await page.selectOption('#mode', 'circle');
  await expect.poll(async () => (await debug(page)).mode).toBe('circle');
  expect((await debug(page)).fading).toBe(false);
  await page.locator('#restart').click();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('canvas')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('Stage 4 snapshots preserve orientation and display colour during a fade', async ({ page }, info) => {
  await page.goto(`/modern.html?backend=${info.project.name === 'stage4-webgpu' ? 'webgpu' : 'webgl2'}&mode=rings&time=2`);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.selectOption('#transition', '0.7');
  await page.locator('#hide').click();
  const canvas = page.locator('canvas'), style = '#quick-controls { visibility: hidden; }';
  const before = await canvas.screenshot({ style });
  await page.selectOption('#mode', 'rings', { force: true });
  await expect.poll(async () => (await debug(page)).fading).toBe(true);
  const during = await canvas.screenshot({ style });
  const difference = await page.evaluate(async ([a, b]) => {
    const pixels = async (base64: string) => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0, 320, 180);
      return context.getImageData(0, 0, 320, 180).data;
    };
    const x = await pixels(a), y = await pixels(b);
    let total = 0;
    for (let i = 0; i < x.length; i++) total += Math.abs(x[i] - y[i]);
    return total / x.length;
  }, [before.toString('base64'), during.toString('base64')]);
  // Same fixed-time scene on both sides of the fade: extra tone mapping or a flipped snapshot is visible here.
  expect(difference).toBeLessThan(0.5);
});

test('Stage 4 search navigates filtered scenes and preferences survive reload on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await page.goto('/modern.html?backend=webgl2&mode=circle&time=2');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#scene-search').fill('tunnel');
  const visible = await page.locator('#mode option').evaluateAll(options => options.filter(option => !(option as HTMLOptionElement).hidden && !(option as HTMLOptionElement).disabled).map(option => (option as HTMLOptionElement).value));
  expect(visible.length).toBeGreaterThan(1);
  await page.locator('#next-mode').click();
  await expect(page.locator('#mode')).toHaveValue(visible[0]);
  await page.locator('#previous-mode').click();
  await expect(page.locator('#mode')).toHaveValue(visible[visible.length - 1]);
  await page.locator('#scene-search').fill('no scene matches this');
  await expect(page.locator('#scene-count')).toHaveText('0 scenes');
  await expect(page.locator('#next-mode')).toBeDisabled();
  await page.locator('#scene-search').press('Escape');
  await expect(page.locator('#next-mode')).toBeEnabled();
  await page.locator('#exposure').fill('1.3');
  await expect(page.locator('output[for="exposure"]')).toHaveText('1.30');
  await page.selectOption('#transition', '0');
  await page.reload();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#exposure')).toHaveValue('1.3');
  await expect(page.locator('#transition')).toHaveValue('0');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('controls-mobile.png') });
});

test('Stage 4 ignores malformed visual preferences and explicit URLs override saved output', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('visualizer.visualPreferences', JSON.stringify({ version: 1, values: {
      quality: 'missing', exposure: 'Infinity', bloom: '-10', transition: '99', motion: 'yes', 'reduced-flash': false, aa: 'smaa', 'tone-mapping': 'agx',
    } }));
  });
  await page.goto('/modern.html?backend=webgl2&mode=circle&aa=fxaa&tone=aces');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#quality')).toHaveValue('balanced');
  await expect(page.locator('#exposure')).toHaveValue('1');
  await expect(page.locator('#bloom')).toHaveValue('0.6');
  await expect(page.locator('#transition')).toHaveValue('0.35');
  await expect(page.locator('#motion')).not.toBeChecked();
  await expect(page.locator('#reduced-flash')).not.toBeChecked();
  await expect(page.locator('#aa')).toHaveValue('fxaa');
  await expect(page.locator('#tone-mapping')).toHaveValue('aces');
});

test('Stage 4 collects a short Balanced 1080p native timing smoke check', async ({ page }, info) => {
  test.skip(info.project.name !== 'stage4-webgpu');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/modern.html?backend=webgpu&mode=particles&quality=balanced');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#status')).toContainText('native WebGPU');
  await page.selectOption('#scale', '1');
  await page.locator('#synthetic').check();
  await page.locator('#hide').click();
  const measurements = [];
  const cdp = await page.context().browser()!.newBrowserCDPSession();
  const hardware = await cdp.send('SystemInfo.getInfo');
  await info.attach('gpu-info.json', { body: JSON.stringify(hardware.gpu, null, 2), contentType: 'application/json' });
  for (const mode of ['particles', 'godrays', 'boids']) {
    await page.selectOption('#mode', mode, { force: true });
    await expect.poll(async () => (await debug(page)).mode).toBe(mode);
    await page.waitForTimeout(5000);
    const timings = await page.evaluate(() => (window as unknown as { __visualizerDebug: { bench(seconds: number): Promise<import('../../src/main').BenchResult> } }).__visualizerDebug.bench(8));
    expect(timings.drawingBuffer).toEqual({ width: 1920, height: 1080 });
    expect(timings.raf.count).toBeGreaterThan(10);
    measurements.push({ mode, backend: 'webgpu', preset: 'balanced', synthetic: true, warmupSeconds: 5, sampleSeconds: 8, ...timings });
    const passes = await page.evaluate(() => {
      const r = (window as any).__visualizerDebug.renderer;
      const entries = [...r.backend.timestampQueryPool.render.timestamps] as [string, number][];
      const last = entries.at(-1)?.[0].split(':f')[1];
      return { frame: r.info.frame, memory: r.info.memory, passes: entries.filter(([key]) => key.endsWith(`:f${last}`)) };
    });
    await info.attach(`${mode}-passes.json`, { body: JSON.stringify(passes, null, 2), contentType: 'application/json' });
  }
  const file = info.outputPath('timing-smoke.json');
  await writeFile(file, JSON.stringify(measurements, null, 2));
  await info.attach('stage4-timing-smoke.json', { path: file, contentType: 'application/json' });
  for (const result of measurements) expect(result.gpu?.p95Ms, `${result.mode} submission-to-completion budget`).toBeLessThan(16.7);
});

test('Stage 4 GPU flock matches one immutable-input steering step and releases storage', async ({ page }, info) => {
  test.skip(info.project.name !== 'stage4-webgpu');
  await page.goto('/modern.html?backend=webgpu&mode=circle&time=2');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  const result = await page.evaluate(async () => {
    const flockPath = '/src/modes/gpuFlockMode.ts', qualityPath = '/src/rendering/quality.ts', simulationPath = '/src/simulations/flock.ts';
    const { createGpuFlockMode } = await import(flockPath) as typeof import('../../src/modes/gpuFlockMode');
    const { presetBudget } = await import(qualityPath) as typeof import('../../src/rendering/quality');
    const { initializeFlock } = await import(simulationPath) as typeof import('../../src/simulations/flock');
    const renderer = (window as any).__visualizerDebug.renderer;
    const mode = createGpuFlockMode(presetBudget('balanced'));
    await mode.prepare!(renderer);
    const frame = { time: 1, delta: 1 / 120, aspect: 16 / 9, hue: 0, reducedMotion: false, reducedFlash: true, response: { bass: 0, loudness: 0, impact: 0.25, bounce: 0 }, audio: { waveform: new Float32Array(1024), spectrum: new Uint8Array(512), bass: 0, mid: 0, highs: 0, rms: 0, onset: false, time: 0 }, spectrumMapping: 'linear' as const, sampleRate: 48000 };
    mode.update(frame); mode.simulate!(renderer); renderer.render(mode.scene, mode.camera);
    const sprite = mode.scene.getObjectByName('gpu-flock') as import('three/webgpu').Sprite;
    const actual = new Float32Array(await renderer.getArrayBufferAsync(sprite.geometry.getAttribute('flockStateB')));
    const before = initializeFlock(1024);
    let error = 0;
    for (let index = 0; index < before.length; index++) {
      const b = before[index]; let ax = 0, ay = 0, az = 0, vx = 0, vy = 0, vz = 0, cx = 0, cy = 0, cz = 0, found = 0;
      for (let k = 0; k < 32; k++) {
        const j = (index + k * 127 + 1) % before.length, q = before[j];
        const x = q.px - b.px, y = q.py - b.py, z = q.pz - b.pz, d2 = x * x + y * y + z * z;
        if (j === index || d2 >= 324) continue;
        found++; cx += q.px; cy += q.py; cz += q.pz; vx += q.vx; vy += q.vy; vz += q.vz;
        if (d2 > 0.0001 && d2 < 64) { const force = 18 / Math.sqrt(d2); ax -= x * force; ay -= y * force; az -= z * force; }
      }
      if (found) { ax += (vx / found - b.vx) * 0.8 + (cx / found - b.px) * 0.4; ay += (vy / found - b.vy) * 0.8 + (cy / found - b.py) * 0.4; az += (vz / found - b.vz) * 0.8 + (cz / found - b.pz) * 0.4; }
      const r = Math.max(1, Math.hypot(b.px, b.py, b.pz));
      vx = b.vx + (ax + b.px / r * 25) / 120; vy = b.vy + (ay + b.py / r * 25) / 120; vz = b.vz + (az + b.pz / r * 25) / 120;
      const cap = Math.min(1, 30 / Math.hypot(vx, vy, vz)); vx *= cap; vy *= cap; vz *= cap;
      const wrap = (n: number, h: number) => ((n + h) % (2 * h) + 2 * h) % (2 * h) - h;
      const wanted = [wrap(b.px + vx / 120, 35), wrap(b.py + vy / 120, 20), wrap(b.pz + vz / 120, 35), 0, vx, vy, vz, 0];
      for (let k = 0; k < 8; k++) error = Math.max(error, Math.abs(actual[index * 8 + k] - wanted[k]));
    }
    const countBeforePause = renderer.info.compute.calls;
    mode.update({ ...frame, reducedMotion: true }); mode.simulate!(renderer);
    const paused = countBeforePause === renderer.info.compute.calls;
    mode.dispose();
    return { error, paused, storage: renderer.info.memory.storageAttributes };
  });
  expect(result.error).toBeLessThan(0.0001); expect(result.paused).toBe(true); expect(result.storage).toBe(0);
});

test('Stage 4 never treats summed pass timestamps as elapsed GPU completion time', async ({ page }, info) => {
  test.skip(info.project.name !== 'stage4-webgpu');
  await page.goto('/modern.html?backend=webgpu&mode=circle');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.evaluate(() => { (window as any).__visualizerDebug.renderer.resolveTimestampsAsync = async () => 999; });
  await expect.poll(() => page.evaluate(() => (window as any).__visualizerDebug.frameTiming.gpuPassMs)).toBe(1998);
  const completion = await page.evaluate(() => (window as any).__visualizerDebug.frameTiming.gpuMs);
  expect(completion).toBeGreaterThan(0); expect(completion).toBeLessThan(999);
});

test('Stage 4 disposes GPU storage when a prepared selection is superseded', async ({ page }, info) => {
  test.skip(info.project.name !== 'stage4-webgpu');
  await page.goto('/modern.html?backend=webgpu&mode=circle');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.evaluate(() => (window as any).__visualizerDebug.setCompileDelay(1200));
  await page.selectOption('#mode', 'boids');
  await expect.poll(() => page.evaluate(() => (window as any).__visualizerDebug.renderer.info.memory.storageAttributes)).toBe(2);
  await page.selectOption('#mode', 'particles');
  await expect.poll(async () => (await debug(page)).mode).toBe('particles');
  expect(await page.evaluate(() => (window as any).__visualizerDebug.renderer.info.memory.storageAttributes)).toBe(0);
});
