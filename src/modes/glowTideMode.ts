import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { exp, float, fract, mix, mx_noise_float, mx_worley_noise_float, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import type { QualityBudget } from '../rendering/quality';
import { disposeScene, approach, settleStep } from './shared';
import { hash2 } from './shaderModes';
import { createPingPong } from './pingPong';
import { createHits } from './hitPulse';
import { drive } from './waveSixShared';
import { seededRandom } from '../rendering/diagnostics';

type F = Node<'float'>;
type V2 = Node<'vec2'>;

/** The stretch of beach the foam simulation covers, in metres: x across, z away from the camera. */
export const BEACH = { left: -8, right: 8, near: 0.8, far: 18 } as const;
/** Where the sea meets the sand at x (the shore runs on a slight diagonal, as in the clip). */
export const shoreZ = (x: number) => 2.2 + x * 0.12;
/** Seconds for a camera rise and return: low over the surf, up to show the sky, back down. */
export const RISE_CYCLE = 40;

/**
 * Glow Tide (wave 6, #5): a night beach where the surf glows: waves break as saturated cyan foam, near white at
 * the crest, over black water, and the foam spreads in lacy patches and spiral swirls that drain back across the
 * wet sand. A dark headland sits on the right; every so often the camera rises to show stars and the Milky Way.
 * The foam is a 2D simulation on the beach: each frame it drifts on a curl-noise flow (the swirls), fades, and a
 * breaking wave lays a fresh line of it. Kicks break a wave (brighter for harder hits), bass sets wave height,
 * mids stir the swirls, hats sparkle in the foam, loudness lifts the glow.
 */
export function createGlowTideMode(budget: QualityBudget): VisualMode {
  const size = budget.particleScale >= 2 ? 768 : budget.particleScale >= 1 ? 512 : 384;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2); camera.position.z = 1;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicNodeMaterial());
  scene.add(quad);
  const sim = createPingPong(size, size);
  const time = uniform(0), swirl = uniform(0.6), front = uniform(-1), frontPower = uniform(0), surge = uniform(0), first = uniform(1);
  const toPlane = (q: V2) => vec2(mix(float(BEACH.left), float(BEACH.right), q.x), mix(float(BEACH.near), float(BEACH.far), q.y));
  const texel = vec2(1 / size, 1 / size);
  const shore = (x: F) => x.mul(0.12).add(2.2);
  // State: r = foam on the water and sand, g = how wet the sand is.
  const step = sim.pass((read) => {
    const p = uv(), plane = toPlane(p);
    // Curl of a slow noise field gives swirling, divergence-free flow: the spirals in the foam.
    const n = (q: V2) => mx_noise_float(vec3(q.mul(0.55), time.mul(0.05)));
    const e = 0.05, dx = n(plane.add(vec2(e, 0))).sub(n(plane.sub(vec2(e, 0)))), dz = n(plane.add(vec2(0, e))).sub(n(plane.sub(vec2(0, e))));
    const curl = vec2(dz, dx.negate()).div(e * 2).mul(swirl);
    // The surge runs foam up the beach (toward the camera) after a break, then the backwash drains it out.
    const flow = curl.add(vec2(0, surge.negate().mul(0.7)));
    // Semi-Lagrangian advection: look back along the flow (metres per frame → sim UV).
    const back = p.sub(flow.mul(1 / 60).div(vec2(BEACH.right - BEACH.left, BEACH.far - BEACH.near)));
    const here = read(back);
    const onSand = plane.y.lessThan(shore(plane.x));
    // Foam fades quickly on open water and lingers as lace on the sand.
    const keep = onSand.select(float(0.995), float(0.991));
    // A breaking wave lays a lacy line of fresh foam along its front.
    const lace = mx_worley_noise_float(vec3(plane.mul(vec2(1.4, 2.2)), time.mul(0.6))).oneMinus().smoothstep(0.35, 0.85);
    const band = exp(plane.y.sub(front.add(plane.x.mul(0.12))).abs().div(0.18).negate()).mul(frontPower).mul(lace.mul(0.8).add(0.35));
    const foam = here.r.mul(keep).add(band.mul(0.22)).min(1.6);
    const wet = here.g.mul(0.997).max(foam.mul(onSand.select(float(1), float(0))).min(1));
    return vec4(foam.mul(first.oneMinus()), wet.mul(first.oneMinus()), 0, 1);
  });

  const aspect = uniform(16 / 9), horizon = uniform(0.62), eye = uniform(1), glow = uniform(1), sparkle = uniform(0), waveHeight = uniform(0.4);
  const view = sim.view((read) => {
    const s = uv().sub(0.5).mul(vec2(aspect, 1));
    // The beach recedes toward a horizon that drops into view as the camera rises.
    const below = horizon.sub(s.y).max(0.002), depth = eye.div(below), plane = vec2(s.x.mul(depth), depth);
    const simUv = vec2(plane.x.sub(BEACH.left).div(BEACH.right - BEACH.left), plane.y.sub(BEACH.near).div(BEACH.far - BEACH.near));
    const inside = simUv.x.greaterThan(0).and(simUv.x.lessThan(1)).and(simUv.y.greaterThan(0)).and(simUv.y.lessThan(1));
    const state = inside.select(read(simUv.clamp(0, 1)), vec4(0));
    const foam = state.r, wet = state.g;
    // Sponge texture: the foam only glows where a fine cellular pattern lets it, so it reads as lace.
    const sponge = mx_worley_noise_float(vec3(plane.mul(vec2(7, 10)), time.mul(0.4))).smoothstep(0.05, 0.75);
    const dense = foam.mul(sponge.mul(0.9).add(0.25)).smoothstep(0.08, 1.4);
    const cyan = vec3(0.01, 0.32, 0.9), crest = vec3(0.55, 0.85, 1.0);
    const foamColour = mix(cyan, crest, dense.smoothstep(0.8, 1)).mul(dense.mul(0.75)).mul(glow);
    // Sparkle points in the foam on hats.
    const cell = plane.mul(vec2(26, 30)), id = cell.floor(), dot = fract(cell).sub(0.5).length().smoothstep(0.18, 0.02);
    const glints = dot.mul(hash2(id.add(time.mul(8).floor())).lessThan(sparkle.mul(0.18)).select(float(1), float(0))).mul(foam.min(1)).mul(1.5);
    // Water: near-black blue with long swells catching a little of the glow; sand: dark and wet, mirroring the foam.
    const swell = mx_noise_float(vec3(plane.x.mul(0.25), plane.y.mul(1.2).sub(time.mul(0.6)), 0)).mul(0.5).add(0.5);
    const sea = vec3(0.002, 0.008, 0.022).add(vec3(0.0, 0.02, 0.06).mul(swell.mul(waveHeight)));
    const sand = vec3(0.006, 0.006, 0.008).add(cyan.mul(wet.mul(0.05)));
    const ground = mix(sand, sea, plane.y.sub(shore(plane.x)).smoothstep(-0.4, 0.6));
    let colour = ground.add(foamColour).add(vec3(0.6, 0.9, 1.2).mul(glints));
    // Sky above the horizon: deep blue, stars, and a Milky Way band with dust lanes.
    const skyUv = s.sub(vec2(0, horizon));
    const star = hash2(s.mul(380).floor()).greaterThan(0.996).select(hash2(s.mul(380).floor().add(3)).mul(0.6).add(0.2), float(0));
    const along = skyUv.x.mul(0.55).add(skyUv.y.mul(-0.85)).sub(0.1);
    const band = exp(along.div(0.16).pow(2).negate());
    const dust = mx_noise_float(vec3(s.mul(7), 2)).mul(0.5).add(0.5).smoothstep(0.35, 0.7);
    const milky = vec3(0.1, 0.12, 0.2).mul(band.mul(dust)).add(vec3(0.04, 0.05, 0.1).mul(band));
    const skyColour = vec3(0.002, 0.005, 0.016).add(milky).add(vec3(0.8, 0.85, 1).mul(star.mul(band.mul(2).add(1))));
    colour = s.y.greaterThan(horizon).select(skyColour, colour);
    // The headland: a dark rocky silhouette on the right, rising from the horizon.
    const ridge = horizon.add(mx_noise_float(vec3(s.x.mul(6), 4, 0)).mul(0.025)).add(s.x.sub(aspect.mul(0.12)).max(0).mul(0.35));
    const rock = s.x.greaterThan(aspect.mul(0.12)).and(s.y.lessThan(ridge)).and(s.y.greaterThan(horizon.sub(0.05)));
    colour = rock.select(vec3(0.004, 0.005, 0.008).add(foamColour.mul(0.15)), colour);
    return vec4(colour, 1);
  });
  quad.material = view();

  const hits = createHits({ decay: 0.4, interval: 0.6 });
  const random = seededRandom(505);
  let warmed = false, frontZ = -1, power = 0, surgeLevel = 0, idle = 0, cycle = 0;
  const breakWave = (strength: number) => { frontZ = 6.5 + random() * 1.5; power = strength; idle = 0; };
  breakWave(0.4);
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      const stepTime = settleStep(frame), motion = frame.reducedMotion ? 0 : frame.delta, { bass, loudness, impact } = frame.response;
      hits.update(frame, 0.1);
      idle += stepTime;
      if (hits.fired && (frontZ < 0 || frontZ < 3)) breakWave(Math.min(1.2, 0.5 + impact * 0.4 + bass * 0.3));
      else if (idle > 4 && frontZ < 0) breakWave(0.35);
      // The wave front sweeps in toward the shore, up the sand, and dies.
      if (frontZ >= 0) {
        frontZ -= stepTime * (1.6 + bass * 0.8);
        surgeLevel = approach(surgeLevel, frontZ < 2.6 ? 1 : 0.2, stepTime, 0.3);
        if (frontZ < 1.1) { frontZ = -1; power = 0; }
      } else surgeLevel = approach(surgeLevel, -0.6, stepTime, 1.2);
      front.value = frontZ; frontPower.value = power * (frame.reducedFlash ? 0.6 : 1);
      surge.value = surgeLevel;
      swirl.value = approach(swirl.value, 0.9 + frame.audio.mid * 1.8 + drive(frame) * 0.3, stepTime, 0.5);
      waveHeight.value = approach(waveHeight.value, 0.3 + bass, stepTime, 0.2);
      glow.value = approach(glow.value, 0.6 + loudness * 0.6 + hits.flash * 0.25, stepTime, 0.15);
      sparkle.value = approach(sparkle.value, frame.audio.highs, stepTime, 0.08);
      // The camera rises and pulls back over ~20 s to show the sky, then comes back down to the surf.
      cycle += motion / RISE_CYCLE;
      const rise = 0.5 - 0.5 * Math.cos(cycle * Math.PI * 2);
      horizon.value = 0.62 - rise * 0.5; eye.value = 1 + rise * 1.6;
    },
    simulate(renderer) {
      if (!warmed) { step(renderer); first.value = 0; warmed = true; }
      step(renderer);
      quad.material = view();
    },
    dispose() { disposeScene(scene); sim.dispose(); },
  };
}
