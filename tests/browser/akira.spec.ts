import { test, expect } from '@playwright/test';

test('Akira is selectable with its own bloom setting and survives switching modes', async ({ page }, info) => {
  test.skip(info.project.name !== 'compatibility');
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/modern.html?backend=webgl2&mode=akira');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 60000 });
  await expect(page.locator('#mode')).toHaveValue('akira'); await expect(page.locator('#bloom')).toHaveValue('0.45');
  await page.locator('#mode').selectOption('circle'); await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#mode').selectOption('akira'); await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 60000 });
  expect(errors).toEqual([]);
});

test('Akira renders all city shots, animated bike, sparks, backfires and persistent exhaust trails', async ({ page }, info) => {
  test.skip(info.project.name !== 'compatibility'); test.setTimeout(240000);
  const errors: string[] = [], characterRequests: string[] = [], captures: { name: string; data: string }[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' || /Model load failed/.test(m.text())) errors.push(m.text()); });
  page.on('request', r => { if (/nr_rider.*\.glb/.test(r.url()) && !new URL(r.url()).searchParams.has('import')) characterRequests.push(r.url()); });
  await page.goto('/tests/browser/fixtures/akira.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 60000 });
  const count = await page.evaluate(() => (window as any).akiraReview.shots.length); expect(count).toBe(30);
  let sparkShots = 0;
  for (let i = 0; i < count; i++) {
    const state = await page.evaluate(i => (window as any).akiraReview.view(i), i);
    expect(state.shotIndex).toBe(i); expect(state.assetsLoaded).toBe(true); expect(state.riderPresent).toBe(false);
    for (const name of ['frontWheel', 'rearWheel', 'outlet', 'camera']) expect(state[name].every(Number.isFinite)).toBe(true);
    expect(state.calls).toBeLessThan(160); expect(state.trailSamples).toBeGreaterThan(30);
    if (state.effects.sparks > 0) sparkShots++;
    if (state.motion === 'wheelie') expect(state.frontWheel[1]).toBeGreaterThan(state.rearWheel[1] + 0.5);
    if (i === 8) { const pixels = await page.evaluate(() => (window as any).akiraReview.pixels('trail')); expect(pixels.changed).toBeGreaterThan(30); expect(pixels.lit).toBeGreaterThan(30000); }
    if ([0,1,4,6,8,10,11,14,15,16,19,20,24,25,26,27].includes(i)) {
      const buffer = await page.locator('canvas').screenshot({ type: 'jpeg', quality: 75 }); captures.push({name: state.shot, data: buffer.toString('base64')});
    }
  }
  expect(sparkShots).toBeGreaterThanOrEqual(8); expect(characterRequests).toEqual([]);
  await page.evaluate(() => (window as any).akiraReview.view(8,0.15));
  const beat = await page.evaluate(() => (window as any).akiraReview.beat()); expect(beat.effects.blast).toBeGreaterThan(0.5);
  expect((await page.evaluate(() => (window as any).akiraReview.pixels('flame'))).changed).toBeGreaterThan(30);
  const frozen = await page.evaluate(() => (window as any).akiraReview.frozen());
  for (const key of ['elapsed', 'travel', 'wheelRotation', 'bikePosition', 'camera', 'effects', 'trailSamples']) expect(frozen[key]).toEqual(beat[key]);
  const limited = await page.evaluate(() => (window as any).akiraReview.beat(true)); expect(limited.effects.blast).toBeLessThanOrEqual(0.4);
  await page.evaluate(() => (window as any).akiraReview.portrait());
  await page.locator('canvas').screenshot({ path: info.outputPath('akira-portrait.jpg'), type: 'jpeg', quality: 80 });
  expect(await page.evaluate(() => (window as any).akiraReview.release())).toBe(0); expect(errors).toEqual([]);
  await page.setViewportSize({width:1600,height:980});
  await page.setContent(`<style>body{margin:0;background:#07111c;color:#bed6de;font:11px system-ui;display:grid;grid-template-columns:repeat(4,400px)}figure{margin:0;height:245px}img{width:400px;height:225px}figcaption{padding:4px 8px}</style>${captures.map(c=>`<figure><img src="data:image/jpeg;base64,${c.data}"><figcaption>${c.name}</figcaption></figure>`).join('')}`);
  await page.evaluate(() => Promise.all([...document.images].map(img => img.decode())));
  await page.screenshot({path:info.outputPath('akira-camera-review.jpg'),type:'jpeg',quality:85});
});
