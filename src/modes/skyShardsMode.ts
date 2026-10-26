import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { exp, float, fwidth, mix, mx_fractal_noise_float, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import { disposeScene, approach, settleStep } from './shared';
import { fullscreen } from './shaderModes';
import { createHits, linearRgb, variantSequence } from './hitPulse';
import { seededRandom } from '../rendering/diagnostics';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

/**
 * The eight panel skies from the spec, plus the base dusk sky last. Colours are sRGB hex: the gradient's top
 * and horizon, the clouds' shadowed base and their sunlit rim. `sea` puts a dark sea under `horizon`.
 */
export const SKY_LOOKS = [
  { name: 'streak sunset', top: 0x3b2a5a, bottom: 0xff8a5a, cloud: 0x5a2848, rim: 0xffb48a, sea: 0, horizon: -0.22, density: 0.5, sun: 0.6 },
  { name: 'red clouds over sea', top: 0x4a0c1c, bottom: 0xff5030, cloud: 0x34080f, rim: 0xff7a48, sea: 1, horizon: -0.06, density: 0.6, sun: 0.9 },
  { name: 'golden bank', top: 0x5a3c18, bottom: 0xffc860, cloud: 0x6a4418, rim: 0xffe4a8, sea: 0, horizon: -0.3, density: 0.65, sun: 0.7 },
  { name: 'moonlit teal sea', top: 0x08202e, bottom: 0x2a6070, cloud: 0x0c2632, rim: 0xa8e0e8, sea: 1, horizon: 0.0, density: 0.42, sun: 0.35 },
  { name: 'storm sea', top: 0x0e162a, bottom: 0x3a5078, cloud: 0x121a2c, rim: 0xd0e0ff, sea: 1, horizon: -0.1, density: 0.7, sun: 0.5 },
  { name: 'orange edge', top: 0x2a1418, bottom: 0xff7a20, cloud: 0x180808, rim: 0xffa848, sea: 0, horizon: -0.26, density: 0.62, sun: 1 },
  { name: 'clean dusk', top: 0x0e1e4a, bottom: 0x5a7ab8, cloud: 0x26386a, rim: 0xa8bce8, sea: 0, horizon: -0.3, density: 0.25, sun: 0.2 },
  { name: 'backlit cumulus', top: 0x2a3a6a, bottom: 0xe8a0a0, cloud: 0x342c4a, rim: 0xfff0e0, sea: 0, horizon: -0.32, density: 0.75, sun: 0.85 },
  { name: 'base dusk', top: 0x08163a, bottom: 0x2c4c8c, cloud: 0x0e1a3a, rim: 0x6a88c0, sea: 0, horizon: -0.6, density: 0.55, sun: 0.1 },
] as const;
const PANEL_LOOKS = SKY_LOOKS.length - 1, BASE_LOOK = SKY_LOOKS.length - 1;

/** Pole x (frame heights from centre), and the crossarms' height and half-width; wires leave from the arm ends. */
export const POLE = { x: 0.1, arms: [[0.31, 0.17], [0.22, 0.15], [0.13, 0.13]] as const, slopeLeft: 0.24, slopeRight: 0.11 };
export const SKY_SLOTS = 16;

/**
 * Sky Shards (wave 5, clip 15): a wooden utility pole and its wires against a deep blue dusk. Parallelogram
 * slabs of other skies (sunsets, a red sea, a gold bank, a storm) wipe in along the wire lines, one per kick,
 * until the sky is a collage, rock a little, then fall out again. Every sky is a shader: a gradient, stretched
 * fBm clouds with self-shadowing and a sunlit rim, and a sea under the horizon for some looks.
 */
export function createSkyShardsMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const aspect = uniform(1), time = uniform(0), saturation = uniform(0.85), sway = uniform(new THREE.Vector2());
  const slots = Array.from({ length: SKY_SLOTS }, () => uniform(new THREE.Vector4(0, 0, 0, 0))); // reveal, look, rock x, rock y
  const p = uv().sub(0.5).mul(vec2(aspect, 1)).add(sway);
  const half = aspect.mul(0.5).add(0.02);
  // Each slot: a band between two wires (or the frame top), on one side of the pole, split into an inner and outer piece.
  type Line = (x: F) => F;
  const top: Line = () => float(2);
  // Left wires run down-left from the arms' left ends, right wires up-right from the right ends.
  const wire = (side: 'left' | 'right', k: number): Line => {
    const [y, h] = POLE.arms[k], m = side === 'left' ? POLE.slopeLeft : POLE.slopeRight, x0 = side === 'left' ? POLE.x - h : POLE.x + h;
    return (x) => x.sub(x0).mul(m).add(y);
  };
  const floorLine = (side: 'left' | 'right'): Line => (x) => x.sub(POLE.x).mul(side === 'left' ? POLE.slopeLeft * 0.6 : POLE.slopeRight * 0.6).sub(0.12);
  let look: F = float(BASE_LOOK), lookSlot: F = float(-1), edgeGlow: F = float(0), rock: V2 = vec2(0), slide: F = float(0);
  let index = 0;
  for (const side of ['left', 'right'] as const) {
    const lines = [top, wire(side, 0), wire(side, 1), wire(side, 2), floorLine(side)];
    const poleEdge = side === 'left' ? POLE.x - 0.02 : POLE.x + 0.02, cut = side === 'left' ? -0.42 : 0.6, slant = side === 'left' ? 0.35 : -0.3;
    for (let band = 0; band < 4; band++) {
      const upper = lines[band], lower = lines[band + 1];
      for (const [innerX, outerX] of [[float(poleEdge), float(cut)], [float(cut), side === 'left' ? half.negate() : half]] as const) {
        const slot = slots[index++], reveal = slot.x;
        // The visible edge slides from the inner side outward along the wire as the slot reveals.
        const sideX = (x0: F) => x0.add(p.y.sub(0.2).mul(slant));
        const reach = mix(innerX, outerX, reveal);
        const dir = side === 'left' ? -1 : 1;
        const dIn = p.x.sub(sideX(innerX)).mul(dir), dOut = sideX(reach).sub(p.x).mul(dir);
        const dUp = upper(p.x).sub(p.y), dDown = p.y.sub(lower(p.x));
        const d = dIn.min(dOut).min(dUp).min(dDown);
        const inside = d.greaterThan(0).and(reveal.greaterThan(0.001));
        look = inside.select(slot.y, look);
        lookSlot = inside.select(float(index), lookSlot);
        edgeGlow = inside.select(exp(d.div(0.012).negate()), edgeGlow);
        rock = inside.select(slot.zw, rock);
        slide = inside.select(reveal.oneMinus().mul(0.25 * dir), slide);
      }
    }
  }
  const pick = <T extends Node>(values: T[]) => values.reduceRight((rest, value, k) => look.lessThan(k + 0.5).select(value, rest) as unknown as T);
  const v3 = (key: 'top' | 'bottom' | 'cloud' | 'rim') => pick(SKY_LOOKS.map((s) => vec3(...linearRgb(s[key])) as V3));
  const f1 = (key: 'sea' | 'horizon' | 'density' | 'sun') => pick(SKY_LOOKS.map((s) => float(s[key]) as F));
  const skyTop = v3('top'), skyBottom = v3('bottom'), cloudTone = v3('cloud'), rimTone = v3('rim');
  const sea = f1('sea'), horizon = f1('horizon'), density = f1('density'), sunAmount = f1('sun');
  // Each slab shows its own photograph-like sky: offset by its slot so two slabs of one look still differ.
  const q = p.add(rock).add(vec2(slide, 0)).add(vec2(lookSlot.mul(1.37), lookSlot.mul(0.61)));
  const isBase = look.greaterThan(BASE_LOOK - 0.5);
  const sunAt = vec2(lookSlot.mul(0.37).sin().mul(0.5), horizon.add(0.06));
  const sun = exp(p.sub(sunAt).mul(vec2(0.6, 1.6)).length().div(0.25).negate()).mul(sunAmount);
  const gradient = mix(skyBottom, skyTop, p.y.smoothstep(horizon, 0.55).pow(0.8)).add(rimTone.mul(sun.mul(0.6)));
  // Clouds: anisotropic fBm drifting with the wind, shaded by sampling again toward the sun (self-shadowing).
  const wind = vec2(time.mul(0.012), 0);
  // Large soft masses: a warped low-frequency field, stretched along the wind.
  const field = (at: V2) => {
    const warp = mx_fractal_noise_float(vec3(at.mul(vec2(0.7, 1.8)), lookSlot.mul(1.7).add(9)), 3).mul(0.35);
    return mx_fractal_noise_float(vec3(at.x.mul(0.9).add(warp), at.y.mul(2.6).add(warp.mul(0.5)), lookSlot.mul(3.1)), 6, 2.1, 0.55).mul(0.5).add(0.5);
  };
  const at = q.add(wind);
  const base = field(at), toward = field(at.add(sunAt.sub(p).normalize().mul(0.025)));
  // The base sky keeps its cloud mass in the top right; slabs fill their whole area.
  const mass = isBase.select(p.x.mul(0.8).add(p.y).sub(0.25).smoothstep(-0.05, 0.35), float(1));
  const cloud = base.smoothstep(float(1).sub(density), float(1.3).sub(density)).mul(mass).mul(p.y.smoothstep(horizon, horizon.add(0.12)));
  const lit = base.sub(toward).mul(7).add(0.3).clamp(0, 1).mul(sunAmount.mul(0.7).add(0.3));
  const cloudColour = mix(cloudTone, rimTone, lit).add(rimTone.mul(sun.mul(cloud.oneMinus().mul(0.5))));
  let sky: V3 = mix(gradient, cloudColour, cloud.mul(0.92));
  // Sea under the horizon: dark, with glitter streaks under the sun.
  const below = p.y.lessThan(horizon).and(sea.greaterThan(0.5));
  const glitter = mx_fractal_noise_float(vec3(q.x.mul(18), p.y.mul(220).add(time.mul(0.5)), 2), 2).smoothstep(0.15, 0.6);
  const sunColumn = exp(p.x.sub(sunAt.x).abs().div(0.18).negate()).mul(exp(horizon.sub(p.y).div(0.25).negate()));
  const water = mix(skyTop.mul(0.25), skyBottom.mul(0.35), horizon.sub(p.y).div(0.4).oneMinus().clamp(0, 1)).add(rimTone.mul(glitter.mul(sunColumn).mul(sunAmount)));
  sky = below.select(water.add(rimTone.mul(exp(horizon.sub(p.y).div(0.004).negate()).mul(0.4))), sky);
  // Soft inner glow along each slab's edges, and saturation following the loudness.
  sky = sky.add(rimTone.mul(edgeGlow.mul(isBase.select(float(0), float(0.08)))));
  const luma = sky.dot(vec3(0.2126, 0.7152, 0.0722));
  sky = mix(vec3(luma), sky, isBase.select(float(1), saturation));
  // The pole, crossarms, insulators and wires: near-black, with a faint cool rim on the pole's left side.
  const dark = vec3(0.006, 0.006, 0.009);
  const poleHalf = mix(float(0.013), float(0.009), p.y.add(0.5).div(0.86));
  const poleD = p.x.sub(POLE.x).abs().sub(poleHalf);
  let cover: F = poleD.smoothstep(0.001, -0.001).mul(p.y.lessThan(0.37).select(float(1), float(0)));
  const rimLight = exp(p.x.sub(POLE.x - 0.0).add(poleHalf).abs().div(0.002).negate()).mul(cover).mul(0.25);
  POLE.arms.forEach(([y, h]) => {
    cover = cover.max(p.y.sub(y).abs().sub(0.006).smoothstep(0.001, -0.001).mul(p.x.sub(POLE.x).abs().sub(h).smoothstep(0.001, -0.001)));
    for (const off of [-h * 0.95, -h * 0.55, h * 0.55, h * 0.95]) {
      const ins = vec2(p.x.sub(POLE.x + off).mul(1.6), p.y.sub(y + 0.013)).length().sub(0.009);
      cover = cover.max(ins.smoothstep(0.001, -0.001));
    }
  });
  for (const side of ['left', 'right'] as const) for (let k = 0; k < 3; k++) {
    const line = wire(side, k), m = side === 'left' ? POLE.slopeLeft : POLE.slopeRight;
    const onSide = side === 'left' ? p.x.lessThan(POLE.x - POLE.arms[k][1] + 0.005) : p.x.greaterThan(POLE.x + POLE.arms[k][1] - 0.005);
    const d = p.y.sub(line(p.x)).abs().div(Math.sqrt(1 + m * m)), w = fwidth(p.y).mul(0.7).max(0.0007);
    cover = cover.max(d.smoothstep(w.mul(1.5), w.mul(0.3)).mul(onSide.select(float(1), float(0))));
  }
  const colour = mix(sky, dark, cover).add(vec3(0.3, 0.4, 0.6).mul(rimLight));
  material.fragmentNode = vec4(colour.mul(p.length().smoothstep(1.1, 0.35).mul(0.35).add(0.65)), 1);

  const random = seededRandom(23), looks = variantSequence(PANEL_LOOKS, 11);
  const state = Array.from({ length: SKY_SLOTS }, () => ({ reveal: 0, target: 0, look: 0, delay: 0 }));
  const hits = createHits({ decay: 0.2, interval: 0.25 });
  let quiet = 0, fullHits = 0, nextSide = 0;
  const retractAll = () => state.forEach((slot, i) => { if (slot.target) { slot.target = 0; slot.delay = (i % 4) * 0.08; } });
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      const step = settleStep(frame), { loudness } = frame.response;
      hits.update(frame);
      quiet = loudness < 0.12 ? quiet + step : 0;
      if (hits.fired) {
        const hidden = state.map((slot, i) => (slot.target ? -1 : i)).filter((i) => i >= 0);
        // A hat-heavy onset (the snare) cuts one slab out; a kick pushes the next slab in, alternating sides.
        if (frame.audio.highs > frame.audio.bass + 0.15 && hidden.length < SKY_SLOTS) {
          const shown = state.map((slot, i) => (slot.target ? i : -1)).filter((i) => i >= 0);
          state[shown[Math.floor(random() * shown.length)]].target = 0;
        } else if (hidden.length) {
          const side = hidden.filter((i) => (i < SKY_SLOTS / 2 ? 0 : 1) === nextSide), pool = side.length ? side : hidden;
          const chosen = state[pool[Math.floor(random() * pool.length)]];
          chosen.target = 1; chosen.look = looks.next(); chosen.delay = 0; chosen.reveal = 0;
          nextSide = 1 - nextSide;
        } else if (++fullHits > 6) { retractAll(); fullHits = 0; }
      }
      // A breakdown (a couple of quiet seconds) clears the sky back to dusk.
      if (quiet > 2) retractAll();
      const rockAmount = frame.reducedMotion ? 0 : 0.004 * (0.4 + loudness);
      state.forEach((slot, i) => {
        if (slot.delay > 0) slot.delay -= step;
        else slot.reveal = Math.min(1, Math.max(0, slot.reveal + (slot.target ? 1 : -1) * step / 0.25));
        // Ease-out on the way in, ease-in on the way out.
        const shown = slot.target ? 1 - (1 - slot.reveal) ** 3 : slot.reveal ** 2;
        slots[i].value.set(shown, slot.look, Math.sin(frame.time * 1.3 + i * 2.1) * rockAmount, Math.cos(frame.time * 1.1 + i * 1.7) * rockAmount);
      });
      saturation.value = approach(saturation.value, 0.65 + loudness * 0.5, step, 0.2);
      sway.value.set(frame.reducedMotion ? 0 : Math.sin(frame.time * 0.21) * 0.005, frame.reducedMotion ? 0 : Math.sin(frame.time * 0.17) * 0.003 + frame.response.bounce * 0.002);
    },
    dispose: () => disposeScene(scene),
  };
}
