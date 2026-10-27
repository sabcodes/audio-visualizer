import * as THREE from 'three/webgpu';
import { abs, exp, float, instancedBufferAttribute, max, mix, mx_noise_float, normalize, positionLocal, positionWorld, uniform, vec3 } from 'three/tsl';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { VisualMode } from './types';
import { approach, disposeScene, resizeCamera, sceneDefaults, settleStep, wrap } from './shared';
import { createHits, linearRgb, variantSequence } from './hitPulse';
import { drive, isSnare } from './waveSixShared';
import { whenLoaded } from './figures';
import { seededRandom } from '../rendering/diagnostics';
import { presetBudget, type QualityBudget } from '../rendering/quality';
import bridgeUrl from '../assets/wave6/gg_bridge.glb?url';
import terrainUrl from '../assets/wave6/gg_terrain.glb?url';

// The asset's contract: +Y up, +Z north, +X east, 1 unit = 1 m, origin at mid-span on the centreline at the waterline.
export const GG = { deck: 75, towerZ: 640.08, towerTop: 227.8, sag: 84.54, anchorZ: 983, anchorY: 74.56, cableX: 17.2 } as const;

/** A lane (or cable) as a polyline that only ever moves north: looked up by z, walked by arc length in the y–z plane. */
export class LanePath {
  readonly zs: Float32Array;
  readonly ys: Float32Array;
  readonly arc: Float32Array;
  readonly length: number;
  constructor(readonly x: number, points: readonly (readonly [number, number])[]) {
    this.zs = Float32Array.from(points, (p) => p[0]);
    this.ys = Float32Array.from(points, (p) => p[1]);
    this.arc = new Float32Array(points.length);
    for (let i = 1; i < points.length; i++) this.arc[i] = this.arc[i - 1] + Math.hypot(this.zs[i] - this.zs[i - 1], this.ys[i] - this.ys[i - 1]);
    this.length = this.arc[points.length - 1];
  }
  private segment(values: Float32Array, v: number) {
    let low = 0, high = values.length - 1;
    while (high - low > 1) { const mid = (low + high) >> 1; if (values[mid] <= v) low = mid; else high = mid; }
    const span = values[high] - values[low];
    return { i: low, f: span > 0 ? Math.min(1, Math.max(0, (v - values[low]) / span)) : 0 };
  }
  /** Height at z (clamped to the ends). */
  yAt(z: number) { const { i, f } = this.segment(this.zs, z); return this.ys[i] + (this.ys[i + 1] - this.ys[i]) * f; }
  /** Arc length at z. */
  arcAt(z: number) { const { i, f } = this.segment(this.zs, z); return this.arc[i] + (this.arc[i + 1] - this.arc[i]) * f; }
  /** Point at arc length s (clamped); returns the slope angle, positive when climbing northward. */
  at(s: number, out: THREE.Vector3) {
    const { i, f } = this.segment(this.arc, s);
    const dz = this.zs[i + 1] - this.zs[i], dy = this.ys[i + 1] - this.ys[i];
    out.set(this.x, this.ys[i] + dy * f, this.zs[i] + dz * f);
    return Math.atan2(dy, dz);
  }
}

/** The main cable's centreline before the model arrives: parabolic main span, straight backstays. */
export function analyticCableY(z: number) {
  const a = Math.abs(z);
  if (a <= GG.towerZ) return GG.sag + (GG.towerTop - GG.sag) * (a / GG.towerZ) ** 2;
  return GG.towerTop + (GG.anchorY - GG.towerTop) * Math.min(1, (a - GG.towerZ) / (GG.anchorZ - GG.towerZ));
}

/**
 * Recovers a cable's centreline from its tube vertices: average x and y in z bins, then fill empty bins by
 * interpolation. The tubes are thin (0.9 m) next to their length, so the bin average sits on the axis.
 */
export function cableProfile(positions: readonly ArrayLike<number>[], z0 = -GG.anchorZ, z1 = GG.anchorZ, step = 4) {
  const bins = Math.round((z1 - z0) / step) + 1, sumY = new Float64Array(bins), sumX = new Float64Array(bins), count = new Uint32Array(bins);
  for (const p of positions) for (let i = 0; i < p.length; i += 3) {
    const b = Math.round((p[i + 2] - z0) / step);
    if (b < 0 || b >= bins) continue;
    sumX[b] += p[i]; sumY[b] += p[i + 1]; count[b]++;
  }
  const known: number[] = [];
  for (let b = 0; b < bins; b++) if (count[b]) known.push(b);
  if (known.length < 2) return undefined;
  let x = 0;
  for (const b of known) x += sumX[b] / count[b];
  const points: [number, number][] = [];
  let k = 0;
  for (let b = 0; b < bins; b++) {
    while (k < known.length - 2 && known[k + 1] < b) k++;
    const a = known[k], c = known[k + 1], ya = sumY[a] / count[a], yc = sumY[c] / count[c];
    const y = count[b] ? sumY[b] / count[b] : ya + (yc - ya) * Math.min(1, Math.max(0, (b - a) / (c - a)));
    points.push([z0 + b * step, y]);
  }
  return new LanePath(x / known.length, points);
}

/** The fallback road before the lanes load: down the approaches, level across the suspended span. */
const defaultLane = (x: number) => new LanePath(x, [[-1344, 55], [-GG.anchorZ, GG.deck], [GG.anchorZ, GG.deck], [1393, 58]]);

export interface ShotPose { eye: THREE.Vector3; look: THREE.Vector3; up: THREE.Vector3; fov: number; near: number }
export interface ShotContext {
  /** Arc length of the camera car on its lane; the drive shots ride with the traffic. */
  ride: number;
  lane: LanePath;
  /** West and east cable centrelines. */
  cables: readonly [LanePath, LanePath];
}
type Shot = { name: string; pose(t: number, c: ShotContext, out: ShotPose): void };
const v = new THREE.Vector3();
const set = (out: ShotPose, fov: number, near = 1) => { out.fov = fov; out.near = near; out.up.set(0, 1, 0); };

/**
 * Camera set-ups across the whole bridge: the seven views the model ships with, plus rides along the road, the
 * sidewalk, the cable and up a tower, orbits, a telephoto zoom from the east shore and views from the water.
 * `t` is seconds into the shot (0 throughout with reduced motion, so each shot holds still).
 */
export const GG_SHOTS: readonly Shot[] = [
  { name: 'hero aerial', pose(t, _c, o) { o.eye.set(1200 - t * 9, 650 - t * 4, -1500 + t * 11); o.look.set(40, 110, -60 + t * 4); set(o, 32, 2); } },
  { name: 'side elevation zoom', pose(t, _c, o) { o.eye.set(-4000, 120, 0); o.look.set(0, 125, -t * 12); set(o, Math.max(5, 15 - t * 0.8), 4); } },
  { name: 'north vista', pose(t, _c, o) { o.eye.set(150, 34, 1020); o.look.set(5.6 + Math.sin(t * 0.12) * 40, 107 + t * 0.6, 654); set(o, 32); } },
  { name: 'tower top down', pose(t, _c, o) { o.eye.set(0, 300, -640.08); o.look.set(0, 0, -640); set(o, 52); o.up.set(Math.sin(t * 0.05), 0, Math.cos(t * 0.05)); } },
  { name: 'under deck', pose(t, _c, o) { o.eye.set(0, 60, -300 - t * 9); o.look.set(0, 66, o.eye.z - 400); set(o, 52, 0.5); } },
  { name: 'sidewalk walk', pose(t, _c, o) { o.eye.set(-10.975, 76.95, -300 - t * 1.6); o.look.set(-11, 92, -700); set(o, 58, 0.2); } },
  {
    name: 'drive', pose(_t, c, o) {
      c.lane.at(c.ride, v); o.eye.set(v.x, v.y + 1.25, v.z);
      c.lane.at(c.ride + 60, v); o.look.set(v.x - 0.4, v.y + 3, v.z); set(o, 62, 0.2);
    },
  },
  {
    name: 'chase high', pose(_t, c, o) {
      c.lane.at(c.ride - 30, v); o.eye.set(v.x + 9, v.y + 13, v.z);
      c.lane.at(c.ride + 50, v); o.look.set(v.x, v.y, v.z); set(o, 55, 0.3);
    },
  },
  { name: 'tower climb', pose(t, _c, o) { const y = Math.min(GG.towerTop + 25, 82 + t * 10); o.eye.set(42, y, -610); o.look.set(-6, y * 0.6 + 70, GG.towerZ); set(o, 46, 0.5); } },
  {
    name: 'cable ride', pose(t, c, o) {
      // From the low point at mid-span up the west main cable towards the north tower.
      const z = Math.min(560, 40 + t * 22), cable = c.cables[0];
      o.eye.set(cable.x - 10, cable.yAt(z) + 5, z);
      o.look.set(cable.x, cable.yAt(z + 60) + 2, z + 60); set(o, 60, 0.3);
    },
  },
  { name: 'tower top orbit', pose(t, _c, o) { const a = 0.6 + t * 0.07; o.eye.set(Math.cos(a) * 95, 252, GG.towerZ + Math.sin(a) * 95); o.look.set(0, 205, GG.towerZ); set(o, 48); } },
  { name: 'water level', pose(t, _c, o) { o.eye.set(70 - t * 3, 7, -540); o.look.set(0, 72, -300); set(o, 56); } },
  { name: 'telephoto beacon', pose(t, _c, o) { o.eye.set(2600, 90, -900); o.look.set(0, 226, -GG.towerZ); set(o, Math.max(2.4, 5 - t * 0.18), 10); } },
  { name: 'overhead flyover', pose(t, _c, o) { o.eye.set(36, 330, -900 + t * 28); o.look.set(0, GG.deck, o.eye.z + 220); set(o, 50, 2); } },
  { name: 'median look-up', pose(t, _c, o) { o.eye.set(0, 77, -505 - t * 1.2); o.look.set(0, 215, -GG.towerZ); set(o, 72, 0.2); } },
  { name: 'helicopter sweep', pose(t, _c, o) { const a = -0.3 + t * 0.085; o.eye.set(Math.cos(a) * 270, 165 + Math.sin(t * 0.3) * 15, -GG.towerZ + Math.sin(a) * 270); o.look.set(0, 140, -GG.towerZ); set(o, 46); } },
  { name: 'fort point arch', pose(t, _c, o) { o.eye.set(-70 + t * 2, 14, -1235); o.look.set(0, 66, -1150); set(o, 56); } },
  { name: 'lamp line', pose(t, _c, o) { o.eye.set(14.5, 79, -150 - t * 3); o.look.set(13, 82, -900); set(o, 40, 0.3); } },
];

/** One moving piece of traffic (a car part, a wheel or a light): where it sits on its lane and how it is turned. */
interface Rider { target: THREE.InstancedMesh; index: number; lane: number; s0: number; dx: number; dy: number; rel: THREE.Quaternion; scale: THREE.Vector3 }

/** Car body paint: mostly greys and whites with a few colours, as traffic at night reads. */
const CAR_PAINT = [0x9aa0a8, 0x3a3e44, 0xe8e8ea, 0x1a1c20, 0x7a1418, 0x1d3a6a, 0xb8b2a4, 0x2a4a3a];
const SPARKS_PER_CABLE = 12, TRAIL = 10;

/**
 * Golden Gate Bridge (wave 6): the user's real-scale model of the whole bridge and both shores at night. The
 * towers' light strips fill up with the bass like a level meter and flash on hits, every hit sends a wave of light
 * along the street lamps from mid-span to the shores, the aviation beacons on the tower tops trade flashes, and the
 * traffic flows with the music: headlights flare on kicks and the tail lights brake on snares. Sparks ride the main
 * cables, thrown up towards the tower tops by each hit and falling back between them, over bands of light that
 * stream along the cables. The camera cuts between eighteen views: the model's own cameras, rides on the road,
 * the sidewalk and the cable, a tower climb, orbits, a telephoto zoom and views from the water.
 */
export function createGoldenGateMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  const perspective = camera as THREE.PerspectiveCamera;
  perspective.far = 14000;
  const random = seededRandom(1937);
  const fog = new THREE.FogExp2(0x070b16, 0.00016);
  scene.fog = fog;

  const time = uniform(0), lampLevel = uniform(1.2), lampFront = uniform(-1000), lampFlash = uniform(0);
  const towerFill = uniform(0.3), towerFlash = uniform(0), beaconN = uniform(1.5), beaconS = uniform(1.5);
  const headLevel = uniform(4), tailLevel = uniform(2), cableFlow = uniform(0), cableGlow = uniform(0.6), flood = uniform(0.1);

  // Night sky: deep blue overhead, a warm city glow low to the south-east, and a scatter of stars.
  const sky = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  const dir = normalize(positionLocal), height = dir.y.max(0);
  const cityGlow = max(dir.x.mul(0.6).sub(dir.z.mul(0.8)), 0).pow(2).mul(exp(height.mul(-9)));
  const stars = mx_noise_float(dir.mul(420)).smoothstep(0.55, 0.8).mul(height.smoothstep(0.08, 0.3)).mul(0.6);
  sky.colorNode = mix(vec3(0.016, 0.022, 0.045), vec3(0.002, 0.004, 0.012), height.pow(0.5)).add(vec3(0.09, 0.04, 0.015).mul(cityGlow)).add(stars);
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(12000, 32, 16), sky));
  scene.add(new THREE.HemisphereLight(0x2a3a5e, 0x0a0806, 0.9));
  const moon = new THREE.DirectionalLight(0x9aaad8, 0.7); moon.position.set(-1200, 1500, 800); scene.add(moon);

  // The bay: dark water with rippling reflections of the lamp lines and the floodlit towers.
  const water = new THREE.MeshStandardNodeMaterial({ roughness: 0.3, metalness: 0.1 });
  const ripple = mx_noise_float(vec3(positionWorld.x.mul(0.05), positionWorld.z.mul(0.5), time.mul(0.4))).mul(0.5).add(0.5);
  const lampStreak = exp(abs(positionWorld.x).sub(13).div(9).pow(2).negate()).mul(abs(positionWorld.z).lessThan(1300).select(float(1), float(0)));
  const towerStreak = exp(abs(positionWorld.z).sub(GG.towerZ).div(26).pow(2).negate()).mul(exp(positionWorld.x.div(45).pow(2).negate()));
  water.colorNode = vec3(0.004, 0.009, 0.016);
  water.emissiveNode = vec3(1, 0.42, 0.08).mul(lampStreak.mul(lampLevel).mul(0.12).add(towerStreak.mul(towerFill.mul(0.5).add(towerFlash)).mul(0.3))).mul(ripple.pow(3));
  const waterPlane = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000), water);
  waterPlane.rotation.x = -Math.PI / 2; scene.add(waterPlane);

  // Materials that replace the model's, by name. The steel picks up floodlight around the towers' bases.
  const orange = vec3(...linearRgb(0xc0362c));
  const steel = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0.25 });
  steel.colorNode = orange.mul(0.75);
  const nearTower = exp(abs(positionWorld.z).sub(GG.towerZ).div(30).pow(2).negate());
  steel.emissiveNode = orange.mul(nearTower.mul(positionWorld.y.div(GG.towerTop).oneMinus().max(0).mul(0.6).add(0.15)).add(0.025).mul(flood));
  // The main cables carry bands of light streaming along them.
  const cableSteel = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.3 });
  cableSteel.colorNode = orange.mul(0.75);
  const band = positionWorld.z.add(positionWorld.y.mul(0.5)).div(90).sub(cableFlow).fract();
  cableSteel.emissiveNode = vec3(1, 0.55, 0.25).mul(band.smoothstep(0.82, 0.97).mul(band.smoothstep(1, 0.98)).mul(cableGlow).mul(4).add(flood.mul(0.08)));
  const lampMaterial = new THREE.MeshBasicNodeMaterial();
  const sweep = exp(abs(positionWorld.z).sub(lampFront).div(70).pow(2).negate());
  lampMaterial.colorNode = vec3(1, 0.5, 0.12).mul(lampLevel.add(sweep.mul(lampFlash).mul(8)));
  const towerLight = new THREE.MeshBasicNodeMaterial();
  const fillHeight = towerFill.mul(GG.towerTop - GG.deck).add(GG.deck);
  towerLight.colorNode = vec3(1, 0.8, 0.55).mul(positionWorld.y.lessThan(fillHeight).select(float(3), float(0.25)).add(towerFlash.mul(5)));
  const beacon = (level: THREE.UniformNode<'float', number>) => { const m = new THREE.MeshBasicNodeMaterial(); m.colorNode = vec3(1, 0.03, 0.015).mul(level); return m; };
  const headMaterial = new THREE.MeshBasicNodeMaterial(); headMaterial.colorNode = vec3(1, 0.95, 0.85).mul(headLevel);
  const tailMaterial = new THREE.MeshBasicNodeMaterial(); tailMaterial.colorNode = vec3(1, 0.02, 0.02).mul(tailLevel);
  const asphalt = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0 });
  asphalt.colorNode = vec3(0.04, 0.04, 0.045);
  asphalt.emissiveNode = vec3(1, 0.45, 0.1).mul(lampLevel.mul(0.012));
  const plain = new Map<string, THREE.Material>();
  const replace = (old: THREE.Material, mesh: THREE.Mesh): THREE.Material => {
    switch (old.name) {
      case 'mat_steel_orange': return mesh.name.startsWith('main_cable') ? cableSteel : steel;
      case 'emissive_streetlight': return lampMaterial;
      case 'emissive_tower': return towerLight;
      case 'emissive_car_head': return headMaterial;
      case 'emissive_car_tail': return tailMaterial;
      case 'mat_asphalt': return asphalt;
      default: {
        let copy = plain.get(old.name);
        if (!copy) {
          const source = old as THREE.MeshStandardMaterial;
          const material = new THREE.MeshStandardNodeMaterial({ color: source.color, roughness: source.roughness, metalness: source.metalness, side: source.side });
          if (old.name === 'mat_glass') { material.roughness = 0.1; material.metalness = 0.6; }
          plain.set(old.name, copy = material);
        }
        return copy;
      }
    }
  };

  let lanes: LanePath[] = [0, 1, 2, 3, 4, 5].map((i) => defaultLane((i - 2.5) * 3.15));
  let cables: [LanePath, LanePath] = [-1, 1].map((side) => new LanePath(side * GG.cableX, Array.from({ length: 99 }, (_, i) => {
    const z = -GG.anchorZ + i * (2 * GG.anchorZ / 98); return [z, analyticCableY(z)] as const;
  }))) as [LanePath, LanePath];
  const laneDirection = [-1, -1, -1, 1, 1, 1];
  const riders: Rider[] = [], dynamic = new Set<THREE.InstancedMesh>();
  const beacons: THREE.Material[] = [];

  const models = whenLoaded([bridgeUrl, terrainUrl], ([bridge, terrain]: GLTF[]) => {
    for (const model of [bridge, terrain]) {
      // COLOR_0 holds the builder's part ids, not paint.
      model.scene.traverse((object) => { const mesh = object as THREE.Mesh; if (mesh.isMesh) mesh.geometry.deleteAttribute('color'); });
    }
    const root = bridge.scene;
    root.updateMatrixWorld(true);
    const extras = root.getObjectByName('lanes')?.userData as { lanes?: [number, number, number][][] } | undefined;
    if (extras?.lanes?.length === 6) lanes = extras.lanes.map((points) => new LanePath(points[0][0], points.map((p) => [p[2], p[1]] as const)));
    // Cable centrelines from the tube geometry: backstay, main span and backstay on each side.
    const sides = (['W', 'E'] as const).map((side) => cableProfile(['backstay_S', 'main', 'backstay_N'].flatMap((part) => {
      const mesh = root.getObjectByName(`main_cable_${side}_${part}`) as THREE.Mesh | undefined;
      return mesh?.isMesh ? [mesh.geometry.getAttribute('position').array] : [];
    })));
    if (sides[0] && sides[1]) cables = [sides[0], sides[1]];

    const carLights = new Map<THREE.BufferGeometry, { material: THREE.Material; nodes: THREE.Mesh[] }>();
    const holders: THREE.Object3D[] = [];
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      if (object.name.startsWith('carlight_')) {
        const entry = carLights.get(mesh.geometry) ?? { material: mesh.material as THREE.Material, nodes: [] };
        entry.nodes.push(mesh); carLights.set(mesh.geometry, entry);
      }
      if (object.name.startsWith('light_aviation') && object.name.endsWith('beacon')) {
        const material = beacon(object.name.includes('_N_') ? beaconN : beaconS);
        beacons.push(material); mesh.material = material;
        return;
      }
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => replace(m, mesh)) : replace(mesh.material, mesh);
    });
    for (const name of ['car_A_holder', 'car_B_holder', 'car_C_holder', 'car_wheel_holder']) { const holder = root.getObjectByName(name); if (holder) holders.push(holder); }
    // Which way each lane drives, read from the first car's headlight and tail light.
    for (let lane = 0; lane < 6; lane++) {
      const head = root.getObjectByName(`carlight_head_${lane}_0_L`), tail = root.getObjectByName(`carlight_tail_${lane}_0_L`);
      if (head && tail) laneDirection[lane] = Math.sign(head.position.z - tail.position.z) || laneDirection[lane];
    }

    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
    const nearestLane = (x: number) => lanes.reduce((best, lane, i) => Math.abs(lane.x - x) < Math.abs(lanes[best].x - x) ? i : best, 0);
    const ride = (target: THREE.InstancedMesh, index: number, world: THREE.Matrix4, lane = nearestLane(world.elements[12])) => {
      world.decompose(position, rotation, scale);
      const path = lanes[lane], s0 = path.arcAt(position.z), pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -path.at(s0, matrixPoint));
      riders.push({ target, index, lane, s0, dx: position.x - path.x, dy: position.y - matrixPoint.y, rel: pitch.invert().multiply(rotation), scale: scale.clone() });
    };
    const matrixPoint = new THREE.Vector3();
    // The model's cars, wheels and lights become riders on the lanes; the car bodies get a spread of paint.
    for (const holder of holders) holder.traverse((object) => {
      const mesh = object as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh) return;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); dynamic.add(mesh);
      const paint = mesh.material === plain.get('mat_car_body');
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix); ride(mesh, i, matrix.premultiply(mesh.matrixWorld));
        if (paint) mesh.setColorAt(i, new THREE.Color().setRGB(...linearRgb(CAR_PAINT[Math.floor(random() * CAR_PAINT.length)])));
      }
    });
    for (const [geometry, { material, nodes }] of carLights) {
      const mesh = new THREE.InstancedMesh(geometry, material, nodes.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; dynamic.add(mesh);
      nodes.forEach((node, i) => { ride(mesh, i, node.matrixWorld.clone(), Number(node.name.split('_')[2])); node.removeFromParent(); });
      root.add(mesh);
    }
    for (const holder of holders) holder.updateMatrixWorld(true);
    scene.add(root, terrain.scene);
  });

  // Sparks on the main cables: a bright head and a fading trail, kicked up towards the tower tops on each hit.
  const sparkCount = SPARKS_PER_CABLE * 2, homes = new Float32Array(sparkCount), offset = new Float32Array(sparkCount), speed = new Float32Array(sparkCount), kick = new Float32Array(sparkCount);
  for (let i = 0; i < sparkCount; i++) { homes[i] = -940 + ((i % SPARKS_PER_CABLE) + (i < SPARKS_PER_CABLE ? 0.25 : 0.75)) * (1880 / SPARKS_PER_CABLE); kick[i] = 0.6 + random() * 0.8; }
  const glow = new Float32Array(sparkCount * TRAIL);
  const glowAttribute = new THREE.InstancedBufferAttribute(glow, 1); glowAttribute.setUsage(THREE.DynamicDrawUsage);
  const sparkMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  sparkMaterial.colorNode = vec3(1, 0.82, 0.5).mul(instancedBufferAttribute(glowAttribute)).mul(9);
  const sparks = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 6), sparkMaterial, sparkCount * TRAIL);
  sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage); sparks.frustumCulled = false; scene.add(sparks);
  /** Which way is up the cable at z: away from mid-span on the main span, towards it on the backstays. */
  const uphill = (z: number) => Math.abs(z) < GG.towerZ ? Math.sign(z || 1) : -Math.sign(z);

  const hits = createHits({ decay: 0.4, interval: 0.2 }), shots = variantSequence(GG_SHOTS.length, 1937);
  const pose: ShotPose = { eye: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fov: 50, near: 1 };
  const travel = new Float64Array(6), point = new THREE.Vector3(), pitch = new THREE.Quaternion(), rotation = new THREE.Quaternion(), matrix = new THREE.Matrix4(), inverse = new THREE.Matrix4();
  const xAxis = new THREE.Vector3(1, 0, 0), dummy = new THREE.Object3D(), shake = new THREE.Vector3();
  const context: ShotContext = { ride: 0, lane: lanes[4], cables };
  const camLane = () => laneDirection.findIndex((d, i) => i >= 3 && d > 0) >= 0 ? laneDirection.findIndex((d, i) => i >= 3 && d > 0) : 4;
  let shot = 0, held = 0, kicks = 0, rideStart = 0, travelStart = 0, fill = 0.3, front = -1000, flash = 0, beaconTurn = 0, flow = 0, zoom = 0;
  const cutTo = (index: number) => {
    shot = index; held = 0; kicks = 0;
    // The drive shots start on the south approach or somewhere on the span, never at the far end of the lane.
    const lane = lanes[camLane()];
    rideStart = lane.arcAt(-1250 + random() * 1300); travelStart = travel[camLane()];
  };
  cutTo(0);
  return {
    scene, camera,
    ready: models.ready,
    update(frame) {
      resizeCamera(perspective, frame.aspect);
      time.value = frame.time;
      const step = settleStep(frame), motion = frame.reducedMotion ? 0 : frame.delta, { bass, loudness, impact } = frame.response;
      const push = drive(frame);
      hits.update(frame, 0.1);
      const snare = hits.fired && isSnare(frame);
      if (hits.fired) kicks++;

      // Lights: the tower strips fill like a level meter, a wave runs out along the lamps on each hit.
      fill = approach(fill, Math.min(1, 0.15 + bass * 0.7 + push * 0.3), step, 0.12);
      towerFill.value = fill; towerFlash.value = hits.flash * 0.8;
      if (hits.fired) { front = 0; flash = frame.reducedFlash ? 0.4 : 1; beaconTurn++; }
      front += motion * 1100; flash *= Math.exp(-step / 1.2);
      lampFront.value = front; lampFlash.value = flash;
      lampLevel.value = approach(lampLevel.value, 1 + loudness * 1.4, step, 0.3);
      beaconN.value = 1.2 + (beaconTurn % 2 ? hits.flash * 7 : 0); beaconS.value = 1.2 + (beaconTurn % 2 ? 0 : hits.flash * 7);
      headLevel.value = 3 + (snare ? 0 : hits.flash * 5) + loudness * 2;
      tailLevel.value = approach(tailLevel.value, 1.5 + (snare ? 7 : 0), step, snare ? 0.02 : 0.25);
      flood.value = approach(flood.value, 0.6 + bass * 1.6 + hits.flash * 0.6, step, 0.15);
      flow += motion * (0.25 + loudness * 1.6 + push); cableFlow.value = flow;
      cableGlow.value = approach(cableGlow.value, 0.3 + bass * 1.2, step, 0.2);

      // Traffic: every lane moves as one, faster when the music is louder.
      const pace = 12 + loudness * 18 + push * 14;
      for (let lane = 0; lane < 6; lane++) travel[lane] += motion * pace * (0.9 + lane % 3 * 0.08);
      for (const r of riders) {
        const path = lanes[r.lane], s = wrap(r.s0 + laneDirection[r.lane] * travel[r.lane], 0, path.length);
        pitch.setFromAxisAngle(xAxis, -path.at(s, point));
        rotation.copy(pitch).multiply(r.rel);
        dummy.position.set(path.x + r.dx, point.y + r.dy, point.z);
        matrix.compose(dummy.position, rotation, r.scale);
        r.target.setMatrixAt(r.index, matrix.premultiply(inverse.copy(r.target.matrixWorld).invert()));
      }
      for (const mesh of dynamic) mesh.instanceMatrix.needsUpdate = true;

      // Sparks: a spring along the cable, kicked uphill on every hit and pulled up further by sustained bass.
      for (let i = 0; i < sparkCount; i++) {
        if (hits.fired) speed[i] += kick[i] * (90 + impact * 140) * (frame.reducedMotion ? 0 : 1);
        const rest = bass * 45 * kick[i];
        speed[i] += (-(offset[i] - rest) * 9 - speed[i] * 2.2) * Math.min(motion, 0.05);
        offset[i] += speed[i] * Math.min(motion, 0.05);
        const cable = cables[i < SPARKS_PER_CABLE ? 0 : 1], up = uphill(homes[i]);
        const z = Math.max(-975, Math.min(975, homes[i] + up * offset[i]));
        const trail = Math.min(7, 0.6 + Math.abs(speed[i]) * 0.025), back = -Math.sign(speed[i] * up || 1);
        for (let k = 0; k < TRAIL; k++) {
          const zk = z + back * k * trail, fade = 1 - k / TRAIL, n = i * TRAIL + k;
          dummy.position.set(cable.x, cable.yAt(zk) + 0.2, zk);
          dummy.scale.setScalar((0.35 + 0.9 * fade) * (k === 0 ? 1.4 : 1));
          dummy.updateMatrix(); sparks.setMatrixAt(n, dummy.matrix);
          glow[n] = fade * fade * (0.5 + loudness * 0.7 + hits.flash * 0.8);
        }
      }
      sparks.instanceMatrix.needsUpdate = true; glowAttribute.needsUpdate = true;

      // Shots: cut on a strong hit after four seconds or every twelve kicks; in silence every sixteen seconds.
      held += step;
      if (held > 4 && ((hits.fired && impact > 0.85) || kicks >= 12)) cutTo(shots.next());
      else if (held > 16) cutTo(shots.next());
      const lane = camLane();
      context.lane = lanes[lane]; context.cables = cables;
      context.ride = Math.min(lanes[lane].length - 80, rideStart + (travel[lane] - travelStart) * 1.15);
      GG_SHOTS[shot].pose(frame.reducedMotion ? 0 : held, context, pose);
      // Hits punch the lens in a little; bass gives a faint tremor.
      zoom = approach(zoom, hits.flash * (frame.reducedMotion ? 0 : 0.07), step, 0.05);
      shake.set(Math.sin(frame.time * 37), Math.sin(frame.time * 29 + 1), 0).multiplyScalar(frame.reducedMotion ? 0 : bass * 0.04 * pose.near);
      perspective.position.copy(pose.eye).add(shake);
      perspective.up.copy(pose.up);
      perspective.lookAt(pose.look);
      const fov = pose.fov * (1 - zoom);
      if (perspective.fov !== fov || perspective.near !== pose.near) { perspective.fov = fov; perspective.near = pose.near; perspective.updateProjectionMatrix(); }
      fog.density = approach(fog.density, 0.00012 + (1 - loudness) * 0.00008, step, 2);
    },
    dispose() { models.dispose(); disposeScene(scene); scene.fog = null; },
  };
}
