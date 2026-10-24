import { test, expect } from '@playwright/test';

// Real tab capture: Chrome skips the picker for the tab with this title. Headless Chrome renders
// no tab audio, so this needs the headed hardware project. System-wide capture stays a manual check.
test.use({ launchOptions: { args: ['--auto-select-tab-capture-source-by-title=Tone fixture'] } });

const toneFixture = `<!doctype html><title>Tone fixture</title><button id="start">Start tone</button><script>
document.getElementById('start').onclick = () => { const c = new AudioContext(); const o = c.createOscillator(); o.frequency.value = 110; o.connect(c.destination); o.start(); };
</script>`;

test('captured tab audio drives the analyser after the video track is dropped @hardware', async ({ context, page }, info) => {
  test.skip(info.project.name !== 'hardware-webgpu');
  await context.route('**/tone-fixture.html', (route) => route.fulfill({ contentType: 'text/html', body: toneFixture }));
  const tone = await context.newPage();
  await tone.goto('/tone-fixture.html');
  await tone.locator('#start').click();
  await page.addInitScript(() => {
    Object.assign(window, { maxSpectrum: 0, captured: [] as MediaStream[] });
    const target = window as unknown as { maxSpectrum: number; captured: MediaStream[] };
    const read = AnalyserNode.prototype.getByteFrequencyData;
    AnalyserNode.prototype.getByteFrequencyData = function (array) {
      read.call(this, array);
      for (const value of array) target.maxSpectrum = Math.max(target.maxSpectrum, value);
    };
    const capture = MediaDevices.prototype.getDisplayMedia;
    MediaDevices.prototype.getDisplayMedia = async function (options) { const stream = await capture.call(this, options); target.captured.push(stream); return stream; };
  });
  await page.goto('/modern.html?backend=webgpu');
  await page.bringToFront(); // getDisplayMedia rejects with InvalidStateError from a background tab.
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  await page.getByRole('button', { name: 'Use audio playing on this Mac' }).click();
  await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'listening');
  const tracks = () => page.evaluate(() => (window as unknown as { captured: MediaStream[] }).captured[0].getTracks().map((track) => `${track.kind}:${track.readyState}`));
  await expect.poll(tracks).toEqual(['audio:live', 'video:ended']);
  await expect.poll(() => page.evaluate(() => (window as unknown as { maxSpectrum: number }).maxSpectrum), { timeout: 10000 }).toBeGreaterThan(100);
  await page.locator('#stop-listen-btn').click();
  await expect.poll(tracks).toEqual(['audio:ended', 'video:ended']);
});
