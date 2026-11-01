import * as THREE from 'three/webgpu';
import { abs, float, fract, instancedBufferAttribute, mix, normalLocal, normalView, normalWorld, positionLocal, positionWorld, sin, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ModeFrame, VisualMode } from './types';
import { approach, disposeScene, resizeCamera, sceneDefaults, wrap } from './shared';
import { instantiate, whenLoaded } from './figures';
import { seededRandom } from '../rendering/diagnostics';
import { createNightRiderEffects, createNightRiderThrottle } from './nightRiderEffects';
import { presetBudget, type QualityBudget } from '../rendering/quality';
import bikeUrl from '../assets/wave6/nr_bike.glb?url';
import riderV2Url from '../assets/wave6/nr_rider_v2.glb?url';
import { createNightRiderV2Character } from './nightRiderV2Character';

type Clip = 'idle' | 'ride' | 'lean_L' | 'lean_R' | 'wheelie' | 'dismount';
type District = 'rain street' | 'light tunnel' | 'skyway' | 'dusk overlook' | 'redline works' | 'hologram plaza';
interface Shot {
  name: string; district: District; clip: Clip; seconds: number;
  eye: readonly [number, number, number]; look: readonly [number, number, number];
  drift: readonly [number, number, number]; fov: number; roll?: number;
  motion?: 'launch' | 'drift' | 'burnout' | 'stoppie' | 'jump' | 'slalom' | 'orbit';
  orbit?: number;
}

/** A directed reel, rather than a random camera: quiet inserts separate the action sequences. */
export const NIGHT_RIDER_SHOTS: readonly Shot[] = [
  { name: 'midnight rendezvous', district: 'rain street', clip: 'idle', seconds: 2.8, eye: [3.3, 1.45, 4.4], look: [0, 0.85, 0], drift: [-0.5, 0.1, -0.6], fov: 38 },
  { name: 'twin lamps / city lights', district: 'rain street', clip: 'idle', seconds: 1.4, eye: [0.9, 0.95, 1.8], look: [0, 0.83, 0.65], drift: [-0.22, 0, -0.16], fov: 38 },
  { name: 'launch / twin beams', district: 'rain street', clip: 'ride', motion: 'launch', seconds: 1.8, eye: [-1.5, 0.36, 3.6], look: [0, 0.6, 0], drift: [0.5, 0.1, -0.3], fov: 48 },
  { name: 'wet asphalt pursuit', district: 'rain street', clip: 'ride', seconds: 2.2, eye: [1.8, 1.3, -4], look: [0, 0.95, 0.8], drift: [-0.5, -0.2, 0.5], fov: 55 },
  { name: 'cyan portal entry', district: 'light tunnel', clip: 'ride', seconds: 1.8, eye: [2.8, 0.85, 3.4], look: [0, 0.75, 0], drift: [-0.6, 0.1, -0.5], fov: 49, roll: -0.06 },
  { name: 'tunnel sidewinder', district: 'light tunnel', clip: 'lean_L', motion: 'drift', seconds: 2, eye: [3.2, 0.65, 0.5], look: [0, 0.55, 0], drift: [-0.3, 0.1, 0.7], fov: 47, roll: 0.09 },
  { name: 'speed / rear wheel', district: 'light tunnel', clip: 'ride', seconds: 1.25, eye: [-1.55, 0.32, -1.85], look: [0, 0.38, -0.48], drift: [-0.25, 0.12, 0.2], fov: 43 },
  { name: 'neon wheelie', district: 'light tunnel', clip: 'wheelie', seconds: 2.2, eye: [3.6, 0.75, 2.2], look: [0, 1, 0], drift: [-0.4, 0.3, -0.5], fov: 49, roll: -0.08 },
  { name: 'above the expressway', district: 'skyway', clip: 'ride', seconds: 2, eye: [-3.2, 5.1, -3.8], look: [0, 0.4, 0], drift: [0.9, -0.7, 0.3], fov: 46 },
  { name: 'skyline countersteer', district: 'skyway', clip: 'lean_R', motion: 'drift', seconds: 2, eye: [-3.8, 1.1, 2.5], look: [0, 0.55, 0], drift: [0.5, 0.15, -0.6], fov: 43, roll: -0.09 },
  { name: 'cockpit / vanishing point', district: 'skyway', clip: 'ride', seconds: 1.5, eye: [0.12, 1.65, -0.65], look: [0, 0.9, 4], drift: [-0.08, -0.05, 0.1], fov: 62 },
  { name: 'skyway wheelie profile', district: 'skyway', clip: 'wheelie', seconds: 2.3, eye: [-4.2, 1.4, -0.8], look: [0, 1, 0], drift: [0.3, 0.1, 1.1], fov: 42 },
  { name: 'violet hour / machine portrait', district: 'dusk overlook', clip: 'idle', seconds: 2.8, eye: [3.4, 1.5, -3.7], look: [0, 0.55, 0], drift: [-0.7, 0.15, -0.1], fov: 40, orbit: 0.7 },
  { name: 'fairing / neon silhouette', district: 'dusk overlook', clip: 'idle', seconds: 1.6, eye: [-2.1, 0.85, -0.4], look: [0, 0.57, 0.12], drift: [0.12, 0.1, 0.2], fov: 42 },
  { name: 'kickstand / rooftop settle', district: 'dusk overlook', clip: 'dismount', seconds: 4.3, eye: [3.5, 1.25, 3.4], look: [0, 0.55, -0.1], drift: [-0.6, 0.15, 0.3], fov: 38, orbit: -0.8 },
  { name: 'redline / ignition', district: 'redline works', clip: 'ride', seconds: 1.5, eye: [1.8, 0.45, 3.1], look: [0, 0.7, 0], drift: [0.5, 0.1, -0.2], fov: 46 },
  { name: 'industrial left carve', district: 'redline works', clip: 'lean_L', motion: 'drift', seconds: 2, eye: [3.8, 1.9, -1.8], look: [0, 0.55, 0], drift: [-0.6, -0.4, 0.8], fov: 44, roll: 0.08 },
  { name: 'industrial right carve', district: 'redline works', clip: 'lean_R', motion: 'drift', seconds: 2, eye: [-3.8, 0.7, -1.5], look: [0, 0.55, 0], drift: [0.2, 0.3, 0.8], fov: 47, roll: -0.08 },
  { name: 'redline stunt / low angle', district: 'redline works', clip: 'wheelie', seconds: 2.2, eye: [2.8, 0.28, 3.3], look: [0, 1.05, 0], drift: [0.6, 0.2, -0.7], fov: 54 },
  { name: 'hologram boulevard', district: 'hologram plaza', clip: 'ride', seconds: 2, eye: [-3.5, 2.5, 4.2], look: [0, 0.8, 0], drift: [0.6, -0.3, -0.6], fov: 43 },
  { name: 'pink orbit / parked', district: 'hologram plaza', clip: 'idle', seconds: 2.4, eye: [3.8, 1.5, 1], look: [0, 0.9, 0], drift: [-0.3, 0.2, 1.1], fov: 40 },
  { name: 'last run / overhead', district: 'hologram plaza', clip: 'ride', seconds: 1.5, eye: [0.2, 5.8, -0.4], look: [0, 0, 0.2], drift: [0.7, -0.4, 0.6], fov: 45, roll: 0.12 },
  { name: 'last run / wheelie', district: 'hologram plaza', clip: 'wheelie', seconds: 2.2, eye: [-3.5, 0.9, 2.6], look: [0, 1.05, 0], drift: [-0.4, 0.2, -0.6], fov: 48 },
  { name: 'afterhours / taillight', district: 'rain street', clip: 'idle', seconds: 2.6, eye: [-2.4, 0.9, -3.8], look: [0, 0.88, 0], drift: [0.5, 0.2, -0.2], fov: 39 },
  { name: 'afterburner / exhaust macro', district: 'light tunnel', clip: 'ride', motion: 'launch', seconds: 1.8, eye: [-1.6, 0.85, -2.3], look: [-0.13, 0.7, -0.55], drift: [0.2, 0.1, 0.3], fov: 41 },
  { name: 'warehouse burnout', district: 'redline works', clip: 'ride', motion: 'burnout', seconds: 2.5, eye: [-2.8, 0.55, -2], look: [0, 0.5, -0.3], drift: [0.3, 0.12, 0.3], fov: 43 },
  { name: 'front-wheel balance', district: 'rain street', clip: 'ride', motion: 'stoppie', seconds: 2.2, eye: [3.1, 0.8, 2.6], look: [0, 0.68, 0], drift: [-0.3, 0.15, -0.5], fov: 43 },
  { name: 'skyway hop / landing', district: 'skyway', clip: 'ride', motion: 'jump', seconds: 2.1, eye: [-3.1, 0.65, 1.4], look: [0, 0.65, 0], drift: [0.2, 0.2, 0.5], fov: 43 },
  { name: 'twin-lane slalom', district: 'light tunnel', clip: 'ride', motion: 'slalom', seconds: 2.5, eye: [0.1, 1.3, -3.7], look: [0, 0.58, 0], drift: [-0.1, -0.2, 0.3], fov: 47 },
  { name: 'taillight / brake flick', district: 'hologram plaza', clip: 'lean_R', motion: 'drift', seconds: 2, eye: [2.6, 0.38, -2.9], look: [0, 0.5, -0.2], drift: [-0.3, 0.15, 0.1], fov: 44 },
  { name: 'hologram / full rotation', district: 'hologram plaza', clip: 'idle', motion: 'orbit', seconds: 3.2, eye: [3.1, 1.15, 2.7], look: [0, 0.55, 0], drift: [0, 0.1, -0.2], fov: 38 },
  { name: 'redline / drag launch', district: 'redline works', clip: 'ride', motion: 'launch', seconds: 2.2, eye: [-2.5, 0.3, 3], look: [0, 0.5, 0], drift: [0.4, 0.1, -0.8], fov: 48 },
];

const PALETTES: Record<District, { sky: number; haze: number; primary: number; accent: number }> = {
  'rain street': { sky: 0x020613, haze: 0x08152a, primary: 0x2ce5ed, accent: 0xff287f },
  'light tunnel': { sky: 0x01030a, haze: 0x08132a, primary: 0x22dcff, accent: 0x8956ff },
  skyway: { sky: 0x050c20, haze: 0x152244, primary: 0x42adff, accent: 0xff397c },
  'dusk overlook': { sky: 0x231533, haze: 0x54294d, primary: 0xe368c2, accent: 0xffb282 },
  'redline works': { sky: 0x10030c, haze: 0x260c24, primary: 0xff3155, accent: 0xff972b },
  'hologram plaza': { sky: 0x0c0422, haze: 0x20113c, primary: 0xe049ff, accent: 0x35ffe4 },
};

export function createNightRiderMode(budget: QualityBudget = presetBudget('balanced'), riderV2 = false): VisualMode {
  const { scene, camera } = sceneDefaults(4);
  camera.near = 0.035; camera.far = 380;
  const random = seededRandom(60707), time = uniform(0), travel = uniform(0), energy = uniform(0.2);
  const primary = uniform(new THREE.Color(0x2ce5ed)), accent = uniform(new THREE.Color(0xff287f));
  const skyLow = uniform(new THREE.Color(0x08152a)), skyHigh = uniform(new THREE.Color(0x020613));
  const wet = uniform(1), speed = uniform(0), flash = uniform(0);
  scene.background = new THREE.Color(0x020613);
  const fog = new THREE.FogExp2(0x08152a, 0.017); scene.fog = fog;
  const actor = new THREE.Group(); actor.name = 'night rider / bike only'; scene.add(actor);
  const throttle = createNightRiderThrottle(), effects = createNightRiderEffects(scene, budget);
  let shotIndex = 0, elapsed = 0, clipClock = 0, wheelClock = 0, lastOnset = false, shotSerial = 0, boundSerial = -1;

  // Gradated sky, horizon haze and a fine halftone moon keep the wide shots composed.
  const skyMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, fog: false, depthWrite: false });
  const skyY = positionLocal.y.div(290).max(0);
  skyMaterial.colorNode = mix(skyLow, skyHigh, skyY.smoothstep(0, 0.65));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(290, 32, 20), skyMaterial));
  const moonMaterial = new THREE.MeshBasicNodeMaterial({ fog: false });
  moonMaterial.colorNode = mix(accent, vec3(0.6, 0.8, 1), 0.45).mul(0.8)
    .mul(sin(positionLocal.y.mul(27)).smoothstep(-0.85, -0.65).mul(0.25).add(0.75));
  const moon = new THREE.Mesh(new THREE.SphereGeometry(11, 40, 24), moonMaterial);
  moon.position.set(-36, 36, -145); scene.add(moon);

  // A single wet-road shader: moving lane paint, broken reflections and fine asphalt grain.
  const roadMaterial = new THREE.MeshBasicNodeMaterial();
  const roadP = positionWorld.xz, movingZ = roadP.y.sub(travel);
  const roadNoise = fract(sin(roadP.x.mul(163).add(roadP.y.mul(57))).mul(43758.5));
  const lane = abs(roadP.x).sub(2.1).abs().smoothstep(0.045, 0.015).mul(fract(movingZ.div(4)).lessThan(0.46).select(float(1), float(0)));
  const edge = abs(abs(roadP.x).sub(4.7)).smoothstep(0.055, 0.02);
  const shine = sin(movingZ.mul(2.3).add(sin(roadP.x.mul(11)))).mul(0.3).add(0.7);
  const pools = roadP.x.abs().smoothstep(5, 1).mul(movingZ.abs().smoothstep(18, 0)).mul(shine);
  roadMaterial.colorNode = vec3(0.009, 0.014, 0.03).mul(roadNoise.mul(0.4).add(0.8))
    .add(primary.mul(lane.mul(0.32).add(edge.mul(0.7))))
    .add(mix(primary, accent, sin(roadP.x.mul(0.6)).mul(0.5).add(0.5)).mul(pools).mul(wet).mul(0.09));
  const road = new THREE.Mesh(new THREE.PlaneGeometry(150, 320), roadMaterial); road.rotation.x = -Math.PI / 2; road.position.y = -0.012; scene.add(road);

  // The bike stays near the camera; instanced scenery scrolls past in the opposite direction.
  const box = new THREE.BoxGeometry(1, 1, 1), dummy = new THREE.Object3D();
  const cityMaterial = new THREE.MeshBasicNodeMaterial();
  const windows = vec2(abs(normalLocal.x).greaterThan(0.5).select(positionWorld.z, positionWorld.x).mul(2.1), positionWorld.y.mul(2.5));
  const cell = windows.floor(), pane = fract(windows);
  const lit = fract(sin(cell.x.mul(127.1).add(cell.y.mul(311.7))).mul(43758.5453)).greaterThan(0.68);
  const mask = pane.x.greaterThan(0.22).and(pane.x.lessThan(0.72)).and(pane.y.greaterThan(0.2)).and(pane.y.lessThan(0.65)).and(lit).select(float(1), float(0));
  cityMaterial.colorNode = vec3(0.012, 0.019, 0.043).mul(normalWorld.y.mul(0.3).add(0.8))
    .add(mix(primary, accent, fract(cell.y.mul(0.147))).mul(mask).mul(0.19));
  const towerCount = budget.preset === 'compatibility' ? 110 : 180;
  const city = new THREE.InstancedMesh(box, cityMaterial, towerCount); city.name = 'parallax megacity';
  for (let i = 0; i < towerCount; i++) {
    const side = i % 2 ? -1 : 1, height = 6 + random() ** 1.8 * 39;
    dummy.position.set(side * (9 + random() * 65), height / 2 - 0.1, -110 + random() * 220);
    dummy.scale.set(2.5 + random() * 5, height, 3 + random() * 6); dummy.updateMatrix(); city.setMatrixAt(i, dummy.matrix);
  }
  // Apply travel in the vertex stage, keeping city and facade windows in the same world coordinates.
  const movingCityMaterial = cityMaterial;
  const cityInstances = new Float32Array(towerCount * 2);
  for (let i = 0; i < towerCount; i++) { city.getMatrixAt(i, dummy.matrix); cityInstances.set([dummy.matrix.elements[14], dummy.matrix.elements[10]], i * 2); }
  const instance = instancedBufferAttribute<'vec2'>(new THREE.InstancedBufferAttribute(cityInstances, 2), 'vec2');
  movingCityMaterial.positionNode = positionLocal.add(vec3(0, 0, fract(instance.x.add(travel).add(110).div(220)).mul(220).sub(110).sub(instance.x).div(instance.y)));
  city.frustumCulled = false;
  scene.add(city);

  const dark = new THREE.MeshBasicNodeMaterial({ color: 0x10162d });
  const glow = new THREE.MeshBasicNodeMaterial(); glow.colorNode = primary.mul(energy.mul(0.35).add(1.2));
  const pink = new THREE.MeshBasicNodeMaterial(); pink.colorNode = accent.mul(1.4);
  const addBox = (group: THREE.Group, material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const mesh = new THREE.Mesh(box, material); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); group.add(mesh); return mesh;
  };
  const street = new THREE.Group(), tunnel = new THREE.Group(), skyway = new THREE.Group(), overlook = new THREE.Group(), works = new THREE.Group(), plaza = new THREE.Group();
  const sets = { 'rain street': street, 'light tunnel': tunnel, skyway, 'dusk overlook': overlook, 'redline works': works, 'hologram plaza': plaza };
  for (const [name, group] of Object.entries(sets)) { group.name = name; group.visible = false; scene.add(group); }

  // Original sign graphics, drawn as geometry: no downloaded fonts, logos or background plates.
  const storefront = new THREE.Group(); storefront.position.set(-6.5, 0, -2); street.add(storefront);
  addBox(storefront, dark, 0, 1.7, 0, 2, 3.4, 7);
  addBox(storefront, pink, 1.03, 2.7, 0, 0.04, 0.18, 6.5);
  for (let i = 0; i < 5; i++) {
    addBox(storefront, glow, 1.04, 1.5, -2.6 + i * 1.3, 0.05, 1.7, 0.035);
    addBox(storefront, dark, 1.09, 1.5, -2.1 + i * 1.3, 0.04, 1.5, 0.85);
  }
  for (let i = 0; i < 12; i++) {
    const z = -70 + i * 12;
    addBox(street, dark, 5.3, 2.6, z, 0.09, 5.2, 0.09);
    addBox(street, glow, 4.85, 5.2, z, 1, 0.06, 0.1);
  }
  for (let i = 0; i < 14; i++) {
    const z = -75 + i * 12, mat = i % 3 ? glow : pink;
    addBox(tunnel, dark, -5, 1.85, z, 0.5, 3.7, 0.7); addBox(tunnel, dark, 5, 1.85, z, 0.5, 3.7, 0.7);
    addBox(tunnel, dark, 0, 3.7, z, 10.5, 0.5, 0.7);
    addBox(tunnel, mat, -4.7, 1.85, z - 0.4, 0.08, 3.7, 0.08); addBox(tunnel, mat, 4.7, 1.85, z - 0.4, 0.08, 3.7, 0.08);
    addBox(tunnel, mat, 0, 3.55, z - 0.4, 9.4, 0.08, 0.08);
  }
  addBox(tunnel, dark, -5.4, 2.1, 0, 0.3, 4.2, 200); addBox(tunnel, dark, 5.4, 2.1, 0, 0.3, 4.2, 200);
  addBox(tunnel, dark, 0, 4.2, 0, 11, 0.3, 200);
  for (const x of [-5.2, 5.2]) for (const y of [0.25, 1.2]) addBox(tunnel, glow, x, y, 0, 0.025, 0.035, 200);
  const railing = (group: THREE.Group, x: number, z: number, length: number) => {
    addBox(group, dark, x, 0.5, z, 0.16, 1, length);
    addBox(group, glow, x, 1.03, z, 0.04, 0.035, length);
    for (let i = 0; i < length / 3; i++) addBox(group, pink, x - Math.sign(x) * 0.09, 0.35, z - length / 2 + i * 3, 0.04, 0.12, 0.35);
  };
  railing(skyway, -5.1, 0, 165); railing(skyway, 5.1, 0, 165);
  railing(overlook, -5.1, -2, 22); railing(overlook, 5.1, -2, 22);
  addBox(overlook, dark, 0, 0.45, -10, 10, 0.9, 0.2); addBox(overlook, pink, 0, 0.94, -10, 10, 0.04, 0.04);
  for (let i = 0; i < 12; i++) {
    const z = -70 + i * 13;
    for (const x of [-7, 7]) {
      addBox(works, dark, x, 3.5, z, 0.5, 7, 0.5);
      addBox(works, pink, x * 0.96, 3, z - 0.3, 0.09, 5, 0.08);
    }
    addBox(works, dark, 0, 7, z, 14.5, 0.45, 0.65);
    for (let k = -2; k <= 2; k++) addBox(works, glow, k * 2, 6.75, z - 0.36, 0.8, 0.09, 0.06);
  }
  const rings: THREE.Mesh[] = [];
  const ringGeometry = new THREE.TorusGeometry(1, 0.012, 6, 64);
  for (let i = 0; i < 8; i++) {
    const x = i % 2 ? -6 : 6, z = -24 + Math.floor(i / 2) * 16;
    addBox(plaza, dark, x, 2.7, z, 1.5, 5.4, 1.5);
    const ring = new THREE.Mesh(ringGeometry, i % 2 ? pink : glow); ring.position.set(x, 5, z); ring.scale.setScalar(2.8); ring.rotation.x = 0.35;
    plaza.add(ring); rings.push(ring);
  }

  // Billboard towers live in every district; their graphics are a tiny original circuit alphabet.
  const signs = new THREE.Group(); signs.name = 'neon circuit signs'; scene.add(signs);
  for (let i = 0; i < 18; i++) {
    const x = (i % 2 ? -1 : 1) * (7.5 + random() * 3), z = -65 + i * 8, h = 2.2 + random() * 4;
    addBox(signs, dark, x, h + 1.5, z, 0.16, 3.2, 1.2);
    const mat = i % 3 ? glow : pink;
    for (let k = 0; k < 4; k++) {
      addBox(signs, mat, x - Math.sign(x) * 0.1, h + k * 0.65 + 0.45, z, 0.04, 0.06, 0.65);
      addBox(signs, mat, x - Math.sign(x) * 0.1, h + k * 0.65 + 0.6, z + (k % 2 ? -0.25 : 0.25), 0.04, 0.3, 0.06);
    }
  }

  // Bake static set pieces by material; hundreds of sign/railing bars become three draws per set.
  for (const group of [...Object.values(sets), signs]) {
    group.updateMatrixWorld(true);
    const inverse = group.matrixWorld.clone().invert(), batches = new Map<THREE.Material, THREE.BufferGeometry[]>(), originals: THREE.Mesh[] = [];
    group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || mesh.geometry !== box) return;
      const material = mesh.material as THREE.Material;
      const batch = batches.get(material) ?? []; batches.set(material, batch);
      batch.push(box.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld))); originals.push(mesh);
    });
    for (const mesh of originals) mesh.removeFromParent();
    for (const [material, geometries] of batches) {
      group.add(new THREE.Mesh(mergeGeometries(geometries)!, material)); geometries.forEach((part) => part.dispose());
    }
  }

  // A soft contact shadow grounds the real wheels without adding a shadow-map pass.
  const shadowMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  shadowMaterial.colorNode = vec3(0.001, 0.002, 0.005);
  shadowMaterial.opacityNode = uv().sub(0.5).length().smoothstep(0.5, 0.15).mul(0.8);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 3.4), shadowMaterial); shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.003; scene.add(shadow);
  const underMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  underMaterial.colorNode = primary;
  underMaterial.opacityNode = uv().sub(0.5).length().smoothstep(0.5, 0.06).mul(0.16);
  const under = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.2), underMaterial); under.rotation.x = -Math.PI / 2; under.position.y = 0.006; scene.add(under);

  const models = whenLoaded(riderV2 ? [bikeUrl, riderV2Url] : [bikeUrl], ([bikeGltf, characterGltf]) => {
    const bike = instantiate(bikeGltf);
    const ownedMaterials = new Map<THREE.Material, THREE.Material>();
    for (const figure of [bike]) {
      figure.root.traverse((object) => {
        const mesh = object as THREE.Mesh; if (!mesh.isMesh) return;
        mesh.geometry = mesh.geometry.clone();
        const shade = (old: THREE.Material) => {
          let material = ownedMaterials.get(old); if (material) return material;
          const source = old as THREE.MeshStandardMaterial;
          const m = new THREE.MeshBasicNodeMaterial({ side: source.side, transparent: source.transparent, opacity: source.opacity, depthWrite: source.depthWrite });
          m.name = source.name;
          const diffuse = normalWorld.dot(vec3(-0.35, 0.75, 0.55).normalize()).max(0);
          const bands = diffuse.smoothstep(0.15, 0.18).mul(0.38).add(diffuse.smoothstep(0.63, 0.66).mul(0.3)).add(0.32);
          const edge = abs(normalView.z).smoothstep(0.015, 0.16);
          const rim = abs(normalView.z).oneMinus().pow(4).mul(0.16);
          m.colorNode = vec3(source.color.r, source.color.g, source.color.b).mul(bands).mul(edge.mul(0.8).add(0.2))
            .add(mix(primary, accent, normalWorld.x.mul(0.5).add(0.5)).mul(rim).mul(energy.mul(0.3).add(0.7)))
            .add(vec3(0.2, 0.025, 0.005).mul(effects.heat).mul(diffuse))
            .add(vec3(source.emissive.r, source.emissive.g, source.emissive.b).mul(1.2));
          ownedMaterials.set(old, material = m); return material;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(shade) : shade(mesh.material);
      });
      // instantiate's standard materials were replaced by the local cel materials above.
      figure.materials.forEach((material) => material.dispose());
    }
    actor.add(bike.root);
    const character = characterGltf ? createNightRiderV2Character(characterGltf, bike.node('Frame')) : undefined;
    // Emission point measured on the supplied outlet rim, in the exhaust mesh's own coordinates.
    const outlet = new THREE.Object3D(); outlet.name = 'animated exhaust outlet';
    outlet.position.set(-0.13, 0.760834, -0.908884); bike.node('exhaust_tip').add(outlet);
    const mixer = new THREE.AnimationMixer(bike.root);
    scene.userData.assetsLoaded = true;
    return { bike, mixer, outlet, character, action: undefined as THREE.AnimationAction | undefined };
  });

  // Fine rain and long road streaks are instanced; counts respect the existing quality tiers.
  const drops = Math.round(700 * Math.min(1.5, budget.particleScale)), seeds = new Float32Array(drops * 4);
  for (let i = 0; i < drops; i++) seeds.set([(random() - 0.5) * 36, random(), (random() - 0.5) * 70, random()], i * 4);
  const seed = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(seeds, 4), 'vec4');
  const rainMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  rainMaterial.positionNode = vec3(seed.x.add(time.mul(0.3).sin().mul(0.2)), fract(seed.y.sub(time.mul(0.8))).mul(12), fract(seed.z.add(travel).add(35).div(70)).mul(70).sub(35));
  rainMaterial.scaleNode = vec2(0.008, seed.w.mul(0.22).add(0.08));
  rainMaterial.colorNode = mix(primary, vec3(0.6, 0.7, 1), 0.6);
  rainMaterial.opacityNode = uv().sub(0.5).mul(vec2(1, 0.4)).length().smoothstep(0.5, 0.1).mul(wet).mul(0.24);
  const rain = new THREE.Sprite(rainMaterial); rain.geometry = rain.geometry.clone(); rain.count = drops; rain.frustumCulled = false; rain.name = 'neon rain'; scene.add(rain);
  const streakMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  streakMaterial.positionNode = vec3(seed.x.mul(0.4).add(seed.x.greaterThan(0).select(float(2), float(-2))), 0.06, fract(seed.y.add(travel.mul(0.025))).mul(80).sub(40));
  const boost = uniform(0);
  streakMaterial.scaleNode = vec2(0.018, seed.w.mul(1.8).add(0.4).mul(boost.mul(1.8).add(1))); streakMaterial.rotationNode = float(Math.PI / 2);
  streakMaterial.colorNode = mix(primary, accent, seed.w).mul(1.1);
  streakMaterial.opacityNode = uv().sub(0.5).length().smoothstep(0.5, 0.1).mul(speed).mul(0.45);
  const streaks = new THREE.Sprite(streakMaterial); streaks.geometry = streaks.geometry.clone(); streaks.count = Math.min(110, drops); streaks.frustumCulled = false; streaks.name = 'road light streaks'; scene.add(streaks);

  const look = new THREE.Vector3(), eye = new THREE.Vector3(), origin = new THREE.Vector3(), direction = new THREE.Vector3(), contact = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), pivot = new THREE.Vector3(0, 0.3, 0.7), rotatedPivot = new THREE.Vector3();
  let district: District | undefined;
  const update = (frame: ModeFrame) => {
    resizeCamera(camera, frame.aspect);
    const dt = frame.reducedMotion ? 0 : THREE.MathUtils.clamp(frame.delta, 0, 0.1);
    const settle = frame.reducedMotion ? 1 / 60 : dt;
    const onset = frame.audio.onset && !lastOnset; lastOnset = frame.audio.onset;
    throttle.update(frame); boost.value = throttle.boost;
    let shot = NIGHT_RIDER_SHOTS[shotIndex];
    elapsed += dt; time.value += dt;
    // Finish leans, landings and complete rotations before cutting.
    const protectedShot = (s: Shot) => !['ride', 'idle'].includes(s.clip) || ['stoppie', 'jump', 'orbit', 'slalom'].includes(s.motion ?? '');
    const actionShot = protectedShot(shot);
    const minHold = shot.seconds * (shot.clip === 'idle' ? 0.72 : 0.7);
    if (dt > 0 && (elapsed >= shot.seconds || (!actionShot && onset && frame.response.impact > 0.42 && elapsed >= minHold))) {
      shotIndex = (shotIndex + 1) % NIGHT_RIDER_SHOTS.length; elapsed = 0; clipClock = wheelClock = 0; shotSerial++; shot = NIGHT_RIDER_SHOTS[shotIndex];
      flash.value = frame.reducedFlash ? 0 : Math.min(0.13, frame.response.impact * 0.13);
    }
    if (district !== shot.district) {
      district = shot.district; const palette = PALETTES[district];
      primary.value.setHex(palette.primary); accent.value.setHex(palette.accent);
      skyHigh.value.setHex(palette.sky); skyLow.value.setHex(palette.haze); fog.color.setHex(palette.haze);
      fog.density = district === 'light tunnel' ? 0.033 : district === 'dusk overlook' ? 0.006 : 0.014;
      city.visible = district !== 'light tunnel';
      city.position.y = district === 'dusk overlook' ? -21 : district === 'skyway' ? -15 : district === 'hologram plaza' ? -5 : 0;
      moon.scale.setScalar(district === 'dusk overlook' ? 1.7 : 1);
      moon.position.y = district === 'dusk overlook' ? 22 : 36;
      for (const [name, group] of Object.entries(sets)) group.visible = name === district;
      moon.visible = district !== 'light tunnel'; signs.visible = district !== 'light tunnel';
      wet.value = district === 'rain street' ? 1 : district === 'dusk overlook' ? 0 : 0.3;
    }
    const moving = shot.clip !== 'idle' && shot.clip !== 'dismount' && shot.motion !== 'burnout';
    const velocity = moving ? 10 + frame.response.bass * 9 + Math.min(4, frame.response.bounce * (frame.sensitivity ?? 1.8)) + throttle.boost * 12 : 0;
    travel.value = wrap(travel.value - dt * velocity, -22000, 22000);
    speed.value = approach(speed.value, moving ? 0.35 + frame.response.loudness * 0.6 + throttle.boost * 0.3 : 0, settle, 0.2);
    energy.value = approach(energy.value, 0.2 + frame.response.loudness * 0.6 + (frame.reducedFlash ? 0 : frame.response.impact * 0.12), settle, 0.2);
    flash.value = frame.reducedFlash ? 0 : flash.value * Math.exp(-settle * 18);
    // Recycle the light arches continuously; all other sets have their own parallax cadence.
    const offset = moving ? wrap(travel.value, -6, 6) : 0;
    tunnel.position.z = offset; works.position.z = moving ? wrap(travel.value, -6.5, 6.5) : 0;
    street.position.z = moving ? wrap(travel.value, -6, 6) : 0; signs.position.z = moving ? wrap(travel.value, -4, 4) : 0;
    for (let i = 0; i < rings.length; i++) { rings[i].rotation.y = time.value * 0.3 + i; rings[i].rotation.z = time.value * 0.12; }
    const built = models.value;
    const phase = Math.min(1, elapsed / shot.seconds), envelope = Math.sin(phase * Math.PI);
    const drifting = shot.motion === 'drift' ? envelope : shot.motion === 'slalom' ? Math.abs(Math.sin(phase * Math.PI * 2)) * 0.7 : 0;
    if (built) {
      if (boundSerial !== shotSerial) {
        built.mixer.stopAllAction();
        built.action = built.mixer.clipAction(built.bike.clips.get(shot.clip)!);
        built.action.reset().setLoop(['ride', 'idle'].includes(shot.clip) ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        built.action.clampWhenFinished = true; built.action.play();
        boundSerial = shotSerial;
      }
      clipClock += dt * (shot.motion === 'burnout' ? 3 : moving ? 0.8 + velocity * 0.025 : 1);
      const duration = built.action!.getClip().duration;
      built.mixer.setTime(['ride', 'idle'].includes(shot.clip) ? clipClock : Math.min(duration - 0.0001, phase * duration));
      // The original lean clips do not key the wheels; keep them rolling through the drift.
      wheelClock += dt * velocity / 0.31;
      if (moving && !['ride', 'wheelie'].includes(shot.clip)) {
        built.bike.node('FrontWheel').rotation.x = wheelClock; built.bike.node('RearWheel').rotation.x = wheelClock;
      }
      if (shot.motion === 'burnout') built.bike.node('FrontWheel').rotation.x = 0;
      actor.position.set(0, 0, 0); actor.rotation.set(0, 0, 0);
      const side = shot.clip === 'lean_R' ? -1 : 1;
      if (shot.motion === 'drift') { actor.rotation.y = side * envelope * 0.4; actor.position.x = side * envelope * 0.35; }
      if (shot.motion === 'slalom') { const sway = Math.sin(phase * Math.PI * 2); actor.rotation.set(0, sway * 0.2, -sway * 0.18); actor.position.x = sway * 0.55; }
      if (shot.motion === 'orbit') actor.rotation.y = phase * Math.PI * 2;
      if (shot.motion === 'jump') { actor.position.y = envelope * 0.35; actor.rotation.x = Math.sin(phase * Math.PI * 2) * 0.1; }
      if (shot.motion === 'launch') actor.position.z = -0.3 + phase * 0.6;
      if (shot.motion === 'stoppie') {
        actor.rotation.x = envelope * 0.62;
        actor.position.copy(pivot).sub(rotatedPivot.copy(pivot).applyEuler(actor.rotation));
      }
      built.character?.update(shot.clip, phase, time.value, throttle.boost, shot.motion);
      actor.updateMatrixWorld(true);
      built.outlet.getWorldPosition(origin); direction.set(0, 1, -1).transformDirection(built.outlet.matrixWorld);
      built.bike.node('RearWheel').getWorldPosition(contact); contact.y = 0.025;
      effects.update(frame, origin, direction, contact, throttle, drifting, shot.motion === 'burnout', velocity, shotSerial);
    }
    const aspectScale = frame.aspect < 1.25 ? 1.25 / frame.aspect : 1;
    eye.set(...shot.eye).addScaledVector(look.set(...shot.drift), phase);
    look.set(...shot.look);
    // Give the V2 rider headroom in wide views; preserve the bike-only edition's framing.
    if (riderV2 && ![1, 6, 10, 24].includes(shotIndex)) { look.y += 0.24; eye.y += 0.2; eye.sub(look).multiplyScalar(1.13).add(look); }
    const framing = Math.hypot(shot.eye[0] - shot.look[0], shot.eye[1] - shot.look[1], shot.eye[2] - shot.look[2]) > 3 ? 0.8 : 1;
    eye.sub(look).multiplyScalar(aspectScale * framing).add(look);
    eye.sub(look).applyAxisAngle(up, (phase - 0.5) * (shot.orbit ?? 0)).add(look);
    const fov = shot.fov + (moving ? throttle.boost * 4 : 0);
    camera.position.copy(eye); camera.lookAt(look);
    camera.rotateZ((shot.roll ?? 0) * Math.sin(phase * Math.PI));
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    scene.userData.shot = shot.name; scene.userData.district = district; scene.userData.clip = shot.clip;
    scene.userData.shotIndex = shotIndex; scene.userData.elapsed = elapsed;
    scene.userData.clipTime = built?.action?.time;
    scene.userData.motion = shot.motion ?? 'authored';
    if (riderV2) scene.userData.rider = 'experimental auto-rig / supplied textured character';
    scene.userData.effects = { boost: throttle.boost, bursts: throttle.bursts, ...effects.stats, velocity };
  };

  return {
    scene, camera, ready: models.ready, update,
    // A restrained anime finish: small edge vignette and grain, no blur over the model's livery.
    filter(input) {
      const p = uv(), edge = p.sub(0.5).mul(vec2(1, 0.72)).length();
      const grain = fract(sin(p.x.mul(1271).add(p.y.mul(3117)).add(time.mul(11))).mul(43758)).sub(0.5).mul(0.012);
      const shade = edge.smoothstep(0.75, 0.2).mul(0.18).add(0.82);
      return vec4(input.sample(p).rgb.mul(shade).add(vec3(grain)).add(primary.mul(flash).mul(0.06)).max(vec3(0)), 1);
    },
    dispose() {
      const built = models.value;
      if (built) { built.character?.dispose(); built.mixer.stopAllAction(); built.mixer.uncacheRoot(built.mixer.getRoot()); }
      effects.dispose(); models.dispose(); disposeScene(scene);
    },
  };
}
