import { expect, it } from 'vitest';
import { Sprite } from 'three/webgpu';
import { basePixelRatio, presetBudget } from '../../src/rendering/quality';
import { createParticleMode } from '../../src/modes/particleModes';

it('caps Balanced at 1080 internal rows on a 2x display', () => {
  expect(basePixelRatio(presetBudget('balanced'), 861, 2)).toBeCloseTo(1080 / 861, 6);
  expect(basePixelRatio(presetBudget('balanced'), 1400, 2)).toBeCloseTo(1080 / 1400, 6);
});
it('lets Ultra use native density up to 2x', () => {
  expect(basePixelRatio(presetBudget('ultra'), 861, 3)).toBe(2);
});
it('never drops below a 0.25 pixel ratio', () => {
  expect(basePixelRatio(presetBudget('compatibility'), 100000, 1)).toBe(0.25);
});
it('scales the swirl particle count with the preset', () => {
  const counts = (['compatibility', 'balanced', 'high'] as const).map((preset) => {
    const mode = createParticleMode('particles', presetBudget(preset));
    const count = (mode.scene.children.find((child) => child instanceof Sprite) as Sprite).count;
    mode.dispose(); return count;
  });
  expect(counts).toEqual([4000, 8000, 16000]);
});
