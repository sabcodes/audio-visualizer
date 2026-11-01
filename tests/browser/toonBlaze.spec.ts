import { test, expect, chromium } from '@playwright/test';

test('Toon Blaze loads the supplied car and renders flame, smoke and embers without shader errors', async ({ page }, info) => {
  test.skip(info.project.name !== 'compatibility');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.text().includes('Model load failed')) errors.push(message.text()); });
  await page.goto('/tests/browser/fixtures/toonBlaze.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready','true');
  const advance = (seconds: number, music = false, reducedMotion = false) => page.evaluate(({seconds,music,reducedMotion}) =>
    (window as unknown as {toonBlazeReview:{advance(s:number,m:boolean,r:boolean):{car:boolean;wheels:number;flames:number;smoke:number}}})
      .toonBlazeReview.advance(seconds,music,reducedMotion), {seconds,music,reducedMotion});
  const quiet = await advance(3);
  expect(quiet.car).toBe(true); expect(quiet.wheels).toBe(4);
  expect(quiet.flames).toBeGreaterThan(50); expect(quiet.smoke).toBe(quiet.flames);
  const canvas = page.locator('canvas');
  await canvas.screenshot({path:info.outputPath('quiet.png')});
  await advance(5,true);
  await canvas.screenshot({path:info.outputPath('music.png')});
  // Freeze at silence after audio levels settle: noise, buoyancy and particles must all stop moving.
  await advance(12,false,true);
  const frozen = await canvas.screenshot();
  await advance(2,false,true);
  expect((await canvas.screenshot()).equals(frozen), 'reduced motion freezes the rendered scene').toBe(true);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as {toonBlazeReview:{dispose():number}}).toonBlazeReview.dispose())).toBe(0);
});

test('Toon Blaze renders the balanced particle budget on WebGPU', async ({baseURL},info) => {
  test.skip(info.project.name !== 'compatibility');
  const browser = await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});
  try {
    const page = await browser.newPage({baseURL,viewport:{width:960,height:540}});
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' || message.text().includes('Model load failed')) errors.push(message.text()); });
    await page.goto('/tests/browser/fixtures/toonBlaze.html?backend=webgpu&quality=balanced');
    await expect(page.locator('body')).toHaveAttribute('data-ready','true');
    const backend = await page.evaluate(() => (window as unknown as {toonBlazeReview:{backend:string}}).toonBlazeReview.backend);
    expect(backend).toBe('webgpu');
    await page.evaluate(() => (window as unknown as {toonBlazeReview:{advance(s:number,m:boolean):unknown}}).toonBlazeReview.advance(8,true));
    await page.locator('canvas').screenshot({path:info.outputPath('webgpu-balanced.png')});
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
});
