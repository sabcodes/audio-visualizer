import { test, expect, chromium, type Page } from '@playwright/test';
interface State { assetsLoaded: boolean; ship: boolean; shot: string; shotIndex: number; maneuver: string; pulse: number; activeLasers: number; actor: number[]; planet: number; exhaustLength: number; thrust: number }
interface Review { backend: string; shots: {name:string;seconds:number}[]; state():State; advance(s:number,b?:number,r?:boolean,f?:boolean):Promise<State>; step(onset:boolean,impact?:number):Promise<State>; portrait():Promise<State>; dispose():number }
const advance = (page:Page, seconds:number, bounce=0, motion=false, flash=false) => page.evaluate(({seconds,bounce,motion,flash}) =>
  (window as unknown as {spaceShipReview:Review}).spaceShipReview.advance(seconds,bounce,motion,flash),{seconds,bounce,motion,flash});

test('Space Ship renders every flight angle, twin lasers and audio-reactive space on WebGL2', async ({page},info) => {
  test.skip(info.project.name !== 'compatibility');test.setTimeout(180000);
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'||m.text().includes('Model load failed'))errors.push(m.text());});
  await page.goto('/tests/browser/fixtures/spaceShip.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready','true');
  expect(await advance(page,0)).toMatchObject({assetsLoaded:true,ship:true});
  const shots = await page.evaluate(()=>(window as unknown as {spaceShipReview:Review}).spaceShipReview.shots);
  let elapsed=0;
  for(let i=0;i<shots.length;i++){
    const state=await advance(page,shots[i].seconds/2-elapsed,0.8);
    elapsed=shots[i].seconds/2;
    expect(state.shot,shots[i].name).toBe(shots[i].name);
    if(state.maneuver==='lasers')expect(state.activeLasers).toBeGreaterThan(0);
    if(state.maneuver==='dodge')expect(state.actor[0]).toBeGreaterThan(7);
    await page.locator('canvas').screenshot({path:info.outputPath(`angle-${i}.jpg`),type:'jpeg',quality:75});
    await advance(page,shots[i].seconds-elapsed+0.1);elapsed=0.1;
  }
  const quiet=await advance(page,3,0,true), music=await advance(page,0.6,1,true);
  expect(music.pulse).toBeGreaterThan(quiet.pulse+0.8);
  expect(music.actor).toEqual(quiet.actor);
  const gentle=await advance(page,3,1,true,true);expect(gentle.pulse).toBeLessThan(0.21);
  await advance(page,12,0,true,true);
  const frozen=await page.locator('canvas').screenshot();
  await advance(page,2,0,true,true);
  const still = await page.locator('canvas').screenshot();
  if (!still.equals(frozen)) {
    await info.attach('frozen-before', { body: frozen, contentType: 'image/png' });
    await info.attach('frozen-after', { body: still, contentType: 'image/png' });
  }
  expect(still.equals(frozen)).toBe(true);
  await page.evaluate(()=>(window as unknown as {spaceShipReview:Review}).spaceShipReview.portrait());
  await page.locator('canvas').screenshot({path:info.outputPath('portrait.jpg'),type:'jpeg',quality:75});
  expect(errors).toEqual([]);
  expect(await page.evaluate(()=>(window as unknown as {spaceShipReview:Review}).spaceShipReview.dispose())).toBe(0);
});

test('Space Ship loads and renders the skinned ship and space shaders on WebGPU', async ({baseURL},info) => {
  test.skip(info.project.name !== 'compatibility');
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});
  try{
    const page=await browser.newPage({baseURL}),errors:string[]=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error'||m.text().includes('Model load failed'))errors.push(m.text());});
    await page.goto('/tests/browser/fixtures/spaceShip.html?backend=webgpu');
    await expect(page.locator('body')).toHaveAttribute('data-ready','true');
    expect(await page.evaluate(()=>(window as unknown as {spaceShipReview:Review}).spaceShipReview.backend)).toBe('webgpu');
    expect(await advance(page,2,1)).toMatchObject({ship:true,assetsLoaded:true});
    await page.locator('canvas').screenshot({path:info.outputPath('webgpu.jpg'),type:'jpeg',quality:75});
    expect(errors).toEqual([]);
  }finally{await browser.close();}
});

test('Space Ship is selectable in the visualizer and survives switching away and back', async ({page},info) => {
  test.skip(info.project.name !== 'compatibility');
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'||m.text().includes('Model load failed'))errors.push(m.text());});
  // The existing app shell has no favicon; keep its browser-generated request out of the asset check.
  await page.route('**/favicon.ico',route=>route.fulfill({status:204}));
  await page.goto('/?backend=webgl2&mode=spaceShip');
  await expect(page.locator('#status')).toHaveAttribute('data-state','ready',{timeout:60000});
  await expect(page.locator('#mode')).toHaveValue('spaceShip');
  await expect(page.locator('#mode option[value="spaceShip"]')).toHaveText('<experimental-wave6> Space Ship');
  await expect(page.locator('#bloom')).toHaveValue('0.45');
  for(const id of ['circle','spaceShip']){
    await page.locator('#mode').selectOption(id);
    await expect.poll(()=>page.evaluate(()=>(window as unknown as {__visualizerDebug:{activeMode:string}}).__visualizerDebug.activeMode), { timeout: 60000 }).toBe(id);
  }
  expect(errors).toEqual([]);
});


test('Space Ship exhaust surges and twin lasers fire on beats rather than a timer', async ({page},info) => {
  test.skip(info.project.name !== 'compatibility');
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'||m.text().includes('Model load failed'))errors.push(m.text());});
  await page.goto('/tests/browser/fixtures/spaceShip.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready','true');
  const quiet=await advance(page,36.2);
  expect(quiet.maneuver).toBe('lasers');expect(quiet.activeLasers).toBe(0);
  const hit=await page.evaluate(()=>(window as unknown as {spaceShipReview:Review}).spaceShipReview.step(true,0.9));
  expect(hit.activeLasers).toBe(2);expect(hit.exhaustLength).toBeGreaterThan(quiet.exhaustLength+2);
  await page.locator('canvas').screenshot({path:info.outputPath('beat-surge.jpg'),type:'jpeg',quality:75});
  const tail=await advance(page,0.4);
  expect(tail.activeLasers).toBe(2);expect(tail.thrust).toBeLessThan(hit.thrust);
  const second=await page.evaluate(()=>(window as unknown as {spaceShipReview:Review}).spaceShipReview.step(true,0.9));
  expect(second.activeLasers).toBe(4);
  const silence=await advance(page,2);
  expect(silence.activeLasers).toBe(0);expect(silence.exhaustLength).toBeCloseTo(quiet.exhaustLength,3);
  expect(errors).toEqual([]);
});
