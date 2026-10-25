# Wave 4 visualization modes: 29 reference clips (two sets)

Batches: **4a** = procedural modes, **4b** = model-dependent modes. Asset requirements for 4b live in the separate brief `2026-10-24-wave-four-model-asset-brief.md`. (Earlier drafts and the git branch say "wave 3"; same work.)

Status: **implemented** on `feat/new-modes-wave-4` (see docs/backlog.md for deviations). Source: 14 phone screen recordings of social-media visualizers (9–21 s each), reviewed as 6-frame contact sheets. Motion and audio response are inferred from frames plus the clip's music, so every audio mapping below is a proposal, not an observation.

## Intent

Add modes that feel like these clips: cinematic, high-contrast, a single strong idea per mode. Not 1:1 copies; "similar but not identical" to what we have is fine. Success: each mode is recognisably the reference's *feel* (palette, camera, light behaviour), reacts clearly to bass/beat/loudness, and fits the existing `VisualMode` contract and quality budgets.

## Index (the 28 shippable modes; mode numbers in headings are source-clip numbers and have gaps)

Handoff note: this document is **spec only**. Implementation happens elsewhere; do not treat anything here as built. "Needs models" means a procedural fallback ships first and the modelled kit upgrades it.

| Id | Label | Pace | Needs models | Effort |
|----|-------|------|--------------|--------|
| `mirrorPlasma` | Mirror Plasma | 1.6/s | no | M |
| `blackMaze` | Black Maze | 1.2/s | no | M |
| `chromeStreaks` | Chrome Streaks | fast | no | M |
| `prismBowtie` | Prism Bowtie | 3.3/s | no | S–M |
| `blockBowtie` | Block Bowtie | 1.5/s | no | S |
| `moonPond` | Moon Pond | <1/s | no | M |
| `beaconRings` | Beacon Rings | <1/s | no | M–L |
| `signalNight` | Signal Night | 2.2/s | no | M |
| `pongOrbs` | Pong Orbs | 2.9/s | no | M |
| `hairVortex` | Hair Vortex | calm | no | M |
| `windfield` | Windfield | calm | no | M |
| `anamorphicFlare` | Anamorphic Flare | calm | no | M |
| `lightLeakFilm` | Light Leak Film | 1–2/s | optional car | S–M |
| `emberSmoke` | Ember Smoke | <1/s | no | M |
| `liquidChrome` | Liquid Chrome (liquid blobs) | 2/s | no (approved) | M |
| `candyOrb` | Candy Orb | calm | no | S–M |
| `grainSmoke` | Grain Smoke | 1/s | no (own menu entry, built as a preset of the `mirrorPlasma` engine) | S |
| `silkThreads` | Silk Threads | 2.6/s | no | M |
| `templeDescent` | Temple Descent | ~1/s | Kit B | L |
| `underground` | Underground | 3.7/s | Kit A | L |
| `lightForest` | Light Painting Forest | beat flashes | Kit C | L |
| `redStairwell` | Red Stairwell | 1–2/s | Kit A | L |
| `warehouseHall` | Warehouse Hall | 1.8/s | Kit A | M–L |
| `bloomTouch` | Bloom Touch | <1/s | 2D layer (hand) | M |
| `lavaGolem` | Lava Golem | beat stomp | Kit G | L |
| `poleSparks` | Pole Sparks | beat pulses | 2D layers | M |
| `endlessStairs` | Endless Stairs | 3.5/s | Kit H | L |
| `redCrystalHall` | Red Crystal Hall | glow only | 2D layers | M |
| `starfallCanopy` | Starfall Canopy (night, stars, shooting stars) | calm + bursts | no | M |

## Pacing: these are fast visualizers (read this first)

Second review pass: 20–30 frames per clip at 8 fps, plus a brightness-jump count at 30 fps. The clips are **not smooth, slow-evolving scenes**. They are **beat-gated**: the picture sits near-black or dim, then **hard-cuts or flashes** on a hit and decays in 100–300 ms. Measured hit/cut rates (events per second): Endless Stairs 3.5, Underground 3.7, Prism Bowtie 3.3, Pong Orbs 2.9, Mirror Plasma 1.6, Silk Threads 2.6, Signal Night 2.2, Red Crystal Hall 2.3 (glow modulation, not cuts), Warehouse Hall 1.8, Block Bowtie 1.5, Black Maze 1.2. The calm ones (Windfield, Canopy, Bloom Touch, Anamorphic Flare, Beacon Rings, Candy Orb) are the exception, below 0.5/s.

What this changes in every fast mode:

1. **Gate, don't modulate.** Audio drives an on/off *trigger* with a fast attack (≤1 frame) and a short exponential decay (~120–250 ms), not a smoothed level. We already expose `response.impact` for this. Between hits the scene must fall to near-black (mean luma around 5–10 of 255, versus 40–60 on hits).
2. **Each hit changes the picture, not just its brightness.** Mirror Plasma swaps its whole silhouette (green slabs, then a magenta butterfly, then a cyan star). Prism Bowtie changes ray count and panel grid. Endless Stairs changes hue (cyan, amber, blue, magenta) and camera. Signal Night swaps beam colour and bearing, with a teal/red grade flip. Underground cuts angle. Black Maze moves a spotlight window. So each fast mode needs a **hit variant table**: on each trigger pick the next variant from a seeded sequence, never the same twice in a row.
3. **Hard cuts are allowed.** Frame-to-frame the camera angle, shape and palette can jump. Smoothing across a cut is wrong for these modes.
4. **Maximum frequency guard.** A 3–4 Hz cut rate is the intent but it is a flash hazard. All fast modes must honour `reducedFlash`: cap flashes at 3 per second, limit the brightness jump (cut to ~40%), and keep the near-black floor higher. `reducedMotion` also disables camera tumble and shake.
5. **Test fixture.** Add a synthetic 130 BPM kick/snare audio fixture to the mode review, because a still screenshot cannot show whether a hit lands. The Playwright review should capture 8 frames over 1 s starting at an impact and assert luma falls ≥3× within 300 ms.

Per-mode pacing (target cut rate and what changes on a hit):

| Mode | Rate | On a hit |
|------|------|----------|
| Endless Stairs, Underground, Prism Bowtie | 3–4 / s | hue/angle cut plus flash, fall to near-black |
| Pong Orbs | ~3 / s | beam colour, orb collision; every ~4th hit a white plasma ball with veins |
| Silk Threads | ~2.6 / s | white lightning thread down the column; otherwise a faint tangle |
| Mirror Plasma, Signal Night, Warehouse Hall | 1.5–2.5 / s | silhouette or beam swap, palette step |
| Block Bowtie, Black Maze, Light Leak Film, Red Stairwell | 1–2 / s | outline re-cut or spotlight jump; colour snap |
| Temple Descent | ~1 / s | red/orange grade slam with sun flare, then teal; reveal of the lit tiers every 3–4 s |
| Red Crystal Hall | glow only | crystal and cracks brighten; the camera stays locked off |
| Windfield, Canopy Sway, Bloom Touch, Candy Orb, Anamorphic Flare, Beacon Rings, Hair Vortex, Moon Pond | <1 / s | continuous motion with accented impacts |

Detail corrections from the extra frames (already applied below where a mode is affected): Mirror Plasma is a left/right-mirrored sculpture that collapses to a small point and re-blooms, not a steady stream. Black Maze has a **fixed top-down camera** and a **moving rectangular spotlight window**, no walking camera. Temple Descent holds on teal and cuts to a **red grade** on hits. Pong Orbs' big orb periodically becomes a **white veined plasma ball**. Light Painting Forest is a series of **wireframe light sculptures** (hummingbirds, chair, crescent moon, bird in flight) that appear and fade on beats, not generic reeds and hoops. Beacon Rings grows from a **single red dot** into a full ring stack and then into fans of arcs.

## Verdict on duplicates

None is a duplicate. Nearest neighbours and why they differ:

| # | Reference | Nearest existing | Difference |
|---|-----------|------------------|------------|
| 1 | leovann, particle bilateral bloom | `galaxy`, `boids`, `particles` | Curl-flow filaments with 4-way mirror symmetry, jellyfish-bell structures; none of ours mirror or flow along fields |
| 5 | viuta, prism bowtie | `godrays`, `arena` | Bilateral fan of chromatic-dispersion beams with white blow-outs |
| 6 | viuta, colour-block bowtie | `vjRings`, `neonKaleido` | One soft mirrored light band; hue jumps per beat |
| 7 | pond ripples + magenta glints | `ocean`, `ferrofluid` | Calm close-up pond, concentric ripples, additive glints |
| 9 | Beacon rings over canyon | `vjRings`, `circle` | Tilting 3D ring stack over lit rock terrain |
| 10 | stage beams + traffic bokeh | `godrays`, `disco` | Street-night scene, hard colour-gel beams, camera shake |

Overlap worth knowing: **#5 and #6 are siblings** (both bilateral light shapes). I kept both because their motion differs (#5 fans of rays, #6 a breathing block), but they share one implementation module. If you'd rather ship one, merge them as two presets.

## 3D modelling needs (start here)

The repo currently has **no GLB/GLTF loading** (no `GLTFLoader` anywhere). Existing creatures (robot, kraken) are procedural primitives. Asset-based modes need a small loader/cache added first (listed in the plan). Modes are designed so a **procedural fallback ships first** and the modelled kit upgrades it, so modelling never blocks the mode.

Format for everything: **glTF binary (.glb)**, Y-up, 1 unit = 1 metre, origin at base centre, single shared PBR atlas (2048², baseColor + normal + ORM) per kit, no animations, no rigs. Budget: whole kit under ~25k triangles, under 5 MB.

### Kit A: Industrial modular kit (needed for #8, #13, #14; helps #2)
Modular, snap-to-grid (4 m cells). Pieces:
- Wall panel plain, wall panel with window/door cutout, wall panel with pipe run
- Concrete pillar (square) and I-beam girder (straight, plus corner)
- Floor slab with rail groove, catwalk grating section, ceiling slab with light slot
- Straight stair flight with railing, landing, ladder
- Wall light fixtures: tube strip, caged bulb, floodlight
- **#8 only:** circular shaft ring segment (so the round opening can be modelled or built from a cylinder), rail track piece, one train/tram carriage (~2k tris, separable lit windows as an emissive material slot)

Triangle guide: 100–800 per piece. Emissive materials must be separate slots (light tubes, windows) so the engine can drive them with audio.

### Kit B: Temple shaft kit (#2)
- Tier block: carved facade with columns and niches, 3 variants, tileable on one axis
- Corner block, stair run, balcony ledge, cap slab with a square opening
- Optional: hanging chain/lantern, 2 variants

### Kit C: Forest floor kit (#12)
- Fern ×2, grass tuft ×2 (cards with alpha are fine), 2 trunk variants, 2 rocks, bush, hanging vine
- Leaf cards: ≤ 200 tris each; trunks ≤ 1.5k

### Not recommended to model
- **Hand/arm in #7** (the reference is live footage of a person). Skip it; the ripple pond stands alone. If you want a hand later, it's a separate rigged asset and a different scope.
- **Traffic signals in #10**: procedural boxes plus emissive circles, no model needed.

Modelling priority: **Kit A first** (three modes depend on it), then Kit C, then Kit B.

## Modes

Audio terms follow existing code: `bass`, `loudness`, `impact` (beat/onset), `bounce` from `frame.response`, plus the spectrum via `frame.audio`. Effort: S ≈ ≤1 day, M ≈ 2–3, L ≈ 4+. Perf: against the existing budget tiers.

### Group 1: Procedural, no modelling (build first)

**1. Mirror Plasma** (`mirrorPlasma`) — ref 1, leovann "Out of Sight"
- Look: black field; the picture is a **mirrored spectrum sculpture made of points and streaks**: a left/right-symmetric cyan core with wing-like lobes, hairline orange/green filaments fanning out and dotted bell/jellyfish outlines, mirrored top/bottom too. Between hits the frame drops to near-black, then a block-shaped burst slams back in (green/blue slabs, then magenta cone, then cyan star). Palette migrates orange → green → blue → magenta.
- Audio: the FFT is the geometry (each band drives a lobe's length/density), mirrored; bass = core size and cyan brightness; impact = blackout-then-slam (shape swaps and the palette steps); loudness = filament spread and speed.
- Build: compute (WebGPU) or GPGPU ping-pong (GL2) for 100–300k points; mirror in the vertex stage (4 instances of the position). Reuse approach from `galaxy`.
- Effort M. Perf low–medium.

**3. Black Maze** (`blackMaze`) — ref 3, "Trippin Maze"
- Look: monochrome **top-down** view (fixed camera) of a concrete-textured maze with raised walls, almost black. A hard-edged **rectangular spotlight window** reveals one patch of the maze at a time (top-left, bottom-right, top-right...), the window snapping between positions; full-frame reveals show the whole maze at once. No walking camera.
- Audio: impact = the window jumps to a new spot (and sometimes widens to the full maze); bass = wall height/shadow length; loudness = ambient fill so more of the maze shows.
- Build: maze from seeded generator into one `InstancedMesh`; 1–2 spot lights plus emissive quads; ink-black fog.
- Effort M. Perf low. Related to Arena Light Panels but a different scene; share the panel-flash helper.

**4. Chrome Streaks** (`chromeStreaks`) — ref 4, "Mr. Brightside"
- Look: greyscale macro of a **web of long curving fibres** (like hair or silk under tension) arcing around dark glass spheres with bubble reflections and tiny sparkle clusters; some spheres carry spiky fur. On big hits the camera whips into a dense rush of white streak lines and the sparkles flare.
- Audio: bass = sphere size and fibre sway; impact = whip-zoom into the streak rush and a flare of sparkles; loudness = fog glow and fibre brightness.
- Build: fibres as instanced curved lines with a travel-streak shader, spheres with a cheap env-reflection plus rim fur; additive sparkle points.
- Effort M. Perf low–medium. Closest to `starTunnel`, but dense and lit rather than star dots.

**5. Prism Bowtie** (`prismBowtie`) — ref 5, viuta "She worships Saturn"
- Look: two mirrored fans of rays meeting at a centre point, **mirrored top/bottom as well (four-way symmetry)**, rays textured as **LED dot-grids**, with red/green/blue dispersion fringes; between beats it collapses to a thin pink X, on beats it blows out to white-pink with panel grids visible, occasionally showing blue arch silhouettes behind.
- Audio: bass = fan opening and brightness; impact = white blow-out flash (respect `reducedFlash`); highs = ray count and dot detail.
- Build: fullscreen shader, polar rays with three offset samples for R/G/B.
- Effort S–M. Perf low.

**6. Block Bowtie** (`blockBowtie`) — ref 6, viuta "Someone I'm not"
- Look: a **mirrored waveform/spectrum silhouette**: a horizontal block sliced into mirrored columns around a bright vertical core, bow-tie or butterfly shaped, soft bloom. It re-cuts its outline every beat and the colour snaps (magenta, green, red, blue, orange, purple), sometimes a dark navy variant.
- Audio: bass = band width and height; impact = hue jump plus core flash; loudness = glow radius.
- Build: fullscreen shader with SDF band plus mirrored warp; shares module with #5.
- Effort S. Perf very low.

**7. Moon Pond** (`moonPond`) — ref 7, nickjaykdesign (live footage reference)
- Look: dark glossy pond close up; concentric ripples spawn at the touch point and spread; light catches the crests as **dotted, glittery lines** that alternate **magenta and blue-cyan**; the glow is brightest where waves overlap and fades to dark between hits. (The reference has an arm touching the water; we skip it, ripples spawn from seeded points.)
- Audio: impact = new ripple at a seeded point; bass = ripple amplitude; highs = glitter density; hue follows the global hue.
- Build: height-field texture with ripple sources, normal-derived sparkle in the fragment shader.
- Effort M. Perf low–medium. No hand (see modelling note).

**9. Beacon Rings** (`beaconRings`) — ref 9, drmadness3d "Beacon"
- Look: the camera sits **inside a lava-lit rock chamber** (cave walls of ridged red rock all around). A stack of thin concentric rings floats in the middle, tilting and spinning; when it stretches it becomes **sweeping fans of long parallel arcs** and a tight bright blade, with ember sparkles clustered at the edges. Starts from a tiny dot at the centre.
- Audio: bass = ring radius and brightness; impact = tilt snap to a new orientation; loudness = ember density; FFT = per-ring wobble.
- Build: procedural ridged-noise terrain, lit red with rim; ring stack as line geometry with width; comet tails via a trail buffer.
- Effort M–L. Perf medium.

**10. Signal Night** (`signalNight`) — ref 10, "Should I stay or should I go"
- Look: a dim teal-night street corner with **actual traffic-signal heads and cables** hanging in soft focus; **stage moving-head spotlights** (green, amber, red, white) rake across with horizontal motion-smear; the grade flips between teal-blue and red; handheld shake.
- Audio: impact = beam swap and colour change; bass = camera shake and beam intensity; loudness = bokeh brightness.
- Build: additive bokeh discs, beam cones (reuse `godrays` geometry), shaky camera.
- Effort M. Perf low–medium. Closest to `godrays`; kept because of the bokeh street scene and shake.

**11. Pong Orbs** (`pongOrbs`) — ref 11, viuta "Obsessive"
- Look: glass bubbles of different sizes in a dark frame; **small bright orbs emit conical prism beams** (with RGB fringes) that travel across to a big bubble; the big bubble glows pink with internal reflections and comet streaks, and on a beat flashes into a white veined plasma-ball before returning to a clear rim.
- Audio: impact = collision flash and plasma burst; bass = sphere pulse; highs = ray count and dispersion.
- Build: 2D physics for circles on the CPU, screen-space shader for rays and rim.
- Effort M. Perf low.

### Group 2: Need models (procedural fallback first)

**2. Temple Descent** (`templeDescent`) — ref 2, brightraven3d "Funk Universo"
- Look: **mostly near-black**; light arrives in bursts. A square shaft of carved stepped tiers climbs to a bright rectangular opening; teal-green haze, falling dust specks, soft god-ray from above. A beat can flip the whole shaft to a hot orange/red grade with a hard sun flare, then fall back to dark teal. Camera is a slow tilt/drift up the shaft, not a travel.
- Audio: impact = the reveal flash (shaft lights up for ~0.3 s, optionally orange grade); bass = god-ray intensity; loudness = dust density; between beats the scene sinks to almost black (a vignette fade, not a hard cut).
- Build: Kit B stacked along Y; fake volumetric shafts with additive cones; dust points. Fallback: procedural stepped boxes with a tiled normal map.
- Effort L (with kit), M (fallback). Perf medium.

**8. Underground** (`underground`) — ref 8, bambooproductions_ "Underground"
- Look: camera looks down (or sideways along) a concrete wall with **repeating round porthole openings**; through them a lit **train carriage** crosses. Neon concentric rings flash on in a hatch; sparks spray; grey fog; periodic blackouts. It tumbles slowly and cuts between angles.
- Audio: impact = ring flash, spark burst and a camera cut; bass = carriage speed and rumble shake; loudness = fog brightness.
- Build: Kit A shaft ring, rails, carriage; point sparks; fixed spot plus emissive windows. Fallback: cylinder and boxes.
- Effort L. Perf medium.

**12. Light Painting Forest** (`lightForest`) — ref 12, jieliouart / dullscythe (a 10-slide carousel, so this is one of several looks)
- Look: night forest and meadow shots; **white wireframe light sculptures** (two hummingbirds, a chair, a crescent moon on a post, a bird in flight, a hoop) materialise from nothing, flare to full white for a few frames, then dim and vanish. Between sculptures it is near-black foliage, sometimes with slanted god-rays.
- Audio: impact = the next sculpture draws in (ghost, then full white flash, then fade); bass = bloom; loudness = fog and god-ray strength. Sculptures are pre-authored line meshes (see Kit C: add 5 wireframe sculptures).
- Build: Kit C foliage; sculptures as animated line geometry (reuse epicycle trail code). Fallback: alpha-card ferns and grass.
- Effort L. Perf medium.

**13. Red Stairwell** (`redStairwell`) — ref 13, zoondzn "Flashback" (Cinema 4D)
- Look: **tilted, shaky camera** through a derelict red-lit interior: large **diagonal pipes**, vents and railings, red haze/smoke, hot red window glow that flares and drops back to black. Strobes between near-black and saturated red.
- Audio: impact = strobe flash; bass = light intensity; loudness = camera speed.
- Build: Kit A stairs/rails/windows; single red light rig and strobe; camera on a spline. Fallback: boxes.
- Effort L. Perf medium.

**14. Warehouse Hall** (`warehouseHall`) — ref 14, angryburd4234 "warehouse audio visualizer"
- Look: locked-off, centred view of a long corridor with square pillars, floor rails and wall lights; the left side wall holds **red panel lights that flash**, the main grade cycles amber → red → cold grey-white; it drops to near-black between hits and slowly pushes in.
- Audio: bass = light intensity; impact = colour cycle step and blackout flicker; loudness = camera speed.
- Build: Kit A pillars, panels, light fixtures; repeated bays for infinite corridor.
- Effort M–L. Perf low–medium.

## Shared work

1. **`GlbKit` loader/cache**: load a `.glb`, hand out clones, dispose with the mode. Falls back silently to the procedural version if the file is missing, so tests and CI pass without assets.
2. **Cinematic interior rig** (modes 2, 8, 13, 14, 3): fog, one audio-driven light rig, camera spline with shake, strobe with `reducedFlash` handling. Built once, reused five times.
3. **Bilateral light module** (5, 6): shared SDF/ray helper.
4. All modes must honour `reducedMotion`, `reducedFlash`, and the quality budget, and register in `registry.ts` under a new `waveThreeModeDefinitions` (`id`, `label`, `output`, `backends`), then be added to `modeDefinitions`.

## Suggested build order

1. Shared rigs (items 2–3 above) plus modes 6, 5, 11 (cheapest, quick wins).
2. Modes 1, 7, 4, 3.
3. Modes 9, 10.
4. Asset loader, then modes 14, 13, 8 as Kit A lands.
5. Modes 12, 2 as Kits C and B land.

## Testing

Follow existing practice: registry/unit test per mode (creates, updates over silent and loud frames, disposes without leaking), the existing Playwright mode-review screenshots at both backends, and a benchmark pass per quality tier. Modes needing assets get an extra test that runs with the fallback.

## Open questions (set 1; superseded by the consolidated list at the end)

1. Are all 14 wanted, or should the group-2 (asset) modes wait until models exist? I'd ship group 1 first regardless.
2. #12 is a carousel of 10 looks. Do you want the forest only, or should I review the other slides?
3. You mentioned this is "the first set". I'll append further sets as new sections rather than a new file unless you prefer otherwise.

---

# Set 2: 15 more reference clips (modes 15–29)

Same method and caveats as set 1: contact-sheet review, audio mappings are proposals. Per your note, **every mode below has a full spec including the model-dependent ones. We create no models; you do.** Model-dependent modes list exactly what to make. Each also ships a procedural fallback so engineering is never blocked.

## Duplicate check (set 2)

No exact duplicates. Overlaps to know about:

| New | Overlaps with | Verdict |
|-----|---------------|---------|
| 29 Grain Smoke (leovann "type g") | 1 Mirror Plasma (same artist, same engine family) | Different look (monochrome, film grain, glitch streaks). **Could be a preset of #1**; I spec it as its own mode. Your call. |
| 26 Liquid Chrome (vjdzhezus) | `inkMarble`, `metaballs`, `ferrofluid` | Closest set. Differs by being a reflective black-chrome sheet with environment-map flares, not thin-film bands or blobs. Lower priority; merge-or-skip candidate. |
| 27 Candy Orb (pixel.flux) | `eventHorizon`, `vjRings` | Soft glass-lens disc with a rainbow gradient and dark core; no lensing or rings. Distinct enough. |
| 25 Ember Smoke (drmadness3d) | `inkMarble`, `fireworks` | Volumetric billowing fire smoke with ember dust; different look and motion. |
| 15 Hair Vortex | `eventHorizon`, `starTunnel` | Dense radial filament field with a spiral wave; different. |

Two clips (**17 Canopy Sway**, **16 Windfield**) are *real footage*, not visualizers. They are specced as stylised procedural scenes (no photoreal pretence).

## Additional modelling needs (you create; we don't)

Format as before: .glb, Y-up, 1 unit = 1 m, origin at base, one PBR atlas per kit (≤2048², baseColor+normal+ORM), emissive parts as separate material slots, no animation unless stated. Priority order at the end.

- **Kit D (superseded by 2D layers, see asset brief §2D-3):** was a 3D cathedral hall; now a layered matte painting.
- **Kit E (superseded by 2D layers, see asset brief §2D-2):** was a 3D utility pole; now a layered illustration.
- **Kit F (superseded by 2D layer, see asset brief §2D-1):** was a 3D hand plus foliage; now one hand PNG, foliage procedural.
- **Kit G: Lava golem (mode 19 Lava Golem)**: hulking stone golem, ~8–12k tris, T-pose or hunched idle, with **emissive crack texture or separate emissive mesh layer**, split into body parts (torso, head, 2 arms, 2 legs) so we can drive them procedurally without a skeleton. Plus a small ember rock for the ground (optional).
- **Kit H: Stair/scaffold kit (mode 21 Endless Stairs)**: straight stair flight with stringers, half-landing, scaffold tube (straight, 2 lengths), scaffold clamp, handrail, floor plate, wall-mounted light strip (emissive). 100–500 tris each. Overlaps Kit A stairs; if Kit A stairs get built first, add only tubes and clamps.
- **Kit I: dropped.** `starfallCanopy` is fully procedural.
- **Optional, low priority: Car (mode 22 Film Burn)**: one 80s-style coupe, ≤6k tris, headlights as emissive slots. The mode works fine without it.

## Modes

### Group 3: Procedural, no modelling

**15. Hair Vortex** (`hairVortex`) — "Calm Noise" clip
- Look: saturated blue; ~hundreds of thousands of **fine radial filaments around a fixed black eye**, and **one dense spiral arm of tiny bright particles** sweeping around the eye like a comet; breathing, calm. Text overlays in the reference are not part of the visual.
- Audio: bass = filament length and eye size; the arm sweeps with tempo and sheds particles on impact; loudness = brightness; the calm preset keeps sudden changes small.
- Build: instanced hair-lines in a ring (≈200k), spiral density wave in the vertex shader. Fullscreen-friendly.
- Effort M. Perf low–medium.

**16. Windfield** (`windfield`) — Mongolia grass clip
- Look: locked camera at grass height: billowing white cumulus clouds that **grow like a time-lapse** over a green meadow; wind rolls across the grass in broad bright and dark waves.
- Audio: bass = gust strength and camera dolly; loudness = grass lean; impact = a gust front crossing the field; highs = tip shimmer.
- Build: instanced blade strips (≈400k) with TSL wind (3-octave noise advected by gust); sky gradient plus a few billboard cloud sprites or fullscreen cloud shader. No assets.
- Effort M. Perf medium.

**23. Anamorphic Flare** (`anamorphicFlare`) — bnsh_av "home"
- Look: black field; a white-hot centre with **a long horizontal anamorphic streak and thin vertical fibres** (long curved threads hanging up and down the central axis), chromatic fringes that spread into rainbow wings at peaks; sensor-noise speckle band along the horizon.
- Audio: bass = core size and speckle sphere radius; impact = explosion and a streak flash (respect `reducedFlash`); highs = fibre count; loudness = streak length.
- Build: ~150k points plus streak quads, RGB offset in the shader.
- Effort M. Perf low–medium.

**24. Light Leak Film** (`lightLeakFilm`) — redblueen "Heading to the edge" (no car required)
- Look: alternates between two shots: a dark car rear with a **smeared orange taillight and scratchy orange light at the frame top**, and a **blown-out warm, cloud/heart-shaped light blob** with **vertical scratch lines** and two small headlights. Heavy grain and a dark teal wash. Cuts on beats.
- Audio: impact = leak flash and cut; bass = leak size; loudness = scratch density; fixed film grain and a slight gate weave.
- Build: fullscreen shader with procedural grain, scratch lines, light-leak SDF blobs and a vignette.
- Effort S–M. Perf very low. Optional car (Kit above) parked in frame.

**25. Ember Smoke** (`emberSmoke`) — drmadness3d "Come check this"
- Look: black-red void; it begins as a **sphere of glowing particles** and reshapes into billowing volumetric lumps (stacked blobs, a hollow ring, face-like forms) lit orange with white-hot cores, fine ember dust everywhere.
- Audio: bass = smoke expansion and white-hot core; impact = new silhouette formation; loudness = ember density; highs = ember sparkle.
- Build: fullscreen raymarch of a domain-warped density (≈24 steps), shapes via SDF union morphing per beat; ember points. 
- Effort M. Perf medium. GL2 fallback uses fewer steps.

**26. Liquid Chrome** (`liquidChrome`) — vjdzhezus — **approved to build**
- Intent (yours): like Ink Marble, but each region behaves as its own **liquid blob** that visibly moves, merges and splits, where Ink Marble only pulses in place.
- Look: black glossy liquid-glass sheet. The surface is a field of **soft-body blobs** (8–14) that drift, collide and fuse with a smooth-min, each with razor iridescent edge highlights (orange, white, blue). Where two blobs meet a bright seam forms, then pinches off into droplets. Palette flips per section (orange, blue, magenta); quiet sections drain to a few floating droplets in black.
- Audio: bass = blob radius and push strength; impact = blobs get a velocity kick away from the hit point and the palette flips; loudness = highlight width; mids = merge threshold (higher = more fusing); highs = edge sparkle.
- Build: fullscreen shader, **metaball height field with per-blob velocity integrated on the CPU** (blobs are 2D discs with spring-back and collision), normal from the field gradient, studio-softbox environment for reflections, thin-film tint at grazing angles. This separates it from `inkMarble` (domain-warped noise, nothing moves independently) and from `metaballs` (3D raymarch of chrome spheres): here blobs carry momentum and the sheet is seen flat from above.
- Effort M. Perf low–medium.

**27. Candy Orb** (`candyOrb`) — pixel.flux "candy"
- Look: a glowing lens-like disc with an **off-centre dark hole and a bright rim**, fine **concentric groove texture** and a sliding rainbow caustic; the palette flips between orange/red, teal-blue, and pastel iridescent.
- Audio: bass = core size and rim thickness; impact = palette flip and swirl pulse; loudness = bloom; mids = swirl speed.
- Build: fullscreen shader, polar domain-warped gradient with a thin-film LUT.
- Effort S–M. Perf low.

**29. Grain Smoke** (`grainSmoke`) — leovann "type g"
- Look: monochrome and very grainy: a powdery vertical **column of smoke** with horizontal glitch lines and vertical light spikes, which on peaks opens into a **veined translucent sphere shell** (like a soap-bubble or lunar surface), then collapses back to the column.
- Audio: bass = column width; impact = ring burst and glitch tear; loudness = grain brightness.
- Build: shares the particle engine with #1; mono tone-map, grain pass, line-tear post. Could instead be a preset of #1 (your call).
- Effort S–M (if sharing #1). Perf low–medium.

**30. Silk Threads** (`silkThreads`) — stupe777
- Look: black space with a vertical column of thin iridescent filaments; on peaks a **branching white lightning-like thread** runs down the column with rainbow side-threads and a starburst of dust points; it fades to a faint tangle between hits.
- Audio: bass = filament count and brightness; impact = the white lightning thread strikes down the column; loudness = side-thread thickness; highs = dust twinkle.
- Build: line ribbons on curl-noise paths (≈800 strands × 64 segments), chromatic offset in screen space, additive blend.
- Effort M. Perf low–medium. Shares the curl field code with #1.

### Group 4: Need your models (procedural fallback ships first)

**18. Bloom Touch** (`bloomTouch`) — shanef3d "Singularity"
- Look: anime cel-shaded **hand pointing, held nearly static**, red rim light on a black stage; a glowing sprout at the fingertip grows into a bush, then a large flower wreath around the fingertip, then a vine arc, then a green spark burst, and the cycle resets. Leaves are flat-shaded with a glow rim.
- Audio: impact = a new growth burst from the fingertip; bass = leaf scale; loudness = firefly density; the growth path follows the music's section changes.
- Build: one static hand PNG (RGBA, see asset brief §2D-1) with a glow rim shader; growth driven along spline arcs from the fingertip with instanced leaves and flowers. Fallback: a glowing fingertip point and procedural leaf quads.
- Effort L (with kit), M (fallback). Perf medium.

**19. Lava Golem** (`lavaGolem`) — drmadness3d & itsrickyrombo VJ loop
- Look: a grey stone golem with glowing red veins, doing a **lumbering stomp/crouch loop** in a spotlight cone, on a field of glowing embers that jump when it lands; dark cave and fire in the back. (The reference is a VJ loop; the DJ-booth photo around it is not part of the visual.)
- Audio: bass = chest crack glow and stomp bob; impact = fist slam and ember burst; loudness = ember glow; mids = head turn.
- Build: Kit G, parts driven procedurally (springs), emissive pulse, instanced embers. Fallback: stacked hex-rock primitives with emissive seams.
- Effort L. Perf medium. Clip is a VJ loop; that's the intended look.

**20. Pole Sparks** (`poleSparks`) — zleestudio_ lofi animation
- Look: flat **2D anime illustration** of a tangled utility pole against a grey-teal dusk; bright pink pulses run along wires like bullets, spark clusters flash at junctions, two heart-shaped lights blink on the boxes. Camera is locked.
- Audio: impact = a pulse shoots along a random cable; bass = heart lights pulse; loudness = spark rate; slow camera drift.
- Build: layered illustration PNGs (see asset brief §2D-2) with pulses as moving gradients along authored cable paths (a mask or SVG path per cable). Fallback: procedural pole and catenary cables.
- Effort M–L. Perf low.

**21. Endless Stairs** (`endlessStairs`) — drmadness3d
- Look: looking down a deep shaft of **thin scaffold rods** crossing in every direction with angular stair flights; the grade steps through **cyan, green, magenta, blue**, blacking out between; tiny neon strip fragments fly past; at the bottom a blown white light with a star flare.
- Audio: impact = colour flip and light strip flash; bass = fall speed; loudness = fog glow.
- Build: Kit H repeated and tumbled in a loop, scaffold tubes instanced, camera path with roll. Fallback: boxes and cylinders.
- Effort L. Perf medium. Shares the interior rig with set 1 modes 8/13/14.

**22. Film Burn Car** — merged into #24 as an optional car prop (no separate mode).

**28. Red Crystal Hall** (`redCrystalHall`) — moxieartco "The source"
- Look: a vast dim hall with a colossal hanging red crystal at its centre; glowing cracks and an inner glow that pulses; cables sag around it; three hooded figures kneel at the base; red mist on the floor. **The camera is locked off** (no push-in).
- Audio: bass = crystal glow and crack brightness; impact = shock ring on the floor and a flare; loudness = fog height.
- Build: layered matte painting (see asset brief §2D-3) with parallax, procedural faceted crystal (emissive interior, additive crack lines), red mist sprites. Fallback: octagonal box hall and cylinder pillars.
- Effort L. Perf low–medium.

**17. Starfall Canopy** (`starfallCanopy`) — reworked from the pine-canopy clip (your direction)
- Look: **night**. A black overlay replaces the blue sky so everything pops: a low-angle view up through silhouetted pine trunks and needle clusters against a deep-black sky full of stars. Needle clusters sway; **stars twinkle and shine** and occasional ones bloom with a small diffraction cross; **shooting stars** cross the sky, and on big drops a **star storm** (a burst of 20–60 streaks) sweeps across in one direction.
- Audio: bass = canopy sway amplitude; loudness = overall star brightness and twinkle rate; highs = star sparkle; impact = a single shooting star; a sustained loud passage or drop = a star storm (rate-limited, one per ~8 s). Between hits it stays calm and dark.
- Build: instanced silhouette trunks (tapered cylinders) and alpha needle cards with vertex-shader sway (no models required); stars as a 3–5k point field with per-star twinkle phase and three size tiers; shooting stars as additive streak quads with a fading trail; a faint moon-glow gradient behind the trees so the silhouettes have an edge. All procedural, so Kit I is dropped.
- Effort M. Perf low.

## Modelling priority (all sets combined)

1. **Kit A (industrial)** — set 1 modes 8, 13, 14; also helps 21 and 28.
2. **Kit H (stairs and scaffold)** — mode 21 (or fold into A).
3. **Kit G (lava golem)** — `lavaGolem`, the most striking asset.
4. **Kit H (stairs and scaffold)**, then Kit C and Kit B.
5. (2D layers instead of Kits D, E, F; see asset brief.)
6. Optional: 80s coupe for `lightLeakFilm`.

Fallbacks make every mode shippable first, so none of this blocks the plan.

## Suggested build order for set 2

1. Quick shader wins: 27 Candy Orb, 24 Light Leak Film, 23 Anamorphic Flare, 15 Hair Vortex.
2. Shared curl/particle engine from set 1 #1, then 30 Silk Threads and 29 Grain Smoke.
3. 25 Ember Smoke, 16 Windfield, 26 Liquid Chrome (last).
4. Asset modes (17–21, 28) as kits arrive.

## Decisions (resolved)

1. `grainSmoke` ships as its own menu entry built on the `mirrorPlasma` engine as a preset.
2. `liquidChrome` is approved, redefined as moving liquid blobs (see its section).
3. `canopySway` becomes `starfallCanopy`: night sky, swaying silhouettes, twinkling stars, shooting stars and star storms.
4. `bloomTouch`, `poleSparks`, `redCrystalHall`: **2D layers (PNG), not 3D**. From the clips: Pole Sparks is a flat anime illustration with a locked camera, so a layered illustration is the true look; Red Crystal Hall has a locked-off camera, so a layered matte painting with parallax plus a procedural crystal reads the same as a 3D hall at a fraction of the work; Bloom Touch holds one static cel-shaded hand pose while procedural foliage does the moving, so one hand PNG with a glow rim is enough. 3D only pays off if the camera should move in those scenes later.
5. Batches: **4a** = procedural modes (all "no" rows in the index, including `starfallCanopy` and `grainSmoke`); **4b** = modes that need art assets (3D kits or 2D layers).
6. Asset formats and per-kit requirements: see `2026-10-24-wave-four-model-asset-brief.md`.
7. Animation: only two assets are animated. The **lava golem** uses a skinned skeleton with baked `idle`, `stomp`, `slam` and `turn` clips, blended on beats; the **wireframe birds** use a `wings_down` morph target driven by the music. Everything else ships static and is animated in code. Details in section 6 of the asset brief.


---

# Appendix: build parameters per mode

**How to use this appendix.** Each block gives the references to open first, a palette, starting numbers, the hit-variant sequence and a done-when line. Numbers are **starting values to tune by eye against the references**, not measurements, except the "mean luma" targets, which were measured from the clips (0–255 scale, averaged over the whole clip including dark gaps).

**References:** `docs/superpowers/specs/reference/<modeId>_*.jpg`
- `_keyframes.jpg`: three large frames, the clip's brightest moment, a middle moment and a dark moment. Open this first.
- `_hit-burst.jpg`: 30 frames at 10 fps around the strongest hit (about 3 s), showing how it attacks and decays.
- `_overview.jpg`: 30 frames spread over the whole clip, showing the variety.
Image top bars and right-side icons are phone UI, not part of the visual. Ignore any text overlays.

**Conventions used below.** `hit` = a trigger from `response.impact` (attack within 1 frame, decay time given per mode). Counts are `high / balanced / low` quality tiers. "Luma" is mean frame brightness. All fast modes obey the pacing rules and flash limits in the Pacing section. Colours are sRGB hex before bloom.

## 4a: procedural modes

### mirrorPlasma
- Refs: `mirrorPlasma_*`. Mean luma 30; floor between hits 3–6.
- Palette: cyan `#2EF2FF` core, orange `#FF8A3D`/`#E0572B` filaments, green `#3CFF7A`, blue `#3A4BFF`, magenta `#FF3FD0`.
- Counts: 300k / 150k / 60k points; mirror in X and Y.
- Hit decay: 220 ms. Hit rate about 1.6/s.
- Hit-variant sequence (cycle, never repeat): A green-cyan slabs with orange filaments, B cyan star burst with long rays, C magenta butterfly silhouette, D blue/purple wing pair, E collapse to a single point then re-bloom as A.
- Between hits: fade to 5% brightness over 250 ms, shape persists as a faint ghost.
- Done when: the three keyframes read as the same family (symmetric, point-built, palette stepping) and a hit visibly swaps the silhouette, not just the brightness.

### grainSmoke (preset of mirrorPlasma engine)
- Refs: `grainSmoke_*`. Mean luma 49.
- Palette: monochrome white `#F2F2F2` on `#050505`; add 8% blue tint on peaks.
- Same engine, different preset: no colour, single vertical column (width 6% of frame), heavy film grain (amplitude 0.12, per-frame random), horizontal glitch tear lines (1–3 per hit), vertical light spikes.
- Hit rate 1/s. Hit variants: column flare, tear glitch, opens into a veined translucent sphere shell (radius 35% of frame, 1.2 s), collapse.
- Done when: the sphere shell moment and the grainy column both read like the keyframes.

### blackMaze
- Refs: `blackMaze_*`. Mean luma 10 (very dark); floor 2.
- Palette: monochrome concrete `#6B6B70` at full reveal, ambient `#0A080C`.
- Scene: fixed top-down orthographic camera, maze 9×9 cells, walls raised with bevel, concrete texture with grime.
- Light: one rectangular spotlight window (size 12–35% of frame) with soft edges, snaps to a new position per hit (never the same cell twice); every 4th hit is a full-maze reveal at 60% brightness for 120 ms.
- Hit rate 1.2/s, decay 180 ms.
- Done when: matching the `_keyframes` (full reveal, dim ghost, small window).

### chromeStreaks
- Refs: `chromeStreaks_*`. Mean luma 25.
- Palette: greyscale; highlights `#FFFFFF`, body `#2A2A2E`, fog `#0E0E10`.
- Counts: 6–10 glass/black spheres (some with fur), 1,500 / 900 / 400 curved fibres, 4k / 2k / 800 sparkle points.
- Hit: camera whip-zoom forward 1.5 s⁻¹ with long streaks (stretch factor 20×) for 250 ms, sparkle flare. Hit rate about 1.5/s.
- Between hits: calm, fibres swaying with bass; fog dims.
- Done when: the whip-zoom streak rush and the calm web of fibres both match.

### prismBowtie
- Refs: `prismBowtie_*`. Mean luma 16; floor 2.
- Palette: pink `#FF5CD6`, white `#FFF`, red `#FF2A3C`, blue `#4A5CFF`, green fringe `#3CFF8A`; dark `#08020C`.
- Four-way mirror, rays from the centre (28–60 rays), LED dot-grid texture on the rays (dot pitch 6 px at 1080p), RGB dispersion 3–6 px.
- Hit rate 3.3/s, decay 150 ms. Variants: thin X (idle) → pink blow-out with panel grid → rainbow fan → red fan with white core → dark blue arches visible behind.
- Done when: idle is a thin X, hits blow out to pink-white with dots and rainbow fringe, then drop to near-black in under 200 ms.

### blockBowtie
- Refs: `blockBowtie_*`. Mean luma 6.5 (mostly black).
- Palette per hit, cycling: magenta `#FF2BD6`, green `#35E010`, red `#E5192B`, blue `#0B1E8F`, orange `#FF6A00`, purple `#8A22C8`.
- A mirrored block silhouette 18% of frame wide, re-cut every hit (random polygon from 6–10 columns with mirrored heights from the spectrum), soft bloom radius 8% of frame.
- Hit rate 1.5/s, decay 200 ms. Never repeat a colour twice in a row.
- Done when: it looks like a coloured butterfly/bow-tie in black space that changes shape and colour each beat.

### moonPond
- Refs: `moonPond_*`. Mean luma 64.
- Palette: water `#16141C`, ripples magenta `#E02BD6`, blue-cyan `#4D6BFF`, glints white.
- Height-field 512×512, 1–6 live ripples, ripple speed 0.35 screen/s, decay 2.5 s, glitter = dotted lines (dot pitch 4 px) lit only on wave crests facing the "light".
- Impact: new ripple at a seeded point near the lower middle; colours alternate magenta / blue per hit. Rate under 1/s.
- Done when: dotted glittering crests in two alternating colours over near-black water.

### beaconRings
- Refs: `beaconRings_*`. Mean luma 59.
- Palette: rings `#FF6A4A` with white core `#FFE8D8`, rock `#2A0A06` to `#8A2A18`, embers `#FFD0A0`.
- Camera inside a ridged-rock cave (procedural noise, 3 octaves). Ring stack 12 / 10 / 8 rings, line width 4 px at 1080p, glow 12 px.
- Sequence over a loop of ~12 s: single red dot → small tilted ring → grows to fill frame → tilts into fans of parallel arcs → collapses to a blade → flips to a different tilt. Each impact advances the sequence; bass sets ring radius.
- Embers: 6k / 3k / 1.2k points riding the rings.
- Done when: the dot-to-rings growth and the fan-of-arcs frame both match.

### signalNight
- Refs: `signalNight_*`. Mean luma 30; floor 6.
- Palette: teal night `#0F2630`, signal heads dim red `#5A1812`, beams green `#7CFF4A`, amber `#FFB02E`, red `#FF3A2A`, white `#FFF0DC`.
- 3–6 moving-head beams (cones, horizontal motion-smear 80 ms), traffic-signal silhouettes in soft focus, handheld shake (amplitude 6 px, 8 Hz).
- Hit rate 2.2/s, decay 200 ms. Variants: green sweep, amber/red mixed sweep, all white, grade flip to deep red, then to blue-teal; scene dark between.
- Done when: beams sweep with smear over soft-focus signals, and the grade flips between teal and red.

### pongOrbs
- Refs: `pongOrbs_*`. Mean luma 9.
- Palette: pink `#FF3FA0`, white, dark red `#6A0F2A`, rim white; prism rays R/G/B.
- 3 orbs (radius 2.5%, 5%, 18% of width), bounce off the frame edges; small orbs emit conical rays (opening angle 28°) toward the big orb; glass rim 2 px; internal reflections.
- Every 4th hit: the big orb flashes to a white plasma ball with veins (3–4 frames) then back.
- Hit rate 2.9/s, decay 160 ms.
- Done when: the white veined plasma flash and the clear dark glass orb both read.

### hairVortex
- Refs: `hairVortex_*`. Mean luma 43.
- Palette: blue `#1530FF` filaments on `#02041A`, arm particles `#6FA8FF`; calm preset, no hit flashes above 20% luma jump.
- 220k / 120k / 50k radial filaments, eye radius 10% of frame, one spiral arm of dense bright particles rotating at 0.25 turn/s.
- Audio: bass lengthens filaments (+20%), tempo sets arm speed; no hard cuts.
- Done when: radial hair texture with a black eye and one bright spiral arm, calm.

### windfield
- Refs: `windfield_*`. Mean luma 137 (bright daylight).
- Palette: sky `#2E86C1`, cloud white `#F4F6F8` with grey underside `#C8D0D8`, grass `#3E8C2A`/`#7EC850`.
- 400k / 200k / 80k blades, cumulus cloud shader growing slowly (time-lapse, 0.02 scale/s), gust waves crossing the field every 2–5 s.
- Audio: bass = gust strength, loudness = lean, highs = tip shimmer; no hard cuts.
- Done when: it reads as a windblown meadow with rolling gust waves under billowing clouds.

### anamorphicFlare
- Refs: `anamorphicFlare_*`. Mean luma 17.
- Palette: white-hot `#FFFFFF`, fringes cyan `#6FD8FF`, orange `#FFB070`, green `#9AFFB0`; speckle `#BBBBBB`.
- Horizontal streak length 90% of width, vertical hair fibres 40% of height, 150k / 80k / 30k points, chromatic fringe 5 px.
- Hit rate under 1/s, decay 260 ms. Hit: streak flares, speckle sphere radius 12% bursts, then fibres drift.
- Done when: a horizontal anamorphic streak with vertical fibres and rainbow wings on hits.

### lightLeakFilm
- Refs: `lightLeakFilm_*`. Mean luma 40.
- Palette: orange `#FF8A2B`, warm white `#FFE9B8`, dark wash `#0C0A10`, teal tint `#0E2A30`.
- Film grain amplitude 0.10, scratch lines (1–3 px, vertical), gate weave ±2 px, vignette.
- Two alternating shots: (A) dark car rear with smeared orange taillight and scratchy orange light at the top, (B) blown-out warm cloud/heart blob with scratches and two small headlights. Cut on hits at 1.3/s.
- Optional `coupe.glb` for A. Done when: the cut between A and B with heavy grain looks like the references.

### emberSmoke
- Refs: `emberSmoke_*`. Mean luma 91 (it is bright).
- Palette: orange `#FF5A2E`, white-hot core `#FFE9D0`, deep red `#3A0A06`, embers `#FFB080`.
- Raymarched domain-warped density, 24 / 16 / 10 steps, forms morphing between sphere, stacked blobs, hollow ring, two-lobe; 30k / 15k / 6k ember points.
- Hit rate 0.2–1/s. A hit morphs to the next shape over 400 ms; bass swells density.
- Done when: it starts as a particle sphere and reshapes into glowing volumetric lumps.

### liquidChrome
- Refs: `liquidChrome_*`. Mean luma 40.
- Palette sets (flip per hit): [orange `#FF7A1A`, white, blue `#3A66FF`], [deep blue `#1A2CC8`, cyan `#5AD0FF`], [magenta `#FF3FB0`, orange, violet `#7A3CFF`]; base black `#050507`.
- 8–14 blobs (radius 6–20% of frame), each with position, velocity, spring-back to a wander target, pairwise collision; metaball field smooth-min k=0.12; reflection from a studio-softbox environment; thin-film tint at grazing angles.
- Hit: kick each blob's velocity away from a random point by 0.4 screen/s; pinch-off droplets (4–10) at seams; palette flips. Hit rate about 2/s.
- Done when: blobs visibly drift, fuse and split, with the razor-edge highlights from the keyframes.

### candyOrb
- Refs: `candyOrb_*`. Mean luma 56.
- Palette sets (flip per hit): warm [`#FF8A1E`, `#FFD36A`, `#E0301E`], teal [`#4D9BFF`, `#9AF0D0`, `#FFD56A`], iridescent pastel.
- Disc radius 38% of frame height, off-centre dark hole radius 9–14%, fine concentric grooves (60–90 rings), rainbow caustic sliding around the rim at 0.15 turn/s, bloom.
- Hit rate about 1/s, flips palette and kicks the hole position ±6%.
- Done when: it looks like a glowing lens/bubble with an off-centre dark hole and grooves.

### silkThreads
- Refs: `silkThreads_*`. Mean luma 30; floor 3.
- Palette: filaments `#B9C6FF` with RGB dispersion (cyan, magenta, yellow edges); lightning thread `#FFFFFF`; dust `#FFFFFF`.
- 800 / 500 / 250 strands × 64 segments, curl-noise paths, bokeh dust 3k / 1.5k / 600 with 4-point starburst flares.
- Hit rate 2.6/s, decay 180 ms. Hit: white thread strikes down the column (branches with rainbow side-threads); between hits only a faint tangle.
- Done when: the lightning-like white strike with rainbow branches and a faint tangle between hits.

### starfallCanopy
- Refs: `starfallCanopy_*` show the **daylight source**; our version is **night**. Use them only for the framing (low angle, trunks leaning outward, branches filling the top). Mean luma target 8.
- Palette: sky `#02030A`, trunks and needles silhouette `#000000` with a faint rim `#0E1830`, stars `#FFFFFF`/`#BFD4FF`/`#FFE3B0`, moon glow `#0A1226`.
- 3–5k stars (3 size tiers), twinkle rate 0.5–3 Hz per star, 8–12 bright stars with a diffraction cross; trunks 14 / 10 / 6; needle cards 400 / 250 / 120 with vertex sway (amplitude 0.6° at idle, 3° on loud).
- Shooting star on a hit (length 15–30% of frame, 0.5 s); star storm on a sustained drop: 20–60 streaks over 2.5 s, one direction, max one per 8 s.
- Done when: black silhouetted canopy against a dense twinkling sky, with shooting stars and an occasional storm.

## 4b: modes that need art assets (fallback numbers apply until assets arrive)

### templeDescent
- Refs: `templeDescent_*`. Mean luma 42; floor 8.
- Palette: teal haze `#123A40`, lit stone `#B6E8D0`, hit grade red `#C0301E`/orange `#FF7A2A`, dust `#D8F0E8`.
- 4–6 stacked tier blocks (Kit B) receding upward; opening slab at the top with a bright square (luma 85% at peak).
- Cycle: dark teal (3 s) → lit reveal of the stone tiers (0.8 s) → dark → red-grade slam with sun flare (0.4 s). Hit rate about 1/s. Dust 1.5k / 800 / 300 points drifting down.
- Fallback: stepped boxes with a tiled normal map.
- Done when: the teal-dark, lit-reveal and red-grade frames in the keyframes all appear.

### underground
- Refs: `underground_*`. Mean luma 11.
- Palette: concrete `#34343A`, dark `#0A0A0C`, ring neon white `#FFFFFF`/magenta `#FF3FA0`, window `#FFB060`, sparks `#FFB060`.
- Camera looks along a vertical concrete wall with round hatches; tram carriage with lit windows crosses behind a hatch; neon concentric rings in a hatch; sparks 600 / 300 / 120.
- Hit rate 3.7/s (cuts angle: 0°, 90°, 180°); blackout 2–4 frames between some cuts.
- Fallback: cylinder hatches in a box wall. Done when: porthole wall, tram in a hatch, neon ring flash and spark spray all appear with fast cuts.

### lightForest
- Refs: `lightForest_*`. Mean luma 9.
- Palette: forest `#050806` with greens `#1A3A20`, sculptures `#FFFFFF`, god-ray `#8FB8A0`, blue bokeh `#6FA8FF`.
- Sculptures from Kit C (hummingbirds, chair, moon, bird, hoop): ghost 40% → full white flash 3 frames → fade 400 ms. Rate about 1.5/s, one sculpture at a time.
- Fallback: procedural line shapes. Done when: white line-art sculptures flash and fade in near-black foliage.

### redStairwell
- Refs: `redStairwell_*`. Mean luma 8.5.
- Palette: black `#050202`, crimson `#E0140C`, hot red `#FF3A1A`, haze `#4A0A06`.
- Tilted camera (roll ±15°) with shake, diagonal pipes and railings (Kit A), red haze volume; strobe between 3% and 70% brightness.
- Hit rate 1–2/s, decay 120 ms. Fallback: boxes and cylinders.
- Done when: red strobe reveals pipes and railings then drops to near-black.

### warehouseHall
- Refs: `warehouseHall_*`. Mean luma 4 (darkest).
- Palette: amber `#FF8A30`, red `#E0140C`, cold white `#C8D0D8`, dark `#030202`.
- Centred one-point-perspective corridor with square pillars, floor rails, wall lights; light cycles amber → red → cold white; blackout frames (luma under 2) between; slow push-in 0.15 m/s.
- Hit rate 1.8/s. Fallback: boxes. Done when: the amber/red/white cycle with blackouts matches the keyframes.

### lavaGolem
- Refs: `lavaGolem_*`. Ignore the DJ photo frames; only the golem on embers matters.
- Palette: stone `#707078`, cracks `#FF2A1A`, embers `#FF7A2A`/`#FFB060`, dark `#0A0508`.
- Golem animated per the asset brief (idle, stomp, slam, turn), spotlight cone from above, 4k / 2k / 800 ember particles on the floor that jump 30 cm on a stomp.
- Hit: play `stomp`/`slam` alternately; cracks brighten to 100% for 150 ms. Rate about 1/s.
- Fallback: stacked rocks, bass-driven bob. Done when: the golem lands a stomp on the beat with embers jumping.

### endlessStairs
- Refs: `endlessStairs_*`. Mean luma 58 (bright flashes).
- Palette per hit, cycling: cyan `#3EE0FF`, amber `#FFA830`, blue `#2A44FF`, green `#7CFF3A`, magenta `#FF2AB0`, white flare `#FFFFFF`; dark `#020308`.
- Camera looking straight down a shaft of scaffold tubes and stair flights, falling at 6 m/s with roll 20°/s; neon strip fragments (80 / 40 / 20) fly past; bright white light at the bottom.
- Hit rate 3.5/s; blackout of 2–4 frames between some hits; never repeat a colour twice.
- Fallback: boxes and cylinders. Done when: the colour-stepping falling shaft with strip fragments and a white light at the bottom.

### bloomTouch
- Refs: `bloomTouch_*`. Mean luma 47.
- Palette: hand `#E8A090` with rim `#FF5A4A`, leaves `#2FA84A`/`#8AE04A`, flowers `#FFC83A`/`#FF5A8A`/`#FFFFFF`, background `#020304`.
- Hand PNG at 35% of frame width bottom-left, fingertip as the growth origin. Growth cycle ~9 s: sprout → bush → wreath → vine arc → green spark burst → reset. Leaves 1,800 / 900 / 350.
- Impact: new growth burst of 40 leaves; bass scales leaf size ±15%. Rate under 1/s.
- Fallback: glowing fingertip dot. Done when: the wreath growth and the reset to a lone fingertip both occur.

### poleSparks
- Refs: `poleSparks_*`. Mean luma 46.
- Palette: sky `#4A5C68`, pole `#6A4A4E`, cables `#B02A3A`, pulses `#FF4FA0`/`#FFB0E0`, hearts `#FF6EA8`.
- Layered PNG illustration; pulses travel along `cable_paths.svg` at 1.2 screen widths/s with a tail of 8% of path length; spark clusters (8–14 pixels, 120 ms) at junctions; hearts blink on bass.
- Impact: 1–3 pulses start on random paths. Rate about 1.1/s.
- Fallback: procedural pole and cables. Done when: pink pulses race along red cables with sparks and blinking hearts.

### redCrystalHall
- Refs: `redCrystalHall_*`. Mean luma 33.
- Palette: hall `#1A1214`/`#3A1A1A`, crystal `#E0140C` with core `#FF6A3A`, mist `#7A0A06`.
- Locked-off camera, layered hall painting with 2% parallax drift; crystal 70% of frame height with facet cracks (additive lines) pulsing; mist sprites 40 / 20 / 10; figures static at the base.
- Audio: bass brightens the crystal (60–100%) and cracks; impact sends a floor shock ring. No cuts.
- Fallback: octagonal box hall. Done when: a glowing red crystal pulses in a dark vast hall with kneeling figures.

---

## Reference index
Files in `docs/superpowers/specs/reference/` are named `<modeId>_keyframes.jpg`, `<modeId>_hit-burst.jpg`, `<modeId>_overview.jpg`, for all 29 source clips (the `starfallCanopy` set shows the daylight source clip).
