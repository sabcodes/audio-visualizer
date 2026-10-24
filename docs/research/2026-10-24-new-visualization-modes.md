# 32 new visualization modes (18 → 50)

Date: 2026-10-24. Source: six parallel research passes (geometric, shader, creatures, nature, retro, physics), consolidated and de-duplicated against the existing 18 modes.

**Caveat on references.** Web search was rate-limited for every pass, and no page was opened. Reference URLs came from search results or the agents' memory, so treat them as leads to verify, not citations. Shadertoy code is CC BY-NC-SA by default, so implement originally rather than copying.

**Legend.** Complexity S/M/L. Perf = risk on integrated GPUs. Compute = needs WebGPU compute for the full look; "GL2" notes how the WebGL2 fallback degrades.

## A. Creatures (6)

| # | Mode | Audio mapping | Build | Cx | Perf |
|---|------|---------------|-------|----|------|
| 1 | **Robot Dancer**: boxy chrome robot, LED visor, classic moves | beat picks pose from a small library (slerped); bass head-pop and chest LEDs; highs drive visor EQ bars | ~15 primitives, pose-to-pose slerp with overshoot springs; ~1k tris | S | low |
| 2 | **Swamp Giant**: hulking green ogre-like original design, belly, horns, club fists | bass knee bend and squash/stretch; mids alternate arm swings; beat stomp with ground ring; loudness eye glow | ~25 primitives, spring-damped joints; 1.5–3k tris | S–M | low |
| 3 | **Kraken**: dome head, 8 tentacles of 10 cone segments, glowing suckers | one FFT band per arm sets curl; bass mantle pulse; beat whips arms outward | chained segments with travelling sine plus FABRIK-lite; ~3k tris | M | low |
| 4 | **Crowd + Mascot Blob**: squishy jelly mascot ringed by 200–2000 tiny dancers | bass squash; beat jump ripples outward by distance; FFT bands colour crowd rows | single InstancedMesh, motion in TSL vertex shader from instanceIndex; one draw call | M | low–med |
| 5 | **Phoenix**: faceted fire bird, ~9 feather blades per wing, tail streamers, embers | beat wing downstroke; bass body bob and tail fan; loudness flame colour; drop spreads wings | feather blades with per-feather phase lag; instanced embers; ~2.5k tris | M | low–med |
| 6 | **Low-Poly Dragon** (flagship): wedge head, 12-segment neck/tail, triangulated bat wings | bass head bob and neck S-wave; beat wing flap; loudness peak triggers fire breath; FFT drives tail wave | follow-the-leader chains reused from Kraken; wing membrane as a per-frame BufferGeometry; 4–6k tris | L | medium |

Build order: Robot and Swamp Giant first to prove a shared rig util (spring-damped joints, beat-phase clock, FFT smoothing). Then Kraken (chain util), then Dragon.

## B. Geometric and mathematical (5)

| # | Mode | Audio mapping | Build | Cx | Perf |
|---|------|---------------|-------|----|------|
| 7 | **Polyhedra Morph**: wireframe solid morphing tetra → cube → octa → dodeca → icosa, nested dual | beat advances target; bass sets ease and node size; FFT displaces vertices | pre-resolve all solids to equal vertex count, lerp buffer; LineSegments plus instanced nodes | S–M | low |
| 8 | **Torus Knot / Möbius / Klein Morph**: glowing ribbon with flowing stripes | bass pulses radius; FFT displaces along normal by u; beat steps (p,q) | ParametricGeometry rebuilt on beats, TSL vertex deformation | M | low |
| 9 | **Fourier Epicycles**: circle chains trace a rose/star with a glowing trail | band k magnitude = radius of epicycle k; bass sets speed; beat swaps curve | CPU loop of 32–64 terms; ring-buffer trail line | S | very low |
| 10 | **Chladni Plate / Cymatics**: sand migrates to nodal lines of a standing wave | dominant FFT peak sets (n,m); bass amplitude; beat scatters grains | 100–200k particles descending \|f\| gradient. GL2: fragment-shader line fallback | M | low–med |
| 11 | **Strange Attractor Garden**: Lorenz, Aizawa, Thomas ribbons, 100k+ particles | bass scales dt; mids modulate a parameter; beat morphs to next attractor | Compute ODE step. GL2: GPGPU texture path | M | medium |

## C. Fullscreen shader (5)

| # | Mode | Audio mapping | Build | Cx | Perf |
|---|------|---------------|-------|----|------|
| 12 | **Liquid Metaballs**: chrome/mercury blobs merging with smooth-min | bass radius and blend k; per-blob orbit from FFT bands; beat impulse | TSL raymarch, ~40 steps, blob uniform array | M | medium |
| 13 | **Ink Marble / Oil Slick**: domain-warped fBM with iridescent thin-film bands (merged from two ideas) | bass warp strength and film thickness; mids flow; beat shockwave warp | one fullscreen pass, 4-octave noise | S | low–med |
| 14 | **Reaction-Diffusion Organism** (Gray-Scott coral/maze) | bass seeds; loudness shifts feed/kill; FFT painted along a ring | ping-pong float RG target, 4–8 steps/frame at 512–1024 px | M | low–med |
| 15 | **MilkDrop Feedback Warp**: zoom/rotate/warp/decay trails | bass zoom; mids rotation; beat injects ring | ping-pong target with per-pixel UV warp | M | low |
| 16 | **Voronoi Crystal Mosaic**: stained-glass cells, one FFT bin per cell | bass breathes scale; beat flashes cells | 3×3 Voronoi F1/F2 in TSL | S | low |

## D. Nature and space (6)

| # | Mode | Audio mapping | Build | Cx | Perf |
|---|------|---------------|-------|----|------|
| 17 | **Aurora Curtains** over mountains and a lake | one curtain per band; bass slow sweep; impact flare | stacked additive planes, warped noise | S | low |
| 18 | **FFT Galaxy**: spiral of additive particles, FFT mapped to radius | bass pumps core; beat sends density wave along arms | 200k–1M points, positions in TSL | S–M | low–med |
| 19 | **Audio Ocean**: Gerstner sea, moon glitter path, foam | bass swell; mids steepness; impact ring ripples | dense plane with TSL vertex waves | M | low–med |
| 20 | **Event Horizon**: black hole, lensed starfield, accretion disk | bass disk brightness; impact inward rings; loudness lensing radius | fullscreen TSL, fake bend, step cap by render-scale tier | M | medium |
| 21 | **Beat Fireworks Night**: peony, willow, crackle bursts over water | beat launches; kick = peony, snare = crackle, hats = sparkle | analytic particle pool in TSL, additive points | M | medium |
| 22 | **Abyss**: bioluminescent deep sea, jellyfish choir (merged), marine snow | one jellyfish per band; bass current surge; impact ripple | instanced bells with TSL pulse; point-cloud snow | M | low–med |

## E. Retro and music culture (5)

| # | Mode | Audio mapping | Build | Cx | Perf |
|---|------|---------------|-------|----|------|
| 23 | **Unknown Pleasures Ridgeline**: stacked spectrum slices scrolling back | each row = current FFT; bass scroll speed; impact spike | DataTexture ring buffer of N rows, TSL vertex displacement | S | low |
| 24 | **Outrun Sunset Grid**: striped sun, neon grid, FFT mountains | bass pulses sun and grid; mid/high bands set terrain height | procedural grid shader, displaced side terrain | S–M | low |
| 25 | **Turntable / Vinyl Deck**: grooves, tonearm, radial spectrum | bass wobble; FFT shades grooves by radius; beat scratch jitter | anisotropic groove shader, articulated tonearm | M | low |
| 26 | **Mirror-Ball Disco**: faceted ball, light spots, sweeping beams | bass spin and pulse; highs facet sparkle; beat flips colours | instanced tiles, additive spot quads, cone beams | M | low–med |
| 27 | **ASCII / Halftone Terminal** (merged from two ideas): glyph or dot post pass over a base field | bass cell size; loudness threshold; beat rotates halftone angle | render to target, glyph-atlas lookup; could wrap other modes | S–M | low |

## F. Physics and generative (5)

| # | Mode | Audio mapping | Build | Cx | Perf |
|---|------|---------------|-------|----|------|
| 28 | **Physarum Slime Veins**: agents form glowing vein networks | bass spawns bursts; loudness sets sensor angle; impact flips attract/repel | WebGPU compute, 0.5–2M agents. GL2: ≤100–200k via texture agents | M | med–high |
| 29 | **Curl-Noise Flow Ribbons**: silk-like particle streams | bass impulse; loudness frequency; beat vortex ring | compute with 4D curl noise plus fading accumulation. GL2: GPGPU ping-pong | M | low–med |
| 30 | **Ferrofluid Spike Pool**: black liquid metal erupting into spikes | bass height; FFT bins by angle/radius; beat ripple | subdivided plane, TSL spike displacement, physical material. GL2 fine | S–M | low |
| 31 | **Pendulum Wave Curtain**: 30–60 bobs drifting in and out of phase | bass kicks phase; per-bob amplitude from FFT; impact re-syncs | CPU analytic angles, instanced spheres. GL2 fine | S | very low |
| 32 | **Snowflake / DLA Crystal Bloom**: six-fold growth that melts and regrows | bass growth rate; treble spikiness; impact regrows | Reiter hex CA in fragment ping-pong plus 6× mirror. GL2 fine | M | low |

## Bench (cut for overlap, weight or risk; swap in if wanted)

Skeleton Band, Mandelbulb or Menger fractal (heavy; needs render scale 0.5×), Voxel Wave Lattice (close to Cubic Field), Jelly Blob Soft Body, Kinetic Typography, Piano Roll Falling Notes, LED Segment Bar Analyzer (cheap classic), Thunderstorm Sky, Low-Poly Terrain Flyover (overlaps Outrun), Cloth Sheet, Falling Sand Equalizer, Harmonograph (close to Laser Lissajous), XY Phosphor Vectorscope (close to Laser Lissajous). Asset-based options (Quaternius monsters, Mixamo-style dance clips) are excluded: licensing needs checking and they add repo weight.

## Risks and notes

- **WebGPU-first modes:** #11, #28 and #29 look best with compute. Decide whether their WebGL2 versions ship reduced or are gated to WebGPU (`backends` in `ModeDefinition` already supports this).
- **Heavy fullscreen modes:** #12 and #20 should respect the adaptive render scale.
- **Output type:** #13–#16, #20, #24 and #32 are `fullscreen`; #27 is a post pass that may fit the `filter` hook on `VisualMode`.
- **Suggested first wave** (cheap, high variety): #9, #16, #17, #23, #31, #1, #2, #7.
