import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { atan, cos, exp, float, fract, mix, max, sin, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { ModeFrame, VisualMode } from './types';
import { disposeScene, approach, settleStep } from './shared';
import { fullscreen, palette } from './shaderModes';
import { createHits, linearRgb } from './hitPulse';
import { seededRandom } from '../rendering/diagnostics';

type F = Node<'float'>;
type V2 = Node<'vec2'>;

/** Centred, aspect-corrected coordinates folded into one quadrant: both bowtie modes mirror left/right and top/bottom. */
function mirrored(aspect: F) {
  const p = uv().sub(0.5).mul(vec2(aspect, 1));
  return { p, q: p.abs() as V2 };
}

/** Prism Bowtie hit variants: idle X, pink blow-out with panel grid, rainbow fan, red fan with white core, blue arches. */
export const PRISM_VARIANTS = [
  { tint: 0xff5cd6, width: 0.07, rays: 28, white: 0.2, rainbow: 0, grid: 0, arches: 0 },
  { tint: 0xff5cd6, width: 0.62, rays: 60, white: 0.85, rainbow: 0, grid: 1, arches: 0 },
  { tint: 0xffffff, width: 0.34, rays: 44, white: 0.3, rainbow: 1, grid: 0.3, arches: 0 },
  { tint: 0xff2a3c, width: 0.28, rays: 36, white: 0.6, rainbow: 0, grid: 0.4, arches: 0 },
  { tint: 0xff5cd6, width: 0.2, rays: 52, white: 0.4, rainbow: 0.4, grid: 0.2, arches: 1 },
] as const;

export function createPrismBowtieMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const aspect = uniform(1), width = uniform(0.07), centre = uniform(0.45), rays = uniform(28), spread = uniform(0.02), gain = uniform(0.05);
  const white = uniform(0.2), rainbow = uniform(0), grid = uniform(0), arches = uniform(0), tint = uniform(new THREE.Vector3(...linearRgb(0xff5cd6))), time = uniform(0);
  const { q } = mirrored(aspect);
  const r = q.length(), angle = atan(q.y, q.x);
  // One fan of rays per quadrant; the striations come from a cosine in angle, so every channel can be offset.
  const fan = (a: F) => {
    const inside = a.sub(centre).abs().smoothstep(width, width.mul(0.55));
    const striae = cos(a.mul(rays).add(time.mul(0.3))).mul(0.5).add(0.5).pow(3);
    return inside.mul(mix(float(0.35), float(1), striae));
  };
  const red = fan(angle.add(spread)), green = fan(angle), blue = fan(angle.sub(spread));
  // Rays start just outside a small dark hub and fade toward the frame edge.
  const radial = r.smoothstep(0.015, 0.09).mul(exp(r.mul(-1.6)));
  // LED panels: a dot grid that shows through the blow-out.
  const dotCell = fract(q.mul(110)).sub(0.5).length().smoothstep(0.42, 0.18);
  const panel = fract(q.mul(vec2(6, 9))).sub(0.5).abs();
  const panelLine = max(panel.x, panel.y).smoothstep(0.45, 0.5);
  const leds = mix(float(1), dotCell.mul(0.75).add(0.25), grid).mul(panelLine.mul(grid).mul(-0.6).add(1));
  const hue = palette(angle.mul(2.2).add(r.mul(1.5)));
  const colour = mix(tint, hue, rainbow);
  const beams = vec3(red, green, blue).mul(colour).add(vec3(green.mul(white))).mul(radial).mul(leds).mul(1.7);
  // A few bright pinpoints at the hub, where the four fans meet.
  const hub = exp(r.mul(-55)).mul(1.4);
  // Blue arch silhouettes behind (one variant only).
  const arch = fract(q.sub(vec2(0.55, 0)).length().mul(5)).sub(0.5).abs().smoothstep(0.04, 0.0).mul(arches).mul(0.25);
  material.fragmentNode = vec4(beams.add(vec3(1, 0.8, 0.95).mul(hub)).add(vec3(0.15, 0.2, 1).mul(arch)).mul(gain), 1);

  const hits = createHits({ decay: 0.15, interval: 0.18, variants: PRISM_VARIANTS.length, seed: 5 });
  let open = 0;
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      hits.update(frame, 0.12);
      // On a hit the picture jumps to the next variant; between hits it collapses back to the thin pink X.
      const look = hits.level > 0.08 ? PRISM_VARIANTS[hits.variant] : PRISM_VARIANTS[0];
      open = approach(open, frame.response.bass, settleStep(frame), 0.08);
      width.value = PRISM_VARIANTS[0].width + (look.width - PRISM_VARIANTS[0].width) * hits.flash + open * 0.08;
      rays.value = look.rays + Math.round(frame.audio.highs * 16);
      spread.value = 0.012 + frame.audio.highs * 0.02 + hits.flash * 0.02;
      tint.value.set(...linearRgb(look.tint));
      white.value = look.white * hits.flash; rainbow.value = look.rainbow; grid.value = look.grid * hits.flash; arches.value = look.arches * hits.flash;
      gain.value = hits.floor * 1.2 + hits.flash * 0.9 + open * 0.15;
    },
    dispose: () => disposeScene(scene),
  };
}

/** Block Bowtie colours, one per hit and never the same twice in a row. */
export const BLOCK_COLOURS = [0xff2bd6, 0x35e010, 0xe5192b, 0x1a3cff, 0xff6a00, 0x8a22c8] as const;
/** Silhouette families the outline blends between: bowtie flare, barrel, wave, diamond, teeth. */
export const BOWTIE_SHAPES = 5;

/**
 * Target blend for one hit: the hit's own family dominates, a second family mixes in, and louder bass
 * pushes toward the spikier shapes. Weights sum to 1 so the outline keeps its scale.
 */
export function bowtieBlend(primary: number, frame: Pick<ModeFrame, 'response'>, random: () => number, out = new Float32Array(BOWTIE_SHAPES)) {
  out.fill(0);
  const secondary = (primary + 1 + Math.floor(random() * (BOWTIE_SHAPES - 1))) % BOWTIE_SHAPES;
  const share = 0.15 + random() * 0.3 + Math.min(0.2, frame.response.bass * 0.2);
  out[primary] += 1 - share; out[secondary] += share;
  return out;
}

export function createBlockBowtieMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const aspect = uniform(1), halfWidth = uniform(0.2), halfHeight = uniform(0.075), gain = uniform(0.05), core = uniform(0), glow = uniform(0.08), time = uniform(0);
  const colour = uniform(new THREE.Vector3(...linearRgb(0x35e010))), accent = uniform(new THREE.Vector3(...linearRgb(0xff2bd6)));
  const phase = uniform(0), flap = uniform(0), stripes = uniform(0), pinch = uniform(0);
  const weights = Array.from({ length: BOWTIE_SHAPES }, (_, i) => uniform(i === 0 ? 1 : 0));
  const { p, q } = mirrored(aspect);
  /** Outline height at x (0 centre – 1 tip), as a blend of the five families; the phase keeps it rippling. */
  const profile = (x: F, ph: F) => {
    const shapes = [
      mix(float(0.4), float(1.15), x.pow(1.6)).sub(pinch.mul(x.oneMinus()).mul(0.25)),
      float(1).sub(x.mul(x).mul(0.45)),
      sin(x.mul(9).sub(ph.mul(2))).mul(0.2).add(0.9),
      mix(float(1.45), float(0.5), x.pow(0.6)),
      fract(x.mul(5).add(ph.mul(0.15))).sub(0.5).abs().mul(0.8).add(0.62),
    ];
    return shapes.reduce<F>((sum, shape, i) => sum.add(shape.mul(weights[i])), float(0)).mul(x.mul(x).mul(flap).add(1));
  };
  /** One mirrored layer: body mask, distance outside it, and its 0–1 coordinates. */
  const layer = (sx: number, sy: number, ph: F) => {
    const w = halfWidth.mul(sx), x = q.x.div(w);
    const h = profile(x.clamp(0, 1), ph).mul(halfHeight).mul(sy);
    const dx = q.x.sub(w), dy = q.y.sub(h);
    return { body: max(dx, dy).smoothstep(0.004, -0.004), outside: vec2(dx.max(0), dy.max(0)).length(), x, v: q.y.div(h.max(1e-3)) };
  };
  const front = layer(1, 1, phase), back = layer(1.14, 1.3, phase.add(1.7));
  // Folded-fabric shading: soft vertical pleats, brighter toward the middle and the top edge.
  const pleats = mix(float(1), cos(front.x.mul(28).add(phase.mul(3))).mul(0.5).add(0.5).pow(2).mul(0.55).add(0.45), stripes);
  const shade = front.x.mul(-0.35).add(1).mul(front.v.mul(0.35).add(0.75)).mul(pleats);
  const halo = exp(front.outside.div(glow).negate()).mul(0.35);
  // Gradient from the accent colour at the core to the main colour at the tips.
  const body = mix(accent, colour, front.x.clamp(0, 1).pow(0.5));
  const ghost = colour.mul(back.body.mul(front.body.oneMinus()).mul(0.3));
  const spine = exp(q.x.mul(-140)).mul(front.body).mul(core);
  const heart = exp(p.length().div(halfHeight.mul(0.35)).negate()).mul(core).mul(0.6);
  const rgb = body.mul(front.body.mul(shade)).add(colour.mul(halo)).add(ghost).add(vec3(1).mul(spine.add(heart)));
  material.fragmentNode = vec4(rgb.mul(gain), 1);

  const hits = createHits({ decay: 0.2, interval: 0.3, variants: BLOCK_COLOURS.length, seed: 11 });
  const random = seededRandom(23), target = new Float32Array(BOWTIE_SHAPES).fill(0), toColour = new THREE.Vector3(), toAccent = new THREE.Vector3();
  target[0] = 1; toColour.copy(colour.value); toAccent.copy(accent.value);
  let size = 0, ripple = 0, punch = 0;
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      const step = settleStep(frame), still = frame.reducedMotion;
      hits.update(frame, 0.05);
      // A hit picks a new silhouette blend and colour; the shape then flows there instead of cutting.
      if (hits.fired) {
        bowtieBlend(Math.floor(random() * BOWTIE_SHAPES), frame, random, target);
        toColour.set(...linearRgb(BLOCK_COLOURS[hits.variant]));
        toAccent.set(...linearRgb(BLOCK_COLOURS[(hits.variant + 1 + Math.floor(random() * (BLOCK_COLOURS.length - 1))) % BLOCK_COLOURS.length]));
        stripes.value = random() < 0.35 ? 1 : 0;
        punch = 1;
      }
      weights.forEach((weight, i) => { weight.value = approach(weight.value, target[i], step, 0.16); });
      colour.value.lerp(toColour, 1 - Math.exp(-step / 0.12)); accent.value.lerp(toAccent, 1 - Math.exp(-step / 0.25));
      punch *= Math.exp(-step / 0.18);
      size = approach(size, frame.response.bass, step, 0.08);
      if (!still) ripple += frame.delta * (0.6 + frame.response.loudness * 2.5);
      phase.value = ripple;
      // Wings lift and drop with the bass, and the middle pinches in on each hit.
      flap.value = still ? 0 : Math.sin(frame.time * 2.1) * 0.12 + size * 0.35 - punch * 0.15;
      pinch.value = punch;
      halfWidth.value = frame.aspect * 0.12 * (1 + size * 0.25 + punch * 0.1);
      halfHeight.value = 0.075 * (1 + size * 0.4 + punch * 0.2);
      // Blue is dark by nature; give it a little more light so it still reads.
      const dim = Math.max(0.2, toColour.x * 0.3 + toColour.y * 0.6 + toColour.z * 0.1);
      core.value = 0.15 + hits.flash * 1.2;
      glow.value = 0.04 + frame.response.loudness * 0.06;
      gain.value = (0.35 + hits.flash * 0.7 + size * 0.15) * Math.min(2.2, 0.45 / dim + 0.6);
    },
    dispose: () => disposeScene(scene),
  };
}
