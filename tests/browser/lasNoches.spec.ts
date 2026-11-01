import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

interface SceneState { shot: string; weather: { smoke: number; clouds: number; fire: number; rain: number }; gas: boolean; fire: boolean; rain: boolean; grove: number; houses: number }
interface Review { shots: string[]; state(): SceneState; advance(seconds: number, music?: boolean): SceneState }
const advance = (page: Page, seconds: number, music = true) => page.evaluate(({ seconds, music }) =>
  (window as unknown as { lasNochesReview: Review }).lasNochesReview.advance(seconds, music), { seconds, music });

test('Las Noches starts lasting rain with green vents and retains its sky glow in silence', async ({ page }, info) => {
  test.skip(info.project.name !== 'compatibility');
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tests/browser/fixtures/lasNoches.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const quiet = await advance(page, 0, false);
  expect(quiet).toMatchObject({ gas: false, fire: false, rain: false, grove: 28, houses: 40 });
  await page.locator('canvas').screenshot({path:info.outputPath('quiet.jpg'),type:'jpeg',quality:75});
  for (const [seconds, effect, file] of [[5, 'gas', 'first-vent-rain'], [23, 'fire', 'flame-crest'], [21, 'fire', 'sustained-tendrils']] as const) {
    const state = await advance(page, seconds);
    expect(state[effect], file).toBe(true);
    expect(state.rain).toBe(true);
    expect(state.weather.clouds).toBeGreaterThan(0.1);
    if (effect === 'fire') expect(state.gas).toBe(false);
    await page.locator('canvas').screenshot({path:info.outputPath(`${file}.jpg`),type:'jpeg',quality:75});
  }
  const resting = await advance(page, 17);
  expect(resting).toMatchObject({gas:false,fire:false,rain:true});
  const silent = await advance(page, 20, false);
  expect(silent).toMatchObject({gas:false,fire:false,rain:true});
  expect(silent.weather.clouds).toBeGreaterThan(0.59);
  await page.locator('canvas').screenshot({path:info.outputPath('lasting-rain.jpg'),type:'jpeg',quality:75});
  expect(errors).toEqual([]);
});

test('Las Noches renders every camera location without shader or asset errors', async ({ page }, info) => {
  test.skip(info.project.name !== 'compatibility' || !process.env.CAPTURE_LAS_NOCHES);
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tests/browser/fixtures/lasNoches.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const names = await page.evaluate(() => (window as unknown as { lasNochesReview: Review }).lasNochesReview.shots);
  const captures: {name:string;data:string}[] = [];
  for (let i = 0; i < names.length; i++) {
    const state = await advance(page, i === 0 ? 1 : 10.1, false);
    expect(state.shot).toBe(names[i]);
    const buffer = await page.locator('canvas').screenshot({path:info.outputPath(`view-${i}.jpg`),type:'jpeg',quality:70});
    captures.push({name:state.shot,data:buffer.toString('base64')});
  }
  expect(errors).toEqual([]);
  // A compact project-local review sheet; no desktop capture or personal browser session is involved.
  await page.setViewportSize({width:1280,height:Math.ceil(names.length/4)*200});
  await page.setContent(`<style>body{margin:0;background:#090d0c;color:#bac8c1;font:12px system-ui;display:grid;grid-template-columns:repeat(4,320px)}figure{margin:0;height:200px}img{width:320px;height:180px}figcaption{padding:0 8px}</style>${captures.map((c)=>`<figure><img src="data:image/jpeg;base64,${c.data}"><figcaption>${c.name}</figcaption></figure>`).join('')}`);
  await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
  const folder = resolve('docs/references/las-noches'); mkdirSync(folder,{recursive:true});
  await page.screenshot({path:resolve(folder,'camera-review.jpg'),type:'jpeg',quality:78});
});
