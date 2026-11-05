import { test, expect } from '@playwright/test';

test('swamp ogre renders expressive beat poses, jumps, club swings and a mouth-attached laser', async ({ page }, info) => {
  test.skip(!['compatibility', 'ogre-webgpu'].includes(info.project.name)); test.setTimeout(180000);
  const errors: string[] = [], captures: { name: string; data: string }[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' || /Model load failed/.test(m.text())) errors.push(m.text()); });
  await page.goto(`/tests/browser/fixtures/giant.html?backend=${info.project.name === 'ogre-webgpu' ? 'webgpu' : 'webgl2'}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 60000 });
  const initial = await page.evaluate(() => (window as any).giantReview.state());
  expect(initial.assetsLoaded).toBe(true);
  expect(initial.backend).toBe(info.project.name === 'ogre-webgpu' ? 'webgpu' : 'webgl2');
  const capture = async (name: string) => { captures.push({ name, data: (await page.locator('canvas').screenshot({ path: info.outputPath(`ogre-${captures.length}.jpg`), type: 'jpeg', quality: 85 })).toString('base64') }); };
  await capture('Rebuilt ogre');
  let maxJump = 0, sawLaser = false;
  for (let beat = 1; beat <= 8; beat++) {
    const samples = beat === 3 || beat === 7 ? 24 : 15;
    const state = await page.evaluate(n => (window as any).giantReview.beat(n), samples);
    expect(state.beats).toBe(beat); expect(state.calls).toBeLessThan(180);
    expect(state.camera.every(Number.isFinite)).toBe(true); maxJump = Math.max(maxJump, state.jumpHeight);
    if (state.action === 'wave') expect(state.hand[1]).toBeGreaterThan(7);
    if (state.action === 'laser roar') {
      sawLaser = true; expect(state.beam).toBeGreaterThan(0.5); expect(state.jaw).toBeGreaterThan(0.6);
      expect(state.laserOrigin).toEqual(state.mouth);
      expect((await page.evaluate(() => (window as any).giantReview.laserPixels())).changed).toBeGreaterThan(300);
    }
    const rig = await page.evaluate(() => (window as any).giantReview.rigHealth());
    expect(rig.finite).toBe(true); expect(rig.maxEdge).toBeLessThan(1.7); expect(rig.minFoot).toBeGreaterThan(0.1);
    await capture(`Beat ${beat} · ${state.action}`);
    await page.evaluate(n => (window as any).giantReview.advance(n), 30 - samples);
  }
  expect(maxJump).toBeGreaterThan(1); expect(sawLaser).toBe(true);
  const before = await page.evaluate(() => (window as any).giantReview.state());
  const frozen = await page.evaluate(() => (window as any).giantReview.frozen());
  for (const key of ['clock', 'head', 'hand', 'club', 'camera', 'position', 'jaw']) expect(frozen[key]).toEqual(before[key]);
  await page.evaluate(() => (window as any).giantReview.beat(15, true));
  await page.evaluate(() => (window as any).giantReview.advance(15));
  for (let i = 0; i < 3; i++) { await page.evaluate(() => (window as any).giantReview.beat(15, true)); if (i < 2) await page.evaluate(() => (window as any).giantReview.advance(15)); }
  expect((await page.evaluate(() => (window as any).giantReview.state())).flash).toBeLessThanOrEqual(0.4);
  await page.evaluate(() => (window as any).giantReview.advance(100));
  await page.evaluate(() => (window as any).giantReview.detail()); await capture('Face and mouth detail');
  await page.locator('canvas').screenshot({ path: info.outputPath('ogre-detail.jpg'), type: 'jpeg', quality: 90 });
  await page.evaluate(() => (window as any).giantReview.portrait());
  await page.locator('canvas').screenshot({ path: info.outputPath('ogre-portrait.jpg'), type: 'jpeg', quality: 85 });
  expect(await page.evaluate(() => (window as any).giantReview.release())).toBe(0); expect(errors).toEqual([]);
  await page.setViewportSize({ width: 1600, height: Math.ceil(captures.length / 4) * 292 });
  await page.setContent(`<style>body{margin:0;background:#07130d;color:#cfdfd3;font:12px system-ui;display:grid;grid-template-columns:repeat(4,400px)}figure{margin:0;height:292px}img{width:400px;height:267px}figcaption{padding:3px 8px}</style>${captures.map(c => `<figure><img src="data:image/jpeg;base64,${c.data}"><figcaption>${c.name}</figcaption></figure>`).join('')}`);
  await page.evaluate(() => Promise.all([...document.images].map(img => img.decode())));
  await page.screenshot({ path: info.outputPath('ogre-review.jpg'), type: 'jpeg', quality: 88 });
});

test('swamp ogre stays selectable after leaving and reopening the mode', async ({ page }, info) => {
  test.skip(!['compatibility', 'ogre-webgpu'].includes(info.project.name));
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`/?backend=${info.project.name === 'ogre-webgpu' ? 'webgpu' : 'webgl2'}&mode=swampGiant`);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 60000 });
  const active = () => page.evaluate(() => (window as any).__visualizerDebug.activeMode);
  await expect.poll(active).toBe('swampGiant');
  await page.locator('#mode').selectOption('circle'); await expect.poll(active).toBe('circle');
  await page.locator('#mode').selectOption('swampGiant'); await expect.poll(active, { timeout: 60000 }).toBe('swampGiant');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  expect(errors).toEqual([]);
});
