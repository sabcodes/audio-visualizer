import * as THREE from 'three/webgpu';
import { float, mx_fractal_noise_float, mx_noise_float, positionLocal, positionWorld, uniform, uniformArray, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import type { QualityBudget } from '../rendering/quality';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { createGlowPoints, createParticles, loadTexture, shaftMaterial, whenLoaded } from './figures';
import { kitPieces, shadowSwitch } from './kitModes';
import { createCinematic } from './cinematic';
import { createHits, linearRgb } from './hitPulse';
import { seededRandom } from '../rendering/diagnostics';
import kitAUrl from '../assets/wave4/kitA.glb?url';
import kitBUrl from '../assets/wave4/kitB.glb?url';
import kitHUrl from '../assets/wave4/kitH.glb?url';
import sparkUrl from '../assets/fx/spark.png?url';
import emberUrl from '../assets/fx/ember.png?url';

const tier = (budget: QualityBudget, high: number, balanced: number, low: number) => budget.particleScale >= 2 ? high : budget.particleScale >= 1 ? balanced : low;
const place = (object: THREE.Object3D, x: number, y: number, z: number, turn = 0) => { object.position.set(x, y, z); object.rotation.y = turn; return object; };
const shadowed = (root: THREE.Object3D) => root.traverse((object) => { const mesh = object as THREE.Mesh; if (mesh.isMesh) mesh.castShadow = mesh.receiveShadow = true; });
/** Dark worn metal for the pipes and tubes the kits don't model. */
const pipeMaterial = () => {
  const material = new THREE.MeshStandardNodeMaterial({ metalness: 0.75, roughness: 0.45 });
  const wear = mx_fractal_noise_float(positionWorld.mul(1.7), 3, 2, 0.5).mul(0.5).add(0.5);
  material.colorNode = vec3(0.09, 0.085, 0.08).mul(wear.mul(0.7).add(0.5));
  material.roughnessNode = float(0.35).add(wear.mul(0.4));
  return material;
};

// ---------------------------------------------------------------- Red Stairwell

export function createRedStairwellMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).fov = 70;
  const time = uniform(0), finish = createCinematic({ grain: 0.09, halation: 0.5, vignette: 0.7, soften: 0.3, aberration: 0.004, shadows: [0.01, 0.0, 0.0] });
  scene.background = new THREE.Color(0x050202);
  scene.fog = new THREE.FogExp2(0x200403, 0.07);
  const tower = new THREE.Group(); scene.add(tower);
  // Big diagonal pipes cross the stairwell.
  const pipes = pipeMaterial();
  for (const [x, y, z, rx, rz, r] of [[-1, 5, -2.6, 0, 0.7, 0.35], [2.5, 8, -2.2, 0.2, -0.9, 0.25], [0, 2, 1.8, 0.3, 1.1, 0.18], [-2.5, 10, 0.5, -0.2, 0.5, 0.3]] as const) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 16, 24), pipes);
    pipe.position.set(x, y, z); pipe.rotation.set(rx, 0, rz); pipe.castShadow = pipe.receiveShadow = true;
    tower.add(pipe);
  }
  // Hot red windows: the light pours through them and flares on each hit.
  const windowGlow = new THREE.MeshBasicNodeMaterial({ color: 0xff3a1a });
  const key = new THREE.SpotLight(0xff2a10, 0, 30, 0.9, 0.5, 1.2);
  key.position.set(5, 9, -3.5); key.target.position.set(-1, 3, 0); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0005;
  const low = new THREE.PointLight(0xe0140c, 0, 16, 1.5); low.position.set(-2, 2, 1);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 3, 12, 24, 1, true).translate(0, -6, 0), shaftMaterial(time));
  beam.position.copy(key.position); beam.lookAt(key.target.position); beam.rotateX(-Math.PI / 2);
  scene.add(key, key.target, low, beam);
  const model = whenLoaded([kitAUrl], ([gltf]) => {
    const kit = kitPieces(gltf);
    // A switchback stair tower: flights alternate direction, a landing at each turn.
    for (let level = 0; level < 5; level++) {
      const y = level * 3, flip = level % 2 ? Math.PI : 0;
      tower.add(place(kit.piece('stair_flight'), 0, y, 0, flip));
      tower.add(place(kit.piece('stair_landing'), level % 2 ? -3.5 : 3.5, y, 0));
      tower.add(place(kit.piece(level % 2 ? 'wall_window' : 'wall_pipes'), 0, y, -3.4), place(kit.piece('wall_plain'), level % 2 ? 4 : -4, y, -3.4));
      tower.add(place(kit.piece('girder_straight'), 0, y + 3.8, -1.5), place(kit.piece('catwalk_grate'), 0, y + 3.9, 2.6));
      const window = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.5), windowGlow); window.position.set(0, y + 2, -3.6); tower.add(window);
    }
    shadowed(tower);
  });
  const shadows = shadowSwitch();
  const hits = createHits({ decay: 0.12, interval: 0.4 });
  let along = 0, shake = 0;
  return {
    scene, camera,
    ready: model.ready,
    simulate: shadows.simulate,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time; finish.update(frame);
      const step = settleStep(frame), still = frame.reducedMotion;
      hits.update(frame, 0.03);
      // Strobe between near-black and saturated red.
      const strobe = hits.gain, bass = frame.response.bass;
      key.intensity = strobe * 900 + bass * 80; low.intensity = strobe * 60 + bass * 10;
      windowGlow.color.setRGB(...linearRgb(0xff3a1a)).multiplyScalar(0.3 + strobe * 4);
      (beam.material as THREE.MeshBasicNodeMaterial).color.setRGB(1, 0.1, 0.03).multiplyScalar(strobe * 0.4);
      (scene.fog as THREE.FogExp2).color.setRGB(0.12, 0.012, 0.008).multiplyScalar(0.08 + strobe * 0.9);
      // The camera drifts up the stairwell, tilted and shaky.
      if (!still) along = (along + frame.delta * (0.25 + frame.response.loudness * 0.8)) % 12;
      shake = approach(shake, still ? 0 : 0.02 + bass * 0.08 + hits.flash * 0.05, step, 0.08);
      const t = frame.time;
      camera.position.set(Math.sin(along * 0.5) * 2.5 + Math.sin(t * 43) * shake, 1.8 + along + Math.sin(t * 37) * shake, 5.5);
      camera.lookAt(Math.sin(along * 0.5 + 0.6) * 1.5, 3 + along, -2);
      if (!still) camera.rotateZ(Math.sin(t * 0.3) * 0.26);
    },
    filter: (input) => finish.filter(input),
    dispose() { model.dispose(); shadows.dispose(); disposeScene(scene); },
  };
}

// ---------------------------------------------------------------- Underground

/** Camera set-ups the hits cut between: position, look target, roll, and a slow drift (m/s) while the shot holds. */
export const UNDERGROUND_ANGLES = [
  { at: [3, 3, 4.5], look: [-10, 3, 0], roll: 0, drift: [-0.4, 0, 0] },
  { at: [-2, 3.2, 5], look: [12, 3, 0], roll: Math.PI / 2, drift: [0.3, 0, 0] },
  { at: [8, 3, 3], look: [-8, 2.5, -1], roll: Math.PI, drift: [0, 0.2, 0] },
  { at: [16, 6, 6], look: [16, 3, -2], roll: -Math.PI / 2, drift: [0, 0, -0.5] },
  // Straight through a hatch at the passing carriage.
  { at: [0, 3, 3.2], look: [0, 2.6, -4], roll: 0, drift: [0, 0, -0.6] },
  // Low along the wall foot, looking up the hatches.
  { at: [-12, -0.3, 1.2], look: [6, 4.5, 0], roll: 0.25, drift: [0.6, 0, 0] },
  // Behind the wall, beside the rails, as the tram comes at the camera.
  { at: [10, 1.2, -6.4], look: [-20, 1.6, -4], roll: 0, drift: [0, 0, 0] },
  // Top-down on the hatch rings.
  { at: [8, 12, 1.5], look: [8, 3, 0], roll: Math.PI / 4, drift: [0.5, 0, 0] },
  // Tight on a ring's bolts, tilted.
  { at: [-6.5, 5.2, 1.6], look: [-8, 3, 0], roll: -0.5, drift: [0, -0.2, 0] },
] as const;
/** Neon colours the tram windows flash in. */
export const WINDOW_NEON = [0x3ee0ff, 0xff2ab0, 0x7cff3a, 0xffa830, 0x9a5cff, 0xff3a2a] as const;
const WINDOWS = 14;
const HATCH = 8;

export function createUndergroundMode(budget: QualityBudget): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).fov = 60;
  const sparkCount = tier(budget, 600, 300, 120);
  const time = uniform(0), finish = createCinematic({ grain: 0.08, halation: 0.3, vignette: 0.6, soften: 0.2, shadows: [0.006, 0.006, 0.007] });
  scene.background = new THREE.Color(0x0a0a0c);
  scene.fog = new THREE.FogExp2(0x16161a, 0.05);
  // The concrete wall, with round hatches cut through it every 8 m.
  const wallMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, side: THREE.DoubleSide });
  const w = positionWorld, hatchX = w.x.div(HATCH).add(0.5).fract().sub(0.5).mul(HATCH);
  const hole = vec3(hatchX, w.y.sub(3), 0).length();
  const stain = mx_fractal_noise_float(w.mul(vec3(0.6, 1.4, 0.6)), 4, 2, 0.55).mul(0.5).add(0.5);
  wallMaterial.colorNode = vec3(0.2, 0.2, 0.22).mul(stain.mul(0.7).add(0.4)).mul(mx_noise_float(w.mul(9)).mul(0.15).add(0.92));
  wallMaterial.opacityNode = hole.smoothstep(2.45, 2.5);
  wallMaterial.alphaTest = 0.5;
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(80, 14), wallMaterial); wall.position.set(0, 3, 0); wall.receiveShadow = true;
  scene.add(wall);
  // Inside one hatch: neon concentric rings, broken into arcs, that flash on hits.
  const neon = new THREE.MeshBasicNodeMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const rings = [1.1, 1.6, 2.1].map((r, i) => { const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 6, 96, Math.PI * (1.3 + i * 0.25)), neon); ring.position.set(0, 3, -0.6); ring.rotation.z = i * 1.7; return ring; });
  scene.add(...rings);
  const ringLight = new THREE.PointLight(0xffffff, 0, 14, 1.5); ringLight.position.set(0, 3, 1);
  const work = new THREE.SpotLight(0xdde4ff, 0, 40, 0.6, 0.5, 1.2); work.position.set(-6, 10, 6); work.target.position.set(2, 2, 0); work.castShadow = true; work.shadow.mapSize.set(1024, 1024);
  const tunnel = new THREE.PointLight(0xffb060, 30, 20, 1.6); tunnel.position.set(0, 3, -4);
  scene.add(ringLight, work, work.target, tunnel, new THREE.HemisphereLight(0x404048, 0x080808, 0.15));
  // Sparks spray from the hatch rim on hits.
  const sparks = createParticles(loadTexture(sparkUrl), sparkCount, { gravity: 9, drag: 0.6 });
  scene.add(sparks.object);
  // Tram windows: each of the 14 (six a side, front and rear) flashes on its own, in its own neon colour.
  const panes = Array.from({ length: WINDOWS }, () => new THREE.Vector4(0, 0, 0, 0));
  const paneData = uniformArray(panes, 'vec4');
  const windowMaterial = new THREE.MeshBasicNodeMaterial();
  const wx = positionLocal.x, side = positionLocal.z.greaterThan(0).select(float(0), float(6));
  const paneIndex = wx.abs().greaterThan(5.95).select(wx.greaterThan(0).select(float(12), float(13)), wx.add(6).div(2).floor().clamp(0, 5).add(side));
  const pane = paneData.element(paneIndex.toInt()) as unknown as THREE.Node<'vec4'>;
  windowMaterial.colorNode = vec3(0.35, 0.22, 0.1).add(pane.xyz.mul(pane.w.mul(6)));
  const spill = [-3, 3].map((x) => { const light = new THREE.PointLight(0xffffff, 0, 12, 1.6); light.position.set(x, 1.8, 1.6); return light; });
  const fade = new Float32Array(WINDOWS), pendingFlash = new Float32Array(WINDOWS).fill(-1);
  let tram: THREE.Object3D | undefined;
  const model = whenLoaded([kitAUrl], ([gltf]) => {
    const kit = kitPieces(gltf);
    for (let k = -4; k <= 4; k++) {
      const ring = kit.piece('shaft_ring'); ring.position.set(k * HATCH, 0, 0.05); scene.add(ring);
      for (let r = -2; r < 2; r++) scene.add(place(kit.piece('rail_track'), k * HATCH + r * 4 + 2, -0.5, -4));
    }
    tram = kit.piece('tram_carriage'); tram.position.set(0, -0.3, -4); scene.add(tram);
    tram.traverse((object) => { const mesh = object as THREE.Mesh; if (mesh.isMesh && (mesh.material as THREE.Material).name === 'emissive_window') mesh.material = windowMaterial; });
    tram.add(...spill);
    scene.traverse((object) => { const mesh = object as THREE.Mesh; if (mesh.isMesh && mesh !== wall) mesh.castShadow = true; });
  });
  const shadows = shadowSwitch();
  const hits = createHits({ decay: 0.12, interval: 0.25, variants: UNDERGROUND_ANGLES.length, seed: 8 });
  const random = seededRandom(17);
  let tramX = -30, blackout = 0;
  return {
    scene, camera,
    ready: model.ready,
    simulate: shadows.simulate,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time; finish.update(frame);
      const step = settleStep(frame), bass = frame.response.bass;
      hits.update(frame, 0.05);
      if (hits.fired) {
        // One to three windows flash per hit, each in a new neon colour and a few frames apart, never all at once.
        for (let k = 0, n = 1 + Math.floor(random() * 3); k < n; k++) {
          const i = Math.floor(random() * WINDOWS), [r, g, b] = linearRgb(WINDOW_NEON[Math.floor(random() * WINDOW_NEON.length)]);
          panes[i].set(r, g, b, panes[i].w); pendingFlash[i] = random() * 0.15;
        }
        // Some cuts land on a few frames of black first.
        blackout = random() < 0.3 && !frame.reducedFlash ? 0.08 : 0;
        for (let i = 0; i < 40; i++) {
          const a = random() * Math.PI * 2;
          sparks.emit(Math.cos(a) * 2.5, 3 + Math.sin(a) * 2.5, 0.3, (random() - 0.5) * 4, random() * 3, 1 + random() * 3, 0.6 + random() * 0.6, 0.06, 1.6, 0.8, 0.35);
        }
      }
      blackout = Math.max(0, blackout - step);
      const gain = blackout > 0 ? 0 : hits.gain;
      const angle = UNDERGROUND_ANGLES[frame.reducedMotion ? 0 : hits.variant], held = frame.reducedMotion ? 0 : Math.min(hits.age, 3);
      camera.position.set(angle.at[0] + angle.drift[0] * held, angle.at[1] + angle.drift[1] * held, angle.at[2] + angle.drift[2] * held);
      camera.lookAt(angle.look[0], angle.look[1], angle.look[2]); camera.rotateZ(angle.roll);
      if (!frame.reducedMotion) camera.position.y += Math.sin(frame.time * 31) * bass * 0.05;
      neon.color.setRGB(1, 0.25 + (hits.count % 2) * 0.75, 0.63 + (hits.count % 2) * 0.37).multiplyScalar(hits.flash * 3);
      ringLight.intensity = hits.flash * 80;
      work.intensity = 8 + gain * 160;
      tunnel.intensity = 10 + gain * 50;
      (scene.fog as THREE.FogExp2).color.setRGB(0.09, 0.09, 0.1).multiplyScalar(0.25 + frame.response.loudness * 0.8);
      // The carriage crosses behind the hatches, faster on the bass.
      if (tram && !frame.reducedMotion) { tramX += frame.delta * (6 + bass * 14); if (tramX > 26) tramX = -26; tram.position.x = tramX; }
      const scale = frame.reducedFlash ? 0.4 : 1, spillColour = [new THREE.Vector3(), new THREE.Vector3()];
      panes.forEach((p, i) => {
        if (pendingFlash[i] >= 0) { pendingFlash[i] -= step; if (pendingFlash[i] < 0) fade[i] = 1; }
        fade[i] *= Math.exp(-step / (0.18 + (i % 3) * 0.08));
        p.w = fade[i] * scale * (0.6 + bass * 0.6);
        spillColour[i < 12 ? (i % 6 < 3 ? 0 : 1) : i - 12].addScaledVector(new THREE.Vector3(p.x, p.y, p.z), p.w);
      });
      spill.forEach((light, k) => { const c = spillColour[k]; const level = Math.max(c.x, c.y, c.z); light.color.setRGB(c.x, c.y, c.z).multiplyScalar(level > 0 ? 1 / level : 0); light.intensity = level * 60; });
      sparks.update(step);
    },
    filter: (input) => finish.filter(input),
    dispose() { model.dispose(); shadows.dispose(); disposeScene(scene); },
  };
}

// ---------------------------------------------------------------- Endless Stairs

/** Endless Stairs colours, one per hit, never the same twice in a row. */
export const STAIR_COLOURS = [0x3ee0ff, 0xffa830, 0x2a44ff, 0x7cff3a, 0xff2ab0] as const;
const LAYER = 8, LAYERS = 6, TUBES = 140;

export function createEndlessStairsMode(budget: QualityBudget): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).fov = 75; (camera as THREE.PerspectiveCamera).far = 120;
  const fragments = tier(budget, 80, 40, 20);
  const time = uniform(0), finish = createCinematic({ grain: 0.07, halation: 0.3, vignette: 0.6, soften: 0.15, aberration: 0.005 });
  scene.background = new THREE.Color(0x020308);
  scene.fog = new THREE.FogExp2(0x020308, 0.045);
  const shaft = new THREE.Group(); scene.add(shaft);
  const random = seededRandom(23);
  // The white light at the bottom of the shaft.
  const bottom = new THREE.PointLight(0xffffff, 0, 60, 1.2); bottom.position.set(0, -LAYER * LAYERS, 0);
  const flare = createGlowPoints(loadTexture(sparkUrl), 1); flare.object.renderOrder = 2;
  const grade = new THREE.PointLight(0x3ee0ff, 0, 30, 1.4);
  scene.add(bottom, flare.object, grade, new THREE.HemisphereLight(0x1a2030, 0x000000, 0.1));
  // Neon strip fragments flying up past the camera.
  const neon = new THREE.MeshBasicNodeMaterial({ color: 0x3ee0ff });
  const bits = new THREE.InstancedMesh(new THREE.BoxGeometry(0.04, 0.9, 0.04), neon, fragments); bits.frustumCulled = false;
  const flying = Array.from({ length: fragments }, () => ({ x: (random() - 0.5) * 9, y: (random() - 0.5) * 40, z: (random() - 0.5) * 9, tilt: random() * Math.PI }));
  scene.add(bits);
  const strips: THREE.MeshStandardMaterial[] = [];
  const model = whenLoaded([kitHUrl], ([gltf]) => {
    const kit = kitPieces(gltf);
    // Each layer turns the stairs a quarter turn round the shaft; scaffold tubes cross in every direction.
    for (let layer = 0; layer < LAYERS; layer++) {
      const level = new THREE.Group(); level.position.y = -layer * LAYER; level.rotation.y = layer * Math.PI / 2;
      level.add(place(kit.piece('stair_flight'), 3.5, 0, 0, Math.PI / 2), place(kit.piece('stair_landing'), 3.5, 0, -4.5));
      level.add(place(kit.piece('floor_plate'), -3.5, 3, 3), place(kit.piece('handrail'), -3.5, 3.08, 5));
      for (let s = 0; s < 3; s++) { const strip = place(kit.piece('strip_light'), -5.4, 1 + s * 2.4, -2 + s * 2, Math.PI / 2); strip.rotation.z = Math.PI / 2; level.add(strip); }
      shaft.add(level);
    }
    const [tubes, ...rest] = kit.instanced('scaffold_tube_4m', TUBES * LAYERS);
    const clamps = kit.instanced('scaffold_clamp', TUBES * LAYERS)[0];
    const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), at = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), long = new THREE.Vector3(1, 2.2, 1);
    for (let i = 0; i < TUBES * LAYERS; i++) {
      at.set((random() - 0.5) * 12, -random() * LAYER * LAYERS, (random() - 0.5) * 12);
      q.setFromEuler(e.set(random() * Math.PI, random() * Math.PI, random() * Math.PI));
      tubes.setMatrixAt(i, matrix.compose(at, q, long));
      clamps?.setMatrixAt(i, matrix.compose(at, q, one));
    }
    shaft.add(tubes, ...rest, ...(clamps ? [clamps] : []));
    const strip = kit.materials.get('emissive_strip');
    if (strip) strips.push(strip);
  });

  const hits = createHits({ decay: 0.14, interval: 0.22, variants: STAIR_COLOURS.length, seed: 4 });
  const colour = new THREE.Color(), matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), at = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  let fall = 0, roll = 0, blackout = 0;
  return {
    scene, camera,
    ready: model.ready,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time; finish.update(frame);
      const step = settleStep(frame), still = frame.reducedMotion;
      hits.update(frame, 0.04);
      if (hits.fired && !frame.reducedFlash && hits.count % 3 === 0) blackout = 0.07;
      blackout = Math.max(0, blackout - step);
      const gain = blackout > 0 ? 0 : hits.gain;
      colour.setRGB(...linearRgb(STAIR_COLOURS[hits.variant]));
      // Falling down the shaft at about 6 m/s with a slow roll; the layers repeat, so the fall never ends.
      if (!still) { fall = (fall + frame.delta * (3 + frame.response.bass * 6)) % (LAYER * 4); roll += frame.delta * 0.35; }
      shaft.position.y = fall;
      camera.position.set(0, 2, 0);
      camera.up.set(Math.sin(roll), 0, Math.cos(roll));
      camera.lookAt(0, -50, 0);
      for (const strip of strips) { strip.emissive.copy(colour); strip.emissiveIntensity = 0.4 + gain * 6; }
      neon.color.copy(colour).multiplyScalar(1 + gain * 3);
      grade.color.copy(colour); grade.intensity = gain * 400; grade.position.set(0, -6, 0);
      bottom.intensity = 200 + gain * 1200;
      flare.set(0, 0, -LAYER * LAYERS * 0.55, 0, 3 + gain * 4, 1.4, 1.4, 1.4, 1); flare.commit();
      (scene.fog as THREE.FogExp2).color.copy(colour).multiplyScalar(0.01 + gain * 0.05);
      flying.forEach((bit, i) => {
        if (!still) bit.y += frame.delta * (10 + frame.response.bass * 12);
        if (bit.y > 6) bit.y -= 40;
        bits.setMatrixAt(i, matrix.compose(at.set(bit.x, bit.y, bit.z), q.setFromEuler(e.set(bit.tilt, bit.tilt * 2, 0)), one));
      });
      bits.instanceMatrix.needsUpdate = true;
    },
    filter: (input) => finish.filter(input),
    dispose() { model.dispose(); disposeScene(scene); },
  };
}

// ---------------------------------------------------------------- Temple Descent

const TIERS = 16, SHAFT = 12;

export function createTempleDescentMode(budget: QualityBudget): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).fov = 70; (camera as THREE.PerspectiveCamera).far = 200;
  const dustCount = tier(budget, 1500, 800, 300);
  const time = uniform(0), finish = createCinematic({ grain: 0.08, halation: 0.45, vignette: 0.55, soften: 0.3, shadows: [0.004, 0.012, 0.012] });
  scene.background = new THREE.Color(0x05100f);
  scene.fog = new THREE.FogExp2(0x123a40, 0.035);
  const top = TIERS * 2;
  // Daylight through the square opening at the top, as a shadowing spot and soft god-ray shafts.
  const sun = new THREE.SpotLight(0xb6e8d0, 0, 90, 0.32, 0.7, 1);
  sun.position.set(0, top + 20, 0); sun.target.position.set(0, 0, 0); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0005;
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicNodeMaterial({ color: 0xd8f0e8 }));
  sky.rotation.x = Math.PI / 2; sky.position.set(0, top + 0.6, 0);
  const rays = [0, 1, 2].map((i) => {
    const ray = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 3.5 + i, top, 4, 1, true).translate(0, -top / 2, 0), shaftMaterial(time));
    ray.position.set(0, top, 0); ray.rotation.y = Math.PI / 4 + i * 0.2; return ray;
  });
  const red = new THREE.PointLight(0xff7a2a, 0, 50, 1.2); red.position.set(-3, top * 0.6, 2);
  scene.add(sun, sun.target, sky, ...rays, red, new THREE.HemisphereLight(0x2a6a64, 0x020606, 0.15));
  // Dust drifting down through the light.
  const dust = createGlowPoints(loadTexture(emberUrl), dustCount + 1);
  const random = seededRandom(37);
  const motes = Array.from({ length: dustCount }, () => ({ x: (random() - 0.5) * SHAFT * 0.9, y: random() * top, z: (random() - 0.5) * SHAFT * 0.9, size: 0.02 + random() * 0.04 }));
  scene.add(dust.object);
  const lanterns: THREE.MeshStandardMaterial[] = [];
  const temple = new THREE.Group(); scene.add(temple);
  const model = whenLoaded([kitBUrl], ([gltf]) => {
    const kit = kitPieces(gltf), names = ['tier_a', 'tier_b', 'tier_c'];
    for (let level = 0; level < TIERS; level++) {
      const y = level * 2;
      for (let side = 0; side < 4; side++) {
        const turn = side * Math.PI / 2, wall = new THREE.Group(); wall.rotation.y = turn;
        for (let k = -1; k <= 1; k++) wall.add(place(kit.piece(names[(level + side + k + 3) % 3]), k * 4, y, -SHAFT / 2));
        if (level % 4 === 3) wall.add(place(kit.piece('ledge'), 0, y, -SHAFT / 2 + 0.5));
        temple.add(wall);
      }
    }
    // Stone cap with the square opening in the middle.
    const cap = new THREE.Group();
    const stone = kit.materials.get('kitB_atlas'), slab = new THREE.BoxGeometry(4, 0.5, 4).translate(0, 0.25, 0);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) cap.add(place(i === 0 && j === 0 ? kit.piece('cap_slab') : new THREE.Mesh(slab, stone), i * 4, top, j * 4));
    temple.add(cap);
    for (let i = 0; i < 6; i++) {
      const hang = new THREE.Group(), x = (random() - 0.5) * 7, z = (random() - 0.5) * 7, y = 6 + random() * (top - 12);
      hang.add(place(kit.piece('chain'), 0, 0, 0), place(kit.piece(i % 2 ? 'lantern_a' : 'lantern_b'), 0, -0.9, 0));
      hang.position.set(x, y, z); temple.add(hang);
    }
    shadowed(temple);
    const glass = kit.materials.get('emissive_lantern');
    if (glass) { glass.emissive.setRGB(...linearRgb(0xff9a40)); lanterns.push(glass); }
  });
  const shadows = shadowSwitch();
  // Two hit looks that alternate: the lit reveal of the stone tiers, and the red-grade slam with a sun flare.
  const hits = createHits({ decay: 0.3, interval: 0.7, variants: 2, seed: 6 });
  let drift = 0;
  const fogColour = new THREE.Color();
  return {
    scene, camera,
    ready: model.ready,
    simulate: shadows.simulate,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time; finish.update(frame);
      const bass = frame.response.bass, gain = hits.update(frame, 0.08).gain;
      const slam = hits.variant === 1 ? hits.flash : 0, reveal = hits.variant === 0 ? hits.flash : 0;
      sun.intensity = 200 + reveal * 1600 + bass * 300;
      for (const ray of rays) (ray.material as THREE.MeshBasicNodeMaterial).color.setRGB(0.55, 0.85, 0.75).multiplyScalar(0.05 + bass * 0.12 + reveal * 0.3);
      (sky.material as THREE.MeshBasicNodeMaterial).color.setRGB(0.7, 0.9, 0.85).multiplyScalar(1.5 + reveal * 4 + slam * 5);
      red.intensity = slam * 700;
      for (const glass of lanterns) glass.emissiveIntensity = 0.5 + gain * 2;
      // Teal haze between hits; the slam turns it hot orange for a moment.
      fogColour.setRGB(...linearRgb(0x123a40)).multiplyScalar(0.25 + gain * 0.6).lerp(new THREE.Color(0.55, 0.08, 0.02), slam * 0.8);
      (scene.fog as THREE.FogExp2).color.copy(fogColour);
      // A slow tilt and drift up the shaft, not a travel.
      if (!frame.reducedMotion) drift += frame.delta;
      camera.position.set(Math.sin(drift * 0.07) * 2, 3 + Math.sin(drift * 0.05) * 1.5, 3.5);
      camera.lookAt(Math.sin(drift * 0.04) * 1.5, top, -1.5);
      const density = 0.3 + frame.response.loudness * 0.7;
      motes.forEach((mote, i) => {
        if (!frame.reducedMotion) { mote.y -= frame.delta * 0.4; if (mote.y < 0) mote.y += top; }
        const lit = (0.3 + reveal * 1.5 + slam) * (i / dustCount < density ? 1 : 0);
        dust.set(i, mote.x + Math.sin(frame.time * 0.3 + i) * 0.2, mote.y, mote.z, mote.size, 0.85 * lit, lit, 0.95 * lit, 0.8);
      });
      dust.set(dustCount, 0, top + 0.4, 0, 2 + slam * 10, 1.2, 1, 0.8, slam * 0.9);
      dust.commit();
    },
    filter: (input) => finish.filter(input),
    dispose() { model.dispose(); shadows.dispose(); disposeScene(scene); },
  };
}
