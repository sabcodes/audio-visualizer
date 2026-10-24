import { test, expect, type Page } from '@playwright/test';

// Chrome's fake capture device answers getDisplayMedia with a fake screen plus a beeping audio
// track, and the fake UI skips the picker, so the happy path runs headless with no permissions.
test.use({ launchOptions: { args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'compatibility', 'Needs the headless fake capture device.'); });

async function audit(page: Page) {
  await page.addInitScript(() => {
    const record = { contexts: 0, liveSources: 0, streams: [] as MediaStream[], settings: [] as MediaTrackSettings[], maxSpectrum: 0 };
    Object.assign(window, { captureAudit: record });
    const read = AnalyserNode.prototype.getByteFrequencyData;
    AnalyserNode.prototype.getByteFrequencyData = function (array) {
      read.call(this, array);
      for (const value of array) record.maxSpectrum = Math.max(record.maxSpectrum, value);
    };
    const Context = window.AudioContext;
    window.AudioContext = class extends Context {
      constructor(...args: ConstructorParameters<typeof AudioContext>) { super(...args); record.contexts++; }
      override createMediaStreamSource(stream: MediaStream) { record.liveSources++; return super.createMediaStreamSource(stream); }
    };
    const capture = MediaDevices.prototype.getDisplayMedia;
    MediaDevices.prototype.getDisplayMedia = async function (options) {
      const stream = await capture.call(this, options);
      record.streams.push(stream);
      for (const track of stream.getAudioTracks()) record.settings.push(track.getSettings());
      return stream;
    };
  });
}
const state = (page: Page) => page.evaluate(() => {
  const record = (window as unknown as { captureAudit: { contexts: number; liveSources: number; streams: MediaStream[]; settings: MediaTrackSettings[]; maxSpectrum: number } }).captureAudit;
  return {
    contexts: record.contexts, liveSources: record.liveSources, maxSpectrum: record.maxSpectrum, settings: record.settings,
    liveTracks: record.streams.flatMap((stream) => stream.getTracks()).filter((track) => track.readyState === 'live').map((track) => track.kind),
  };
});

test('listens to captured audio, drops the video, and releases everything on Stop', async ({ page }) => {
  await audit(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/modern.html?backend=webgl2');
  await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
  for (let round = 1; round <= 3; round++) {
    await page.getByRole('button', { name: 'Use audio playing on this Mac' }).click();
    await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'listening');
    await expect(page.locator('#live-controls')).toContainText('Listening to system audio');
    await expect(page.locator('#play-btn')).toBeHidden();
    await expect(page.locator('#seek-slider')).toBeHidden();
    await expect.poll(async () => (await state(page)).liveTracks).toEqual(['audio']);
    await expect.poll(async () => (await state(page)).maxSpectrum).toBeGreaterThan(0);
    await page.locator('#stop-listen-btn').click();
    await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'empty');
    await expect(page.locator('#audio-status')).toContainText('Stopped listening');
    await expect(page.locator('#play-btn')).toBeVisible();
    const after = await state(page);
    expect(after.liveTracks).toEqual([]);
    expect(after.liveSources).toBe(round);
  }
  const final = await state(page);
  expect(final.contexts).toBe(1);
  expect(final.settings[0]).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
  expect(errors).toEqual([]);
});

test('Stop sharing from the browser returns to the file player', async ({ page }) => {
  await audit(page);
  await page.goto('/modern.html?backend=webgl2');
  await page.getByRole('button', { name: 'Use audio playing on this Mac' }).click();
  await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'listening');
  // A stopped track doesn't fire `ended`; the browser's own Stop sharing does, which this simulates.
  await page.evaluate(() => {
    const record = (window as unknown as { captureAudit: { streams: MediaStream[] } }).captureAudit;
    for (const track of record.streams[0].getAudioTracks()) { track.stop(); track.dispatchEvent(new Event('ended')); }
  });
  await expect(page.locator('#audio-status')).toContainText('Stopped listening');
  await expect(page.locator('#live-controls')).toBeHidden();
});

const failures: [string, string, RegExp][] = [
  ['shared without audio', 'video-only', /Also share system audio/],
  ['cancelled the picker', 'NotAllowedError:Permission denied', /cancelled or blocked/],
  ['denied by macOS', 'NotAllowedError:Permission denied by system', /Screen & System Audio Recording/],
];
for (const [label, behavior, message] of failures) test(`explains when the user ${label}`, async ({ page }) => {
  await page.addInitScript((mode) => {
    MediaDevices.prototype.getDisplayMedia = async function () {
      if (mode === 'video-only') {
        const canvas = document.createElement('canvas');
        return canvas.captureStream();
      }
      const [name, text] = mode.split(':');
      throw new DOMException(text, name);
    };
  }, behavior);
  await page.goto('/modern.html?backend=webgl2');
  await page.getByRole('button', { name: 'Use audio playing on this Mac' }).click();
  await expect(page.locator('#audio-status')).toContainText(message);
  await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'empty');
  await expect(page.locator('#audio-upload')).toBeEnabled();
});

test('disables the button where display capture is missing', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(MediaDevices.prototype, 'getDisplayMedia', { value: undefined, configurable: true }); });
  await page.goto('/modern.html?backend=webgl2');
  await expect(page.locator('#listen-btn')).toBeDisabled();
  await expect(page.locator('#listen-btn')).toContainText('load a file instead');
});
