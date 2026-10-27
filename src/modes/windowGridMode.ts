import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { float, fract, max, mix, mx_noise_float, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import { disposeScene, approach, settleStep } from './shared';
import { fullscreen, hash2 } from './shaderModes';
import { createHits, linearRgb, variantSequence } from './hitPulse';
import { isSnare, sectionWatch } from './waveSixShared';
import { seededRandom } from '../rendering/diagnostics';

type F = Node<'float'>;
type V2 = Node<'vec2'>;

/** Window palettes, two colours each (a burst mixes them): acid green first, as in the clip. */
export const WINDOW_PALETTES: readonly (readonly [number, number])[] = [
  [0x3dff6a, 0x2ae85a], [0xff9a2a, 0xff3aa8], [0x3ae0ff, 0x6ab8ff], [0xff2a1e, 0xff6a3a], [0xfff4e0, 0xd8e8ff],
];
/** Snare patterns: a row across, a column, a block, a diagonal, the top half, the bottom half. */
export const WINDOW_PATTERNS = 6;
/** Floors visible top to bottom; columns follow the aspect. */
export const WINDOW_ROWS = 18;
const CELL = vec2(1.15, 1);

const on = (condition: Node<'bool'>) => condition.select(float(1), float(0));

/**
 * Window Grid (wave 6, #3): a flat night view of a huge concrete apartment block, every window computed per pixel
 * from its row and column. Kicks light a scattered burst of windows (some bursts fill only a band), snares light a
 * structured pattern, hats flick single windows; each burst snaps on and fades to a dim afterglow that bass holds
 * longer. A section change swaps the palette. In silence a few warm windows stay on, like a block at 3 a.m.
 */
export function createWindowGridMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const aspect = uniform(16 / 9), time = uniform(0), driftY = uniform(0);
  // Two burst slots so a new burst can fire while the last one is still fading.
  const seeds = [uniform(0.1), uniform(0.6)], levels = [uniform(0), uniform(0)], densities = [uniform(0.05), uniform(0.05)];
  const regions = [uniform(new THREE.Vector2(-1, 2)), uniform(new THREE.Vector2(-1, 2))];
  const pattern = uniform(0), patternAt = uniform(new THREE.Vector2(0.5, 0.5)), patternLevel = uniform(0);
  const hatSeed = uniform(0), hatDensity = uniform(0), ambient = uniform(0.02), warmth = uniform(1), floorLift = uniform(0);
  const colourA = uniform(new THREE.Color()), colourB = uniform(new THREE.Color()), mixShare = uniform(0);

  // Facade coordinates: one unit per floor, with the view centred on the block and a tiny vertical drift.
  const view = uv().sub(0.5).mul(vec2(aspect, 1)).mul(WINDOW_ROWS).add(vec2(0.37, driftY));
  const q = view.div(CELL), id = q.floor(), local = fract(q);
  // Window style per column (a block repeats its layout up the floors): narrow, standard or a wide pair.
  const style = hash2(vec2(id.x, 7.3)), width = style.lessThan(0.3).select(float(0.4), style.lessThan(0.75).select(float(0.6), float(0.8)));
  const pane = vec2(local.x.sub(0.5).abs().div(width.mul(0.5)), local.y.sub(0.52).abs().div(0.27));
  const inside = on(pane.x.lessThan(1).and(pane.y.lessThan(1)));
  const frameEdge = on(max(pane.x, pane.y).greaterThan(0.86)).mul(inside);
  // Mullions: two or three panes and a transom near the top.
  const panes = style.lessThan(0.3).select(float(2), float(3));
  const wx = local.x.sub(width.mul(-0.5).add(0.5)).div(width).clamp(0, 1);
  const mullion = on(fract(wx.mul(panes)).sub(0.5).abs().greaterThan(0.44)).add(on(local.y.sub(0.68).abs().lessThan(0.018))).min(1).mul(inside);
  const own = hash2(id), curtain = hash2(id.add(5.1));
  // Curtains: vertical folds, some drawn half across.
  const folds = mx_noise_float(vec2(local.x.mul(28), id.y.mul(3.3))).mul(0.5).add(0.5);
  const drawn = on(wx.lessThan(curtain.mul(0.7).add(0.2)));
  // A person or a lamp silhouette in a few lit rooms.
  const figure = on(hash2(id.add(9.4)).lessThan(0.12)).mul(local.sub(vec2(0.5 + 0.1, 0.42)).mul(vec2(2.4, 1)).length().smoothstep(0.12, 0.09));

  // Which windows are lit, and how brightly.
  const screenY = uv().y;
  // Each window's centre in frame coordinates, so bands and patterns light whole windows.
  const cellCentre = id.add(0.5).mul(CELL).sub(vec2(0.37, driftY)).div(vec2(aspect.mul(WINDOW_ROWS), WINDOW_ROWS)).add(0.5) as V2;
  let lit: F = float(0);
  seeds.forEach((seed, k) => {
    const chosen = on(hash2(id.add(seed.mul(173.1))).lessThan(densities[k]));
    const inRegion = on(cellCentre.y.greaterThan(regions[k].x).and(cellCentre.y.lessThan(regions[k].y)));
    lit = max(lit, chosen.mul(inRegion).mul(levels[k]).mul(own.mul(0.35).add(0.75)));
  });
  // Structured snare patterns, in windows relative to the frame.
  const rowStep = float(1 / WINDOW_ROWS), colStep = CELL.x.div(aspect.mul(WINDOW_ROWS));
  const near = (a: F, b: F, step: F) => on(a.sub(b).abs().lessThan(step.mul(0.5)));
  const patternMask = pattern.equal(0).select(near(cellCentre.y, patternAt.y, rowStep),
    pattern.equal(1).select(near(cellCentre.x, patternAt.x, colStep),
      pattern.equal(2).select(near(cellCentre.x, patternAt.x, colStep.mul(5)).mul(near(cellCentre.y, patternAt.y, rowStep.mul(5))),
        pattern.equal(3).select(near(cellCentre.x.sub(patternAt.x).div(colStep), cellCentre.y.sub(patternAt.y).div(rowStep), float(1.2)),
          pattern.equal(4).select(on(cellCentre.y.greaterThan(0.5)), on(cellCentre.y.lessThan(0.5)))))));
  lit = max(lit, patternMask.mul(on(hash2(id.add(patternAt.mul(31))).lessThan(0.85))).mul(patternLevel));
  // Hats flick single windows; loudness keeps a few faintly on between hits.
  const hat = on(hash2(id.add(hatSeed.mul(97.3))).lessThan(hatDensity)).mul(0.9);
  const awake = on(own.lessThan(ambient)).mul(0.16);
  const palette = mix(colourA, colourB, on(hash2(id.add(2.2)).lessThan(mixShare)));
  const warm = vec3(1.0, 0.55, 0.22);
  const glow = palette.mul(max(lit, hat)).mul(2.4).add(mix(palette, warm, warmth).mul(awake).mul(2.4));
  // A lit room: bright through the glass, curtains and mullions darker, an occasional silhouette.
  const room = glow.mul(mix(float(1), folds.mul(0.3).add(0.6), drawn)).mul(figure.mul(0.65).oneMinus()).mul(mullion.mul(0.6).oneMinus()).mul(frameEdge.mul(0.5).oneMinus());

  // Concrete: panel seams at each bay, a slab band per floor, stains running down.
  const stain = mx_noise_float(vec2(view.x.mul(0.8), view.y.mul(0.12))).mul(0.5).add(0.5);
  const grit = mx_noise_float(view.mul(14)).mul(0.5).add(0.5);
  const seam = on(local.x.lessThan(0.025).or(local.y.lessThan(0.03)));
  const slab = on(local.y.lessThan(0.16)).mul(0.5).add(on(local.y.sub(0.17).abs().lessThan(0.015)).mul(-0.4));
  const concrete = vec3(0.028, 0.032, 0.034).mul(stain.mul(0.5).add(0.7)).mul(grit.mul(0.25).add(0.85)).mul(seam.mul(-0.45).add(1)).mul(slab.mul(0.35).add(1));
  // An air-conditioner box under some windows.
  const box = on(hash2(id.add(3.7)).lessThan(0.22)).mul(on(local.x.sub(0.5).sub(width.mul(0.35)).abs().lessThan(0.07).and(local.y.sub(0.19).abs().lessThan(0.05))));
  // Dark glass: grey-blue with a pale curtain behind and a faint sky reflection.
  const glass = vec3(0.016, 0.02, 0.026).add(vec3(0.03, 0.032, 0.03).mul(drawn).mul(folds.mul(0.6).add(0.4)).mul(curtain)).add(vec3(0.01, 0.014, 0.02).mul(local.y.sub(0.25).div(0.54)));
  const dark = glass.mul(mullion.mul(0.55).oneMinus()).add(vec3(0.02).mul(frameEdge));
  let colour = mix(concrete.add(vec3(0.03).mul(box)), dark.add(room), inside).add(floorLift);
  // A soft band of mist high on the facade.
  const mist = screenY.sub(0.84).abs().smoothstep(0.1, 0).mul(mx_noise_float(vec3(view.x.mul(0.08).add(time.mul(0.03)), view.y.mul(0.2), time.mul(0.02))).mul(0.3).add(0.7));
  colour = mix(colour, vec3(0.05, 0.06, 0.065), mist.mul(0.55));
  material.fragmentNode = vec4(colour, 1);

  const hits = createHits({ decay: 0.18, interval: 0.16 }), patterns = variantSequence(WINDOW_PATTERNS, 11), palettes = variantSequence(WINDOW_PALETTES.length, 4);
  const regionTable = variantSequence(3, 7), random = seededRandom(66), section = sectionWatch(60);
  const ages = [9, 9], peaks = [0, 0];
  let slot = 0, patternAge = 9, palette0 = 0, warmLevel = 1, hatTimer = 0;
  const setPalette = (index: number) => { const [a, b] = WINDOW_PALETTES[index]; colourA.value.setRGB(...linearRgb(a)); colourB.value.setRGB(...linearRgb(b)); mixShare.value = index === 1 ? 0.45 : 0.15; };
  setPalette(0);
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      const step = settleStep(frame), { bass, loudness, impact } = frame.response, gentle = frame.reducedFlash ? 0.4 : 1;
      hits.update(frame, 0.05);
      if (section(frame)) { palette0 = palettes.next(); setPalette(palette0); }
      if (hits.fired) {
        if (isSnare(frame)) {
          pattern.value = patterns.next(); patternAge = 0;
          patternAt.value.set(0.15 + random() * 0.7, 0.15 + random() * 0.7);
        } else {
          slot = 1 - slot; ages[slot] = 0; seeds[slot].value = random();
          // 20–90 windows of the ~500 in view, more for harder hits.
          const windows = 20 + 70 * Math.min(1, impact * 0.6 + bass * 0.6);
          densities[slot].value = windows / (WINDOW_ROWS * WINDOW_ROWS * frame.aspect / 1.15);
          // About every other burst fills only a band: the top half, a strip, or the bottom third.
          const band = hits.count % 2 === 0 ? regionTable.next() : -1;
          const y = 0.2 + random() * 0.6;
          regions[slot].value.set(...(band === 0 ? [0.5, 2] : band === 1 ? [y - 0.09, y + 0.09] : band === 2 ? [-1, 0.36] : [-1, 2]) as [number, number]);
          if (band >= 0) densities[slot].value *= band === 1 ? 4 : 2;
          peaks[slot] = 1;
        }
      }
      // Each burst snaps on, then fades to a dim afterglow in about half a second; bass holds the afterglow.
      const linger = 1.2 + bass * 3;
      for (let k = 0; k < 2; k++) {
        ages[k] += step;
        const snap = Math.exp(-ages[k] / 0.16), after = 0.1 * Math.exp(-ages[k] / linger);
        levels[k].value = peaks[k] * (snap * gentle + after);
      }
      patternAge += step;
      patternLevel.value = Math.exp(-patternAge / 0.18) * gentle + 0.12 * Math.exp(-patternAge / linger);
      // Hats: a new handful of single windows every couple of frames.
      hatTimer -= step;
      if (hatTimer <= 0) { hatTimer = 0.05; hatSeed.value = random(); }
      hatDensity.value = frame.audio.highs > 0.45 ? 0.004 * gentle * 2.5 : 0;
      ambient.value = approach(ambient.value, 0.03 + loudness * 0.05 + (frame.reducedFlash ? 0.02 : 0), step, 0.5);
      // Idle windows are warm; with music they take the palette.
      warmLevel = approach(warmLevel, loudness > 0.08 ? 0 : 1, step, 1.5); warmth.value = warmLevel;
      floorLift.value = frame.reducedFlash ? 0.006 : 0;
      driftY.value = frame.reducedMotion ? driftY.value : Math.sin(frame.time * 0.05) * 0.12;
    },
    dispose: () => disposeScene(scene),
  };
}
