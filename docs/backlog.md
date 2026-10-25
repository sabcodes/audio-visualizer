# Backlog

## Figure modes (built, experimental)

The six figure modes are built from the supplied models (`Model assets/wave3_assets`, spec in [3d-asset-spec.md](3d-asset-spec.md)). They show in the scene menu as `<EXPERIMENTAL> …`:

| Mode id | Menu label | Models |
|---------|------------|--------|
| `swampGiant` | Swamp Giant | `swamp_giant.glb` (v3), `swamp_props.glb` |
| `dragon` | Low-Poly Dragon | `dragon.glb` (v2), `sky_spires.glb` |
| `phoenix` | Phoenix | `phoenix.glb`, `sky_spires.glb` |
| `crowdMascot` | Crowd + Mascot | `mascot_blob.glb`, `dancer.glb`, `dancer_b.glb`, `dancer_c.glb`, `crowd_props.glb` |
| `skeletonBand` | Skeleton Band | `skeleton.glb`, `band_instruments.glb` |
| `jellyBlob` | Jelly Blob | `jelly_blob.glb` (v2) |

The used files are copied into `src/assets/` (models plus the ember, spark and smoke textures), so Vite bundles them.

## Asset issues worked around in code

These are faults in the delivered files. Each mode works around them, and a re-export that fixes them would let the code be simplified:

- **Socket offsets (Giant, Dragon, Skeleton):** Blender exported bone-parented sockets at twice their true offset (for example, the Dragon's `socket_wingtip_L` sits at 14 m, not 7 m). The modes use the nearest bone instead: foot bones for stomp rings, the jaw for fire, hand bones for instruments. The Phoenix's sockets were already fixed in its file.
- **One-wing flap clips (Dragon, Phoenix):** `flap`, `flap_loop`, `spread` and `spread_hold` swing one wing up and the other down. The modes don't play them; wing beats and the spread are driven by code instead (both wings rise with +X on the upper-wing bone).
- **Giant `clap_overhead`:** the hands meet at the waist rather than overhead. It is still used as one of the three dance loops.
- **Mascot eye vertex colours:** the eye meshes carry both `COLOR_0` and `COLOR_1`, the same exporter quirk the first dancer had. Three.js reads only `COLOR_0`, so if the pupils are in `COLOR_1` they won't show. The fix is to re-export with the colour wired to `COLOR_0`.

## Possible follow-ups

- Re-export the Giant, Dragon and Skeleton with corrected sockets, and the Dragon and Phoenix with mirrored flap clips.
- Use the flame flipbook texture (`fx_textures/flame_strip.png`, not copied in) for a richer Dragon fire.
- Drop the `<EXPERIMENTAL>` labels once the modes have had a listening pass.

## Wave 4 modes (built, experimental)

All 29 modes from [the wave 4 spec](superpowers/specs/2026-10-24-wave-four-modes-design.md) are built and show in the scene menu as `<experimental-wave4> …`. The delivered files are copied into `src/assets/wave4/`.

- **4a, procedural (19):** Prism Bowtie, Block Bowtie, Pong Orbs, Candy Orb, Moon Pond, Liquid Chrome, Mirror Plasma, Grain Smoke (a preset of the Mirror Plasma engine), Anamorphic Flare, Hair Vortex, Windfield, Black Maze, Starfall Canopy, Silk Threads, Chrome Streaks, Signal Night, Beacon Rings, Light Leak Film (with `coupe.glb`), Ember Smoke.
- **4b, kit modes (10):** Warehouse Hall, Red Stairwell and Underground (Kit A), Temple Descent (Kit B), Light Painting Forest (Kit C sculptures), Lava Golem (Kit G), Endless Stairs (Kit H), Red Crystal Hall (Kit A pieces), Pole Sparks, Bloom Touch (`hand.png`).

Shared pieces: `hitPulse.ts` (the beat-gated hit envelope, non-repeating variants and reduced-flash limits from the pacing rules) and `cinematic.ts` (a camera finish: grain, halation, soft focus, lens fringe, vignette). The finish keeps scenes close to the footage-like references instead of reading as clean low-poly CG. Kit modes turn on shadow maps only while they are active.

### Deviations from the spec

- **2D layers not used for Pole Sparks and Red Crystal Hall.** The delivered layers are simple programmatic drawings (plain pole bars, flat stripes for the hall walls) and read far from the reference clips. Both modes are built as lit 3D scenes instead: Pole Sparks is a toon-shaded cable tangle with outlines and travelling pulses, and Red Crystal Hall is a hall built from scaled Kit A pieces with a procedural cracked crystal. The layers stay in `src/assets/wave4/` but nothing imports them.
- **Moon Pond** runs a real wave-equation height field (ping-pong passes) instead of analytic ripples, so rings interfere like water.
- **Fullscreen shaders** stand in for the large instanced counts in Hair Vortex, Windfield, Anamorphic Flare and Mirror Plasma/Grain Smoke.

### Asset limits worked around in code

- **Hands:** Bloom Touch and Moon Pond now draw a raymarched 3D hand (`handModel.ts`: 22 tapered capsules blended with a smooth minimum, posed in code each frame). The supplied `hand.png` is no longer used.
- **Lava Golem:** the mesh is faceted, so the mode averages normals across split vertices to shade it smooth. The crack geometry is straight bars rather than vein shapes.
- **Kit G delivery notes call the mode `golemGroove`;** the spec and the code use `lavaGolem`.

### Possible follow-ups

- Vein-shaped emissive cracks for the golem.
- A listening pass per mode, then drop the `<experimental-wave4>` labels.
