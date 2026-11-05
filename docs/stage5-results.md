# Stage 5 — stabilization and release

**Complete — November 5, 2026, on the named reference.** The modern visualizer is the default entry. Build, 272 unit tests, 24 browser checks, four production smoke checks, and both complete 30-minute physical-GPU sessions pass. No Stage 5 acceptance item remains open for this reference configuration.

## Default entry and release packaging

The user authorized Stage 5, including making the modern visualizer the default. `/` and `/index.html` now load the bundled modern application. Following the release cleanup, the alternate `/modern.html` entry and the original HTML, `script.js` and `style.css` have been removed. The root application uses bundled dependencies and local assets, with no runtime CDN. Both native WebGPU and the verified WebGL2 fallback remain available.

Favorites continue to use `data/user-settings.json` with the development/preview server. On a plain static host without `/api/settings`, validated favorites use browser storage. HTTP 500, failed saves, blocked storage and corrupt data remain errors; no failed save is presented as successful. Existing browser favorites import once into the chosen store. Picture and comfort preferences retain their existing versioned browser storage.

Run/build/recovery instructions and the measured quality matrix: [README](../README.md). No new dependency, browser download, checkout, or model was required.

## Stabilization fixes

- Spark Plume leaked two GPU storage attributes after switching away. A focused native regression reproduced **2 remaining, expected 0**. Its geometry now owns both attributes, its compute kernels are disposed, and kernels compile before activation. Repeated switches and a superseded prepared selection leave zero storage attributes.
- In pinned Three.js r186, disposing a renderer whose initialization failed calls `setAnimationLoop(null)` without awaiting it. That method re-enters the rejected initialization, producing unhandled rejections when both backends are unavailable. Failed candidates now release partially acquired backend resources directly; initialized renderers keep normal disposal. Repeated failed startup/retry produces no unhandled rejection.
- Renderer error callbacks preserve the r186 runtime error object's message despite its stale string-only type declaration. Asynchronous mode/quality completion is scoped to the current engine/startup generation, and startup cannot publish Ready after a validation failure.
- Cached figures now own their geometry. Golden Gate builds independent scene instances instead of mutating the cached glTF. The real Phoenix asset regression proves rebaking cannot corrupt another instance or the cache, and two passes through 18 model scenes pass on both backends. This closes a reproduced second-visit destroyed-buffer error in Golden Gate and Phoenix vertex-color corruption.
- Common scene disposal now releases object-owned renderer state, shadow lights, skeleton textures and TSL background meshes. The focused shadow/background loop previously grew about 50 MB per cycle and now stays exactly at 43,750,966 estimated bytes.
- Pinned r186 can allocate separate instanced/node attribute wrappers in compile, output, shadow and AA contexts, while geometry disposal tracks only its first render object. A renderer-local material-disposal hook releases every generated node attribute through the pinned attribute manager. A focused Golden Gate + Windfield + AA regression now returns to exactly 6,168 attribute bytes on every visit. This compatibility workaround must be rechecked when upgrading Three.js.
- WebGL2 prepares shaders through the complete offscreen output graph, avoiding a redundant scene-only asynchronous pass that could spend minutes polling large model scenes. Native WebGPU retains asynchronous scene precompilation.
- Soak-only Vite runs disable HMR and file watching, preventing filesystem-provider metadata events from reloading an otherwise healthy test session. Normal development keeps hot reload.
- Renderer restart and cached-page recovery preserve custom bloom instead of reapplying the scene’s authored default. The new two-backend regression checks both the full and compact sliders.
- Release canvas labels and status no longer describe a capability probe or Stage 4 experiment.

## Reference browser and hardware

Chrome **156.0.8078.80**, headless, on **Apple M2 Pro / Metal**. CDP reports `ANGLE Metal Renderer: Apple M2 Pro`, driver `27.0.1`, build `26A434`. Tests assert the actual initialized backend; physical-GPU sessions reject SwiftShader/llvmpipe/software renderer identities.

| Configuration | Result / scope |
| --- | --- |
| Chrome native WebGPU | Recovery matrix passes; 128 selectable modes; 30-minute soak passes |
| Chrome accelerated WebGL2 | Recovery matrix passes; 127 selectable modes; 30-minute soak passes |
| Chrome forced SwiftShader WebGL2 | Recovery/behavior passes; no physical-GPU performance claim |
| Native adapter denied or no WebGPU API | Automatic WebGL2 fallback and strict-native error/recovery pass |
| Both APIs unavailable | Actionable status, retry controls, and clean repeated startup failure pass |
| Production `dist/` on plain static HTTP | Root, player, favorites, comfort, resize/restart, removed legacy routes, and unavailable-backend smoke checks pass |

Spark Plume is the one intentionally WebGPU-only mode. Every original mode remains available through compatibility. Safari, Firefox, other GPUs, 120 Hz and physical-monitor presentation are unverified. This release certifies the named reference only. The [Stage 4 one-minute quality matrix](stage4-results.md) remains the performance evidence: Balanced 1080p/60; selected High 1440p/60 and Ultra 4K/30 configurations. The Stage 5 soak uses a lower fixed rendering scale to stress lifecycle repeatedly and is not a new quality benchmark.

## Verification

- `npm run build`: TypeScript and production bundle pass on installed Node **22.23.4**.
- `npm test -- --maxWorkers=2`: **272 tests pass in 29 files**.
- Final Stage 5 browser matrix: **24 pass**, with 21 cases skipped because they belong to a different backend/static/soak configuration.
- Final production static-host matrix: **4 pass**, 12 configuration-specific cases skipped.
- Existing regression run: **29 pass**, six configuration-specific skips; covers Stage 4 effects, snapshot orientation/display conversion, GPU flock correctness/disposal, player, favorites, native keyboard controls, narrow UI, system-audio behavior with mocked streams, and unsupported backends.
- Model repeat-visit matrix: **2 pass** (18 model scenes twice on each backend); [full release matrix](../benchmark-results/stage5/matrix-checks.json).
- Separate focused regressions reproduced and then verified both the Spark Plume leak and failed-initialization rejections.

The device-loss test destroys a real test WebGPU device and maps its intentional `destroyed` reason to the unexpected-loss path because Three.js deliberately ignores intentional destruction. WebGL2 uses `WEBGL_lose_context`. Both stop actual rendering and recover in compatibility while keeping the loaded file, playback, selected scene, quality, exposure and AA. Compile and submission failures recover, stale compilation cannot poison a restart, and visibility/cached-page event tests leave one renderer and clean overlays. Cached-page restoration is tested with synthetic lifecycle events; physical OS sleep/wake is outside this evidence.

Final visual review uses six fixed-time canvas captures per accelerated backend: Circle, Neon Swirl, God Rays, flock, VJ Rings and City. The review preserves layered particles, colored fog shafts, intentional cone fallback, recognizable scene geometry, and fullscreen composition. Captures stay in `test-results/stage5-matrix/`; they are task-scoped canvas images, not desktop screenshots. Existing real-Ghost visual/comfort review remains recorded in Stage 4.

## Long-session method and evidence

Two isolated physical-GPU browser sessions run concurrently for at least **1,800 actual wall-clock seconds each**, with no virtual-time acceleration. Each starts with two complete passes through its available registry, then repeatedly switches every original mode plus rotating newer mode families. Each cycle replaces a generated local audio file, seeks/plays it, resizes to 390 × 740 and back to 1280 × 720, and returns to Circle for comparable memory samples. Native session includes GPU flock, Spark Plume, feedback, shadow, DOM-overlay and model modes.

Assertions require geometries, textures, targets, storage attributes and estimated GPU bytes to plateau after warmup; one media graph/source; exactly one live audio object URL; no orphaned Win95 overlays; one canvas; and no duplicate render scheduling. Three.js has one internal bookkeeping rAF in addition to the application's single render rAF, so two pending callbacks are expected at a settled scene. WebGL shader compilation may transiently add a third polling callback. Rendering suspension is measured from actual render calls, not Three.js's independently advancing internal frame counter.

Both sessions finish with a renderer restart and non-cached page teardown. Teardown must revoke all object URLs, remove the canvas, and leave zero pending rAF callbacks. Renderer resource estimates are application instrumentation, not a measurement of total driver/GPU memory.

Raw reports (completion flags must be true):

- [Native WebGPU soak](../benchmark-results/stage5/webgpu-soak.json)
- [Accelerated WebGL2 soak](../benchmark-results/stage5/webgl2-soak.json)

Completed results:

| Backend | Actual duration | Complete cycles | Baseline geometries / textures / targets | Storage attributes | Attribute bytes | Estimated resource bytes |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| Native WebGPU | 30.017 min | 89 | 2 / 41 / 14 | 0 | 6,168 | 134,692,212–134,692,234 |
| Accelerated WebGL2 | 30.414 min | 44 | 2 / 39 / 13 | 0 | 6,168 | 131,942,552–131,942,571 |

Geometry, texture, target, storage and attribute counts remain identical throughout all recorded cycles. Tiny total-byte differences come from estimated shader-code lengths, not additional buffers or targets. Every cycle owns one audio context/source and one live audio URL. Final teardown leaves **zero pending rAF callbacks** and revokes **109/109 URLs on native, 64/64 on WebGL2** (audio replacements plus embedded model-texture URLs). Both completion flags are true; both error lists are empty.

The steady rendering, timing, audio and GPU-cleanup code is identical between the completed soaks and the final release. The final bloom-restart control correction was additionally verified on both backends and in the full release suite. [Soak source hashes](../benchmark-results/stage5/soak-source-hashes.json) and [final source hashes](../benchmark-results/stage5/source-hashes.json) preserve that distinction.

Existing non-failing Vite configuration-import and large-bundle warnings remain. Some existing model/CRT paths warn about already non-indexed geometry; no page error or unexpected console error occurred in either completed soak.

Final machine-readable checks: [browser matrix](../benchmark-results/stage5/matrix-checks.json), [production smoke](../benchmark-results/stage5/static-checks.json), [soak runner](../benchmark-results/stage5/soak-checks.json). Disposable execution logs and review PNGs remain in `test-results/`.

## Publication cleanup

The user requested removal of the legacy implementation and alternate entry after Stage 5 acceptance. The root is the only HTML entry; browser test navigation now targets `/`. The existing WebGL2 fallback is retained because the full recovery matrix and physical-GPU soak passed. No renderer, audio, or animation behavior changed in this cleanup. The reports and source hashes above describe the original acceptance runs; cleanup verification is recorded separately. The GitHub README is maintained by the user and is excluded from this release commit.

Cleanup verification uses Node 22.23.4 and the same Chrome/M2 Pro reference: production build passes, **269 tracked unit tests pass**, and the full release matrix passes **24 checks**. Three additional local Ogre unit tests also pass but are excluded from publication with that separate work. To verify the published source without altering working files, a disposable Vite overlay reads the staged Ogre source/model directly from Git in memory. Its production build passes; model revisits on both backends and the shadow-resource plateau are checked against that source. Production smoke checks require native WebGPU at the root and exercise WebGL2 recovery/playback as well.

Final cleanup results: **5 staged-source browser checks pass** (one backend-specific skip), and **4 production checks pass**, including actual native WebGPU at `/`, absent legacy/alternate routes, static favorites and WebGL2 playback/recovery. [Full cleanup matrix](../benchmark-results/stage5/cleanup-matrix-checks.json), [staged-source model/resource checks](../benchmark-results/stage5/cleanup-staged-source-checks.json), and [final production checks](../benchmark-results/stage5/cleanup-static-checks.json) retain the results with portable paths.

## Main consolidation — November 5, 2026

The subsequent consolidation publishes the rebuilt Swamp Ogre model/performance, its authoring script, the optional repository security scanner/tests, and previously local curated references. All 54 local/remote branch refs and all three existing worktree commits were already included in main; the worktrees had no unpublished tracked edits. Original deliveries, ZIPs, extracted frames and duplicate exports stay local and ignored.

The consolidated app passes the build, **272 unit tests**, **15 security-tool tests**, **4 dedicated Ogre browser checks**, **24 release browser checks** and **4 production checks**. The Ogre checks cover native WebGPU and software WebGL2, visible mouth-aligned laser pixels, distinct beat actions, skinning/foot placement, comfort settings and reopening the scene. The browser runner now isolates its output to preserve other verification artifacts. See [Ogre review and provenance](references/swamp-ogre/README.md) and the compact [consolidation record](../benchmark-results/main-consolidation.json). The original 30-minute reports above retain their recorded source scope; this follow-up does not claim a new soak run.
