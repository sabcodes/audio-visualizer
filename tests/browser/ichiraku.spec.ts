import { test, expect } from '@playwright/test';

test('Ichiraku is selectable and preserves its textures across mode switches', async ({ page }, info) => {
  test.skip(info.project.name !== 'compatibility');
  const errors: string[] = []; page.on('pageerror', e=>errors.push(e.message));
  await page.goto('/?backend=webgl2&mode=ichiraku');
  await expect(page.locator('#status')).toHaveAttribute('data-state','ready',{timeout:60000});
  await expect(page.locator('#mode')).toHaveValue('ichiraku');await expect(page.locator('#bloom')).toHaveValue('0.4');
  await page.locator('#mode').selectOption('circle');await expect(page.locator('#status')).toHaveAttribute('data-state','ready');
  await page.locator('#mode').selectOption('ichiraku');await expect(page.locator('#status')).toHaveAttribute('data-state','ready',{timeout:60000});
  expect(errors).toEqual([]);
});

test('Ichiraku renders all night views, changing neon palettes and beat-responsive lights', async ({ page }, info) => {
  test.skip(info.project.name !== 'compatibility');test.setTimeout(240000);
  const errors:string[]=[],captures:{name:string;data:string}[]=[],palettes=new Set<number>();
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||/Model load failed/.test(m.text()))errors.push(m.text());});
  await page.goto('/tests/browser/fixtures/ichiraku.html');await expect(page.locator('body')).toHaveAttribute('data-ready','true',{timeout:60000});
  expect(await page.evaluate(()=>(window as any).ichirakuReview.shots.length)).toBe(18);
  for(let i=0;i<18;i++)for(const phase of [0.1,0.55,0.9]){
    const state=await page.evaluate(({i,phase})=>(window as any).ichirakuReview.view(i,phase),{i,phase});
    expect(state.assetsLoaded).toBe(true);expect(state.shotIndex).toBe(i);expect(state.textures).toEqual([true,true]);
    expect(state.camera.every(Number.isFinite)).toBe(true);expect(state.calls).toBeLessThan(160);palettes.add(state.paletteIndex);
    const probe=await page.evaluate(()=>(window as any).ichirakuReview.probe());if(probe)expect(probe.distance,`${i} / ${phase} / ${probe.name}`).toBeGreaterThan(0.2);
    if(phase===0.55){const image=await page.locator('canvas').screenshot({type:'jpeg',quality:80});captures.push({name:`${state.shot} · ${state.palette}`,data:image.toString('base64')});}
  }
  expect(palettes.size).toBe(6);
  await page.evaluate(()=>(window as any).ichirakuReview.view(0,0.1));
  const pixels=await page.evaluate(()=>(window as any).ichirakuReview.pulsePixels());expect(pixels.changed).toBeGreaterThan(500);expect(pixels.high.lampIntensity).toBeGreaterThan(pixels.low.lampIntensity*1.5);
  const beat=await page.evaluate(()=>(window as any).ichirakuReview.beat());expect(beat.main).toBeGreaterThan(beat.side);
  const frozen=await page.evaluate(()=>(window as any).ichirakuReview.frozen());
  for(const key of ['camera','clock','colors','main','side','interior','steamTime','beats'])expect(frozen[key]).toEqual(beat[key]);
  const limited=await page.evaluate(()=>(window as any).ichirakuReview.beat(true,true));expect(limited.flash).toBeLessThanOrEqual(0.4);
  await page.evaluate(()=>(window as any).ichirakuReview.view(0));await page.evaluate(()=>(window as any).ichirakuReview.portrait());
  expect((await page.evaluate(()=>(window as any).ichirakuReview.pixelStats())).lit).toBeGreaterThan(5000);
  await page.locator('canvas').screenshot({path:info.outputPath('ichiraku-portrait.jpg'),type:'jpeg',quality:85});
  expect(await page.evaluate(()=>(window as any).ichirakuReview.release())).toBe(0);expect(errors).toEqual([]);
  await page.setViewportSize({width:1600,height:Math.ceil(captures.length/4)*245});
  await page.setContent(`<style>body{margin:0;background:#080a19;color:#d3c4e7;font:10px system-ui;display:grid;grid-template-columns:repeat(4,400px)}figure{margin:0;height:245px}img{width:400px;height:225px}figcaption{padding:4px 7px}</style>${captures.map(c=>`<figure><img src="data:image/jpeg;base64,${c.data}"><figcaption>${c.name}</figcaption></figure>`).join('')}`);
  await page.evaluate(()=>Promise.all([...document.images].map(img=>img.decode())));await page.screenshot({path:info.outputPath('ichiraku-camera-review.jpg'),type:'jpeg',quality:85});
});
