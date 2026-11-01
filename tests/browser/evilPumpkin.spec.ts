import { test, expect, chromium } from '@playwright/test';

test('Evil Pumpkin loads, lunges through its screen, fires from the animated face and recoils on both backends', async ({ baseURL }, info) => {
  test.skip(info.project.name !== 'compatibility');
  for (const backend of ['webgl2', 'webgpu']) {
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: backend === 'webgl2'
      ? ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-unsafe-webgpu'] });
    try {
      const page = await browser.newPage({ baseURL, viewport: { width: 960, height: 540 } });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error' || message.text().includes('Model load failed')) errors.push(message.text()); });
      await page.goto(`/tests/browser/fixtures/evilPumpkin.html?backend=${backend}`);
      await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
      expect(await page.evaluate(() => (window as any).pumpkinReview.backend)).toBe(backend);
      const advance = (seconds: number, options = {}) => page.evaluate(({seconds, options}) => (window as any).pumpkinReview.advance(seconds, options), {seconds, options});
      const quiet = await advance(1);
      expect(quiet.forest).toBe(true); expect(quiet.brows).toBe(true); expect(quiet.smoke).toBeGreaterThan(0);
      expect(quiet.z).toBe(-0.95); expect(quiet.eye).toBe(false); expect(quiet.mouth).toBe(false);
      await page.locator('canvas').screenshot({ path: info.outputPath(`${backend}-idle.png`) });
      const dancing = await advance(2, { music: true, beats: true });
      expect(dancing.laserCount).toBe(0);
      const attacks = new Set<string>();
      for (let i = 0; i < 3; i++) {
        const peak = await page.evaluate(() => (window as any).pumpkinReview.peak());
        const attack = peak.attack; attacks.add(attack);
        expect(['eyes', 'mouth', 'combined', 'sweep']).toContain(attack); expect(peak.z).toBeGreaterThan(0.9); expect(peak.lunge).toBeGreaterThan(0.9);
        expect(peak.lid).toBeGreaterThan(quiet.lid + 0.02);
        expect(peak.jaw).toBeLessThan(attack === 'eyes' ? -0.1 : -0.4);
        expect(peak.eye).toBe(attack !== 'mouth'); expect(peak.mouth).toBe(attack !== 'eyes');
        await page.locator('canvas').screenshot({ path: info.outputPath(`${backend}-${attack}.png`) });
        const recoil = await advance(1.1);
        expect(recoil.z).toBeCloseTo(quiet.z); expect(recoil.jaw).toBeCloseTo(quiet.jaw); expect(recoil.lid).toBeCloseTo(quiet.lid);
      }
      expect(attacks.size).toBe(3);
      for (const shot of ['side orbit', 'low angle', 'skin rise']) {
        const view = await page.evaluate(shot => (window as any).pumpkinReview.shot(shot), shot);
        expect(view.shot).toBe(shot); expect(view.firing).toBe(0);
        await page.locator('canvas').screenshot({ path: info.outputPath(`${backend}-${shot.replace(' ', '-')}.png`) });
      }
      const close = await page.evaluate(() => (window as any).pumpkinReview.peak(true));
      expect(close.closeAttack).toBe(true); expect(close.eye).toBe(true); expect(close.mouth).toBe(false); expect(close.lunge).toBe(0);
      await page.locator('canvas').screenshot({ path: info.outputPath(`${backend}-skin-eye-lasers.png`) });
      await advance(4, { reducedMotion: true, reducedFlash: true });
      const frozen = await page.locator('canvas').screenshot();
      await advance(2, { reducedMotion: true, reducedFlash: true });
      expect((await page.locator('canvas').screenshot()).equals(frozen)).toBe(true);
      await advance(0.34, { music: true, hit: true, reducedFlash: true, aspect: 9/16 });
      await page.locator('canvas').screenshot({ path: info.outputPath(`${backend}-portrait-reduced-flash.png`) });
      await advance(1.2, { aspect: 32/9 });
      await page.locator('canvas').screenshot({ path: info.outputPath(`${backend}-ultrawide.png`) });
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => (window as any).pumpkinReview.dispose())).toBe(0);
    } finally { await browser.close(); }
  }
});
