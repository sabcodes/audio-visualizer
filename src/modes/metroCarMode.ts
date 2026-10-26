import * as THREE from 'three/webgpu';
import { abs, float, fract, mix, positionWorld, step as stepNode, time as timeNode, uniform, uv, vec2, vec3 } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { shaftMaterial } from './figures';
import { createCinematic } from './cinematic';
import { shadowSwitch } from './kitModes';
import { hash2, palette } from './shaderModes';
import { createHits, linearRgb } from './hitPulse';

/**
 * Car size (metres): length, width, height, the bellows gangway between cars, the car pitch (one car plus its
 * gangway, which is how far the camera travels per loop), the door/seat layout in 2 m sections along the car,
 * and the loop time (seconds).
 */
export const METRO = { length: 14, width: 2.7, height: 2.3, gangway: 0.8, pitch: 14.8, sections: 'DSSDSSD', loop: 10 } as const;
const START = METRO.gangway / 2;

/**
 * Camera state through one loop: it glides from the gangway behind a car to the gangway behind the next one, so
 * the loop repeats seamlessly, while rolling one full turn (slow at the seam, quickest mid-car).
 */
export function metroShot(t: number) {
  const { pitch, loop } = METRO, u = (((t % loop) + loop) % loop) / loop;
  return {
    z: START - u * pitch,
    y: 1.45 + Math.sin(u * Math.PI * 4) * 0.03,
    roll: Math.PI * 2 * u - Math.sin(Math.PI * 2 * u),
  };
}

/** Collects transformed pieces per material and merges them into one mesh each, so a whole car is a few draws. */
function pieceBuilder() {
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const matrix = new THREE.Matrix4(), euler = new THREE.Euler(0, 0, 0, 'YXZ'), turn = new THREE.Quaternion(), at = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  return {
    add(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
      const piece = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      geometry.dispose();
      for (const name of Object.keys(piece.attributes)) if (!['position', 'normal', 'uv'].includes(name)) piece.deleteAttribute(name);
      piece.applyMatrix4(matrix.compose(at.set(x, y, z), turn.setFromEuler(euler.set(rx, ry, rz)), one));
      if (!buckets.has(material)) buckets.set(material, []);
      buckets.get(material)!.push(piece);
    },
    build(glowing: Set<THREE.Material>) {
      const group = new THREE.Group();
      for (const [material, pieces] of buckets) {
        const mesh = new THREE.Mesh(mergeGeometries(pieces), material);
        mesh.castShadow = mesh.receiveShadow = !glowing.has(material);
        group.add(mesh);
        pieces.forEach((piece) => piece.dispose());
      }
      return group;
    },
  };
}

/**
 * Metro Car (wave 5, clip 13): a first-person glide down an endless train of empty subway cars: olive walls,
 * sliding doors with yellow edge strips, blue-grey bench seats with steel dividers, poles, grab rails with hanging
 * straps, poster boards, a route map and orange destination lights over the open end doorway, through which the
 * next car is always in view. Low evening sun pours through the left windows in warm shafts, broken by pylons
 * flicking past outside. The camera rolls a full turn per car at a fixed pace; the cabin lights pulse with the
 * bounce. Built in code.
 */
export function createMetroCarMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).fov = 70; camera.near = 0.05;
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(0x0c0a08, 0.03);
  const finish = createCinematic({ grain: 0.06, halation: 0.4, vignette: 0.55, soften: 0.12, aberration: 0.002, shadows: [0.0, 0.012, 0.014] });
  const time = uniform(0), cabinLight = uniform(1);
  const { length, width, height, gangway, pitch, sections } = METRO, half = width / 2;
  const standard = (color: number, roughness = 0.6, metalness = 0) => new THREE.MeshStandardNodeMaterial({ color, roughness, metalness });
  const olive = standard(0x5a6a3a, 0.55), oliveDark = standard(0x3a4526, 0.7), ceilingMaterial = standard(0xc8ccc0);
  const steel = standard(0xc0c6cc, 0.25, 0.6), seat = standard(0x4a5a6e, 0.75), rubber = standard(0x121212, 0.8);
  const door = standard(0x8d9396, 0.4, 0.3), yellow = standard(0xd8a418, 0.5), plastic = standard(0xd8ceb4, 0.5), red = standard(0xb01810, 0.4);
  // The ceiling faces away from every light, so it glows from the strips instead of going black.
  ceilingMaterial.emissiveNode = vec3(0.78, 0.8, 0.75).mul(cabinLight.mul(0.09));
  const floorMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.1 });
  // Worn floor: a dull speckled grey with a sheen strip down the middle where feet go.
  floorMaterial.colorNode = mix(vec3(0.05, 0.05, 0.048), vec3(0.09, 0.085, 0.08), hash2(positionWorld.xz.mul(40).floor()));
  floorMaterial.roughnessNode = mix(float(0.2), float(0.6), positionWorld.x.abs().div(half));
  // Poster boards: three posters per board, a block of colour with a few lines of "text" and a pale border.
  const adMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.5 });
  const cell = uv().mul(vec2(3, 1)), id = cell.floor().add(positionWorld.z.floor()), local = fract(cell);
  const border = abs(local.x.sub(0.5)).greaterThan(0.44).or(abs(local.y.sub(0.5)).greaterThan(0.4));
  const text = stepNode(0.5, fract(local.y.mul(7))).mul(stepNode(local.y, 0.45)).mul(stepNode(hash2(vec2(local.x.mul(9).floor(), id.x)), 0.7));
  adMaterial.colorNode = border.select(vec3(0.85, 0.82, 0.75), mix(palette(hash2(id).mul(0.7).add(0.05)).mul(0.6), vec3(0.9), text.mul(0.6)));
  adMaterial.emissiveNode = adMaterial.colorNode.mul(cabinLight.mul(0.15));
  // Route map over the end doorway: a red line with station dots on white.
  const mapMaterial = new THREE.MeshBasicNodeMaterial();
  const line = abs(uv().y.sub(0.55)).lessThan(0.06), dot = fract(uv().x.mul(9)).sub(0.5).mul(vec2(1, 0)).add(vec2(0, uv().y.sub(0.55).mul(0.5))).length().lessThan(0.06);
  mapMaterial.colorNode = dot.select(vec3(1), line.select(vec3(0.8, 0.08, 0.05), vec3(0.85, 0.85, 0.82))).mul(cabinLight.mul(0.5).add(0.3));
  const strip = new THREE.MeshBasicNodeMaterial(); strip.colorNode = vec3(0.9, 1, 0.95).mul(cabinLight);
  const destination = new THREE.MeshBasicNodeMaterial(); destination.colorNode = vec3(1, 0.42, 0.08).mul(cabinLight.mul(1.2).add(0.6));

  // ---- One car, z from 0 (rear end wall) to -length (front end wall), with its gangway in front.
  const car = pieceBuilder(), box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const rounded = (w: number, h: number, d: number, r = 0.04) => new RoundedBoxGeometry(w, h, d, 2, r);
  const rod = (r: number, l: number) => new THREE.CylinderGeometry(r, r, l, 10);
  car.add(box(width, 0.05, length), floorMaterial, 0, -0.025, -length / 2);
  // Ceiling: a flat centre panel, sloped sides, light strips along the joins, vents down the middle.
  car.add(box(1.1, 0.04, length), ceilingMaterial, 0, height, -length / 2);
  for (const s of [-1, 1]) {
    car.add(box(0.85, 0.04, length), ceilingMaterial, s * 0.95, height - 0.14, -length / 2, 0, 0, -s * 0.33);
    car.add(box(0.16, 0.03, length * 0.96), strip, s * 0.6, height - 0.035, -length / 2);
    car.add(rod(0.018, length), steel, s * 0.62, 1.95, -length / 2, Math.PI / 2);
  }
  sections.split('').forEach((kind, k) => {
    const zc = -k * 2 - 1;
    car.add(box(0.5, 0.012, 0.12), rubber, 0, height - 0.025, zc);
    for (const s of [-1, 1]) {
      const wall = s * half;
      car.add(rod(0.012, height - 1.95), steel, s * 0.62, (height + 1.95) / 2, zc - 0.98);
      // Poster boards angled along the top of each wall.
      car.add(new THREE.PlaneGeometry(1.9, 0.3), adMaterial, wall - s * 0.07, height - 0.42, zc, 0.3, -s * Math.PI / 2);
      if (kind === 'D') {
        // A closed pair of sliding doors with tall windows, a rubber seam, and a yellow strip on the floor.
        for (const dz of [-0.85, 0.85]) car.add(box(0.06, height, 0.3), olive, wall, height / 2, zc + dz);
        car.add(box(0.06, height - 1.95, 1.4), olive, wall, (height + 1.95) / 2, zc);
        for (const leaf of [-1, 1]) {
          const lz = zc + leaf * 0.33, x = wall - s * 0.03;
          car.add(box(0.04, 1.0, 0.64), door, x, 0.5, lz);
          car.add(box(0.04, 0.2, 0.64), door, x, 1.85, lz);
          car.add(box(0.04, 0.75, 0.1), door, x, 1.375, lz + leaf * 0.27);
          car.add(box(0.04, 0.75, 0.06), door, x, 1.375, lz - leaf * 0.29);
          car.add(box(0.05, 0.75, 0.015), rubber, x - s * 0.005, 1.375, lz - leaf * 0.255);
        }
        car.add(box(0.05, 1.95, 0.02), rubber, wall - s * 0.035, 0.975, zc);
        car.add(box(0.05, 1.95, 0.04), yellow, wall - s * 0.04, 0.975, zc - 0.68);
        car.add(box(0.05, 1.95, 0.04), yellow, wall - s * 0.04, 0.975, zc + 0.68);
        car.add(box(0.3, 0.006, 1.3), yellow, wall - s * 0.18, 0.003, zc);
        if (s === 1) car.add(rod(0.02, height), steel, 0, height / 2, zc);
      } else {
        // Windows over a bench: wall below and above, a centre mullion, framed in rubber with a steel sill.
        car.add(box(0.06, 0.95, 2), olive, wall, 0.475, zc);
        car.add(box(0.06, height - 1.85, 2), olive, wall, (height + 1.85) / 2, zc);
        car.add(box(0.07, 0.9, 0.12), olive, wall, 1.4, zc);
        for (const dz of [-0.95, 0.95]) car.add(box(0.07, 0.9, 0.1), olive, wall, 1.4, zc + dz);
        car.add(box(0.14, 0.03, 2), steel, wall - s * 0.06, 0.965, zc);
        car.add(box(0.08, 0.03, 2), rubber, wall - s * 0.02, 1.835, zc);
        for (let c = -1; c <= 1; c++) {
          car.add(rounded(0.48, 0.1, 0.6), seat, wall - s * 0.3, 0.46, zc + c * 0.63);
          car.add(rounded(0.07, 0.45, 0.6), seat, wall - s * 0.08, 0.75, zc + c * 0.63, 0, 0, -s * 0.12);
        }
        car.add(box(0.42, 0.4, 1.9), oliveDark, wall - s * 0.25, 0.2, zc);
        car.add(box(0.02, 0.22, 1.7), rubber, wall - s * 0.465, 0.2, zc);
        // Steel dividers at the bench ends: a pole to the ceiling with an arm back to the wall.
        for (const dz of [-0.97, 0.97]) {
          car.add(rod(0.018, height), steel, wall - s * 0.52, height / 2, zc + dz);
          car.add(rod(0.016, 0.5), steel, wall - s * 0.27, 1.12, zc + dz, 0, 0, Math.PI / 2);
        }
        // Hanging straps along the rail.
        for (let h = -0.75; h <= 0.75; h += 0.5) {
          car.add(box(0.025, 0.13, 0.012), plastic, s * 0.62, 1.87, zc + h);
          car.add(new THREE.TorusGeometry(0.055, 0.01, 6, 16), plastic, s * 0.62, 1.75, zc + h, 0, Math.PI / 2);
        }
      }
    }
  });
  // End walls with an open doorway framed in steel; the front one carries the route map and destination lights.
  for (const z of [0, -length]) {
    const side = (width - 0.85) / 2, face = z === 0 ? -0.035 : 0.035;
    for (const s of [-1, 1]) car.add(box(side, height, 0.06), olive, s * (0.425 + side / 2), height / 2, z);
    car.add(box(0.85, height - 1.95, 0.06), olive, 0, (height + 1.95) / 2, z);
    for (const s of [-1, 1]) car.add(box(0.05, 1.95, 0.08), steel, s * 0.45, 0.975, z);
    car.add(box(0.95, 0.05, 0.08), steel, 0, 1.97, z);
    if (z === 0) car.add(box(0.14, 0.36, 0.1), red, 0.9, 0.55, z - 0.08);
    else {
      car.add(new THREE.PlaneGeometry(0.8, 0.16), mapMaterial, 0, 2.13, z + face);
      for (const s of [-1, 1]) car.add(new THREE.PlaneGeometry(0.42, 0.09), destination, s * 0.85, 2.08, z + face);
    }
  }
  // The bellows gangway to the next car: rubber walls and roof with ribs, and a steel floor plate.
  const gz = -length - gangway / 2;
  for (const s of [-1, 1]) car.add(box(0.04, 2.05, gangway), rubber, s * 0.5, 1.025, gz);
  car.add(box(1.04, 0.04, gangway), rubber, 0, 2.07, gz);
  car.add(box(1.0, 0.02, gangway), steel, 0, 0.01, gz);
  for (let j = 0; j < 6; j++) {
    const z = -length - 0.07 - j * 0.13;
    for (const s of [-1, 1]) car.add(box(0.06, 2.05, 0.03), rubber, s * 0.47, 1.025, z);
    car.add(box(1.0, 0.06, 0.03), rubber, 0, 2.03, z);
  }
  const template = car.build(new Set<THREE.Material>([strip, destination, mapMaterial]));
  // Warm shafts from each window bay of the sunny side.
  const shaftMat = shaftMaterial(time);
  sections.split('').forEach((kind, k) => {
    if (kind !== 'S') return;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.7, 3.2, 4, 1, true).translate(0, -1.6, 0), shaftMat);
    shaft.position.set(-half, 1.5, -k * 2 - 1); shaft.rotation.set(0, Math.PI / 4, Math.PI / 2 - 0.35);
    template.add(shaft);
  });
  // The train: the car behind, the one the camera rides through, and three ahead fading into the fog.
  for (let c = -1; c <= 3; c++) { const copy = c === 0 ? template : template.clone(); copy.position.z = -c * pitch; scene.add(copy); }

  // Outside: a low evening sky with a skyline on the sunny side, dusk on the other, and pylons rushing past.
  const skyMaterial = new THREE.MeshBasicNodeMaterial({ fog: false });
  const sx = uv().x.add(timeNode.mul(0.002)), skyline = hash2(vec2(sx.mul(90).floor(), 3)).mul(0.07).add(0.47);
  skyMaterial.colorNode = mix(vec3(1.6, 0.9, 0.45), vec3(0.6, 0.55, 0.6), uv().y.smoothstep(0.5, 0.9)).mul(stepNode(skyline, uv().y).mul(0.95).add(0.05));
  const sunnySky = new THREE.Mesh(new THREE.PlaneGeometry(220, 40), skyMaterial); sunnySky.rotation.y = Math.PI / 2;
  const duskMaterial = new THREE.MeshBasicNodeMaterial({ fog: false });
  duskMaterial.colorNode = mix(vec3(0.05, 0.06, 0.1), vec3(0.18, 0.2, 0.32), uv().y.smoothstep(0.45, 0.8));
  const duskSky = new THREE.Mesh(new THREE.PlaneGeometry(220, 40), duskMaterial); duskSky.rotation.y = -Math.PI / 2;
  scene.add(sunnySky, duskSky);
  // Pylon spacing divides the car pitch, so the loop's jump back one car is invisible outside too.
  const PYLONS = 8, spacing = pitch / 2;
  const pylons = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 7, 0.3), standard(0x14110e, 0.8), PYLONS * 2);
  pylons.castShadow = true; pylons.frustumCulled = false; scene.add(pylons);
  const sun = new THREE.DirectionalLight(0xffb070, 6);
  sun.position.set(-8, 3.2, -5); sun.target.position.set(0, 0, -8); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 0.5, far: 30 });
  const overhead = new THREE.DirectionalLight(0xeefff4, 1); overhead.position.set(0.2, 1, 0.1);
  const fill = new THREE.HemisphereLight(0x8aa0a0, 0x2a2018, 0.5);
  scene.add(sun, sun.target, overhead, fill);
  const shadows = shadowSwitch();
  const hits = createHits({ decay: 0.2, interval: 0.25 });
  const pylon = new THREE.Object3D(), shaftColour = new THREE.Color(...linearRgb(0xffa060));
  let clock = 0, travel = 0, shake = 0;
  return {
    scene, camera,
    simulate: shadows.simulate,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time; finish.update(frame);
      const step = settleStep(frame), motion = frame.reducedMotion ? 0 : frame.delta, { loudness, bounce, impact } = frame.response;
      hits.update(frame, 0.1);
      // A fixed pace: one car and one full roll per loop, whatever the music does.
      clock += motion;
      travel += motion * 18;
      const shot = metroShot(clock);
      // The cabin lights pulse with the bounce and kick on hits; reduced flash keeps the swing small and soft.
      const lights = frame.reducedFlash ? 0.6 + bounce * 0.3 + hits.flash * 0.15 : 0.4 + bounce * 1.1 + hits.flash * 0.5;
      cabinLight.value = approach(cabinLight.value, lights, step, frame.reducedFlash ? 0.12 : 0.025);
      overhead.intensity = cabinLight.value * 1.1;
      fill.intensity = 0.25 + cabinLight.value * 0.35;
      sun.intensity = 6 * (0.85 + loudness * 0.3);
      shaftMat.color.copy(shaftColour).multiplyScalar(0.08 * (0.85 + loudness * 0.3));
      for (let k = 0; k < PYLONS * 2; k++) {
        const side = k < PYLONS ? -1 : 1, z = 22 - ((((travel + (k % PYLONS) * spacing + (side > 0 ? spacing / 2 : 0)) % (PYLONS * spacing)) + PYLONS * spacing) % (PYLONS * spacing));
        pylon.position.set(side * 4.5, 3, z); pylon.updateMatrix(); pylons.setMatrixAt(k, pylon.matrix);
      }
      pylons.instanceMatrix.needsUpdate = true;
      shake = approach(shake, impact, step, 0.08);
      const jitter = shake * 0.025;
      camera.position.set(Math.sin(frame.time * 13) * jitter, shot.y + Math.cos(frame.time * 11) * jitter, shot.z);
      sunnySky.position.set(-40, 2, shot.z); duskSky.position.set(40, 2, shot.z);
      camera.rotation.set(0, 0, frame.reducedMotion ? 0 : shot.roll);
      camera.rotateX(-0.04);
    },
    filter: (input) => finish.filter(input),
    dispose() { shadows.dispose(); disposeScene(scene); },
  };
}
