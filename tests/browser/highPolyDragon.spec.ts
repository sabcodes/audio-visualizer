import { test, expect } from '@playwright/test';

test.use({ launchOptions: { args: ['--enable-webgl', '--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });

for (const backend of ['webgpu', 'webgl2']) {
  test(`high polygon dragon bends smoothly, roars and breathes fire on ${backend}`, async ({ page }, info) => {
    test.skip(info.project.name !== 'compatibility');
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' || /Model load failed/.test(message.text())) errors.push(message.text()); });
    await page.goto(`/tests/browser/fixtures/highPolyDragon.html${backend === 'webgpu' ? '?webgpu' : ''}`);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 60000 });
    const start = await page.evaluate(() => (window as any).dragonReview.state());
    expect(start.gpu).toBe(backend === 'webgpu');
    expect(start.triangles).toBeGreaterThan(300000);
    const pose = await page.evaluate(() => (window as any).dragonReview.advance(20, true));
    expect(pose.fingers).not.toEqual(start.fingers);
    const accented = await page.evaluate(() => (window as any).dragonReview.advance(1, true));
    for (let wing = 0; wing < 2; wing++) {
      const jump = Math.hypot(...pose.tips[wing].map((v: number, i: number) => accented.tips[wing][i] - v));
      expect(jump).toBeLessThan(0.65);
    }
    // Inspect the new features before fire lighting changes the blue palette.
    for (const part of ['face', 'fore', 'hind']) {
      await page.evaluate(part => (window as any).dragonReview.detail(part), part);
      await page.locator('canvas').screenshot({ path: info.outputPath(`dragon-${backend}-${part}.jpg`), type: 'jpeg', quality: 90 });
    }
    // Two onsets above, then six more: the eighth triggers the existing roar.
    for (let i = 0; i < 6; i++) await page.evaluate(() => (window as any).dragonReview.advance(18, true));
    const roaring = await page.evaluate(() => (window as any).dragonReview.state());
    expect(roaring.jaw[0]).toBeGreaterThan(start.jaw[0] + 0.08);
    await page.evaluate(() => (window as any).dragonReview.advance(90));
    await page.evaluate(() => (window as any).dragonReview.loud(1));
    const fire = await page.evaluate(() => (window as any).dragonReview.advance(125));
    expect(fire.heat).toBeGreaterThan(10);
    expect(fire.camera.every(Number.isFinite)).toBe(true);
    await page.locator('canvas').screenshot({ path: info.outputPath(`dragon-${backend}-fire.jpg`), type: 'jpeg', quality: 85 });
    await page.evaluate(async () => { await (window as any).dragonReview.studio(); await (window as any).dragonReview.angle(90, -8, 8); });
    await page.locator('canvas').screenshot({ path: info.outputPath(`dragon-${backend}-anatomy.jpg`), type: 'jpeg', quality: 90 });
    expect(await page.evaluate(() => (window as any).dragonReview.release())).toBe(0);
    expect(errors).toEqual([]);
  });
}
