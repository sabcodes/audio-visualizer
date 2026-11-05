import { VisualEngine } from './rendering/VisualEngine';
import { clampDelta, summarizeIntervals, type FrameTimingStats } from './rendering/diagnostics';
import type { BackendPreference } from './rendering/backendSelection';
import { AudioEngine, type AudioFrame } from './audio/AudioEngine';
import { ControlPanel } from './ui/ControlPanel';
import { FrameLoop } from './rendering/FrameLoop';
import { modeDefinitions } from './modes/registry';
import type { SpectrumMapping } from './modes/types';
import { ResponseEnvelope } from './audio/VisualResponse';
import { CalmAudio } from './audio/calmAudio';
import { AdaptiveResolution } from './rendering/AdaptiveResolution';
import { parseOutputSettings, type AntialiasingName, type ToneMappingName } from './rendering/outputSettings';
import { presetBudget, qualityPresets, type QualityPreset } from './rendering/quality';
import { loadFavorites, saveFavorite } from './settings';
import { bindSceneBrowser, bindRangeValues, visualPreferences } from './ui/VisualControls';
import { volumetricBudget } from './modes/volumetricMode';
import { flockBudget } from './modes/gpuFlockMode';

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
const quality = element<HTMLSelectElement>('quality');
const toneMapping = element<HTMLSelectElement>('tone-mapping');
const antialiasing = element<HTMLSelectElement>('aa');
const spectrum = element<HTMLSelectElement>('spectrum');
const targetHz = element<HTMLSelectElement>('target-hz');
const adaptive = new AdaptiveResolution();
const refreshHz = () => Number(targetHz.value);
const renderScale = () => (scale.value === 'auto' ? adaptive.scale : Number(scale.value));
const exposure = element<HTMLInputElement>('exposure');
const bloom = element<HTMLInputElement>('bloom');
const motion = element<HTMLInputElement>('motion');
const synthetic = element<HTMLInputElement>('synthetic');
const sensitivity = element<HTMLInputElement>('sensitivity');
const colorSpeed = element<HTMLInputElement>('color-speed-slider');
const reducedFlash = element<HTMLInputElement>('reduced-flash');
const envelope = new ResponseEnvelope();
const calm = new CalmAudio();
let hueClock = 0;
const freeze = element<HTMLButtonElement>('freeze');
const restart = element<HTMLButtonElement>('restart');
const compatibility = element<HTMLButtonElement>('compatibility');
const benchmark = element<HTMLButtonElement>('benchmark');
const benchmarkStatus = element('benchmark-status');
const controls = element('controls');
const show = element('show');
const quickControls = element('quick-controls');
const favoriteButton = element<HTMLButtonElement>('favorite');
const quickFavorite = element<HTMLButtonElement>('quick-favorite');
const favoriteModes = element<HTMLSelectElement>('favorite-modes');
const quickBloom = element<HTMLInputElement>('quick-bloom');
const quickExposure = element<HTMLInputElement>('quick-exposure');
const settingsStatus = element('settings-status');
const transition = element<HTMLSelectElement>('transition');
const sceneDetail = element('scene-detail');
const savedPreferences = visualPreferences(controls);
const syncRangeValues = bindRangeValues(document.body);
adaptive.budgetMs = 1000 / refreshHz();
const validFavoriteIds = new Set(modeDefinitions.map(definition => definition.id));
let favorites = new Set<string>();
let favoritesReady = false, favoritesSaving = false;
const params = new URLSearchParams(location.search);
mode.replaceChildren(...modeDefinitions.map((definition) => new Option(definition.label, definition.id)));
if (['auto', 'webgpu', 'webgl2'].includes(params.get('backend') ?? '')) backend.value = params.get('backend')!;
if (modeDefinitions.some((definition) => definition.id === params.get('mode'))) mode.value = params.get('mode')!;
if (qualityPresets.includes(params.get('quality') as QualityPreset)) quality.value = params.get('quality')!;
const budget = () => presetBudget(quality.value as QualityPreset);
if (['linear', 'log'].includes(params.get('spectrum') ?? '')) spectrum.value = params.get('spectrum')!;
const initialOutput = parseOutputSettings(params);
if (params.has('tone')) toneMapping.value = initialOutput.toneMapping;
if (params.has('aa')) antialiasing.value = initialOutput.aa;
const sceneBrowser = bindSceneBrowser(mode, element<HTMLInputElement>('scene-search'), element<HTMLButtonElement>('previous-mode'), element<HTMLButtonElement>('next-mode'), element('scene-count'));
const outputSettings = () => ({ toneMapping: toneMapping.value as ToneMappingName, aa: antialiasing.value as AntialiasingName });
const applyModeBloom = () => { const strength = modeDefinitions.find((definition) => definition.id === mode.value)?.bloom; if (strength !== undefined) bloom.value = String(strength); syncQuickControls(); };
function syncQuickControls() {
  const selected = favorites.has(mode.value);
  favoriteButton.textContent = selected ? '★ Favorited' : '☆ Favorite';
  quickFavorite.textContent = selected ? '★' : '☆';
  for (const button of [favoriteButton, quickFavorite]) {
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-label', `${selected ? 'Unfavorite' : 'Favorite'} current visualization`);
    button.title = `${selected ? 'Remove' : 'Save'} this visualization ${selected ? 'from' : 'to'} favorites`;
    button.disabled = mode.disabled || !favoritesReady || favoritesSaving;
  }
  const options = Array.from(mode.options).filter((option) => favorites.has(option.value)).map((option) => {
    const favorite = new Option(option.text, option.value);
    favorite.disabled = option.disabled;
    return favorite;
  });
  const placeholder = new Option(options.length ? `Favorites · ${options.length}` : '☆ Star scenes to add favorites', '');
  placeholder.disabled = true;
  favoriteModes.replaceChildren(placeholder, ...options);
  favoriteModes.value = selected ? mode.value : '';
  favoriteModes.disabled = mode.disabled || !options.some((option) => !option.disabled);
  quickBloom.value = bloom.value;
  quickExposure.value = exposure.value;
  syncRangeValues();
}
for (const button of [favoriteButton, quickFavorite]) button.addEventListener('click', async () => {
  favoritesSaving = true;
  settingsStatus.hidden = true;
  syncQuickControls();
  try { favorites = await saveFavorite(mode.value, !favorites.has(mode.value), validFavoriteIds); }
  catch {
    settingsStatus.textContent = 'Could not save favorites. Your saved list is unchanged. Try again.';
    settingsStatus.hidden = false;
  } finally { favoritesSaving = false; syncQuickControls(); }
});
favoriteModes.addEventListener('change', () => {
  if (!favoriteModes.value || favoriteModes.selectedOptions[0]?.disabled || mode.disabled) return;
  mode.value = favoriteModes.value;
  mode.dispatchEvent(new Event('change'));
});
for (const [compact, full] of [[quickBloom, bloom], [quickExposure, exposure]]) {
  compact.addEventListener('input', () => {
    full.value = compact.value;
    full.dispatchEvent(new Event('input', { bubbles: true }));
    savedPreferences.save();
  });
  full.addEventListener('input', () => { compact.value = full.value; syncRangeValues(); });
}
syncQuickControls();
void loadFavorites(validFavoriteIds).then(saved => {
  favorites = saved; favoritesReady = true; syncQuickControls();
}).catch(() => {
  settingsStatus.textContent = 'Could not load favorites. Check browser storage or the local server, then reload to retry.';
  settingsStatus.hidden = false;
});
const requestedTime = Number(params.get('time'));
const validTime = params.has('time') && Number.isFinite(requestedTime) && requestedTime >= 0;
const fixedTime = validTime ? requestedTime : 2;
let frozen = validTime;
let paused = false;
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
if (motionPreference.matches) motion.checked = true;
motionPreference.addEventListener('change', event => {
  if (event.matches) { motion.checked = true; motion.dispatchEvent(new Event('input')); }
});

let engine: VisualEngine | undefined;
let starting = false;
let modeDefaultsApplied = false;
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
export interface BenchResult { raf: FrameTimingStats; cpu: FrameTimingStats; gpu: FrameTimingStats | null; drawingBuffer: { width: number; height: number } }
let benchHook: { until: number; raf: number[]; cpu: number[]; gpu: number[]; lastGpuSample: number; done: (result: BenchResult) => void } | undefined;
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
    schemaVersion: 2, stage: 'Stage 5 release',
    timestamp: new Date().toISOString(),
    secureContext: isSecureContext, backendRequested: backend.value, backendActual: engine?.backend ?? 'unavailable',
    startupFailures: engine?.startupFailures ?? [], gpu: 'Record physical GPU and OS in the hardware review.',
    mode: mode.value, seed: 42, sensitivity: Number(sensitivity.value), colorInterval: Number(colorSpeed.value), reducedFlash: reducedFlash.checked,
    fixture: synthetic.checked ? 'synthetic bass: 0.25 + 0.2*sin(time*3)' : state.source === 'system' ? 'system audio capture' : state.status === 'playing' ? 'local audio' : 'silent',
    audio: { status: state.status, source: state.source, time: state.currentTime, duration: state.duration, fftSize: 1024 },
    time: frozen ? fixedTime : clock, reducedMotion: motion.checked,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    drawingBuffer: { width: engine?.dimensions.x, height: engine?.dimensions.y },
    quality: quality.value, spectrumMapping: spectrum.value, output: { toneMapping: toneMapping.value, antialiasing: `${antialiasing.value} after single display transform`, exposure: Number(exposure.value), bloom: Number(bloom.value), scale: renderScale(), scaleMode: scale.value === 'auto' ? 'auto' : 'locked', targetHz: refreshHz() },
    transition: { seconds: motion.checked ? 0 : Number(transition.value), strategy: 'bounded outgoing-frame snapshot; one live scene; two targets capped at 1920 × 1080' },
    volumetrics: mode.value === 'godrays' && engine?.backend === 'webgpu' && quality.value !== 'compatibility' ? volumetricBudget(budget()) : null,
    simulation: mode.value === 'boids' && engine?.backend === 'webgpu' && quality.value !== 'compatibility' ? { ...flockBudget(budget()), method: 'double-buffered GPU state; rotating bounded neighbor samples; 120 Hz' } : mode.value === 'particles' ? `${Math.round(8000 * budget().particleScale)} analytic curl sprites; no compute/storage required on either backend` : 'TSL/scene',
    metric: 'requestAnimationFrame intervals, NOT GPU execution time; 60 Hz reference',
    timingSources: { raf: 'requestAnimationFrame interval', cpu: 'mode.update + simulation + pipeline submit (performance.now)', gpu: engine?.gpuTimingAvailable ? 'submission-start to GPU queue completion; upper bound including callback overhead' : 'unavailable', gpuPassSum: 'raw timestamp sum; overlapping pass intervals are not elapsed frame time' },
    gpuPassSumMs: engine?.lastFrame.gpuPassMs ?? null,
  };
}
/** Re-applies the Render scale select's Auto/locked choice, e.g. after a benchmark held the scale. */
function applyScaleMode() { adaptive.lock(scale.value === 'auto' ? null : Number(scale.value)); }
function cancelBenchmark(message: string) {
  if (!benchmarkRun) return;
  benchmarkRun = undefined;
  applyScaleMode();
  benchmark.disabled = false;
  benchmarkStatus.textContent = message;
}
function resetTiming() {
  lastFrame = 0;
  warmUntil = performance.now() + 5000;
  intervals = [];
  adaptive.reset(performance.now());
  cancelBenchmark('Benchmark cancelled: settings, playback, viewport, scene, or visibility changed.');
}
function resize() {
  if (!benchmarkRun) applyScaleMode();
  engine?.resize(innerWidth, innerHeight, renderScale());
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
  const requestedMode = mode.value;
  starting = true;
  failed = false;
  loop.stop();
  restart.disabled = backend.disabled = mode.disabled = compatibility.disabled = true;
  sceneBrowser.refresh();
  syncQuickControls();
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
    // WebGPU-only modes (compute passes) are greyed out on the WebGL2 fallback.
    for (const option of mode.options) option.disabled = !modeDefinitions.find((definition) => definition.id === option.value)?.backends.includes(candidate.backend);
    if (mode.selectedOptions[0]?.disabled) mode.value = modeDefinitions[0].id;
    await candidate.setQuality(budget());
    candidate.setOutput(outputSettings());
    candidate.setTransition(Number(transition.value), motion.checked);
    if (!modeDefaultsApplied || mode.value !== requestedMode) {
      applyModeBloom(); modeDefaultsApplied = true;
    }
    viewport.replaceChildren(candidate.renderer.domElement);
    resize();
    await candidate.select(mode.value);
    if (shutdown || generation !== epoch) return;
    if (failed) throw new Error('Graphics validation failed during initialization.');
    draw(0);
    if (failed) throw new Error('Graphics validation failed during the first frame.');
    status.textContent = `Ready: ${candidate.backend === 'webgpu' ? 'native WebGPU' : 'WebGL2 compatibility'} · Three.js 0.186.1`;
    updateSceneDetail();
    status.dataset.state = 'ready';
    if (!document.hidden) loop.start(frame);
  } catch (error) {
    if (generation === epoch && !shutdown) fail(error);
  } finally {
    if (generation === epoch) {
      starting = false;
      restart.disabled = backend.disabled = mode.disabled = compatibility.disabled = false;
      sceneBrowser.refresh();
      syncQuickControls();
    }
  }
}
function draw(delta: number) {
  engine?.setTransition(Number(transition.value), motion.checked);
  const snapshot = audio.sample(delta);
  if (!synthetic.checked && audio.state.source === 'file' && audio.state.trackName && !frozen && !paused && !motion.checked) clock = snapshot.time;
  if (synthetic.checked) {
    fixture.time = frozen ? fixedTime : clock;
    fixture.bass = 0.25 + 0.2 * Math.sin(fixture.time * 3);
  }
  const raw = synthetic.checked ? fixture : snapshot;
  if (!motion.checked) calm.reset();
  const source = motion.checked ? calm.update(raw, delta) : raw;
  const response = envelope.update(source, delta, Number(sensitivity.value), motion.checked);
  if (!frozen && !paused && !motion.checked) hueClock += delta / Number(colorSpeed.value);
  engine?.render({ time: frozen ? fixedTime : clock, delta: frozen || paused || motion.checked ? 0 : delta, audio: source, response, hue: (hueClock * 0.12) % 1, reducedMotion: motion.checked, reducedFlash: reducedFlash.checked, spectrumMapping: spectrum.value as SpectrumMapping, sampleRate: audio.sampleRate, sensitivity: Number(sensitivity.value) }, Number(exposure.value), Number(bloom.value));
}
function frame(now: number) {
  if (shutdown || failed || document.hidden) { loop.stop(); return; }
  const deltaMs = lastFrame ? now - lastFrame : 0;
  lastFrame = now;
  const delta = clampDelta(deltaMs / 1000);
  if (!frozen && !paused && !motion.checked) {
    // A live source has no timeline, so it runs on wall-clock time like the silent state.
    clock = !synthetic.checked && audio.state.source === 'file' && audio.state.trackName ? audio.state.currentTime : clock + delta;
  }
  try {
    draw(delta);
    if (failed) return;
    if (deltaMs > 0 && now >= warmUntil) {
      intervals.push(deltaMs);
      if (intervals.length > 7200) intervals.shift();
      if (benchmarkRun) benchmarkRun.samples.push(deltaMs);
    }
    if (benchHook && engine && deltaMs > 0) {
      benchHook.raf.push(deltaMs); benchHook.cpu.push(engine.lastFrame.cpuUpdateMs);
      const gpu = engine.lastFrame.gpuMs;
      if (gpu !== null && engine.lastFrame.gpuSample !== benchHook.lastGpuSample) { benchHook.gpu.push(gpu); benchHook.lastGpuSample = engine.lastFrame.gpuSample; }
      if (now >= benchHook.until) {
        const { raf, cpu, gpu: gpuSamples, done } = benchHook; benchHook = undefined;
        done({ raf: summarizeIntervals(raf, refreshHz()), cpu: summarizeIntervals(cpu, refreshHz()), gpu: gpuSamples.length ? summarizeIntervals(gpuSamples, refreshHz()) : null, drawingBuffer: { width: engine.dimensions.x, height: engine.dimensions.y } });
      }
    }
    // Automatic steps keep the benchmark window: only explicit setting changes reset timing.
    const gpuMs = engine?.lastFrame.gpuMs;
    const frameCost = engine && gpuMs != null ? Math.max(engine.lastFrame.cpuUpdateMs, gpuMs) : null;
    const nextScale = deltaMs > 0 ? adaptive.sample(deltaMs, now, frameCost) : null;
    if (nextScale !== null) engine?.resize(innerWidth, innerHeight, nextScale);
    if (benchmarkRun && now - benchmarkRun.start >= 60000) {
      reports.push({ ...metadata(), durationSeconds: 60, timings: summarizeIntervals(benchmarkRun.samples, refreshHz()) });
      if (reports.length > 12) reports.shift();
      benchmarkRun = undefined;
      applyScaleMode();
      benchmark.disabled = false;
      benchmarkStatus.textContent = '60-second report recorded. Export diagnostics to save it.';
    }
    if (now >= nextDiagnostics) {
      nextDiagnostics = now + 500;
      const stats = summarizeIntervals(intervals, refreshHz());
      diagnostics.textContent = `${engine?.backend} · ${engine?.dimensions.x} × ${engine?.dimensions.y} pixels\n${stats.count} steady-state samples · median ${stats.medianMs.toFixed(2)} ms · p95 ${stats.p95Ms.toFixed(2)} ms · p99 ${stats.p99Ms.toFixed(2)} ms\n${stats.missedFrames} intervals over ${(1100 / refreshHz()).toFixed(2)} ms (${refreshHz()} Hz target) · render scale ${renderScale()} (${scale.value === 'auto' ? 'auto' : 'locked'})\ncpu ${engine?.lastFrame.cpuUpdateMs.toFixed(2)} ms · gpu ${engine?.lastFrame.gpuMs == null ? 'n/a' : `${engine.lastFrame.gpuMs.toFixed(2)} ms (submit → complete, upper bound)`}${now < warmUntil ? '\nWarming up — excluded from measurements.' : ''}`;
    }
  } catch (error) { fail(error); }
}

restart.addEventListener('click', () => void start());
backend.addEventListener('change', () => void start());
compatibility.addEventListener('click', () => { backend.value = 'webgl2'; void start(); });
mode.addEventListener('change', () => {
  syncQuickControls();
  if (!engine || failed || starting) return;
  // Hold adaptive scaling through the compile: a one-time shader compile must not lower quality.
  adaptive.reset(performance.now());
  sceneDetail.textContent = 'Preparing scene…';
  const selectedEngine = engine;
  const generation = epoch;
  selectedEngine.select(mode.value).then((active) => {
    if (active && selectedEngine === engine && generation === epoch && !failed && !shutdown) {
      clock = 0; applyModeBloom(); updateSceneDetail(); resetTiming();
    }
  }).catch(error => { if (selectedEngine === engine && generation === epoch && !shutdown) fail(error); });
});
scale.addEventListener('change', resize);
quality.addEventListener('change', () => {
  if (!engine || failed || starting) return;
  adaptive.reset(performance.now());
  const selectedEngine = engine;
  const generation = epoch;
  selectedEngine.setQuality(budget()).then(() => {
    if (selectedEngine === engine && generation === epoch && !failed && !shutdown) { updateSceneDetail(); resetTiming(); }
  }).catch(error => { if (selectedEngine === engine && generation === epoch && !shutdown) fail(error); });
});
for (const control of [toneMapping, antialiasing]) control.addEventListener('change', () => {
  if (!engine || failed || starting) return;
  try { engine.setOutput(outputSettings()); resetTiming(); } catch (error) { fail(error); }
});
targetHz.addEventListener('change', () => { adaptive.budgetMs = 1000 / refreshHz(); resetTiming(); });
for (const control of [spectrum, exposure, bloom, synthetic, motion, sensitivity, colorSpeed, reducedFlash]) control.addEventListener('input', resetTiming);
for (const control of [transition, motion]) control.addEventListener('change', () => {
  engine?.setTransition(Number(transition.value), motion.checked); resetTiming();
});
function updateSceneDetail() {
  if (mode.value === 'godrays') {
    const volume = engine?.backend === 'webgpu' && quality.value !== 'compatibility';
    const settings = volumetricBudget(budget());
    sceneDetail.textContent = volume ? `Raymarched fog · ${settings.samples} samples · ${Math.round(settings.scale * 100)}% scene resolution · unshadowed light shafts` : 'Stylized additive cones · compatibility treatment';
  } else if (mode.value === 'particles') sceneDetail.textContent = `${Math.round(8000 * budget().particleScale).toLocaleString()} GPU particles · layered curl motion and depth colour`;
  else if (mode.value === 'boids') sceneDetail.textContent = engine?.backend === 'webgpu' && quality.value !== 'compatibility' ? `${flockBudget(budget()).count.toLocaleString()} GPU boids · ${flockBudget(budget()).neighbors} sampled neighbors · double-buffered 120 Hz simulation` : `${Math.round(220 * budget().particleScale)} CPU boids · bounded compatibility simulation`;
  else sceneDetail.textContent = modeDefinitions.find(definition => definition.id === mode.value)?.label ?? '';
}
freeze.setAttribute('aria-pressed', String(frozen));
freeze.addEventListener('click', () => { frozen = !frozen; freeze.setAttribute('aria-pressed', String(frozen)); resetTiming(); });
benchmark.addEventListener('click', () => {
  if (!engine || failed || starting) { benchmarkStatus.textContent = 'Initialize a working renderer first.'; return; }
  // One resolution for the whole run (spec §9 records the actual drawing buffer).
  adaptive.lock(renderScale());
  benchmarkRun = { start: Math.max(performance.now(), warmUntil), samples: [] };
  benchmark.disabled = true;
  benchmarkStatus.textContent = 'Recording 60 seconds after warmup. Keep this tab visible and settings unchanged.';
});
element('export').addEventListener('click', () => {
  const data = { current: { ...metadata(), timings: summarizeIntervals(intervals, refreshHz()) }, benchmarks: reports };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'visualizer-capabilities.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
function toggleControls() {
  controls.hidden = !controls.hidden; quickControls.hidden = !controls.hidden;
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
    if (audio.state.source === 'file' && audio.state.trackName) void player.togglePlayback(); else paused = !paused;
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
  shutdown = true; ++epoch; starting = false; loop.stop(); resetTiming(); audio.stopListening(); audio.pause();
  void releaseGraphics();
  // Keep the lightweight player for bfcache; release its graph if navigating away.
  if (!event.persisted) { player.dispose(); void audio.dispose().catch(console.error); }
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) { shutdown = false; void start(); }
});
if (import.meta.env.DEV) {
  // Test-only window into lifecycle state; absent from production builds.
  Object.assign(window, { __visualizerDebug: {
    get activeMode() { return engine?.activeMode; },
    get activeScene() { return engine?.activeScene; },
    get renderer() { return engine?.renderer; },
    get frameTiming() { return engine ? { ...engine.lastFrame } : undefined; },
    get pipelineAa() { return engine?.pipelineAa; },
    get transitioning() { return engine?.transitioning; },
    get adaptiveHolding() { return adaptive.isHolding(performance.now()); },
    get adaptiveLocked() { return adaptive.isLocked; },
    setCompileDelay(ms: number) { if (engine) engine.compileDelayMs = ms; },
    bench: (seconds: number) => new Promise<BenchResult>((done) => { benchHook = { until: performance.now() + seconds * 1000, raf: [], cpu: [], gpu: [], lastGpuSample: engine?.lastFrame.gpuSample ?? 0, done }; }),
  } });
}
void start();
