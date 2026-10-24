import { test, expect } from '@playwright/test';

const modes = ['scene', 'rings', 'particles'];
test('forced compatibility renders all probe scenes before audio exists', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'compatibility');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/modern.html?backend=webgl2&time=2');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#status')).toContainText('WebGL2 compatibility');
  for (const mode of [...modes, ...modes]) {
    await page.selectOption('#mode', mode);
    await expect(page.locator('canvas')).toHaveCount(1);
    await page.waitForTimeout(700);
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
    // Artifacts for human comparison, NOT an unreviewed golden-image approval.
    await page.locator('canvas').screenshot({ path: testInfo.outputPath(`${mode}-webgl2.png`) });
  }
  await page.setViewportSize({ width: 390, height: 700 });
  await page.selectOption('#scale', '0.5');
  await expect.poll(() => page.locator('canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).width)).toBe(195);
  await page.getByRole('button', { name: 'Restart renderer', exact: true }).click();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.getByRole('button', { name: 'Hide controls', exact: true }).click();
  await expect(page.locator('#controls')).toBeHidden();
  await page.getByRole('button', { name: 'Show controls', exact: true }).click();
  await expect(page.locator('#controls')).toBeVisible();
  expect(errors).toEqual([]);
});

test('reduced motion is respected and native controls retain keyboard behavior', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'compatibility');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/modern.html?backend=webgl2');
  await expect(page.locator('#motion')).toBeChecked();
  await page.locator('#mode').focus();
  await page.keyboard.press('h');
  await expect(page.locator('#controls')).toBeVisible();
});

test('@hardware initializes actual native WebGPU with all probe scenes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'hardware-webgpu');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/modern.html?backend=webgpu&time=2');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#status')).toContainText('native WebGPU');
  for (const mode of modes) {
    await page.selectOption('#mode', mode);
    await page.waitForTimeout(1000);
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
    await page.locator('canvas').screenshot({ path: testInfo.outputPath(`${mode}-webgpu.png`) });
  }
  expect(errors).toEqual([]);
});
