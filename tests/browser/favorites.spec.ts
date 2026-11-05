import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== 'compatibility');
  // Keep browser QA out of the user's real project settings file.
  const saved = new Set<string>();
  await page.route('**/api/settings', async route => {
    if (route.request().method() === 'PATCH') {
      const change = route.request().postDataJSON();
      if (change.importFavoriteModes) for (const id of change.importFavoriteModes) saved.add(id);
      else if (change.favorite) saved.add(change.favoriteMode);
      else saved.delete(change.favoriteMode);
    }
    await route.fulfill({ json: { version: 1, favoriteModes: [...saved] } });
  });
});

test('favorites persist and hidden controls switch scenes, sync sliders, and fade on hover', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/modern.html?backend=webgl2&mode=scene&time=2');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#favorite-modes')).toBeDisabled();
  await page.locator('#favorite').click();
  await expect(page.locator('#favorite')).toHaveAttribute('aria-pressed', 'true');
  await page.selectOption('#mode', 'rings');
  await page.locator('#favorite').click();
  await expect(page.locator('#favorite')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#bloom').fill('0.85');
  await page.locator('#exposure').fill('1.3');
  await expect(page.locator('#quick-bloom')).toHaveValue('0.85');
  await expect(page.locator('#quick-exposure')).toHaveValue('1.3');
  await page.locator('#hide').click();
  await expect(page.locator('#controls')).toBeHidden();
  const panel = page.locator('#quick-controls');
  await panel.hover();
  await expect(panel).toHaveCSS('opacity', '0.8');
  await page.selectOption('#favorite-modes', 'scene');
  await expect(page.locator('#mode')).toHaveValue('scene');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __visualizerDebug: { activeMode: string } }).__visualizerDebug.activeMode)).toBe('scene');
  await page.locator('#quick-bloom').fill('1.1');
  await page.locator('#quick-exposure').fill('0.75');
  await expect(page.locator('#bloom')).toHaveValue('1.1');
  await expect(page.locator('#exposure')).toHaveValue('0.75');
  await page.locator('#quick-favorite').click();
  await expect(page.locator('#favorite-modes option')).toHaveCount(2);
  await page.mouse.move(1100, 650);
  await expect(panel).toHaveCSS('opacity', '0');
  // Keyboard users can still reveal and use the invisible toolbar.
  await page.keyboard.press('Tab');
  await expect(panel).toHaveCSS('opacity', '0.8');
  await page.locator('#show').click();
  await expect(page.locator('#controls')).toBeVisible();
  await page.reload();
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#favorite')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#favorite-modes option[value="rings"]')).toHaveCount(1);
  await expect(page.locator('#favorite-modes option[value="scene"]')).toHaveCount(0);
  await page.selectOption('#mode', 'rings');
  await expect(page.locator('#favorite')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('favorites tolerate invalid saved data and unavailable browser storage', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('visualizer.favoriteModes', '{broken json');
    Storage.prototype.setItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
  });
  await page.goto('/modern.html?backend=webgl2&mode=scene&time=2');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#favorite').click();
  await expect(page.locator('#favorite')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#hide').click();
  await expect(page.locator('#favorite-modes option[value="scene"]')).toHaveCount(1);
});

test('imports old browser favorites once and keeps them in the project after browser storage is cleared', async ({ page }) => {
  await page.goto('/modern.html?backend=webgl2&mode=scene&time=2');
  await page.evaluate(() => localStorage.setItem('visualizer.favoriteModes', JSON.stringify(['scene', 'rings', 'removed-mode'])));
  await page.reload();
  await expect(page.locator('#favorite')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#favorite-modes option[value="rings"]')).toHaveCount(1);
  await page.locator('#favorite').click();
  await expect(page.locator('#favorite')).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(page.locator('#favorite')).toBeEnabled();
  await expect(page.locator('#favorite')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => localStorage.getItem('visualizer.favoriteModes'))).toBe('["scene","rings","removed-mode"]');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#favorite')).toBeEnabled();
  await expect(page.locator('#favorite-modes option[value="rings"]')).toHaveCount(1);
  await expect(page.locator('#favorite-modes option[value="scene"]')).toHaveCount(0);
});

test('reports a failed disk save without pretending the favorite was saved', async ({ page }) => {
  await page.goto('/modern.html?backend=webgl2&mode=scene&time=2');
  await expect(page.locator('#favorite')).toBeEnabled();
  await page.route('**/api/settings', route => route.fulfill({ status: 500, json: { error: 'Cannot write settings' } }));
  await page.locator('#hide').click();
  await page.locator('#quick-controls').hover();
  await page.locator('#quick-favorite').click();
  await expect(page.locator('#settings-status')).toContainText('Could not save favorites');
  await expect(page.locator('#settings-status')).toBeVisible();
  await expect(page.locator('#favorite')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#favorite')).toBeEnabled();
});
