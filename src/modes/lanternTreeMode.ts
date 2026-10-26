import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { Fn, Loop, exp, float, hash, instanceIndex, mix, mx_noise_float, positionWorld, uniform, uniformArray, uv, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { VisualMode } from './types';
import type { QualityBudget } from '../rendering/quality';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { createGlowPoints, shaftMaterial } from './figures';
import { createCinematic } from './cinematic';
import { createHits, linearRgb } from './hitPulse';
import { seededRandom } from '../rendering/diagnostics';

const tier = (budget: QualityBudget, high: number, balanced: number, low: number) => budget.particleScale >= 2 ? high : budget.particleScale >= 1 ? balanced : low;
const rgb = (hex: number) => vec3(...linearRgb(hex));

/** A neutral soft round glow (white, so each bloom takes its own colour), drawn in code. */
function roundGlow(size = 64) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2), a = Math.max(0, 1 - d) ** 2.2;
    data.set([255, 255, 255, Math.round(a * 255)], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat); texture.needsUpdate = true;
  return texture;
}

export interface TreeBranch { a: THREE.Vector3; b: THREE.Vector3; r1: number; r2: number; depth: number }

/**
 * A deciduous tree grown in code: a trunk that splits two or three ways at each level, each child shorter,
 * thinner and turned outward and up, for `levels` levels. Returns every branch and the twig tips, where the
 * leaf clusters hang.
 */
export function growTree(levels = 7, seed = 12) {
  const random = seededRandom(seed), branches: TreeBranch[] = [], tips: THREE.Vector3[] = [];
  const grow = (from: THREE.Vector3, dir: THREE.Vector3, length: number, radius: number, depth: number) => {
    const bend = dir.clone().add(new THREE.Vector3((random() - 0.5) * 0.25, 0.05, (random() - 0.5) * 0.25)).normalize();
    const to = from.clone().addScaledVector(bend, length);
    branches.push({ a: from, b: to, r1: radius, r2: radius * 0.72, depth });
    if (depth >= levels) { tips.push(to); return; }
    const children = depth === 0 ? 2 : depth < 3 ? 3 : 2 + (random() < 0.4 ? 1 : 0);
    for (let k = 0; k < children; k++) {
      const turn = (k / children) * Math.PI * 2 + random() * 1.2, spread = 0.45 + random() * 0.35;
      const side = new THREE.Vector3(Math.cos(turn), 0, Math.sin(turn));
      const child = bend.clone().multiplyScalar(Math.cos(spread)).addScaledVector(side, Math.sin(spread)).add(new THREE.Vector3(0, 0.12, 0)).normalize();
      grow(to, child, length * (0.68 + random() * 0.12), radius * 0.62, depth + 1);
    }
  };
  grow(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 4.4, 0.45, 0);
  return { branches, tips };
}

/** Ring opening above the tree: centre height and radius, and how many cables hang from its rim. */
export const OPENING = { y: 15, radius: 7.5, cables: 18, hotspots: 16 } as const;

/**
 * Lantern Tree (wave 5, clip 9): a big tree in a misty clearing under a circular opening in a dark ceiling;
 * blue light pours down through it in shafts, dark cables hang from its rim through the canopy, lamps glow
 * cyan inside the foliage, and a flower field glows blue in the middle ground with warm flowers up close.
 * Kicks sweep an orange wave through the canopy (alternating sides), the bass brightens the lamps, mids pulse
 * the blooms, and the camera drifts slowly forward. Tree, opening, cables and field are all built in code.
 */
export function createLanternTreeMode(budget: QualityBudget): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).fov = 48;
  scene.background = new THREE.Color(0x02040a);
  scene.fog = new THREE.FogExp2(0x06101e, 0.035);
  const finish = createCinematic({ grain: 0.05, halation: 0.3, vignette: 0.5, soften: 0.18, aberration: 0.002, shadows: [0.002, 0.004, 0.008] });
  const time = uniform(0), wave = uniform(-99), waveWidth = uniform(1.6), lampGain = uniform(1), openingGain = uniform(1), shimmer = uniform(0), cast = uniform(0);
  const random = seededRandom(31);
  // Tree: bark tubes merged into one mesh.
  const { branches, tips } = growTree(tier(budget, 7, 7, 6));
  const pieces = branches.map(({ a, b, r1, r2 }) => {
    const length = a.distanceTo(b), piece = new THREE.CylinderGeometry(r2, r1, length * 1.04, 8, 1);
    piece.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
    return piece.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  });
  const barkMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
  barkMaterial.colorNode = rgb(0x1a1612).mul(mx_noise_float(positionWorld.mul(vec3(6, 1.5, 6))).mul(0.3).add(0.7));
  const tree = new THREE.Mesh(mergeGeometries(pieces), barkMaterial); pieces.forEach((piece) => piece.dispose());
  scene.add(tree);
  // Lamps hidden in the foliage: glow sprites at a few twig tips, with the leaves around them lit cyan.
  const lampPositions = Array.from({ length: OPENING.hotspots }, (_, k) => tips[Math.floor((k + random() * 0.8) / OPENING.hotspots * tips.length)].clone().add(new THREE.Vector3(0, -0.3, 0)));
  const lamps = uniformArray(lampPositions.map((p) => new THREE.Vector4(p.x, p.y, p.z, 1)), 'vec4');
  // Leaves: alpha-cut cards clustered round the twig tips, two shapes, coloured per leaf.
  const leafCount = tier(budget, 40000, 26000, 14000);
  const card = new THREE.PlaneGeometry(0.32, 0.32);
  const leafMaterial = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.6, alphaTest: 0.5 });
  const lu = uv().sub(0.5), shape = hash(float(instanceIndex).mul(3.1)).greaterThan(0.5);
  const leafEdge = shape.select(lu.x.abs().mul(2.2).add(lu.y.add(0.5).pow(2).mul(0.6)).sub(0.5), lu.length().mul(2).sub(0.85).add(lu.y.mul(0.4)));
  leafMaterial.opacityNode = leafEdge.lessThan(0.4).select(float(1), float(0));
  const leafHue = hash(float(instanceIndex).mul(7.7));
  leafMaterial.colorNode = mix(rgb(0x0e2a24), rgb(0x1e3a3a), leafHue).mul(mx_noise_float(positionWorld.mul(3).add(time.mul(shimmer))).mul(0.25).add(0.85));
  // Emissive: cyan near the lamps, the orange wave sweeping across, and a rim from the opening above.
  const lampLight = Fn(() => {
    const sum = float(0).toVar();
    Loop(OPENING.hotspots, ({ i }) => { const lamp = lamps.element(i) as unknown as Node<'vec4'>; sum.addAssign(exp(positionWorld.sub(lamp.xyz).length().div(0.55).negate())); });
    return sum;
  })();
  const sweep = exp(positionWorld.x.sub(wave).abs().div(waveWidth).negate()).mul(positionWorld.y.smoothstep(4, 7));
  leafMaterial.emissiveNode = rgb(0x8ff4ff).mul(lampLight.mul(lampGain).mul(0.5)).add(rgb(0xff8a2a).mul(sweep.mul(0.9)))
    .add(rgb(0x3a78ff).mul(positionWorld.y.smoothstep(9, 14).mul(openingGain).mul(0.08)));
  const leaves = new THREE.InstancedMesh(card, leafMaterial, leafCount);
  const outer = branches.filter((branch) => branch.depth >= 4);
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler();
  for (let i = 0; i < leafCount; i++) {
    // Leaves hang along the outer branches (not just the tips), so the canopy has depth.
    const branch = outer[Math.floor(random() * outer.length)], tip = branch.a.clone().lerp(branch.b, 0.3 + random() * 0.7), r = Math.cbrt(random()) * 0.85;
    const u = random() * Math.PI * 2, v = Math.acos(2 * random() - 1);
    const at = tip.clone().add(new THREE.Vector3(Math.sin(v) * Math.cos(u) * r, Math.cos(v) * r * 0.6 - 0.15, Math.sin(v) * Math.sin(u) * r));
    q.setFromEuler(e.set(random() * Math.PI, random() * Math.PI * 2, random() * Math.PI)); s.setScalar(0.7 + random() * 0.6);
    leaves.setMatrixAt(i, matrix.compose(at, q, s));
  }
  leaves.frustumCulled = false;
  scene.add(leaves);
  const glowTexture = roundGlow(), glows = createGlowPoints(glowTexture, OPENING.hotspots + 420);
  scene.add(glows.object);
  // The opening: a dark ceiling with a round hole, a glowing blue rim and light shafts falling through.
  const ceiling = new THREE.Mesh(new THREE.RingGeometry(OPENING.radius, 60, 64, 1), new THREE.MeshStandardNodeMaterial({ color: 0x05070c, roughness: 1, side: THREE.DoubleSide }));
  ceiling.rotation.x = Math.PI / 2; ceiling.position.y = OPENING.y; scene.add(ceiling);
  const rimMaterial = new THREE.MeshBasicNodeMaterial({ fog: false });
  rimMaterial.colorNode = mix(rgb(0x5ab8ff), rgb(0xff8a6a), cast).mul(openingGain.mul(2.4));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(OPENING.radius, 0.12, 12, 96), rimMaterial); rim.rotation.x = Math.PI / 2; rim.position.y = OPENING.y; scene.add(rim);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(OPENING.radius, 64), new THREE.MeshBasicNodeMaterial({ color: 0x1a3a6a, fog: false }));
  hole.rotation.x = Math.PI / 2; hole.position.y = OPENING.y + 0.5; scene.add(hole);
  const shafts: THREE.Mesh[] = [];
  for (let k = 0; k < 5; k++) {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(k ? 1.4 : OPENING.radius * 0.9, k ? 2.6 : OPENING.radius * 1.3, OPENING.y, 32, 1, true).translate(0, -OPENING.y / 2, 0), shaftMaterial(time));
    const angle = k * 1.7;
    shaft.position.set(k ? Math.cos(angle) * 4.5 : 0, OPENING.y, k ? Math.sin(angle) * 4.5 : 0);
    shaft.rotation.set(k ? (random() - 0.5) * 0.3 : 0, 0, k ? (random() - 0.5) * 0.3 : 0);
    shafts.push(shaft); scene.add(shaft);
  }
  // Cables from the rim, sagging through the canopy; some reach the ground.
  const cablePieces: THREE.BufferGeometry[] = [];
  for (let c = 0; c < OPENING.cables; c++) {
    const a = (c / OPENING.cables) * Math.PI * 2 + random() * 0.3;
    const start = new THREE.Vector3(Math.cos(a) * OPENING.radius, OPENING.y, Math.sin(a) * OPENING.radius);
    const toGround = c % 3 === 0;
    const end = toGround ? new THREE.Vector3(Math.cos(a + 0.6) * (3 + random() * 5), 0, Math.sin(a + 0.6) * (3 + random() * 5)) : new THREE.Vector3(Math.cos(a + 2.5) * OPENING.radius, OPENING.y, Math.sin(a + 2.5) * OPENING.radius);
    const low = start.clone().lerp(end, 0.5); low.y = toGround ? 6 + random() * 3 : 5.5 + random() * 4;
    cablePieces.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([start, start.clone().lerp(low, 0.5).add(new THREE.Vector3(0, -1.5, 0)), low, low.clone().lerp(end, 0.5).add(new THREE.Vector3(0, -0.8, 0)), end]), 60, 0.035, 5));
  }
  const cables = new THREE.Mesh(mergeGeometries(cablePieces), new THREE.MeshStandardNodeMaterial({ color: 0x050608, roughness: 0.5 })); cablePieces.forEach((g) => g.dispose());
  scene.add(cables);
  // Ground and grass: dark blades with a cool sheen; blooms are glow sprites.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardNodeMaterial({ color: 0x05080a, roughness: 1 })); ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const blade = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-0.03, 0, 0, 0.03, 0, 0, 0, 0.5, 0], 3));
  blade.computeVertexNormals();
  const grassCount = tier(budget, 60000, 40000, 20000);
  const grassMaterial = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.8 });
  grassMaterial.colorNode = mix(rgb(0x0a1a14), rgb(0x1a3a3a), hash(float(instanceIndex)));
  const grass = new THREE.InstancedMesh(blade, grassMaterial, grassCount);
  for (let i = 0; i < grassCount; i++) {
    const r = 1.5 + Math.sqrt(random()) * 26, a = random() * Math.PI * 2;
    grass.setMatrixAt(i, matrix.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), q.setFromEuler(e.set((random() - 0.5) * 0.5, random() * Math.PI, (random() - 0.5) * 0.5)), s.set(1, 0.6 + random() * 1.2, 1)));
  }
  grass.frustumCulled = false; scene.add(grass);
  const blooms = Array.from({ length: 420 }, (_, k) => {
    const warm = k < 70;
    // Warm flowers close to the camera; blue blooms across the middle ground.
    const r = warm ? 13 + random() * 6 : 4 + random() * 14, a = warm ? Math.PI / 2 + (random() - 0.5) * 1.4 : random() * Math.PI * 2;
    return { p: new THREE.Vector3(Math.cos(a) * r, 0.25 + random() * 0.35, Math.sin(a) * r), warm, phase: random() * Math.PI * 2, rank: random() };
  });
  scene.add(new THREE.HemisphereLight(0x2a4a7a, 0x020304, 0.6));
  const moon = new THREE.DirectionalLight(0x7ab0ff, 1.2); moon.position.set(0, 20, 2); scene.add(moon);
  const lampLights = [0, 1, 2].map((k) => { const light = new THREE.PointLight(0x8ff4ff, 3, 8, 1.6); light.position.copy(lampPositions[k * 5]); scene.add(light); return light; });

  const hits = createHits({ decay: 0.25, interval: 0.25 });
  let waveAt = -99, waveDir = 1, quiet = 0, loud = 0, drift = 0, castLevel = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time; finish.update(frame);
      const step = settleStep(frame), motion = frame.reducedMotion ? 0 : frame.delta, { bass, loudness, bounce } = frame.response;
      hits.update(frame, 0.1);
      quiet = loudness < 0.1 ? quiet + step : 0;
      if (loudness > 0.25) loud += step;
      const breakdown = quiet > 1.5 && loud > 4;
      // Each kick sends the next orange wave through the canopy, from alternating sides.
      if (hits.fired) { waveDir = -waveDir; waveAt = -9 * waveDir; if (hits.count % 4 === 0) castLevel = 1; }
      if (Math.abs(waveAt) < 12) waveAt += waveDir * step * 18; else waveAt = 99;
      wave.value = waveAt;
      castLevel *= Math.exp(-step / 0.6); cast.value = castLevel * 0.7;
      lampGain.value = approach(lampGain.value, 0.5 + bass * 1.5, step, 0.08);
      openingGain.value = approach(openingGain.value, breakdown ? 0.15 : 0.7 + loudness * 0.5, step, 0.3);
      shimmer.value = approach(shimmer.value, frame.audio.highs * 2, step, 0.1);
      shafts.forEach((shaft, k) => (shaft.material as THREE.MeshBasicNodeMaterial).color.setRGB(...linearRgb(0x3a7aff)).multiplyScalar((k ? 0.12 : 0.06) * openingGain.value));
      lampLights.forEach((light) => { light.intensity = 1 + lampGain.value * 4; });
      // Lamp glows in the canopy, then the field's blooms: more of them light as it gets louder, pulsing on the mids.
      lampPositions.forEach((p, k) => glows.set(k, p.x, p.y, p.z, 1.1 + lampGain.value * 0.8, 0.6 * lampGain.value, 1.6 * lampGain.value, 1.8 * lampGain.value));
      blooms.forEach((bloom, k) => {
        const on = bloom.warm || bloom.rank < 0.25 + loudness * 0.75 ? 1 : 0;
        const pulse = 0.6 + 0.4 * Math.sin(frame.time * 2 + bloom.phase) + frame.audio.mid * 0.8;
        const size = bloom.warm ? 1.2 : 0.35 + pulse * 0.15;
        const [r, g, b] = bloom.warm ? [1.6, 0.8, 0.25] : [0.6, 1.1, 1.8];
        glows.set(OPENING.hotspots + k, bloom.p.x, bloom.p.y, bloom.p.z, size, r * on * pulse, g * on * pulse, b * on * pulse, bloom.warm ? 0.5 : 1);
      });
      glows.commit();
      // A slow dolly toward the tree with a sideways drift; bounce nudges it.
      drift += motion * (0.12 + bounce * 0.1);
      const z = 28 - (Math.sin(drift * 0.15) * 0.5 + 0.5) * 6, x = Math.sin(drift * 0.23) * 3;
      camera.position.set(x, 2.4 + Math.sin(drift * 0.3) * 0.3, z);
      camera.lookAt(x * 0.3, 7.6, 0);
    },
    filter: (input) => finish.filter(input),
    dispose() { disposeScene(scene); glowTexture.dispose(); },
  };
}
