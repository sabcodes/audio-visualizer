import { VisualEngine } from './rendering/VisualEngine';
import { clampDelta, summarizeIntervals } from './rendering/diagnostics';
import type { BackendPreference } from './rendering/backendSelection';
import { AudioEngine, type AudioFrame } from './audio/AudioEngine';
import { ControlPanel } from './ui/ControlPanel';
import { FrameLoop } from './rendering/FrameLoop';
import { modeDefinitions } from './modes/registry';
import { ResponseEnvelope } from './audio/VisualResponse';

const element = <T extends HTMLElement>(id: string) => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing control: ${id}`);
  return found as T;
};
const viewport = element('viewport');
const status = element('status');
const diagnostics = element('diagnostics');
const backend = element<HTMLSelectElement>('backend');
const mode = element<HTMLSelectElement>('mode');
const scale = element<HTMLSelectElement>('scale');
const exposure = element<HTMLInputElement>('exposure');
const bloom = element<HTMLInputElement>('bloom');
const motion = element<HTMLInputElement>('motion');
const synthetic = element<HTMLInputElement>('synthetic');
const sensitivity = element<HTMLInputElement>('sensitivity');
const colorSpeed = element<HTMLInputElement>('color-speed-slider');
const reducedFlash = element<HTMLInputElement>('reduced-flash');
const envelope = new ResponseEnvelope();
let hueClock = 0;
const freeze = element<HTMLButtonElement>('freeze');
const restart = element<HTMLButtonElement>('restart');
const compatibility = element<HTMLButtonElement>('compatibility');
const benchmark = element<HTMLButtonElement>('benchmark');
const benchmarkStatus = element('benchmark-status');
const controls = element('controls');
const show = element('show');
const params = new URLSearchParams(location.search);
mode.replaceChildren(...modeDefinitions.map((definition) => new Option(definition.label, definition.id)));
if (['auto', 'webgpu', 'webgl2'].includes(params.get('backend') ?? '')) backend.value = params.get('backend')!;
if (modeDefinitions.some((definition) => definition.id === params.get('mode'))) mode.value = params.get('mode')!;
const requestedTime = Number(params.get('time'));
const validTime = params.has('time') && Number.isFinite(requestedTime) && requestedTime >= 0;
const fixedTime = validTime ? requestedTime : 2;
let frozen = validTime;
let paused = false;
motion.checked = matchMedia('(prefers-reduced-motion: reduce)').matches;

let engine: VisualEngine | undefined;
let starting = false;
let shutdown = false;
let failed = false;
const loop = new FrameLoop();
let epoch = 0;
let gpuDisposal: Promise<void> = Promise.resolve();
let lastFrame = 0;
let clock = 0;
let warmUntil = 0;
let nextDiagnostics = 0;
let intervals: number[] = [];
let benchmarkRun: { start: number; samples: number[] } | undefined;
const reports: unknown[] = [];
const audio = new AudioEngine();
const player = new ControlPanel(audio, resetTiming);
const fixture: AudioFrame = { waveform: new Float32Array(1024), spectrum: new Uint8Array(512), bass: 0, mid: 0, highs: 0, rms: 0, onset: false, time: 0 };

function fail(error: unknown) {
  failed = true;
  status.textContent = `${error instanceof Error ? error.message : String(error)} Use localhost/HTTPS, check browser graphics settings, then retry or force WebGL2.`;
  status.dataset.state = 'error';
  compatibility.hidden = false;
  loop.stop();
  cancelBenchmark('Benchmark cancelled: graphics failure.');
}
function metadata() {
  const state = audio.state;
  return {
    schemaVersion: 1, stage: 'Stage 3 GPU scaling — in progress',
    timestamp: new Date().toISOString(),
    secureContext: isSecureContext, backendRequested: backend.value, backendActual: engine?.backend ?? 'unavailable',
    startupFailures: engine?.startupFailures ?? [], gpu: 'Record physical GPU and OS in the hardware review.',
    mode: mode.value, seed: 42, sensitivity: Number(sensitivity.value), colorInterval: Number(colorSpeed.value), reducedFlash: reducedFlash.checked,
    fixture: synthetic.checked ? 'synthetic bass: 0.25 + 0.2*sin(time*3)' : state.status === 'playing' ? 'local audio' : 'silent',
    audio: { status: state.status, time: state.currentTime, duration: state.duration, fftSize: 1024 },
    time: frozen ? fixedTime : clock, reducedMotion: motion.checked,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    drawingBuffer: { width: engine?.dimensions.x, height: engine?.dimensions.y },
    output: { toneMapping: 'ACES', antialiasing: 'FXAA after single display transform', exposure: Number(exposure.value), bloom: Number(bloom.value), scale: Number(scale.value) },
    simulation: mode.value === 'particles' ? '8,000 analytic instanced sprites; no compute/storage required on either backend' : 'TSL/scene; no compute required',
    metric: 'requestAnimationFrame intervals, NOT GPU execution time; 60 Hz reference',
    timingSources: { raf: 'requestAnimationFrame interval', cpu: 'mode.update + pipeline submit (performance.now)', gpu: engine?.gpuTimingAvailable ? 'WebGPU timestamp query' : 'unavailable' },
  };
}
function cancelBenchmark(message: string) {
  if (!benchmarkRun) return;
  benchmarkRun = undefined;
  benchmark.disabled = false;
  benchmarkStatus.textContent = message;
}
function resetTiming() {
  lastFrame = 0;
  warmUntil = performance.now() + 5000;
  intervals = [];
  cancelBenchmark('Benchmark cancelled: settings, playback, viewport, scene, or visibility changed.');
}
function resize() {
  engine?.resize(innerWidth, innerHeight, Number(scale.value));
  resetTiming();
}
async function releaseGraphics() {
  const previous = engine;
  engine = undefined;
  gpuDisposal = gpuDisposal.then(() => previous?.dispose()).catch((error) => console.error('Graphics cleanup failed', error));
  await gpuDisposal;
}
async function start() {
  if (starting || shutdown) return;
  const generation = ++epoch;
  starting = true;
  failed = false;
  loop.stop();
  restart.disabled = backend.disabled = mode.disabled = compatibility.disabled = true;
  status.textContent = 'Initializing graphics backend…';
  status.dataset.state = 'loading';
  compatibility.hidden = true;
  try {
    await releaseGraphics();
    if (shutdown || generation !== epoch) return;
    const candidate = await VisualEngine.create(backend.value as BackendPreference, (message) => {
      if (!shutdown && generation === epoch) fail(message);
    });
    if (shutdown || generation !== epoch) { await candidate.dispose(); return; }
    engine = candidate;
    viewport.replaceChildren(candidate.renderer.domElement);
    resize();
    candidate.select(mode.value);
    draw(0);
    if (failed) throw new Error('Graphics validation failed during the first frame.');
    status.textContent = `Ready: ${candidate.backend === 'webgpu' ? 'native WebGPU' : 'WebGL2 compatibility'} · Three.js 0.186.1 · Stage 3`;
    status.dataset.state = 'ready';
    if (!document.hidden) loop.start(frame);
  } catch (error) {
    if (generation === epoch && !shutdown) fail(error);
  } finally {
    if (generation === epoch) {
      starting = false;
      restart.disabled = backend.disabled = mode.disabled = compatibility.disabled = false;
    }
  }
}
function draw(delta: number) {
  const snapshot = audio.sample(delta);
  if (!synthetic.checked && audio.state.trackName && !frozen && !paused && !motion.checked) clock = snapshot.time;
  if (synthetic.checked) {
    fixture.time = frozen ? fixedTime : clock;
    fixture.bass = 0.25 + 0.2 * Math.sin(fixture.time * 3);
  }
  const source = synthetic.checked ? fixture : snapshot;
  const response = envelope.update(source, delta, Number(sensitivity.value), motion.checked);
  if (!frozen && !paused && !motion.checked) hueClock += delta / Number(colorSpeed.value);
  engine?.render({ time: frozen ? fixedTime : clock, delta: frozen || paused || motion.checked ? 0 : delta, audio: source, response, hue: (hueClock * 0.12) % 1, reducedMotion: motion.checked, reducedFlash: reducedFlash.checked }, Number(exposure.value), Number(bloom.value));
}
function frame(now: number) {
  if (shutdown || failed || document.hidden) { loop.stop(); return; }
  const deltaMs = lastFrame ? now - lastFrame : 0;
  lastFrame = now;
  const delta = clampDelta(deltaMs / 1000);
  if (!frozen && !paused && !motion.checked) {
    clock = !synthetic.checked && audio.state.trackName ? audio.state.currentTime : clock + delta;
  }
  try {
    draw(delta);
    if (failed) return;
    if (deltaMs > 0 && now >= warmUntil) {
      intervals.push(deltaMs);
      if (intervals.length > 7200) intervals.shift();
      if (benchmarkRun) benchmarkRun.samples.push(deltaMs);
    }
    if (benchmarkRun && now - benchmarkRun.start >= 60000) {
      reports.push({ ...metadata(), durationSeconds: 60, timings: summarizeIntervals(benchmarkRun.samples) });
      if (reports.length > 12) reports.shift();
      benchmarkRun = undefined;
      benchmark.disabled = false;
      benchmarkStatus.textContent = '60-second report recorded. Export diagnostics to save it.';
    }
    if (now >= nextDiagnostics) {
      nextDiagnostics = now + 500;
      const stats = summarizeIntervals(intervals);
      diagnostics.textContent = `${engine?.backend} · ${engine?.dimensions.x} × ${engine?.dimensions.y} pixels\n${stats.count} steady-state samples · median ${stats.medianMs.toFixed(2)} ms · p95 ${stats.p95Ms.toFixed(2)} ms · p99 ${stats.p99Ms.toFixed(2)} ms\n${stats.missedFrames} intervals over 18.33 ms (60 Hz reference)\ncpu ${engine?.lastFrame.cpuUpdateMs.toFixed(2)} ms · gpu ${engine?.lastFrame.gpuMs == null ? 'n/a' : `${engine.lastFrame.gpuMs.toFixed(2)} ms`}${now < warmUntil ? '\nWarming up — excluded from measurements.' : ''}`;
    }
  } catch (error) { fail(error); }
}

restart.addEventListener('click', () => void start());
backend.addEventListener('change', () => void start());
compatibility.addEventListener('click', () => { backend.value = 'webgl2'; void start(); });
mode.addEventListener('change', () => {
  if (!engine || failed || starting) return;
  try { engine.select(mode.value); clock = 0; resetTiming(); }
  catch (error) { fail(error); }
});
scale.addEventListener('change', resize);
for (const control of [exposure, bloom, synthetic, motion, sensitivity, colorSpeed, reducedFlash]) control.addEventListener('input', resetTiming);
freeze.setAttribute('aria-pressed', String(frozen));
freeze.addEventListener('click', () => { frozen = !frozen; freeze.setAttribute('aria-pressed', String(frozen)); resetTiming(); });
benchmark.addEventListener('click', () => {
  if (!engine || failed || starting) { benchmarkStatus.textContent = 'Initialize a working renderer first.'; return; }
  benchmarkRun = { start: Math.max(performance.now(), warmUntil), samples: [] };
  benchmark.disabled = true;
  benchmarkStatus.textContent = 'Recording 60 seconds after warmup. Keep this tab visible and settings unchanged.';
});
element('export').addEventListener('click', () => {
  const data = { current: { ...metadata(), timings: summarizeIntervals(intervals) }, benchmarks: reports };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'visualizer-capabilities.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
function toggleControls() {
  controls.hidden = !controls.hidden; show.hidden = !controls.hidden;
  (controls.hidden ? show : element('hide')).focus();
}
element('hide').addEventListener('click', toggleControls);
show.addEventListener('click', toggleControls);
async function fullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (error) { benchmarkStatus.textContent = `Fullscreen unavailable: ${String(error)}`; }
}
element('fullscreen').addEventListener('click', () => void fullscreen());
window.addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, select, textarea, button, a'))) return;
  if (event.code === 'Space') {
    event.preventDefault();
    if (audio.state.trackName) void player.togglePlayback(); else paused = !paused;
    resetTiming();
  }
  if (event.key.toLowerCase() === 'h') toggleControls();
  if (event.key.toLowerCase() === 'f') void fullscreen();
});
window.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => {
  loop.stop(); resetTiming();
  if (!document.hidden && !failed && !starting && !shutdown) loop.start(frame);
});
window.addEventListener('pagehide', (event) => {
  shutdown = true; ++epoch; starting = false; loop.stop(); resetTiming(); audio.pause();
  void releaseGraphics();
  // Keep the lightweight player for bfcache; release its graph if navigating away.
  if (!event.persisted) { player.dispose(); void audio.dispose().catch(console.error); }
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) { shutdown = false; void start(); }
});
void start();
