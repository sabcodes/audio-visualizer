import * as THREE from 'three/webgpu';
import { exp, float, fract, max, mix, mx_noise_float, normalize, pow, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import type { QualityBudget } from '../rendering/quality';
import { disposeScene, approach, settleStep } from './shared';
import { hash2 } from './shaderModes';
import { createPingPong } from './pingPong';
import { createCinematic } from './cinematic';
import { createHits, linearRgb } from './hitPulse';
import { seededRandom } from '../rendering/diagnostics';

/** The patch of pond the simulation covers, in water-plane metres: x across, z away from the camera. */
export const POND = { left: -3.2, right: 3.2, near: 0.85, far: 7 } as const;
const MAGENTA = linearRgb(0xe02bd6), BLUE = linearRgb(0x4d6bff);

/** Screen position (centred, aspect-corrected) to water-plane coordinates, for a camera looking down at the pond. */
export function pondPlane(sx: number, sy: number) {
  const depth = 1 / (sy + 0.95);
  return [sx * depth, depth * 1.6] as const;
}

/**
 * Moon Pond: a dark glossy pond close up. A wave-equation height field carries real interfering ripples
 * from a touch point; the whole surface reflects a soft grey sky, and a coloured light catches the crests
 * as dense perspective-scaled glitter that alternates magenta and blue-cyan.
 */
export function createMoonPondMode(budget: QualityBudget): VisualMode {
  const size = budget.particleScale >= 2 ? 640 : budget.particleScale >= 1 ? 512 : 384;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2); camera.position.z = 1;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicNodeMaterial());
  scene.add(quad);
  const sim = createPingPong(size, size);
  const drop = uniform(new THREE.Vector4(0.5, 0.2, 0, 0.012)), damping = uniform(0.996), first = uniform(1);
  const texel = vec2(1 / size, 1 / size);
  // State: r = height now, g = height one step ago.
  const step = sim.pass((read) => {
    const p = uv(), here = read(p);
    const at = (x: number, y: number) => read(p.add(texel.mul(vec2(x, y)))).r;
    // Nine-point Laplacian: isotropic, so strong drops spread as circles rather than crosses.
    const laplacian = at(1, 0).add(at(-1, 0)).add(at(0, 1)).add(at(0, -1)).mul(0.2).add(at(1, 1).add(at(-1, 1)).add(at(1, -1)).add(at(-1, -1)).mul(0.05)).sub(here.r).mul(4);
    const next = here.r.mul(2).sub(here.g).add(laplacian.mul(0.45)).mul(damping);
    // A drop presses a smooth dimple into the surface (x, y in sim UV, z strength, w radius).
    const dimple = exp(p.sub(drop.xy).length().div(drop.w).pow(2).negate()).mul(drop.z);
    // Fade the waves out at the edges of the patch so nothing reflects back in.
    const edge = p.sub(0.5).abs().max(0).mul(2).length().smoothstep(0.98, 0.8);
    return vec4(next.sub(dimple).clamp(-0.5, 0.5).mul(edge).mul(first.oneMinus()), here.r.mul(first.oneMinus()), 0, 1);
  });
  const aspect = uniform(1), time = uniform(0), colour = uniform(new THREE.Vector3(...MAGENTA)), light = uniform(1), glitter = uniform(0.5);
  const patchAt = uniform(new THREE.Vector2(0, 2)), patchSize = uniform(1.6), sky = uniform(1);
  const view = sim.view((read) => {
    const s = uv().sub(0.5).mul(vec2(aspect, 1));
    const depth = float(1).div(s.y.add(0.95)), plane = vec2(s.x.mul(depth), depth.mul(1.6));
    const simUv = vec2(plane.x.sub(POND.left).div(POND.right - POND.left), plane.y.sub(POND.near).div(POND.far - POND.near));
    const inside = simUv.x.greaterThan(0).and(simUv.x.lessThan(1)).and(simUv.y.greaterThan(0)).and(simUv.y.lessThan(1));
    const height = (q: THREE.Node<'vec2'>) => inside.select(read(q).r, float(0));
    // Ambient breeze ripples so the water is never glassy, plus the simulated waves.
    const breeze = (q: THREE.Node<'vec2'>) => mx_noise_float(vec3(q.mul(vec2(2.2, 3.5)), time.mul(0.25))).mul(0.004);
    const e = 1.5 / size;
    const hx = height(simUv.add(vec2(e, 0))).sub(height(simUv.sub(vec2(e, 0)))).add(breeze(plane.add(vec2(0.03, 0))).sub(breeze(plane.sub(vec2(0.03, 0)))));
    const hz = height(simUv.add(vec2(0, e))).sub(height(simUv.sub(vec2(0, e)))).add(breeze(plane.add(vec2(0, 0.03))).sub(breeze(plane.sub(vec2(0, 0.03)))));
    const normal = normalize(vec3(hx.mul(-26), 1, hz.mul(-26)));
    // Reflection of a soft overcast sky: grazing (far) water reflects more, and slopes facing the camera catch it.
    const toward = normal.z.mul(-1).add(0.2), fresnel = float(1).sub(depth.div(7).oneMinus().mul(0.9).clamp(0, 1)).pow(1.5);
    const skyTone = toward.mul(2).add(0.5).clamp(0, 1).mul(0.6).add(0.15);
    const water = mix(vec3(0.008, 0.007, 0.011), vec3(0.17, 0.16, 0.19), fresnel.mul(skyTone).add(skyTone.mul(0.25))).mul(sky);
    // The light patch, with a faint colour wash over it.
    const patch = exp(plane.sub(patchAt).mul(vec2(1, 0.7)).length().div(patchSize).pow(2).negate());
    // Crests facing the light glitter: dots on a grid laid out on the water, so they shrink with distance.
    const slope = hx.add(hz.mul(0.6)).negate().mul(60);
    const crest = slope.smoothstep(0.0, 0.25).add(pow(max(float(0), normal.y.oneMinus().mul(60)), 1.2).mul(0.25)).min(1);
    // Glitter: tiny dots scattered on the water (jittered within a fine grid), so they shrink with distance.
    const grid = plane.mul(vec2(95, 80)), cell = grid.floor(), h = hash2(cell), h2 = hash2(cell.add(19.3));
    const local = fract(grid).sub(vec2(h, h2).mul(0.5).add(0.25));
    const dot = local.length().smoothstep(h2.mul(0.18).add(0.12), 0.03).mul(h.greaterThan(0.15).select(float(1), float(0)));
    const twinkle = fract(h2.add(time.mul(0.6).add(height(simUv).mul(30)))).smoothstep(0.1, 0.9).mul(0.6).add(0.4);
    const tint = mix(colour, mix(vec3(1, 0.85, 1), vec3(0.6, 0.85, 1), h2), h.mul(0.35));
    const sparkle = dot.mul(twinkle).mul(crest).mul(patch).mul(glitter.mul(3).add(5)).mul(light);
    const wash = colour.mul(patch.mul(0.02).add(crest.mul(patch).mul(0.12))).mul(light);
    return vec4(water.add(wash).add(tint.mul(sparkle)), 1);
  });
  quad.material = view();
  const finish = createCinematic({ grain: 0.06, halation: 0.25, vignette: 0.45, soften: 0.25, aberration: 0.002, shadows: [0.006, 0.004, 0.009] });

  const hits = createHits({ decay: 0.6, interval: 0.5 });
  const random = seededRandom(7), target = new THREE.Vector3(...MAGENTA);
  const touch = new THREE.Vector2(0.15, 1.6);
  let colourIndex = 0, dip = 0, warmed = false, pending = 0, strength = 0;
  const toUv = (x: number, z: number) => [(x - POND.left) / (POND.right - POND.left), (z - POND.near) / (POND.far - POND.near)] as const;
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time; finish.update(frame);
      const step = settleStep(frame);
      hits.update(frame, 0.6);
      // A hit swaps the light's colour and sends a stronger ring out from the touch point.
      if (hits.fired) {
        // The hand only moves every few hits; in between, each hit presses harder at the same spot.
        if (!frame.reducedMotion && hits.count % 4 === 0) touch.set((random() - 0.5) * 1.6, 1.3 + random() * 0.9);
        colourIndex = 1 - colourIndex; target.set(...(colourIndex ? BLUE : MAGENTA));
        pending = 1; strength = 0.06 + frame.response.bass * 0.05;
      }
      // Between hits the finger keeps dipping, sending out a steady train of rings.
      dip -= step;
      if (dip < 0 && !frame.reducedMotion) { dip = 0.17; pending = Math.max(pending, 0.4); strength = Math.max(strength, 0.03 + frame.response.bass * 0.03); }
      colour.value.lerp(target, 1 - Math.exp(-step / 0.25));
      patchAt.value.lerp(touch, 1 - Math.exp(-step / 0.8));
      patchSize.value = approach(patchSize.value, 1.7 + frame.response.loudness * 0.9, step, 0.4);
      light.value = approach(light.value, 0.35 + frame.response.loudness * 0.9 + hits.flash * 0.6, step, 0.12);
      glitter.value = frame.audio.highs;
      sky.value = 1 + hits.flash * 0.15;
      damping.value = frame.reducedMotion ? 0.985 : 0.996;
    },
    simulate(renderer) {
      if (!warmed) { step(renderer); first.value = 0; warmed = true; }
      // Two solver steps a frame; the drop is pressed in on the first of them only.
      const [x, y] = toUv(touch.x, touch.y);
      drop.value.set(x, y, pending ? strength * pending : 0, 0.008);
      step(renderer);
      drop.value.z = 0; pending = 0; strength = 0;
      step(renderer);
      quad.material = view();
    },
    filter: (input) => finish.filter(input),
    dispose() { disposeScene(scene); sim.dispose(); },
  };
}
