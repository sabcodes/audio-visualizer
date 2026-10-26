import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { atan, exp, float, fract, mix, mx_fractal_noise_float, mx_noise_float, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import { disposeScene, approach, settleStep } from './shared';
import { fullscreen, hash2 } from './shaderModes';
import { createHits, linearRgb, variantSequence } from './hitPulse';
import { seededRandom } from '../rendering/diagnostics';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

const rgb = (hex: number) => vec3(...linearRgb(hex));

/** One disc: centre and radius (frame heights), how far the nucleus sits off centre, and how much its veins curl. */
export interface InkDisc { x: number; y: number; r: number; nx: number; ny: number; spiral: number }

/**
 * The stack arrangements from the clip, top to bottom; the last disc is the droplet under the thread. A hit
 * glides to the next one (never the same twice): the opening stack, the middle disc swollen and slid aside,
 * the merged chain with the droplet inflated, and the curled conch nucleus.
 */
export const INK_LAYOUTS: readonly (readonly InkDisc[])[] = [
  [{ x: -0.12, y: 0.27, r: 0.165, nx: 0.3, ny: 0.2, spiral: 0 }, { x: 0.09, y: 0.29, r: 0.155, nx: -0.25, ny: 0.15, spiral: 0.2 }, { x: -0.01, y: 0.12, r: 0.15, nx: 0.1, ny: -0.3, spiral: 0 },
    { x: 0.03, y: -0.06, r: 0.115, nx: -0.2, ny: 0.1, spiral: 0.1 }, { x: -0.015, y: -0.2, r: 0.075, nx: 0.1, ny: 0.2, spiral: 0 }, { x: 0, y: -0.37, r: 0.03, nx: 0, ny: 0, spiral: 0 }],
  [{ x: -0.15, y: 0.25, r: 0.15, nx: 0.35, ny: -0.1, spiral: 0.1 }, { x: 0.11, y: 0.31, r: 0.13, nx: -0.3, ny: 0.2, spiral: 0 }, { x: 0.12, y: 0.06, r: 0.195, nx: -0.15, ny: 0.25, spiral: 0.3 },
    { x: -0.09, y: -0.1, r: 0.11, nx: 0.25, ny: 0.05, spiral: 0 }, { x: 0, y: -0.25, r: 0.08, nx: -0.1, ny: 0.2, spiral: 0 }, { x: 0.01, y: -0.385, r: 0.035, nx: 0, ny: 0, spiral: 0 }],
  [{ x: 0.0, y: 0.33, r: 0.12, nx: 0.1, ny: -0.35, spiral: 0 }, { x: -0.02, y: 0.17, r: 0.115, nx: -0.1, ny: -0.3, spiral: 0.2 }, { x: 0.02, y: 0.02, r: 0.11, nx: 0.05, ny: -0.4, spiral: 0 },
    { x: -0.01, y: -0.13, r: 0.1, nx: 0, ny: -0.45, spiral: 0.1 }, { x: 0.0, y: -0.26, r: 0.07, nx: 0, ny: -0.3, spiral: 0 }, { x: 0, y: -0.38, r: 0.06, nx: 0, ny: 0.2, spiral: 0 }],
  [{ x: -0.05, y: 0.26, r: 0.18, nx: 0.2, ny: 0.1, spiral: 1 }, { x: 0.15, y: 0.17, r: 0.12, nx: -0.3, ny: 0.1, spiral: 0.2 }, { x: -0.15, y: 0.07, r: 0.13, nx: 0.3, ny: -0.1, spiral: 0 },
    { x: 0.05, y: -0.03, r: 0.14, nx: -0.1, ny: -0.2, spiral: 0.5 }, { x: -0.03, y: -0.2, r: 0.095, nx: 0.15, ny: 0.1, spiral: 0 }, { x: 0.01, y: -0.36, r: 0.045, nx: 0, ny: 0, spiral: 0 }],
];
export const INK_DISCS = 6;

/** Signed distance to a capsule whose radius tapers from ra at a to rb at b. */
function taper(p: V2, a: V2, b: V2, ra: F, rb: F) {
  const ba = b.sub(a), t = p.sub(a).dot(ba).div(ba.dot(ba)).clamp(0, 1);
  return p.sub(a.add(ba.mul(t))).length().sub(mix(ra, rb, t));
}

/**
 * Ink Discs (wave 5, clip 6): translucent indigo-and-cobalt discs stacked on cream paper, each with an offset
 * dark nucleus, fine radial veins, a dark rim and white pigment specks, joined by a tapering thread to a
 * droplet and outlined by a thin orange halo. Overlaps darken by multiplying. Calm by design: it never
 * flashes; kicks pinch a nucleus to a point, the bass swells the discs, mids turn the veins.
 */
export function createInkDiscsMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const aspect = uniform(1), time = uniform(0), twinkle = uniform(0);
  const shape = Array.from({ length: INK_DISCS }, () => uniform(new THREE.Vector4())); // x, y, r, vein turn
  const core = Array.from({ length: INK_DISCS }, () => uniform(new THREE.Vector4())); // nucleus x, y, spiral, pinch
  const darkness = Array.from({ length: INK_DISCS }, () => uniform(0.8));
  const p = uv().sub(0.5).mul(vec2(aspect, 1));
  const indigo = rgb(0x0b1a5a), cobalt = rgb(0x2f5fd0), sky = rgb(0x8fb6ee), paperTone = rgb(0xf3dcc9), haloTone = rgb(0xd98a4a);
  // Paper: cream with long fibres and a faint uneven stain.
  const fibre = mx_fractal_noise_float(vec3(p.x.mul(180), p.y.mul(28), 1), 3).mul(0.025);
  const stain = mx_fractal_noise_float(vec3(p.mul(2.2), 4), 3).mul(0.05);
  let colour: V3 = paperTone.mul(float(0.97).add(fibre).add(stain));
  let union: F = float(10), specks: F = float(0), pinholes: F = float(0);
  const pigment = (rho: F, edge: F, angleTurn: F, curl: F, pinch: F, dark: F, seed: number) => {
    // Body: indigo at the nucleus through cobalt to a pale sky rim, then a darker rim line.
    const body = mix(mix(indigo, cobalt, rho.smoothstep(0.0, 0.45)), sky, rho.smoothstep(0.4, 1.0));
    const rimLine = edge.smoothstep(-0.012, -0.002).mul(edge.smoothstep(0.0, -0.002));
    // Veins fan out from the nucleus; the curl term winds them into a conch near the centre.
    const veinAngle = angleTurn.add(curl.mul(float(1).sub(rho).pow(2).mul(5)));
    const warp = mx_noise_float(vec2(veinAngle.mul(4), rho.mul(3).add(seed))).mul(0.6);
    const strands = fract(veinAngle.mul(110 / (Math.PI * 2)).add(warp)).sub(0.5).abs().mul(2);
    const vein = strands.smoothstep(0.25, 0).mul(rho.smoothstep(0.08, 0.6)).mul(0.55);
    const nucleusSize = mix(float(0.3), float(0.06), pinch);
    const nucleus = exp(rho.div(nucleusSize).pow(2).negate()).mul(dark);
    const tint = mix(body, indigo.mul(0.6), vein.max(rimLine.mul(0.9)));
    return mix(tint, indigo.mul(0.45), nucleus);
  };
  for (let i = 0; i < INK_DISCS; i++) {
    const s = shape[i], c = core[i], centre = s.xy, r = s.z;
    const toCentre = p.sub(centre), d = toCentre.length(), edge = d.sub(r);
    union = union.min(edge);
    const mask = edge.smoothstep(0.0015, -0.0015);
    const nucleus = centre.add(c.xy.mul(r)), toNucleus = p.sub(nucleus);
    const rho = toNucleus.length().div(r.mul(float(1).add(c.xy.length()))).clamp(0, 1);
    const angle = atan(toNucleus.y, toNucleus.x).add(s.w);
    const tone = pigment(rho, edge, angle, c.z, c.w, darkness[i], i * 7);
    // Translucent pigment multiplies onto whatever is underneath.
    colour = colour.mul(mix(vec3(1), tone.div(paperTone).min(vec3(1)), mask.mul(0.88)));
    // White pigment specks, densest near the nucleus, twinkling with the hats.
    const grid = toCentre.div(0.011), id = grid.floor(), at = fract(grid).sub(0.5);
    const h = hash2(id.add(i * 13.1)), sparkle = hash2(id.add(vec2(time.mul(8).floor(), i)).add(7.7));
    const speck = at.length().smoothstep(0.22, 0.08).mul(h.greaterThan(mix(float(0.97), float(0.86), rho.oneMinus())).select(float(1), float(0)));
    specks = specks.add(speck.mul(mask).mul(mix(float(0.7), sparkle, twinkle)));
    pinholes = pinholes.add(exp(toNucleus.length().div(0.004).negate()).mul(c.w).mul(mask));
  }
  // The tail from the lowest disc, the thread, and the teardrop above the droplet.
  const last = shape[INK_DISCS - 2], drop = shape[INK_DISCS - 1];
  const tail = taper(p, last.xy.sub(vec2(0, last.z.mul(0.7))), last.xy.sub(vec2(0, last.z.mul(1.55))), last.z.mul(0.2), float(0.002));
  const thread = taper(p, last.xy.sub(vec2(0, last.z.mul(1.5))), drop.xy.add(vec2(0, drop.z.mul(1.6))), float(0.0018), float(0.0012));
  const tear = taper(p, drop.xy, drop.xy.add(vec2(0, drop.z.mul(1.7))), drop.z, float(0.002));
  const strands = tail.min(thread).min(tear);
  union = union.min(strands);
  colour = colour.mul(mix(vec3(1), mix(cobalt, indigo, 0.5).div(paperTone).min(vec3(1)), strands.smoothstep(0.0012, -0.0012).mul(0.85)));
  // The thin orange halo just outside the whole group.
  const halo = exp(union.sub(0.0075).abs().div(0.0016).negate()).mul(union.greaterThan(0).select(float(1), float(0)));
  colour = mix(colour, haloTone, halo.mul(0.75));
  colour = mix(colour, vec3(1, 0.98, 0.95), specks.clamp(0, 1).mul(0.85)).add(vec3(0.9, 0.95, 1).mul(pinholes.clamp(0, 1)));
  // A gentle vignette on the paper.
  colour = colour.mul(p.length().smoothstep(0.95, 0.3).mul(0.12).add(0.88));
  material.fragmentNode = vec4(colour, 1);

  const random = seededRandom(17), layouts = variantSequence(INK_LAYOUTS.length, 5);
  const live = INK_LAYOUTS[0].map((disc) => ({ ...disc }));
  const turns = new Float32Array(INK_DISCS), pinch = new Float32Array(INK_DISCS), phases = Array.from({ length: INK_DISCS }, () => random() * Math.PI * 2);
  const hits = createHits({ decay: 0.25, interval: 0.3 });
  let layout = 0, lastChange = 0, drift = 0;
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      const step = settleStep(frame), motion = frame.reducedMotion ? 0 : frame.delta, { bass, loudness, bounce } = frame.response;
      hits.update(frame);
      if (frame.time < lastChange) lastChange = 0;
      if (hits.fired) {
        // A kick pinches one of the top discs' nuclei to a bright point for a moment.
        pinch[Math.floor(random() * 4)] = 1;
        // Every few seconds a kick rearranges the stack.
        if (frame.time - lastChange > 2.5) { layout = layouts.next(); lastChange = frame.time; }
      }
      // Sustained loudness quickens the slow drift; bounce adds a little sway on top.
      drift += motion * (0.35 + loudness * 1.2);
      const target = INK_LAYOUTS[layout];
      for (let i = 0; i < INK_DISCS; i++) {
        const disc = live[i], goal = target[i];
        for (const key of ['x', 'y', 'r', 'nx', 'ny', 'spiral'] as const) disc[key] = approach(disc[key], goal[key], step, 0.9);
        pinch[i] *= Math.exp(-step / 0.25);
        turns[i] += motion * (0.04 + frame.audio.mid * 0.5) * (i % 2 ? -1 : 1);
        const sway = Math.sin(drift * (0.7 + i * 0.13) + phases[i]), swayX = Math.cos(drift * (0.5 + i * 0.09) + phases[i]);
        shape[i].value.set(disc.x + swayX * (0.006 + bounce * 0.01), disc.y + sway * (0.012 + bounce * 0.015), disc.r * (1 + bass * 0.05), turns[i]);
        core[i].value.set(disc.nx + Math.sin(drift * 0.4 + i) * 0.05, disc.ny + Math.cos(drift * 0.3 + i) * 0.05, disc.spiral, Math.min(1, pinch[i] * 1.6));
        darkness[i].value = approach(darkness[i].value, 0.65 + bass * 0.35, step, 0.1);
      }
      twinkle.value = approach(twinkle.value, frame.audio.highs, step, 0.05);
    },
    dispose: () => disposeScene(scene),
  };
}
