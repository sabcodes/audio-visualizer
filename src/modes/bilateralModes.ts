import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { atan, cos, exp, float, fract, mix, max, texture as sampleTexture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { ModeFrame, VisualMode } from './types';
import { disposeScene, approach, settleStep, bandEnergies } from './shared';
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
export const BLOCK_COLOURS = [0xff2bd6, 0x35e010, 0xe5192b, 0x0b1e8f, 0xff6a00, 0x8a22c8] as const;
const BLOCK_COLUMNS = 16;

/** Mirrored column heights for one re-cut: louder bands rise, and the outline steps between 6 and 10 columns. */
export function blockOutline(frame: Pick<ModeFrame, 'spectrumMapping' | 'sampleRate' | 'audio'>, random: () => number, out = new Float32Array(BLOCK_COLUMNS)) {
  const columns = 6 + Math.floor(random() * 5), energy = bandEnergies(frame, columns);
  for (let i = 0; i < BLOCK_COLUMNS; i++) {
    const column = Math.min(columns - 1, Math.floor(i / BLOCK_COLUMNS * columns));
    out[i] = 0.45 + energy[column] * 0.35 + random() * 0.3;
  }
  return out;
}

export function createBlockBowtieMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const heights = new Float32Array(BLOCK_COLUMNS).fill(0.6);
  const heightTexture = new THREE.DataTexture(heights, BLOCK_COLUMNS, 1, THREE.RedFormat, THREE.FloatType);
  heightTexture.minFilter = heightTexture.magFilter = THREE.LinearFilter; heightTexture.needsUpdate = true;
  const aspect = uniform(1), halfWidth = uniform(0.2), halfHeight = uniform(0.075), colour = uniform(new THREE.Vector3(...linearRgb(0x35e010))), gain = uniform(0.05), core = uniform(0), glow = uniform(0.08);
  const { q } = mirrored(aspect);
  // Column heights are linearly filtered, so the steps between columns read as slanted cuts like the reference.
  const x = q.x.div(halfWidth);
  const h = sampleTexture(heightTexture, vec2(x.clamp(0, 1).mul(0.94).add(0.03), 0.5)).r.mul(halfHeight);
  const dx = q.x.sub(halfWidth), dy = q.y.sub(h);
  const outside = vec2(dx.max(0), dy.max(0)).length();
  const body = max(dx, dy).smoothstep(0.004, -0.004);
  // Brighter toward the middle and top edge; the soft halo stands in for heavy bloom.
  const shade = x.mul(-0.35).add(1).mul(q.y.div(h.max(1e-3)).mul(0.35).add(0.75));
  const halo = exp(outside.div(glow).negate()).mul(0.35);
  const spine = exp(q.x.mul(-140)).mul(q.y.lessThan(h).select(float(1), float(0))).mul(core);
  const rgb = colour.mul(body.mul(shade).add(halo)).add(vec3(1).mul(spine));
  material.fragmentNode = vec4(rgb.mul(gain), 1);

  const hits = createHits({ decay: 0.2, interval: 0.3, variants: BLOCK_COLOURS.length, seed: 11 });
  const random = seededRandom(23);
  let size = 0;
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect;
      hits.update(frame, 0.05);
      if (hits.fired) { blockOutline(frame, random, heights); heightTexture.needsUpdate = true; }
      size = approach(size, frame.response.bass, settleStep(frame), 0.1);
      halfWidth.value = frame.aspect * 0.09 * (1 + size * 0.3);
      halfHeight.value = 0.12 * (1 + size * 0.4);
      colour.value.set(...linearRgb(BLOCK_COLOURS[hits.variant]));
      // The navy variant is dark by nature; give it a little more light so it still reads.
      const navy = BLOCK_COLOURS[hits.variant] === 0x0b1e8f ? 2.2 : 1;
      core.value = 0.4 + hits.flash * 1.6;
      glow.value = 0.04 + frame.response.loudness * 0.06;
      gain.value = (hits.floor + hits.flash * 1.3) * navy;
    },
    dispose() { disposeScene(scene); heightTexture.dispose(); },
  };
}
