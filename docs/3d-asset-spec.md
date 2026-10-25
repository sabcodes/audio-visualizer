# 3D asset spec: figure modes

This is a build brief for the models behind the figure modes listed in [backlog.md](backlog.md). It is written so that another agent (or an artist) can create each asset without asking questions. Section 1 holds the rules every file must follow, section 2 has one build sheet per asset, section 3 lists optional extras, and section 4 says how files are checked and delivered.

Where this spec gives a number, use it exactly. Where it says "about", stay within ±15%.

The app loads these files with Three.js 0.186 (`GLTFLoader`, `AnimationMixer`) and renders them with WebGPU or WebGL2. On top of the clips, the code adds audio-driven motion: head bobs on bass, neck waves, wing beats on onsets and glow on loudness. That code finds bones, materials and sockets **by name**, so names must match this document character for character.

---

## 1. Rules for every asset

### 1.1 File and export

| Rule | Value |
|------|-------|
| Format | glTF 2.0 binary, `.glb`, one file per asset |
| Units and axes | 1 unit = 1 metre; +Y up; the creature faces **+Z** |
| Origin | Walkers: on the ground, midway between the feet. Flyers: at the centre of mass (chest). |
| Transforms | All applied: scale 1, no rotation on mesh nodes, no negative scales |
| Compression | **None.** No Draco, no meshopt, no KTX2/Basis; the app ships no decoders. |
| Textures | Optional. If used: PNG or JPEG embedded in the `.glb`, power of two, at most 1024×1024, one atlas per asset preferred. Vertex colours (`COLOR_0`) or flat material colours are preferred. |
| Shading | Faceted low-poly look: flat-shaded (split normals per face) or hard edges on most surfaces |
| Size | Each `.glb` under 5 MB, ideally under 2 MB |
| Extensions allowed | `KHR_materials_emissive_strength`, `KHR_texture_transform`. Use no others. |
| Generator | Any (Blender glTF exporter, pygltflib, etc.). Blender: export with "+Y Up", "Apply Modifiers", animations "NLA tracks" or "Actions", and "Always Sample Animations" at 30 fps. |

### 1.2 Mesh

- Triangle budget per asset is given in its sheet. Count triangles, not quads.
- Faces must be closed, without holes visible from normal camera angles. Wing membranes and feather blades may be single-sided planes; set their material to `doubleSided: true`.
- Avoid detail smaller than about 1% of the model's height; it disappears at render scale 0.5.
- Mesh nodes take the name of their part (`body`, `wing_L`, `jaw` …), never `Cube.023`.

### 1.3 Materials

- glTF metallic-roughness PBR. Most surfaces: metallic 0, roughness 0.6–0.9.
- Each glowing part gets its **own material whose name starts with `emissive_`** (for example `emissive_eye`). Set `emissiveFactor` to the glow colour, with `KHR_materials_emissive_strength` at 1.0. The code multiplies the strength by audio level at runtime, so do not bake brightness into the colour.
- Non-glowing materials have `emissiveFactor` `[0,0,0]`.
- No alpha blending (`alphaMode` stays `OPAQUE`). `MASK` with cutout is allowed for feathers or ragged cloth.
- Each asset's palette is given in its sheet. Colours are sRGB hex. The scenes are dark, so base colours sit in the 20–60% brightness range and the emissive parts carry the light.

### 1.4 Rig

- One skin per character. At most 4 joint influences per vertex, with weights normalised to 1.
- Use **exactly the joint names and hierarchy in the sheet.** Extra joints (fingers, cloth, twist) are allowed if they are leaves under the listed joints and the listed names stay as they are.
- Each joint's local +Y points along the bone toward its child (the Blender default). For chain joints (neck, spine, tail, feather), **local X is the bend axis for up/down** and **local Z is the bend axis for side to side**. The code bends chains about these axes.
- Rest (bind) pose is given per asset. The rest pose must look like a natural neutral pose when no clip plays.
- **Sockets** are empty nodes (no mesh) parented to a joint, with their +Z pointing in the direction named. The code uses them as emitter and attachment points: fire, embers, ground rings and instrument grips.

### 1.5 Animation clips

- Clip (glTF animation) names must match the sheet exactly, in lower snake_case.
- **In place:** no translation on the root joint unless a clip says otherwise. The app moves the creature itself.
- Sampled at 30 fps. Looping clips have an identical first and last frame.
- **Tempo convention:** clips are authored at **120 BPM**, so 1 beat = 0.5 s and 1 bar = 2.0 s. The app sets `timeScale = bpm / 120`, so beat-synced clips must land their accents exactly on the beat times listed.
- **Accent times** (foot contact, wing downstroke peak, drum hit) are given in seconds. Also store them as glTF `extras` on the animation, for example `"extras": { "accents": [0.25] }`.
- **Procedural joints:** the joints each sheet marks with ✱ are moved by code on top of the clips. Keep them within ±10° of rest in every clip on the axes the sheet names, so the audio motion shows.
- Every clip animates rotation only (plus root translation where allowed). Do not animate scale, except where the sheet says so.

### 1.6 Originality and licence

- Designs must be **original**. Do not resemble any existing character or franchise (for example no Shrek-like ogre, no Toothless- or Spyro-like dragon, no Grim Fandango skeletons, no Pokémon). Generic fantasy archetypes are fine.
- If you build from scratch, write "original work, made for this project" in the README.
- If you start from someone else's asset, it must be **CC0** (public domain). Record its URL and licence in the README. CC-BY, "QAL" and Mixamo-derived assets are **not** acceptable: Mixamo files can't be redistributed in a repository, and attribution licences add obligations.

---

## 2. Asset build sheets

Priority order: **1 Swamp Giant → 2 Dragon → 3 Crowd + Mascot → 4 Phoenix → 5 Skeleton Band → 6 Jelly Blob**. The Swamp Giant comes first because its humanoid rig is reused by the Skeleton Band.

### 2.1 Swamp Giant: `swamp_giant.glb`

**Concept:** a hulking, friendly-menacing swamp ogre. The silhouette reads at a glance: wide pear-shaped body with a big belly, short thick legs, very long arms ending in oversized club-like fists that nearly reach the ground, a small head sunk into the shoulders, and two curved ram-like horns. It has two lower tusks, a heavy brow, a moss mantle over the shoulders with three small glowing mushrooms, and a reed and rope loincloth. One bare wooden bracelet goes on the left wrist.

**Size and budget:** 4.5 m tall to the top of the horns, 3.2 m across the shoulders. 3,000–6,000 triangles.

**Rest pose:** A-pose: arms down and out about 35° from the body, knees slightly bent, fists relaxed.

**Palette and materials**

| Material | Use | Base colour | Emissive |
|----------|-----|-------------|----------|
| `skin` | body, head, hands | #4F6B3A, with vertex colours shading belly and face lighter (#6E8A4E) | none |
| `horn` | horns, tusks, nails | #CDBF9C | none |
| `moss` | shoulder mantle | #2F4A25 | none |
| `cloth` | loincloth, rope, bracelet | #5A4630 | none |
| `emissive_eye` | eyes (two small spheres or recessed faces) | #FFB347 | #FFB347 |
| `emissive_fungus` | 3 shoulder mushrooms plus 6–10 small spots on the back | #7CFFB2 | #7CFFB2 |

**Joints** (Mixamo-style names without a prefix, so humanoid clip libraries retarget cleanly):

```
Hips
├── Spine ── Spine1 ── Spine2 ✱(X)
│                      ├── Neck ✱(X) ── Head ✱(X,Z) ── Jaw
│                      │                         ├── Brow
│                      │                         └── (leaf) HeadTop_End
│                      ├── LeftShoulder ── LeftArm ── LeftForeArm ── LeftHand ── LeftFist_End
│                      └── RightShoulder ── RightArm ── RightForeArm ── RightHand ── RightFist_End
├── Belly ✱(scale allowed, see below)
├── LeftUpLeg ── LeftLeg ── LeftFoot ── LeftToeBase
└── RightUpLeg ── RightLeg ── RightFoot ── RightToeBase
```

- `Belly` is a leaf joint at the front of the belly, weighted to the belly surface only (falloff to 0 at the ribs and hips). The code scales it for jiggle on bass.
- `Jaw` opens about 25° about local X.
- **Sockets:** `socket_foot_L` and `socket_foot_R` (on the foot joints, at the sole centre, +Z forward), and `socket_mouth` (on Jaw, at the lips, +Z forward).

**Clips**

| Clip | Length | Loop | Description | Accents (s) |
|------|--------|------|-------------|-------------|
| `idle` | 4.0 | yes | Slow breathing: chest rises about 3 cm, shoulders sway ±3°, fists flex once. | — |
| `groove` | 0.5 | yes | One beat of a heavy knee bounce. Down (knees bent +12°, hips drop 8 cm, **root translation Y allowed**) at 0.0, up at 0.25. The head lags 2 frames behind the body. | 0.0 |
| `arm_swing` | 1.0 | yes | Alternating arm swings, like a lumbering walk in place. The left arm is fully forward (+40° at the shoulder) at 0.0 and the right arm fully forward at 0.5. The fists swing heavily with follow-through. | 0.0, 0.5 |
| `stomp_L` | 0.8 | no | Left knee lifts high (thigh +60°) from 0.0 to 0.35, then slams down. **The foot hits the ground at 0.45.** Recovers to rest by 0.8 with the body squashing 5 cm on impact. | 0.45 |
| `stomp_R` | 0.8 | no | Mirror of `stomp_L`. | 0.45 |
| `chest_beat` | 1.0 | no | Both fists pound the chest: left at 0.25, right at 0.75, head thrown back slightly. | 0.25, 0.75 |
| `roar` | 2.0 | no | Leans back, arms spread wide (shoulders +70° outward), jaw fully open from 0.4 to 1.6, then returns. | 0.4 |
| `clap_overhead` | 0.5 | yes | Big overhead clap: hands meet at 0.25. | 0.25 |
| `look_around` | 3.0 | no | Head turns left 40°, then right 40°, then back to centre. Use it as an idle variation. | — |

**Optional morph targets:** `blink` and `snarl` (upper lip raised).

---

### 2.2 Low-Poly Dragon (flagship): `dragon.glb`

**Concept:** a sleek, angular, faceted dragon in flight. It has a wedge-shaped head with a separate lower jaw, two swept-back horns and a row of small spikes along the spine. The long neck and tail make it read as an S-curve. Its bat wings have three fingers, with a membrane stretched between the fingers and down to the flank. The four legs are short and tucked in flight. The tail ends in a flat arrow-head fin.

**Size and budget:** 12 m from nose to tail tip, 14 m wingspan with wings spread flat. 4,000–7,000 triangles.

**Rest pose:** wings spread flat and level, neck and tail straight along the Z axis, legs tucked under the body, jaw closed. The origin sits at the chest, between the wing roots.

**Palette and materials**

| Material | Use | Base colour | Emissive |
|----------|-----|-------------|----------|
| `scales` | body, head, legs | #1F2A36, with vertex colours lightening the belly plates (#3C4A52) | none |
| `horn` | horns, spikes, claws | #B9B2A0 | none |
| `wing_membrane` | membranes (double-sided) | #5A1E2A | none |
| `emissive_eye` | eyes | #FFD54A | #FFD54A |
| `emissive_mouth` | inner mouth, throat and tongue (seen when the jaw opens) | #FF5A1F | #FF5A1F |
| `emissive_vents` | a line of glowing seams along the throat and chest, plus 5–7 slits along each flank | #FF7A2E | #FF7A2E |

The code colours `emissive_vents` and `emissive_mouth` with loudness and drives the fire breath from `socket_mouth`.

**Joints**

```
root
└── spine_01 (hips)
    ├── spine_02 ── spine_03 ── chest
    │                          ├── neck_01 ✱ ── neck_02 ✱ ── neck_03 ✱ ── neck_04 ✱ ── neck_05 ✱ ── neck_06 ✱ ── head ✱ ── jaw
    │                          ├── wing_L_upper ── wing_L_fore ── wing_L_hand ─┬── wing_L_finger_01 ── wing_L_finger_01_tip
    │                          │                                               ├── wing_L_finger_02 ── wing_L_finger_02_tip
    │                          │                                               └── wing_L_finger_03 ── wing_L_finger_03_tip
    │                          ├── wing_R_… (mirror of the left wing)
    │                          ├── leg_FL_upper ── leg_FL_lower ── leg_FL_foot
    │                          └── leg_FR_upper ── leg_FR_lower ── leg_FR_foot
    ├── leg_BL_upper ── leg_BL_lower ── leg_BL_foot
    ├── leg_BR_upper ── leg_BR_lower ── leg_BR_foot
    └── tail_01 ✱ ── tail_02 ✱ ── … ── tail_10 ✱ ── tail_fin
```

- ✱ The neck and tail chains (both axes) and `head` (X and Z) are procedural: the code sends an S-wave down the neck on bass and a travelling wave down the tail driven by the spectrum.
- Spacing: about 0.45 m per neck joint and 0.55 m per tail joint, getting shorter toward the tip.
- `jaw` opens up to 40° about local X.
- Wing membrane weights blend smoothly between adjacent fingers, and the membrane's trailing edge to the flank is weighted to `spine_02`/`spine_03`.
- **Sockets:** `socket_mouth` (on jaw, at the tip of the snout, +Z forward), `socket_tail_tip` (on tail_fin, +Z backward along the tail), and `socket_wingtip_L` / `socket_wingtip_R` (on finger_01_tip).

**Clips**

| Clip | Length | Loop | Description | Accents (s) |
|------|--------|------|-------------|-------------|
| `glide` | 4.0 | yes | Wings near flat with a slow ±8° breathing motion, fingers flexing slightly, body rolling ±3°. | — |
| `flap` | 0.5 | no | One strong beat. The wings rise to +45° (0.0–0.15), then **reach the bottom of the downstroke at −50° at 0.25**, then recover to flat by 0.5. The fingers fold 20° on the upstroke and spread on the downstroke, and the body rises 15 cm at 0.25 (**root translation Y allowed**). | 0.25 |
| `flap_loop` | 1.0 | yes | Two continuous flaps per second, same shape as `flap`, at about 70% amplitude. | 0.25, 0.75 |
| `hover` | 1.0 | yes | Body tilted upright about 40°, wings sweeping forward and back like hovering, legs dangling. | 0.25, 0.75 |
| `bank_L` / `bank_R` | 2.0 | yes | Rolls 30° into the turn. The inside wing is raised 15° and the tail curves outward. | — |
| `roar` | 1.6 | no | Head pulls back (0.0–0.3), then thrusts forward with the jaw wide open from 0.4 to 1.2, then closes. | 0.4 |
| `breath_fire` | 2.5 | no | Inhale: chest expands and the head rises (0.0–0.6). Then the head thrusts forward, and the **jaw opens and holds from 0.7 to 2.0** while the head sweeps 20° left to right, then closes. | 0.7 |
| `dive` | 1.5 | no | Wings fold back to 30% span, the nose pitches down 35°, then the wings reopen by 1.5. | — |

---

### 2.3 Crowd and Mascot Blob: `mascot_blob.glb` and `dancer.glb`

#### Mascot: `mascot_blob.glb`

**Concept:** a squishy gumdrop-shaped jelly mascot with a wide round base tapering to a soft rounded top. It has two big glossy eyes, a wide happy mouth, little stubby arms and no legs. A glowing core sphere floats inside the body, visible through a gap or bright emissive patch.

**Size and budget:** 3.0 m tall, 2.6 m wide at the base. 1,500–3,000 triangles. The body is smooth-shaded (the one exception to the faceted rule) and uses an evenly spaced, icosphere-like mesh so it squashes cleanly.

**Palette and materials**

| Material | Use | Base colour | Emissive |
|----------|-----|-------------|----------|
| `jelly` | body | #3BC9DB | none (the code adds a fresnel rim) |
| `eyes` | eye whites and pupils, using vertex colours | #F5F5F5 and #111111 | none |
| `mouth` | mouth interior | #3A1030 | none |
| `emissive_core` | inner core sphere, 0.9 m | #FF4FD8 | #FF4FD8 |
| `emissive_cheeks` | two blush ovals | #FF8FB1 | #FF8FB1 |

**Joints:** `root` ── `body` ✱ ── `head_top` ✱. `body` also carries `arm_L_01` ── `arm_L_02`, `arm_R_01` ── `arm_R_02`, `eye_L` and `eye_R` (so the eyes can look around), plus `mouth`.

**Morph targets** (required; the code drives these directly from bass):

| Morph target | Shape |
|--------------|-------|
| `squash` | height 70%, base width 125%, volume roughly preserved |
| `stretch` | height 130%, width 85% |
| `lean_L` / `lean_R` | top shifted 0.5 m sideways while the base stays planted |
| `mouth_open` | mouth open wide |
| `blink` | eyes closed |

**Clips**

| Clip | Length | Loop | Description | Accents (s) |
|------|--------|------|-------------|-------------|
| `bounce` | 0.5 | yes | Squash at 0.0, stretch at 0.25, using the morph weights in the clip; arms flap. | 0.0 |
| `jump` | 1.0 | no | Anticipation squash (0.0–0.15), launch with a stretch, airborne from 0.2 to 0.7 (**root translation Y allowed**, peak 2.5 m), lands with a squash at 0.75, settles by 1.0. | 0.75 |
| `wave` | 1.5 | no | Right arm waves three times while the body leans toward it. | — |
| `cheer` | 1.0 | yes | Both arms up, wiggling, with the mouth open. | 0.0, 0.5 |
| `look_around` | 3.0 | no | Eyes and top glance left, right, then back to centre. | — |

#### Crowd dancer: `dancer.glb`

The crowd is 200–2,000 copies drawn in **one instanced draw call**, and the dancing is done in the vertex shader. So the dancer is **not rigged** and has **no clips**. Instead, every vertex records which body part it belongs to:

**Geometry:** a simple stylised figure, **1.7 m tall**, with a round head, a capsule body, and arms and legs as faceted tubes. It holds a small glow stick in its right hand. **150–400 triangles.** It is one single mesh with one material, `dancer`, using vertex colours.

**Part encoding:** the vertex colour `COLOR_0` **red channel** stores the part ID (exact values; the blue and green channels are free for shading tint):

| Part | R value | Pivot point (m, in model space) |
|------|---------|----------------------------------|
| body and hips | 0.0 | (0, 0.95, 0) |
| head | 0.2 | neck (0, 1.50, 0) |
| left arm | 0.4 | shoulder (+0.20, 1.40, 0) |
| right arm and glow stick | 0.6 | shoulder (−0.20, 1.40, 0) |
| left leg | 0.8 | hip (+0.10, 0.92, 0) |
| right leg | 1.0 | hip (−0.10, 0.92, 0) |

- Each arm or leg must rotate cleanly about its pivot with no stretching. Model the parts as separate closed shells that overlap at the joints; no shared vertices are needed.
- The glow stick: set its `COLOR_0` **alpha channel to 1.0**, and 0.0 everywhere else, so the code can make it glow.
- Optional variants: `dancer_b.glb` (wider build, with a cap) and `dancer_c.glb` (taller, with a ponytail), following the same encoding.

---

### 2.4 Phoenix: `phoenix.glb`

**Concept:** a faceted fire bird made of sharp, blade-like feathers. It has a slim body, a long neck, a hooked beak and a crest of 3 swept-back plumes. Each wing has **9 separate primary feather blades** fanning from the hand, plus a row of covert feathers. **5 long tail streamers**, each 3–4 m, trail behind. It looks like it is made of flame: a gold core shading to orange and then deep red at the feather tips.

**Size and budget:** 8 m wingspan, 3 m from beak to tail base (streamers extra). 2,500–4,500 triangles.

**Rest pose:** wings spread flat and level, streamers straight back, crest swept back.

**Palette and materials:** the body and feathers use vertex colours for the gold → orange → red gradient (#FFE27A at the core, #FF8A2A in the middle, #C81E1E at the tips).

| Material | Use | Base colour | Emissive |
|----------|-----|-------------|----------|
| `emissive_plumage` | body and every feather (`doubleSided`; may use cutout `MASK`) | vertex colour | emissive = vertex colour × 0.6 (bake it as an emissive texture or vertex-colour emissive; the code tints it by loudness) |
| `beak` | beak and talons | #2A1A12 | none |
| `emissive_eye` | eyes | #FFFFFF | #FFF3B0 |

**Joints**

```
root
└── spine_01 ── spine_02 ── chest
    ├── neck_01 ✱ ── neck_02 ✱ ── head ✱ ─┬── crest_01 ✱, crest_02 ✱, crest_03 ✱
    │                                     └── beak_lower
    ├── wing_L_upper ── wing_L_fore ── wing_L_hand
    │      └── (on wing_L_hand) wing_L_feather_01 ✱ … wing_L_feather_09 ✱
    │      └── (on wing_L_fore) wing_L_covert_01 … wing_L_covert_05
    ├── wing_R_… (mirror)
    └── leg_L_upper ── leg_L_foot, leg_R_upper ── leg_R_foot
spine_01
└── tail_A_01 ✱ ── tail_A_02 ✱ ── tail_A_03 ✱ ── tail_A_04 ✱
    (same for tail_B … tail_E, fanned −30°, −15°, 0°, +15°, +30° from the centre line)
```

- ✱ The feather joints get a per-feather phase lag from the code (the wing beat ripples from feather 01, nearest the body, out to 09). Each feather is a single blade skinned 100% to its own joint.
- Tail streamers are fanned and waved by code.
- **Sockets:** `socket_wingtip_L` and `socket_wingtip_R` (on feather_09; the ember trails come from here), `socket_tail` (between the tail roots, +Z backward), and `socket_chest` (front of chest; the burst on a drop comes from here).

**Clips**

| Clip | Length | Loop | Description | Accents (s) |
|------|--------|------|-------------|-------------|
| `glide` | 3.0 | yes | Wings flat with ±6° soaring motion, streamers drifting. | — |
| `flap` | 0.6 | no | Wings up to +50° (0.0–0.15), then the **downstroke bottoms out at −45° at 0.3**, then recovery. The primary feathers spread 15° on the downstroke and close on the upstroke. | 0.3 |
| `flap_loop` | 0.5 | yes | Continuous flapping at one flap per beat, same shape as `flap`. | 0.25 |
| `spread` | 1.0 | no | Rises up (**root translation Y allowed**, +1 m) and throws the wings wide and up to +20°. The feathers fan to the maximum, the streamers fan out 60°, and it **holds the final pose from 0.6**. | 0.6 |
| `spread_hold` | 1.0 | yes | The held end pose of `spread`, with subtle feather shimmer. | — |
| `dive` | 1.2 | no | Wings fold back tight, then reopen. | — |
| `rise` | 1.5 | no | Pulls up with two strong flaps (at 0.3 and 0.9) while the body pitches up 30°. | 0.3, 0.9 |

---

### 2.5 Skeleton Band: `skeleton.glb` and `band_instruments.glb`

#### Skeleton musician: `skeleton.glb`

**Concept:** a cartoon-proportioned skeleton with a slightly oversized skull. It has a chunky ribcage, a separate jaw, and bones built from simple faceted cylinders and boxes. One mesh is shared by all four band members; the code tells them apart with props and tint. The eye sockets have glowing points.

**Size and budget:** 1.8 m tall. 2,000–4,000 triangles. Each bone should be a rigid, separate part, skinned 100% to one joint, so it moves like a puppet.

**Rest pose:** A-pose, as for the Swamp Giant.

**Joints:** **identical names and hierarchy to the Swamp Giant** (§2.1), without `Belly` and `Brow`, plus full finger chains: `LeftHandThumb1–3`, `LeftHandIndex1–3`, `LeftHandMiddle1–3`, `LeftHandRing1–3` and `LeftHandPinky1–3`, with matching right-hand chains. The fingers need to curl around guitar necks and drumsticks.

- **Sockets:** `socket_hand_L` and `socket_hand_R` (in the palm centre, +Z out of the palm; instruments attach here), and `socket_mouth`.

**Palette and materials**

| Material | Use | Base colour | Emissive |
|----------|-----|-------------|----------|
| `bone` | all bones | #E8DFC8 | none |
| `emissive_eye` | eye-socket points | #7CF7FF | #7CF7FF |
| `cloth` (optional) | ragged vest or bandana | #2B2B3A | none |

**Clips:** every clip is one bar (2.0 s) or one beat (0.5 s) at 120 BPM.

| Clip | Length | Loop | Description | Accents (s) |
|------|--------|------|-------------|-------------|
| `idle_sway` | 2.0 | yes | Weight shifts side to side and the head nods. | 0.0, 1.0 |
| `headbang` | 0.5 | yes | Head and upper spine snap down at 0.0. | 0.0 |
| `drum_groove` | 2.0 | yes | Seated on a throne (**root at seat height 0.55 m**). Kick (right foot) at 0.0 and 1.0; snare (left stick) at 0.5 and 1.5; hi-hat (right stick) on every 0.25. | 0.0, 0.5, 1.0, 1.5 |
| `drum_fill` | 2.0 | no | Sixteenth-note sweep across the toms (every 0.125), ending with a crash (right stick) at 1.875. | 1.875 |
| `drum_crash` | 0.5 | no | Both sticks crash at 0.1. | 0.1 |
| `guitar_strum` | 0.5 | yes | Guitar held at the hips. Right-hand downstroke at 0.0 and upstroke at 0.25; the left hand slides slightly on the neck. | 0.0, 0.25 |
| `guitar_power` | 2.0 | no | Wide stance, leans back, then a big windmill strum at 1.0. | 1.0 |
| `bass_pluck` | 0.5 | yes | Right-hand fingers pluck at 0.0 and 0.25; body bobs at the knees. | 0.0 |
| `sing` | 2.0 | yes | Right hand holds the mic at the mouth. The jaw opens and closes in rhythm (open at 0.0, 0.5, 1.0, 1.5); the free hand gestures. | 0.0, 0.5, 1.0, 1.5 |
| `jump` | 1.0 | no | Jump with the instrument, airborne from 0.2 to 0.7 (**root translation Y allowed**). | 0.75 |

#### Instruments and stage: `band_instruments.glb`

One file, with each prop as a separately named top-level node, origins as listed. 3,000–6,000 triangles total.

| Node | Description | Origin | Moving sub-nodes (named, pivots at their hinge) |
|------|-------------|--------|-------------------------------------------------|
| `drum_kit` | kick drum, snare, 2 rack toms, floor tom, hi-hat, crash and ride cymbals, throne | floor centre of the throne | `kick_beater`, `hihat_top`, `cymbal_crash`, `cymbal_ride`, `snare_head`, `kick_head` (the code shakes these on hits) |
| `drumstick_L`, `drumstick_R` | 0.4 m sticks | grip point | — |
| `guitar` | angular electric guitar, original shape | grip on the neck at the 3rd fret | `guitar_strings` (thin mesh, material `emissive_strings`) |
| `bass_guitar` | 4-string bass, longer neck | grip on the neck | `bass_strings` (material `emissive_strings`) |
| `mic_stand` | stand with a mic | base centre | `mic` (detachable node) |
| `amp_stack` | 2 cabinets plus a head | floor centre | `amp_grille` (material `emissive_panel`, pulses with bass) |
| `stage_riser` | 6 × 4 × 0.5 m platform with an edge trim | floor centre | `riser_trim` (material `emissive_trim`) |

Each instrument except the drum kit has two empty child nodes, `grip_main` and `grip_off`, at the hand positions, with +Z pointing out of the palm, so the code can parent them to `socket_hand_R` and `socket_hand_L`.

Materials: `wood` #6B4226, `metal` #9AA4AE (metallic 0.8, roughness 0.35), `cymbal` #C9A24A (metallic 0.9, roughness 0.3), `drumhead` #E6E1D3, `black` #151515, `emissive_strings` #FFFFFF, `emissive_panel` #FF3355, `emissive_trim` #7C5CFF.

---

### 2.6 Jelly Blob soft body: `jelly_blob.glb` (low priority, may stay procedural)

- A plain blob: an icosphere at subdivision level 4 (about 2,500 triangles), 2 m in diameter, origin at the bottom centre, smooth-shaded.
- **Even triangle distribution matters more than looks**, because the soft-body simulation moves its vertices.
- A separate mesh node, `jelly_face`, holds 2 eyes and a mouth as flat decals floating 1 cm off the surface. It is not skinned; the code sticks it to the surface.
- Morph targets `squash` and `stretch`, as for the mascot. No rig and no clips.
- Materials: `jelly` #9B5CFF and `emissive_face` #FFFFFF.

---

## 3. Optional extras (nice to have)

These are not needed for the modes to work, but they add polish. Same rules as section 1.

| File | Contents | Helps |
|------|----------|-------|
| `swamp_props.glb` | 3 dead twisted trees (6–9 m), reed clumps, 4 lily-pad clusters, 5 mossy rocks, 6 glowing mushroom clusters (`emissive_fungus`), a broken wooden jetty. Each a named node; 4–8k tris total. | Swamp Giant scene |
| `sky_spires.glb` | 5 floating rock islands with hanging roots (10–40 m), and 3 tall stone spires. Faceted; 3–6k tris total. | Dragon and Phoenix flight scenes |
| `crowd_props.glb` | barrier fence segment (4 m), a speaker stack, a truss tower (8 m), a confetti-cannon node with `socket_muzzle`. | Crowd + Mascot scene |
| `fx_textures/` | 128×128 PNGs with a transparent background: `ember.png` (soft dot), `spark.png` (4-point star), `smoke.png` (soft puff), `flame_strip.png` (4 × 1 flipbook). | fire breath, embers, smoke |
| Preview renders | One 1024×576 PNG per asset in its rest pose, plus one contact sheet of clip key poses. | quick review before import |

---

## 4. Delivery and acceptance

### 4.1 Folder layout

Put everything in `Model assets/` at the repo root (that folder is not committed until the files are checked):

```
Model assets/
  swamp_giant/swamp_giant.glb   README.md   preview.png
  dragon/dragon.glb             README.md   preview.png
  mascot/mascot_blob.glb  dancer.glb  README.md  preview.png
  phoenix/phoenix.glb           README.md   preview.png
  skeleton_band/skeleton.glb  band_instruments.glb  README.md  preview.png
  jelly_blob/jelly_blob.glb     README.md
  extras/…
```

Each `README.md` gives:
- the source (original work, or a CC0 URL),
- the triangle count,
- the joint count,
- the clip list with lengths and accents,
- the tool used,
- any deviation from this spec, with the reason.

### 4.2 Acceptance checklist (every `.glb`)

1. Opens without errors in <https://gltf-viewer.donmccurdy.com/>, and the [Khronos glTF Validator](https://github.khronos.org/glTF-Validator/) reports 0 errors.
2. Stands upright, faces +Z, is at the right size (check against the sheet's height or wingspan), and the origin is where the sheet says.
3. Triangle count is inside the sheet's budget, and the file is under 5 MB.
4. No compression extensions are present (`KHR_draco_mesh_compression`, `EXT_meshopt_compression`, `KHR_texture_basisu`).
5. Every joint, socket, material, morph target and clip named in the sheet exists, spelled exactly.
6. Looping clips loop without a pop; accent poses happen at the listed times; no root translation except where allowed.
7. Every ✱ joint stays within ±10° of rest on its listed axes in every clip.
8. Emissive parts use `emissive_*` materials, and nothing else glows.

A quick structural check, runnable from the repo root (prints names, counts and clips so they can be compared against the sheet):

```bash
node -e 'const f=require("fs").readFileSync(process.argv[1]);const j=JSON.parse(f.slice(20,20+f.readUInt32LE(12)));let t=0;for(const m of j.meshes||[])for(const p of m.primitives)t+=j.accessors[p.indices??p.attributes.POSITION].count/3;console.log({triangles:t,bytes:f.length,extensions:j.extensionsUsed||[],materials:(j.materials||[]).map(m=>m.name),joints:(j.skins||[]).flatMap(s=>s.joints.map(i=>j.nodes[i].name)),morphs:(j.meshes||[]).flatMap(m=>m.extras?.targetNames||[]),clips:(j.animations||[]).map(a=>a.name)})' "Model assets/dragon/dragon.glb"
```

---

## 5. References

Use these for look and proportion, or as CC0 starting points where the licence says CC0. Always confirm the licence on the page itself before using a file.

| Asset | Reference or starting point | Licence |
|-------|-----------------------------|---------|
| Dragon | [Cethiel's Dragon 3D (OpenGameArt)](https://opengameart.org/content/cethiels-dragon-3d): rigged, animated, low-poly | CC0 |
| Dragon | [Low Poly Ice Dragon (OpenGameArt)](https://opengameart.org/content/low-poly-ice-dragon): `.blend` with fly and bite animations | CC0 |
| Monsters (giant, dragon ideas) | [Quaternius: Ultimate Monsters](https://quaternius.com/packs/ultimatemonsters.html): 50 animated monsters, glTF available | CC0 per the Quaternius page; the [Sketchfab mirror](https://sketchfab.com/3d-models/ultimate-monsters-pack-fd72e114d119488da71fe3a16f216c4f) shows CC-BY, so download from Quaternius |
| Monsters | [Quaternius: LowPoly Animated Monsters (itch.io)](https://quaternius.itch.io/lowpoly-animated-monsters): includes dragon and skeleton types; FBX/OBJ/Blend | CC0 |
| Monsters (look only) | [Quaternius: Bestiary Dungeon Monsters Kit](https://quaternius.com/packs/bestiarydungeonmonsterskit.html): humanoid rig, GLB | QAL licence (not CC0): reference only |
| Humanoid rig and clips | [Quaternius: Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html), [itch.io](https://quaternius.itch.io/universal-animation-library), and [Library 2 (OpenGameArt)](https://opengameart.org/content/universal-animation-library-2): 120+ and 130+ clips on one humanoid rig, glTF | CC0 |
| Humanoid base meshes | [Quaternius: Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html): about 13k-triangle humanoids, glTF, rig compatible with the animation library | CC0 |
| Skeleton Band | [KayKit: Skeletons (itch.io)](https://kaylousberg.itch.io/kaykit-skeletons): 4 rigged, animated skeletons, FBX/glTF (free tier) | CC0 |
| Skeleton clips | [KayKit Character Animations (OpenGameArt)](https://opengameart.org/content/kaykit-character-animations) | check the page |
| Phoenix (look only) | [Phoenix bird (Sketchfab)](https://sketchfab.com/3d-models/phoenix-bird-844ba0cf144a413ea92c779f18912042): rigged and animated, about 4.1k triangles | CC-BY (not CC0): reference only |
| Mascot and cute style | [Quaternius: Cute Animated Monsters](https://quaternius.com/packs/cutemonsters.html) and [Textured Cute Monster Pack (OpenGameArt)](https://opengameart.org/content/textured-cute-monster-pack) | CC0 |
| Instruments | [Kenney: Generic Items (OpenGameArt)](https://opengameart.org/content/generic-items): guitar, electric guitar, drum, keyboard | Kenney assets are generally CC0; confirm on the page |
| Tools | [glTF Viewer](https://gltf-viewer.donmccurdy.com/), [Khronos glTF Validator](https://github.khronos.org/glTF-Validator/) | — |

## 6. Received so far

| File | What it is | Fits |
|------|-----------|------|
| `Model assets/kitA.glb` | A static modular industrial kit: walls (plain, window, pipes), pillar, girders, floor, ceiling, catwalk, stairs, ladder, three light fixtures, shaft ring, rail track, tram carriage and a red panel. 19 meshes, about 2.7k triangles, one atlas material plus 5 `emissive_*` materials (tube, bulb, lens, window, panel). No rig, no clips. | None of the figure modes. It suits an environment mode (for example an underground or industrial scene). |
