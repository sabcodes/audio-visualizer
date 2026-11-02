# Ichiraku Ramen / Neon Nights

Select `<experimental-wave6> Ichiraku Ramen / Neon Nights`, or use `modern.html?mode=ichiraku`.

Uses the original `Model assets/Wave6 assets /ichiraku_ramen.glb` directly. The supplied geometry, embedded Japanese curtain lettering and tiled roof textures are preserved. Instance-owned geometry and materials keep switching modes independent of the model cache.

18 camera moves cover the shopfront, paper lanterns, counter, stools, side windows, loft, roofs, a rear corner, overhead and pavement reflections. The scene stays at night, with dark neighboring facades, cool moonlight, steam from the chimney and three small ramen bowls on the counter.

Kicks brighten the large lantern; snare-heavy hits favor the smaller one. Bass lifts the roof and counter trim, while loudness lifts the interior and upstairs windows. Colored point lights illuminate the building and street. Six neon palettes blend on every eighth beat (at least three seconds apart), or every 16 seconds without music. Lanterns and curtains sway gently. Reduced motion freezes animation, and reduced flashes cap the beat envelope at 40 percent.

`camera-review.jpg` shows all 18 views and six palettes. `portrait.jpg` uses a wider vertical lens to retain the shop framing without moving the camera behind neighboring buildings. Images come from the actual headless WebGL2 render fixture.

Validated with the production build, 251 unit tests, and two browser tests covering every camera path at three points, all palettes, retained textures, rendered light response, reduced motion, reduced flashes, portrait visibility, switching modes and disposal.
