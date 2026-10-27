import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { float, fract, instancedBufferAttribute, mix, mx_noise_float, normalView, positionLocal, screenCoordinate, sin, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { hash2 } from './shaderModes';
import { createHits } from './hitPulse';
import { drive, isSnare } from './waveSixShared';
import { seededRandom } from '../rendering/diagnostics';
import { presetBudget, type QualityBudget } from '../rendering/quality';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/** Thermal ramp stops, cold to hot: black, deep purple, magenta, orange, yellow, white. */
export const THERMAL: readonly (readonly [number, number, number])[] = [[0, 0, 0], [0.12, 0.0, 0.28], [0.75, 0.02, 0.5], [1.0, 0.32, 0.02], [1.0, 0.85, 0.08], [1.0, 0.98, 0.85]];
const thermal = (heat: F): V3 => {
  let colour: V3 = vec3(...THERMAL[0]);
  for (let k = 1; k < THERMAL.length; k++) colour = mix(colour, vec3(...THERMAL[k]), heat.mul(THERMAL.length - 1).sub(k - 1).clamp(0, 1));
  return colour;
};

/** A carp: a tapered body along +x (head forward), a forked tail and a dorsal fin, about 3 units long. */
export function fishGeometry() {
  const body = new THREE.SphereGeometry(1, 36, 18), p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), taper = x < 0 ? 1 + x * 0.62 : 1 - x * x * 0.25;
    p.setXYZ(i, x * 1.5, (y * 0.55 + (y > 0 ? 0.08 : 0) * (1 - x * x)) * taper, z * 0.28 * taper);
  }
  body.computeVertexNormals();
  const tail = new THREE.Shape(); tail.moveTo(-1.3, 0); tail.lineTo(-2.1, 0.55); tail.quadraticCurveTo(-1.85, 0, -2.1, -0.5); tail.lineTo(-1.3, 0);
  const fin = new THREE.Shape(); fin.moveTo(0.4, 0.5); fin.quadraticCurveTo(0, 0.95, -0.7, 0.42); fin.lineTo(0.4, 0.5);
  const fins = [new THREE.ShapeGeometry(tail), new THREE.ShapeGeometry(fin)].map((g) => { g.deleteAttribute('uv'); return g; });
  body.deleteAttribute('uv');
  return mergeGeometries([body, ...fins])!;
}

/**
 * Heat Shoal (wave 6, #14): carp swimming across black, seen through a thermal camera: yellow-white cores,
 * orange, magenta-purple edges. At low energy a few fish swim calmly and sharp; as the music builds the picture
 * goes wild: many more fish, smeared into long horizontal streaks, rainbow fringing, VHS scanlines and streaking
 * dust. Kicks send a burst of fish across, bass heats them, hats raise the dust, snares jump the colour split.
 */
export function createHeatShoalMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  const perspective = camera as THREE.PerspectiveCamera;
  perspective.fov = 40; perspective.position.set(0, 0, 30); perspective.lookAt(0, 0, 0);
  scene.background = new THREE.Color(0x000000);
  const random = seededRandom(1414);
  const count = Math.round(80 * Math.min(1, budget.particleScale));
  const time = uniform(0), heatGain = uniform(1);
  // Heat only goes to the red channel; the filter maps it through the thermal ramp.
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) phases[i] = random() * 10;
  const phase = instancedBufferAttribute<'float'>(new THREE.InstancedBufferAttribute(phases, 1), 'float');
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const x = positionLocal.x, behind = x.smoothstep(0.8, -2.1);
  // The swim: a travelling wave down the body, growing toward the tail.
  material.positionNode = positionLocal.add(vec3(0, sin(x.mul(1.8).sub(time.mul(7)).add(phase)).mul(0.08).mul(behind), sin(x.mul(2.2).sub(time.mul(7)).add(phase)).mul(0.45).mul(behind)));
  const facing = normalView.z.abs();
  const core = facing.pow(1.4).mul(0.33).add(0.58).mul(x.smoothstep(-2.1, 0.2).mul(0.3).add(0.7));
  material.colorNode = vec3(core.mul(heatGain), 0, 0);
  const fish = new THREE.InstancedMesh(fishGeometry(), material, count);
  fish.frustumCulled = false; scene.add(fish);

  // The thermal camera.
  const aspect = uniform(16 / 9), smear = uniform(0), split = uniform(0), scan = uniform(0), dust = uniform(0), haze = uniform(0);
  const filter = (input: THREE.TextureNode) => {
    const p = uv(), heatAt = (q: Node<'vec2'>) => input.sample(q.clamp(0, 1)).r;
    // Horizontal smear: a symmetric spread of taps whose reach grows with energy, kept bright where the fish is.
    const smeared = (q: Node<'vec2'>) => {
      let sum: F = float(0), peak: F = heatAt(q);
      for (let k = 1; k <= 8; k++) {
        const offset = vec2(smear.mul(k / 8), 0);
        const a = heatAt(q.add(offset)), b = heatAt(q.sub(offset));
        sum = sum.add(a).add(b); peak = peak.max(a.max(b).mul(1 - k / 12));
      }
      return mix(heatAt(q), sum.div(16).mul(1.25).max(peak.mul(0.9)).min(0.92), smear.mul(30).clamp(0, 1));
    };
    // A faint, slowly drifting warm haze behind the fish when the picture goes wild.
    const field = mx_noise_float(vec3(p.x.mul(3).add(time.mul(0.6)), p.y.mul(9), time.mul(0.2))).mul(0.5).add(0.5).smoothstep(0.55, 0.95).mul(haze).mul(0.35);
    const shift = vec2(split, 0);
    const heat = vec3(smeared(p.add(shift)), smeared(p), smeared(p.sub(shift))).add(field);
    let colour: V3 = vec3(thermal(heat.x.clamp(0, 1)).x, thermal(heat.y.clamp(0, 1)).y, thermal(heat.z.clamp(0, 1)).z);
    // Dust: short coloured streaks racing sideways.
    const cell = vec2(p.x.mul(aspect).mul(60).add(time.mul(9)), p.y.mul(110)), id = cell.floor(), f = fract(cell);
    const speck = hash2(id).lessThan(dust.mul(0.05)).select(f.y.sub(0.5).abs().smoothstep(0.25, 0.05).mul(f.x.smoothstep(0, 0.3).mul(f.x.smoothstep(1, 0.7))), float(0));
    const hue = hash2(id.add(4.4));
    colour = colour.add(vec3(hue.lessThan(0.33).select(float(1), float(0.2)), hue.greaterThan(0.66).select(float(1), float(0.3)), hue.sub(0.5).abs().lessThan(0.17).select(float(1), float(0.4))).mul(speck).mul(1.4));
    // VHS scanlines and a little line noise.
    const lines = sin(screenCoordinate.y.mul(Math.PI / 1.5)).mul(0.5).add(0.5).mul(scan).mul(0.35).oneMinus();
    const noise = hash2(vec2(screenCoordinate.y.floor(), time.mul(30).floor())).sub(0.5).mul(scan).mul(0.04);
    return vec4(colour.mul(lines).add(noise).max(vec3(0)), 1);
  };

  const hits = createHits({ decay: 0.2, interval: 0.2 });
  const state = Array.from({ length: count }, () => ({ alive: false, x: 0, y: 0, z: 0, speed: 1, size: 1, dir: 1, yaw: 0 }));
  const dummy = new THREE.Object3D();
  const spawn = (fast: boolean) => {
    const s = state.find((f) => !f.alive); if (!s) return;
    const dir = random() < 0.6 ? -1 : 1, width = 30 * aspect.value * 0.4;
    s.alive = true; s.dir = dir; s.x = -dir * (width + 6 + random() * 6); s.y = (random() - 0.5) * 22; s.z = (random() - 0.5) * 10;
    s.size = 1.1 + random() * 1.4; s.speed = (fast ? 9 : 3) + random() * 3; s.yaw = (random() - 0.5) * 0.5;
  };
  let wild = 0, calmTimer = 0, splitKick = 0;
  // Start with a few fish already in frame, so even the first silent second shows the calm shoal.
  for (let k = 0; k < 4; k++) { spawn(false); state[k].x = (random() - 0.5) * 30; }
  return {
    scene, camera, filter,
    update(frame) {
      resizeCamera(perspective, frame.aspect);
      time.value = frame.time; aspect.value = frame.aspect;
      const step = settleStep(frame), motion = frame.reducedMotion ? 0 : frame.delta, { bass, loudness } = frame.response;
      hits.update(frame, 0.1);
      // How wild the picture is: follows the energy slowly (calm intro, wild drop).
      wild = approach(wild, Math.min(1, Math.max(0, (loudness - 0.25) * 1.6 + drive(frame) * 0.2)), step, 1.2);
      // Fish: a few calm swimmers always; more with energy; kicks send a burst across.
      const target = Math.round(4 + wild * Math.min(22, count - 6));
      const alive = state.filter((f) => f.alive).length;
      calmTimer -= step;
      if (alive < target && calmTimer <= 0) { spawn(false); calmTimer = 0.4 - wild * 0.35; }
      if (hits.fired) {
        if (isSnare(frame)) splitKick = 1;
        else for (let k = 0; k < 1 + Math.round(wild * 3); k++) spawn(true);
      }
      const edge = 30 * frame.aspect * 0.4 + 14;
      state.forEach((s, i) => {
        if (s.alive) {
          s.x += s.dir * s.speed * motion * (0.8 + wild * 0.6);
          if (Math.abs(s.x) > edge) s.alive = false;
        }
        dummy.position.set(s.x, s.y, s.z);
        dummy.rotation.set(0, (s.dir > 0 ? 0 : Math.PI) + s.yaw, Math.sin(frame.time * 0.8 + i) * 0.05);
        dummy.scale.setScalar(s.alive ? s.size : 0);
        dummy.updateMatrix(); fish.setMatrixAt(i, dummy.matrix);
      });
      fish.instanceMatrix.needsUpdate = true;
      heatGain.value = approach(heatGain.value, 0.85 + bass * 0.2, step, 0.1);
      smear.value = approach(smear.value, wild * wild * 0.06, step, 0.3);
      splitKick = Math.max(0, splitKick - step * 4);
      split.value = approach(split.value, wild * 0.004 + splitKick * 0.006 * (frame.reducedFlash ? 0.5 : 1), step, 0.05);
      scan.value = approach(scan.value, wild, step, 0.5);
      haze.value = approach(haze.value, wild, step, 0.8);
      dust.value = approach(dust.value, wild * 0.4 + frame.audio.highs * 0.6, step, 0.1);
    },
    dispose: () => disposeScene(scene),
  };
}
