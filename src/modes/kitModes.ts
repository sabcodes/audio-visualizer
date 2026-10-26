import * as THREE from 'three/webgpu';
import { float, fract, mix, mx_noise_float, positionWorld, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { instantiate, shaftMaterial } from './figures';
import { createCinematic } from './cinematic';
import { createHits, linearRgb, variantSequence } from './hitPulse';
import { hash2 } from './shaderModes';
import { seededRandom } from '../rendering/diagnostics';

/** Piece lookup for a modular kit: per-mode copies of the materials, so emissive tints never leak between modes. */
export function kitPieces(gltf: GLTF) {
  const kit = instantiate(gltf);
  return {
    materials: kit.materials,
    piece(name: string) { return kit.node(name).clone(); },
    /** Every mesh of a piece as instanced copies, `count` of each, for pieces repeated many times. */
    instanced(name: string, count: number) {
      const meshes: THREE.Mesh[] = [];
      kit.node(name).traverse((object) => { if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh); });
      return meshes.map((mesh) => { const copy = new THREE.InstancedMesh(mesh.geometry, mesh.material, count); copy.frustumCulled = false; return copy; });
    },
  };
}
export type KitPieces = ReturnType<typeof kitPieces>;

/** Lets a mode turn on the renderer's shadow maps while it is active and restore the setting afterwards. */
export function shadowSwitch() {
  let renderer: THREE.WebGPURenderer | undefined, previous = false;
  return {
    simulate(next: THREE.WebGPURenderer) {
      if (renderer) return;
      renderer = next; previous = next.shadowMap.enabled;
      next.shadowMap.enabled = true;
    },
    dispose() { if (renderer) renderer.shadowMap.enabled = previous; renderer = undefined; },
  };
}

// ---------------------------------------------------------------- Warehouse Hall

/** The hall's three looks, one per cut: day-bright windows, a single ceiling strip, window shafts with a red wash. */
export const WAREHOUSE_STATES = ['windows', 'strip', 'shafts'] as const;
/** Light levels per state: window glow, window sun, ceiling strip, shafts, red column wash, ambient fill. */
const WAREHOUSE_LEVELS = [
  { glow: 0.6, sun: 3, strip: 0, shafts: 0, red: 0, fill: 0.25 },
  { glow: 0.02, sun: 0, strip: 1, shafts: 0, red: 0, fill: 0.04 },
  { glow: 0.07, sun: 1.1, strip: 0, shafts: 1, red: 1, fill: 0.06 },
] as const;
/** Blackout length between states (seconds) and how far it drops (a fraction of the lit level). */
export function warehouseBlackout(random: number, reducedFlash: boolean) {
  return { seconds: 0.2 + random * 0.2, level: reducedFlash ? 0.4 : 0.05 };
}
const HALL = { width: 26, depth: 32, height: 10, back: -24 } as const;

/**
 * Warehouse Hall: a wide blue-grey industrial hall with a wall of tall windows at the back, rows of columns,
 * rubble and puddles on the floor. Each cut drops the hall to black for 0.2–0.4 s and comes back in one of three
 * looks: the windows blazing with a cool reflection across the wet floor, a single ceiling strip, or dim windows
 * throwing shafts with a red wash on the side columns. Some cuts flick a red accent at the frame's edge.
 * Built in code; the camera drifts with the music.
 */
export function createWarehouseHallMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).fov = 58;
  const time = uniform(0), glow = uniform(1), stripGlow = uniform(0);
  const finish = createCinematic({ grain: 0.07, halation: 0.4, vignette: 0.6, soften: 0.15, shadows: [0.004, 0.006, 0.01] });
  scene.background = new THREE.Color(0x010203);
  scene.fog = new THREE.FogExp2(0x0a0e12, 0.018);
  const { width, depth, height, back } = HALL, front = back + depth;
  const hall = new THREE.Group(); scene.add(hall);
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; hall.add(m); return m;
  };
  const concrete = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
  concrete.colorNode = mix(vec3(0.05, 0.065, 0.08), vec3(0.09, 0.105, 0.12), mx_noise_float(positionWorld.mul(0.6)).mul(0.5).add(0.5));
  // Walls, ceiling and the back wall around the windows.
  add(new THREE.BoxGeometry(0.4, height, depth), concrete, -width / 2, height / 2, back + depth / 2);
  add(new THREE.BoxGeometry(0.4, height, depth), concrete, width / 2, height / 2, back + depth / 2);
  add(new THREE.BoxGeometry(width, 0.4, depth), concrete, 0, height, back + depth / 2);
  add(new THREE.BoxGeometry(width, height, 0.4), concrete, 0, height / 2, back - 0.3);
  for (let z = back + 2; z < front; z += 6) add(new THREE.BoxGeometry(width, 0.6, 0.35), concrete, 0, height - 0.5, z);
  // Tall windows: steel mullions over pale panes, a few broken or grimy ones darker.
  const windowMaterial = new THREE.MeshBasicNodeMaterial();
  const pane = uv().mul(vec2(3, 7)), cellId = pane.floor().add(positionWorld.x.floor().mul(13));
  const mullion = fract(pane).sub(0.5).abs().max(float(0)).toVar();
  const frame = mullion.x.max(mullion.y).smoothstep(0.42, 0.46);
  const grime = mix(float(0.55), float(1), hash2(cellId)).mul(uv().y.mul(0.3).add(0.75));
  windowMaterial.colorNode = mix(vec3(0.85, 0.93, 1).mul(grime).mul(glow.mul(3)), vec3(0.01, 0.012, 0.015), frame);
  const windowXs = [-10, -6, -2, 2, 6, 10];
  for (const x of windowXs) {
    add(new THREE.PlaneGeometry(2.8, 6.4), windowMaterial, x, 4.9, back - 0.08).castShadow = false;
  }
  // Two rows of columns, plus pilasters on the side walls that catch the red wash.
  for (let z = back + 4; z < front - 4; z += 6) for (const x of [-7, 7]) add(new THREE.BoxGeometry(0.7, height, 0.7), concrete, x, height / 2, z);
  for (let z = back + 2; z < front; z += 6) for (const x of [-width / 2 + 0.5, width / 2 - 0.5]) add(new THREE.BoxGeometry(0.6, height, 0.9), concrete, x, height / 2, z);
  // The single ceiling strip down the middle of the hall.
  const stripMaterial = new THREE.MeshBasicNodeMaterial(); stripMaterial.colorNode = vec3(0.9, 0.97, 1).mul(stripGlow.mul(4));
  add(new THREE.BoxGeometry(0.25, 0.08, depth * 0.7), stripMaterial, 0, height - 0.85, back + depth * 0.45).castShadow = false;
  // Rubble: broken lumps scattered over the floor, densest near the camera, so they read as silhouettes.
  const random = seededRandom(14), rubble = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), concrete, 90);
  const lump = new THREE.Object3D();
  for (let k = 0; k < rubble.count; k++) {
    const near = random() ** 2;
    lump.position.set((random() - 0.5) * (width - 2), 0, front - 2 - near * depth * 0.9 - random() * 2);
    lump.scale.set(0.15 + random() * 0.5, 0.1 + random() * 0.35, 0.15 + random() * 0.5);
    lump.rotation.set(random() * 3, random() * 3, random() * 3); lump.updateMatrix();
    rubble.setMatrixAt(k, lump.matrix);
  }
  rubble.castShadow = rubble.receiveShadow = true; hall.add(rubble);
  // Wet floor: the hall mirrored below a translucent concrete slab that clears up in the puddles.
  const mirror = hall.clone(); mirror.scale.y = -1; scene.add(mirror);
  const floorMaterial = new THREE.MeshStandardNodeMaterial({ transparent: true, roughness: 0.6 });
  const puddle = mx_noise_float(positionWorld.xz.mul(0.18)).add(mx_noise_float(positionWorld.xz.mul(0.7)).mul(0.3)).smoothstep(0.05, 0.3);
  floorMaterial.colorNode = mix(vec3(0.05, 0.06, 0.07), vec3(0.02, 0.025, 0.03), puddle);
  floorMaterial.roughnessNode = mix(float(0.85), float(0.08), puddle);
  floorMaterial.opacityNode = mix(float(0.88), float(0.35), puddle);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), floorMaterial);
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, back + depth / 2); floor.receiveShadow = true; scene.add(floor);
  // Lights: daylight through the windows (casting the columns' shadows toward the camera), lamps under the
  // ceiling strip, red washes on the side walls and a red edge accent near the camera.
  const sun = new THREE.DirectionalLight(0xdce8ff, 3);
  sun.position.set(2, 9, back - 6); sun.target.position.set(0, 0, front - 6); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005;
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 50 });
  const lamps = [-0.25, 0, 0.25].map((f) => { const lamp = new THREE.PointLight(0xe8f2ff, 0, 18, 1.6); lamp.position.set(0, height - 1.1, back + depth * (0.45 + f * 0.7)); return lamp; });
  const washes = [-1, 1].flatMap((side) => [-0.2, 0.35].map((f) => { const wash = new THREE.PointLight(0xe0140c, 0, 12, 1.5); wash.position.set(side * (width / 2 - 2), 3, back + depth * (0.5 + f)); return wash; }));
  const accent = new THREE.PointLight(0xff1a0c, 0, 10, 1.4);
  const fill = new THREE.HemisphereLight(0x8a9bb0, 0x0a0c10, 0.25);
  scene.add(sun, sun.target, fill, accent, ...lamps, ...washes);
  const shafts = [-6, 2, 6].map((x) => {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 2.6, 15, 4, 1, true).translate(0, -7.5, 0), shaftMaterial(time));
    // Slanting across the hall to the floor, so they're seen from the side rather than end-on.
    shaft.position.set(x, 6, back); scene.add(shaft);
    shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(5, -6, 9).normalize());
    return shaft.material as THREE.MeshBasicNodeMaterial;
  });

  const shadows = shadowSwitch();
  const hits = createHits({ decay: 0.22, interval: 0.4 }), states = variantSequence(WAREHOUSE_STATES.length, 14);
  const level: Record<keyof (typeof WAREHOUSE_LEVELS)[number], number> = { ...WAREHOUSE_LEVELS[0] }, shaftColour = new THREE.Color(...linearRgb(0xdce8ff));
  let state = 0, dark = 0, darkLevel = 1, accentLeft = 0, accentSide = 1, drift = 0;
  return {
    scene, camera,
    simulate: shadows.simulate,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time; finish.update(frame);
      const step = settleStep(frame), { bass, loudness } = frame.response;
      hits.update(frame, 0.03);
      // A cut: a hard blackout, then the next look. Reduced flash cuts on every other hit and only dims.
      if (hits.fired && dark <= 0 && (!frame.reducedFlash || hits.count % 2 === 0)) {
        const blackout = warehouseBlackout(Math.random(), frame.reducedFlash);
        dark = blackout.seconds; darkLevel = blackout.level;
        if (Math.random() < 0.4) { accentLeft = 0.2; accentSide = Math.random() < 0.5 ? -1 : 1; }
      }
      if (dark > 0) { dark -= step; if (dark <= 0) state = states.next(); }
      accentLeft = Math.max(0, accentLeft - step);
      const target = WAREHOUSE_LEVELS[state];
      for (const key of Object.keys(level) as (keyof typeof level)[]) level[key] = approach(level[key], target[key], step, 0.04);
      const power = (dark > 0 ? darkLevel : 1) * (0.9 + hits.flash * 0.2 + bass * 0.15);
      glow.value = level.glow * power;
      sun.intensity = level.sun * power;
      stripGlow.value = level.strip * power;
      lamps.forEach((lamp) => { lamp.intensity = level.strip * power * 40; });
      washes.forEach((wash) => { wash.intensity = level.red * power * 30; });
      shafts.forEach((material) => material.color.copy(shaftColour).multiplyScalar(level.shafts * power * 0.25));
      fill.intensity = level.fill * power;
      accent.intensity = accentLeft > 0 ? (frame.reducedFlash ? 15 : 40) : 0;
      // A slow drift across the hall, quicker when the music is loud.
      if (!frame.reducedMotion) drift += frame.delta * (0.08 + loudness * 0.25);
      const x = Math.sin(drift) * 3, z = front - 3 - (Math.sin(drift * 0.6) * 0.5 + 0.5) * 4;
      camera.position.set(x, 1.5, z);
      accent.position.set(x + accentSide * 4, 1.6, z - 2);
      camera.lookAt(x * 0.4, 3.6, back);
    },
    filter: (input) => finish.filter(input),
    dispose() { shadows.dispose(); disposeScene(scene); },
  };
}
