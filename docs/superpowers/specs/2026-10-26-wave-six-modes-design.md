# Wave 6 visualization modes: batch 1 (3 references) and batch 2 (14 clips)

Status: **spec only**. Nothing here is built. Batch 2 starts at [section 4](#batch-2-14-clips-2026-10-26). Assets are listed separately in [2026-10-26-wave-six-asset-list.txt](2026-10-26-wave-six-asset-list.txt). Batch 1 needs none; batch 2 has one mode blocked on assets (#7) and one that needs 2D images (#13).

Sources:
- A. A still of a cosy, cluttered old-fashioned living room in daylight (animated-film style). User note: "should be at night. Window and light should flash with beats."
- B. A still of a low-res, retro 3D casino slots room (PS1-era look). User note: "lights in the casino and machine could flash with beat."
- C. A 12.8 s portrait phone recording (1170×2532) of a dark apartment block facade, cut at 5 fps into contact sheets. User note: "the windows flash to the beat." **The audio could not be heard**, so every audio mapping is a proposal.

The two stills are style references, not scenes to copy. Each mode is an original room in that spirit: our own furniture layout and props, nothing traced from the film or game.

Working assumptions (same as wave 5; tell me to change any):
- Beat-gated hits through `hitPulse.ts`, `reducedFlash` honoured, camera finish through `cinematic.ts`, everything built in code with TSL/WebGPU first, labels `<experimental-wave6> Name`.
- Motion comes from `frame.response.*` and `hits.level`; `hits.flash` only drives brightness.
- Hit tables never repeat a variant twice in a row (seeded).
- Each mode declares instance counts per quality tier; the lowest tier halves them.
- Each ships with a 130 BPM kick/snare fixture and a headed capture.

## Index

| # | Source | Id | Label | Verdict vs existing | Build | Effort |
|---|--------|----|-------|--------------------|-------|--------|
| 1 | A, living room still | `nightParlour` | Night Parlour | new | procedural room + code-built furniture | M–L |
| 2 | B, retro casino still | `slotHall` | Slot Hall | new (shares the pixel pass idea with Relic Glow) | procedural, low-poly + pixel/affine pass | M |
| 3 | C, apartment facade clip | `windowGrid` | Window Grid | new (nearest: Neon City, which is a skyline, not a flat facade) | procedural instanced facade | S–M |

## Shared rules

1. **Flash safety.** All three flash lights on the beat. Under `reducedFlash`: cap at 3 flashes/s, cut each jump to ~40%, raise the dark floor so lit vs unlit is never full black to full white.
2. **Lights are the instrument.** In all three, geometry stays still and lighting carries the music. Camera motion is small and slow (drift and gentle push-ins), so the flashing reads clearly.
3. **Silence.** With no audio each scene sits in a calm "idle" state (described per mode), never black and never frozen mid-flash.

---

## 1. Night Parlour (`nightParlour`), source A

**What the reference shows.** A warm, cluttered old-fashioned living room seen face-on from a low, slightly wide camera. Centre-back: a big three-pane bay window. In front of it, two contrasting armchairs side by side: a squat leather club chair with a knitted throw over the back and a striped cushion, and a tall wingback in faded floral needlepoint with a round footstool. Left: a pale mantelpiece and fireplace with tools, a gramophone with a petal horn on a small cabinet, a side table with pill bottles and a lamp with a fabric shade, bookshelves, framed pictures, a birdhouse ornament. Right: a curio shelf of knick-knacks and a stained-glass table lamp on a round pedestal table. Floor: wood boards, a big round braided rug in blue-greens, a small woven mat. Wallpaper: faded floral, warm beige. In the reference the light is daylight; the user wants **night**.

**Night version (target look).**
- Window: deep blue night sky outside with a few stars, a soft moon glow off-frame, maybe distant rooftops as dark silhouettes. Cold blue moonlight falls through the panes as long window-shaped shapes on the rug and chairs.
- Interior: dark, warm, low key. Light comes only from the two lamps (warm amber), a faint fireplace glow (orange, low) and the window (cool blue). Strong warm/cool contrast is the point.
- Dust motes drift in the window light beam.

**Build.**
- Room: a box with the bay window recessed in the back wall (three panes with mullions, sills, wainscot below). Wallpaper, wood floor, braided rug and fabrics are procedural TSL materials: tiled damask noise for wallpaper, plank pattern with grain for the floor, concentric braid rings with per-ring colour for the rug, woven/needlepoint normal patterns for the chairs.
- Furniture in code (rounded boxes, lathes, tubes, bent planes): club chair, wingback, footstool, two side tables, mantel and fireplace, gramophone (lathe horn with petal ripple), two lamps (fabric shade cone, stained-glass dome with leaded-panel shader), shelves with simple knick-knack primitives, picture frames with blurred paintings.
- Lights: 2 point lights at the lamp bulbs (warm, shadows off or 1 cheap shadow), one rect/spot light through the window (cool, casts the pane pattern via a cookie texture), a flicker light in the fireplace. Volumetric beam through the window (cheap cone with noise).
- Camera: locked, wide, eye level of a seated person; ±1% drift; slow 1.5% push-in on strong hits, eased back.
- Finish: warm halation round the lamps, soft vignette, light grain, mild AgX.

**Audio.**
- Kick → **window flash**: the night sky and moon beam brighten (a soft lightning or passing-light feel), the pane shadows on the rug pop then fade over ~0.4 s.
- Snare → **lamp flash**: the two lamps pulse together or alternately (seeded table: both / left / right, never same twice); the stained-glass lamp's panels light one colour group at a time.
- Bass → fireplace glow level and the warm fill.
- Hats → dust-mote sparkle in the beam.
- Loudness → overall exposure of the warm side; the room never goes fully dark.
- Optional touch: the gramophone record spins at a speed tied to tempo.
- Idle: lamps on low, steady moonlight, fireplace embers.

## 2. Slot Hall (`slotHall`), source B

**What the reference shows.** A small, enclosed casino room in late-90s real-time 3D style: low poly, low-res textures with visible texels, no smoothing. Back wall: a row of 7 identical upright slot machines (red top panel with a big "7" in a circle, white reel window with three reels, chrome trim, black base cabinet, a pull lever on the side). Two red-topped chrome stools in front. Red velvet rope on brass stanchions in the foreground. Above the machines a black LED "JACKPOT" sign with a dollar figure. Walls: deep red with a small gold diamond/cross pattern, a gold dado rail, a darker lower panel. A gold-framed cornice with a row of marquee bulbs (dots) running round the top of the room. Ceiling: black with a starfield. Floor: a busy purple/navy casino carpet with red and gold starbursts. A red door on the right with a porthole.

**Build.**
- Everything low poly in code: machines as boxes and bevel-free prisms; one machine geometry instanced 7 times (each with its own reel state).
- Textures procedural but **sampled low-res with nearest filtering** (64–128 px per surface) so texels are visible: carpet starburst pattern, wallpaper diamonds, "7" emblem, reel symbols (7, bar, cherry, bell), the sign's dot-matrix digits.
- Retro pass (post): render at ~320×240 equivalent (scale by aspect), nearest upscale; vertex snapping to a coarse grid (PS1 jitter); affine-looking texture warp optional; 15-bit colour quantise with ordered dither. Reuse the pixel-grid approach from Relic Glow where it fits.
- Lights: flat vertex-style lighting plus emissive surfaces; a few coloured point lights at the machines.
- Camera: standing eye height, angled toward the machine row like the reference; slow ±3° yaw sway; on drops, a short dolly along the rope.

**Audio.**
- Kick → machine tops flash (the "7" panels light up); a seeded pattern picks all / odd / even / chase left-to-right, never the same twice.
- Snare → the marquee bulb row round the cornice chases one step per snare; at high energy it runs continuously.
- Every bar (or every 4th kick) → one machine's reels spin and stop; strong hits can land a three-of-a-kind on one machine, which flashes its whole cabinet and rolls the JACKPOT counter up.
- Bass → red wash on the walls and carpet glow.
- Hats → starfield twinkle on the ceiling; reel-window shimmer.
- Loudness → jackpot sign brightness; the counter always ticks up slowly with energy.
- Idle: dim machines, marquee bulbs slow chase, counter still.

## 3. Window Grid (`windowGrid`), source C

**What the frames show.** A face-on, flat view of a huge, dark Soviet-style apartment block at night filling the whole frame: a dense grid of ~22 columns × ~45 rows of small windows (some paired), dark grey concrete, faint balcony rails, unlit windows dark navy/grey. A faint horizontal band of lighter, misty windows near the top. Lit windows are small solid rectangles in **bright acid green**, with a soft glow. Late in the clip (~10–12 s) the colour switches to **amber/orange and magenta**.

**Timeline.**
- At rest only a few faint green windows are on.
- On hits a burst of 30–80 windows lights at once, scattered across the whole facade (not a shape or a wave): a hard on, then a fade over ~0.4–0.6 s down to a dim level.
- Some bursts are full-facade, some only fill a band (top half, a horizontal strip, one row of windows lit across), roughly every other hit.
- Between big hits, single windows flick on and off, sparsely (hat-like).
- Palette change near the end: amber plus magenta, mixed in one burst.
- Camera: dead still, slight soft focus; very slight vertical drift.

**Build.**
- Facade: one big plane with a procedural concrete shader (panel seams, stains, balcony bands) plus an instanced quad per window (~1,000 at full tier). Each window has an id, a row/column and a random seed in an instance attribute; brightness is a uniform-driven function computed in TSL from a per-hit seed, so no per-window CPU work.
- Window interior: when lit, a flat emissive colour with slight per-window variation (curtain gradient, a darker frame edge, occasionally a silhouette shape); unlit is dark glass with a faint reflection.
- Mist band: a soft horizontal fog layer high on the facade.
- Camera: orthographic-feeling long lens, locked; ±0.5% drift.
- Finish: bloom on lit windows (glow is the look), grain, slight soft focus, vignette.

**Audio.**
- Kick → scatter burst: a seeded random mask lights N windows, N scaling with `hits.level` (30 → 150).
- Snare → a structured pattern instead of a scatter: one row lit across, a column, a block, a diagonal, or the top/bottom half (seeded table, no repeats).
- Hats → single windows flick on for 2–3 frames.
- Bass → the dim afterglow level (lit windows linger longer with heavy bass).
- Loudness → how many stay faintly on between hits.
- Palette: starts acid green; a section change (sustained energy jump or every 32 bars) swaps to a new palette from a set: green, amber + magenta, cyan, red, white. Never the same twice in a row.
- Idle: a few faint warm windows, like a real building at 3 a.m.

---

## Open questions

1. Night Parlour: should the window flash read as **lightning** (white-blue) or as **passing headlights / city lights** (warmer, sweeping)? Spec assumes lightning-soft.
2. Slot Hall: how strong should the retro pass be: full PS1 (jitter, dither, low-res) or a cleaner low-poly look with just pixel textures?
3. Window Grid: keep it **exactly flat** (no 3D building, like the clip), or allow a slight perspective tilt so the facade reads as a building?

---

# Batch 2: 14 clips (2026-10-26)

Source: 14 phone screen recordings (3.7–15.1 s; 13 portrait 1170×2532, one landscape 1022×766, one 1170×1684). Each was read as a 16-frame contact sheet spread evenly over the clip. Unlike batch 1, **these clips have audio**, so each section gives a rough tempo and hit rate measured from the soundtrack (spectral-flux onsets, ±10 BPM; treat as a guide, not a beat grid). Platform UI is in the frames; ignore it.

Same working assumptions and shared rules as batch 1.

## Batch 2 index

| # | Clip (source) | Id | Label | Verdict vs existing | Build | Effort |
|---|---------------|----|-------|--------------------|-------|--------|
| 4 | melodysheep_, light streak through night clouds | `cloudTracer` | Cloud Tracer | new (decided); reuses Thunderstorm Sky's clouds, neon tracers | procedural | M |
| 5 | taruna24, bioluminescent surf | `glowTide` | Glow Tide | new (nearest: Audio Ocean, Moon Pond) | shader + foam sim | M–L |
| 6 | landscape concert clip, eye screens + lasers | `eyeStage` | Eye Stage | new (decided); TouchDesigner-style layered set, faced straight on | procedural 2D compositor | M–L |
| 7 | vaporwave_1980, anime motorcycle rider | `nightRider` | Night Rider | waiting on user-supplied assets | assets | L |
| 8 | ulassarik, toon fire over a burning car | `toonBlaze` | Toon Blaze | new (nearest: Ember Smoke, which is soft smoke, not cel fire) | procedural | M |
| 9 | voidbloom0, aerial cyberpunk city | `neonOverlook` | Neon Overlook | new (decided): top-down angle; reuses Neon Megacity code | procedural | M |
| 10 | futurewifellc, LIDAR forest path | `lidarTrail` | LIDAR Trail | new (shares a point-cloud engine with #12) | procedural points | M |
| 11 | caroleann.vi, flower made of glyphs | `glyphBloom` | Glyph Bloom | new (reuses the ASCII/Halftone glyph idea) | procedural flower + glyph pass | M |
| 12 | sko.hr via touchdesigner, glowing plant scan | `scanSprout` | Scan Sprout | new (shares the engine with #10; nearest look: Lantern Tree) | procedural points + plexus | M |
| 13 | v2olin + elfilter_a, blob tracking on a photo (two clips) | `blobTrack` | Blob Track | one mode for both clips (decided); fixed images + webcam | image + overlay | S–M |
| 14 | kemal.akblt, thermal fish | `heatShoal` | Heat Shoal | new | procedural fish + smear pass | M |
| 15 | sherryism, hands on frosted glass grid | `glassHands` | Glass Hands | new (reuses `handModel.ts`; nearest: Claw Hands, a different look) | code hands + blur | M |
| 16 | bolek_3d, foggy towers seen from below | `fogTowers` | Fog Towers | new: one gothic-brutalist tower, shot cuts, one window per shot | procedural | M |

That is 14 clips in 13 rows: the two blob-tracking clips share #13. All are new modes. Waiting on assets: #7.

---

## 4. Cloud Tracer (`cloudTracer`), melodysheep_, 11.2 s

**Decided: new mode** (user, 2026-10-26). It reuses Thunderstorm Sky's cloud volume, but the tracer beam is the subject, and it gets live neon colour so it pops.

**What the frames show.** Deep navy night sky full of heavy, billowy cumulus. A thin, bright, dotted line of cyan-white light (like a tracer round or a comet trail made of beads) cuts through the frame on a straight diagonal, lower-left to upper-right. The clouds near it glow blue-white from inside where it passes; clouds far from it stay dark navy. Later the line turns vertical, then horizontal; each new line lights a different cloud bank. ~8 s on, the recording jumps to another post (a blue nebula, then the phone's control centre): ignore everything after ~8 s.

**Audio (measured).** ~123 BPM but sparse: only ~0.4 strong hits per second (hits at 2.1, 5.6, 7.9 s). An ambient track; the line changes direction on the big hits.

**Build.**
- Clouds: the storm's raymarched cloud volume, darker and bluer; lit by a moving line light (distance-to-segment falloff inside the march), plus faint moonlight from above. The cloud glow takes the tracer's colour where it passes.
- Tracer: a segment of beads (instanced glowing points, 3–4 px gaps) with a bright white-hot head and a tail that runs through a **neon gradient** (e.g. cyan → magenta → violet, or lime → cyan), colour shifting along its length and over time. Palette set: cyan/magenta, lime/cyan, amber/pink, ice white (classic). Bloom.
- Up to 3 tracers at once at high energy, each its own palette.
- Camera: slow drift upward through the cloud field.
- Finish: bloom, fine grain, deep vignette.

**Audio mapping.** Big hits → a new tracer on a new heading (diagonal / vertical / horizontal table, no repeats), and a bright flash where it enters a cloud. Mids → hue drift along the gradient. Bass → how far the inner glow spreads. Loudness → tracer speed and bead brightness. Hats → twinkle on the beads. Section change → next palette. Idle: one slow tracer, dim clouds.


## 5. Glow Tide (`glowTide`), taruna24, 5.7 s

**What the frames show.** A night beach with bioluminescent surf: waves break as bright, saturated cyan-blue foam (near white at the crest) over black-blue water. The foam spreads in lacy, sponge-like patches and in **spiral swirls** on the wet sand. A dark rocky headland top right. In the second half the camera pulls back and up to show a starry sky with the Milky Way above the bay. (AI-generated per its caption.)

**Audio (measured).** ~161 BPM, sparse (~0.7 hits/s). Calm, waves-paced.

**Build.**
- Water: the Moon Pond/Audio Ocean height field, very dark; foam as a separate advected density field (2D sim on the surface) that glows cyan where it is dense, with a curl-noise flow that makes the spirals.
- Breaking waves: a line source of foam that sweeps up the beach every wave and drains back.
- Sand: wet, dark, reflective; foam on it leaves glowing lace that fades.
- Sky: stars + a Milky Way band shader, shown when the camera rises.
- Camera: low over the surf, slow pull back and up over ~20 s, then return.
- Finish: bloom on foam, cool grade.

**Audio mapping.** Kick → a wave breaks (fresh foam line, brighter for stronger hits). Bass → wave height. Mids → swirl strength in the foam flow. Hats → sparkle points in the foam. Loudness → overall glow. Idle: slow small waves, faint glow.

## 6. Eye Stage (`eyeStage`), concert clip (landscape), 12.8 s

**Decided: new mode**, a TouchDesigner-style live visual set: several layers rendered at once that switch and transition on the music. In the clip the visuals are projected onto a ceiling, which is why everything looks tilted; **ours faces the viewer straight on** (flat, full-frame composition), so no trapezoids.

**What the frames show (re-read at 4 fps, 51 frames).** One composition made of stacked, collaged layers, all in high-contrast black and off-white (photocopy / threshold look) with magenta accents:
- **Hero eye**: a huge realistic eye with lashes, as a thresholded photo, inside a panel that changes shape (rectangle, circle, crescent, a panel with a notched corner). It zooms in until the iris fills the frame, then pulls back out.
- **Lens rings**: concentric rings / camera-lens circles, a hand holding a lens or magnifier, iris diagrams.
- **Icon rails**: rows and columns of small eye/ring icons that form a frame around the hero panel (top row + side columns), sometimes a full border of them.
- **Text blocks**: dense scrambled text and big glitchy digits ("205").
- **Magenta neon outlines**: a glowing magenta line traces along the contours of the eye and panels (like a laser drawing), sweeping round the shape.
- Physical lasers (white-blue fans) and purple washes in the room; those are stage lights, not part of the projection.

**Timeline.** Roughly a new composition every 0.5–1 s; transitions are hard cuts, zoom-throughs (zoom into the iris, cut to a new layout), panels sliding and rescaling, the panel mask morphing (rect → circle → crescent), and the icon border appearing/disappearing. Around 7.5–9 s it settles on one framed eye with the magenta outline tracing round it, then the icon border comes back (~12.5 s).

**Audio (measured).** ~99 BPM with dense hits (~3 per second). Cuts land on hits.

**Build.**
- Compositor: a full-screen 2D layer stack in TSL (each layer = a shape mask + content + transform), switched by a small "scene" table. 6–8 scene layouts: big eye alone; eye + lens column; eye framed by icon border; grid of small eyes; text wall + digits; zoom-through.
- Content drawn in code: eye (SDF almond + iris with radial fibres + pupil + lash strokes + highlight), lens rings, hand silhouette with lens (simple SDF), text blocks (procedural glyph noise), digits. Threshold + grain to get the photocopy look.
- Magenta outline: an animated dash travelling along the eye/panel SDF contour, glowing.
- Stage light layer (optional, on by default): thin white-blue laser fans and a purple haze sweep **in front of** the content as a soft overlay, so it still feels live.
- Transitions: cut, zoom-through, slide, mask morph, RGB-split glitch frame; picked per hit from a no-repeat table.
- Camera: none (flat); slow 1–2% breathing scale on the whole stack.
- Finish: slight bloom on whites and magenta, grain, mild chromatic fringe.

**Audio mapping.** Kick → next transition (cut or slide; zoom-through on strong hits). Snare → magenta outline sweep + laser fan. Bass → hero eye scale (pushes in) and purple wash. Mids → iris dilation and blinks. Hats → icon rail flicker and text scramble steps. Loudness → white level. Section change → new scene set.


## 7. Night Rider (`nightRider`), vaporwave_1980, 12.0 s: **waiting on assets**

The user will supply the assets (2026-10-26); no build spec until they arrive. A 90s-anime-style rider on a sport bike through a neon city, cut as a sequence of shots: wide city, rear chase, low front with twin headlights, helmet close-up, parked at a shop front, overlooking a city at dusk. Any version should be our own character and city, not a copy of the reference artist's. Asset list has the items. ~129 BPM, ~2.6 hits/s: shot cuts on hits.


## 8. Toon Blaze (`toonBlaze`), ulassarik, 7.4 s

**What the frames show.** A car (a sedan or taxi) burning in a city street at night, in **cel-shaded, non-photorealistic 3D**: a huge column of fire and smoke billowing up and to the left, made of round, puffy blobs with hard-edged toon shading (bright yellow core, orange, red, then maroon smoke with darker red shadows). Flame tongues are hard-edged too. Skyline of lit windows behind, red-black sky. Near the end the clip shows its own breakdown: a grey clay render of the car and smoke puffs, the skyline alone, then the toon pass building up.

**Audio (measured).** ~123 BPM, ~1.8 hits/s.

**Build.**
- Fire/smoke: a column of a few hundred instanced spheres (or a metaball/SDF raymarch) rising on a curving path with noise, growing as they rise; toon shading by quantising lighting into 3–4 bands with hard edges, colour ramp from yellow at the base to maroon at the top, plus an inverted-hull outline.
- Flames: flipbook-free code flames: noise-displaced cones with banded colour.
- Car: a code-built sedan (reuse the Relic Glow hatchback approach), dark silhouette with fire light on it.
- City: instanced towers with window grid (reuse Neon Megacity / Window Grid code), flat red sky gradient.
- Camera: locked medium-wide, slight push-in.
- Finish: no bloom (toon look stays crisp), mild grain.

**Audio mapping.** Kick → a new burst of puffs from the car (bigger with `hits.level`). Bass → flame height and the base glow. Mids → column sway. Hats → spark embers. Loudness → overall fire size. Idle: a smouldering car, slow smoke.

## 9. Neon Overlook (`neonOverlook`), voidbloom0, 10.1 s

**Decided: new mode** (user, 2026-10-26): Neon Megacity is seen from the horizon; this one looks **down from above**, and adds neon signs and holo rings. It reuses Neon Megacity's tower and sign code.

**What the frames show.** A slow aerial view down onto a dense cyberpunk city at night: blue-cyan towers with big glowing billboards (pink, red, green), holographic rings floating above rooftops, **red light-trail highways curving through the streets**, fog and rain specks. Almost no camera motion (slow drift). ~144 BPM, ~1.7 hits/s.

**Build.**
- Camera: high above, looking down at ~50–60°, slow drift and a very slow orbit; occasional slow dolly between districts.
- Towers: Neon Megacity's instanced towers, seen from above (roofs matter: antennas, helipads, roof lights).
- Neon signs: vertical and horizontal billboards on tower faces (code-drawn glyphs, logos, scrolling text), pink/red/green/cyan.
- Holo rings: floating glowing rings (single and stacked) above the tallest towers, slowly rotating.
- Traffic: red and white light trails on curved spline roads between blocks (instanced streak particles).
- Fog layers between height bands; rain specks.
- Finish: bloom, cool grade with warm sign accents, grain.

**Audio mapping.** Kick → holo rings pulse and expand; billboards flash. Snare → a sign changes content. Bass → traffic speed and trail length. Hats → rain and window sparkle. Loudness → overall sign brightness.


## 10. LIDAR Trail (`lidarTrail`), futurewifellc, 14.3 s

**What the frames show.** A monochrome, grainy view walking down a forest path at night, rendered as a **dense point cloud** (LIDAR scan): trees, bushes and the ground are made of millions of fine white points, bright near the camera and dark far away. The path leads into a dark tunnel of trees. The scan smears and jitters (points scatter outward, ghost trails), and the brightness pulses. Caption says "real-time audio-reactive rendering of LIDAR".

**Audio (measured).** ~96 BPM, ~2.5 hits/s.

**Build.**
- Point cloud: generated in code: a path ribbon, trees (trunks as cylinders of points, crowns as noisy point blobs), bushes and grass; ~1–2 M points at full tier (GPU points, size by depth).
- Shading: white points, depth-fade to black, slight bloom; scanline sweep (a bright plane that moves through the scene, like a scanner pass).
- Camera: slow walk forward along the path, endless (recycle chunks).
- Finish: heavy grain, slight motion smear (feedback blend), black-and-white.

**Audio mapping.** Kick → points scatter outward from their positions and snap back (displacement along normal, scaled by `hits.level`). Snare → a scanner sweep passes. Bass → point size and exposure. Hats → jitter. Loudness → walking speed. Idle: still scan, slow walk.

## 11. Glyph Bloom (`glyphBloom`), caroleann.vi, 10.3 s

**What the frames show.** A single large flower (peony/hibiscus-like, ruffled petals) on black, drawn entirely from **tiny glyphs/dots** (an ASCII or dot-matrix render), so it looks woven from text. Colour changes between shots: white-grey, red with white highlights, blue, red again; dark leaves behind it are drawn the same way in dim grey. The flower turns slightly, petals flutter, and at some moments the glyphs break up and drift.

**Audio (measured).** ~123 BPM, ~1.5 hits/s.

**Build.**
- Flower: code-built petals (curved, ruffled planes in a layered rosette) and a few leaves, rendered normally to a buffer.
- Glyph pass: reuse the ASCII/Halftone Terminal approach: sample luminance per cell and draw small glyphs (dots, dashes, letters) in the flower's colour; very small cells (~4 px).
- Colour: palette per section: white, red, blue, red/white mix.
- Camera: slow orbit ±20°, slight push-in.

**Audio mapping.** Kick → palette swap (no repeats) and a petal flutter. Bass → bloom opens/closes slightly. Hats → glyph shimmer (cells change character). Loudness → glyph density. Strong hits → the glyphs scatter and reform.

## 12. Scan Sprout (`scanSprout`), sko.hr (via touchdesigner), 9.3 s

**What the frames show.** On black, a bright acid-green plant (big leafy weed or sunflower-like stem) rendered as a **glowing point cloud scan**: leaves are fine green particles with bright white-green hot spots, plus **plexus lines** (thin straight lines connecting points) shooting out from it. The plant **grows** over the clip: low and bushy at the start, then a tall stem rises with leaves unfolding until it fills the frame. Faint stars in the background, sparkle flares.

**Audio (measured).** ~129 BPM, ~1.3 hits/s.

**Build.**
- Shares the point-cloud engine with #10.
- Plant: code-grown (L-system stem + leaves as point-filled shapes), animated growth from 0 → full over 20–30 s, then resets.
- Plexus: connect random nearby points with thin additive lines; lines flicker.
- Finish: strong bloom, green glow, starfield.
- Camera: slight orbit and tilt up as it grows.

**Audio mapping.** Kick → a growth step (a new leaf unfolds) and a plexus burst. Bass → glow level. Hats → sparkle flares. Loudness → particle shimmer and growth speed.

## 13. Blob Track (`blobTrack`), v2olin (3.7 s) + elfilter_a (11.9 s)

**Decided:** one mode for both clips; it ships with **fixed images** (free-licence photos we pick) and has an option to **use the webcam** as the source. Reference frames are in [wave-six-blob-track/](wave-six-blob-track/).

**What the frames show.**
- Clip a: a photo of a blue butterfly on a white flower, green bokeh background. Over it, **tracked boxes** appear on the most detailed spots: small rectangles, each with a number label, showing the image inside inverted, colour-shifted (purple) or replaced with a scrap of another picture, joined by thin lines.
- Clip b: a cut-out bouquet of pink-white blossoms and green leaves on dark grey. Patches are replaced by rectangles (white boxes, outlined boxes with X crosses, shifted copies); on some hits the whole image vanishes to just the **box outlines and connecting lines**, then comes back.

**Audio (measured).** a: ~129 BPM, sparse. b: ~108 BPM, ~2.5 hits/s; the "lines only" frames sit on hits.

**Build.**
- Sources: the bundled butterfly and blossom images, **transitioning between the two** (user, 2026-10-26). Each image also has **colour variants**: the butterfly's wings and the flowers recoloured in code (hue shift inside a wing/petal mask from the saliency map, e.g. blue → violet → teal → orange wings; white/pink → coral → lilac → yellow blossoms), so a few photos give many looks.
- Transitions: on a **beat drop** (energy jump after a build) or after a set time with no drop (default 30 s, slider 10–90 s), switch image or colour variant, never the same twice in a row. Transition styles: the boxes multiply until they cover the frame and reveal the next image inside them; a "lines only" blackout then cut; or a box-by-box wipe.
- Webcam: an alternative source (`getUserMedia`, asked only when the user turns it on; frames never leave the browser).
- Detection: not real blob tracking; pick box positions from a saliency/edge map computed on the GPU from the source (bright, edge-dense areas), re-sampled per hit. For the webcam, recomputed every few frames so boxes follow movement.
- Boxes: 10–40 rects, each with one effect (invert, purple tint, offset copy, white fill, X-crossed outline, number label), joined by thin lines in a chain or to nearest neighbours.
- Camera: none (2D).

**Audio mapping.** Kick → new box set (count by `hits.level`). Snare → "lines only" frame for ~100 ms. Hats → boxes jitter one step. Bass → box size. Loudness → box count. Beat drop or the timer → next image / colour variant (see Transitions).


## 14. Heat Shoal (`heatShoal`), kemal.akblt, 14.3 s

**What the frames show.** Fish (carp/koi silhouettes) swimming across black, coloured like a **thermal camera**: yellow-white cores, orange, magenta-purple edges. At first a few fish swim calmly and crisp. Then the image goes wild: fish are **stretched into long horizontal smears**, many more appear, rainbow chromatic fringing and VHS scanlines, and tiny coloured dust specks streak across. By the end only thin horizontal streaks remain.

**Audio (measured).** ~76 BPM (maybe half of ~152), ~1.9 hits/s. The calm-to-wild change is a build/drop.

**Build.**
- Fish: code-built 3D fish (tapered body, tail fin that bends with a swim wave in the vertex shader), instanced, 10–80.
- Thermal look: render fish "heat" to a buffer, map through a thermal ramp (black → purple → magenta → orange → yellow → white).
- Smear pass: directional motion blur along screen X, length driven by energy; chromatic split; scanlines; dust specks as streaked particles.
- Camera: locked.

**Audio mapping.** Loudness / section energy → smear length and fish count (calm at low energy, wild at the drop). Kick → a burst of new fish across the frame. Bass → heat (brighter cores). Hats → dust specks. Snare → chromatic split jump.

## 15. Glass Hands (`glassHands`), sherryism, 8.2 s

**What the frames show.** A grid (about 4 columns × 5 rows) of tall tiles, each a frosted white glass pane with a dark **hand silhouette pressed against it from behind**: palms and fingers sharp where they touch the glass, blurry where they pull away. Hands appear, press, slide and fade in each tile at different times. Some tiles flip to inverted (white hand on black) or show a pale green-grey hand. Monochrome.

**Audio (measured).** ~123 BPM, ~1.6 hits/s; dense run at 2.5–4.3 s matches a flurry of tile changes.

**Build.**
- Hands: reuse `handModel.ts` (code hand), rendered as silhouettes behind a frosted-glass shader: blur radius grows with the hand's distance from the glass, so contact points are sharp.
- Grid: 20 tiles (12 at lowest tier), each its own small scene or a shared hand atlas rendered to tiles.
- Each tile: idle (empty frost) → hand approaches → press → slide/drag → fade. Poses from a small table: open palm, two hands, fingertips, fist, sliding down.
- Camera: none (flat grid).

**Audio mapping.** Kick → 1–3 tiles get a new hand press (seeded). Snare → one tile inverts (white on black) for a beat. Bass → how hard hands press (sharper contact). Hats → small finger taps. Loudness → number of active tiles.

## 16. Fog Towers (`fogTowers`), bolek_3d, 15.1 s

**Decided (user, 2026-10-26):** one futuristic **gothic-brutalist** tower. The mode **jumps between different parts of the tower** (cuts, like the scroll), and in each shot **only one window or room flashes**.

**What the frames show.** A profile being scrolled, so a gallery of related stills: huge, dark brutalist high-rises seen from the ground looking up, disappearing into heavy fog. Palettes: teal-green fog (most), grey, red, purple, pink-beige. A few windows glow **warm orange-red**, small and lonely. Rain/grain. One frame is a white wireframe/clay render of a tower.

**Audio (measured).** ~123 BPM, ~1.1 hits/s (mixed songs, one per post).

**Build.**
- Tower: one tall procedural tower (400–800 m) with a gothic-brutalist facade: stacked concrete slabs, deep vertical fins and buttress ribs, pointed/stepped crowns, recessed balcony bays, cantilevered blocks, varying by height so each part looks different.
- Shots: a table of camera set-ups on the tower (base looking straight up, mid-height corner, crown in fog, close on a balcony band, a cantilever from below, wide silhouette). The camera holds each shot with a slow creep, then **cuts** to the next.
- Windows: all dark except **one window or room per shot** that lights warm orange-red (sometimes a small cluster of 2–3 in the same room), with interior glow and light spill on the fins.
- Fog: thick height + distance fog with a soft glow from above in the palette colour.
- Palette set: teal, grey, red, purple, beige; one per section.
- Finish: heavy grain, rain streaks, vignette.

**Audio mapping.** Kick → the shot's one window flashes (bright pop, slow fade). Strong hit or every 2–4 bars → cut to the next shot (new part of the tower, new window). Bass → fog density and the glow from above. Section change → palette swap. Hats → rain. Loudness → window brightness. Idle: one dim window, slow creep.


---

## Batch 2 decisions (user, 2026-10-26)

1. #9: new mode `neonOverlook` (top-down angle), with neon signs and holo rings.
2. #6: new mode; TouchDesigner-style layered set, faced straight on (not the ceiling angle).
3. #4: new mode with neon gradient tracers.
4. #13: one mode, fixed free-licence images plus a webcam option; transition between butterfly and blossom, with recoloured variants, on a beat drop or after a set time.
5. #7: user will supply the assets.
6. #16: one gothic-brutalist tower, cutting between parts, one window flashing per shot.
7. The minor overlaps (#10/#12 shared engine, #11 glyph pass, #15 hand model) are fine.
