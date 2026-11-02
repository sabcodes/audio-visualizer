import { test, expect } from '@playwright/test';

test('Water 7 is selectable and survives switching away and back', async ({ page }, info) => {
  test.skip(info.project.name !== 'compatibility');
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/modern.html?backend=webgl2&mode=water7');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 60000 });
  await expect(page.locator('#mode')).toHaveValue('water7'); await expect(page.locator('#bloom')).toHaveValue('0.2');
  await page.locator('#mode').selectOption('circle'); await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#mode').selectOption('water7'); await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 60000 });
  expect(errors).toEqual([]);
});

test('Water 7 renders every city view, animated water, surf and music response', async ({ page }, info) => {
  test.skip(info.project.name !== 'compatibility'); test.setTimeout(240000);
  const errors: string[] = [], captures: { name: string; data: string }[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' || /Model load failed/.test(m.text())) errors.push(m.text()); });
  await page.goto('/tests/browser/fixtures/water7.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 60000 });
  const count = await page.evaluate(() => (window as any).water7Review.shots.length); expect(count).toBe(24);
  for (let i = 0; i < count; i++) for (const phase of (i === 4 ? [0.1, 0.2, 0.55, 0.9] : [0.1, 0.55, 0.9])) {
    const state = await page.evaluate(({i,phase}) => (window as any).water7Review.view(i,phase), {i,phase});
    const probe = await page.evaluate(() => (window as any).water7Review.probe());
    if (probe[0]) expect(probe[0].distance, `${i} / ${phase} / ${probe[0].name}`).toBeGreaterThan(0.8);
    expect(state.shotIndex).toBe(i); expect(state.assetsLoaded).toBe(true); expect(state.camera.every(Number.isFinite)).toBe(true);
    expect(state.calls).toBeLessThan(650); expect(state.waveHeight).toBeGreaterThan(1); expect(state.boat.every(Number.isFinite)).toBe(true);
    if ((i === 4 ? phase === 0.2 : phase === 0.55) && i !== 15) {
      const buffer = await page.locator('canvas').screenshot({type:'jpeg',quality:75}); captures.push({name:state.shot,data:buffer.toString('base64')});
    }
  }
  await page.evaluate(() => (window as any).water7Review.view(4,0.2));
  expect(await page.evaluate(() => (window as any).water7Review.change())).toBeGreaterThan(500);
  const beat=await page.evaluate(() => (window as any).water7Review.beat()); expect(beat.pulse).toBe(1);
  const frozen=await page.evaluate(() => (window as any).water7Review.frozen());
  for(const key of ['camera','clock','waterTime','waveHeight','boat','pulse'])expect(frozen[key]).toEqual(beat[key]);
  const limited=await page.evaluate(() => (window as any).water7Review.beat(true));expect(limited.pulse).toBe(0.3);
  await page.evaluate(() => (window as any).water7Review.view(0)); await page.evaluate(() => (window as any).water7Review.portrait());
  await page.locator('canvas').screenshot({path:info.outputPath('water7-portrait.jpg'),type:'jpeg',quality:85});
  expect(await page.evaluate(() => (window as any).water7Review.release())).toBe(0);expect(errors).toEqual([]);
  await page.setViewportSize({width:1600,height:Math.ceil(captures.length/4)*245});
  await page.setContent(`<style>body{margin:0;background:#132838;color:#d4e8f0;font:11px system-ui;display:grid;grid-template-columns:repeat(4,400px)}figure{margin:0;height:245px}img{width:400px;height:225px}figcaption{padding:4px 8px}</style>${captures.map(c=>`<figure><img src="data:image/jpeg;base64,${c.data}"><figcaption>${c.name}</figcaption></figure>`).join('')}`);
  await page.evaluate(() => Promise.all([...document.images].map(img=>img.decode())));
  await page.screenshot({path:info.outputPath('water7-camera-review.jpg'),type:'jpeg',quality:85});
});
