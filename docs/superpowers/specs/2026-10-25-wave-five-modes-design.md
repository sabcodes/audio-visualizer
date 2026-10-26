# Wave 5 visualization modes: 15 reference clips

Status: **spec only**. Nothing here is built. The 3D and 2D assets are listed separately in [2026-10-25-wave-five-asset-list.txt](2026-10-25-wave-five-asset-list.txt) and are made in another environment; modes whose look depends on them have no build spec below, only a "blocked on assets" entry.

Source: 15 portrait phone screen recordings (4–14 s each, 1170×2532 at 60 fps). Each was cut to one frame every 0.2 s, 5 fps (so a 10 s clip is 50 frames), and read as 8-frame contact sheets, in recording order. Times below are seconds from clip start (t=0.0 is frame 1). **The audio could not be heard**, so every audio mapping is a proposal, not an observation. The platform UI (like/comment column, caption, username) is in the frames; ignore it. Crop the reference to the picture area when comparing.

Working assumptions (change any of these and tell me):
- Same rules as wave 4: beat-gated hits through `hitPulse.ts`, `reducedFlash` honoured, camera finish through `cinematic.ts`, build shapes in code with TSL/WebGPU first (the user prefers the code-built hands, crystal and cables to supplied models), labels `<experimental-wave5> Name`.
- Reuse over rebuild: `handModel.ts`, `figures.ts` / `dancer.glb` (and `dancer_b`, `dancer_c`), `cinematic.ts`, `hitPulse.ts`, the wave-equation height field from Moon Pond, the Mirror Plasma and Ink Marble shader engines.

## Index

| # | Clip (source) | Id | Label | Verdict vs existing | Build | Effort |
|---|---------------|----|-------|--------------------|-------|--------|
| 1 | glass_void, CRT on wet floor | `crtSpill` | CRT Spill | new | procedural (+ optional CRT prop) | M |
| 2 | estudio.ar.tv, red TV wall | `tvWall` | TV Wall | new | procedural | M |
| 3 | perspek.steven, glowing cube portal (carousel, slides 3 and 4) | `neonPortal` | Neon Portal | new (nearest: Beacon Rings, Bloom Tunnel) | procedural + dancer figure | M |
| 4 | nickjaykdesign, woman and particle plume | `sparkPlume` | Spark Plume | new (nearest: Hair Vortex, Windfield) | procedural + figure | M–L |
| 5 | nickjaykdesign, white runner in blue alley | `dreamAlley` | Dream Alley | new | code only (decided): procedural collage slabs + code-built runner | L |
| 6 | infinite_mantra, blue ink discs | `inkDiscs` | Ink Discs | new (nearest: Ink Marble) | fullscreen shader | M–L |
| 7 | pluginverything, glowing retro objects | `relicGlow` | Relic Glow | new | pixel/fringe pass in code; all 12 supplied models (decided) | M |
| 8 | _reuko, cracked glowing globe | `crackedGlobe` | Cracked Globe | new (nearest: Thunderstorm Sky for the bolts) | procedural | M |
| 9 | aghooker, tree with wires under a ring opening, flower field | `lanternTree` | Lantern Tree | new (nearest: Starfall Canopy) | code tree first, model fallback (decided) | M–L |
| 10 | kishimisu, dotted vortex around a white orb (slide 1 of 2 only) | `dotVortex` | Dot Vortex | new (user to confirm the clip, see section 10) | fullscreen shader | S–M |
| 11 | andreacarver, red clawed hands | `clawHands` | Claw Hands | **alter `handModel.ts`** (add a claw variant); new mode on top | procedural | M |
| 12 | glass_void, streak dancer | `slitDancer` | Slit Dancer | new (nearest: Chrome Streaks) | figure + shader | M |
| 13 | b_tang, subway car | `metroCar` | Metro Car | new (nearest: Underground, Light Leak Film) | **blocked on the car model** | L |
| 14 | aesth_render, dark hall with window light | (`warehouseHall`) | Warehouse Hall | **same idea as the existing mode**: alter, don't add (section 14) | edit | S |
| 15 | harvon.x, power pole with sky panels | `skyShards` | Sky Shards | new | code only (decided): sky shaders | M |

Not building new: 14. Altering existing: 11 (hand model), 14 (Warehouse Hall), maybe 10 (Outer Space). Everything else is a new mode.

## Shared rules

1. **Hit table, no repeats.** Fast modes pick the next variant from a seeded sequence, never the same twice in a row (wave 4 rule).
2. **Flash safety.** Clips 2, 3, 4, 12 and 14 flip brightness or colour at 2.5–5 Hz or more in the frames. Cap at 3 flashes/s under `reducedFlash`, cut the jump to ~40%, raise the floor. Clip 4 alternates purple and blue on **every** sampled frame (5 Hz at least, probably faster and aliased), so its colour swap must be rate-limited under `reducedFlash`.
3. **Motion from response, not breathing.** Drive motion from `frame.response.*` and `hits.level`; `hits.flash` only drives brightness (the user flagged "just breathing" motion and dead sliders in review).
4. **Budget.** Each mode declares a particle/instance count per quality tier; the lowest tier halves it.
5. **Checks.** Each mode ships with a 130 BPM kick/snare fixture and a headed capture compared to the clip's frames at the same timestamps.

---

## 1. CRT Spill (`crtSpill`), glass_void, 4.2 s

**What the frames show.** A dark, wet concrete floor lit only by a CRT. The CRT (front-right, turned ~35° to the camera) shows a bright mint-green screen full of churning, wave-like video noise. A second dim CRT sits behind it, left. Black cables snake across the floor from the bottom-left. From the screen's lower-left edge a jet of fine white-blue sparkle (like sprayed water or glitter) shoots toward the camera's left and fans onto the floor, 25–35% of the frame height long. Off the back TV a smaller blue sparkle jet rises. The wet floor reflects the green screen and the blue spray.

**Timeline (0.2 s steps).**
- 0.0–1.0: jet is a dense stripe of comb-shaped streaks (ripples) laid on the floor, pointing down-left; the screen is calm mint with soft folds.
- 1.0–1.8: screen brightens to near-white at the rim; the jet gets brighter and thicker near the screen and breaks into thin diagonal strands; the back TV's spray flickers.
- 1.8–2.8: the screen shows bright white veins (lightning-like) across green; the jet shortens, then whips: a bright white "arm" strands out left and the comb pattern repeats further out (a pulse travelling along the jet, ~0.6 s per pulse).
- 2.8–4.2: veins fade, jet returns to a long soft stripe; the loop restarts. About 3 visible pulses in 4 s (~0.7 per second).

**Build.**
- Floor: wet dark concrete plane, low roughness, screen-space reflection or a planar reflection of the screens; puddle breakup via noise-driven roughness; fine speckle (tiny glints) in the wet areas.
- Screens: emissive planes in a CRT shell (bevelled box, dark grey, thick back). Screen shader = domain-warped noise in mint/white with scanline and slight barrel curvature; bass raises the white-vein density.
- Jet: GPU particle strip, ~12k points, emitted from the screen's lower edge in a 25° fan, velocity along the floor-plane diagonal; each pulse is a travelling brightness wave along the jet (the "comb" streaks are the wave fronts seen at a grazing angle, stretched along velocity, ~8:1). Blue-white colour, additive, with a long thin trail.
- Cables: 6–8 thick black tube splines on the floor (static).
- Camera: locked, 30° down, slow 2% handheld drift; slight push-in on hits.
- Finish: halation on the screen, heavy vignette, grain, mild fringe.

**Audio.** Bass → screen brightness and vein density; kick (`hits`) → emits a pulse down the jet; hats → shimmer in the speckle; mids → back-TV spray. Palette is fixed (mint screen, ice-blue spray, near-black floor), no hue cycling.

## 2. TV Wall (`tvWall`), estudio.ar.tv, 9.7 s

**What the frames show.** A red-lit room; a stack of about 27 CRT TVs in a wall, 6–7 across and 3–4 high in the upper block, plus a lower row of 3 large TVs at the bottom. Behind and above them a shelving unit on the left. Almost everything is deep red/black with an orange-red wash on the walls. Each TV is dark or glows one flat colour block: mostly orange, red and amber, some desaturated grey-white, rare violet. Blocks occupy roughly 60–100% of each screen with horizontal banding (a pale band across the lower half is common) and soft edges, like a VHS or static frame.

**Timeline.** Every 0.2 s a different subset of screens lights: 6–12 of the ~30 screens are lit at once; the pattern advances like a sequencer step, with a given TV staying lit for 0.4–1.0 s. The lower row of three big TVs takes turns: only one is bright at a time, the lit one moving left → right → left. Over the whole clip the white/grey screens stay mostly stable (they act as static anchors) while the orange ones change. Rate ≈ 2.5 steps/s.

**Build.**
- Procedural wall: instanced bevelled CRT boxes (convex screen glass with a shader for curvature + scanlines), irregular stacking: mixed sizes, 2–3° tilt on some, gaps and dark ones (not a clean grid).
- Each screen is an emissive tile with a per-screen state machine: colour from a palette `[orange, red-orange, amber, brick red, grey-white, lilac]`, a horizontal band offset, a slow vertical roll, and fade in/out.
- Room: red volumetric haze, a faint grid-shelf silhouette upper left, floor reflection (dark glossy), red ambient.
- Camera: locked, slightly low, drifts ±1.5% x.
- Finish: bloom proportional to lit count, grain, subtle lens distortion.

**Audio.** Each kick advances the sequencer: a step mask picks which TVs turn on (seeded; 6–12 on); snare lights a second layer (a different colour family); sustained bass keeps the lower row's lit TV alternating; loudness → overall red wash intensity. The grey-white anchors stay on (silence = only anchors).

## 3. Neon Portal (`neonPortal`), perspek.steven, carousel slides 3 and 4 (~7.4 s of the clip)

**What the frames show.** Outdoors at night on grass, a free-standing cube frame of 9 nested square rectangles (a tunnel of frames receding into depth) lit by glowing tubes, fog filling it, a back-light making a bright core. Two shapes stand inside.

- Slide 3 (≈0–3.4 s): cyan/aqua frame, two dancing silhouettes (a pair, bodies overlapping, arms swinging) in a white-cyan haze. Colour shifts from cyan to mint-green at ≈1.8 s. Dancers move continuously, about 1.5 s per move.
- Slide 4 (≈3.4–7.4 s): yellow-lime frame, camera pulled back and cropped; a darker figure (long hair) and a lighter dress figure fade in and out of the haze; the inner "tunnel" glows teal. At ≈5.6 s the whole cube drops to near-black with only dim pink edges, then at ≈6.2 s it re-lights, first the frame edges (lime), then the teal core, then fog fills white; the figures walk and turn as shadows.

**Build.**
- Frames: 9 nested square outlines, spacing 0.18 → 0.08 (perspective squeeze), tube radius thin, emissive; per-frame brightness ripples inward-out on a beat (a 0.15 s sweep).
- Core: an emissive back-wall plane plus volumetric fog (analytic: sample a few steps along the view ray) so figures read as soft silhouettes, not sharp cutouts.
- Figures: reuse `dancer.glb` (`dancer_b` for the second) rendered as flat backlit silhouettes (unlit, dark tint, edge-softened and blurred 2–4 px, density attenuated by fog depth). Idle dance clips from the existing crowd mode, beat-driven.
- Ground: dark grass plane with a faint coloured spill in front of the portal, no detail.
- Camera: locked, ±1% sway; two framings (near, far) swapped on a long cycle.

**Palette scenes (cycle every ~16 beats):** cyan → mint; lime → teal core; magenta/pink edge → violet core.
**Audio.** Kick → frame ripple + core flash; bass → fog density; mids → figure motion scale; a breakdown (low energy for ≥ 1 bar) → blackout to the dim pink edge, then a rebuild on the next kick.

## 4. Spark Plume (`sparkPlume`), nickjaykdesign, 8.7 s

**What the frames show.** A hovering woman (arms slightly out, feet pointed, floating just above the ground) in a dark foggy night, seen from the side and slightly below. From the top of her head a huge plume of tiny glowing dashes pours up and away. The plume is dense in the first half (a wide, fast, noisy cloud ~65% of the frame height) and then twists into a spiral column (≈3.0–5.5 s), her body also made of the same dashes (lit purple/blue, readable as a silhouette of dots), then the plume tilts and sweeps to one side and the body goes dark again (≈6.5–8.7 s). Colour alternates purple ↔ blue between consecutive frames (see flash note), with a brighter cyan core near the head.

**Timeline.**
- 0.0–1.4: dark body, plume diagonal up-right, broad; dashes ~6–10 px, oriented along flow.
- 1.4–3.0: body fills with dots (the dot density jumps up), plume narrows and rises as a column.
- 3.0–5.6: plume twists into a double spiral (two intertwined strands), colour pure and brightest; body fully dot-lit.
- 5.6–6.6: transition, plume lies over to the left, body dims.
- 6.6–8.7: back to the dark body and the broad diagonal plume (loop).

**Build.**
- 80–150k GPU particles drawn as short oriented dashes (billboards stretched along velocity, ~4:1).
- Sources: (a) head emitter, (b) body surface emitter sampled from the dancer mesh (reuse `dancer.glb`, a standing/hover pose with soft sway) with a fade-in/out mask.
- Flow field: curl noise + a spiral term around a vertical axis whose strength is audio-driven (bass → twist amount). The plume's wide/narrow state follows loudness.
- Colour: hue pair `[#b04dff, #3a7bff]` switching with a rate-limited toggle (see flash note); cyan-white hot core where particle density is highest.
- Scene: near-black foggy gradient, faint horizon silhouette, light ground haze; slight camera drift.

**Audio.** Loudness → particle birth rate and plume width; bass → spiral twist and column height; hats → dash jitter and the sparse far "sparks" at the plume's edge; kick → a brighter pulse travelling up the plume.

## 5. Dream Alley (`dreamAlley`), nickjaykdesign, 10.4 s (code only, decided)

**What the frames show.** A bright white glowing silhouette (a figure in a flaring coat or skirt, mid run) moves away from the camera along a violet-blue city street. The street is a **collage of angled planes**: a large wall slab on the left with a stepped top edge and a rectangular dark window cut-out, a big slab above (sky), a tall lit tower in the middle distance, and side slabs on the right, separated by pure-black voids and a wet dark pavement with hard black shadow shapes. Each slab carries a night-city image (windows, a street lamp, mist). A blue-violet grade, soft white rim glow around the runner, hot vignette.

**Timeline (0.2 s steps).**
- 0.0–1.0: runner at the lower middle, mid stride (one knee up, coat flaring right); all slabs present.
- 1.0–1.8: the slabs collapse in a staggered 0.4 s wipe: first the sky slab and the left wall slide away, leaving a black void with only the tower and a right slab; the runner is larger (zoom toward camera ~1.6x) and the shadow shapes on the floor sharpen.
- 1.8–2.8: the slabs return from the side in 3 steps; the runner shrinks back.
- 2.8–4.4: steady run, coat flare on every step (3 steps/s); a street lamp glow bobs in the centre.
- 4.4–10.4: the same cycle repeats twice with variations (slab layout changes: the left wall taller, the window cut-out moves, the tower swaps side); the runner is always roughly centre.

**Build (code only).**
- Runner: **code-built capsule figure** (the `handModel.ts` approach: ~16 tapered capsules, smooth-minimum blend, raymarched as a white silhouette with a soft rim), a procedural run cycle (3 steps/s, hips bob, arm swing), plus a coat/skirt: a 12×6 cloth strip from the hips driven by `springRig.ts`, flaring on each step and on kicks. The silhouette shape (not the surface) is what the clip reads as.
- Slabs: 6–9 quads in 3D at angles ±20–35° around the street axis, with fixed stepped/notched edges (alpha masks drawn in code) so each reads as a building facade. The texture on each slab is a **procedural night facade shader**: window grids with random lit windows, a dim gradient, haze, a street-lamp bokeh dot or two, a neon streak, all in blue/violet.
- Floor: a dark glossy plane with hard black cast shadow shapes (angular, from the slabs) and a violet floor wash.
- Tower: one tall slab with a dense window pattern, always at the vanishing point.
- Voids: when slabs leave, the background is pure black (not dim); the tower and runner stay.
- Camera: chase camera, low and behind, slight FOV pulse on hits; the zoom on the collapse.
- Finish: blue-violet grade, bloom on the runner, vignette, grain.

**Audio.** Kick → the collapse/return (slab layout variant picked from a seeded table, never repeated); snare → coat flare burst and a rim flash; bass → runner glow; loudness → floor wash; a breakdown → only runner and tower.
**Risk.** Without photographic plates the facades will look graphic rather than footage-like. The finish pass and a heavy haze are the mitigation; judge it against frames 0.0–1.0 and 2.8–4.4 before polishing.

## 6. Ink Discs (`inkDiscs`), infinite_mantra, 12.4 s

**What the frames show.** A pale peach/cream paper background. A vertical stack of 4–6 translucent circular "discs" in indigo and cobalt, overlapping, each a flat circle with: a dark indigo nucleus (offset from centre), fine radial veins fanning to the rim, a darker rim line, tiny white dots (pigment specks) scattered, and a thin orange/brown halo line around the whole group. A narrow drop-shaped tail hangs from the bottom disc with a small teardrop below, joined by a thin thread.

**Timeline.**
- 0.0–2.0: 3 big discs on top (overlapping, ~1/3 of the frame wide), 1 mid, 1 small, a droplet at the bottom; they drift slowly (slow vertical oscillation, each disc differently), overlaps darken (multiply).
- 2.0–4.0: the middle disc grows and slides sideways, discs rearrange; the nucleus of the top-left disc darkens and shrinks.
- 4.0–5.6: a vein burst: the upper disc's nucleus becomes a fine star-shaped pinch (a single bright point), veins sharpen into a fan; the lower discs go from soft to dark-rimmed.
- 5.6–8.0: discs merge into a chain; the nuclei slide along the thread (one runs down), the droplet inflates into a disc.
- 8.0–12.4: a spiral nucleus forms (a curled vein like a conch), then the whole chain wobbles, ends with the original stack. A smooth loop.

**Build.** Fullscreen shader, no mesh.
- N=6 discs as SDF circles with per-disc centre, radius, nucleus offset, and a rotating vein phase; each disc is composited with multiply (overlap darkening) on cream paper (subtle fibre noise).
- Veins: radial noise `sin(k·angle + warp(r))` with 60–140 fine strands, plus a low-frequency domain warp so veins curl near the nucleus (the spiral state).
- Nucleus: a dark radial gradient with a bright pinhole in the pinch state; white specks from a hashed dot field (density near the nucleus).
- Thread: a thin SDF line with a tiny taper; the droplet is a smooth-union of a circle and a cone.
- Halo: a faint orange outline 3–4 px outside the group.
- Palette: paper `#f1e0d2`, indigo `#0b1a5a`, cobalt `#2f5fd0`, sky `#8fb6ee`, halo `#d98a4a`.

**Audio.** Bass → disc radius pulse and nucleus darkness; kick → a vein "pinch" (the nucleus shrinks to a point for 0.25 s); mids → rotation of the vein phase; hats → speck twinkle; sustained loudness → how fast discs drift. Calm: this mode should never flash (cap brightness change).

## 7. Relic Glow (`relicGlow`), pluginverything and aescripts, 11.8 s

**What the frames show.** A black void with one glowing object at a time, seen as a **low-resolution pixelated 3D render** (the object is about 90–120 px across on the phone, a hard pixel grid, nearest-neighbour), with a coloured chromatic fringe on its edges (blue on one side, orange/red on the other: a ~3 px RGB offset along the screen x axis) and a soft same-colour bloom halo with a dark vignette. Objects rotate slowly in 3D (a turntable plus a tilt), and each one has a small "alive" action. It is a 3D object (it rotates and shows correct perspective), lit by one key light and a rim; the surfaces look glossy.

**Sequence (about 0.6–0.8 s per object; the full sequence is ≈12 s).**
| t (s) | object | action |
|-------|--------|--------|
| 0.0–0.6 | PlayStation controller | green tint; ends of the sequence repeat it |
| 0.6–1.8 | Tamagotchi | prism-rainbow screen swings colour, bead chain swings |
| 1.8–2.6 | Game Boy Advance SP | flap opens from 30° to 100° |
| 2.6–3.4 | crushed Coca-Cola can | slow turn, red; fringe is blue-yellow |
| 3.4–4.4 | three dice | red dice stacked in a column, each spinning at its own rate |
| 4.4–5.4 | cigarette butt | orange filter, white ash; ash flakes jitter |
| 5.4–6.2 | yellow-orange ball with a swoosh | rolls and spins |
| 6.2–7.4 | Nokia 3310 | green LCD with the logo, keypad glowing, tilts |
| 7.4–8.2 | white-red sneaker | laces flap up, rotates in flight |
| 8.2–9.0 | orange hatchback | rotates slowly |
| 9.0–10.2 | red lighter | crumples (a squash on the middle) |
| 10.2–11.8 | ring-toss tower | green rings stacked on a tan pole, then they slump into a green puddle (melt) and the pole stays; then loops |
Between objects there is a 0.1–0.2 s **block dissolve**: the old object shatters into its pixel blocks (drift, shrink), the new one forms from them.

**Code vs asset check (the user asked to verify).**
- All the *look* is a render pass in code: render the object to a ~100×(100·aspect) target, upscale with nearest filtering, offset R and B channels by ±2–3 px, add a bloom halo tinted by the object's average colour, apply a vignette, and a block-dissolve mask (hash blocks). No asset needed.
- The objects themselves: at ~100 px a very simplified model is enough, because the pixel pass hides detail. Eight to nine objects can be built from primitives in code and still read at this size: dice (rounded cube + pips), cigarette (cylinder + ash cone), can (lathe + dent noise + a red-white texture), ball (sphere + swoosh decal), Nokia (rounded box + a screen quad + a keypad grid), GBA SP (two rounded boxes on a hinge + screen), Tamagotchi (ellipsoid + a rotated square screen + a chain of beads), lighter (box + cylinder + crumple morph), ring-toss (cylinder + torus rings + a slump morph).
- Three objects do **not** read from primitives: the controller (thumbsticks, face buttons, horns), the sneaker (sole, mesh, swoosh, laces) and the hatchback (cabin, wheel arches, lights). They need models.
- **Decision (confirmed): the 3D model route.** All 12 objects come from supplied models exactly as listed in the asset list; no code stand-ins. The mode is blocked until the models arrive; the render pass (pixelation, fringe, halo, dissolve) is code.

**Build.**
- A `ObjectCarousel` of 12 slots; each slot is `{ make(): Object3D, tint, spin, action(t) }`; a model is swapped in when the file exists.
- Pass chain: object → low-res target (resolution a function of `outputSettings`, default 128 px tall), nearest upscale → RGB fringe → bloom tint → vignette.
- Camera locked, object slightly below centre, slow tilt.

**Audio.** Kick → advance to the next object (dissolve); mids → the spin rate; bass → halo size; hats → pixel size flicker (±1 px level); loudness → the fringe width. Never the same object twice in a row (shuffled bag, with the original order as the default).

## 8. Cracked Globe (`crackedGlobe`), _reuko, 6.6 s

**What the frames show.** A black space with a faint rocky floor strip. A sphere (about 40% of the frame width) made only of its **fracture lines**: thin, bright electric-blue cracks on a transparent globe shell. A small halo ring floats above the top of the sphere. On a hit a bright white spot appears at the top, a glowing ring expands and slides **down** the sphere like a scanner, leaving the upper cap filled with solid white-blue light that then breaks into dripping, branching veins; the ring thins and sags at the bottom into a jagged lightning line.

**Timeline (one cycle ≈ 2.2 s, three cycles in the clip).**
- 0.0: cracked shell only, dim, halo above.
- +0.2: hot white spot flashes at the north pole, the cap fills with white.
- +0.4–1.0: the ring moves down at about 2× the sphere's height per second, wide at the equator, the cap is solid white with soft edges.
- +1.0–1.6: cap breaks into veins that fork downwards; the ring contracts to a jagged blue lightning loop at the south pole.
- +1.6–2.2: veins fade and the cracked shell remains; the next cycle begins.

**Build.**
- Sphere shell: SDF/triangle sphere, transparent; the cracks come from a 3D Voronoi-edge texture (thin lines) with extra noise breakup, emissive blue; bright where energy is high.
- Cap fill: an energy front `y > ringY` fills with white that decays; edge uses fractal noise so the fill drips like paint (the veins).
- Ring: a torus-like glowing loop in the equatorial plane at `ringY`, radius = the sphere's radius at that height, with a jittery inner spark band; at the bottom its thickness dissolves to lightning (random walks along the circle).
- Halo: a small thin ring above the sphere, pulses.
- Floor: a few dark layered rock slabs at the bottom (silhouettes with a rim light), fog.
- Camera: locked, centred; ±1% bob.

**Audio.** Kick starts a cycle (white spot, ring from the pole); loudness → crack brightness; the ring speed is tempo-locked (one pass per 2 beats); hats → spark jitter in the lightning stage.

## 9. Lantern Tree (`lanternTree`), aghooker, 8.7 s

**What the frames show (corrected after the user's note).** A big deciduous tree stands in a misty clearing. **Above it is a large circular opening (a hole or vortex)** in a dark ceiling or sky, a ring with a glowing blue rim; light pours down from it in cones and shafts through the fog and into the tree. **Many dark cables hang from the opening** and drape through the canopy, some crossing in front of the trunk and some looping to the ground. The leaves have white-cyan hot spots (lamps hidden in the foliage). The ground is a **field of flowers/grass**: warm orange-yellow flowers close to the camera (blurred, in the foreground, 5–6.8 s), blue-white glowing flower clusters across the middle ground that fade in from 3.0 s and pulse (20+ by 6.0 s). A warm orange glow sweeps through the leaves in waves (left side 0–1.4 s, a full canopy wave 4.0–4.6 s, the right and upper canopy 5.4–7.6 s) and a pink-orange cast appears at the edge of the opening's light (≈2.4 s, ≈5.2 s, ≈7.2 s). The camera moves: a slow forward dolly and a low sideways drift, with the foreground flowers sliding past (≈5.6–7.2 s).

**Timeline.**
- 0.0–2.0: orange on the upper-left canopy and the left cone; the field is dark, with sparse warm flowers.
- 2.0–4.0: orange fades; cyan fills the tree; blue flowers begin to appear.
- 4.0–6.0: an orange canopy wave sweeps in and out (0.6 s each); blue flowers pulse on beat; a warm orange flower patch glows at the bottom-left.
- 6.0–8.7: the camera drifts and dollies, the foreground flowers blur past; the canopy flickers orange at the top and the left; the hole dims and ends calm.

**Build (decided: code tree first; a model only if it does not look right).**
- Tree: L-system trunk with 7–8 branching levels, bark shader, 25–40k leaf cards (alpha-cut procedural leaf shapes, 2 types), wind sway; per-cluster "hot spots": 14–20 emissive sprite lights in the canopy (not real lights) with halos; leaf lighting gets a rim from the opening above.
- Opening: a large flat ring above the camera frame (outer radius ≈ 1.6× the canopy width, soft blue inner rim, a thin ring of struts), a volumetric cone below it (analytic light-shaft ray march, 24 steps) for shafts, hazy.
- Cables: 14–20 tube splines from the ring's rim, falling and draping, some to the ground, with a gentle sway (use `springRig.ts` for the sag).
- Field: instanced flower/grass blades (150k), colour blue-white on the middle ground, orange-yellow in the foreground; a glow-disc layer for the blue blooms; depth-of-field blur on the foreground rows.
- Fog and floor haze; a faint dark leaf litter silhouette near the bottom.
- Camera: a slow dolly (0.15 units/s), ±3° yaw drift, a focus pull to the foreground on a hit.
- Finish: `cinematic.ts` with halation and soft focus; palette navy, cyan, white-blue, accent orange.

**Audio.** Bass → hot-spot brightness; kick → the next orange wave through the canopy (the direction alternates); ground blooms pulse on mids and the bloom count rises with loudness; a breakdown dims the opening and the shafts; hats → leaf shimmer.
**Fallback.** If the code tree does not hold up beside frames 0.0–1.0 and 4.0–5.0, request a tree model (asset list B2, then required).

## 10. Dot Vortex (`dotVortex`), kishimisu (a procedural-code piece), 6.6 s

**What the frames show.** A pure white glowing sphere at the centre (~32% of the frame width) with a soft pink rim, a flat dark elliptical "shadow disc" at its equator, and from every direction a dense, perfectly regular dotted grid that bends around it like an accretion disc seen edge-on: upper hemisphere dots point up-and-out in a fan (bright blue-white), lower hemisphere in a curling spiral; the horizontal band across the middle shows long tangential streaks. Colour is a rainbow gradient (blue top-left, orange/yellow bottom-right, magenta/violet) that rotates over time. The whole disc tilts slowly (the dark shadow ring tilts about 15° over 2 s) and the colours rotate.

**Timeline.** 0.0–1.0 mostly blue/cyan top, orange bottom; 1.0–3.0 hues rotate: yellow becomes the dominant tone and the shadow ring tilts steeper; 3.0–5.0 the whole palette has shifted through violet to orange/yellow; 5.0–6.6 returns to blue/orange. No cuts; a continuous roll.

**Clip check.** The orb recording is slide 1 of 2 of a carousel (the "1/2" badge) and shows no dancer. The girl dancing to a dot/streak effect is the glass_void clip, which is **clip 12 (Slit Dancer)**; the user's screenshots confirm it. Clip 10 stays the dotted orb vortex and is confirmed as its own new mode. **The orb itself barely moves; the motion is the dotted background swirling and rotating around it, which makes the orb feel like it is travelling and bouncing.** So drive the bounce from the lattice (inward scroll, twist and lens strength pulsing on bass), not from the orb's position; at most nudge the orb a few pixels.

**Build.** One fullscreen fragment shader.
- Gravitational-lens style warp: for each pixel compute an impact parameter `b` relative to the orb, deflect the lookup direction `θ' = θ + k/b`; sample a procedural infinite dot lattice (grid in the deflected plane, dot radius ~0.25 cell) so dots bend, stretch and spiral toward the orb; dots near the equatorial band are stretched along the tangent (the streaks).
- Colour: `hsv(angle/2π + time·0.08 + dist·0.3)`, saturation high, value lifted near the orb.
- Orb: white disc radius 0.16, soft pink rim glow, a dark ellipse (the shadow disc) tilted ±15°.
- Dot grid scrolls inward (a tunnel feel) at a speed tied to loudness.

**Audio.** Bass → orb radius and lens strength; mids → colour rotation speed; kick → dots pulse brighter for 0.15 s; the tilt follows the stereo balance if available, otherwise a slow LFO.

## 11. Claw Hands (`clawHands`), andreacarver and vizibeat, 10 s

**What the frames show.** Two pale hands and forearms (crossing, wrists at the bottom) with very long black claws (each nail 1.5–2× finger length), fully red-lit: red monochrome, a bright rim light and a dark underside; the background is a red gradient with faint radial rays behind the hands. They move continuously: fingers splay, curl and cross; the hands swap between a lit view (palm facing camera, red/white skin, visible veins and wrinkles) and a silhouette view (backs of hands, almost black with red rim).

**Timeline cut rate.** The footage cuts or flips every 0.4–0.8 s, alternating lit and silhouette passes and changing hand/arm composition (X cross, side by side, one hand in frame, arms from the left). A red frame (a thick red border, partial) flickers at the edges as a glitch layer: the border is the edit, not the scene.

**Alteration to existing code.** `handModel.ts` is the raymarched 22-capsule hand. Add: (a) a `claws` option: a tapered, slightly curved extra capsule per finger (length 1.2–1.8× the last phalanx, tip radius 0.004), black material, with a glossy specular; (b) a two-hands arrangement (mirror + offset); (c) a "rim only" (backlit) render pass option for the silhouette state.

**Build.** New mode `clawHands`: two hands from `handModel.ts`; pose library of ~8 key gestures (open splay, claw curl, fist, X-cross, pinch, wave, pointing, "spider" with fingertips together), blended by a state machine; lighting = a strong red key from behind plus a weak front fill, switching key direction on hits (lit ↔ silhouette); background gradient with rays; flicker border glitch; red-only palette (the user's red bar from Red Stairwell/Crystal Hall).

**Audio.** Kick → flip lit/silhouette and advance to the next pose; mids → finger wiggle amplitude; bass → camera push; hats → ray flicker; keep movement continuous between hits (the user dislikes still hands).

## 12. Slit Dancer (`slitDancer`), glass_void, 10 s

**What the frames show.** A dancer in profile, dissolved into thousands of horizontal light streaks (like a slit-scan or line-sampled scanner), standing on a mirror-black floor whose reflection is the same streaks pulled down. The body is read from the density of streaks: bright dense stripes on legs and torso, sparse scatter in the head and arms. The scene flips between two palettes with hard cuts: blue-violet (a cool, bright haze) and red-orange (darker, higher contrast). Background is black (red) or deep navy glow (blue). The pose changes every 0.4–0.8 s: arm swings, one leg lifted, then squats; and at ≈6.2 s the figure disappears for 0.6 s (black frame) then returns closer and blurrier (zoom into the body, blown blue).

**Timeline.** 0.0–2.0 alternate blue/red every 0.2–0.4 s (a flash cut rate of 2.5–5 Hz: see flash note), the dancer rotates from side view to a 3/4 view; 2.0–4.0 pose moves to a wide stance with arms back; 4.0–5.4 a leaping move with arms up (silhouette becomes a "star"); 5.4–6.4 near black; 6.4–8.0 close, blown-out blue body, a slower sway; 8.0–10.0 returns to the medium shot, blue then red.

**Build.**
- Figure: `dancer.glb` animated (the existing crowd dance clips), rendered to an offscreen mask/depth buffer, then converted to streaks by a compute/instanced pass: for each of ~220 horizontal scanlines across the body's height, emit 40–120 streak instances along x where the mask is on, each with a random length 0.01–0.06 and a velocity offset ("smeared left/right" by body motion).
- Streak shader: additive, colour by palette, brightness by depth; trails blur horizontally.
- Floor: a black reflective plane; mirror the streaks (flip y, fade).
- Palettes: blue `[#4d6bff, #8ea0ff, #ffffff]`, red `[#ff5a3a, #ff9a6a, #ffffff]`; haze behind (a soft vertical gradient glow).
- Camera: static medium; a zoom-in state for the "blown" shot; the black frame is a deliberate cut.

**Audio.** Kick → palette flip and pose change; mids → the streak length (more smear on louder); bass → vertical stack compression (the streaks bunch on legs); a breakdown → the blackout, then the zoomed blown shot on the drop.
**Overlap.** `chromeStreaks` is a different image (chrome streaks); this is figure-driven. If the user prefers, reuse the Chrome Streaks lens-smear look as the optional second layer.

## 13. Metro Car (`metroCar`), b_tang, 10 s: blocked on assets

A first-person camera moves through the empty interior of a subway car (olive-green panels, steel poles, blue-grey bench seats, ad boards overhead, orange destination lights at the far end). Low evening sun enters through the windows on the left, painting warm shafts and bars across the floor. The camera is a roll-and-tumble: it starts level and gliding (0–2.4 s), then rolls to 45° and then past 90° (2.4–6.0 s, the car appears to lie on its side then upside down), then dives toward the end door, which flashes bright cream, and the car goes to black (≈8.0–10.0 s, the lights cut). Colour grade: warm amber highlights, teal shadows.

Needs the interior model (poles, seats, ad panels, windows, doors) and a camera spline. No build spec until the model arrives. Nearest reuse: Underground (Kit A) for the metal; Light Leak Film for the sun-flare treatment.

## 14. Warehouse Hall (existing `warehouseHall`), aesth_render, 11 s: alter, don't add

The frames: a wide industrial hall in blue-grey with a row of large tall windows on the back wall, rubble and puddles on the floor, structural columns, a ceiling strip light. The picture swings between three states: (A) day-bright windows with a bright floor reflection, (B) a **single ceiling strip** lit, everything else dark, (C) dark with two or three **window shafts** or a red wash on the far left and right columns. Cut rate ≈ 1.5–2.5 per second, with hard blackouts of 0.2–0.4 s between (about 6 blackouts in 11 s). The last second fades to the strip-light state. A red accent appears at the left/right edge for 0.2 s on some cuts.

Compare with the existing mode's reference (angryburd4234 "warehouse audio visualizer"): same room type and the same cut behaviour. So **do not add a new mode**. The delta to check on the current mode:
1. A state machine with exactly these three looks (A windows-on, B strip-light, C window shafts + red wash), picked on hit.
2. Hard blackouts between states (0.2–0.4 s, ≥ 90% down), not a dim.
3. A tall window wall with a bright cool-white floor reflection and rubble silhouettes in foreground.
4. A red accent light on the far left/right columns.
5. Reduced flash: floor the blackout at 40% and halve the cut rate.

## 15. Sky Shards (`skyShards`), harvon.x, 8.7 s

**What the frames show.** A locked photograph of a wooden utility pole with three crossarms, insulators and diagonal power lines against a deep blue dusk sky with a cloud mass at the top right. Parallelogram **sky panels** wipe in along the line of the wires: first one at the upper-left (a pink-orange sunset strip), then more from the left and right, until the sky is a collage of angled slabs of sunset: red clouds, orange glow, a dark teal ocean slab, a golden slab, a storm-blue slab. The panels are bounded by the wires (they follow the wire slopes) and by the crossarm lines. Then they fall out and return to the blue sky.

**Timeline.**
- 0.0–0.4: sky is plain, the pole in dark silhouette, clouds right.
- 0.4–1.2: the first panel appears at the upper left and widens; a window (a picture-in-picture rhombus) shows cloud sunset behind the pole's top arm.
- 1.2–4.0: panels fill from the left and right in 6 steps (about 0.3–0.6 s each), a new slab every beat: sunset red, ocean, gold, storm blue.
- 4.0–6.0: full collage; slabs rock slightly (±4 px).
- 6.0–6.8: panels retract, leaving the red strip left.
- 6.8–8.7: back to the plain dusk sky (loop).

**Build.**
- Pole, wires, crossarms and insulators: drawn procedurally (a layer in front, black with a faint rim); wire slopes define the panel edges.
- Panel skies (code only, decided): each panel is a fullscreen quad masked by a polygon whose edges follow a set of wire lines; its sky is a shader from a small library of 8 looks: (1) pink-orange streak sunset, (2) red sunset clouds over a dark sea, (3) golden cloud bank, (4) moonlit teal sea, (5) storm-blue sea with a bright rim, (6) orange sunset with a dark cloud edge, (7) clean dusk blue, (8) backlit cumulus. Each look = a vertical gradient + 3–5 octaves of anisotropic fBm clouds (stretched along the wind) with self-shadowing and a rim-light term, plus a horizon line for the sea looks. Each panel has its own parallax (opposite the camera sway), slow zoom and a soft inner glow at the edges.
- The remaining base sky: a blue gradient with the existing cloud mass in the top right (plate or a volumetric noise).
- Wipe animation: panels slide in along the wire direction with an ease-out (0.25 s), staggered.
- Camera: locked with a ≤1% sway.

**Audio.** Each kick pushes the next panel (the next variant from the table, never repeated), snare cuts one panel out, loudness controls the saturation of the slabs; a breakdown retracts all panels.
**Risk.** Shader skies will look more graphic than the clip's photographs; the cloud shading (backlit rim, dark base) carries most of the realism, so spend the effort there.

---

## Open questions

1. Clip 10 (orb vortex) vs clip 12 (the dancing girl): confirmed they are two separate clips; send slide 2 of the orb post if it matters.
2. Clip 13 (Metro Car): can Kit A be extended into the subway car, or do you want a separate model? It is the only mode still blocked.
3. Clip 14: confirm the change-in-place plan for Warehouse Hall rather than a new mode.
4. Clip 4 and 12 flash rates: send the original clips (or say how fast the colour really flips); the 0.2 s frames alias at 5 Hz.
