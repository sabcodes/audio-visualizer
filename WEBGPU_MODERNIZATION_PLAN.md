# Desktop Music Visualizer — WebGPU Modernization Plan

**Prepared:** October 24, 2026  
**Project:** `Desktop/visualizer/`  
**Status:** Proposed implementation plan; application code has not been changed.  
**Goal:** Preserve all 18 existing visual modes while building a modern, GPU-driven browser visualizer with measurably better image quality, scalability, and usability.

## 1. Recommendation and scope

Modernize this browser application in place. Do not replace it with the separate Python visualizer or create another project checkout.

Use current Three.js with `WebGPURenderer`, Three.js Shading Language (TSL), and its node-based `RenderPipeline`. Prefer native WebGPU, with a deliberately tested WebGL2 compatibility tier. Keep the interface lightweight: changing to React would not improve GPU rendering.

Deliver in two releases:

1. **Modern foundation and parity:** All existing modes, playback controls, and characteristic behavior working on the new rendering stack, with correct color management, reliable lifecycle handling, and performance diagnostics.
2. **Advanced visuals:** GPU simulations, richer effects, true volumetric treatment, transitions, and quality tuning after the foundation passes its acceptance tests.

WebGPU increases the available rendering capabilities; it does not automatically improve appearance or make every scene faster. Art direction, shader design, audio response, and profiling remain essential.

### Included

- All 18 current modes and local audio-file playback.
- A reproducible development/build workflow, modular code, and focused automated tests.
- Explicit rendering quality presets, adaptive resolution, performance reporting, and accessible performance controls.
- Robust startup, unsupported-browser behavior, resource cleanup, and device-loss recovery.

### Not included in the initial release

- Python application integration, a desktop wrapper, accounts, cloud storage, or backend infrastructure.
- Microphone/system-audio capture, a full VJ timeline, MIDI control, or video export. These can be scoped separately; browser capture permissions and export support require their own design.
- Path tracing, hardware ray tracing, or a complex physically based lighting stack solely to claim newer technology. They are not prerequisites for excellent abstract music visuals.
- Dependency installation, Git writes, or application changes as part of creating this plan.

## 2. Verified starting point

The present application consists of `index.html`, `script.js`, and `style.css`; no package/build setup is present in this folder.

| Area | Observed implementation | Consequence |
|---|---|---|
| Dependency | Three.js `0.155.0` through an unpkg import map in `index.html` | Upgrade requires checking migration changes, not just editing a version string. |
| Renderer | `THREE.WebGLRenderer`, canvas antialiasing, device-pixel ratio capped at 2 | Already GPU accelerated, but not using WebGPU; quality is fixed rather than measured. |
| Postprocessing | `EffectComposer`, `UnrealBloomPass`, `GlitchPass`, `RGBShiftShader` | Must be replaced for the proposed node-based rendering stack. |
| Custom shaders | GLSL `ShaderMaterial` for the kaleidoscope plane and two fullscreen effects | Must be ported; `ShaderMaterial` is documented for `WebGLRenderer` only. |
| Animation | A large shared loop with JavaScript geometry updates; 8,000 swirl particles; 220 boids | Move suitable work to shaders/compute after measuring the baseline. |
| Existing optimizations | City instancing, typed geometry buffers, GPU fullscreen shaders, visibility-gated mode updates | Preserve these strengths; do not assume all hidden effects are fully simulated. |
| Audio | Web Audio `AnalyserNode`, FFT size 1024, three energy bands, simple beat threshold | Keep playback separate from visual frame rate and improve analysis deliberately. |
| God rays | Additive transparent cone meshes plus bloom | This is a stylized approximation, not volumetric scattering. |
| Lifecycle | All modes created at startup; shared scene/camera; object URLs not explicitly revoked | Introduce lazy mode activation, owned resources, and cleanup. |

Relevant code: renderer/composer in `script.js` around lines 90–133; shader paths around 360–468; mode setup around 612–648; animation around 654–987.

### Correctness work to include during migration

- Modes such as FFT Tunnel and City read `freqArray.length` before audio has necessarily been initialized. Provide a valid silent audio frame from startup.
- City changes the shared camera; mode switches need explicit camera and scene-state reset.
- Several rotations, tunnel movements, and spring damping depend on frame count. Convert them to elapsed-time or fixed-step simulation while matching the original feel at a reference rate.
- Handle rejected playback promises, track changes, end-of-track state, and object-URL replacement consistently.
- Review shaders using reversed `smoothstep` edges; use defined expressions such as one minus an ascending-edge smoothstep.
- Review fullscreen aspect ratio, resize behavior, and render-target pixel density rather than preserving accidental distortion.
- Avoid per-particle object allocations; the star tunnel currently constructs colors in its inner update loop.
- Revalidate geometry bounds after deformation so culling cannot incorrectly hide GPU- or CPU-animated effects.

## 3. Target technology and compatibility contract

### Core choices

- **Three.js:** npm reported `0.186.1` when checked for this plan. Pin an exact tested version and matching addons, commit a lockfile when implementation is authorized, and review migration notes from r155 onward. Recheck the chosen version at implementation time.
- **Rendering:** `three/webgpu` with asynchronous renderer initialization, a single controlled animation loop, and explicit capability reporting.
- **Shaders:** TSL/node materials through `three/tsl` for portable vertex/fragment effects. Use direct WGSL only when a demonstrated requirement justifies a native-WebGPU-only implementation.
- **Postprocessing:** `RenderPipeline` and supported node effects. The older `PostProcessing` name is deprecated since r183; do not base new code on it or on `EffectComposer` compatibility assumptions.
- **Application:** TypeScript and Vite, keeping vanilla DOM/CSS for the control panel. Select a supported Node.js LTS and compatible tool versions during setup.
- **Tests:** Focused logic tests plus Playwright browser tests; test real accelerated browsers separately from headless/software environments.
- **Delivery:** A local development server and static production build. Serve via localhost or HTTPS; do not rely on `file://` execution or production runtime CDN resolution.

### Rendering tiers

| Tier | Rendering path | Required behavior |
|---|---|---|
| Native WebGPU | `WebGPURenderer` using a successfully initialized WebGPU backend | Full supported shader pipeline; compute simulations when required capabilities are available. |
| WebGL2 compatibility | The renderer's WebGL2 backend plus compatible node effects and simulation adapters | All existing modes remain selectable; use reduced counts, analytic animation, or bounded CPU simulation where compute/storage features are unavailable. |
| Unsupported | Neither usable backend initializes | Clear explanation and recovery guidance; no blank canvas or endless retries. |

The documented WebGL2 fallback does **not** make arbitrary compute workloads, storage buffers, or every node effect portable. Check each effect explicitly, test forced WebGL2, and substitute an intentional lower-cost implementation where necessary.

Attempt real initialization, not just a `navigator.gpu` existence check. Report the actual initialized backend. WebGPU startup failure should trigger a controlled WebGL2 attempt; native device loss requires a recovery flow, not an assumption that automatic fallback repairs an active session.

Browser/OS/GPU support must be tested on the user's machine. Do not promise Safari, Firefox, or Chromium feature parity solely from browser branding or version detection.

## 4. Proposed module design

Use a few deep modules with small interfaces. Avoid one wrapper per Three.js call or a configurable rendering framework bigger than this application.

| Module | Interface and responsibility |
|---|---|
| Application | Own startup, playback-to-renderer coordination, mode selection, and shutdown. |
| Audio engine | Load/play/pause/seek/dispose and expose a stable audio frame: waveform, spectrum, band energies, onset/beat state, playback time. Hide analyser setup and smoothing. |
| Visual engine | Initialize, select mode, resize, render, and dispose. Own backend selection, camera defaults, render targets, output transforms, and active-mode lifecycle. |
| Visual modes | A small lifecycle interface for creation, update, and disposal; declare required capabilities and output type. Implement scene, fullscreen, and DOM modes without copying the application loop. |
| Quality controller | Turn measured frame times and user settings into resolution/effect budgets. Hide sampling windows, hysteresis, and tier limits. |
| Control panel | Bind application state to accessible DOM controls; never mutate GPU internals directly. |

The simulation seam has two concrete adapters where needed: a native GPU simulation and a bounded CPU/analytic compatibility implementation. Do not duplicate the entire renderer for fallback.

Proposed organization, created only during implementation:

```text
Desktop/visualizer/
  index.html
  script.js                         # retain as reference until replacement passes
  style.css
  WEBGPU_MODERNIZATION_PLAN.md
  package.json / package-lock.json
  tsconfig.json / vite.config.ts
  src/
    main.ts
    audio/AudioEngine.ts
    rendering/VisualEngine.ts
    rendering/OutputPipeline.ts
    rendering/QualityController.ts
    modes/                          # registry, lifecycle, individual modes
    simulations/                    # only genuinely shared simulation logic
    ui/ControlPanel.ts
  tests/
    unit/
    browser/
    fixtures/                       # small deterministic synthetic inputs
```

Keep the original entry working during migration using a separate development entry inside this same folder. Do not overwrite the original script until parity is approved. No new checkout or large media/model download is needed.

Resource rules: allocate lazily; update only active modes and modes participating in a transition; bound any reuse cache; dispose targets, textures, buffers, materials, subscriptions, and replaced audio URLs. Prevent overlapping frame submissions and restore renderer state after auxiliary passes.

## 5. Migration map: all 18 existing modes

Difficulty is relative migration effort, not a measured schedule. Every mode first gets a recognizable parity implementation; enhancements follow separately.

| ID / existing label | Current mechanism | Planned migration | Effort |
|---|---|---|---|
| `circle` / Circle Waveform | CPU-updated line | Sample a compact waveform input in vertex/node logic; preserve shape and audio phase. | Low–medium |
| `spiral` / Spiral | CPU-updated line | Procedural vertex deformation driven by waveform and time. | Low–medium |
| `star` / Star Burst 3D | CPU-built/deformed geometry | Preserve spike topology and beat response, then move deformation into node logic. | Medium |
| `cube` / Cubic Field | CPU-updated connected grid | Keep original connected-field appearance; procedural vertex motion. | Low–medium |
| `particles` / Neon Swirl Particles | 8,000 CPU-updated points and ring | Begin with analytic GPU swirl; use instanced billboards where required for portable particle size and shape. | Medium |
| `errors` / Vintage Errors (Win95) | DOM windows over the canvas | Retain DOM implementation, dragging, cleanup, and beat-driven spawning; isolate from renderer internals. | Low |
| `lissajous` / Laser Lissajous | Three CPU-updated lines | Procedural curves; evaluate a supported thick-line or ribbon treatment for consistent line width. | Medium |
| `boids` / Boids + Beat Bursts | 220 boids, pairwise CPU steering | Establish parity, then GPU double-buffered state and spatial partitioning for scale; capped CPU fallback. | High |
| `fftTunnel` / FFT Tunnel (Lines) | 28 mutable line rings | GPU spectrum sampling and ring deformation; batch compatible geometry without changing line topology. | Medium |
| `kaleidoPlane` / Kaleidoscope Plane | GLSL-deformed mesh and render-to-texture sampling | Port both shader stages and the kaleidoscopic sampling pass to TSL; preserve the intermediate scene pass. | High |
| `city` / Instanced Cityscape | Instanced boxes, CPU matrix writes, camera orbit | Retain instancing; drive building height on GPU and isolate camera ownership. | Medium |
| `glitchRing` / Glitch Ring | CPU-jittered line loop | Time/seed-driven vertex noise and controlled color response. | Medium |
| `vjRings` / VJ Smooth Rings (FS) | Fullscreen GLSL shader | TSL fullscreen output with aspect correction and explicit output transform. | Medium |
| `neonKaleido` / Neon Kaleido Blink (FS) | Fullscreen GLSL shader | TSL port; preserve folding/rings while providing adjustable flash intensity. | Medium |
| `starTunnel` / Stars Tunnel | Textured points, CPU spring/pulse simulation | Preserve wrapping, radial stability, pulses, and texture; use instanced sprites and GPU state where justified. | High |
| `bloomTunnel` / Bloom Tunnel (Neon) | Mesh rings plus UnrealBloomPass | Node-compatible bloom pipeline; instance rings where useful and fix frame-dependent motion. | Medium |
| `glitchFX` / Glitch FX (RGB Split) | Glitch Ring plus composer passes | Node-based distortion and RGB separation with deterministic, bounded intensity. | Medium–high |
| `godrays` / God Rays (Volumetric) | Additive cones plus bloom | Preserve stylized cone parity first; add genuine volumetric treatment as a separate advanced implementation. | High for enhancement |

Do not treat shader/compute ports as buffer replacement alone. Attribute formats, particle sizing, transparency, coordinate conventions, output color, and pipeline scheduling need validation.

## 6. Image quality and advanced effects

### Output pipeline

1. Render scene or fullscreen-mode output into the intended working color space, using supported linear floating-point targets when available.
2. Apply scene-referred effects such as controlled bloom before the output transform.
3. Apply tone mapping/exposure and conversion to display output exactly once. Start with an evaluated tone-mapping operator such as ACES or AgX; choose by visual comparison, not name recognition.
4. Apply display-referred antialiasing or other effects in the order required by their documented implementation.
5. Keep DOM controls separate from canvas postprocessing. Compose DOM overlays predictably without processing UI text through bloom.

An internal floating-point/HDR pipeline does not imply HDR monitor output. Standard display output is the initial compatibility target.

Validate multisampling with offscreen targets and transparent effects: canvas `antialias: true` alone does not establish that a postprocessed image is antialiased. Choose supported MSAA or postprocess AA based on tests. Temporal AA is optional, not a default promise; flashing, transparency, and fast motion can produce ghosting.

GPU deformation must supply safe bounds; transparent billboards need deliberate depth-write, sorting, and blending policies. Avoid huge particles causing excessive overdraw. Keep spectrum/waveform uploads compact instead of reading simulated particle state back to the CPU every frame.

### Advanced release priorities

1. **Particle density and motion:** Scale the swirl and star tunnel only within measured budgets. Prefer analytic GPU motion when no persistent simulation is needed.
2. **GPU flocking:** Use separate previous/next state buffers; avoid in-place neighbor races. GPU execution does not remove quadratic complexity, so large flocks need spatial bins or another bounded-neighbor method.
3. **True volumetric appearance:** Prototype a low-resolution raymarched scattering field or a validated depth-aware light-shaft technique. Label the chosen effect accurately; expose sample/quality limits and retain the stylized compatibility version.
4. **Transitions:** Crossfade compatible mode outputs with a short, explicit resource budget; temporarily reduce quality if running two modes exceeds it. Avoid recompiling shaders during the visible transition.
5. **Optional fluid-like visuals:** A procedural flow shader or fluid simulation is an additional mode, not required for parity. Prototype visual benefit and cost before adding another large simulation system.

## 7. Audio response and user experience

- Preserve file upload, play/pause, seeking, timestamps, visual selection, and color-change interval controls.
- Use `AudioContext`/media playback as the timing authority; rendering consumes an audio snapshot and does not advance playback itself.
- Provide zero-filled waveform/spectrum data before a track is loaded and after errors. No mode may assume a live analyser exists.
- Keep the existing FFT response for the initial comparison. Later make FFT resolution, band mapping, smoothing, and sensitivity deliberate quality/art-direction choices.
- Normalize smoothing and onset detection against elapsed time; distinguish a basic onset detector from reliable musical tempo estimation.
- Keep the analyser on Web Audio. Introduce an `AudioWorklet` only if a measured need for custom analysis or timing justifies the extra module and tests.
- Add fullscreen, hide-controls, quality preset, render-scale override, exposure/bloom controls, backend indicator, and a compact performance display.
- Make keyboard shortcuts avoid text fields and native controls. Provide accessible names, focus states, touch-friendly controls, and narrow-window layouts.
- Provide reduced-motion/reduced-flash options and a clear warning for strobe-like modes. Do not force intense flashing as the only way to use a mode.
- Store small settings locally with validation and versioning; do not upload audio or introduce analytics.

## 8. Implementation stages and exit gates

### Stage 0 — Baseline and capability spike

- Record browser, OS, GPU where available, viewport, drawing-buffer dimensions, and current frame-time behavior for representative modes.
- Capture deterministic reference images using seeded randomness, fixed audio fixtures, and controlled timing. Review existing bugs rather than declaring every current artifact a requirement.
- Add a minimal development entry and pin the selected Three.js version.
- Prove native WebGPU startup, forced WebGL2 startup, one basic scene, one TSL fullscreen effect, and the chosen bloom/output path.
- Test the compute/instanced-billboard approach separately; document compatibility substitutions.

**Exit gate:** The chosen stack works on the target browser/hardware, fallback is real, and no critical dependency assumption remains untested.

### Stage 1 — Application foundation

- Introduce the module interfaces, TypeScript/build setup, audio state, input handling, lifecycle ownership, and capability/error UI.
- Implement silent startup, loading/error states, deterministic time/random sources for tests, camera resets, and disposal.
- Provide an explicit selectable legacy entry during development; keep original files unchanged until replacement approval.

**Exit gate:** Playback and mode lifecycle tests pass; repeated initialization/disposal does not duplicate audio connections or animation loops.

### Stage 2 — Port all 18 modes for parity

- Port simple scene modes and the DOM mode first; then particle/instanced modes, fullscreen effects, render-to-texture kaleidoscope, and stateful simulations.
- Replace GLSL materials and composer passes with verified node equivalents or deliberate reimplementations.
- Keep bounded CPU simulation where it lowers parity risk; GPU scaling belongs in the next stage.
- Test every mode both before audio loads and with playback, seeking, resizing, and rapid mode changes.

**Exit gate:** All 18 modes are recognizable and usable on native WebGPU and the documented compatibility tier; visual changes are reviewed, not silently accepted.

### Stage 3 — GPU scaling and image-quality tuning

- Move proven hotspots to GPU vertex/compute work, fix time-dependent physics, and reduce allocations/draw calls/overdraw where measurements justify it.
- Tune the output pipeline, bloom, antialiasing, exposure, and spectrum response using reference scenes.
- Implement quality presets and adaptive rendering with a rolling window, hysteresis, bounded scale steps, and a manual lock. Do not lower quality because of a one-time shader compile alone.
- Warm only the selected or likely next effect; do not compile and allocate every high-quality mode eagerly.

**Exit gate:** Quality and responsiveness improve against the baseline at documented settings; compatibility substitutions remain covered.

### Stage 4 — Advanced visuals and polished controls

- Add the volumetric treatment, richer GPU particle behavior, bounded transitions, and the improved control panel.
- Tune reduced-flash/reduced-motion behavior alongside the normal look.
- Keep experimental fluid or other new modes behind a separate acceptance decision.

**Exit gate:** Each advanced effect earns its complexity through visible benefit and meets its assigned quality-tier budget.

### Stage 5 — Stabilize and replace the default entry

- Complete the browser/hardware matrix, long-session checks, recovery scenarios, production-build smoke tests, and final visual review.
- Make the modern entry the default only after acceptance. Retain a small, agreed legacy reference or recovery route; do not duplicate the project.
- Include concise run/build instructions and the measured support/quality matrix in the final implementation handoff.

**Exit gate:** Acceptance criteria below pass and the user approves the default-entry switch. No implementation schedule is promised before Stage 0 establishes the actual compatibility work.

## 9. Quality targets and benchmark method

These are proposed targets, not current measurements or guarantees. Finalize the reference machine/browser during Stage 0.

| Preset | Proposed operating point | Policy |
|---|---|---|
| Compatibility | 1080p-class internal resolution when supported | Preserve all original modes with reduced simulation/effect budgets; degrade deliberately. |
| Balanced | 1080p internal resolution, targeting 60 fps on the agreed reference machine | Primary acceptance target. |
| High | 1440p-class internal resolution, targeting 60 fps where benchmarks permit | Higher particle/effect budgets; adaptive resolution allowed. |
| Ultra/manual | Native/4K output or 120 Hz targets where the machine permits | Opt-in and measured per mode; never advertised as universal. |

For a 60 Hz target, sustained frame intervals should predominantly fit the approximately 16.7 ms cadence; 120 Hz allows approximately 8.3 ms. Record median/p95/p99 intervals, missed-frame behavior, main-thread work, and GPU timings when available. A requestAnimationFrame interval is not itself GPU execution time.

Benchmark representative easy and expensive modes after warmup: VJ Rings, particles, boids, kaleidoscope plane, city, star tunnel, bloom tunnel, and god rays. Use a repeatable one-minute run, then a longer mode-switching soak. Separate cold compile/load latency from steady-state rendering. Record actual drawing-buffer resolution rather than relying on a CSS viewport label.

Target a p95 frame interval within 10% of the selected refresh budget in steady state on the agreed reference configuration; if a mode misses it, reduce its documented quality budget or declare it a higher-tier mode. Hardware-specific failures must not be hidden behind average FPS.

## 10. Acceptance tests

### Automated logic tests

- Audio band mapping, silent inputs, normalization, smoothing, and controlled synthetic onset fixtures.
- Fixed-step/time-based animation invariants, wrap/clamp rules, and finite simulation state.
- Quality-controller hysteresis and manual locks using injected frame-time samples.
- Capability selection, mode requirements, unsupported-effect substitution, settings validation, and resource ownership.

### Browser behavior and visual checks

- All 18 IDs are registered exactly once, and each activates before a file is loaded without an exception.
- Load a valid file; play/pause/seek; switch files; reach the end; recover from invalid or rejected playback; retain correct controls and timestamps.
- Resize and change pixel density; toggle fullscreen and controls; leave/re-enter a hidden tab; verify camera reset between modes.
- Compare seeded reference scenes at fixed times with tolerance appropriate to different GPU backends. Review composition, silhouette, color response, stability, and aspect ratio rather than demanding byte-identical pixels.
- Verify bloom and AA through the actual postprocessing path, not only on a direct-rendered scene.
- Exercise keyboard/focus, narrow layouts, reduced-motion, and reduced-flash behavior.

### Compatibility, recovery, and stability

- Run real accelerated native WebGPU tests and separately force WebGL2; assert the actual backend and substitutions.
- Test no-WebGPU, denied/failed initialization, both-backends-unavailable, and shader/effect setup failure without a blank screen.
- Exercise device-loss recovery using supported test hooks where available; re-create owned GPU resources or offer an explicit compatibility restart while preserving recoverable playback/settings state.
- Repeatedly switch all modes, replace audio tracks, and resize for a 30-minute soak; no unbounded resource growth, duplicate loops, orphaned overlays, or accumulating object URLs.
- Use allocation/disposal instrumentation and available GPU/browser diagnostics; JavaScript heap size alone is not a complete GPU-memory measurement.
- Production build loads from a local static server with bundled dependencies and without unpkg runtime resolution.

Browser automation may use software rendering or lack WebGPU in CI. Treat that as behavior coverage, not proof of physical-GPU performance. Real-device validation is a separate release gate.

## 11. Main risks and decisions

| Risk / decision | Mitigation / default |
|---|---|
| Large version jump and evolving node interfaces | Pin versions; verify matching examples and migration notes; prove the stack before porting all modes. |
| Assuming fallback supports native compute | Separate simulation adapters and test capability-specific effects explicitly. |
| Better performance but worse-looking output | Keep reference scenes and review image quality independently from FPS. |
| Excessive GPU cost from particles, translucency, volumetrics, or crossfades | Bound counts/samples/overlap; use lower-resolution intermediates and adaptive budgets. |
| Changing the original behavior accidentally | Preserve mode IDs, controls, composition, stable star-tunnel feel, and audio character; isolate intentional improvements. |
| Overengineering | Keep a small module interface; no UI framework, generalized graph editor, or direct-WGSL subsystem without a concrete need. |
| Unknown target hardware and browser | Resolve in Stage 0 before promising 4K/60, 120 Hz, particle counts, or browser coverage. |
| Disk growth and project sprawl | Work in this folder; no extra checkout, downloaded media library, or model assets. Agree on any later large storage requirement. |

Implementation defaults: preserve the existing 18 modes, prioritize reliable 1080p/60 on a named reference machine, use a lightweight UI, retain compatibility behavior, and treat the advanced effects as a second gated release. Decisions still needed before implementation: primary browser/machine, preferred reference tracks or synthetic-only fixtures, and whether the priority after parity is dense particles or volumetric effects.

## 12. Sources and verification notes

Checked October 24, 2026. Public documentation may advance after this plan; implementation must use the selected version's documentation and examples.

- Existing source: `index.html`, `script.js`, and `style.css` in this folder. No runtime performance measurements were taken while preparing this plan.
- Current npm release lookup: https://registry.npmjs.org/three/latest — reported `0.186.1`.
- WebGPU renderer and documented WebGL2 fallback: https://threejs.org/docs/pages/WebGPURenderer.html
- GLSL material restriction: https://threejs.org/docs/pages/ShaderMaterial.html — documented as usable with `WebGLRenderer` only.
- Current output/postprocessing module: https://threejs.org/docs/pages/RenderPipeline.html
- Deprecated predecessor: https://threejs.org/docs/pages/PostProcessing.html — renamed to `RenderPipeline`, deprecated since r183.
- Versioned GPU particle example: https://github.com/mrdoob/three.js/blob/r186/examples/webgpu_compute_particles.html
- Upgrade reference: https://github.com/mrdoob/three.js/wiki/Migration-Guide

**Next action:** Approve the plan and begin Stage 0 only. Do not start an unmeasured full rewrite or overwrite the original working entry as the first implementation step.

