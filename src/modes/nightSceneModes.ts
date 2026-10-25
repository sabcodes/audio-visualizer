import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, float, mix, mx_noise_float, normalView, normalWorld, positionLocal, positionWorld, sin, uniform, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import type { QualityBudget } from '../rendering/quality';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { palette } from './shaderModes';
import { createGlowPoints, loadTexture, shaftMaterial } from './figures';
import { lightningPath } from './stormMode';
import { createHits } from './hitPulse';
import { seededRandom } from '../rendering/diagnostics';
import sparkUrl from '../assets/fx/spark.png?url';
import emberUrl from '../assets/fx/ember.png?url';

const tier = (budget: QualityBudget, high: number, balanced: number, low: number) => budget.particleScale >= 2 ? high : budget.particleScale >= 1 ? balanced : low;

/** A soft bokeh disc with a slightly brighter rim, like an out-of-focus light. */
export function bokehTexture(size = 64) {
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const d = Math.hypot((i + 0.5) / size * 2 - 1, (j + 0.5) / size * 2 - 1);
    const disc = Math.min(1, Math.max(0, (1 - d) * 12)) * (0.7 + 0.3 * Math.min(1, Math.max(0, (d - 0.75) * 6)));
    data.set([255, 255, 255, Math.round(disc * 255)], (j * size + i) * 4);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
}

// ---------------------------------------------------------------- Silk Threads

const SILK_SEGMENTS = 64, BOLT_SEGMENTS = 512;

export function createSilkThreadsMode(budget: QualityBudget): VisualMode {
  const { scene, camera } = sceneDefaults(7);
  const strands = tier(budget, 800, 500, 250), dustCount = tier(budget, 3000, 1500, 600);
  const time = uniform(0), brightness = uniform(0.2), thickness = uniform(0.5), drift = uniform(0);
  // Each strand is a column of segments; its path is bent through a flowing noise field in the vertex stage.
  const seeds = new Float32Array(strands * (SILK_SEGMENTS - 1) * 2), along = new Float32Array(strands * (SILK_SEGMENTS - 1) * 2);
  const random = seededRandom(3);
  for (let s = 0, k = 0; s < strands; s++) {
    const seed = random() * 100;
    for (let i = 0; i < SILK_SEGMENTS - 1; i++, k += 2) { seeds[k] = seeds[k + 1] = seed; along[k] = i / (SILK_SEGMENTS - 1); along[k + 1] = (i + 1) / (SILK_SEGMENTS - 1); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(seeds.length * 3), 3));
  geometry.setAttribute('strand', new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute('along', new THREE.BufferAttribute(along, 1));
  const seed = attribute<'float'>('strand'), t = attribute<'float'>('along');
  const start = sin(seed.mul(12.9)).mul(0.5).add(0.5), length = sin(seed.mul(7.3)).mul(0.5).add(0.5).mul(2.5).add(1.5);
  const y = float(3.2).sub(start.mul(3)).sub(t.mul(length));
  const bend = (offset: number) => mx_noise_float(vec3(seed.add(offset), y.mul(0.55), time.mul(0.08).add(drift)));
  const silkMaterial = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  silkMaterial.positionNode = vec3(sin(seed.mul(3.1)).mul(1.4).add(bend(0).mul(2.2)), y, bend(40).mul(1.6));
  const hue = palette(seed.mul(0.37).add(t.mul(0.8)).add(time.mul(0.03)));
  silkMaterial.colorNode = mix(vec3(0.5, 0.56, 1), hue, 0.7).mul(brightness).mul(sin(t.mul(Math.PI)).mul(thickness).add(0.15)).mul(0.22);
  const silk = new THREE.LineSegments(geometry, silkMaterial); silk.frustumCulled = false;
  // The lightning thread: a jagged white channel down the column, with tinted copies for the rainbow fringe.
  const bolts = [[1, 1, 1, 0], [0.2, 0.9, 1, 0.025], [1, 0.25, 0.9, -0.025]].map(([r, g, b, shift]) => {
    const boltGeometry = new THREE.BufferGeometry();
    boltGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOLT_SEGMENTS * 6), 3));
    const material = new THREE.LineBasicNodeMaterial({ color: new THREE.Color(r, g, b), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const line = new THREE.LineSegments(boltGeometry, material); line.frustumCulled = false; line.position.x = shift; line.visible = false;
    return line;
  });
  const dust = createGlowPoints(loadTexture(sparkUrl), dustCount);
  const motes = Array.from({ length: dustCount }, () => ({ x: (random() - 0.5) * 5, y: (random() - 0.5) * 7, z: (random() - 0.5) * 3, phase: random() * 10, size: 0.02 + random() * 0.05 }));
  scene.add(silk, ...bolts, dust.object);
  scene.background = new THREE.Color(0x010103);

  const hits = createHits({ decay: 0.18, interval: 0.25 });
  const top = new THREE.Vector3(), bottom = new THREE.Vector3(), path = new Float32Array(BOLT_SEGMENTS * 6);
  let flow = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time;
      hits.update(frame, 0.15);
      if (hits.fired) {
        top.set((random() - 0.5) * 1.2, 3.6, 0); bottom.set((random() - 0.5) * 1.6, -3.6, 0);
        const count = lightningPath(top, bottom, random, path, 6);
        for (const bolt of bolts) {
          const position = bolt.geometry.getAttribute('position') as THREE.BufferAttribute;
          // Scale the storm helper's 3–6 unit fork steps down to this column's size.
          for (let i = 0; i < count * 6; i += 3) position.setXYZ(i / 3, path[i], path[i + 1], path[i + 2] * 0.2);
          position.needsUpdate = true; bolt.geometry.setDrawRange(0, count * 2);
        }
      }
      bolts.forEach((bolt, i) => { (bolt.material as THREE.LineBasicNodeMaterial).opacity = hits.flash * (i ? 0.7 : 1); bolt.visible = hits.count > 0 && hits.flash > 0.01; });
      if (!frame.reducedMotion) flow += frame.delta * (0.1 + frame.response.bass * 0.3);
      drift.value = flow;
      brightness.value = hits.floor + frame.response.bass * 0.3 + hits.flash * 1.2;
      thickness.value = 0.4 + frame.response.loudness * 0.8;
      for (let i = 0; i < dustCount; i++) {
        const mote = motes[i], twinkle = Math.max(0, Math.sin(frame.time * (1.5 + frame.audio.highs * 4) + mote.phase));
        const burst = hits.flash * Math.exp(-Math.hypot(mote.x, mote.y) * 0.5);
        dust.set(i, mote.x, mote.y + Math.sin(frame.time * 0.1 + mote.phase) * 0.1, mote.z, mote.size * (1 + burst * 2), 0.8 * twinkle + burst, 0.85 * twinkle + burst, twinkle + burst, 0.6);
      }
      dust.commit();
      camera.position.set(Math.sin(frame.time * 0.05) * 0.4, 0, 7);
      camera.lookAt(0, 0, 0);
    },
    dispose: () => disposeScene(scene),
  };
}

// ---------------------------------------------------------------- Chrome Streaks

export function createChromeStreaksMode(budget: QualityBudget): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  const fibreCount = tier(budget, 1500, 900, 400), sparkCount = tier(budget, 4000, 2000, 800);
  const random = seededRandom(19);
  const time = uniform(0), sway = uniform(0), glow = uniform(0.4), rush = uniform(0);
  scene.background = new THREE.Color(0x0e0e10);
  scene.fog = new THREE.FogExp2(0x0e0e10, 0.07);
  // Dark glass spheres: black body, greyscale studio reflections and a bright fresnel rim.
  const sphereMaterial = new THREE.MeshBasicNodeMaterial();
  const n = normalView, bands = n.y.smoothstep(0.55, 0.75).mul(0.7).add(n.x.smoothstep(0.6, 0.8).mul(0.35)).add(n.y.negate().smoothstep(0.7, 0.9).mul(0.15));
  sphereMaterial.colorNode = vec3(0.02).add(vec3(bands)).add(vec3(n.z.oneMinus().pow(3).mul(0.6)));
  const spheres = Array.from({ length: 10 }, (_, i) => {
    const radius = 0.6 + random() * 1.1, mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), sphereMaterial);
    mesh.scale.setScalar(radius);
    mesh.position.set((random() - 0.5) * 9, (random() - 0.5) * 5, -3 - random() * 12 - i);
    scene.add(mesh);
    return { mesh, radius, base: mesh.position.clone() };
  });
  // Fibres: long arcs under tension that sweep past the spheres; a few spheres also grow spiky fur.
  const fibreSegments = 14, fibrePositions: number[] = [], furPositions: number[] = [];
  const point = new THREE.Vector3(), control = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let f = 0; f < fibreCount; f++) {
    const sphere = spheres[f % spheres.length];
    a.set((random() - 0.5) * 16, (random() - 0.5) * 10, sphere.base.z + (random() - 0.5) * 6);
    b.set((random() - 0.5) * 16, (random() - 0.5) * 10, sphere.base.z + (random() - 0.5) * 6);
    control.copy(sphere.base).addScaledVector(new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(), sphere.radius * 1.15);
    let previous = a.clone();
    for (let i = 1; i <= fibreSegments; i++) {
      const t = i / fibreSegments;
      point.copy(a).multiplyScalar((1 - t) * (1 - t)).addScaledVector(control, 2 * t * (1 - t)).addScaledVector(b, t * t);
      fibrePositions.push(previous.x, previous.y, previous.z, point.x, point.y, point.z);
      previous = point.clone();
    }
  }
  for (const sphere of spheres.slice(0, 3)) for (let k = 0; k < 500; k++) {
    const dir = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
    a.copy(sphere.base).addScaledVector(dir, sphere.radius); b.copy(sphere.base).addScaledVector(dir, sphere.radius * (1.12 + random() * 0.15));
    furPositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const lineMaterial = (opacity: number) => {
    const material = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const wobble = mx_noise_float(positionLocal.mul(0.4).add(vec3(0, 0, time.mul(0.3)))).mul(sway);
    material.positionNode = positionLocal.add(vec3(wobble, wobble.mul(0.6), 0));
    material.colorNode = vec3(0.8, 0.82, 0.85).mul(glow).mul(opacity);
    return material;
  };
  const lines = (positions: number[], opacity: number) => {
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const object = new THREE.LineSegments(geometry, lineMaterial(opacity)); object.frustumCulled = false; return object;
  };
  // The rush: streak lines pointing down the view axis, stretched hard while the camera whips forward.
  const rushPositions: number[] = [];
  for (let i = 0; i < 700; i++) {
    const angle = random() * Math.PI * 2, r = 0.6 + random() * 6, z = -2 - random() * 30;
    rushPositions.push(Math.cos(angle) * r, Math.sin(angle) * r, z, Math.cos(angle) * r, Math.sin(angle) * r, z - 0.05);
  }
  const rushGeometry = new THREE.BufferGeometry(); rushGeometry.setAttribute('position', new THREE.Float32BufferAttribute(rushPositions, 3));
  const rushMaterial = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  // Each streak's far end is pulled back along z in proportion to the rush, so a hit draws long white lines.
  rushMaterial.positionNode = positionLocal.add(vec3(0, 0, positionLocal.z.fract().lessThan(0.5).select(float(0), float(-1)).mul(rush).mul(8)));
  rushMaterial.colorNode = vec3(1).mul(rush);
  const rushLines = new THREE.LineSegments(rushGeometry, rushMaterial); rushLines.frustumCulled = false;
  scene.add(lines(fibrePositions, 0.07), lines(furPositions, 0.35), rushLines);
  // Sparkle clusters cling to the spheres.
  const sparks = createGlowPoints(loadTexture(sparkUrl), sparkCount);
  const sparkles = Array.from({ length: sparkCount }, (_, i) => {
    const sphere = spheres[i % spheres.length], dir = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
    return { at: sphere.base.clone().addScaledVector(dir, sphere.radius * (0.3 + random() * 0.9)), phase: random() * 10, size: 0.015 + random() * 0.04 };
  });
  scene.add(sparks.object);

  const hits = createHits({ decay: 0.25, interval: 0.35 });
  let zoom = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time;
      const step = settleStep(frame);
      hits.update(frame, 0.4);
      const whip = frame.reducedMotion ? 0 : hits.flash;
      zoom = approach(zoom, whip * 1.5, step, 0.08);
      rush.value = whip;
      sway.value = 0.05 + frame.response.bass * 0.25;
      glow.value = 0.35 + frame.response.loudness * 0.5 + hits.flash * 0.6;
      for (const sphere of spheres) sphere.mesh.scale.setScalar(sphere.radius * (1 + frame.response.bass * 0.08));
      sparkles.forEach((spark, i) => {
        const flicker = Math.max(0, Math.sin(frame.time * 3 + spark.phase)) * 0.6 + hits.flash * 1.5;
        sparks.set(i, spark.at.x, spark.at.y, spark.at.z, spark.size * (1 + hits.flash * 2), flicker, flicker, flicker, 0.8);
      });
      sparks.commit();
      camera.position.set(Math.sin(frame.time * 0.07) * 0.6, Math.cos(frame.time * 0.05) * 0.3, 2 - zoom * 2);
      camera.lookAt(0, 0, -10);
      (camera as THREE.PerspectiveCamera).fov = 65 + zoom * 18; (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    },
    dispose: () => disposeScene(scene),
  };
}

// ---------------------------------------------------------------- Signal Night

/** Signal Night hit variants: beam colours (hex) and the street grade. */
export const SIGNAL_VARIANTS = [
  { beams: [0x7cff4a, 0x7cff4a, 0x7cff4a], grade: 0x0f2630 },
  { beams: [0xffb02e, 0xff3a2a, 0xffb02e], grade: 0x0f2630 },
  { beams: [0xfff0dc, 0xfff0dc, 0xfff0dc], grade: 0x12262c },
  { beams: [0xff3a2a, 0xff3a2a, 0xffb02e], grade: 0x2a0a0a },
  { beams: [0x7cff4a, 0xfff0dc, 0x6fa8ff], grade: 0x0a2236 },
] as const;
const BEAMS = 5, SMEAR = 3;

export function createSignalNightMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  const time = uniform(0), grade = new THREE.Color(0x0f2630);
  scene.background = grade.clone();
  scene.fog = new THREE.Fog(0x0f2630, 6, 40);
  const random = seededRandom(77);
  // Traffic signals hanging on cables, in soft focus behind the beams.
  const housing = new THREE.MeshStandardNodeMaterial({ color: 0x15181a, roughness: 0.8 });
  const lensMaterials = [0x5a1812, 0x5a3a12, 0x123a1a].map((hex) => new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(hex) }));
  const cablePoints: number[] = [];
  for (let s = 0; s < 6; s++) {
    const x = (s - 2.5) * 3.2 + (random() - 0.5), y = 2.5 + random() * 2.5, z = -8 - random() * 10;
    const head = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.3, 0.35), housing);
    head.add(box);
    for (let l = 0; l < 3; l++) { const lens = new THREE.Mesh(new THREE.CircleGeometry(0.13, 20), lensMaterials[l]); lens.position.set(0, 0.4 - l * 0.4, 0.18); head.add(lens); }
    head.position.set(x, y, z); head.rotation.y = (random() - 0.5) * 0.6;
    scene.add(head);
    // Catenary cable from the head out to the side of the frame.
    const end = x + (random() < 0.5 ? -8 : 8);
    for (let i = 0; i < 16; i++) {
      const t0 = i / 16, t1 = (i + 1) / 16, sag = (t: number) => y + 0.65 + 1.4 * (t - 0.5) ** 2 * 4 - 1.4 + 0.6 * t;
      cablePoints.push(x + (end - x) * t0, sag(t0), z, x + (end - x) * t1, sag(t1), z);
    }
  }
  const cableGeometry = new THREE.BufferGeometry(); cableGeometry.setAttribute('position', new THREE.Float32BufferAttribute(cablePoints, 3));
  scene.add(new THREE.LineSegments(cableGeometry, new THREE.LineBasicNodeMaterial({ color: 0x0a1416 })));
  scene.add(new THREE.HemisphereLight(0x3a6a78, 0x050808, 0.6));
  // Bokeh: out-of-focus street and traffic lights.
  const bokehMap = bokehTexture(), bokeh = createGlowPoints(bokehMap, 70);
  const lights = Array.from({ length: 70 }, () => ({ x: (random() - 0.5) * 30, y: -3 + random() * 9, z: -12 - random() * 20, size: 0.8 + random() * 1.8, hue: random() }));
  scene.add(bokeh.object);
  // Moving-head beams from above the frame; each draws faint copies at its recent angles for the motion smear.
  const beams = Array.from({ length: BEAMS }, (_, i) => {
    const pivot = new THREE.Group(); pivot.position.set((i - (BEAMS - 1) / 2) * 3.4, 9, -10);
    const copies = Array.from({ length: SMEAR }, (_, k) => {
      const material = shaftMaterial(time); material.opacity = 1 - k * 0.3;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 2.2, 24, 24, 1, true).translate(0, -12, 0), material);
      const holder = new THREE.Group(); holder.add(shaft); pivot.add(holder);
      return { holder, material };
    });
    scene.add(pivot);
    return { pivot, copies, history: [0, 0, 0], phase: random() * Math.PI * 2 };
  });

  const hits = createHits({ decay: 0.2, interval: 0.3, variants: SIGNAL_VARIANTS.length, seed: 41 });
  const colour = new THREE.Color(), target = new THREE.Color();
  let shake = 0, sweep = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time;
      const step = settleStep(frame), still = frame.reducedMotion;
      hits.update(frame, 0.2);
      const look = SIGNAL_VARIANTS[hits.variant];
      // Hard cut to the new grade on a hit.
      if (hits.fired || frame.time < 0.1) {
        grade.set(look.grade); (scene.background as THREE.Color).copy(grade); (scene.fog as THREE.Fog).color.copy(grade);
      }
      if (!still) sweep += frame.delta * (0.8 + frame.response.bass * 1.6 + hits.flash * 3);
      beams.forEach((beam, i) => {
        const angle = Math.sin(sweep + beam.phase) * 0.9;
        beam.history.unshift(angle); beam.history.length = SMEAR;
        target.set(look.beams[i % look.beams.length]);
        beam.copies.forEach(({ holder, material }, k) => {
          holder.rotation.z = beam.history[k] ?? angle;
          material.color.copy(colour.copy(target).multiplyScalar((hits.floor * 1.2 + hits.flash * 0.9 + frame.response.bass * 0.2) * (1 - k * 0.32)));
        });
      });
      lights.forEach((light, i) => {
        colour.setHSL(light.hue < 0.5 ? 0.08 : light.hue < 0.8 ? 0.0 : 0.33, 0.8, 0.5).multiplyScalar(0.25 + frame.response.loudness * 0.6);
        bokeh.set(i, light.x, light.y, light.z, light.size, colour.r, colour.g, colour.b, 0.8);
      });
      bokeh.commit();
      // Handheld shake: about 8 Hz, harder with the bass.
      shake = approach(shake, still ? 0 : 0.03 + frame.response.bass * 0.12, step, 0.1);
      camera.position.set(Math.sin(frame.time * 51) * shake, 1.5 + Math.sin(frame.time * 47 + 1) * shake, 6);
      camera.lookAt(0, 3, -10);
    },
    dispose() { disposeScene(scene); bokehMap.dispose(); },
  };
}

// ---------------------------------------------------------------- Beacon Rings

/** The ring sequence each impact advances: visible ring count, radius, tilt (x, z), stretch and squash. */
export const BEACON_STAGES = [
  { rings: 0, radius: 0.1, tiltX: 0, tiltZ: 0, stretch: 1, squash: 1 },
  { rings: 1, radius: 0.5, tiltX: 0.5, tiltZ: 0.4, stretch: 1, squash: 1 },
  { rings: 12, radius: 1.6, tiltX: 0.9, tiltZ: -0.2, stretch: 1, squash: 1 },
  { rings: 12, radius: 2.2, tiltX: 1.25, tiltZ: 0.35, stretch: 2.6, squash: 0.45 },
  { rings: 12, radius: 2, tiltX: 1.45, tiltZ: -0.3, stretch: 3.4, squash: 0.08 },
  { rings: 12, radius: 1.4, tiltX: 0.3, tiltZ: 1.1, stretch: 1, squash: 1 },
] as const;
const RINGS = 12;

export function createBeaconRingsMode(budget: QualityBudget): VisualMode {
  const { scene, camera } = sceneDefaults(9);
  const emberCount = tier(budget, 6000, 3000, 1200);
  const random = seededRandom(13);
  const time = uniform(0), heat = uniform(0.5);
  scene.background = new THREE.Color(0x050101);
  // The cave: the inside of a ridged, displaced sphere, lit red from the rings at the centre.
  const caveMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  const dir = positionLocal.normalize();
  const ridge = (scale: number) => float(1).sub(mx_noise_float(dir.mul(scale)).abs()).pow(3);
  const rock = ridge(3).mul(0.55).add(ridge(7).mul(0.3)).add(ridge(16).mul(0.15));
  caveMaterial.positionNode = positionLocal.mul(rock.mul(0.35).add(0.8));
  const facing = normalWorld.dot(cameraPosition.sub(positionWorld).normalize()).abs();
  caveMaterial.colorNode = mix(vec3(0.02, 0.003, 0.002), vec3(0.26, 0.03, 0.01), rock.pow(2)).mul(heat.mul(facing.mul(0.5).add(0.5))).mul(1.6);
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(30, 160, 100), caveMaterial));
  // The ring stack: thin glowing tori with a white-hot core colour so bloom picks them up.
  const stack = new THREE.Group();
  const ringMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const glowLevel = uniform(1);
  ringMaterial.colorNode = mix(vec3(1, 0.42, 0.29), vec3(1, 0.91, 0.85), 0.35).mul(glowLevel).mul(1.6);
  const rings = Array.from({ length: RINGS }, (_, i) => {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 6, 220), ringMaterial);
    stack.add(mesh);
    return { mesh, base: (i + 1) / RINGS };
  });
  const core = createGlowPoints(loadTexture(emberUrl), 1 + emberCount);
  const embers = Array.from({ length: emberCount }, () => ({ ring: Math.floor(random() * RINGS), angle: random() * Math.PI * 2, jitter: (random() - 0.5) * 0.05, phase: random() * 10 }));
  stack.add(core.object);
  scene.add(stack);

  const hits = createHits({ decay: 0.4, interval: 0.6 });
  let stage = 0, radius = 0.1, tiltX = 0, tiltZ = 0, stretch = 1, squash = 1, count = 0, spin = 0;
  const wobble = new Float32Array(RINGS);
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time;
      const step = settleStep(frame);
      hits.update(frame, 0.6);
      // Each impact advances the sequence; a quiet spell rewinds it to the lone dot.
      if (hits.fired) stage = (stage + 1) % BEACON_STAGES.length;
      if (hits.age > 6) stage = 0;
      const target = BEACON_STAGES[stage];
      // The tilt snaps to its new orientation; size and stretch ease in.
      tiltX = approach(tiltX, target.tiltX, step, frame.reducedMotion ? 0.6 : 0.08); tiltZ = approach(tiltZ, target.tiltZ, step, frame.reducedMotion ? 0.6 : 0.08);
      radius = approach(radius, target.radius * (0.85 + frame.response.bass * 0.35), step, 0.25);
      stretch = approach(stretch, target.stretch, step, 0.3); squash = approach(squash, target.squash, step, 0.3);
      count = approach(count, target.rings, step, 0.4);
      if (!frame.reducedMotion) spin += frame.delta * (0.2 + frame.response.bass * 0.6);
      stack.rotation.set(tiltX, spin * 0.15, tiltZ);
      stack.scale.set(stretch, 1, squash);
      rings.forEach((ring, i) => {
        const shown = i < Math.round(count) || (i === 0 && count > 0.3);
        wobble[i] = approach(wobble[i], (frame.audio.spectrum[4 + i * 8] ?? 0) / 255, step, 0.08);
        ring.mesh.visible = shown;
        ring.mesh.scale.setScalar(radius * ring.base * (1 + wobble[i] * 0.06));
      });
      glowLevel.value = 0.5 + frame.response.bass * 0.8 + hits.flash * 0.8;
      heat.value = approach(heat.value, 0.25 + frame.response.loudness * 0.6 + hits.flash * 0.4, step, 0.2);
      // The centre dot, then embers riding the visible rings.
      const dot = 0.25 + (stage === 0 ? 0.4 : 0.15) + hits.flash * 0.3;
      core.set(0, 0, 0, 0, dot, 2, 0.5, 0.35, 1);
      const density = 0.3 + frame.response.loudness * 0.7;
      embers.forEach((ember, i) => {
        const ring = rings[ember.ring], on = ring.mesh.visible && i / emberCount < density;
        const r = ring.mesh.scale.x * (1 + ember.jitter), a = ember.angle + frame.time * 0.1;
        const twinkle = 0.5 + 0.5 * Math.sin(frame.time * 4 + ember.phase);
        core.set(i + 1, Math.cos(a) * r, Math.sin(a) * r, ember.jitter, on ? 0.03 : 0, 1.6 * twinkle, 0.8 * twinkle, 0.55 * twinkle, 1);
      });
      core.commit();
      camera.position.set(Math.sin(frame.time * 0.04) * 1.2, 0.4, 9);
      camera.lookAt(0, 0, 0);
    },
    dispose: () => disposeScene(scene),
  };
}

