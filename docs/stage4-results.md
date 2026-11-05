# Stage 4 — advanced visuals and polished controls

**Complete — November 5, 2026.** Build, 271 unit tests, 26 focused browser checks, the real-music/resource soak, and all 17 one-minute performance configurations pass on the named reference below. The original three open items (GPU flocking, misleading volumetric timing, and visual/performance acceptance) are closed for this reference configuration.

## Available in the modern entry

- **God Rays:** single-scattering fog integrated along camera rays through a bounded volume. Three coloured shafts drift through a density field. Stable sampling jitter and feathered boundaries reduce marching bands. This treatment is unshadowed; it does not claim occlusion or multiple scattering.
- **Neon Swirl:** GPU vertex motion adds curled layers, vertical movement, depth colour, and size variation. Seed attributes remain resident; per-frame updates change uniforms. Counts remain 4,000 / 8,000 / 16,000 / 16,000 across Compatibility / Balanced / High / Ultra.
- **GPU flocking:** Native WebGPU uses 1,024 / 2,048 / 4,096 agents at Balanced / High / Ultra, with 32 / 48 / 64 sampled candidates per agent. Position and velocity are double-buffered at 120 Hz; every dispatch reads immutable previous state. Rotating, stratified samples bound cost to O(agents × sample cap). This is approximate neighbor sampling, not an exact spatial-neighbor search. WebGL2 and the Compatibility preset retain the bounded CPU implementation (110 / 220 / 440 / 440 agents).
- **Transitions:** Cut, 0.35s fade, or 0.7s fade. A frozen outgoing image fades over one live incoming scene. Two RGBA8 targets are capped at 1920 × 1080 each (about 16 MiB together); no pixel readback or simultaneous live scene simulations. Rapid switches reuse these targets and stale queued requests allocate no modes. Only one candidate loads/compiles at a time.
- **Controls:** scene search, filtered previous/next navigation, scene details, collapsible settings, numeric slider values, scrollable narrow-window layout, and validated, versioned browser preferences. Explicit output/quality URL parameters take precedence over saved preferences. Audio, favourites, shortcuts, and the compact toolbar remain available.
- **Comfort:** OS reduced-motion preference is respected, including changes while running. Reduced motion disables crossfades and freezes the new effects' animation/geometry response. Reduced flash holds new-effect brightness steady while normal motion can still react to audio.
- **Preparation:** Simulation kernels compile before activation, and an offscreen render warms the complete output graph (including bloom and AA) before the outgoing frame is captured. The fade clock begins after the incoming frame submits, preserving its full duration through first-use work. The transient warmup output is 1 × 1; scene/effect intermediates use the selected budget.

## Effect budgets

| Preset | Native WebGPU God Rays | Scene resolution scale |
| --- | --- | --- |
| Compatibility | Original stylized additive cones | 100% |
| Balanced | 24 raymarch samples | 50% per dimension |
| High | 40 raymarch samples | 65% per dimension |
| Ultra | 64 raymarch samples | 75% per dimension |

WebGL2 always uses the original stylized cones. Bloom, display conversion, and antialiasing continue in the output pipeline. Lower-resolution scattering is upsampled there. The native implementation uses the pinned Three.js r186 [RaymarchingBox example](https://github.com/mrdoob/three.js/blob/r186/examples/webgpu_volume_cloud.html) and the installed helper's API.

## Validation

- Production build and TypeScript checking.
- Full unit suite, including scattering fallback selection, preset/sample bounds, 1080p snapshot bounds, and framebuffer restoration after failed capture.
- Headless installed Chrome with an initialized native WebGPU backend, plus forced WebGL2: effect startup, all four volumetric quality tiers, AA changes, rapid switches, fade completion, reduced-motion cuts, DOM-mode cuts, and renderer restart.
- Pixel comparison of the same fixed-time scene during a fade checks snapshot orientation and prevents a second display transform.
- Search/navigation, 390px layout, slider values, preference reload/validation, explicit URL overrides, existing favourites/player controls, unsupported-backend messaging, and existing compile-race regressions.
- Review screenshots and short timing samples are generated under `test-results/`. The timing check uses Balanced at a verified 1920 × 1080, synthetic input, five seconds warmup, and eight seconds measurement per advanced effect. It is a smoke check, not the plan's one-minute reference-display benchmark.

Production build and all 271 unit tests pass. The final focused browser run passes 26 checks; nine project-specific/long-benchmark cases are intentionally skipped in that run. The separate opt-in one-minute matrix passes all 17 configurations. Coverage includes native-only GPU tests, forced software compatibility, accelerated compatibility, favourites, native keyboard behavior, compile races, and unsupported-backend recovery. Existing Vite warnings about extensionless configuration imports and bundle size, and Three.js warnings in unrelated model tests, remain non-failing.

Short native timing results, November 4:

| Mode | Samples | rAF p95 | CPU submit p95 | Reported GPU median |
| --- | --- | --- | --- | --- |
| Neon Swirl | 481 | 16.8 ms | 1.9 ms | 2.81 ms |
| God Rays | 481 | 16.8 ms | 0.8 ms | 28.76 ms |

These are the original smoke measurements, preserved for diagnosis. They used summed pass timestamps and are not comparable to the completion metric below.

## Timing diagnosis and correction

The original issue reproduced on the installed Chrome/Apple M2 Pro: God Rays reported 22–60 ms summed timestamp spans despite 16.7 ms callback cadence. Individual pass timestamps were unusually similar across many separate bloom passes. Independent `GPUQueue.onSubmittedWorkDone()` probes of the same configuration completed in approximately 3–6 ms. The evidence indicates overlapping/backend-dependent pass spans; summing them does not measure elapsed frame time.

Diagnostics and adaptive scaling now use the interval from CPU submission start to GPU queue completion, sampled at most twice per second. This is explicitly an **upper bound including CPU submission, queue backlog, and callback overhead**, not isolated GPU execution time. It covers compute as well as rendering. The old timestamp sum remains separately labelled in exported diagnostics. Adaptive scaling does not add CPU time a second time. Samples have sequence IDs, so equal successive measurements are still counted, and results from an obsolete mode selection are discarded.

The [WebGPU queue specification](https://gpuweb.github.io/gpuweb/#dom-gpuqueue-onsubmittedworkdone) defines the completion fence used here. The pinned Three.js timestamp implementation groups and sums pass durations (`node_modules/three/src/renderers/webgpu/utils/WebGPUTimestampQueryPool.js`); the application does not modify that dependency. A regression injects implausibly large timestamp sums and confirms they cannot become the completion metric.

Run:

```sh
npm run dev
# Open http://127.0.0.1:5173/modern.html
npm run build
npm test
npx playwright test stage4.spec.ts --project=compatibility --project=stage4-webgpu
```

## Final acceptance method

- Local `ghost.wav` playback, seeking, normal/reduced-flash/reduced-motion settings, all four presets, and both backends. Review captures stay in `test-results/`; audio is never copied into the build.
- Twelve complete switching cycles through volumetrics, GPU flock, particles, and a baseline scene, plus resize and renderer restart. Storage attributes, textures, render targets, geometries, and estimated GPU bytes must plateau after warmup.
- Independent CPU calculation of one sampled-neighbor steering step, compared to a native GPU readback in the test only; reduced motion dispatches no further simulation steps; disposal releases storage buffers.
- Seventeen configurations, each with five seconds warmup and sixty seconds measurement: eight representative modes at native Balanced 1920 × 1080 / 60 Hz; the three advanced modes at High 2560 × 1440 / 60 Hz and Ultra 3840 × 2160 / 30 Hz; those three at accelerated WebGL2 Balanced 1920 × 1080 / 60 Hz. Resolution is locked and drawing-buffer dimensions are asserted. Acceptance requires p95 frame interval ≤ 1.1 × the target period, fewer than 5% missed intervals, and native p95 submission-to-completion ≤ the target period.

```sh
STAGE4_ACCEPTANCE=1 npx playwright test stage4.spec.ts stage4Acceptance.spec.ts --project=stage4-webgpu
```

The reference is installed headless Chrome on this Mac's Apple M2 Pro. These tests establish physical-GPU rendering and browser callback cadence; they do not certify monitor presentation timing, other GPUs/browsers, or 120 Hz. Experimental fluid simulation remains optional and outside the Stage 4 requirements.

## One-minute acceptance results — November 5, 2026

Chrome **156.0.8078.80**, Apple M2 Pro (Metal). ACES + FXAA; render scale locked at 1; reduced flash enabled; synthetic bass; five-second warmup and sixty-second measurement per row. Native GPU completion includes compute. WebGL2 completion is unavailable and reported as such. All 17 configurations meet their assigned cadence and completion budgets; the measured dimensions match the table. Only one missed interval occurred across the entire matrix (Bloom Tunnel, less than 0.03% of its run).

| Backend / tier / buffer | Mode | rAF p95 | CPU submit p95 | Completion p95 |
| --- | --- | ---: | ---: | ---: |
| WebGPU Balanced / 1920 × 1080 / 60 Hz | VJ Rings | 16.7 ms | 1.8 ms | 7.1 ms |
| WebGPU Balanced / 1920 × 1080 / 60 Hz | Neon Swirl | 16.8 ms | 1.9 ms | 6.8 ms |
| WebGPU Balanced / 1920 × 1080 / 60 Hz | GPU flock | 16.8 ms | 2.1 ms | 6.0 ms |
| WebGPU Balanced / 1920 × 1080 / 60 Hz | Kaleidoscope Plane | 16.7 ms | 1.9 ms | 5.6 ms |
| WebGPU Balanced / 1920 × 1080 / 60 Hz | City | 16.7 ms | 2.0 ms | 5.6 ms |
| WebGPU Balanced / 1920 × 1080 / 60 Hz | Star Tunnel | 16.7 ms | 2.1 ms | 5.8 ms |
| WebGPU Balanced / 1920 × 1080 / 60 Hz | Bloom Tunnel | 16.7 ms | 2.5 ms | 6.1 ms |
| WebGPU Balanced / 1920 × 1080 / 60 Hz | God Rays | 16.7 ms | 2.1 ms | 7.1 ms |
| WebGPU High / 2560 × 1440 / 60 Hz | Neon Swirl | 16.7 ms | 2.1 ms | 7.2 ms |
| WebGPU High / 2560 × 1440 / 60 Hz | GPU flock | 16.7 ms | 2.4 ms | 6.3 ms |
| WebGPU High / 2560 × 1440 / 60 Hz | God Rays | 16.7 ms | 2.2 ms | 14.9 ms |
| WebGPU Ultra / 3840 × 2160 / 30 Hz budget | Neon Swirl | 16.7 ms | 2.2 ms | 7.8 ms |
| WebGPU Ultra / 3840 × 2160 / 30 Hz budget | GPU flock | 16.8 ms | 2.6 ms | 8.0 ms |
| WebGPU Ultra / 3840 × 2160 / 30 Hz budget | God Rays | 16.8 ms | 0.6 ms | 17.4 ms |
| WebGL2 Balanced / 1920 × 1080 / 60 Hz | Neon Swirl | 16.7 ms | 1.9 ms | n/a |
| WebGL2 Balanced / 1920 × 1080 / 60 Hz | CPU flock | 16.7 ms | 3.4 ms | n/a |
| WebGL2 Balanced / 1920 × 1080 / 60 Hz | Stylized God Rays | 16.7 ms | 2.4 ms | n/a |

The target control selects the budget used by diagnostics/adaptation; it does not cap callback frequency. The 4K rows use a 30 Hz acceptance budget, and should not be interpreted as a certified 4K/60 tier. High God Rays has the least headroom at 60 Hz; Auto scale remains appropriate for slower hardware.

Raw measurements, p50/p95/p99, interval counts, resource estimates, GPU identity and browser version: [`benchmark-results/stage4/acceptance.json`](../benchmark-results/stage4/acceptance.json).

## Visual and lifecycle review

Local Ghost playback was sought to 96 seconds and kept playing through all four presets, both backends, and normal/reduced-flash/reduced-motion captures. Reviewed composition: layered cyan/green swirl particles, dense magenta/violet flock clusters and beat bursts, and cyan/gold/violet scattering through visible fog wisps. The stylized cone fallback remains distinct and intentional. Narrow controls, scene filtering, numeric values, saved preferences, snapshots' orientation/display color, and native keyboard behavior are covered by focused browser checks.

Twelve full cycles (48 switches) through the Stage 4 modes and a baseline scene, with resize and restart, show no growth after warmup: **3 geometries, 16 render targets, 19 textures, zero remaining flock storage buffers, 43,667,460 estimated GPU bytes** at the final baseline scene. These are renderer estimates, not a measurement of total driver memory. [Raw soak results](../benchmark-results/stage4/resource-soak.json).

Prewarming does not run an inactive mode's simulation hooks: those hooks can own shared shadow settings. A regression reproduced the shadow-state failure before the fix and now passes across shadow, feedback, and compute mode families. A superseded prepared GPU flock also releases its storage before the next selection becomes active.

Saved review captures (local canvas output; approximately 1.8 MB together with the reports):

| Effect | Native WebGPU | WebGL2 compatibility |
| --- | --- | --- |
| Neon Swirl | [Capture](../benchmark-results/stage4/review/webgpu-particles.png) | [Capture](../benchmark-results/stage4/review/webgl2-particles.png) |
| Flock | [Capture](../benchmark-results/stage4/review/webgpu-boids.png) | [Capture](../benchmark-results/stage4/review/webgl2-boids.png) |
| God Rays | [Capture](../benchmark-results/stage4/review/webgpu-godrays.png) | [Capture](../benchmark-results/stage4/review/webgl2-godrays.png) |

No Stage 4 implementation or reference-acceptance items remain open. Additional hardware/browser certification and subjective review on a physical display can extend coverage; they are not implied by the headless reference results. The default-entry rollout remains Stage 5.

No new runtime packages, model downloads, alternate checkout, or changes to the legacy entry were needed. Work stays in this project; the existing production output is rebuilt under `dist/`.
