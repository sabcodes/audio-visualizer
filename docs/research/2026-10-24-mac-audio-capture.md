# Visualizing audio already playing on the Mac — research

**Date:** 2026-10-24 · **Status:** v1 implemented on `sabcodex/system-audio-capture` (see *Verified findings* below) · **Scope note:** the modernization plan (§1) lists microphone/system-audio capture as out of scope for the initial release, so this is a new feature to schedule, not part of Stage 3.

## Recommendation

**v1: browser-only capture with `getDisplayMedia`.** You don't install anything, the page needs no native code, and the existing Web Audio analysis is reused unchanged. Keep file loading as the default and the fallback.

- In current Chrome on **macOS 14.2+**, the screen-share picker can include audio:
  - **Entire Screen** or **Window** with *"Also share system audio"*, which captures everything the Mac plays (Music, QuickTime, the Spotify app, YouTube in any tab).
  - A single app's audio, with `windowAudio: "window"`.
  - A single Chrome tab (works on any macOS).
- Chrome implements this with Core Audio process taps, not ScreenCaptureKit. The ScreenCaptureKit audio path is used only for Cast (Chromium source, below).
- Minimum Chrome version: 141–142. Google's Meet announcement says 142+; independent testing first saw the toggle in 141.

```ts
// Must run inside a click handler (transient activation), on a secure context — http://127.0.0.1 qualifies.
const stream = await navigator.mediaDevices.getDisplayMedia({
  video: true,                       // required: audio-only requests are rejected
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
  systemAudio: 'include',            // offer the system-audio toggle for screens
  windowAudio: 'system',             // or 'window' to capture just that app
  selfBrowserSurface: 'exclude',
  surfaceSwitching: 'include',
});
stream.getVideoTracks().forEach((track) => track.stop());
const audio = stream.getAudioTracks()[0]; // missing if the user left the audio toggle off → explain and retry
audio.onended = () => { /* user clicked "Stop sharing" → return to silent/file mode */ };
context.createMediaStreamSource(new MediaStream([audio])).connect(analyser); // never to destination (double playback)
```

### Where it plugs in

- `AudioEngine` gets a second source kind beside the media element. A `MediaStreamAudioSourceNode` feeds the same `AnalyserNode` (fftSize 1024).
- `sample()`, `AudioFrame` and `analysis.ts` stay unchanged.
- Seeking and the play/pause controls don't apply to a live source. The UI shows "Listening to system audio · Stop".

### Gotchas to design for

- **No audio track.** The user can share without ticking the audio toggle. Detect the missing track and show how to turn it on.
- **The OS permission prompt.** It appears on first use ("Screen & System Audio Recording"). macOS 15+ may re-prompt periodically.
- **Picking every time.** Every session needs a fresh pick; the grant is never stored.
- **Older macOS.** Below 14.2 the system-audio toggle doesn't exist. Fall back to tab capture or a loopback device.
- **Processing.** Disable AGC, echo cancellation and noise suppression explicitly. Verify with `track.getSettings()`, and check `channelCount` for mono downmix.
- **Level.** Captured level follows the player's volume. `ResponseEnvelope` already adapts to level, but sensitivity may need a different default for live input.
- **Track lifetime.** Verified: the audio track stays `live` and keeps delivering samples after the video tracks are stopped (see below).

## Alternatives (ranked)

1. **Tab capture only.** Same call with a tab picked. Any macOS, but browser tabs only (YouTube, Spotify Web).
2. **Loopback device plus `getUserMedia`.** This means BlackHole (free, GPL-3.0, a HAL plug-in in `/Library/Audio/Plug-Ins/HAL`) or Loopback (paid).
   - The project needs no code: pick the device by label after mic permission, and call `getUserMedia({ audio: { deviceId: { exact }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 } })`.
   - The user setup cost is high: install, restart, and build a Multi-Output Device in Audio MIDI Setup to keep hearing audio.
3. **A small native Swift helper using a Core Audio process tap.** This uses `CATapDescription` plus `AudioHardwareCreateProcessTap`, on macOS 14.2+.
   - It captures the global mix or chosen apps' output, under the lighter "System Audio Recording Only" permission. There's no public API to check that permission; a denial just yields silence.
   - It streams raw PCM to the page over `ws://127.0.0.1` (a hello message with sampleRate, channels and f32le format, then binary frames), and an AudioWorklet feeds the existing AnalyserNode.
   - It needs a signed and notarized `.app` with `NSAudioCaptureUsageDescription`.
   - Worth it only if browser capture proves insufficient. Sample code: Apple's "Capturing system audio with Core Audio taps", insidegui/AudioCap.
4. **ScreenCaptureKit audio (`capturesAudio`).** macOS 13+, with per-app filters, but it needs full Screen Recording permission. It's heavier than a tap for audio-only capture.
5. **An Electron or Tauri wrapper.** This removes the WebSocket hop, but it's the desktop wrapper the plan rules out, and the permission story is unchanged.

## Verified findings (Chrome 155, macOS 27, 2026-10-24)

- **Audio survives stopping the video track.** With real tab capture (headed Chrome, `--auto-select-tab-capture-source-by-title`), the analyser read a 110 Hz tone at full scale before and for 3 s after `getVideoTracks().forEach(stop)`. The audio track's `readyState` stayed `live`. The fake capture device (`--use-fake-device-for-media-stream`) behaves the same.
- **Processing is off as requested.** `getSettings()` on the captured track reports `echoCancellation`, `noiseSuppression` and `autoGainControl` all `false`, with `channelCount: 2` (no mono downmix).
- **Headless Chrome renders no tab audio.** Tab capture succeeds headless but every sample is silent, so the real-capture browser test is `@hardware` (headed). The headless suite uses Chrome's fake capture device instead.
- **`--use-fake-ui-for-media-stream` breaks the tab-title auto-select.** Combined, Chrome picks the screen and fails with `NotReadableError: Could not start video source`. Use the title flag alone.
- **A background tab can't open the picker.** `getDisplayMedia` rejects with `InvalidStateError` when the page isn't the focused tab. The UI explains this.
- **The graph.** The file player now runs `source → destination` and `source → analyser` (the analyser is a side branch), so the live `MediaStreamAudioSourceNode` shares the same analyser without ever reaching the speakers.

## Still unverified — test before committing to a design

- **DRM.** Does Apple Music (protected tracks), the Spotify app, or a Widevine tab (Spotify Web) go silent through taps or tab capture? There's no authoritative source either way, only one anecdotal 2020 report of tabCapture muting.
- Whether the audio track survives stopping the video track.
- Whether Chrome applies AEC/AGC to display-capture audio by default.
- Real end-to-end latency for each path. The estimates are a few to about 10 ms plus the analyser window.

## Suggested v1 slice

1. Add a **"Use audio playing on this Mac"** button. It calls `getDisplayMedia` as above, discards the video, and connects the audio to the analyser.
2. Handle these states: no track, permission denied, user stopped sharing, and unsupported (macOS < 14.2 or an old Chrome). Fall back to "load a file".
3. Hand-test the source matrix: Music app (local file), QuickTime, Spotify app, Apple Music (DRM), YouTube tab, Spotify Web tab.
4. Add a browser test with Chrome's `--use-fake-ui-for-media-stream` / `--auto-select-desktop-capture-source` flags for the happy path. The real system-audio check stays a manual hardware check.

## Sources

- W3C Screen Capture spec: https://w3c.github.io/mediacapture-screen-share/
- MDN getDisplayMedia: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia · Secure contexts: https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts
- Chrome 141 release notes (`windowAudio`, `restrictOwnAudio`): https://developer.chrome.com/release-notes/141 · Screen-sharing controls: https://developer.chrome.com/docs/web-platform/screen-sharing-controls
- Google Workspace update (Chrome 142+, macOS 14.2+): https://workspaceupdates.googleblog.com/2025/12/share-devices-audio-when-presenting.html
- Addpipe test of the macOS system-audio toggle: https://blog.addpipe.com/getdisplaymedia-allows-capturing-the-screen-with-system-sounds-on-chrome-on-macos/
- Chromium source: `chrome/browser/media/webrtc/desktop_media_picker_controller.cc`, `media/base/media_switches.cc`, `third_party/blink/renderer/modules/mediastream/user_media_request.cc` (https://chromium.googlesource.com/chromium/src/+/HEAD/)
- Apple, Core Audio taps: https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps · `AudioHardwareCreateProcessTap`: https://developer.apple.com/documentation/coreaudio/audiohardwarecreateprocesstap(_:_:)
- Apple, ScreenCaptureKit `capturesAudio`: https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/capturesaudio
- insidegui/AudioCap: https://github.com/insidegui/AudioCap · BlackHole: https://github.com/ExistentialAudio/BlackHole · Loopback: https://rogueamoeba.com/loopback/
- Electron note on Chromium using Core Audio taps: https://releases.electronjs.org/pr/49717
