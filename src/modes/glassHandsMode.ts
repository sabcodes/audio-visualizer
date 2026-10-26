import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { Fn, If, Loop, float, fract, min, mix, mx_noise_float, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import { disposeScene, approach, settleStep } from './shared';
import { fullscreen, hash2 } from './shaderModes';
import { createHits, variantSequence } from './hitPulse';
import { HAND_SEGMENTS, poseHand, type HandPose } from './handModel';
import { drive, isSnare } from './waveSixShared';
import { seededRandom } from '../rendering/diagnostics';
import { presetBudget, type QualityBudget } from '../rendering/quality';

type V2 = Node<'vec2'>;

/** Grid sizes: columns × rows of tall tiles, full and at the lowest tier. */
export const GLASS_GRID = { full: [7, 3], low: [6, 2] } as const;
/** Press poses: open palm, spread fingertips (the palm tipped away), a fist, a relaxed hand, a narrow hand sliding down. */
export const GLASS_POSES: readonly { pose: HandPose; pitch: number; slide: number }[] = [
  { pose: { curl: [0.02, 0, 0.02, 0.05], thumb: 0.1, spread: 0.2 }, pitch: 0, slide: 0 },
  { pose: { curl: [0.25, 0.25, 0.25, 0.3], thumb: 0.3, spread: 0.25 }, pitch: 0.55, slide: 0 },
  { pose: { curl: [0.95, 1, 1, 0.95], thumb: 0.85, spread: 0 }, pitch: 0.1, slide: 0 },
  { pose: { curl: [0.12, 0.08, 0.15, 0.2], thumb: 0.25, spread: 0.08 }, pitch: 0.15, slide: 0 },
  { pose: { curl: [0.05, 0.05, 0.05, 0.1], thumb: 0.5, spread: 0.02 }, pitch: 0.05, slide: 1 },
];
/** Seconds for each phase of a press: approach, hold, slide, fade. */
const PHASES = [0.35, 0.9, 0.7, 0.6];

/**
 * Glass Hands (wave 6, #15): a grid of tall frosted-glass panes, each with a dark hand pressed against it from
 * behind: sharp where the palm and fingers touch the glass, soft where they pull away. Hands approach, press,
 * slide and fade in each tile at their own times. The hands are the code hand from `handModel.ts`, drawn as 2D
 * silhouettes (no raymarch) whose blur grows with each part's distance from the glass. Kicks press new hands into
 * one to three tiles, snares flip a tile to white-on-black for a beat, bass presses harder, hats tap fingers,
 * loudness sets how many tiles are busy.
 */
export function createGlassHandsMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const { scene, camera, material } = fullscreen();
  const [cols, rows] = budget.particleScale < 1 ? GLASS_GRID.low : GLASS_GRID.full, tiles = cols * rows;
  const random = seededRandom(1515);
  const aspect = uniform(16 / 9), time = uniform(0);
  // Each tile's hand: segment ends a (xyz, radius) and b in one float texture row, 2 × HAND_SEGMENTS texels wide,
  // plus a per-tile state texel (presence, contact softness, invert, tint).
  const width = HAND_SEGMENTS * 2 + 1, data = new Float32Array(width * tiles * 4);
  const segments = new THREE.DataTexture(data, width, tiles, THREE.RGBAFormat, THREE.FloatType);
  segments.minFilter = segments.magFilter = THREE.NearestFilter; segments.needsUpdate = true;
  const grid = vec2(cols, rows), cell = uv().mul(grid), id = cell.floor(), local = fract(cell);
  const tileIndex = id.x.add(id.y.mul(cols));
  const texel = (column: Node<"float">) => texture(segments, vec2(column.add(0.5).div(width), tileIndex.add(0.5).div(tiles)));
  const tileAspect = aspect.div(cols).mul(rows);
  const p = local.sub(vec2(0.5, 0)).mul(vec2(tileAspect, 1)).toVar();
  // The silhouette: a smooth union of the hand's capsules in 2D, tracking how far the nearest part is from the glass.
  const silhouette = Fn(([q]: [V2]) => {
    const d = float(1e3).toVar(), away = float(1).toVar();
    Loop(HAND_SEGMENTS, ({ i }) => {
      const a = texel(float(i)), b = texel(float(i).add(HAND_SEGMENTS));
      const pa = q.sub(a.xy), ba = b.xy.sub(a.xy);
      const h = pa.dot(ba).div(ba.dot(ba).max(1e-8)).clamp(0, 1);
      const di = pa.sub(ba.mul(h)).length().sub(mix(a.w, b.w, h));
      // a.z/b.z hold each end's distance from the glass.
      If(di.lessThan(d), () => { away.assign(mix(a.z, b.z, h)); });
      const k = float(0.02), s = k.sub(d.sub(di).abs()).max(0).div(k);
      d.assign(min(d, di).sub(s.mul(s).mul(k).mul(0.25)));
    });
    return vec2(d, away);
  });
  const state = texel(float(HAND_SEGMENTS * 2));
  const shape = silhouette(p).toVar();
  // Blur grows with distance from the glass; contact points stay crisp. Far parts are lighter, as through frost.
  const blur = shape.y.mul(0.12).add(0.004).add(state.y);
  // The soft edge sits a little outside the outline so blurred fingers stay solid rather than showing their bones.
  const cover = shape.x.sub(blur.mul(0.35)).smoothstep(blur, blur.mul(-0.4)).mul(shape.y.mul(0.9).oneMinus().clamp(0.55, 1)).mul(state.x);
  // Frosted glass: a soft bright gradient with a fine grain and faint mottling.
  const frost = mx_noise_float(vec3(uv().mul(vec2(aspect, 1)).mul(9), 0.3)).mul(0.04).add(mx_noise_float(vec3(uv().mul(vec2(aspect, 1)).mul(260), 1)).mul(0.03));
  const glass = mix(float(0.62), float(0.78), local.y).add(frost);
  const handTone = mix(float(0.04), vec3(0.25, 0.3, 0.27), state.w);
  const lit = mix(vec3(glass), handTone, cover);
  // Inverted tiles: a white hand on black.
  const inverted = mix(vec3(0.02), vec3(0.85), cover);
  let colour = mix(lit, inverted, state.z);
  // Gutters between the panes, and tiny red label marks in the corners like the film's frame captions.
  const gutter = local.x.lessThan(0.012).or(local.x.greaterThan(0.988)).or(local.y.lessThan(0.008)).or(local.y.greaterThan(0.992));
  const label = local.x.greaterThan(0.06).and(local.x.lessThan(0.22)).and(local.y.sub(0.965).abs().lessThan(0.004))
    .or(local.x.greaterThan(0.7).and(local.x.lessThan(0.9)).and(local.y.sub(0.03).abs().lessThan(0.004)));
  colour = gutter.select(vec3(0.01), label.select(mix(colour, vec3(0.6, 0.04, 0.04), hash2(id.add(time.mul(0.5).floor())).mul(0.5).add(0.5)), colour));
  material.fragmentNode = vec4(colour, 1);

  // Tile life: idle → approach → hold → slide → fade.
  const tileState = Array.from({ length: tiles }, () => ({ age: -1, pose: 0, x: 0, y: 0, roll: 0, scale: 0.36, invert: 0, tint: 0, mirror: 1 }));
  const a = Array.from({ length: HAND_SEGMENTS }, () => new THREE.Vector4()), b = Array.from({ length: HAND_SEGMENTS }, () => new THREE.Vector4());
  const hits = createHits({ decay: 0.25, interval: 0.2 }), poses = variantSequence(GLASS_POSES.length, 15);
  const press = (k: number) => {
    const t = tileState[k];
    t.age = 0; t.pose = poses.next(); t.x = (random() - 0.5) * 0.08; t.y = 0.02 + random() * 0.1; t.roll = (random() - 0.5) * 0.35;
    t.scale = 0.42 + random() * 0.08; t.tint = random() < 0.15 ? 1 : 0; t.mirror = random() < 0.5 ? -1 : 1;
  };
  const free = () => { const idle = tileState.map((t, k) => (t.age < 0 ? k : -1)).filter((k) => k >= 0); return idle.length ? idle[Math.floor(random() * idle.length)] : -1; };
  let pressure = 0, tap = 0, ambientClock = 0;
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), euler = new THREE.Euler(), position = new THREE.Vector3(), scaleVector = new THREE.Vector3();
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      const step = settleStep(frame), motion = frame.reducedMotion ? 0 : frame.delta, { bass, loudness } = frame.response;
      hits.update(frame, 0.1);
      const busy = tileState.filter((t) => t.age >= 0).length, wanted = Math.round(tiles * (0.2 + loudness * 0.6));
      if (hits.fired) {
        if (isSnare(frame)) { const k = Math.floor(random() * tiles); tileState[k].invert = frame.reducedFlash ? 0.7 : 1; }
        else for (let n = 0; n < 1 + Math.round(random() * 2 * Math.min(1, drive(frame) + 0.3)); n++) { const k = free(); if (k >= 0) press(k); }
      }
      // Between hits, keep about the wanted number of tiles busy (a calm trickle in silence).
      ambientClock -= step;
      if (ambientClock <= 0 && busy < wanted) { const k = free(); if (k >= 0) press(k); ambientClock = 0.6 - loudness * 0.4; }
      pressure = approach(pressure, bass, step, 0.1);
      tap += motion * (frame.audio.highs > 0.45 ? 14 : 0);
      tileState.forEach((t, k) => {
        const row = k * width * 4;
        t.invert = Math.max(0, t.invert - step * 2);
        if (t.age < 0) { data.set([0, 0, Math.min(1, t.invert), 0], row + HAND_SEGMENTS * 2 * 4); return; }
        t.age += step;
        const [approachTime, hold, slideTime, fadeTime] = PHASES, spec = GLASS_POSES[t.pose];
        const total = approachTime + hold + (spec.slide ? slideTime : 0) + fadeTime;
        if (t.age > total) { t.age = -1; data.set([0, 0, Math.min(1, t.invert), 0], row + HAND_SEGMENTS * 2 * 4); return; }
        // Distance from the glass: closing in, pressed (harder with bass), then pulling away.
        const into = Math.min(1, t.age / approachTime), out = Math.max(0, (t.age - (total - fadeTime)) / fadeTime);
        const gap = 0.5 * (1 - into) * (1 - into) + out * 0.5 + (1 - pressure) * 0.02;
        const slide = spec.slide ? Math.min(1, Math.max(0, (t.age - approachTime - hold) / slideTime)) * 0.35 : 0;
        const curl = spec.pose.curl.map((c, f) => Math.min(1, c + Math.max(0, Math.sin(tap + f * 1.3 + k)) * 0.15 * (frame.audio.highs > 0.45 ? 1 : 0))) as [number, number, number, number];
        euler.set(-spec.pitch, 0, t.roll, 'ZYX'); quaternion.setFromEuler(euler);
        position.set(t.x, t.y - slide, 0); scaleVector.set(t.scale * t.mirror, t.scale, t.scale);
        matrix.compose(position, quaternion, scaleVector);
        poseHand({ ...spec.pose, curl }, matrix, a, b);
        // Each end's distance from the glass: how far behind the hand's front it sits, plus the hand's gap.
        let front = -Infinity; for (let s = 0; s < HAND_SEGMENTS; s++) front = Math.max(front, a[s].z + a[s].w, b[s].z + b[s].w);
        for (let s = 0; s < HAND_SEGMENTS; s++) {
          data.set([a[s].x, a[s].y, front - a[s].z - a[s].w + gap, a[s].w], row + s * 4);
          data.set([b[s].x, b[s].y, front - b[s].z - b[s].w + gap, b[s].w], row + (s + HAND_SEGMENTS) * 4);
        }
        data.set([1 - out * out, gap * 0.02, Math.min(1, t.invert), t.tint], row + HAND_SEGMENTS * 2 * 4);
      });
      segments.needsUpdate = true;
    },
    dispose() { disposeScene(scene); segments.dispose(); },
  };
}
