# Backlog

## Waiting on 3D models

These figure and creature modes are on hold until the user supplies models. Procedural primitives would look toy-like for them; the Robot and Kraken modes already cover what primitives can do.

| Mode | Idea (from `research/2026-10-24-new-visualization-modes.md`) | What the model needs |
|------|------|------|
| Low-Poly Dragon | head bobs and neck S-waves on bass, wing flaps on beats, fire breath on loudness peaks, tail wave from the spectrum | neck/tail bone chain, wing bones; flap and idle clips |
| Phoenix | wing downstroke on beats, body bob and tail fan on bass, flame colour from loudness, ember trail | wing and tail bones; flap and glide clips |
| Swamp Giant | knee bend and squash on bass, alternating arm swings on mids, beat stomp with a ground ring, eye glow on loudness | humanoid rig; idle, stomp and swing clips |
| Crowd + Mascot Blob | squishy mascot ringed by hundreds of tiny dancers; beat jumps ripple outward | one mascot (rigged or blend shapes) and one low-poly dancer for instancing |
| Skeleton Band (bench) | skeleton musicians playing along to the bands | humanoid rig plus instrument props; playing clips |
| Jelly Blob Soft Body (bench) | wobbly soft-body character squashing on bass | could stay procedural; revisit alongside the mascot |

The full build sheets (sizes, joints, clips, materials and acceptance checks) are in [3d-asset-spec.md](3d-asset-spec.md).

Model requirements, as agreed:
- Format: `.glb`, rigged, with animation clips included.
- License: CC0 (for example Quaternius, Kenney, Poly Pizza). Mixamo animations can't be redistributed in the repo.
- Size: a few MB each, under about 20k triangles.
- Delivery: drop the files in a folder and share its path.
