import { test, expect } from '@playwright/test';

// Tiny deterministic PCM fixture generated in memory; no downloaded media.
function tone(seconds = 3) {
  const rate = 8000;
  const samples = Math.floor(seconds * rate);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(8000 * Math.sin(i * Math.PI * 2 * 110 / rate)), 44 + i * 2);
  return { name: 'fixture.wav', mimeType: 'audio/wav', buffer };
}

test('local player owns one graph through playback, seeking, modes, restart, and file replacement @hardware', async ({ page }, info) => {
  test.skip(!['compatibility', 'hardware-webgpu'].includes(info.project.name));
  await page.addInitScript(() => {
    const audit = { contexts: 0, sources: 0, urls: 0, revoked: 0 };
    Object.assign(window, { audioAudit: audit });
    Object.assign(window, { maxAudioSpectrum: 0 });
    const read = AnalyserNode.prototype.getByteFrequencyData;
    AnalyserNode.prototype.getByteFrequencyData = function (array) {
      read.call(this, array);
      const target = window as unknown as { maxAudioSpectrum: number };
      for (const value of array) target.maxAudioSpectrum = Math.max(target.maxAudioSpectrum, value);
    };
    const context = window.AudioContext;
    window.AudioContext = class extends context {
      constructor(...args: ConstructorParameters<typeof AudioContext>) { super(...args); audit.contexts++; }
      override createMediaElementSource(media: HTMLMediaElement) { audit.sources++; return super.createMediaElementSource(media); }
    };
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    URL.createObjectURL = (blob) => { audit.urls++; return create(blob); };
    URL.revokeObjectURL = (url) => { audit.revoked++; revoke(url); };
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const backend = info.project.name === 'hardware-webgpu' ? 'webgpu' : 'webgl2';
  await page.goto(`/?backend=${backend}`);
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#play-btn')).toBeDisabled();
  await expect(page.locator('#synthetic')).not.toBeChecked();
  await page.locator('#audio-upload').setInputFiles(tone());
  await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#time-total')).toHaveText('0:03');
  await page.locator('#play-btn').click();
  await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'playing');
  await expect.poll(() => page.evaluate(() => (window as unknown as { maxAudioSpectrum: number }).maxAudioSpectrum)).toBeGreaterThan(0);
  await page.locator('#play-btn').click();
  await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'paused');
  await page.locator('#seek-slider').fill('1.5');
  await expect(page.locator('#time-current')).toHaveText('0:01');
  for (const mode of ['rings', 'particles', 'scene']) await page.selectOption('#mode', mode);
  for (let i = 0; i < 3; i++) {
    await page.locator('#restart').click();
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('canvas')).toHaveCount(1);
    await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'paused');
  }
  await page.locator('#audio-upload').setInputFiles({ ...tone(0.5), name: 'replacement.wav' });
  await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'ready');
  await page.locator('#play-btn').click();
  await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'ended', { timeout: 10000 });
  await expect(page.locator('#play-btn')).toHaveText('Replay');
  const audit = await page.evaluate(() => (window as unknown as { audioAudit: unknown }).audioAudit);
  expect(audit).toEqual({ contexts: 1, sources: 1, urls: 2, revoked: 1 });
  expect(errors).toEqual([]);
});

test('invalid audio and rejected playback have a recoverable state', async ({ page }, info) => {
  test.skip(info.project.name !== 'compatibility');
  await page.goto('/?backend=webgl2');
  await page.locator('#audio-upload').setInputFiles({ name: 'invalid.wav', mimeType: 'audio/wav', buffer: Buffer.from('not valid audio') });
  await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'error');
  await page.locator('#audio-upload').setInputFiles(tone());
  await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'ready');
  await page.evaluate(() => {
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      HTMLMediaElement.prototype.play = original;
      return Promise.reject(new DOMException('Test playback denied', 'NotAllowedError'));
    };
  });
  await page.locator('#play-btn').click();
  await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#audio-status')).toContainText('Test playback denied');
  await page.locator('#play-btn').click();
  await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'playing');
});
