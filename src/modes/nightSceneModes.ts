import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, float, mix, mx_noise_float, normalView, normalWorld, positionLocal, positionWorld, sin, uniform, uv, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import type { QualityBudget } from '../rendering/quality';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { palette } from './shaderModes';
import { createGlowPoints, loadTexture, shaftMaterial } from './figures';
import { lightningPath } from './stormMode';
import { createHits, linearRgb, variantSequence } from './hitPulse';
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
  const time = uniform(0), sway = uniform(0), glow = uniform(0.4), rush = uniform(0), flow = uniform(0), surge = uniform(0);
  scene.background = new THREE.Color(0x0e0e10);
  scene.fog = new THREE.FogExp2(0x0e0e10, 0.07);
  // Dark glass spheres: black body, greyscale studio reflections and a bright fresnel rim.
  const sphereMaterial = new THREE.MeshBasicNodeMaterial();
  const n = normalView, bands = n.y.smoothstep(0.55, 0.75).mul(0.7).add(n.x.smoothstep(0.6, 0.8).mul(0.35)).add(n.y.negate().smoothstep(0.7, 0.9).mul(0.15));
  sphereMaterial.colorNode = vec3(0.02).add(vec3(bands)).add(vec3(n.z.oneMinus().pow(3).mul(0.6)));
  const furMaterial = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  furMaterial.colorNode = vec3(0.8, 0.82, 0.85).mul(glow).mul(0.35);
  const spheres = Array.from({ length: 10 }, (_, i) => {
    const radius = 0.6 + random() * 1.1, mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), sphereMaterial);
    mesh.scale.setScalar(radius);
    mesh.position.set((random() - 0.5) * 9, (random() - 0.5) * 5, -3 - random() * 12 - i);
    // Spiky fur on the first three, in the sphere's own space so it travels with it.
    if (i < 3) {
      const fur: number[] = [];
      for (let k = 0; k < 500; k++) {
        const dir = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(), out = 1.12 + random() * 0.15;
        fur.push(dir.x, dir.y, dir.z, dir.x * out, dir.y * out, dir.z * out);
      }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(fur, 3));
      mesh.add(new THREE.LineSegments(geometry, furMaterial));
    }
    scene.add(mesh);
    return { mesh, radius, base: mesh.position.clone(), velocity: new THREE.Vector3(), phase: random() * 10, pulse: 0 };
  });
  // Fibres: long arcs under tension that sweep past the spheres. Each vertex knows how far along its fibre it is,
  // so light can run down the fibres.
  const fibreSegments = 14, fibrePositions: number[] = [], fibreAlong: number[] = [];
  const point = new THREE.Vector3(), control = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let f = 0; f < fibreCount; f++) {
    const sphere = spheres[f % spheres.length], offset = random();
    a.set((random() - 0.5) * 16, (random() - 0.5) * 10, sphere.base.z + (random() - 0.5) * 6);
    b.set((random() - 0.5) * 16, (random() - 0.5) * 10, sphere.base.z + (random() - 0.5) * 6);
    control.copy(sphere.base).addScaledVector(new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(), sphere.radius * 1.15);
    let previous = a.clone();
    for (let i = 1; i <= fibreSegments; i++) {
      const t = i / fibreSegments;
      point.copy(a).multiplyScalar((1 - t) * (1 - t)).addScaledVector(control, 2 * t * (1 - t)).addScaledVector(b, t * t);
      fibrePositions.push(previous.x, previous.y, previous.z, point.x, point.y, point.z);
      fibreAlong.push((i - 1) / fibreSegments + offset, t + offset);
      previous = point.clone();
    }
  }
  const fibreGeometry = new THREE.BufferGeometry();
  fibreGeometry.setAttribute('position', new THREE.Float32BufferAttribute(fibrePositions, 3));
  fibreGeometry.setAttribute('along', new THREE.Float32BufferAttribute(fibreAlong, 1));
  const fibreMaterial = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  // The fibres ripple in travelling waves, and bright pulses race along them on the music.
  const wave = mx_noise_float(positionLocal.mul(0.35).add(vec3(0, 0, flow))).mul(sway);
  fibreMaterial.positionNode = positionLocal.add(vec3(wave, wave.mul(0.7), wave.mul(0.3)));
  const along = attribute<'float'>('along');
  const runner = along.mul(3).sub(flow.mul(0.8)).fract().sub(0.5).abs().mul(2).oneMinus().pow(18).mul(surge);
  fibreMaterial.colorNode = vec3(0.8, 0.82, 0.85).mul(glow.mul(0.07).add(runner.mul(0.6)));
  const fibres = new THREE.LineSegments(fibreGeometry, fibreMaterial); fibres.frustumCulled = false;
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
  scene.add(fibres, rushLines);
  // Sparkle clusters cling to the spheres and ride with them.
  const sparks = createGlowPoints(loadTexture(sparkUrl), sparkCount);
  const sparkles = Array.from({ length: sparkCount }, (_, i) => {
    const sphere = spheres[i % spheres.length], dir = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
    return { sphere, offset: dir.multiplyScalar(0.3 + random() * 0.9), phase: random() * 10, size: 0.015 + random() * 0.04 };
  });
  scene.add(sparks.object);

  const hits = createHits({ decay: 0.25, interval: 0.3 });
  const goal = new THREE.Vector3();
  let zoom = 0, drift = 0, orbit = 0, streams = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time;
      const step = settleStep(frame), still = frame.reducedMotion, bounce = frame.response.bounce;
      hits.update(frame, 0.4);
      const whip = still ? 0 : hits.level;
      zoom = approach(zoom, whip * 1.5, step, 0.08);
      rush.value = still ? 0 : hits.flash;
      if (!still) { drift += frame.delta * (0.25 + bounce * 0.9); orbit += frame.delta * (0.05 + bounce * 0.12); streams += frame.delta * (0.8 + frame.response.loudness * 3); }
      flow.value = streams;
      surge.value = approach(surge.value, 0.3 + frame.response.loudness * 0.8 + hits.flash * 1.5, step, 0.08);
      sway.value = 0.1 + frame.response.bass * 0.6 + hits.level * 0.4;
      glow.value = 0.35 + frame.response.loudness * 0.5 + hits.flash * 0.6;
      // Spheres drift on their own slow paths; a hit knocks a few of them sideways and they spring back.
      if (hits.fired && !still) for (const sphere of spheres) {
        if (random() < 0.5) { sphere.velocity.add(goal.set(random() - 0.5, random() - 0.5, (random() - 0.5) * 0.5).multiplyScalar(4 + frame.response.impact * 6)); sphere.pulse = 1; }
      }
      for (const sphere of spheres) {
        const t = drift + sphere.phase;
        goal.copy(sphere.base).add(new THREE.Vector3(Math.sin(t * 0.6) * 1.2, Math.cos(t * 0.45) * 0.8, Math.sin(t * 0.33) * 1.2));
        sphere.velocity.addScaledVector(goal.sub(sphere.mesh.position), 6 * step).multiplyScalar(Math.exp(-step * 2.5));
        sphere.mesh.position.addScaledVector(sphere.velocity, step);
        sphere.pulse *= Math.exp(-step / 0.25);
        sphere.mesh.scale.setScalar(sphere.radius * (1 + frame.response.bass * 0.06 + sphere.pulse * 0.12));
      }
      sparkles.forEach((spark, i) => {
        const at = spark.sphere.mesh.position, k = spark.sphere.mesh.scale.x;
        const flicker = Math.max(0, Math.sin(frame.time * (3 + frame.audio.highs * 6) + spark.phase)) * 0.6 + hits.flash * 1.5 + spark.sphere.pulse;
        sparks.set(i, at.x + spark.offset.x * k, at.y + spark.offset.y * k, at.z + spark.offset.z * k, spark.size * (1 + hits.flash * 2), flicker, flicker, flicker, 0.8);
      });
      sparks.commit();
      // The camera circles the cluster slowly, faster when the music drives, and whips forward on hits.
      camera.position.set(Math.sin(orbit) * 2.2, Math.sin(orbit * 0.7) * 0.8, 2 - zoom * 2 + Math.cos(orbit) * 0.8);
      camera.lookAt(Math.sin(orbit * 0.5) * 0.8, 0, -10);
      (camera as THREE.PerspectiveCamera).fov = 65 + zoom * 18; (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    },
    dispose: () => disposeScene(scene),
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
/** What the rings do on a hit, besides advancing the stage: flat stack, gyroscope, tunnel, helix, ripple. */
export const BEACON_ACTIONS = ['stack', 'gyro', 'tunnel', 'helix', 'ripple'] as const;
/** Cave and ring colours: cave tint, inner ring colour, outer ring colour. Changes on a hit every 15 s or so. */
export const BEACON_PALETTES = [
  [0x420804, 0xfff0e0, 0xff4a2a], [0x08143a, 0xe0f4ff, 0x4a6bff], [0x2a0838, 0xffe0f8, 0xc23cff], [0x04302a, 0xe0fff4, 0x2affc0], [0x3a1a04, 0xfff4d0, 0xff8a1a],
] as const;

export function createBeaconRingsMode(budget: QualityBudget): VisualMode {
  const { scene, camera } = sceneDefaults(9);
  const emberCount = tier(budget, 6000, 3000, 1200);
  const random = seededRandom(13);
  const time = uniform(0), heat = uniform(0.5), drift = uniform(0);
  const caveTint = uniform(new THREE.Vector3(...linearRgb(BEACON_PALETTES[0][0])));
  const innerColour = uniform(new THREE.Vector3(...linearRgb(BEACON_PALETTES[0][1]))), outerColour = uniform(new THREE.Vector3(...linearRgb(BEACON_PALETTES[0][2])));
  scene.background = new THREE.Color(0x050101);
  // The cave: the inside of a ridged, displaced sphere, lit from the rings at the centre. The rock flows slowly
  // on its own clock, never on the beat.
  const caveMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  const dir = positionLocal.normalize();
  const ridge = (scale: number) => float(1).sub(mx_noise_float(dir.mul(scale).add(vec3(drift.mul(0.15), 0, drift.mul(0.1)))).abs()).pow(3);
  const rock = ridge(3).mul(0.55).add(ridge(7).mul(0.3)).add(ridge(16).mul(0.15));
  caveMaterial.positionNode = positionLocal.mul(rock.mul(0.35).add(0.8));
  const facing = normalWorld.dot(cameraPosition.sub(positionWorld).normalize()).abs();
  caveMaterial.colorNode = mix(caveTint.mul(0.08), caveTint.mul(1.6), rock.pow(2)).mul(heat.mul(facing.mul(0.5).add(0.5))).mul(1.6);
  const cave = new THREE.Mesh(new THREE.SphereGeometry(30, 160, 100), caveMaterial);
  scene.add(cave);
  // The ring stack: thin glowing tori, each its own colour on a gradient from the inner to the outer ring,
  // with the colour also sliding around each ring.
  const stack = new THREE.Group();
  const rings = Array.from({ length: RINGS }, (_, i) => {
    const level = uniform(1), material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const around = sin(uv().x.mul(Math.PI * 2).add(time.mul(0.8)).add(i * 0.7)).mul(0.5).add(0.5);
    const base = mix(innerColour, outerColour, i / (RINGS - 1));
    material.colorNode = mix(base, mix(outerColour, innerColour, i / (RINGS - 1)), around.mul(0.45)).mul(level).mul(1.6);
    const pivot = new THREE.Group(), mesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 6, 220), material);
    pivot.add(mesh); stack.add(pivot);
    return { pivot, mesh, level, base: (i + 1) / RINGS, tiltX: 0, tiltY: 0, z: 0, x: 0, y: 0, wave: 0 };
  });
  const core = createGlowPoints(loadTexture(emberUrl), 1 + emberCount);
  const embers = Array.from({ length: emberCount }, () => ({ ring: Math.floor(random() * RINGS), angle: random() * Math.PI * 2, jitter: (random() - 0.5) * 0.05, phase: random() * 10 }));
  scene.add(core.object, stack);

  const hits = createHits({ decay: 0.4, interval: 0.5 });
  const actions = variantSequence(BEACON_ACTIONS.length, 7), palettes = variantSequence(BEACON_PALETTES.length, 9);
  const targets = { cave: caveTint.value.clone(), inner: innerColour.value.clone(), outer: outerColour.value.clone() };
  let stage = 0, radius = 0.1, tiltX = 0, tiltZ = 0, stretch = 1, squash = 1, count = 0, spin = 0, action = 0, rippleAge = Infinity, paletteAge = 0, flowClock = 0;
  const wobble = new Float32Array(RINGS), centre = new THREE.Vector3();
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time;
      const step = settleStep(frame), still = frame.reducedMotion;
      hits.update(frame, 0.6);
      // Each impact advances the sequence and picks what the rings do; a quiet spell rewinds to the lone dot.
      if (hits.fired) {
        stage = (stage + 1) % BEACON_STAGES.length;
        action = actions.next(); rippleAge = 0;
        // Every 15 s or so a hit also moves the cave and rings to a new palette.
        if (paletteAge > 15) {
          const next = BEACON_PALETTES[palettes.next()]; paletteAge = 0;
          targets.cave.set(...linearRgb(next[0])); targets.inner.set(...linearRgb(next[1])); targets.outer.set(...linearRgb(next[2]));
        }
      }
      if (hits.age > 6) stage = 0;
      paletteAge += step; rippleAge += step;
      const blend = 1 - Math.exp(-step / 0.6);
      caveTint.value.lerp(targets.cave, blend); innerColour.value.lerp(targets.inner, blend); outerColour.value.lerp(targets.outer, blend);
      // The background turns and flows slowly, at its own pace.
      flowClock += still ? 0 : frame.delta;
      drift.value = flowClock; cave.rotation.y = flowClock * 0.01; cave.rotation.x = Math.sin(flowClock * 0.007) * 0.2;
      const target = BEACON_STAGES[stage];
      tiltX = approach(tiltX, target.tiltX, step, still ? 0.6 : 0.08); tiltZ = approach(tiltZ, target.tiltZ, step, still ? 0.6 : 0.08);
      radius = approach(radius, target.radius * (0.85 + frame.response.bass * 0.45), step, 0.2);
      stretch = approach(stretch, target.stretch, step, 0.3); squash = approach(squash, target.squash, step, 0.3);
      count = approach(count, target.rings, step, 0.4);
      if (!still) spin += frame.delta * (0.2 + frame.response.bounce * 0.8);
      stack.rotation.set(tiltX, spin * 0.15, tiltZ);
      stack.scale.set(stretch, 1, squash);
      const kind = BEACON_ACTIONS[action];
      rings.forEach((ring, i) => {
        const shown = i < Math.round(count) || (i === 0 && count > 0.3), u = i / (RINGS - 1);
        wobble[i] = approach(wobble[i], (frame.audio.spectrum[4 + i * 8] ?? 0) / 255, step, 0.08);
        // Per-ring targets for the current action; every ring eases toward them on its own.
        const gyro = kind === 'gyro' ? 1 : 0, tunnel = kind === 'tunnel' ? 1 : 0, helix = kind === 'helix' ? 1 : 0;
        ring.tiltX = approach(ring.tiltX, gyro * Math.sin(spin * 2 + i * 0.9) * 0.9, step, 0.15);
        ring.tiltY = approach(ring.tiltY, gyro * Math.cos(spin * 1.6 + i * 1.3) * 0.9, step, 0.15);
        ring.z = approach(ring.z, (tunnel * (u - 0.5) * 6 + helix * Math.sin(i * 0.8 + spin) * 0.6) * radius, step, 0.2);
        ring.x = approach(ring.x, helix * Math.cos(i * 0.8 + spin) * 0.4 * radius, step, 0.2);
        ring.y = approach(ring.y, helix * Math.sin(i * 0.8 + spin) * 0.4 * radius, step, 0.2);
        // Ripple: a pulse runs out from the inner ring to the outer one after each hit.
        ring.wave = Math.exp(-Math.pow((rippleAge * 3 - u) * 4, 2)) * (kind === 'ripple' ? 1.4 : 0.6);
        ring.pivot.position.set(ring.x, ring.y, ring.z); ring.pivot.rotation.set(ring.tiltX, ring.tiltY, 0);
        ring.mesh.visible = shown;
        ring.mesh.scale.setScalar(radius * ring.base * (1 + wobble[i] * 0.1 + ring.wave * 0.12));
        ring.level.value = 0.5 + frame.response.bass * 0.8 + hits.flash * 0.6 + ring.wave * (frame.reducedFlash ? 0.5 : 1.2);
      });
      heat.value = approach(heat.value, 0.25 + frame.response.loudness * 0.6 + hits.flash * 0.4, step, 0.2);
      // The centre dot, then embers riding the visible rings.
      const dot = 0.25 + (stage === 0 ? 0.4 : 0.15) + hits.flash * 0.3;
      core.set(0, 0, 0, 0, dot, 2, 0.5, 0.35, 1);
      const density = 0.3 + frame.response.loudness * 0.7;
      stack.updateMatrixWorld();
      embers.forEach((ember, i) => {
        const ring = rings[ember.ring], on = ring.mesh.visible && i / emberCount < density;
        const a = ember.angle + frame.time * 0.1;
        centre.set(Math.cos(a) * (1 + ember.jitter), Math.sin(a) * (1 + ember.jitter), ember.jitter);
        ring.mesh.localToWorld(centre);
        const twinkle = 0.5 + 0.5 * Math.sin(frame.time * 4 + ember.phase), c = innerColour.value;
        core.set(i + 1, centre.x, centre.y, centre.z, on ? 0.03 : 0, (0.6 + c.x) * twinkle, (0.3 + c.y * 0.5) * twinkle, (0.2 + c.z * 0.5) * twinkle, 1);
      });
      core.commit();
      camera.position.set(Math.sin(frame.time * 0.04) * 1.2, 0.4, 9);
      camera.lookAt(0, 0, 0);
    },
    dispose: () => disposeScene(scene),
  };
}
