import * as THREE from 'three/webgpu';
import { float, fract, mix, positionWorld, uniform, uv, vec2, vec3 } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { shaftMaterial } from './figures';
import { createCinematic } from './cinematic';
import { shadowSwitch } from './kitModes';
import { hash2, palette } from './shaderModes';
import { createHits, linearRgb } from './hitPulse';

/** Car interior size (metres), the window bays along the left wall, and the camera loop timing (seconds). */
export const METRO = { length: 12, width: 2.6, height: 2.3, bays: 6, loop: 10 } as const;

/** Camera state through one loop: position along the car, height, roll (radians) and the end-door flash. */
export function metroShot(t: number) {
  const { length, loop } = METRO, u = ((t % loop) + loop) % loop;
  const ease = (a: number, b: number) => { const x = Math.min(1, Math.max(0, (u - a) / (b - a))); return x * x * (3 - 2 * x); };
  const z = 1.2 - ease(0, 6) * 5.5 - ease(6, 8) * (length - 6.2);
  return {
    z, y: 1.45 - ease(6, 8) * 0.35,
    roll: ease(2.4, 4.2) * Math.PI / 4 + ease(4.2, 6) * Math.PI * 0.6 - ease(6, 8) * Math.PI * 0.25,
    flash: Math.exp(-Math.abs(u - 7.8) / 0.12),
    blackout: ease(7.9, 8.1) * (1 - ease(9.7, 10)),
  };
}

/**
 * Metro Car (wave 5, clip 13): a first-person glide through an empty subway car (olive panels, steel poles,
 * blue-grey benches, ad boards, orange destination lights at the far end) with low evening sun pouring
 * through the left windows in warm shafts and bars across the floor. The camera rolls past 90°, dives at the
 * end door, which flashes cream, and the lights cut to black. Built in code; the loop speeds up with the music
 * and kicks shake the camera.
 */
export function createMetroCarMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).fov = 70; camera.near = 0.05;
  scene.background = new THREE.Color(0x000000);
  const finish = createCinematic({ grain: 0.06, halation: 0.4, vignette: 0.55, soften: 0.12, aberration: 0.002, shadows: [0.0, 0.012, 0.014] });
  const time = uniform(0), doorGlow = uniform(0), cabinLight = uniform(1);
  const { length, width, height, bays } = METRO, half = width / 2, bay = length / bays;
  const car = new THREE.Group(); scene.add(car);
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; car.add(m); return m;
  };
  const olive = new THREE.MeshStandardNodeMaterial({ color: 0x5a6a3a, roughness: 0.55, metalness: 0.1 });
  const ceilingMaterial = new THREE.MeshStandardNodeMaterial({ color: 0xc8ccc0, roughness: 0.6 });
  const steel = new THREE.MeshStandardNodeMaterial({ color: 0xd0d4d8, roughness: 0.2, metalness: 1 });
  const seat = new THREE.MeshStandardNodeMaterial({ color: 0x4a5a6e, roughness: 0.7 });
  const floorMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.1 });
  // Worn floor: a dull speckled grey with a sheen strip down the middle where feet go.
  floorMaterial.colorNode = mix(vec3(0.05, 0.05, 0.048), vec3(0.09, 0.085, 0.08), hash2(positionWorld.xz.mul(40).floor()));
  floorMaterial.roughnessNode = mix(float(0.2), float(0.6), positionWorld.x.abs().div(half));
  add(new THREE.BoxGeometry(width, 0.05, length), floorMaterial, 0, -0.025, -length / 2);
  add(new THREE.BoxGeometry(width, 0.05, length), ceilingMaterial, 0, height, -length / 2);
  // Right wall solid; left wall in pieces around the window openings so the sun comes through.
  add(new THREE.BoxGeometry(0.06, height, length), olive, half, height / 2, -length / 2);
  add(new THREE.BoxGeometry(0.06, 0.95, length), olive, -half, 0.475, -length / 2);
  add(new THREE.BoxGeometry(0.06, height - 1.85, length), olive, -half, (height + 1.85) / 2, -length / 2);
  for (let k = 0; k <= bays; k++) add(new THREE.BoxGeometry(0.08, 0.9, 0.32), olive, -half, 1.4, -k * bay);
  // Benches along both walls, poles, and the overhead grab rails.
  for (let k = 0; k < bays; k++) for (const side of [-1, 1]) {
    const z = -k * bay - bay / 2;
    add(new RoundedBoxGeometry(0.5, 0.12, bay * 0.8, 3, 0.04), seat, side * (half - 0.3), 0.46, z);
    add(new RoundedBoxGeometry(0.1, 0.45, bay * 0.8, 3, 0.04), seat, side * (half - 0.07), 0.72, z);
    add(new THREE.BoxGeometry(0.42, 0.4, bay * 0.78), olive, side * (half - 0.28), 0.2, z);
    add(new THREE.CylinderGeometry(0.02, 0.02, height, 12), steel, side * 0.55, height / 2, -k * bay);
  }
  for (const side of [-1, 1]) {
    const rail = add(new THREE.CylinderGeometry(0.018, 0.018, length, 10), steel, side * 0.6, 1.95, -length / 2); rail.rotation.x = Math.PI / 2;
  }
  // Ad boards angled along the top of each wall: blocks of colour like posters.
  const adMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.5 });
  const cell = uv().mul(vec2(bays * 2, 1));
  adMaterial.colorNode = mix(palette(hash2(cell.floor()).mul(0.7).add(0.05)).mul(0.6), vec3(0.85, 0.82, 0.75), fract(cell.x).sub(0.5).abs().greaterThan(0.45).select(float(1), float(0)));
  adMaterial.emissiveNode = adMaterial.colorNode.mul(cabinLight.mul(0.15));
  for (const side of [-1, 1]) { const board = add(new THREE.PlaneGeometry(length, 0.32), adMaterial, side * (half - 0.08), height - 0.2, -length / 2); board.rotation.y = -side * Math.PI / 2; board.rotateX(-0.35); }
  // Ceiling light strips.
  const strip = new THREE.MeshBasicNodeMaterial(); strip.colorNode = vec3(0.9, 1, 0.95).mul(cabinLight.mul(0.8));
  for (const x of [-0.5, 0.5]) add(new THREE.BoxGeometry(0.12, 0.02, length * 0.95), strip, x, height - 0.03, -length / 2).castShadow = false;
  // End door with its window, and the orange destination lights above it.
  add(new THREE.BoxGeometry(width, height, 0.06), olive, 0, height / 2, -length - 0.03);
  const doorMaterial = new THREE.MeshBasicNodeMaterial();
  doorMaterial.colorNode = mix(vec3(0.05, 0.06, 0.06), vec3(1, 0.95, 0.82).mul(3), doorGlow);
  add(new THREE.PlaneGeometry(0.55, 0.7), doorMaterial, 0, 1.45, -length + 0.005).castShadow = false;
  const destination = new THREE.MeshBasicNodeMaterial(); destination.colorNode = vec3(1, 0.42, 0.08).mul(cabinLight.mul(1.5).add(0.5));
  for (const x of [-0.5, 0.5]) add(new THREE.PlaneGeometry(0.5, 0.1), destination, x, 2.05, -length + 0.005).castShadow = false;
  // Outside the windows: a bright low evening sky, and the sun shining in at a low angle.
  const skyMaterial = new THREE.MeshBasicNodeMaterial({ fog: false });
  skyMaterial.colorNode = mix(vec3(1.6, 0.9, 0.45), vec3(0.6, 0.55, 0.6), uv().y.smoothstep(0.3, 0.9));
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(60, 12), skyMaterial); sky.position.set(-12, 2, -length / 2); sky.rotation.y = Math.PI / 2; scene.add(sky);
  const sun = new THREE.DirectionalLight(0xffb070, 6);
  sun.position.set(-8, 3.2, -3); sun.target.position.set(0, 0, -6); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 0.5, far: 25 });
  scene.add(sun, sun.target, new THREE.HemisphereLight(0x5a8a8a, 0x1a1410, 0.5));
  // Warm shafts from each window across the car.
  const shafts: THREE.Mesh[] = [];
  for (let k = 0; k < bays; k++) {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.7, 3.2, 4, 1, true).translate(0, -1.6, 0), shaftMaterial(time));
    shaft.position.set(-half, 1.5, -k * bay - bay / 2); shaft.rotation.set(0, Math.PI / 4, Math.PI / 2 - 0.35);
    (shaft.material as THREE.MeshBasicNodeMaterial).color.setRGB(...linearRgb(0xffa060)).multiplyScalar(0.08);
    shafts.push(shaft); scene.add(shaft);
  }
  const shadows = shadowSwitch();
  const hits = createHits({ decay: 0.25, interval: 0.3 });
  let clock = 0, shake = 0;
  return {
    scene, camera,
    simulate: shadows.simulate,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time; finish.update(frame);
      const step = settleStep(frame), motion = frame.reducedMotion ? 0 : frame.delta, { loudness, bass } = frame.response;
      hits.update(frame, 0.1);
      if (hits.fired) shake = 1;
      shake *= Math.exp(-step / 0.25);
      clock += motion * (0.7 + loudness * 0.6);
      const shot = metroShot(clock), flashCap = frame.reducedFlash ? 0.4 : 1;
      doorGlow.value = Math.min(1, shot.flash * flashCap + bass * 0.05);
      // The lights cut at the end of the loop (reduced flash keeps a dim floor instead of full black).
      const lights = 1 - shot.blackout * (frame.reducedFlash ? 0.6 : 1);
      cabinLight.value = approach(cabinLight.value, lights * (0.8 + hits.flash * 0.3), step, 0.05);
      sun.intensity = 6 * lights * (0.85 + loudness * 0.3);
      shafts.forEach((shaft) => (shaft.material as THREE.MeshBasicNodeMaterial).color.setRGB(...linearRgb(0xffa060)).multiplyScalar(0.08 * lights));
      sky.visible = lights > 0.05;
      const jitter = shake * 0.03;
      camera.position.set(Math.sin(frame.time * 13) * jitter, shot.y + Math.cos(frame.time * 11) * jitter, shot.z);
      camera.rotation.set(0, 0, 0); camera.rotation.z = frame.reducedMotion ? 0 : shot.roll;
      camera.rotateX(-0.04);
    },
    filter: (input) => finish.filter(input),
    dispose() { shadows.dispose(); disposeScene(scene); },
  };
}
