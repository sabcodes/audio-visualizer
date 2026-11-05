import { test, expect } from '@playwright/test';
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

for (const id of ['nightRider','nightRiderV2']) test(`${id} is selectable in the visualizer and survives a mode switch`, async ({ page }, info) => {
  test.skip(info.project.name !== 'compatibility');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/?backend=webgl2&mode=${id}`);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 60000 });
  await expect(page.locator('#mode')).toHaveValue(id);
  await expect(page.locator('#bloom')).toHaveValue('0.35');
  await page.locator('#mode').selectOption('circle');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#mode').selectOption(id);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready', { timeout: 60000 });
  expect(errors).toEqual([]);
});

test('Night Rider V2 animates the supplied character through all 32 shots with bike effects', async ({page},info) => {
  test.skip(info.project.name !== 'compatibility');test.setTimeout(240000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'||m.text().includes('Model load failed'))errors.push(m.text());});
  await page.goto('/tests/browser/fixtures/nightRider.html?v2');
  await expect(page.locator('body')).toHaveAttribute('data-ready','true',{timeout:60000});
  const captures:{name:string;data:string}[]=[];
  let sparkShots=0;
  for(let i=0;i<32;i++) {
    let state=await page.evaluate(i=>(window as any).nightRiderReview.view(i,i===24?.1:.5),i);
    expect(state.assetsLoaded).toBe(true);expect(state.riderPresent).toBe(true);expect(state.shotIndex).toBe(i);
    expect(state.riderBones).toHaveLength(15);expect(state.riderBones.flat().every(Number.isFinite)).toBe(true);
    expect(state.calls).toBeLessThan(200);
    if(state.effects.sparks>0)sparkShots++;
    if([0,5,7,14,26,27].includes(i)) {
      const rig=await page.evaluate(()=>(window as any).nightRiderReview.rigHealth());
      expect(rig.finite).toBe(true);expect(rig.maxWeightError).toBeLessThan(.00001);expect(rig.maxEdge).toBeLessThan(.3);
    }
    if(i===7)expect(state.riderBones[0][1]).toBeGreaterThan(.9); // rider inherits authored bike pitch
    if(i===24) {
      state=await page.evaluate(()=>(window as any).nightRiderReview.beat());
      expect(state.effects.boost).toBeGreaterThan(.5);expect(state.effects.blast).toBeGreaterThan(.5);
      expect((await page.evaluate(()=>(window as any).nightRiderReview.flamePixels())).changed).toBeGreaterThan(50);
    }
    if(process.env.CAPTURE_NIGHT_RIDER) {
      const buffer=await page.locator('canvas').screenshot({path:info.outputPath(`v2-shot-${i}.jpg`),type:'jpeg',quality:80});
      captures.push({name:state.shot,data:buffer.toString('base64')});
    }
  }
  expect(sparkShots).toBeGreaterThanOrEqual(6);
  const before=await page.evaluate(()=>(window as any).nightRiderReview.state());
  const frozen=await page.evaluate(()=>(window as any).nightRiderReview.frozen());
  expect(frozen.riderBones).toEqual(before.riderBones);expect(frozen.riderVertex).toEqual(before.riderVertex);
  expect(await page.evaluate(()=>(window as any).nightRiderReview.release())).toEqual({children:0});expect(errors).toEqual([]);
  if(process.env.CAPTURE_NIGHT_RIDER) {
    const folder=resolve('docs/references/night-rider-v2');mkdirSync(folder,{recursive:true});
    await page.setViewportSize({width:1600,height:1952});
    await page.setContent(`<style>body{margin:0;background:#070b15;color:#b5d7e4;font:12px system-ui;display:grid;grid-template-columns:repeat(4,400px)}figure{margin:0;height:244px}img{width:400px;height:225px}figcaption{padding:0 8px}</style>${captures.map(c=>`<figure><img src="data:image/jpeg;base64,${c.data}"><figcaption>${c.name}</figcaption></figure>`).join('')}`);
    await page.evaluate(()=>Promise.all([...document.images].map(img=>img.decode())));
    await page.screenshot({path:resolve(folder,'camera-review.jpg'),type:'jpeg',quality:85});
    copyFileSync(info.outputPath('v2-shot-5.jpg'),resolve(folder,'rider-detail.jpg'));
  }
});

test('Night Rider renders all bike-only shots and drift effects without loading a rider', async ({ page }, info) => {
  test.skip(info.project.name !== 'compatibility');
  test.setTimeout(240000);
  const errors: string[] = [];
  const riderRequests: string[] = [];
  // Vite serves ?import&url as a tiny JS module; count only actual character binary loads.
  page.on('request', (request) => { if (/nr_rider.*\.glb/.test(request.url()) && !new URL(request.url()).searchParams.has('import')) riderRequests.push(request.url()); });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' || /Model load failed/.test(message.text())) errors.push(message.text()); });
  await page.goto('/tests/browser/fixtures/nightRider.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 60000 });
  const captures: {name:string;data:string}[] = [];
  const count = await page.evaluate(() => (window as any).nightRiderReview.shots.length);
  expect(count).toBe(32);
  let sparkShots = 0;
  for (let i = 0; i < count; i++) {
    let state = await page.evaluate((index) => (window as any).nightRiderReview.view(index,index===24?0.2:0.5), i);
    if (i === 24) state = await page.evaluate(() => (window as any).nightRiderReview.beat());
    expect(state.assetsLoaded).toBe(true);
    expect(state.riderPresent).toBe(false);
    expect(state.bikeMeshes).toBeGreaterThan(120);
    expect(state.frontWheel.every(Number.isFinite)).toBe(true);
    expect(state.outlet.every(Number.isFinite)).toBe(true);
    expect(state.shotIndex).toBe(i);
    if (state.effects.sparks > 0) sparkShots++;
    if (state.motion === 'stoppie') expect(state.rearWheel[1]).toBeGreaterThan(0.7);
    if (state.motion === 'jump') expect(state.bikePosition[1]).toBeGreaterThan(0.3);
    if (i === 24) expect(state.effects.blast).toBeGreaterThan(0.5);
    expect(state.calls).toBeLessThan(200);
    const buffer = await page.locator('canvas').screenshot({path:info.outputPath(`shot-${i}.jpg`),type:'jpeg',quality:76});
    captures.push({name:state.shot,data:buffer.toString('base64')});
  }
  const before = await page.evaluate(() => (window as any).nightRiderReview.state());
  const frozen = await page.evaluate(() => (window as any).nightRiderReview.frozen());
  expect(frozen.clipTime).toEqual(before.clipTime);
  expect(frozen.bikePosition).toEqual(before.bikePosition);
  expect(sparkShots).toBeGreaterThanOrEqual(6);
  expect(riderRequests).toEqual([]);
  expect(await page.evaluate(() => (window as any).nightRiderReview.release())).toEqual({children:0});
  expect(errors).toEqual([]);
  if (process.env.CAPTURE_NIGHT_RIDER) {
    await page.setViewportSize({width:1600,height:1952});
    await page.setContent(`<style>body{margin:0;background:#070b15;color:#b5d7e4;font:12px system-ui;display:grid;grid-template-columns:repeat(4,400px)}figure{margin:0;height:244px}img{width:400px;height:225px}figcaption{padding:0 8px}</style>${captures.map(c=>`<figure><img src="data:image/jpeg;base64,${c.data}"><figcaption>${c.name}</figcaption></figure>`).join('')}`);
    await page.evaluate(() => Promise.all([...document.images].map(img=>img.decode())));
    const folder=resolve('docs/references/night-rider'); mkdirSync(folder,{recursive:true});
    await page.screenshot({path:resolve(folder,'camera-review.jpg'),type:'jpeg',quality:85});
    copyFileSync(info.outputPath('shot-24.jpg'),resolve(folder,'exhaust-detail.jpg'));
    copyFileSync(info.outputPath('shot-5.jpg'),resolve(folder,'drift-detail.jpg'));
  }
});

test('Night Rider backfires on beats, limits reduced flash, and freezes its active effects', async ({ page }, info) => {
  test.skip(info.project.name !== 'compatibility');
  await page.goto('/tests/browser/fixtures/nightRider.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', {timeout:60000});
  const quiet = await page.evaluate(() => (window as any).nightRiderReview.view(24,0.1));
  expect(quiet.effects.bursts).toBe(0);
  const beat = await page.evaluate(() => (window as any).nightRiderReview.beat());
  expect(beat.effects.blast).toBeGreaterThan(0.5);
  expect(beat.effects.boost).toBeGreaterThan(0.5);
  const flame = await page.evaluate(() => (window as any).nightRiderReview.flamePixels());
  expect(flame.changed, JSON.stringify(flame)).toBeGreaterThan(50);
  const frozen = await page.evaluate(() => (window as any).nightRiderReview.frozen());
  expect(frozen.clipTime).toBe(beat.clipTime); expect(frozen.effects.blast).toBe(beat.effects.blast);
  const limited = await page.evaluate(() => (window as any).nightRiderReview.beat(true));
  expect(limited.effects.blast).toBeLessThanOrEqual(0.4);
  expect(limited.effects.blast).toBeGreaterThan(0);
});
