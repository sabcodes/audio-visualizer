# Stage 3 — GPU Scaling and Image-Quality Tuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measurably improve frame time and image quality over the approved Stage 2 port, adding quality presets, adaptive resolution and selectable output settings, without changing how any of the 18 modes are recognized.

**Architecture:** Measure first. A headed benchmark harness records a Stage 2 baseline for the 8 representative modes. A pure `AdaptiveResolution` controller and a `QualityBudget` from `quality.ts` then drive render scale and per-mode budgets. Only hotspots the baseline proves are worth it move into TSL vertex nodes. Output settings (tone mapping, AA) and spectrum mapping changes go through a reference-capture review page and land only after the user approves them. The same harness then produces the after-numbers for the exit gate.

**Tech Stack:** TypeScript 5.9.3, Three.js 0.186.1 (`three/webgpu`, `three/tsl`, `three/addons/tsl/display/*`), Vite 8.3.5, Vitest 5.0.5, Playwright 1.64.1 against installed Chrome.

**Spec:** `WEBGPU_MODERNIZATION_PLAN.md` — §8 Stage 3, plus §6 (output pipeline), §7 (audio response), §9 (quality targets and benchmark method), §10 (acceptance tests).

## Global Constraints

- Pinned versions are unchanged: `three` 0.186.1. No new runtime dependencies and no downloaded browsers or media.
- Keep the legacy entry (`index.html`, `script.js`, `style.css`) untouched.
- All 18 mode IDs, labels and controls stay the same. Visual changes are reviewed, not silently accepted (§8 Stage 2 exit-gate wording carries forward).
- Reference configuration: this Mac, installed Chrome, native WebGPU, **Balanced** preset. The primary budget is 60 Hz = 16.7 ms; 120 Hz (8.3 ms) is reported but not gated.
- Presets (§9): Compatibility = 1080p-class internal; Balanced = 1080p internal, 60 fps target; High = 1440p-class internal; Ultra/manual = native resolution, opt-in.
- Steady-state target (§9): p95 frame interval within 10% of the selected refresh budget (≤ 18.33 ms at 60 Hz).
- A requestAnimationFrame interval is not GPU time. Label rAF, CPU-update and GPU-timestamp numbers separately in every report.
- Do not lower quality because of a one-time shader compile (§8 Stage 3).
- Warm only the selected effect. Never compile or allocate every mode eagerly.
- Exported/committed diagnostics must not contain `userAgent`, `navigator.platform`, user names, paths or emails (repo security rule set on 2026-10-24).
- Work on branch `sabcodex/stage-3-gpu-scaling`; commit per task; merge to `main` and tag `stage-3` only after the user approves the exit gate.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Mode switch during adaptive downscale.** Switching mode while the controller is mid-window must not carry the old mode's slow samples into the new mode. Expect a reset plus a 5 s warmup exclusion. → Test in Task 3.
2. **Tab hidden then shown.** The first interval after `visibilitychange` is huge. It must not trigger a downscale. → Test in Task 3.
3. **Resize or DPR change while a preset is active.** The internal resolution must be recomputed from the new CSS size, and the 1080p cap must still hold on a 2× display. → Test in Task 2.
4. **Rapid mode changes while compile-before-display is pending.** Only the last requested mode may become active, and an abandoned compile must not leak its scene. → Test in Task 4.
5. **WebGL2 compatibility tier with GPU-ported modes.** City and Star Tunnel vertex nodes must also compile and render on forced WebGL2. GPU timestamps are unavailable there, and reports must say so rather than show zeros. → Tests in Tasks 1, 6 and 7.

---

### Task 1: Refresh-aware diagnostics and per-frame timing breakdown

**Files:**
- Modify: `src/rendering/diagnostics.ts` (`summarizeIntervals`)
- Modify: `src/rendering/VisualEngine.ts` (`create`, `render`)
- Modify: `src/main.ts` (`metadata`, diagnostics text, `stage` string)
- Test: `tests/unit/diagnostics.test.ts`

**Interfaces:**
- Produces: `summarizeIntervals(samplesMs: number[], refreshHz = 60): FrameTimingStats`. The missed-frame threshold becomes `1.1 * 1000 / refreshHz`.
- Produces: `FrameBreakdown = { cpuUpdateMs: number; gpuMs: number | null }` and `VisualEngine.lastFrame: FrameBreakdown`. `gpuMs` stays `null` on WebGL2 or when timestamps are unsupported.
- Produces: `metadata().timingSources = { raf: 'requestAnimationFrame interval', cpu: 'mode.update + pipeline submit (performance.now)', gpu: 'WebGPU timestamp query' | 'unavailable' }`.

- [ ] **Step 1: Write failing tests** in `tests/unit/diagnostics.test.ts`:
  - `summarizeIntervals([8, 9, 10], 120).missedFrames === 1` (threshold 9.1667 ms).
  - `summarizeIntervals([17, 19], 60).missedFrames === 1`, and calling it without `refreshHz` gives the same result (default stays 60).
- [ ] **Step 2: Run** `npx vitest run tests/unit/diagnostics.test.ts`. Expected: the 120 Hz case FAILS.
- [ ] **Step 3: Implement** the `refreshHz` parameter. In `VisualEngine.create`, pass `trackTimestamp: true` to `WebGPURenderer`. In `render`, time `active.update` plus `output.render` with `performance.now()`. On WebGPU, call `renderer.resolveTimestampsAsync('render')` at most every 500 ms and store the result in `lastFrame.gpuMs`. Never await it inside the frame. In `main.ts`, show `cpu x ms · gpu y ms|n/a` in the diagnostics `<pre>`, add `timingSources`, and set `stage` to `'Stage 3 GPU scaling — in progress'`. Also update the `<small>` subtitle in `modern.html` and the `Ready:` status text.
- [ ] **Step 4: Run** `npm test && npm run build`. Expected: all pass.
- [ ] **Step 5: Run** `npm run test:browser`. Expected: the compatibility suite passes, and the diagnostics text shows `gpu n/a` on WebGL2.
- [ ] **Step 6: Commit** `feat(diagnostics): refresh-aware missed frames and cpu/gpu breakdown`.

### Task 2: Quality presets and internal-resolution budget

**Files:**
- Create: `src/rendering/quality.ts`
- Modify: `src/modes/types.ts` (`ModeDefinition.create`)
- Modify: `src/modes/registry.ts` (pass budget through `select`)
- Modify: `src/modes/particleModes.ts` (swirl count from budget)
- Modify: `src/rendering/VisualEngine.ts` (`select`, `resize`)
- Modify: `src/main.ts`, `modern.html` (Quality select, `?quality=` param)
- Test: `tests/unit/quality.test.ts`, `tests/unit/modes.test.ts`

**Interfaces:**
- Produces: `type QualityPreset = 'compatibility' | 'balanced' | 'high' | 'ultra'`.
- Produces: `interface QualityBudget { preset: QualityPreset; internalHeight: number | null; particleScale: number }` and `presetBudget(preset: QualityPreset): QualityBudget`.
  - Values: compatibility `{1080, 0.5}`, balanced `{1080, 1}`, high `{1440, 2}`, ultra `{null, 2}`.
- Produces: `basePixelRatio(budget: QualityBudget, cssHeight: number, dpr: number): number` = `internalHeight === null ? min(dpr, 2) : min(dpr, 2, internalHeight / cssHeight)`, clamped to ≥ 0.25.
- Produces: `ModeDefinition.create(budget: QualityBudget): VisualMode` and `ModeRegistry.select(id, backend, budget)`.
- Produces: `VisualEngine.setQuality(budget)`. It re-selects the active mode only when `particleScale` changed; otherwise it only re-runs `resize`. `VisualEngine.resize(width, height, scale)` multiplies `scale` by `basePixelRatio(...)`.

- [ ] **Step 1: Write failing tests** in `tests/unit/quality.test.ts`:
  - `basePixelRatio(presetBudget('balanced'), 861, 2)` ≈ `1080 / 861` (≈ 1.2544). The 1080p cap holds on a 2× display (Review Focus 3).
  - `basePixelRatio(presetBudget('balanced'), 1400, 2)` ≈ `1080 / 1400`.
  - `basePixelRatio(presetBudget('ultra'), 861, 3) === 2`.
  - `basePixelRatio(presetBudget('compatibility'), 100000, 1) === 0.25`.
  - Swirl particle count = `Math.round(8000 * particleScale)`: 4000 / 8000 / 16000 for compatibility / balanced / high (check the `Sprite.count` of `createParticleMode('particles', budget)`).
- [ ] **Step 2: Run** `npx vitest run tests/unit/quality.test.ts`. Expected: FAIL, the module is missing.
- [ ] **Step 3: Implement** `quality.ts` and thread `budget` through `create`, `select` and the registry. Update `tests/unit/modes.test.ts` fakes to accept a budget. Only the swirl (8000 × scale) and boids (Task 8) read `particleScale`; all other modes ignore it. Add `<label>Quality <select id="quality">` with the four presets (default `balanced`) to `modern.html`. Add `?quality=` deep-link validation in `main.ts`, matching the existing `?backend=` pattern. Record `quality` in `metadata()`.
- [ ] **Step 4: Run** `npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Run** `npm run test:browser && npm run test:browser:hardware`. Expected: both PASS, and the parity spec still renders all 18 modes.
- [ ] **Step 6: Commit** `feat(quality): presets with 1080p/1440p internal-resolution budgets`.

### Task 3: Adaptive resolution controller with hysteresis and manual lock

**Files:**
- Create: `src/rendering/AdaptiveResolution.ts`
- Modify: `src/main.ts` (feed samples, reset on mode/visibility/resize/settings change)
- Modify: `modern.html` (Render scale gains `Auto`, which becomes the default)
- Test: `tests/unit/adaptiveResolution.test.ts`

**Interfaces:**
- Consumes: `VisualEngine.resize(width, height, scale)` from Task 2.
- Produces: `class AdaptiveResolution` with:
  - `constructor(options?: { budgetMs?: number; steps?: readonly number[]; windowSize?: number; downRatio?: number; upRatio?: number; upWindows?: number; cooldownMs?: number; warmupMs?: number })`
  - Defaults: `budgetMs = 1000/60`, `steps = [0.5, 0.625, 0.75, 0.875, 1]`, `windowSize = 120`, `downRatio = 1.1`, `upRatio = 0.75`, `upWindows = 3`, `cooldownMs = 2000`, `warmupMs = 5000`.
  - `get scale(): number` starts at `1`.
  - `sample(intervalMs: number, now: number): number | null` returns the new scale when it changes, otherwise `null`.
  - `reset(now: number): void` clears the window and starts warmup.
  - `lock(scale: number | null): void` pins a scale; `null` restores Auto.
- Rules:
  - Samples during warmup or cooldown are ignored, and so are samples > 250 ms (a hidden tab or a compile).
  - When a full window's p95 > `budgetMs * downRatio`, step down one level.
  - Step up one level only after `upWindows` consecutive windows with p95 < `budgetMs * upRatio`.
  - Never leave the `steps` range. Every change starts the cooldown.

- [ ] **Step 1: Write failing tests** in `tests/unit/adaptiveResolution.test.ts`:
  - `ignores a single 400 ms compile spike`: 119 samples of 10 ms plus one of 400 ms after warmup → `scale` stays `1`.
  - `steps down exactly one level on a sustained slow window`: 120 samples of 22 ms → `sample` returns `0.875` once, then `null` during the cooldown.
  - `requires three good windows to step up`: from `0.875` after cooldown, 2 windows of 8 ms → still `0.875`; the 3rd window → `1`.
  - `never goes below 0.5`.
  - `lock pins the scale and ignores samples`: `lock(0.75)` then 360 samples of 30 ms → `scale === 0.75`.
  - `lock(null)` resumes Auto.
  - `reset discards the previous mode's window` (Review Focus 1): 100 slow samples, `reset(t)`, 120 fast samples after warmup → no step down.
  - `hidden-tab gap is ignored` (Review Focus 2): one 3000 ms sample → `null`.
  - `budgetMs` of `1000/120` steps down at a p95 of 9.5 ms.
- [ ] **Step 2: Run** `npx vitest run tests/unit/adaptiveResolution.test.ts`. Expected: FAIL, the module is missing.
- [ ] **Step 3: Implement** the class. Use the nearest-rank p95 the same way `summarizeIntervals` does (import it). Wire it into `main.ts`:
  - The `#scale` select gets options `auto` (default), `0.5`, `0.75`, `1`. A numeric value calls `lock(value)`; `auto` calls `lock(null)`.
  - `resetTiming()` also calls `adaptive.reset(performance.now())`.
  - Each steady-state interval calls `adaptive.sample`. When it returns a value, call `engine.resize(innerWidth, innerHeight, value)` **without** calling `resetTiming` (benchmarks stay valid). Show `render scale 0.875 (auto)` in the diagnostics.
  - Add a `#target-hz` select with options 60 (default) and 120. It sets `budgetMs` and the `summarizeIntervals` `refreshHz`.
- [ ] **Step 4: Run** `npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Run** `npm run test:browser:hardware`. Expected: PASS. The benchmark harness in Task 5 pins `scale=1`, so baseline numbers stay comparable.
- [ ] **Step 6: Commit** `feat(rendering): adaptive render scale with hysteresis, cooldown and manual lock`.

### Task 4: Compile the selected mode before display

**Files:**
- Modify: `src/rendering/VisualEngine.ts` (`select` becomes async)
- Modify: `src/main.ts` (mode change handler, `start`)
- Test: `tests/browser/parity.spec.ts` (new rapid-switch test)

**Interfaces:**
- Produces: `VisualEngine.select(mode: string): Promise<boolean>`. It resolves `true` when this request became active and `false` when a newer request superseded it.
- Behavior:
  1. Create the mode and pipeline off-screen, then `await renderer.compileAsync(scene, camera)`.
  2. If a newer `select` started meanwhile, dispose the candidate and return `false`.
  3. Otherwise swap it in, dispose the previous mode, and return `true`.
  - Only the selected mode is ever compiled.

- [ ] **Step 1: Write the failing browser test** `rapid mode changes settle on the last request without leaks @hardware`:
  - Select `kaleidoPlane`, `city`, `godrays`, `particles` back-to-back with no waits, then wait 1 s.
  - Expect `#status[data-state=ready]`, no page errors, and `#viewport-errors` count 0.
  - Expect `await page.evaluate(() => window.__visualizerDebug.activeMode) === 'particles'`.
- [ ] **Step 2: Run** `npx playwright test --project=hardware-webgpu -g "rapid mode"`. Expected: FAIL, `__visualizerDebug` is undefined.
- [ ] **Step 3: Implement** the async `select` with a generation counter, matching the `epoch` pattern in `main.ts`. In `main.ts`, call `adaptive.reset` and `resetTiming` only when `select` resolves `true`. Expose `window.__visualizerDebug = { get activeMode() }` only when `import.meta.env.DEV` is true.
- [ ] **Step 4: Run** `npm run test:browser && npm run test:browser:hardware`. Expected: PASS on both tiers.
- [ ] **Step 5: Commit** `feat(rendering): compile selected mode before swapping it in`.

### Task 5: Benchmark harness and Stage 2 baseline

Run this task **before** Tasks 6–8 change any mode. Its JSON decides whether Tasks 6–8 are justified.

**Files:**
- Create: `tests/browser/benchmark.spec.ts`
- Modify: `playwright.config.ts` (project `benchmark`: headed Chrome, `grep: /@benchmark/`, timeout 15 min)
- Modify: `package.json` (`"bench": "playwright test --project=benchmark"`)
- Create: `benchmark-results/stage3-baseline.json`

**Interfaces:**
- Consumes: `VisualEngine.lastFrame` (Task 1), `?quality=` (Task 2), the `#scale` lock (Task 3) and `window.__visualizerDebug` (Task 4).
- Produces: a `window.__visualizerDebug.bench(seconds: number): Promise<BenchResult>` dev hook, where `BenchResult = { raf: FrameTimingStats; cpu: FrameTimingStats; gpu: FrameTimingStats | null; drawingBuffer: { width: number; height: number } }`.
- Produces: the report schema `{ schemaVersion: 2, label: string, settings: { backend, quality, scale: 1, fixture: 'synthetic bass', seconds }, modes: Record<ModeId, BenchResult> }`. It must not contain `userAgent` or `platform` fields.

- [ ] **Step 1: Write** `benchmark.spec.ts`:
  - For each of `vjRings, particles, boids, kaleidoPlane, city, starTunnel, bloomTunnel, godrays`, open `/modern.html?backend=webgpu&quality=balanced&mode=<id>`, check `#synthetic`, set `#scale` to `1`, and hide controls.
  - Wait 5 s for warmup, then run `bench(Number(process.env.BENCH_SECONDS ?? 60))`.
  - Write `benchmark-results/${process.env.BENCH_LABEL ?? 'run'}.json`.
  - Assert that no report string matches `/Macintosh|Windows NT|Linux x86|userAgent/`.
- [ ] **Step 2: Smoke run** `BENCH_SECONDS=3 BENCH_LABEL=smoke npm run bench`. Expected: PASS, and the JSON has all 8 modes. Delete `smoke.json` afterwards.
- [ ] **Step 3: Baseline run.** Run `git stash` if needed so mode code is exactly Stage 2 plus Tasks 1–4, then `BENCH_LABEL=stage3-baseline npm run bench` (about 9 minutes, run in the background). Expected: PASS.
- [ ] **Step 4: Record the gate decision** in the commit message. A GPU port task (6, 7 or 8) runs only if its mode's baseline `cpu.p95Ms > 0.5` **or** `raf.p95Ms > 18.33`. Otherwise mark that task "not justified by measurement" in this plan and skip it.
- [ ] **Step 5: Commit** `bench: stage 3 baseline for 8 representative modes` with `benchmark-results/stage3-baseline.json`.

### Task 6: City heights on the GPU (gated by Task 5)

**Files:**
- Modify: `src/modes/spatialModes.ts` (city branch)
- Modify: `src/modes/shared.ts` (spectrum texture helper)
- Test: `tests/unit/modeMotion.test.ts`

**Interfaces:**
- Produces: `createSpectrumTexture(bins = 512): { texture: THREE.DataTexture; update(spectrum: Uint8Array): void; dispose(): void }` in `shared.ts`. It returns an `R8`, `UnsignedByteType`, nearest-filtered `bins×1` texture. `update` copies the data and sets `needsUpdate`.
- City behavior:
  - Instance matrices are written **once** at creation.
  - Height is computed in `material.positionNode` from `instanceIndex`: `x = floor(i / 28)`, `z = i mod 28`, `bin = floor((x/28 * 0.6 + z/28 * 0.4) * 512)`, `h = 0.5 + e * 18 + bounce * 18`.
  - Scale `y` by `h`, offset by `h/2`, and use `1.05` for `xz`.
  - Use `MeshBasicNodeMaterial`.

- [ ] **Step 1: Write failing test** `city uploads the spectrum, not 784 matrices`: create city, record `instanceMatrix.version`, call `update` 3 times with a non-zero spectrum → `version` unchanged and the spectrum texture `version` increased by 3.
- [ ] **Step 2: Run** `npx vitest run tests/unit/modeMotion.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the vertex-node height and the helper. Keep the camera orbit, opacity and `colorize` exactly as they are.
- [ ] **Step 4: Run** `npm test`, then `npm run test:browser && npm run test:browser:hardware`. Expected: PASS on WebGPU **and** forced WebGL2 (Review Focus 5).
- [ ] **Step 5: Visual check.** Compare `silent-city.png` and a `?time=2&synthetic` capture against `benchmark-results/stage2-review/silent-city.png`. Building layout and heights should match; flag any difference for the user.
- [ ] **Step 6: Commit** `perf(city): drive building heights from a spectrum texture in the vertex node`.

### Task 7: Star Tunnel positions on the GPU (gated by Task 5)

**Files:**
- Modify: `src/modes/particleModes.ts` (`stars`)
- Test: `tests/unit/modeMotion.test.ts`

**Interfaces:**
- Independent of Task 6. Uses its own `RGBA32F` `DataTexture` of 40×1 holding `(ringZ, ringRotation, pulse, ringHue)` per ring, created and disposed inside `stars()`.
- Behavior:
  - The CPU keeps the 120 Hz fixed-step spring (`offsets`, `velocities`, 1760 floats) and the per-ring state. It uploads `offsets` as an `InstancedBufferAttribute` (1 float) plus the 40-ring texture.
  - The vertex node computes angle, radius and position, and the color node computes HSL. Both use the same formulas as the current CPU loop.
  - This removes the 10,560-float position and color upload.

- [ ] **Step 1: Write failing tests:**
  - `star tunnel uploads ring state and offsets only`: after `update`, the position attribute no longer exists, and the offsets attribute and ring texture `version`s each increase by 1 per update.
  - `star tunnel spring stays bounded and frame-rate independent`: run 2 s at 30 Hz and at 120 Hz with an onset at t = 0. Offsets stay in `[-18, 40]` and match within 1e-6, read through a debug getter `mode.debugOffsets()`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run test:browser && npm run test:browser:hardware`. Expected: PASS on both tiers.
- [ ] **Step 5: Visual check** against `stage2-review/silent-starTunnel.png` and `ghost-stage2-starTunnel.png`. Wrapping, radius and pulse should look the same.
- [ ] **Step 6: Commit** `perf(starTunnel): compute star positions and colors in TSL nodes`.

### Task 8: Boids uniform-grid neighbor search and preset-scaled count (gated by Task 5)

The GPU compute flock is deferred to Stage 4 ("richer GPU particle behavior").

**Files:**
- Modify: `src/simulations/flock.ts`
- Modify: `src/modes/particleModes.ts` (`flock` reads `budget.particleScale`)
- Test: `tests/unit/flock.test.ts` (new)

**Interfaces:**
- Produces: `new FlockSimulation(count = 220)` and `initializeFlock(count = 220)`.
  - Neighbor search uses a uniform grid with cell size 14 (the cohesion radius, √196) over the wrapped bounds x ∈ [-35, 35], y ∈ [-20, 20], z ∈ [-35, 35], checking the 27 neighboring cells.
  - Wrap-around neighbors are **not** counted, which matches current behavior.
- Boid count = `Math.round(220 * particleScale)`, giving 110 / 220 / 440 / 440.

- [ ] **Step 1: Write failing tests:**
  - `grid step matches brute-force step`: keep the current O(n²) `step` as a test-only `bruteForceStep` export. From seed 42, after 240 steps each, positions match within 1e-6.
  - `440 boids advance 1 s in under 8 ms of CPU on this machine`: soft assertion, logged rather than failed in CI.
- [ ] **Step 2: Run** `npx vitest run tests/unit/flock.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the grid with preallocated `Int32Array` cell heads and next links, with no per-step allocation.
- [ ] **Step 4: Run** `npm test && npm run test:browser:hardware`. Expected: PASS.
- [ ] **Step 5: Commit** `perf(boids): uniform-grid neighbor search; count scales with quality preset`.

### Task 9: Fix the remaining time-dependent motion

**Files:**
- Modify: `src/modes/spatialModes.ts` (bloom tunnel brightness)
- Test: `tests/unit/modeMotion.test.ts`

**Interfaces:** none new.

The legacy entry computes `L = 0.6 + 0.4*sin(i*0.3 + now*0.004 + highs*2)` with `now` in **milliseconds** (`script.js:965`), which is `time * 4` in seconds. The port uses `frame.time * 0.004` with time in seconds, so the shimmer runs 1000× slower.

- [ ] **Step 1: Write failing test** `bloom tunnel shimmer matches legacy rate`: ring 0's HSL lightness at `time = 0` vs `time = π/8` (with `highs = 0`) differs by about `0.4 * sin(π/2)`, i.e. lightness 0.6 vs 1.0 within 1e-6.
- [ ] **Step 2: Run** it. Expected: FAIL (the values are currently nearly equal).
- [ ] **Step 3: Change** `frame.time * 0.004` to `frame.time * 4`.
- [ ] **Step 4: Audit** the remaining per-frame increments in `src/modes/*.ts` with `grep -n "+= " src/modes`. Each must scale by `frame.delta` or derive from `frame.time`. Fix any that don't, each with its own 30 Hz vs 120 Hz equality test like the existing `bloom tunnel translates and rotates equally at 30 and 120 Hz`.
- [ ] **Step 5: Run** `npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `fix(bloomTunnel): restore legacy shimmer rate (ms→s conversion)`.

### Task 10: Selectable tone mapping and antialiasing, with reference review

**Files:**
- Modify: `src/rendering/OutputPipeline.ts`
- Modify: `src/rendering/VisualEngine.ts`, `src/main.ts`, `modern.html` (`#tone-mapping`, `#aa` selects; `?tone=` and `?aa=` params)
- Create: `tests/browser/reference.spec.ts` (`@reference`, hardware project)
- Create: `benchmark-results/stage3-review/index.html` (generated)

**Interfaces:**
- Produces: `createOutputPipeline(renderer, scene, camera, filter?, options: { aa: 'fxaa' | 'smaa' | 'none' })`. SMAA comes from `three/addons/tsl/display/SMAANode.js`, applied at the same place FXAA is now (display-referred, after `renderOutput`).
- Produces: `VisualEngine.setOutput({ toneMapping: 'aces' | 'agx', aa })`, mapping to `THREE.ACESFilmicToneMapping` / `THREE.AgXToneMapping`. The pipeline is rebuilt only when `aa` changes.
- Produces: an optional `ModeDefinition.bloom?: number` default strength. `main.ts` moves the `#bloom` slider to it on mode change; the slider still overrides it. When the field is absent, the strength stays at today's 0.6.
- Defaults stay ACES + FXAA + 0.6 bloom until the user picks otherwise in Step 4.

- [ ] **Step 1: Write** `reference.spec.ts`. For the 8 representative modes, open `?time=2&quality=balanced&mode=<id>`, check `#synthetic`, set `#scale` to `1`, then capture four combinations: ACES+FXAA, ACES+SMAA, AgX+FXAA, AgX+SMAA. Also capture `bloomTunnel` and `godrays` at bloom 0.3 / 0.6 / 1.0. The legacy entry ran bloom only for those modes, at 1.0+. Generate a review page that groups the captures by mode with labels, in the same style as `stage2-review/index.html`.
- [ ] **Step 2: Implement** the options and run `npx playwright test --project=hardware-webgpu -g @reference`. Expected: PASS, and the review page shows 32 images.
- [ ] **Step 3: Run** `npm run test:browser`. Expected: forced WebGL2 renders with SMAA and AgX without errors.
- [ ] **Step 4: USER REVIEW GATE.** Send the review page to the user and ask which tone mapping, AA and per-mode bloom become the defaults. Record the answers in the commit message and set those defaults. Exposure stays a user slider at 1.0.
- [ ] **Step 5: Commit** `feat(output): selectable AgX/ACES tone mapping, SMAA/FXAA and per-mode bloom, defaults per review`.

### Task 11: Log-frequency spectrum mapping, with reference review

**Files:**
- Modify: `src/audio/analysis.ts`
- Modify: `src/modes/spatialModes.ts` (city, bloomTunnel), `src/modes/lineModes.ts` (fftTunnel, star), `src/modes/shared.ts` (Task 6 texture lookup, if it ran)
- Test: `tests/unit/audio.test.ts`

**Interfaces:**
- Produces: `logBin(u: number, bins: number, sampleRate: number, minHz = 30, maxHz = 16000): number`. It maps `u ∈ [0, 1]` log-uniformly from `minHz` to `maxHz` and returns an integer bin in `[0, bins-1]`.
- Produces: `spectrumMapping: 'linear' | 'log'`, a URL param plus a select, defaulting to `'linear'` until review.

- [ ] **Step 1: Write failing tests:**
  - `logBin(0, 512, 48000) === floor(30 / 24000 * 512)`, which is 0.
  - `logBin(1, 512, 48000) === floor(16000 / 24000 * 512)`, which is 341.
  - It is monotonic non-decreasing over 100 samples of `u`.
  - Non-finite `sampleRate` gives 0.
- [ ] **Step 2: Run** `npx vitest run tests/unit/audio.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** it and route the four modes' bin lookups through a `binFor(u)` that respects `spectrumMapping`. If Task 6 moved City's lookup into a vertex node, add the same log formula there as a TSL expression, driven by a `uniform` mapping flag. Expose `AudioEngine.sampleRate` (silent frames use 48000).
- [ ] **Step 4: Capture** linear vs log for the same 4 modes, using `ghost.wav` at 96 s when the file exists locally (it is never committed) and the synthetic fixture otherwise. Add the captures to the Task 10 review page.
- [ ] **Step 5: USER REVIEW GATE.** The user picks the default mapping.
- [ ] **Step 6: Run** `npm test && npm run test:browser:hardware`, then **commit** `feat(audio): optional log-frequency spectrum mapping, default per review`.

### Task 12: Exit gate — after-measurements, comparison and merge

**Files:**
- Create: `benchmark-results/stage3-results.json`
- Create: `docs/stage3-results.md`
- Modify: `WEBGPU_MODERNIZATION_PLAN.md` (§8 Stage 3 status line only)

- [ ] **Step 1: Run** `BENCH_LABEL=stage3-results npm run bench` in the background. Expected: PASS.
- [ ] **Step 2: Write** `docs/stage3-results.md` with a table per mode: baseline vs results for rAF p95, CPU p95, GPU p95 (or "n/a") and missed frames at 60 Hz. Include the Balanced 1080p drawing-buffer size, which tasks ran or were skipped (Task 5 gate), the review decisions from Tasks 10–11, and any mode that misses the ≤ 18.33 ms p95 target, together with the preset it is assigned to instead (§9).
- [ ] **Step 3: Run** the full verification: `npm test && npm run build && npm run test:browser && npm run test:browser:hardware`. Expected: all PASS.
- [ ] **Step 4: Security check before pushing.** `git grep -n -i -E 'Macintosh|MacIntel|Mac OS X|userAgent|/Users/|gmail'` on the branch returns nothing.
- [ ] **Step 5: USER APPROVAL GATE.** Present the results doc. After approval, push the branch, merge it into `main`, tag `stage-3`, and push the tag.
