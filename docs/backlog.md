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
