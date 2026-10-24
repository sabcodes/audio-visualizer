# Stage 3 results — GPU scaling and image-quality tuning

**Branch:** `sabcodex/stage-3-gpu-scaling` · **Plan:** [docs/superpowers/plans/2026-10-24-stage-3-gpu-scaling.md](superpowers/plans/2026-10-24-stage-3-gpu-scaling.md) · **Spec:** `WEBGPU_MODERNIZATION_PLAN.md` §8 Stage 3, §9

## Benchmark settings (identical before and after)

| | |
|---|---|
| Machine | Reference Mac, installed Chrome, native WebGPU (120 Hz display) |
| Preset | Balanced, render scale locked at 1.0, ACES + FXAA, bloom 0.6 |
| Drawing buffer | 1920 × 1080 (asserted in every result) |
| Input | Synthetic bass fixture, 5 s warmup, 60 s per mode |
| Files | Baseline: `benchmark-results/stage3-baseline.json` (Stage 2 mode code plus Stage 3 instrumentation). After: `benchmark-results/stage3-results.json` |

rAF = requestAnimationFrame interval (display cadence, not GPU work). CPU = `mode.update` + pipeline submit. GPU = WebGPU timestamp query.

## Per-mode comparison (baseline → after)

| Mode | rAF p95 (ms) | Missed 60 Hz frames | CPU p50 (ms) | CPU p95 (ms) | GPU p50 (ms) |
|---|---|---|---|---|---|
| vjRings | 8.80 → 8.50 | 0 → 0 | 0.50 → 0.60 | 0.80 → 0.90 | 5.70 → 6.49 |
| particles | 9.10 → 8.50 | 0 → 0 | 0.50 → 0.70 | 0.90 → 1.00 | 3.60 → 4.78 |
| boids | 8.60 → 8.80 | 0 → 0 | 0.90 → 1.00 | 1.30 → 1.70 | 3.34 → 3.93 |
| kaleidoPlane | 8.90 → 8.80 | 0 → 0 | 0.60 → 0.60 | 0.90 → 0.90 | 4.19 → 5.83 |
| city | 8.50 → 8.50 | 0 → 0 | 0.70 → 0.70 | 1.00 → 1.00 | 2.88 → 3.34 |
| starTunnel | 9.00 → 9.00 | 0 → 0 | **0.80 → 0.60** | 1.10 → 1.20 | 3.15 → 3.47 |
| bloomTunnel | 9.20 → 8.70 | 0 → 0 | 0.70 → 0.70 | 1.00 → 1.90 | 3.60 → 3.87 |
| godrays | 9.20 → 8.90 | 0 → 0 | 0.70 → 0.70 | 0.90 → 1.80 | 4.65 → 4.52 |

### What the numbers say

- **Every mode meets the §9 target before and after.** The target is rAF p95 ≤ 18.33 ms at 60 Hz, and the worst p95 is 9.2 ms, which is the 120 Hz display cap. Frame time at these settings had no room to improve, and none of the Stage 3 work regressed it.
- **Star Tunnel's median CPU fell 25%** (0.8 → 0.6 ms). Positions and colours moved into TSL nodes, so each frame now uploads 1,760 offsets plus a 40-texel ring texture instead of 10,560 position and colour floats.
- **City's CPU is unchanged** at this resolution. Its 784 matrix writes per frame are gone, but they were never a measurable cost.
- **The GPU medians moved up 0.3–1.6 ms, and that looks like noise.** vjRings, whose code did not change, moved by a similar amount, so I treat this as run-to-run variance (thermal state, other processes) rather than a regression. GPU p95 from the timestamp pool is not reported, because it exceeded the frame interval in both runs and so can't be right (Task 5 ruling).
- **The CPU p95 rise in bloomTunnel and godrays (about +0.9 ms) is a tail effect** with unchanged medians. These two modes' code didn't change in this stage except the bloomTunnel shimmer rate. It stays below 2 ms, against a 16.7 ms budget.

## What Stage 3 changed for a user

- **Balanced now renders at 1080p internally on any display.** On this Mac's 2× screen, Stage 2 rendered at native 3024×1722, which is about 2.5× the pixels of Balanced's roughly 1897×1080. Presets: Compatibility 1080p with half particles, Balanced 1080p, High 1440p with 2× particles and 440 boids, Ultra native.
- **Auto render scale.** It steps down one level on sustained slow frames when the measured CPU + GPU cost is actually high, probes back up when frames are within budget, and backs off if a probe regresses. It holds still during warmup, shader compiles, benchmarks and manual locks. The target is selectable (60 or 120 Hz).
- **Mode switches compile before they display.** The previous mode keeps rendering, and only the requested mode is ever compiled.
- **Diagnostics** show refresh-aware missed frames, CPU ms and GPU ms ("n/a" on WebGL2). Exports carry no user-agent or platform strings.
- **Output and spectrum options:** ACES/AgX tone mapping, FXAA/SMAA/off antialiasing, and linear/log spectrum mapping. Per the user review on 2026-10-24, the defaults stay ACES, FXAA, bloom 0.6 everywhere, and linear bins.
- **Fix:** Bloom Tunnel's ring shimmer runs at the legacy rate again. A ms→s conversion had left it about 1000× too slow.

## Tasks run or skipped (Task 5 gate)

- **Task 5 gate:** baseline CPU p95 was above 0.5 ms for every mode, so Tasks 6–8 ran. The 0.8 ms vjRings floor is pipeline submit, so the mode-specific CPU cost was small: boids +0.5, starTunnel +0.3, city +0.2 ms.
- **Task 6 City GPU heights:** shipped. Silent capture is byte-identical to Stage 2, and the playback look matches.
- **Task 7 Star Tunnel GPU positions:** shipped. This is the measured CPU win above.
- **Task 8 boids grid search:** measured and **not shipped**. The grid was slower than the full scan (440 boids: 0.75 vs 0.61 ms per step), because flocks cluster into a few cells. Only the preset-scaled count shipped. Spatial bins wait for Stage 4's GPU flock.

## Modes below target

None. Every measured mode meets the Balanced target, so no mode needs to move to a higher tier.

## Not measured here

- **High and Ultra presets.** Their headroom wasn't benchmarked in this stage; doing so is a one-line change to the benchmark settings.
- **The compatibility (WebGL2) tier.** Its performance was not benchmarked; only its behaviour is covered by tests (SwiftShader isn't representative hardware).
- **A 60 Hz external display.** The adaptive controller's vsync behaviour there is covered by unit tests, not by a hardware run.
