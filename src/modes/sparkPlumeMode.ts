import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { Fn, If, atan, exp, float, fract, hash, instanceIndex, instancedArray, mix, mx_fractal_noise_float, mx_noise_float, positionWorld, sin, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import type { QualityBudget } from '../rendering/quality';
import { disposeScene, approach, settleStep } from './shared';
import { hash2 } from './shaderModes';
import { createHits, linearRgb } from './hitPulse';
import { BODY_SEGMENTS, createBody, hoverPose } from './bodyModel';

type F = Node<'float'>;
type V2 = Node<'vec2'>;

const tier = (budget: QualityBudget, high: number, balanced: number, low: number) => budget.particleScale >= 2 ? high : budget.particleScale >= 1 ? balanced : low;
const rgb = (hex: number) => vec3(...linearRgb(hex));

/** The plume's two hues (they alternate) and its hot core, from the spec. */
export const PLUME_COLOURS = { purple: 0xb04dff, blue: 0x3a7bff, core: 0xb8f4ff } as const;

/**
 * Spark Plume (wave 5, clip 4): a woman floating in a dark foggy night with a huge plume of tiny glowing
 * dashes pouring from the top of her head. Loud passages make the plume a wide, fast, noisy cloud; the bass
 * winds it into a double-spiral column and lights her body up in the same dashes. Kicks send a bright pulse
 * up the plume. WebGPU only: the particles live in storage buffers and move in a compute pass.
 */
export function createSparkPlumeMode(budget: QualityBudget): VisualMode {
  const count = tier(budget, 150000, 100000, 50000);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-0.9, 0.9, 0.5, -0.5, 0.1, 10);
  camera.position.z = 2;
  const time = uniform(0), dt = uniform(0), head = uniform(new THREE.Vector2(0, 0.1)), drift = uniform(new THREE.Vector2(0.18, 0.32));
  const turbulence = uniform(0.6), spiral = uniform(0), width = uniform(0.5), bodyAmount = uniform(0), toggle = uniform(0), pulse = uniform(-1), birth = uniform(1), jitter = uniform(0);
  const body = createBody({ hair: true, build: 0.88 });
  const segA = body.segments.nodes.a, segB = body.segments.nodes.b;

  // Particle state: xy position, age, life; velocity xy, kind (0 plume, 1 body), strand.
  const state = instancedArray(count, 'vec4'), motion = instancedArray(count, 'vec4');
  const random = (salt: F | number) => hash(float(instanceIndex).mul(1.618).add(time.mul(97.3)).add(salt));
  const spawn = (p: Node<'vec4'>, v: Node<'vec4'>) => {
    const fromBody = random(1).lessThan(bodyAmount.mul(0.45));
    // A point on a random body capsule's outline; plume particles start at the crown.
    const k = random(2).mul(BODY_SEGMENTS).floor().toInt();
    const sa = segA.element(k) as unknown as Node<'vec4'>, sb = segB.element(k) as unknown as Node<'vec4'>;
    const along = random(3), angle = random(4).mul(Math.PI * 2);
    const onBody = mix(sa.xy, sb.xy, along).add(vec2(angle.cos(), angle.sin()).mul(mix(sa.w, sb.w, along).mul(random(5).sqrt())));
    const usable = fromBody.and(sa.w.greaterThan(0.001));
    const at = usable.select(onBody, head.add(vec2(random(6).sub(0.5), random(7).sub(0.3)).mul(0.04)));
    p.assign(vec4(at, 0, usable.select(random(8).mul(0.5).add(0.35), random(8).mul(2.2).add(1.4))));
    v.assign(vec4(usable.select(vec2(random(9).sub(0.5), random(10).sub(0.3)).mul(0.03), drift.mul(random(11).mul(1.2).add(0.4)).add(vec2(random(15).sub(0.5), random(16).sub(0.5)).mul(0.45))), usable.select(float(1), float(0)), random(12).greaterThan(0.5).select(float(1), float(0))));
  };
  const init = Fn(() => {
    const p = state.element(instanceIndex), v = motion.element(instanceIndex);
    spawn(p, v);
    p.z.assign(random(13).mul(p.w).negate());
  })().compute(count);
  const update = Fn(() => {
    const p = state.element(instanceIndex), v = motion.element(instanceIndex);
    p.z.addAssign(dt);
    If(p.z.greaterThan(p.w).and(random(14).lessThan(birth)), () => { spawn(p, v); });
    If(p.z.greaterThanEqual(0).and(p.z.lessThanEqual(p.w)), () => {
      const at = p.xy, plume = v.z.lessThan(0.5);
      // Curl of a drifting noise field: divergence-free swirls, so the cloud churns without bunching.
      const e = 0.01, n = (q: V2) => mx_noise_float(vec3(q.mul(2.4), time.mul(0.35)));
      const curl = vec2(n(at.add(vec2(0, e))).sub(n(at.sub(vec2(0, e)))), n(at.sub(vec2(e, 0))).sub(n(at.add(vec2(e, 0))))).div(2 * e).mul(0.24);
      // The column: two strands winding around an axis above the head, wider with height.
      const rise = at.y.sub(head.y).max(0);
      const strand = v.w.mul(Math.PI);
      const axis = head.x.add(rise.mul(drift.x).mul(width.mul(0.8).add(0.2)));
      const target = axis.add(sin(rise.mul(11).sub(time.mul(3.2)).add(strand)).mul(rise.mul(0.32).add(0.02)));
      const steer = vec2(target.sub(at.x).mul(spiral.mul(5)), 0);
      const wanted = plume.select(drift.mul(mix(float(1), float(0.6), spiral)).add(vec2(drift.x.mul(spiral).negate().mul(0.8), 0)).add(curl.mul(turbulence)).add(steer), curl.mul(0.25));
      v.xy.assign(mix(v.xy, wanted, dt.mul(3).min(1)));
      p.xy.addAssign(v.xy.mul(dt));
    });
  })().compute(count);

  // Background: a near-black foggy gradient, a faint horizon, ground haze, and the dark (or dot-lit) body.
  const back = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshBasicNodeMaterial({ depthWrite: false }));
  back.position.z = -1; back.renderOrder = -1;
  const bp = positionWorld.xy;
  const hills = mx_fractal_noise_float(vec2(bp.x.mul(1.5), 2), 3).mul(0.04).sub(0.33);
  const fog = rgb(0x1a1530).mul(exp(bp.y.sub(-0.3).abs().div(0.3).negate()).mul(0.8).add(0.25)).add(rgb(0x1a1440).mul(mx_fractal_noise_float(vec3(bp.mul(2), time.mul(0.05)), 3).mul(0.5).add(0.5).mul(0.06)));
  const ground = bp.y.lessThan(hills);
  const d = body.distance(bp, 0.012);
  const grid = bp.div(0.0055), cell = grid.floor(), dotShape = fract(grid).sub(0.5).length().smoothstep(0.3, 0.12);
  const flicker = hash2(cell.add(time.mul(12).floor())).mul(0.6).add(0.4);
  const bodyHue = mix(rgb(PLUME_COLOURS.purple), rgb(PLUME_COLOURS.blue), toggle);
  const silhouette = d.smoothstep(0.002, -0.002);
  const dots = dotShape.mul(flicker).mul(silhouette).mul(bodyAmount).mul(d.negate().div(0.01).clamp(0, 1).mul(0.5).add(0.5));
  (back.material as THREE.MeshBasicNodeMaterial).colorNode = ground.select(rgb(0x050410).add(fog.mul(0.4)), fog).mul(silhouette.mul(0.85).oneMinus()).add(bodyHue.mul(dots.mul(1.8)))
    // The plume's light catches the body's outline even when it is dark.
    .add(bodyHue.mul(exp(d.abs().div(0.0025).negate()).mul(0.12).mul(exp(bp.sub(head).length().div(0.25).negate()).add(0.3))));
  scene.add(back);

  // The dashes: screen-facing sprites stretched along their velocity.
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const p = state.element(instanceIndex), v = motion.element(instanceIndex);
  const speed = v.xy.length();
  material.positionNode = vec3(p.xy, 0);
  material.rotationNode = atan(v.y, v.x);
  material.scaleNode = vec2(speed.mul(0.03).add(0.004).add(jitter.mul(0.002)), 0.0015);
  const life = p.z.div(p.w), alive = p.z.greaterThanEqual(0).and(life.lessThan(1));
  const fade = life.smoothstep(0, 0.08).mul(life.smoothstep(1, 0.6)).mul(alive.select(float(1), float(0)));
  const hot = exp(p.xy.sub(head).length().div(0.06).negate());
  const front = exp(p.y.sub(pulse).abs().div(0.03).negate());
  const hue = mix(rgb(PLUME_COLOURS.purple), rgb(PLUME_COLOURS.blue), toggle.add(hash(float(instanceIndex)).sub(0.5).mul(0.3)).clamp(0, 1));
  const kindGain = v.z.greaterThan(0.5).select(bodyAmount.mul(1.4), float(1));
  const edge = uv().x.sub(0.5).abs().mul(2).oneMinus();
  // Thousands overlap, so each dash is faint; density builds the brightness, hottest near the head.
  material.colorNode = mix(hue, rgb(PLUME_COLOURS.core), hot.mul(0.7)).mul(float(0.07).add(front.mul(0.3)).add(hot.mul(0.1))).mul(fade).mul(kindGain).mul(edge);
  material.opacityNode = fade;
  const sprites = new THREE.Sprite(material);
  sprites.geometry = sprites.geometry.clone(); sprites.count = count; sprites.frustumCulled = false;
  scene.add(sprites);

  const hits = createHits({ decay: 0.2, interval: 0.2 });
  let initialised = false, flipClock = 0, colourTarget = 0, cycle = 0, sway = 0;
  return {
    scene, camera,
    simulate(renderer) {
      if (!initialised) { renderer.compute(init); initialised = true; }
      renderer.compute(update);
    },
    update(frame) {
      camera.left = -frame.aspect / 2; camera.right = frame.aspect / 2; camera.updateProjectionMatrix();
      const step = settleStep(frame), moving = frame.reducedMotion ? 0 : frame.delta, { bass, loudness, bounce } = frame.response;
      time.value = frame.time; dt.value = Math.min(moving, 1 / 20);
      hits.update(frame, 0.1);
      // The clip's three states blend continuously: a broad noisy cloud, a twisting column with a lit body, a sideways sweep.
      cycle += moving * (0.1 + loudness * 0.08);
      const column = Math.min(1, Math.max(0, (bass - 0.45) * 2 + Math.sin(cycle * Math.PI * 2) * 0.35));
      spiral.value = approach(spiral.value, column, step, 0.4);
      bodyAmount.value = approach(bodyAmount.value, Math.min(1, column * 1.4), step, 0.3);
      width.value = approach(width.value, 0.4 + loudness * 0.8, step, 0.2);
      turbulence.value = approach(turbulence.value, (1 + loudness * 1.4) * (1 - spiral.value * 0.6), step, 0.2);
      // The sweep: the plume lies over to the left at the top of each cycle.
      const sweep = Math.max(0, Math.sin(cycle * Math.PI * 2 + 2.2)) * (1 - spiral.value);
      drift.value.set(0.16 - sweep * 0.45 + bounce * 0.05, 0.3 + bass * 0.25 - sweep * 0.12);
      birth.value = 0.35 + loudness * 0.65;
      jitter.value = approach(jitter.value, frame.audio.highs, step, 0.05);
      // Kicks send a bright pulse up the plume.
      if (hits.fired) pulse.value = head.value.y;
      if (pulse.value > -1) pulse.value += step * (0.6 + bass * 0.6);
      if (pulse.value > 0.8) pulse.value = -1;
      // Purple ↔ blue: flips on hits and every so often with the hats, rate-limited and crossfaded under reduced flash.
      flipClock += step;
      const minGap = frame.reducedFlash ? 1 / 3 : 0.12;
      if ((hits.fired || flipClock > 0.6 - frame.audio.highs * 0.4) && flipClock > minGap) { colourTarget = 1 - colourTarget; flipClock = 0; }
      toggle.value = frame.reducedFlash ? approach(toggle.value, colourTarget, step, 0.15) : colourTarget;
      sway += moving * (0.8 + bounce);
      body.pose(hoverPose(sway), -0.25, -0.36 + Math.sin(sway * 0.7) * 0.01, 0.5, Math.PI / 2 + 0.25, frame.time);
      head.value.copy(body.head).add(new THREE.Vector2(0.004, 0.035));
    },
    dispose: () => disposeScene(scene),
  };
}
