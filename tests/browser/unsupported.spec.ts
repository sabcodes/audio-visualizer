import { test, expect } from '@playwright/test';

test('both unavailable backends give an actionable recovery message', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'unsupported');
  // Browser flags alone do not reliably disable WebGPU across Chrome versions.
  // Simulate both capability failures before application modules initialize.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true });
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (String(args[0]).startsWith('webgl')) return null;
      return Reflect.apply(original, this, args);
    } as typeof original;
  });
  await page.goto('/modern.html?backend=auto');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#status')).toContainText('localhost/HTTPS');
  await expect(page.getByRole('button', { name: 'Restart in WebGL2' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restart renderer', exact: true })).toBeEnabled();
});
