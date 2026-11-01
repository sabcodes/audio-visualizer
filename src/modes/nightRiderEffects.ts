import * as THREE from 'three/webgpu';
import { mix, mx_noise_float, uniform, uv, vec3 } from 'three/tsl';
import { createParticles } from './figures';
import type { ModeFrame } from './types';
import type { QualityBudget } from '../rendering/quality';
import { seededRandom } from '../rendering/diagnostics';

/** Beat/bounce edges, rather than sustained levels, produce occasional backfires and acceleration kicks. */
export function createNightRiderThrottle() {
  let clock = 0, last = -1, previousOnset = false, previousBounce = 0, previousImpact = 0, hits = 0;
  const state = { boost: 0, exhaust: 0, fired: false, bursts: 0,
    update(frame: ModeFrame) {
      const dt = frame.reducedMotion ? 0 : THREE.MathUtils.clamp(frame.delta, 0, 0.1);
      const bounce = Math.min(2, frame.response.bounce * (frame.sensitivity ?? 1.8) / 1.8);
      const edge = (frame.audio.onset && !previousOnset) || bounce - previousBounce > 0.24 || frame.response.impact - previousImpact > 0.3;
      previousOnset = frame.audio.onset; previousBounce = bounce; previousImpact = frame.response.impact;
      clock += dt; state.fired = false;
      state.boost *= Math.exp(-dt / 0.6); state.exhaust *= Math.exp(-dt / 0.18);
      if (dt > 0 && edge && frame.response.loudness > 0.08 && clock - last >= 0.38) {
        last = clock; hits++; state.boost = Math.min(1, 0.35 + bounce * 0.5 + frame.response.impact * 0.3);
        if (hits % 3 !== 0) { state.exhaust = state.boost; state.fired = true; state.bursts++; }
      }
      return state;
    },
  };
  return state;
}

export function createNightRiderEffects(scene: THREE.Scene, budget: QualityBudget) {
  const random = seededRandom(60709), scale = Math.min(1.5, budget.particleScale);
  const clock = uniform(0), heat = uniform(0);
  // Small generated radial mask, owned here; no new image assets or texture downloads.
  const pixels = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const i = (y * 32 + x) * 4, r = Math.hypot((x + 0.5) / 16 - 1, (y + 0.5) / 16 - 1);
    pixels.set([255, 255, 255, Math.round(Math.max(0, 1 - r) ** 2 * 255)], i);
  }
  const map = new THREE.DataTexture(pixels, 32, 32, THREE.RGBAFormat); map.needsUpdate = true;
  map.magFilter = map.minFilter = THREE.LinearFilter;
  const smoke = createParticles(map, Math.round(260 * scale), { gravity: -0.25, drag: 0.8, additive: false });
  smoke.object.name = 'bike tyre smoke'; scene.add(smoke.object);
  const embers = createParticles(map, Math.round(180 * scale), { gravity: 0.8, drag: 0.3 });
  embers.object.name = 'exhaust blast particles'; scene.add(embers.object);

  const plume = new THREE.Group(); plume.name = 'beat exhaust flame'; scene.add(plume);
  const flameMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const noise = mx_noise_float(vec3(uv().mul(7), clock.mul(11))).mul(0.35).add(0.65);
  flameMaterial.colorNode = mix(vec3(0.15, 0.8, 2), vec3(2.2, 0.28, 0.015), uv().y.smoothstep(0.2, 1)).mul(heat.mul(0.6).add(0.7));
  flameMaterial.opacityNode = uv().y.oneMinus().pow(0.6).mul(noise).mul(heat).mul(0.8);
  const cone = new THREE.ConeGeometry(1, 1, 24, 8, true); cone.translate(0, 0.5, 0);
  const flame = new THREE.Mesh(cone, flameMaterial); plume.add(flame);
  const coreMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  coreMaterial.colorNode = vec3(0.6, 1.5, 3);
  coreMaterial.opacityNode = uv().y.oneMinus().mul(heat).mul(0.7);
  const core = new THREE.Mesh(cone, coreMaterial); plume.add(core);

  const capacity = Math.round(500 * scale), position = new Float32Array(capacity * 6), colors = new Float32Array(capacity * 6);
  const velocity = new Float32Array(capacity * 3), points = new Float32Array(capacity * 3), age = new Float32Array(capacity).fill(1), life = new Float32Array(capacity);
  const geometry = new THREE.BufferGeometry();
  const at = new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage);
  const tint = new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', at); geometry.setAttribute('color', tint);
  const sparkMaterial = new THREE.LineBasicNodeMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const sparks = new THREE.LineSegments(geometry, sparkMaterial); sparks.name = 'drift contact sparks'; sparks.frustumCulled = false; scene.add(sparks);
  const up = new THREE.Vector3(0, 1, 0);
  let next = 0, sparkDebt = 0, smokeDebt = 0, trailGeneration = -1;
  const stats = { sparks: 0, smoke: 0, blast: 0 };

  return {
    heat, stats,
    update(frame: ModeFrame, origin: THREE.Vector3, direction: THREE.Vector3, contact: THREE.Vector3,
      throttle: ReturnType<typeof createNightRiderThrottle>, drift: number, burnout: boolean, velocityMps: number, generation: number) {
      const dt = frame.reducedMotion ? 0 : THREE.MathUtils.clamp(frame.delta, 0, 0.1);
      const limit = frame.reducedFlash ? 0.4 : 1;
      heat.value = throttle.exhaust * limit; clock.value += dt;
      plume.position.copy(origin); plume.quaternion.setFromUnitVectors(up, direction);
      // Keep the zero-opacity meshes in the initial compile, so the first short backfire renders immediately.
      flame.scale.set(0.07 + heat.value * 0.05, 0.2 + heat.value * 1.2, 0.07 + heat.value * 0.05);
      core.scale.set(0.035, 0.12 + heat.value * 0.6, 0.035);
      // A hard scene cut must not leave the previous district's smoke and sparks hanging in the new shot.
      if (generation !== trailGeneration) {
        trailGeneration = generation; age.fill(1); life.fill(0); position.fill(0); colors.fill(0);
        smoke.update(10); embers.update(10); sparkDebt = smokeDebt = 0;
      }
      stats.blast = heat.value;
      if (dt > 0 && throttle.fired) {
        for (let i = 0; i < Math.round(26 * scale); i++) {
          const velocity = 1.8 + random() * 4;
          embers.emit(origin.x, origin.y, origin.z, direction.x * velocity + (random() - 0.5) * 0.6,
            direction.y * velocity, direction.z * velocity, 0.15 + random() * 0.35, 0.035 + random() * 0.04,
            2 * limit, (0.25 + random() * 0.5) * limit, 0.035 * limit);
        }
      }
      const scraping = Math.max(drift, burnout ? 0.7 : 0);
      sparkDebt += dt * scraping * 190 * scale;
      while (sparkDebt >= 1) {
        sparkDebt--; const i = next; next = (next + 1) % capacity;
        points.set([contact.x + (random() - 0.5) * 0.1, 0.025, contact.z], i * 3);
        velocity.set([(random() - 0.5) * (3 + scraping * 3), 0.7 + random() * 2.2, -2 - random() * 5 - velocityMps * 0.15], i * 3);
        age[i] = 0; life[i] = 0.2 + random() * 0.45;
      }
      smokeDebt += dt * scraping * 70 * scale;
      while (smokeDebt >= 1) {
        smokeDebt--;
        smoke.emit(contact.x, 0.07, contact.z, (random() - 0.5) * 0.7, 0.2 + random() * 0.6,
          -0.6 - velocityMps * 0.1, 0.5 + random() * 0.6, 0.25 + random() * 0.3, 0.18, 0.22, 0.28);
      }
      stats.sparks = 0;
      for (let i = 0; i < capacity; i++) {
        age[i] += dt; const k = i * 3, j = i * 6;
        if (age[i] >= life[i]) { colors.fill(0, j, j + 6); continue; }
        stats.sparks++;
        velocity[k + 1] -= dt * 7;
        for (let axis = 0; axis < 3; axis++) points[k + axis] += velocity[k + axis] * dt;
        if (points[k + 1] < 0.018) { points[k + 1] = 0.018; velocity[k + 1] = Math.abs(velocity[k + 1]) * 0.25; }
        const fade = (1 - age[i] / life[i]) * limit;
        for (let axis = 0; axis < 3; axis++) {
          position[j + axis] = points[k + axis]; position[j + 3 + axis] = points[k + axis] - velocity[k + axis] * 0.018;
        }
        colors.set([2.4 * fade, 0.8 * fade, 0.1 * fade, 0.7 * fade, 0.13 * fade, 0.008 * fade], j);
      }
      at.needsUpdate = tint.needsUpdate = true;
      smoke.update(dt); embers.update(dt);
      stats.smoke = scraping;
    },
    dispose() { map.dispose(); },
  };
}
