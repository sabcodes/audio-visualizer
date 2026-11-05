import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Review captures for output and spectrum defaults. Opt-in: CAPTURE_REFERENCE=1 npx playwright test --project=hardware-webgpu -g @reference
const modes = ['vjRings', 'particles', 'boids', 'kaleidoPlane', 'city', 'starTunnel', 'bloomTunnel', 'godrays'];
const outputs = [['aces', 'fxaa'], ['aces', 'smaa'], ['agx', 'fxaa'], ['agx', 'smaa']] as const;
const spectrumModes = ['city', 'fftTunnel', 'bloomTunnel', 'star'];
const dir = 'benchmark-results/stage3-review';
type Shot = { group: string; label: string; file: string };

async function open(page: Page, query: string) {
  await page.goto(`/?backend=webgpu&quality=balanced&${query}`);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.selectOption('#scale', '1');
}
async function shoot(page: Page, shots: Shot[], group: string, label: string) {
  await page.locator('#hide').click();
  await page.waitForTimeout(700);
  const file = `${group}-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
  await page.locator('canvas').screenshot({ path: `${dir}/${file}` });
  shots.push({ group, label, file });
}

test('capture output and spectrum review set @hardware @reference', async ({ page }, info) => {
  test.skip(info.project.name !== 'hardware-webgpu' || !process.env.CAPTURE_REFERENCE);
  test.setTimeout(10 * 60 * 1000);
  mkdirSync(dir, { recursive: true });
  const shots: Shot[] = [];
  for (const mode of modes) {
    for (const [tone, aa] of outputs) {
      await open(page, `time=2&mode=${mode}&tone=${tone}&aa=${aa}`);
      await page.locator('#synthetic').check();
      await shoot(page, shots, mode, `${tone.toUpperCase()} + ${aa.toUpperCase()}`);
    }
  }
  for (const mode of ['bloomTunnel', 'godrays']) {
    for (const strength of ['0.3', '0.6', '1']) {
      await open(page, `time=2&mode=${mode}`);
      await page.locator('#synthetic').check();
      await page.locator('#bloom').fill(strength);
      await shoot(page, shots, `${mode}-bloom`, `bloom ${strength}`);
    }
  }
  // Spectrum mapping needs real spectral content; the synthetic fixture is bass-only.
  if (existsSync(resolve('ghost.wav'))) {
    for (const mode of spectrumModes) {
      for (const mapping of ['linear', 'log']) {
        await open(page, `mode=${mode}&spectrum=${mapping}`);
        await page.locator('#audio-upload').setInputFiles(resolve('ghost.wav'));
        await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'ready');
        await page.locator('#seek-slider').fill('96');
        await page.locator('#play-btn').click();
        await page.waitForTimeout(1500);
        await shoot(page, shots, `${mode}-spectrum`, `${mapping} bins`);
        await page.locator('#show').click();
        await page.locator('#play-btn').click();
      }
    }
  }
  const groups = [...new Set(shots.map((shot) => shot.group))];
  const body = groups.map((group) => `<section><h2>${group}</h2><div>${shots.filter((shot) => shot.group === group)
    .map((shot) => `<figure><img src="${shot.file}" alt="${group} ${shot.label}"><figcaption>${shot.label}</figcaption></figure>`).join('')}</div></section>`).join('');
  writeFileSync(`${dir}/index.html`, `<!doctype html><meta charset="utf-8"><title>Stage 3 review</title><style>body{background:#0b0c10;color:#ddd;font:14px system-ui;margin:16px}div{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}figure{margin:0}img{width:100%;border:1px solid #333}</style><h1>Stage 3 — output and spectrum defaults (native WebGPU, Balanced, t=2s synthetic unless noted)</h1>${body}\n`);
});
