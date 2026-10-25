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
import sparkUrl from '../assets/fx/spark.png?url';

const tier = (budget: QualityBudget, high: number, balanced: number, low: number) => budget.particleScale >= 2 ? high : budget.particleScale >= 1 ? balanced : low;

// ---------------------------------------------------------------- Pole Sparks

const CABLES = 180, PULSES = 64;

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
  const time = uniform(0), hearts = uniform(0.3), hum = uniform(0);
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
  (cableMaterial as unknown as { emissiveNode: THREE.Node }).emissiveNode = mix(vec3(...linearRgb(0xff4fa0)), vec3(...linearRgb(0xffb0e0)), head).mul(glow.mul(3))
    // The whole tangle hums with the bass: a faint pink charge rippling along every cable.
    .add(vec3(...linearRgb(0xff4fa0)).mul(hum.mul(fract(along.mul(3).sub(time.mul(1.5)).add(kind.mul(5))).pow(4).mul(0.6).add(0.05))));
  scene.add(new THREE.Mesh(cables, cableMaterial), outline(cables, 0.018));
  scene.add(new THREE.HemisphereLight(0x9ab0bc, 0x3a2a30, 1.4));
  const sun = new THREE.DirectionalLight(0xffd8c8, 1.2); sun.position.set(-10, 20, 15); scene.add(sun);
  // Spark clusters where pulses arrive at the pole.
  const sparks = createParticles(loadTexture(sparkUrl), 300, { gravity: 6, drag: 1.2 });
  scene.add(sparks.object);
  const live = Array.from({ length: PULSES }, () => ({ cable: -1, at: 0, speed: 1 }));
  const hits = createHits({ decay: 0.3, interval: 0.25 });
  let next = 0, randomSpark = 0, feed = 0, kick = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time; finish.update(frame);
      const step = settleStep(frame);
      hits.update(frame, 0.3);
      // A hit shoots pulses along random cables, from the far end toward the pole: more and faster the harder
      // it hits. Sustained bass keeps feeding extra pulses between hits.
      const launch = (speed: number) => { live[next] = { cable: Math.floor(random() * CABLES), at: 1, speed }; next = (next + 1) % PULSES; };
      if (hits.fired) {
        for (let k = 0, n = 2 + Math.floor(random() * 2 + frame.response.impact * 5); k < n; k++) launch(0.8 + random() * 0.8);
        kick = 1;
      }
      feed += step * frame.response.bass * 8;
      while (feed > 1) { feed--; launch(0.6 + random() * 0.6); }
      pulseData.fill(0);
      for (const p of live) {
        if (p.cable < 0) continue;
        p.at -= step * p.speed * (1 + frame.response.bounce * 1.5);
        if (p.at <= 0) {
          // Arrival: a spark cluster at the junction.
          const anchor = anchors[p.cable];
          for (let s = 0, n = 10 + Math.round(frame.response.loudness * 14); s < n; s++) sparks.emit(anchor.x, anchor.y, anchor.z + 0.3, (random() - 0.5) * 7, random() * 6, (random() - 0.5) * 7, 0.12 + random() * 0.18, 0.3, 2, 0.7, 1.4);
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
      hum.value = approach(hum.value, frame.response.bass * 0.8 + frame.response.loudness * 0.2, step, 0.08);
      // The camera nudges in on each hit and settles back.
      kick *= Math.exp(-step / 0.25);
      const drift = frame.reducedMotion ? 0 : frame.time, push = frame.reducedMotion ? 0 : kick * 1.6 + frame.response.bass * 0.6;
      camera.position.set(5 + Math.sin(drift * 0.05) * 0.8, 1, 22 - push);
      camera.lookAt(2, 13, 0);
    },
    filter: (input) => finish.filter(input),
    dispose() { disposeScene(scene); pulseTexture.dispose(); },
  };
}
