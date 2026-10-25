# Wave 4b asset brief (hand to the modeller or the building agent)

Companion to `2026-10-24-wave-four-modes-design.md`. That doc says what each mode looks and sounds like; this one says exactly what art files each model-dependent mode needs, in what format, and where it plugs in. Every mode ships first with a **procedural fallback**, so a missing file never blocks code; the assets upgrade the look.

## 0. File types we need

| Need | File type | Notes |
|------|-----------|-------|
| 3D models | **`.glb`** (glTF 2.0 binary) | The only 3D format we load. One file per kit. Textures embedded. Export from Blender (File > Export > glTF Binary), or Cinema 4D / Maya via glTF exporter. |
| 3D sources (optional) | `.blend` or similar | Keep for edits; not loaded by the app. |
| 2D layers | **`.png`** RGBA, 8-bit, sRGB | One file per layer, transparent background, alpha not premultiplied. |
| Full-colour reference | `.png` or `.jpg` | Flattened composite so we can match colours. Not shipped. |
| Wireframe sculptures | `.glb` (line or thin-tube mesh) | See Kit C. |

Not accepted: `.fbx`, `.obj`, `.c4d`, `.max`, `.psd` (flatten layers to PNGs), `.gltf` with external files (use `.glb`), KTX2 (we compress later).

Where files go: `public/assets/modes/<modeId>/` (for example `public/assets/modes/underground/kitA.glb`). Name exactly as listed below.

## 1. Rules for every 3D kit

- **Units and axes:** Y-up, 1 unit = 1 metre, -Z forward. Apply all transforms (scale 1, rotation 0) before export. Origin at the bottom centre of each piece.
- **Triangles:** whole kit under 25k triangles; the largest single piece under 3k (golem excepted: 12k).
- **Materials:** one PBR material per kit using a single atlas (baseColor, normal, occlusion-roughness-metal), 2048 px max. Use the glTF metallic-roughness model.
- **Emissive parts are separate material slots** named `emissive_<name>` (for example `emissive_tube`, `emissive_window`). The engine drives their intensity from audio. Emissive base colour should be pure white; we tint in code.
- **Object names are the contract:** every piece is a separate named node (listed per kit). Do not merge pieces; do not rename.
- **Snap grid:** modular pieces are 4 m wide and 4 m tall unless noted, so they butt together without gaps.
- **No animation, rigs, cameras or lights in the file, with two exceptions listed in section 6** (the lava golem and the wireframe birds). Everything else is animated in code and ships static.
- **Normals:** outward, no flipped faces. Double-sided only for alpha cards.

## 2. 3D kits (4b)

### Kit A: Industrial modular kit — `kitA.glb` — used by `underground`, `redStairwell`, `warehouseHall`
Nodes (4 m grid):
- `wall_plain`, `wall_window`, `wall_pipes`
- `pillar_square` (0.6 m square, 4 m tall), `girder_straight` (4 m), `girder_corner`
- `floor_slab` (with a rail groove), `catwalk_grate`, `ceiling_slab` (with a light slot)
- `stair_flight` (straight, with railing), `stair_landing`, `ladder`
- `light_tube` (emissive_tube), `light_caged` (emissive_bulb), `light_flood` (emissive_lens)
- For `underground` only: `shaft_ring` (a 6 m diameter round hatch frame, 0.5 m thick), `rail_track` (4 m), `tram_carriage` (about 12 m long, ≤2k tris, `emissive_window` slots for each window)
- For `warehouseHall` only: `panel_red` (a wall-mounted light panel, `emissive_panel`)

What it looks like: dark concrete and steel, worn, matte; see the Underground and Warehouse references (concrete wall with repeated round portholes; long corridor of square pillars with floor rails and amber wall lights). Roughness mostly 0.6–0.9.

### Kit B: Temple shaft kit — `kitB.glb` — used by `templeDescent`
- `tier_a`, `tier_b`, `tier_c` (carved facade blocks, 4 m wide, columns and niches; tileable on the vertical axis)
- `corner_block`, `stair_run`, `ledge`
- `cap_slab` (a flat slab with a square opening in the centre, for the lit opening at the top)
- Optional: `lantern_a`, `lantern_b`, `chain`

Look: dark stone, ornate stepped tiers, receding upward to a bright square opening; teal haze is added in code.

### Kit C: Wireframe light sculptures — `kitC.glb` — used by `lightForest`
Thin-tube or line meshes (tube radius about 1 cm at scale 1 m), **no solid surfaces**, because the look is white line-art made of light:
- `hummingbird_a`, `hummingbird_b` (about 40 cm wingspan)
- `chair` (1 m tall, spindle back), `door_frame` (2 m tall)
- `moon_crescent` (50 cm), `bird_flight` (60 cm wingspan, wings up), `hoop` (a 1 m ring)
Emissive slot: `emissive_line` on everything. The forest floor itself (ferns, grass, trunks) stays procedural. `hummingbird_a`, `hummingbird_b` and `bird_flight` carry a wing-flap morph target (see section 6); the rest are static.

### Kit G: Lava golem — `kitG.glb` — used by `lavaGolem`
One character, rigged and animated (see section 6). Model it in a hunched idle pose, split into named parts, with a skeleton:
- `torso`, `head`, `arm_l`, `arm_r` (upper arm and forearm as one piece each), `leg_l`, `leg_r`, `fist_l`, `fist_r`
- Keep the parts as separate named nodes for materials and for the code fallback; each part's origin is at its joint (shoulder, hip, neck, wrist). In the animated version the parts are skinned to the skeleton in section 6.
- Total 8–12k tris. Chunky grey stone, hulking, readable silhouette; see the Lava Golem reference (hunched stone brute with glowing red veins).
- `emissive_cracks`: a separate material (or a second UV set and mask texture) for the glowing cracks over the whole body; we pulse it with bass.
- Optional: `ember_rock` (small glowing rock, 10 cm) for the ground.

### Kit H: Stair and scaffold kit — `kitH.glb` — used by `endlessStairs`
- `stair_flight` (with stringers and a handrail), `stair_landing`
- `scaffold_tube_2m`, `scaffold_tube_4m` (thin, 4.8 cm diameter), `scaffold_clamp`
- `floor_plate` (4 m x 4 m, perforated), `handrail`
- `strip_light` (emissive_strip, 1 m)
If you build Kit A stairs first, you can reuse them and only add the scaffold tubes, clamps and plates here.

### Optional: `coupe.glb` — used by `lightLeakFilm`
An 80s coupe, ≤6k tris, `emissive_headlight` and `emissive_taillight` slots. The mode works without it.

## 3. 2D layers (PNG) for `bloomTouch`, `poleSparks`, `redCrystalHall`

All at least 2048 px on the long side, RGBA, transparent where nothing is drawn. Keep each layer separate so we can move or light it.

### 2D-1: `bloomTouch` — `public/assets/modes/bloomTouch/`
- `hand.png`: a single stylised anime cel-shaded hand and forearm, index finger pointing up and to the right, in a flat pink-salmon skin tone with simple shadow shapes. Lit from the right; leave the left edge for a glow rim we add in code. The fingertip should be at roughly 60% from the left, 25% from the top of the image so we know the growth origin (also give us the exact fingertip pixel in a text file `hand.json` as `{"x": 0, "y": 0}`).
- Everything else (leaves, flowers, fireflies, sparks) is procedural.

### 2D-2: `poleSparks` — `public/assets/modes/poleSparks/`
Flat anime illustration (dark outlines, muted red and grey cables, grey-teal sky) split into:
- `sky.png` (opaque, grey-teal dusk gradient)
- `pole.png` (the pole, crossarms and big boxes)
- `cables_back.png`, `cables_front.png` (the tangle of wires, front and back for depth)
- `boxes.png` (the two junction boxes with the heart-shaped lights **blank/off**; we light them in code)
- `cable_paths.svg`: the centre line of each major cable as an SVG path (one `<path id="cable_01">` each, 15–30 paths). The pink pulses travel along these paths.
- `hearts.json`: pixel positions of the two heart lights.
Reference: the flat illustrated pole with pink pulses and heart lights.

### 2D-3: `redCrystalHall` — `public/assets/modes/redCrystalHall/`
A dark industrial cathedral matte painting split into depth layers (back to front):
- `hall_back.png` (opaque: far walls and ceiling in dark red-grey)
- `hall_mid.png` (side ribs, balconies, cables, with transparency)
- `hall_front.png` (foreground floor edge and silhouettes)
- `figures.png` (the three kneeling hooded figures, separate layer)
- `crystal_mask.png` (white where the crystal sits, black elsewhere; the crystal itself is procedural, so this is just a placement guide)
Reference: the colossal red crystal hung in a vast hall with three small figures kneeling below. The camera is locked; we add parallax and mist in code.

## 4. Acceptance checklist (give this to whoever builds or reviews the assets)

1. Opens in Blender, 1 unit = 1 metre, Y up, scale 1.
2. Exported as `.glb`; node names exactly match this brief.
3. Emissive slots present and named `emissive_*`.
4. Triangle counts under the limits.
5. One atlas material per kit.
6. 2D layers are RGBA PNGs, transparent background, at least 2048 px.
7. Files are in `public/assets/modes/<modeId>/`.

## 5. Which assets unblock which mode

| Mode | Needs | Fallback without it |
|------|-------|---------------------|
| `underground` | Kit A | cylinders and boxes |
| `redStairwell` | Kit A | boxes and pipes |
| `warehouseHall` | Kit A | boxes |
| `templeDescent` | Kit B | stacked procedural stepped boxes |
| `lightForest` | Kit C | simple procedural line shapes |
| `lavaGolem` | Kit G | stacked hex rocks with emissive seams |
| `endlessStairs` | Kit H (or Kit A) | boxes and cylinders |
| `bloomTouch` | `hand.png` | glowing fingertip dot |
| `poleSparks` | 2D-2 layers | procedural pole and cables |
| `redCrystalHall` | 2D-3 layers | octagonal box hall |
| `lightLeakFilm` | `coupe.glb` (optional) | none needed |

Suggested modelling order: Kit A, then Kit H, then Kit G, then Kit B, then Kit C; 2D layers can be painted in parallel.

## 6. Animation: what is animated, what stays static

**Rule:** anything not listed here ships **static** and is moved in code from the audio. Each animated asset adds loader work, a performance cost and harder modelling, so the list is deliberately short. Animation is always **gated by beats**: the clips play or blend on a trigger and speed up with bass, they are not free-running loops. The loader needs an animation player (`AnimationMixer`) added for skinned clips; morph targets need no extra work beyond reading the influence values.

### 6.1 Lava golem: skeletal animation (`kitG.glb`)
Type: **skinned mesh with a skeleton and baked clips**.

Skeleton (humanoid, 22 bones max; names exact):
`root` > `hips` > `spine`, `chest`, `neck`, `head`; `shoulder_l`, `upper_arm_l`, `forearm_l`, `hand_l`; same for `_r`; `thigh_l`, `shin_l`, `foot_l`; same for `_r`. Weight each vertex to at most 4 bones. Rest pose is the hunched idle.

Clips (24 fps, all exported in the same `.glb`, named exactly):
| Clip | Length | Loop | Purpose |
|------|--------|------|---------|
| `idle` | 2.0 s | yes | slow breathing and weight shift; plays between hits |
| `stomp` | 0.8 s | no | one heavy stomp, lands on frame 10 (the hit frame) |
| `slam` | 1.0 s | no | both fists driven into the ground, lands on frame 14 |
| `turn` | 1.2 s | no | head and torso turn toward the camera |

How it is used: bass drives the speed of `idle`; each impact crossfades (0.1 s) into `stomp` or `slam`, alternating, then back to `idle`. The landing frame is aligned to the audio hit by starting the clip a few frames early. Ground contact: the character stays pinned at the world origin (no root motion), so keep the root bone still.

Also needed: the `emissive_cracks` material (section 2, Kit G) must be on the skinned mesh so it deforms with the body. Triangle budget rises to 10–12k with a skeleton.

Fallback if the rigged file is not ready: the same character shipped as static parts moved in code (the earlier plan). The mode checks for the `stomp` clip at load and falls back automatically.

### 6.2 Wireframe birds: morph-target animation (`kitC.glb`)
Type: **morph targets (blend shapes)**, no skeleton.

For `hummingbird_a`, `hummingbird_b` and `bird_flight`:
- Base shape: wings up.
- One morph target named `wings_down`: the same mesh with the wings pushed down. Vertex count and order must be identical to the base.
- Optional second target `body_tilt`: a slight pitch of the body for variety.

How it is used: the code drives the `wings_down` influence from 0 to 1 and back at a rate set by the music (fast flap on hits, slow glide between). No baked clips, so nothing to loop or retime.

All other Kit C pieces (`chair`, `door_frame`, `moon_crescent`, `hoop`) stay static.

### 6.3 Explicitly static (do not animate)
Kits A, B, H, the `tram_carriage`, `coupe`, and all 2D layers. The tram slides along the rails and the camera moves in code. The hand image stays one pose.

### 6.4 Extra acceptance checks for animated assets
1. Skeleton bone names match 6.1 exactly; no more than 4 influences per vertex.
2. All four golem clips are in the file at 24 fps with the exact names and lengths; `stomp` and `slam` contact frames match the table.
3. Root bone does not translate during any clip.
4. Morph target `wings_down` exists on all three birds with the same vertex count as the base.
5. The file still loads with the animations removed (the code fallback relies on the static node names).
