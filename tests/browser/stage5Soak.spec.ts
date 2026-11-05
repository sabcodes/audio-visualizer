import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { tone } from './fixtures/releaseAudio';

const snapshot = (page: Page) => page.evaluate(() => {
  const d = (window as any).__visualizerDebug;
  return { mode: d.activeMode, fading: d.transitioning, memory: { ...d.renderer.info.memory }, frame: d.renderer.info.render.calls,
    audit: { ...(window as any).releaseAudit } };
});

test('30-minute physical-GPU switching, audio replacement and resize reliability @soak', async ({ page, browser }, info) => {
  test.skip(process.env.STAGE5_SOAK !== '1' || !['release-webgpu', 'release-webgl2'].includes(info.project.name));
  test.setTimeout(38 * 60 * 1000);
  const backend = info.project.name === 'release-webgpu' ? 'webgpu' : 'webgl2';
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text()); });
  await page.route('**/api/settings', route => route.fulfill({ json: { version: 1, favoriteModes: [] } }));
  await page.addInitScript(() => {
    const audit = { contexts: 0, sources: 0, urls: 0, revoked: 0, pendingFrames: 0, maxPendingFrames: 0 };
    Object.assign(window, { releaseAudit: audit });
    const Context = AudioContext;
    window.AudioContext = class extends Context {
      constructor(...args: ConstructorParameters<typeof AudioContext>) { super(...args); audit.contexts++; }
      override createMediaElementSource(media: HTMLMediaElement) { audit.sources++; return super.createMediaElementSource(media); }
    };
    const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
    URL.createObjectURL = blob => { audit.urls++; return create(blob); };
    URL.revokeObjectURL = url => { audit.revoked++; revoke(url); };
    const request = requestAnimationFrame, cancel = cancelAnimationFrame, pending = new Set<number>();
    window.requestAnimationFrame = callback => {
      const id = request(time => { pending.delete(id); audit.pendingFrames = pending.size; callback(time); });
      pending.add(id); audit.pendingFrames = pending.size; audit.maxPendingFrames = Math.max(audit.maxPendingFrames, pending.size);
      return id;
    };
    window.cancelAnimationFrame = id => { pending.delete(id); audit.pendingFrames = pending.size; cancel(id); };
  });
  const cdp = await browser.newBrowserCDPSession();
  const hardware = await cdp.send('SystemInfo.getInfo');
  expect(JSON.stringify(hardware.gpu.devices)).not.toMatch(/swiftshader|llvmpipe|software rasterizer/i);
  await page.goto(`/?backend=${backend}&mode=circle&quality=balanced`);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#status')).toContainText(backend === 'webgpu' ? 'native WebGPU' : 'WebGL2 compatibility');
  await page.selectOption('#scale', '0.5'); await page.selectOption('#transition', '0');
  const modes = await page.locator('#mode option').evaluateAll(options => options.filter(option => !(option as HTMLOptionElement).disabled).map(option => (option as HTMLOptionElement).value));
  const original = ['circle', 'spiral', 'star', 'cube', 'particles', 'errors', 'lissajous', 'boids', 'fftTunnel', 'kaleidoPlane', 'city', 'glitchRing', 'vjRings', 'neonKaleido', 'starTunnel', 'bloomTunnel', 'glitchFX', 'godrays'];
  const report = { schemaVersion: 1, startedAt: new Date().toISOString(), backend, browser: browser.version(), gpu: hardware.gpu.devices,
    requestedSeconds: 1800, elapsedSeconds: 0, complete: false, currentMode: '', allModes: modes, rounds: [] as any[], errors };
  await mkdir('benchmark-results/stage5', { recursive: true });
  const file = `benchmark-results/stage5/${backend}-soak.json`;
  await writeFile(file, JSON.stringify(report, null, 2));
  const start = performance.now();
  let round = 0;
  while (performance.now() - start < 1800000) {
    // First two rounds exercise every available mode; later rounds rotate extra families
    // alongside all 18 originals, with a common final scene for memory comparisons.
    const cycle = round < 2 ? modes : [...original, ...modes.slice((round * 7) % modes.length, (round * 7) % modes.length + 7)];
    await page.locator('#audio-upload').setInputFiles(tone(`round-${round}.wav`));
    await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'ready');
    await page.locator('#seek-slider').fill('5');
    await page.locator('#play-btn').click({ force: true });
    for (const mode of [...cycle, 'circle']) {
      report.currentMode = mode;
      await writeFile(file, JSON.stringify(report, null, 2));
      await page.selectOption('#mode', mode, { force: true });
      await expect.poll(async () => (await snapshot(page)).mode, { timeout: 120000 }).toBe(mode);
      await page.waitForTimeout(150);
      await expect(page.locator('#status'), `${backend}/${round}/${mode}`).toHaveAttribute('data-state', 'ready');
      await expect(page.locator('#viewport-errors')).toHaveCount(mode === 'errors' ? 1 : 0);
    }
    await page.setViewportSize({ width: 390, height: 740 }); await page.waitForTimeout(150);
    await page.setViewportSize({ width: 1280, height: 720 }); await page.waitForTimeout(500);
    const state = await snapshot(page);
    report.rounds.push({ round, elapsedSeconds: (performance.now() - start) / 1000, ...state });
    report.elapsedSeconds = (performance.now() - start) / 1000;
    await writeFile(file, JSON.stringify(report, null, 2));
    expect(state.audit.contexts).toBe(1); expect(state.audit.sources).toBe(1);
    expect(state.audit.urls - state.audit.revoked).toBe(1);
    // Three.js owns a bookkeeping rAF; WebGL also polls shader compilation on rAF.
    expect(state.audit.maxPendingFrames).toBeLessThanOrEqual(backend === 'webgl2' ? 3 : 2);
    expect(state.audit.pendingFrames).toBe(2);
    expect(state.memory.storageAttributes).toBe(0);
    await expect(page.locator('canvas')).toHaveCount(1);
    if (round >= 2) {
      const reference = report.rounds[1].memory;
      for (const key of ['geometries', 'textures', 'renderTargets', 'storageAttributes']) expect(state.memory[key], key).toBe(reference[key]);
      expect(state.memory.total).toBeLessThanOrEqual(reference.total + 65536);
    }
    expect(errors).toEqual([]);
    console.log(`${backend}: round ${round}, ${(report.elapsedSeconds / 60).toFixed(1)} min; ${state.memory.total} estimated GPU bytes; ${cycle.length} modes`);
    round++;
    // Actual wall time, never a clock fast-forward. Keep output files small.
    for (let second = 0; second < 10 && performance.now() - start < 1800000; second++) await page.waitForTimeout(1000);
  }
  await page.locator('#restart').click({ force: true });
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('canvas')).toHaveCount(1);
  // Non-cached navigation releases the file URL, graph, overlays and renderer.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  await expect(page.locator('canvas')).toHaveCount(0);
  const finalAudit = await page.evaluate(() => (window as any).releaseAudit);
  expect(finalAudit.urls).toBe(finalAudit.revoked); expect(finalAudit.pendingFrames).toBe(0);
  expect(errors).toEqual([]);
  Object.assign(report, { complete: true, elapsedSeconds: (performance.now() - start) / 1000, finalAudit, finishedAt: new Date().toISOString() });
  await writeFile(file, JSON.stringify(report, null, 2));
  await info.attach(`${backend}-soak.json`, { path: file, contentType: 'application/json' });
});
