import * as THREE from 'three/webgpu';
import { Fn, If, Loop, float, instanceIndex, instancedArray, mix, uint, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { initializeFlock } from '../simulations/flock';
import { disposeScene, resizeCamera, sceneDefaults } from './shared';
import type { VisualMode } from './types';
import type { QualityBudget } from '../rendering/quality';

export function flockBudget(budget: QualityBudget) {
  switch (budget.preset) {
    case 'compatibility': return { count: 110, neighbors: 0 };
    case 'balanced': return { count: 1024, neighbors: 32 };
    case 'high': return { count: 2048, neighbors: 48 };
    case 'ultra': return { count: 4096, neighbors: 64 };
  }
}

/** Sampled-neighbor flock: O(count × capped neighbors), with immutable input for each dispatch. */
export function createGpuFlockMode(budget: QualityBudget): VisualMode {
  const { count, neighbors } = flockBudget(budget);
  const { scene, camera } = sceneDefaults(90);
  // Interleave position and velocity vec4s. Two buffers also fit the vertex-stage storage limit.
  const initial = new Float32Array(count * 8);
  initializeFlock(count).forEach((b, i) => initial.set([b.px, b.py, b.pz, 0, b.vx, b.vy, b.vz, 0], i * 8));
  const states = [instancedArray(initial, 'vec4'), instancedArray(initial.slice(), 'vec4')];
  const parity = uniform(0), phase = uniform(0, 'uint'), impact = uniform(0), size = uniform(0.65);
  const tint = uniform(new THREE.Color(0x48cfff));
  const kernels = states.map((source, index) => Fn(() => {
    const slot = instanceIndex.mul(2);
    const p = source.element(slot).xyz.toVar(), v = source.element(slot.add(1)).xyz.toVar();
    const separation = vec3(0).toVar(), alignment = vec3(0).toVar(), centre = vec3(0).toVar(), found = float(0).toVar();
    // Rotating, stratified candidates approximate local steering without a quadratic all-pairs scan.
    // This intentionally samples neighbors; it is not an exact spatial nearest-neighbor search.
    Loop(neighbors, ({ i }) => {
      const other = instanceIndex.add(uint(i).mul(127)).add(phase.mul(73)).add(1).mod(uint(count));
      const q = source.element(other.mul(2)).xyz.toVar();
      const offset = q.sub(p).toVar(), d2 = offset.dot(offset).toVar();
      If(other.notEqual(instanceIndex).and(d2.lessThan(324)), () => {
        found.addAssign(1); centre.addAssign(q);
        alignment.addAssign(source.element(other.mul(2).add(1)).xyz);
        If(d2.greaterThan(0.0001).and(d2.lessThan(64)), () => {
          separation.subAssign(offset.mul(float(18).div(d2.sqrt().max(0.01))));
        });
      });
    });
    const acceleration = separation.toVar();
    If(found.greaterThan(0), () => {
      acceleration.addAssign(alignment.div(found).sub(v).mul(0.8));
      acceleration.addAssign(centre.div(found).sub(p).mul(0.4));
    });
    acceleration.addAssign(p.div(p.length().max(1)).mul(impact.mul(100)));
    v.addAssign(acceleration.mul(1 / 120));
    v.mulAssign(float(30).div(v.length().max(0.001)).min(1));
    const half = vec3(35, 20, 35);
    const next = p.add(v.mul(1 / 120)).add(half).mod(half.mul(2)).add(half.mul(2)).mod(half.mul(2)).sub(half);
    states[1 - index].element(slot).assign(vec4(next, 0));
    states[1 - index].element(slot.add(1)).assign(vec4(v, 0));
  })().compute(count));

  const at = instanceIndex.mul(2);
  const position = mix(states[0].element(at).xyz, states[1].element(at).xyz, parity);
  const velocity = mix(states[0].element(at.add(1)).xyz, states[1].element(at.add(1)).xyz, parity);
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  material.positionNode = position;
  material.scaleNode = vec2(size);
  material.colorNode = mix(tint, vec3(0.7, 0.3, 1), velocity.length().div(30).mul(0.6));
  material.opacityNode = uv().sub(0.5).length().smoothstep(0.08, 0.5).oneMinus().mul(0.7);
  const sprites = new THREE.Sprite(material);
  sprites.geometry = sprites.geometry.clone();
  // Make storage ownership explicit so geometry disposal releases both GPU buffers.
  sprites.geometry.setAttribute('flockStateA', states[0].value);
  sprites.geometry.setAttribute('flockStateB', states[1].value);
  sprites.name = 'gpu-flock'; sprites.count = count; sprites.frustumCulled = false;
  sprites.userData.neighbors = neighbors;
  scene.add(sprites);
  let current = 0, pending = 0, remainder = 0, step = 0;
  return {
    scene, camera,
    async prepare(renderer) { await renderer.compileComputeAsync(kernels); },
    update(frame) {
      remainder += frame.reducedMotion ? 0 : Math.max(0, Math.min(0.05, frame.delta));
      pending = Math.min(6, Math.floor((remainder + 1e-10) * 120));
      remainder = Math.max(0, remainder - pending / 120);
      impact.value = frame.reducedMotion ? 0 : Math.max(0, Math.min(1, frame.response.impact));
      size.value = frame.reducedMotion || frame.reducedFlash ? 0.65 : 0.65 + Math.min(1, frame.response.bounce) * 0.5;
      tint.value.setHSL((frame.hue + 0.36) % 1, 0.9, 0.52);
      resizeCamera(camera, frame.aspect);
    },
    simulate(renderer) {
      for (let i = 0; i < pending; i++) {
        phase.value = step++;
        renderer.compute(kernels[current]); current = 1 - current;
      }
      parity.value = current; pending = 0;
    },
    dispose() { kernels.forEach(kernel => kernel.dispose()); disposeScene(scene); },
  };
}
