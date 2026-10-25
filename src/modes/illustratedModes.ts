import * as THREE from 'three/webgpu';
import { atan, attribute, exp, float, fract, instanceIndex, mix, normalLocal, positionLocal, sin, texture as sampleTexture, uniform, uv, vec2, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { VisualMode } from './types';
import type { QualityBudget } from '../rendering/quality';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { createGlowPoints, createParticles, loadTexture } from './figures';
import { createCinematic } from './cinematic';
import { createHits, linearRgb } from './hitPulse';
import { seededRandom } from '../rendering/diagnostics';
import handUrl from '../assets/wave4/bloomTouch/hand.png?url';
import handTip from '../assets/wave4/bloomTouch/hand.json';
import sparkUrl from '../assets/fx/spark.png?url';
import emberUrl from '../assets/fx/ember.png?url';

const tier = (budget: QualityBudget, high: number, balanced: number, low: number) => budget.particleScale >= 2 ? high : budget.particleScale >= 1 ? balanced : low;

// ---------------------------------------------------------------- Pole Sparks

const CABLES = 180, PULSES = 24;

/** One sagging cable between two points: a quadratic curve dipped by `sag` metres in the middle. */
export function cableCurve(start: THREE.Vector3, end: THREE.Vector3, sag: number) {
  const mid = start.clone().lerp(end, 0.5); mid.y -= sag;
  return new THREE.QuadraticBezierCurve3(start, mid, end);
}

/**
 * Pole Sparks: an anime dusk street seen from below, a utility pole wrapped in a tangle of cables. Pink pulses
 * shoot along random cables on hits, spark at the junctions, and two heart lights blink on the boxes.
 */
export function createPoleSparksMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).fov = 55;
  const time = uniform(0), hearts = uniform(0.3);
  const finish = createCinematic({ grain: 0.035, halation: 0.25, vignette: 0.35, soften: 0.1, aberration: 0.0015, shadows: [0.01, 0.014, 0.018] });
  // Dusk sky: grey-teal, a little lighter toward the horizon.
  const skyMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  const up = positionLocal.normalize().y;
  skyMaterial.colorNode = mix(vec3(...linearRgb(0x4a5c68)), vec3(...linearRgb(0x324048)), up.smoothstep(-0.1, 0.9));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), skyMaterial));
  const random = seededRandom(9);
  const toon = (hex: number) => new THREE.MeshToonNodeMaterial({ color: new THREE.Color(hex) });
  const outline = (geometry: THREE.BufferGeometry, width: number) => {
    const material = new THREE.MeshBasicNodeMaterial({ color: 0x140a0d, side: THREE.BackSide });
    material.positionNode = positionLocal.add(normalLocal.mul(width));
    return new THREE.Mesh(geometry, material);
  };
  // Two poles with crossarms and insulators.
  const poles = new THREE.Group();
  for (const [x, z, h] of [[0, 0, 26], [9, -7, 22]] as const) {
    const pole = new THREE.CylinderGeometry(0.28, 0.36, h, 16).translate(x, h / 2 - 4, z);
    poles.add(new THREE.Mesh(pole, toon(0x6a4a4e)), outline(pole, 0.04));
    for (const y of [h - 7, h - 9.5]) {
      const arm = new THREE.BoxGeometry(4, 0.25, 0.25).translate(x, y, z);
      poles.add(new THREE.Mesh(arm, toon(0x4a3438)), outline(arm, 0.03));
    }
  }
  scene.add(poles);
  // Junction boxes, each with a heart light that blinks on the bass.
  const heartMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const hp = uv().sub(0.5).mul(2.4), hx = hp.x.abs(), hy = hp.y.add(0.3);
  const heartShape = hx.mul(hx).add(hy.sub(hx.sqrt().mul(0.9)).pow(2)).lessThan(0.55);
  heartMaterial.colorNode = vec3(...linearRgb(0xff6ea8)).mul(hearts.mul(3).add(0.2));
  heartMaterial.opacityNode = heartShape.select(float(1), float(0));
  for (const [x, y, z] of [[-1.2, 14, 0.9], [1.6, 9, 1.0], [8.2, 12, -5.9]] as const) {
    const box = new THREE.BoxGeometry(1.6, 1.3, 0.8).translate(x, y, z);
    scene.add(new THREE.Mesh(box, toon(0x1d2228)), outline(box, 0.05));
    const heart = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), heartMaterial); heart.position.set(x, y, z + 0.41); scene.add(heart);
  }
  // The cable tangle: every cable merged into one mesh, with its index and length position as attributes.
  const pieces: THREE.BufferGeometry[] = [], anchors: THREE.Vector3[] = [];
  for (let c = 0; c < CABLES; c++) {
    const fromSecond = c % 4 === 3;
    const start = fromSecond ? new THREE.Vector3(9 + (random() - 0.5), 9 + random() * 9, -7) : new THREE.Vector3((random() - 0.5) * 1.2, 6 + random() * 16, (random() - 0.5) * 1.2);
    const angle = random() * Math.PI * 2, reach = 8 + random() * 28;
    const end = c % 5 === 0 ? new THREE.Vector3(9, 8 + random() * 10, -7) : new THREE.Vector3(Math.cos(angle) * reach, start.y + (random() - 0.4) * 10, Math.sin(angle) * reach * 0.6 - 4);
    const curve = cableCurve(start, end, 1 + random() * 4);
    const tube = new THREE.TubeGeometry(curve, 40, 0.04 + random() * 0.09, 6);
    tube.setAttribute('cable', new THREE.Float32BufferAttribute(new Float32Array(tube.attributes.position.count).fill(c), 1));
    pieces.push(tube); anchors.push(start);
  }
  const cables = mergeGeometries(pieces); pieces.forEach((piece) => piece.dispose());
  // Pulse state per cable: x = position along it (0–1), y = strength; read in the shader by cable index.
  const pulseData = new Float32Array(CABLES * 4), pulseTexture = new THREE.DataTexture(pulseData, CABLES, 1, THREE.RGBAFormat, THREE.FloatType);
  pulseTexture.minFilter = pulseTexture.magFilter = THREE.NearestFilter; pulseTexture.needsUpdate = true;
  const cableId = attribute<'float'>('cable'), along = uv().x;
  const pulse = sampleTexture(pulseTexture, vec2(cableId.add(0.5).div(CABLES), 0.5));
  const behind = pulse.x.sub(along), head = exp(behind.abs().div(0.012).negate()), tail = behind.greaterThan(0).select(exp(behind.div(0.08).negate()), float(0));
  const glow = head.mul(2).add(tail).mul(pulse.y);
  const cableMaterial = new THREE.MeshToonNodeMaterial();
  const kind = fract(cableId.mul(0.618));
  const stripe = fract(along.mul(160)).lessThan(0.5).select(float(1), float(0));
  cableMaterial.colorNode = kind.lessThan(0.55).select(vec3(...linearRgb(0xb02a3a)), kind.lessThan(0.8).select(vec3(...linearRgb(0x6b7280)), mix(vec3(...linearRgb(0xb02a3a)), vec3(0.85, 0.8, 0.8), stripe)));
  // Toon materials honour emissiveNode at runtime (NodeMaterial reads it); the typings just don't declare it.
  (cableMaterial as unknown as { emissiveNode: THREE.Node }).emissiveNode = mix(vec3(...linearRgb(0xff4fa0)), vec3(...linearRgb(0xffb0e0)), head).mul(glow.mul(3));
  scene.add(new THREE.Mesh(cables, cableMaterial), outline(cables, 0.018));
  scene.add(new THREE.HemisphereLight(0x9ab0bc, 0x3a2a30, 1.4));
  const sun = new THREE.DirectionalLight(0xffd8c8, 1.2); sun.position.set(-10, 20, 15); scene.add(sun);
  // Spark clusters where pulses arrive at the pole.
  const sparks = createParticles(loadTexture(sparkUrl), 300, { gravity: 6, drag: 1.2 });
  scene.add(sparks.object);
  const live = Array.from({ length: PULSES }, () => ({ cable: -1, at: 0, speed: 1 }));
  const hits = createHits({ decay: 0.3, interval: 0.25 });
  let next = 0, randomSpark = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time; finish.update(frame);
      const step = settleStep(frame);
      hits.update(frame, 0.3);
      // A hit shoots one to three pulses along random cables, from the far end toward the pole.
      if (hits.fired) for (let k = 0, n = 1 + Math.floor(random() * 3); k < n; k++) {
        live[next] = { cable: Math.floor(random() * CABLES), at: 1, speed: 0.5 + random() * 0.5 }; next = (next + 1) % PULSES;
      }
      pulseData.fill(0);
      for (const p of live) {
        if (p.cable < 0) continue;
        p.at -= step * p.speed * (1 + frame.response.bass);
        if (p.at <= 0) {
          // Arrival: a spark cluster at the junction.
          const anchor = anchors[p.cable];
          for (let s = 0; s < 12; s++) sparks.emit(anchor.x, anchor.y, anchor.z + 0.3, (random() - 0.5) * 6, random() * 5, (random() - 0.5) * 6, 0.12 + random() * 0.15, 0.25, 2, 0.7, 1.4);
          p.cable = -1; continue;
        }
        pulseData[p.cable * 4] = p.at; pulseData[p.cable * 4 + 1] = 1;
      }
      pulseTexture.needsUpdate = true;
      // Loudness keeps a trickle of stray sparks going.
      randomSpark += step * frame.response.loudness * 6;
      while (randomSpark > 1) { randomSpark--; const a = anchors[Math.floor(random() * CABLES)]; sparks.emit(a.x, a.y, a.z, (random() - 0.5) * 3, random() * 3, (random() - 0.5) * 3, 0.15, 0.18, 2, 0.8, 1.4); }
      sparks.update(step);
      hearts.value = approach(hearts.value, frame.response.bass > 0.5 ? 1 : 0.15 + frame.response.bass * 0.5, step, 0.05);
      const drift = frame.reducedMotion ? 0 : frame.time;
      camera.position.set(5 + Math.sin(drift * 0.05) * 0.8, 1, 22);
      camera.lookAt(2, 13, 0);
    },
    filter: (input) => finish.filter(input),
    dispose() { disposeScene(scene); pulseTexture.dispose(); },
  };
}

// ---------------------------------------------------------------- Bloom Touch

/** Growth phases over one ~9 s cycle: sprout, bush, wreath, vine arc, spark burst, then reset. */
export const GROWTH_PHASES = ['sprout', 'bush', 'wreath', 'vine', 'burst'] as const;
const LEAF_SLOTS = 1800;

/** Where each leaf slot grows relative to the fingertip, in frame-height units, and in which phase it appears. */
export function growthSlots(count: number, seed = 3) {
  const random = seededRandom(seed);
  return Array.from({ length: count }, (_, i) => {
    const phase = i < count * 0.08 ? 0 : i < count * 0.38 ? 1 : i < count * 0.75 ? 2 : 3;
    let x = 0, y = 0;
    if (phase === 0) { y = random() * 0.08; x = (random() - 0.5) * 0.03; }
    else if (phase === 1) { const a = random() * Math.PI, r = Math.sqrt(random()) * 0.16; x = Math.cos(a) * r; y = Math.sin(a) * r + 0.06; }
    else if (phase === 2) { const a = random() * Math.PI * 2, r = 0.2 + (random() - 0.5) * 0.08; x = Math.cos(a) * r; y = Math.sin(a) * r * 0.9 + 0.05; }
    else { const t = random(); x = Math.sin(t * Math.PI * 0.9) * 0.45 - 0.05; y = 0.05 + t * 0.4 + (random() - 0.5) * 0.04; }
    return { x, y, phase, turn: random() * Math.PI * 2, size: 0.02 + random() * 0.025, order: random(), flower: random() < 0.14, hue: random() };
  });
}

export function createBloomTouchMode(budget: QualityBudget): VisualMode {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -5, 5);
  const leafCount = tier(budget, LEAF_SLOTS, 900, 350);
  const time = uniform(0), rimGlow = uniform(1);
  const finish = createCinematic({ grain: 0.04, halation: 0.35, vignette: 0.5, soften: 0.12, shadows: [0.004, 0.003, 0.003] });
  scene.background = new THREE.Color(0x020304);
  // The hand: the supplied cel-shaded PNG, with a red rim light glowing along its left edge.
  const handMap = loadTexture(handUrl);
  const handMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const at = (dx: number, dy: number) => sampleTexture(handMap, uv().add(vec2(dx, dy))).a;
  const here = sampleTexture(handMap, uv());
  const edge = here.a.sub(at(0.006, 0).mul(0.5).add(at(0.004, -0.004).mul(0.5))).max(0);
  const halo = at(-0.008, 0).add(at(-0.016, 0.004)).add(at(-0.012, -0.01)).div(3).mul(here.a.oneMinus());
  handMaterial.colorNode = here.rgb.mul(0.72).add(vec3(1, 0.35, 0.29).mul(edge.mul(2.5).add(halo.mul(1.5)).mul(rimGlow)));
  handMaterial.opacityNode = here.a.max(halo.mul(0.8));
  const hand = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), handMaterial); hand.renderOrder = 2;
  scene.add(hand);
  // Leaves: anime-flat two-tone cards with a midrib and a glowing edge; some slots bloom as flowers instead.
  const slots = growthSlots(leafCount);
  const leafMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const lp = uv().sub(0.5).mul(2), shape = lp.x.abs().mul(1.9).add(lp.y.mul(lp.y)).sub(1);
  const flowerFlag = attribute<'float'>('flower'), tone = attribute<'float'>('tone');
  const petals = lp.length().sub(sin(atan(lp.y, lp.x).mul(5)).mul(0.25).add(0.65));
  const mask = mix(shape, petals, flowerFlag);
  const lit = lp.x.add(lp.y.mul(0.5)).smoothstep(-0.6, 0.6);
  const leafColour = mix(vec3(...linearRgb(0x2fa84a)), vec3(...linearRgb(0x8ae04a)), lit).mul(lp.x.abs().smoothstep(0, 0.06).mul(0.25).add(0.75));
  const flowerColour = mix(mix(vec3(...linearRgb(0xffc83a)), vec3(...linearRgb(0xff5a8a)), tone.smoothstep(0.3, 0.7)), vec3(1), tone.smoothstep(0.85, 0.95)).mul(lp.length().smoothstep(0.15, 0.35).mul(0.6).add(0.4));
  const rim = mask.smoothstep(-0.25, 0).mul(mask.lessThan(0).select(float(1), float(0)));
  leafMaterial.colorNode = mix(leafColour, flowerColour, flowerFlag).mul(1.2).add(vec3(0.7, 1, 0.5).mul(rim.mul(0.8)));
  leafMaterial.opacityNode = mask.lessThan(0).select(float(1), exp(mask.mul(-14)).mul(0.25));
  const leafGeometry = new THREE.PlaneGeometry(1, 1);
  leafGeometry.setAttribute('flower', new THREE.InstancedBufferAttribute(new Float32Array(slots.map((slot) => slot.flower ? 1 : 0)), 1));
  leafGeometry.setAttribute('tone', new THREE.InstancedBufferAttribute(new Float32Array(slots.map((slot) => slot.hue)), 1));
  const leaves = new THREE.InstancedMesh(leafGeometry, leafMaterial, leafCount); leaves.frustumCulled = false; leaves.renderOrder = 3;
  leafMaterial.positionNode = positionLocal.add(vec3(sin(time.mul(1.7).add(instanceIndex.toFloat())).mul(0.015), 0, 0));
  scene.add(leaves);
  const fireflies = createGlowPoints(loadTexture(emberUrl), 61); fireflies.object.renderOrder = 4;
  const sparks = createParticles(loadTexture(sparkUrl), 200, { drag: 1.5 }); sparks.object.renderOrder = 4;
  scene.add(fireflies.object, sparks.object);
  const random = seededRandom(5), bugs = Array.from({ length: 60 }, () => ({ x: random() - 0.5, y: random() - 0.5, phase: random() * 10 }));
  const hits = createHits({ decay: 0.5, interval: 0.8 });
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), axis = new THREE.Vector3(0, 0, 1), position = new THREE.Vector3(), size = new THREE.Vector3();
  const born = new Float32Array(leafCount).fill(-1);
  let cycle = 0, extra = 0, burstDone = false, scale = 1;
  return {
    scene, camera,
    update(frame) {
      const half = frame.aspect / 2;
      if (camera.right !== half) { camera.left = -half; camera.right = half; camera.updateProjectionMatrix(); }
      time.value = frame.time; finish.update(frame);
      const step = settleStep(frame);
      hits.update(frame, 0.6);
      // The hand sits bottom-left; its fingertip (measured in hand.json) is where everything grows from.
      hand.position.set(-half + 0.5, 0, 0);
      const tipX = -half + handTip.x / 2048, tipY = 0.5 - handTip.y / 2048;
      // One growth cycle every ~9 s; each hit pushes a burst of 40 more leaves out early.
      cycle += frame.reducedMotion ? step * 0.3 : step;
      if (hits.fired) extra += 40;
      if (cycle > 9) { cycle = 0; extra = 0; born.fill(-1); burstDone = false; }
      const phase = Math.min(4, Math.floor(cycle / 1.8));
      scale = approach(scale, 1 + frame.response.bass * 0.15, step, 0.1);
      for (let i = 0; i < leafCount; i++) {
        const slot = slots[i];
        const due = slot.phase < phase || (slot.phase === phase && slot.order < (cycle % 1.8) / 1.8) || slot.order * leafCount < extra;
        if (due && born[i] < 0 && phase < 4) born[i] = frame.time;
        const age = born[i] < 0 ? 0 : Math.min(1, (frame.time - born[i]) / 0.5);
        const fade = phase === 4 ? Math.max(0, 1 - (cycle - 7.2) / 1.8) : 1;
        const s = slot.size * age * fade * scale * (slot.flower ? 1.4 : 1);
        position.set(tipX + slot.x, tipY + slot.y, 0);
        q.setFromAxisAngle(axis, slot.turn + Math.sin(frame.time + i) * 0.1);
        leaves.setMatrixAt(i, matrix.compose(position, q, size.set(s, s * 1.6, 1)));
      }
      leaves.instanceMatrix.needsUpdate = true;
      // The burst phase: a green spark burst from the fingertip, then the cycle resets to the lone fingertip.
      if (phase === 4 && !burstDone) {
        burstDone = true;
        for (let k = 0; k < 120; k++) { const a = random() * Math.PI * 2, v = 0.2 + random() * 0.5; sparks.emit(tipX, tipY + 0.05, 0.1, Math.cos(a) * v, Math.sin(a) * v, 0, 0.6 + random() * 0.6, 0.012, 0.5, 1.6, 0.4); }
      }
      sparks.update(step);
      rimGlow.value = 0.6 + frame.response.loudness * 0.8 + hits.flash * 0.5;
      const density = 0.2 + frame.response.loudness * 0.8;
      bugs.forEach((bug, i) => {
        const on = i / bugs.length < density, blink = Math.max(0, Math.sin(frame.time * 2 + bug.phase));
        fireflies.set(i, tipX + bug.x * 0.8 + Math.sin(frame.time * 0.3 + bug.phase) * 0.05, tipY + bug.y * 0.6, 0.2, on ? 0.012 : 0, 0.6 * blink, 1.4 * blink, 0.4 * blink, 1);
      });
      // A glow at the fingertip that never quite goes out.
      fireflies.set(60, tipX, tipY, 0.3, 0.05 + frame.response.bass * 0.03, 1.2, 1.6, 0.7, 0.8);
      fireflies.commit();
    },
    filter: (input) => finish.filter(input),
    dispose() { disposeScene(scene); },
  };
}

