# Akira / Neo Tokyo

Select `<experimental-wave6> Akira / Neo Tokyo` in the mode menu (`mode=akira`).

The supplied riderless bike runs through 30 directed shots in six neon districts. The reel includes launches, left/right drifts, brake slides, slaloms, wheelies, a burnout and a full camera orbit. Buildings use varied window patterns, light bands and rooftop searchlights. Exhaust leaves a fading trail; musical edges trigger backfires and boosts. Reduced motion freezes the sequence, and reduced flash limits the effects.

`camera-review.jpg` shows 16 representative shots. `portrait.jpg` checks vertical framing. Both were captured with the project's headless Playwright compatibility browser.

Validation: `npm run build`, `npm test` (245 tests), and `npx playwright test tests/browser/akira.spec.ts --project=compatibility` (2 tests, covering all 30 shots).
