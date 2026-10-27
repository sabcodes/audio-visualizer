import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { atan, exp, float, fract, max, min, mix, mx_noise_float, sin, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import { disposeScene, approach, settleStep } from './shared';
import { fullscreen, hash2 } from './shaderModes';
import { createHits, variantSequence } from './hitPulse';
import { isSnare, sectionWatch } from './waveSixShared';
import { seededRandom } from '../rendering/diagnostics';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

/** Layouts: big eye; eye beside a lens column; eye framed by an icon border; a grid of small eyes; text wall with digits; iris close-up. */
export const EYE_SCENES = ['eye', 'lens column', 'icon border', 'eye grid', 'text wall', 'iris'] as const;
/** Transitions picked per kick: cut, slide, zoom-through, mask morph, RGB-split glitch. */
export const EYE_TRANSITIONS = ['cut', 'slide', 'zoom', 'morph', 'glitch'] as const;
/** Panel masks: rectangle, circle, crescent, notched rectangle. */
export const EYE_MASKS = 4;

const on = (c: Node<'bool'>) => c.select(float(1), float(0));
const box = (p: V2, half: V2) => { const d = p.abs().sub(half); return d.max(vec2(0)).length().add(min(max(d.x, d.y), float(0))); };

/**
 * One eye in photocopy black and white, in its own space (x across −1…1): the almond of the lids, lashes along the
 * upper lid, a crease above, the iris with radial fibres, the pupil and a highlight. Returns ink (1 paper white,
 * 0 black) and the distance to the almond's edge (for the neon outline).
 */
function eye(q: V2, time: F, dilate: F, blink: F, look: V2) {
  const lid = q.mul(vec2(1, float(1).div(blink.max(0.08))));
  const upper = lid.sub(vec2(0, -0.9)).length().sub(1.35), lower = lid.sub(vec2(0, 1.1)).length().sub(1.45);
  const almond = max(upper, lower);
  const inside = on(almond.lessThan(0));
  const iris = q.sub(look).length(), angle = atan(q.y.sub(look.y), q.x.sub(look.x));
  const fibres = sin(angle.mul(70).add(mx_noise_float(vec3(angle.mul(6), iris.mul(9), 1)).mul(4))).mul(0.5).add(0.5);
  const pupilR = float(0.13).add(dilate.mul(0.1));
  let ink: F = mix(float(0.92), float(0.55), q.x.abs().smoothstep(0.3, 1)); // the white, shaded into the corners
  ink = mix(ink, fibres.mul(0.45).add(0.12).mul(iris.smoothstep(pupilR, 0.4).mul(0.7).add(0.3)), on(iris.lessThan(0.42)));
  ink = mix(ink, float(0), on(iris.sub(0.42).abs().lessThan(0.025)));
  ink = mix(ink, float(0.02), on(iris.lessThan(pupilR)));
  ink = mix(ink, float(1), on(q.sub(look).sub(vec2(-0.12, 0.12)).length().lessThan(0.06)));
  // Skin round the eye: pale paper with soft shading, a crease line above and a dark rim along the lids.
  const crease = on(q.sub(vec2(0, -1.25)).length().sub(1.85).abs().lessThan(0.018).and(q.y.greaterThan(0.2)));
  const socket = almond.smoothstep(0, 0.5).mul(0.3).add(0.5);
  const skin = mx_noise_float(vec3(q.mul(2), 3)).mul(0.16).add(mx_noise_float(vec3(q.mul(14), 5)).mul(0.08)).add(socket).sub(crease.mul(0.6));
  // Lashes: strokes fanning out of the upper lid.
  const fromUpper = lid.sub(vec2(0, -0.9)), lashAngle = atan(fromUpper.x, fromUpper.y);
  const lashBand = upper.greaterThan(0).and(upper.lessThan(float(0.22).mul(q.x.abs().oneMinus().max(0.2)))).and(q.y.greaterThan(0));
  const lash = on(lashBand.and(fract(lashAngle.mul(38).add(upper.mul(4))).lessThan(0.3)));
  const rim = on(almond.abs().lessThan(0.03));
  const outside = skin.sub(lash.mul(0.8)).sub(rim.mul(0.7));
  return { ink: mix(outside, ink, inside).clamp(0, 1), edge: almond };
}

/**
 * Eye Stage (wave 6, #6): a TouchDesigner-style live visual set, faced straight on: stacked collage layers in
 * high-contrast photocopy black and white with magenta accents. A hero eye in a panel that changes shape, lens
 * rings, rails of small eye icons, scrambled text and big glitchy digits; a magenta neon line traces round the eye,
 * and white-blue laser fans and a purple haze sweep in front. Kicks cut, slide, zoom through or glitch to the next
 * layout, snares sweep the outline and fire a laser fan, bass pushes the eye in, mids dilate the iris and blink,
 * hats flicker the icons and scramble the text, loudness sets the white level.
 */
export function createEyeStageMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const random = seededRandom(606);
  const aspect = uniform(16 / 9), time = uniform(0), layout = uniform(0), zoom = uniform(1), slide = uniform(0), maskFrom = uniform(0), maskTo = uniform(0), morph = uniform(1);
  const split = uniform(0), sweep = uniform(-1), lasers = uniform(0), haze = uniform(0), push = uniform(0), dilate = uniform(0.3), blink = uniform(1), white = uniform(0.85);
  const icons = uniform(1), scramble = uniform(0), breathe = uniform(1), look = uniform(new THREE.Vector2());

  const frameAt = (p: V2) => {
    // Centred frame coordinates: y −0.5…0.5, x by aspect; the whole stack breathes and slides.
    const q = p.sub(vec2(slide, 0)).div(breathe);
    // The panel mask, morphing between two shapes.
    const panelHalf = vec2(aspect.mul(0.36), 0.4);
    const maskSdf = (index: F) => {
      const rect = box(q, panelHalf), circle = q.length().sub(0.44);
      const crescent = max(circle, q.sub(vec2(0.22, 0.12)).length().sub(0.38).negate());
      const notch = max(rect, box(q.sub(panelHalf.mul(vec2(1, -1))), vec2(0.18, 0.12)).negate());
      return index.equal(0).select(rect, index.equal(1).select(circle, index.equal(2).select(crescent, notch)));
    };
    const panel = mix(maskSdf(maskFrom), maskSdf(maskTo), morph);
    const inPanel = on(panel.lessThan(0));
    // Hero eye: pushed in by bass, zoomed for zoom-throughs and the iris layout.
    const heroScale = float(0.62).div(push.mul(0.12).add(1)).div(zoom).div(layout.equal(5).select(float(5), float(1)));
    const heroCentre = layout.equal(1).select(vec2(aspect.mul(-0.12), 0), vec2(0, 0));
    const hero = eye(q.sub(heroCentre).div(heroScale).add(layout.equal(5).select(look, vec2(0))), time, dilate, blink, look);
    // Lens rings: concentric circles of varying weight.
    const lensAt = (c: V2, r: F) => { const d = q.sub(c).length().div(r); return on(fract(d.mul(4)).lessThan(d.mul(0.35).add(0.12))).mul(on(d.lessThan(1))); };
    const column = lensAt(vec2(aspect.mul(0.36), 0.28), float(0.14)).add(lensAt(vec2(aspect.mul(0.36), 0), float(0.12))).add(lensAt(vec2(aspect.mul(0.36), -0.28), float(0.14)));
    // Icon rails: rows of small eye icons round the edge, flickering with the hats.
    const iconGrid = q.add(vec2(aspect.mul(0.5), 0.5)).div(0.09), iconCell = iconGrid.floor(), iconLocal = fract(iconGrid).sub(0.5);
    const rails = on(q.y.greaterThan(0.41).or(q.x.abs().greaterThan(aspect.mul(0.5).sub(0.09))));
    const iconShape = on(iconLocal.length().sub(0.32).abs().lessThan(0.07)).add(on(iconLocal.length().lessThan(0.12)));
    const iconOn = on(hash2(iconCell.add(scramble.floor())).lessThan(icons));
    const iconLayer = iconShape.mul(rails).mul(iconOn);
    // Small eyes in a grid.
    const cellSize = vec2(aspect.div(4), float(0.5)), gridQ = q.add(vec2(aspect.mul(0.5), 0.5)).div(cellSize), gridId = gridQ.floor();
    const small = eye(fract(gridQ).sub(0.5).mul(vec2(2.6, 2.6)), time, dilate, blink, look.mul(hash2(gridId).sub(0.5).mul(2)));
    // Text wall: dense scrambled glyph bars, and big seven-segment digits.
    const textCell = q.mul(vec2(70, 34)).floor(), textLocal = fract(q.mul(vec2(70, 34)));
    const glyphs = on(hash2(textCell.add(scramble.floor().mul(7.3))).lessThan(0.55).and(textLocal.x.lessThan(0.7)).and(textLocal.y.sub(0.5).abs().lessThan(0.28)));
    const digit = (c: V2, seed: F) => {
      const d = q.sub(c).div(vec2(0.11, 0.18)), segs = [[0, 0.9, 0.8, 0.12], [0, 0, 0.8, 0.12], [0, -0.9, 0.8, 0.12], [-0.8, 0.45, 0.12, 0.5], [0.8, 0.45, 0.12, 0.5], [-0.8, -0.45, 0.12, 0.5], [0.8, -0.45, 0.12, 0.5]];
      let lit: F = float(0);
      segs.forEach(([x, y, w, h], k) => { lit = lit.max(on(box(d.sub(vec2(x, y)), vec2(w, h)).lessThan(0)).mul(on(hash2(vec2(seed, k)).lessThan(0.7)))); });
      return lit;
    };
    const digits = digit(vec2(aspect.mul(-0.22), -0.12), scramble.floor()).add(digit(vec2(0, -0.12), scramble.floor().add(1))).add(digit(vec2(aspect.mul(0.22), -0.12), scramble.floor().add(2)));
    // Compose the layout.
    const panelInk = mix(float(0), hero.ink, inPanel);
    let ink: F = layout.equal(0).or(layout.equal(5)).select(panelInk,
      layout.equal(1).select(panelInk.max(column),
        layout.equal(2).select(panelInk.max(iconLayer),
          layout.equal(3).select(small.ink.mul(on(fract(gridQ).sub(0.5).abs().max(vec2(0)).x.lessThan(0.46))),
            glyphs.mul(0.75).max(digits)))));
    // Photocopy: threshold into three levels with grain.
    const grain = hash2(p.mul(vec2(1931, 2711)).add(fract(time.mul(13)))).sub(0.5).mul(0.25);
    const toned = ink.add(grain).smoothstep(0.3, 0.38).mul(0.55).add(ink.add(grain).smoothstep(0.6, 0.68).mul(0.45));
    // Magenta outline: a dash running round the eye's edge (or the panel) after a snare.
    const edge = layout.equal(3).select(small.edge, hero.edge.mul(heroScale));
    const along = atan(q.y, q.x).div(Math.PI * 2).add(0.5);
    const dash = on(fract(along.sub(sweep)).lessThan(0.35)).mul(on(sweep.greaterThanEqual(0)));
    const outline = exp(edge.abs().div(0.004).negate()).mul(dash.mul(0.8).add(0.2)).add(exp(panel.abs().div(0.003).negate()).mul(0.35));
    return { toned, outline, inPanel };
  };
  const p = uv().sub(0.5).mul(vec2(aspect, 1));
  const centre = frameAt(p);
  const paperWhite = vec3(0.72, 0.69, 0.65).mul(white);
  let colour: V3 = vec3(centre.toned).mul(paperWhite).add(0.008);
  colour = colour.add(vec3(1.6, 0.1, 1.3).mul(centre.outline));
  // Stage light in front: thin white-blue laser fans from below and a purple haze sweeping across.
  const fromBase = p.sub(vec2(0, -0.6)), beamAngle = atan(fromBase.x, fromBase.y);
  const beams = exp(fract(beamAngle.mul(7).add(time.mul(0.6))).sub(0.5).abs().div(0.008).negate()).mul(lasers).mul(fromBase.length().smoothstep(1.2, 0.2));
  const purple = exp(p.x.sub(sin(time.mul(0.7)).mul(aspect.mul(0.4))).abs().div(0.35).negate()).mul(haze);
  colour = colour.add(vec3(0.7, 0.85, 1.4).mul(beams)).add(vec3(0.22, 0.03, 0.4).mul(purple));
  material.fragmentNode = vec4(colour, 1);
  // RGB-split glitch frames: the finished frame's channels pulled apart sideways.
  const filter = (input: THREE.TextureNode) => {
    const q = uv(), offset = vec2(split.div(aspect), 0);
    return vec4(input.sample(q.add(offset)).r, input.sample(q).g, input.sample(q.sub(offset)).b, 1);
  };

  const hits = createHits({ decay: 0.2, interval: 0.25 }), scenes = variantSequence(EYE_SCENES.length, 61), transitions = variantSequence(EYE_TRANSITIONS.length, 62), masks = variantSequence(EYE_MASKS, 63);
  const section = sectionWatch(45);
  let transition = -1, transitionAge = 0, sweepAge = -1, laserLevel = 0, blinkAge = -1, pushLevel = 0;
  const next = () => { layout.value = scenes.next(); };
  return {
    scene, camera, filter,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      const step = settleStep(frame), { bass, loudness, impact } = frame.response;
      hits.update(frame, 0.1);
      if (section(frame)) { maskFrom.value = maskTo.value = masks.next(); next(); }
      if (hits.fired) {
        if (isSnare(frame)) { sweepAge = 0; laserLevel = frame.reducedFlash ? 0.5 : 1; }
        else {
          // Strong kicks zoom through; the rest pick a transition (never the same twice running).
          transition = impact > 0.9 ? 2 : transitions.next(); transitionAge = 0;
          if (transition === 0) next();
          if (transition === 3) { maskFrom.value = maskTo.value; maskTo.value = masks.next(); morph.value = 0; }
        }
      }
      if (transition >= 0) {
        transitionAge += step;
        if (transition === 1) { slide.value = (1 - Math.min(1, transitionAge / 0.25)) ** 2 * frame.aspect * 0.8; if (transitionAge < step * 1.5) next(); }
        if (transition === 2) { zoom.value = 1 + (transitionAge / 0.3) ** 2 * 6; if (transitionAge > 0.3) { zoom.value = 1; next(); transition = -1; } }
        if (transition === 3) morph.value = Math.min(1, transitionAge / 0.3);
        if (transition === 4) { split.value = transitionAge < 0.12 ? 0.012 * (frame.reducedFlash ? 0.5 : 1) : 0; if (transitionAge > 0.06 && transitionAge < 0.06 + step * 1.5) next(); }
        if (transitionAge > 0.4) { transition = -1; slide.value = 0; split.value = 0; morph.value = 1; zoom.value = 1; }
      }
      if (sweepAge >= 0) { sweepAge += step; sweep.value = sweepAge * 1.4; if (sweepAge > 0.9) { sweepAge = -1; sweep.value = -1; } }
      laserLevel = Math.max(0, laserLevel - step * 2.5); lasers.value = 0.15 + laserLevel * 0.9;
      pushLevel = approach(pushLevel, bass, step, 0.12); push.value = pushLevel;
      haze.value = approach(haze.value, 0.2 + bass * 0.6, step, 0.3);
      dilate.value = approach(dilate.value, frame.audio.mid, step, 0.15);
      // Blinks: now and then, more often with the mids.
      if (blinkAge < 0 && random() < step * (0.15 + frame.audio.mid * 0.6)) blinkAge = 0;
      if (blinkAge >= 0) { blinkAge += step; blink.value = Math.abs(Math.cos(Math.min(1, blinkAge / 0.18) * Math.PI)) * 0.92 + 0.08; if (blinkAge > 0.18) { blinkAge = -1; blink.value = 1; } }
      if (frame.audio.highs > 0.45) scramble.value += step * 14;
      icons.value = approach(icons.value, 0.55 + (frame.audio.highs > 0.45 ? random() * 0.45 : 0.4), step, 0.05);
      white.value = approach(white.value, 0.6 + loudness * 0.45, step, 0.2);
      breathe.value = 1 + Math.sin(frame.time * 0.5) * 0.015;
      look.value.set(Math.sin(frame.time * 0.37) * 0.12, Math.sin(frame.time * 0.23) * 0.06);
    },
    dispose: () => disposeScene(scene),
  };
}
