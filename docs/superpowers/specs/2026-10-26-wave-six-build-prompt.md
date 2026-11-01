# Build wave 6 visualization modes (code-only)

You are building new audio-reactive visualization modes in the desktop music visualizer at `/Users/sabarnoislam/Desktop/visualizer` (Three.js 0.186, WebGPU first with a WebGL2 fallback, TSL node materials, Vite, Vitest, Playwright). The private GitHub repo is `sabcodes/desktop-music-visualizer`.

## What to build

The spec is `docs/superpowers/specs/2026-10-26-wave-six-modes-design.md` (on branch `docs/wave-six-specs`). Read the whole spec first, including the shared rules, the working assumptions and the "Batch 2 decisions" section: those decisions override anything earlier in a section.

Build these **14 modes**, every one in code with no supplied models or images:

| # | Id | Label |
|---|----|-------|
| 1 | `nightParlour` | Night Parlour |
| 2 | `slotHall` | Slot Hall |
| 3 | `windowGrid` | Window Grid |
| 4 | `cloudTracer` | Cloud Tracer |
| 5 | `glowTide` | Glow Tide |
| 6 | `eyeStage` | Eye Stage |
| 8 | `toonBlaze` | Toon Blaze |
| 9 | `neonOverlook` | Neon Overlook |
| 10 | `lidarTrail` | LIDAR Trail |
| 11 | `glyphBloom` | Glyph Bloom |
| 12 | `scanSprout` | Scan Sprout |
| 14 | `heatShoal` | Heat Shoal |
| 15 | `glassHands` | Glass Hands |
| 16 | `fogTowers` | Fog Towers |

**Do not build** #7 Night Rider (it waits on 3D/2D assets the user is supplying) or #13 Blob Track (it uses the 2D photos in `src/assets/blob-track/`; it is a separate task). Wherever the asset list (`2026-10-26-wave-six-asset-list.txt`) marks something OPTIONAL, build it in code: do not ask for or download assets.

## Setup and git

- Create the branch `feat/new-modes-wave-6` from `origin/docs/wave-six-specs`, so the spec comes with it.
- Other Claude sessions may be editing this same checkout. Stage files **by explicit path only** (never `git add -A` or `git add .`). Never commit `visualizer-capabilities*.json`, `*.wav`, or the untracked folders already in the tree (`Model assets/`, `benchmark-results/`, `docs/superpowers/specs/reference/`, and so on).
- Commit after each mode (or a small group of modes) once that mode's unit tests and `npm run build` pass, then push. Use Conventional Commits, e.g. `feat(wave-6): Window Grid`, and end every commit message with:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- Do **not** merge to `main`. The user reviews the modes first.

## How this codebase does modes (follow it)

Study a few existing wave 5 modes before writing any code: `src/modes/registry.ts` (the `waveFive` / `waveFiveGpu` helpers and `waveFiveModeDefinitions`), `src/modes/types.ts`, `src/modes/shared.ts`, `src/modes/hitPulse.ts`, `src/modes/cinematic.ts`, plus `relicGlowMode.ts`, `neonCityMode.ts`, `retroModes.ts` (the ASCII mode), `handModel.ts` and the storm mode. Match their style: naming, comment density, uniform/`approach` patterns, seeded randomness (`seededRandom`), quality budgets (`presetBudget`, `QualityBudget`) and disposal (`disposeScene`).

- Register the modes in a new `waveSixModeDefinitions` list using a `waveSix` helper that labels them `<experimental-wave6> Name`, appended to `modeDefinitions` after wave 5. Use a GPU-only variant (like `waveFiveGpu`) only if a mode really needs WebGPU compute, and say why in a comment.
- Add `tests/unit/waveSixModes.test.ts` modelled on `tests/unit/waveFiveModes.test.ts` (ids, order, labels and backends). Extend any existing tests that count modes.
- Reuse existing code as the spec says: Neon Megacity's towers and signs for Neon Overlook (and the city in Toon Blaze), the storm's cloud volume for Cloud Tracer, the ASCII/halftone glyph pass for Glyph Bloom, `handModel.ts` for Glass Hands, Relic Glow's pixel pass for Slot Hall, and the Moon Pond / Audio Ocean height field for Glow Tide. LIDAR Trail and Scan Sprout share one point-cloud engine: write it once.

## Rules the user cares about (from earlier review rounds)

- **Realism bar:** the modes must look close to the references, "not cartoony or blocky or low polygon". The exceptions are deliberate styles in the spec: Slot Hall's retro PS1 look and Toon Blaze's cel shading. Use dark PBR lighting, fog and the shared `cinematic.ts` finish.
- **Motion comes from the music:** drive motion from `frame.response.*` (scaled by sensitivity) and `hits.level`. `hits.flash` only drives brightness. The user rejects "just breathing" motion and sliders that do nothing.
- **Flash safety:** respect `reducedFlash` (the user leaves it on): at most 3 flashes/s, each jump cut to ~40%, and a raised dark floor.
- **No repeats:** hit-driven variant tables never pick the same variant twice in a row (seeded).
- **Silence:** each mode has a calm idle state; it is never black and never frozen mid-flash.
- **Budgets:** declare instance/particle counts per quality tier; the lowest tier halves them.
- **GPU safety (from wave 5):** raymarched SDFs can stall Metal and lose the device. Use an outline prepass, shade only where needed, pin values with `.toVar()`, and render heavy passes offscreen at low resolution. Keep light backgrounds below ~1.0 linear because of the global bloom.
- Every new `THREE.Sprite` must clone its geometry (the default one is shared and disposing a mode destroys it).

## Reference media (look before you build each mode)

Pull frames with ffmpeg at 4–8 fps and crop to the subject; contact sheets alone misled earlier attempts. Put working files in a scratch folder outside the repo, not in the repo. Batch 2 clips have audio: you can measure tempo and hit times from it.

All files are in `/Users/sabarnoislam/.claude/uploads/11dbe423-83b1-4d3e-bb1f-50bfda679a77/`:

- #1 Night Parlour: `a6c79b89-image.jpg` (daylight still; the mode is at **night**)
- #2 Slot Hall: `e94d9831-image.jpg`
- #3 Window Grid: `77be12da-ScreenRecording_10-24-2026_16-09-40_1.mov`
- #4 Cloud Tracer: `8cb770fb-ScreenRecording_10-26-2026_12-40-18_1.mp4` (ignore everything after ~8 s)
- #5 Glow Tide: `e242e2df-ScreenRecording_10-26-2026_12-42-18_1.mp4`
- #6 Eye Stage: `1a1d44ba-ScreenRecording_10-26-2026_12-42-47_1.mov` (projected onto a ceiling; ours faces the viewer straight on)
- #8 Toon Blaze: `41968c53-ScreenRecording_10-26-2026_12-51-37_1.mp4`
- #9 Neon Overlook: `1f98e7ce-ScreenRecording_10-26-2026_12-54-48_1.mp4`
- #10 LIDAR Trail: `9f61c579-ScreenRecording_10-26-2026_13-13-27_1.mp4`
- #11 Glyph Bloom: `61095417-ScreenRecording_10-26-2026_13-13-57_1.mp4`
- #12 Scan Sprout: `b915f443-ScreenRecording_10-26-2026_13-15-06_1.mp4`
- #14 Heat Shoal: `da488715-ScreenRecording_10-26-2026_13-16-17_1.mov`
- #15 Glass Hands: `99806b71-ScreenRecording_10-26-2026_13-38-40_1.mp4`
- #16 Fog Towers: `0a1da1a9-ScreenRecording_10-26-2026_12-54-00_1.mov`

The two stills (#1, #2) and all clips are style references only: build original scenes in their spirit, never copies of the film, game or artist.

## Verifying

- After each mode: `npm test` and `npm run build` must pass.
- Look at every mode running in a real browser before calling it done. Use headed Playwright (the Playwright MCP tools are available, so screenshot with them). The in-app browser pane pauses `requestAnimationFrame` when hidden, so a still frame there proves nothing. Play the 130 BPM kick/snare fixture the spec mentions (create it in the test fixtures if it doesn't exist) and compare screenshots to the reference frames at similar moments. Check both WebGPU and WebGL2 unless the mode is GPU-only.
- **Do not** keep rerunning the long WebGL2 parity test (`tests/browser/parity.spec.ts`, ~7 min). Run it once, at the end. Edits by other sessions reload the Vite dev server and can break a run, so before trusting a parity failure, check `git status` and file times for edits made during the run.

## Order and reporting

Work from simplest to hardest so finished modes land early: Window Grid, Cloud Tracer, Neon Overlook, Fog Towers, Glyph Bloom, LIDAR Trail, Scan Sprout, Heat Shoal, Slot Hall, Toon Blaze, Glass Hands, Glow Tide, Eye Stage, Night Parlour.

If a spec item can't be done well (performance, a WebGL2 limitation), do the closest good version, note the deviation in `docs/backlog.md` under a "Wave 6" heading, and keep going. Stop and ask only for a real product decision.

When you finish, report: each mode's status (done, or done with deviations), the commits, the final test, build and parity results, screenshots of each mode, and anything left for the user to review.
