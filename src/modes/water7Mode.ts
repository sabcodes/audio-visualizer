import * as THREE from 'three/webgpu';
import { mix, normalWorld, positionLocal, uniform, vec3 } from 'three/tsl';
import { instantiate, whenLoaded } from './figures';
import { approach, disposeScene, resizeCamera, sceneDefaults } from './shared';
import { createWater7Water } from './water7Water';
import { presetBudget, type QualityBudget } from '../rendering/quality';
import type { ModeFrame, VisualMode } from './types';
// Keep the supplied model in its Wave6 folder; Vite includes it in the production bundle.
import cityUrl from '../../Model assets/Wave6 assets /Water 7 v2 model.glb?url';

type Point = readonly [number, number, number];
interface Water7Shot { name: string; area: string; seconds: number; eye: Point; end: Point; look: Point; fov: number; daylight?: number; orbit?: number }
export const WATER7_SHOTS: readonly Water7Shot[] = [
  { name: 'Water Seven / island arrival', area: 'island', seconds: 7, eye: [110, 78, -140], end: [85, 65, -120], look: [0, 15, 0], fov: 48 },
  { name: 'the city of water / aerial orbit', area: 'island', seconds: 8, eye: [95, 88, -105], end: [95, 88, -105], look: [0, 15, 0], orbit: 1.4, fov: 53 },
  { name: 'eight waterways / overhead', area: 'island', seconds: 6, eye: [0, 155, -12], end: [20, 140, -5], look: [0, 0, 0], fov: 52 },
  { name: 'Aqua Laguna / incoming swell', area: 'surf', seconds: 6, eye: [58, 7, -105], end: [45, 5, -91], look: [15, 6, -45], fov: 60 },
  { name: 'seawall / breaking crest', area: 'surf', seconds: 6, eye: [16, 4, -110], end: [10, 6, -105], look: [0, 6, -53], fov: 42 },
  { name: 'gate two / waterfalls', area: 'gateway', seconds: 6, eye: [-9, 5, -72], end: [7, 7, -67], look: [0, 10, -49], fov: 53 },
  { name: 'diagonal canal / gondola glide', area: 'canals', seconds: 6, eye: [37, 17, -37], end: [34, 18, -34], look: [24, 18, -24], fov: 66 },
  { name: 'arched bridges / canal descent', area: 'canals', seconds: 5, eye: [0, 23, -25], end: [0, 23, -28], look: [0, 9, -46], fov: 70 },
  { name: 'canal promenade / terracotta roofs', area: 'canals', seconds: 6, eye: [5.7, 11, -46], end: [5.5, 13, -40], look: [-2, 13, -35], fov: 65 },
  { name: 'Galley-La / shipwright quarter', area: 'landmarks', seconds: 6, eye: [-50, 18, -63], end: [-46, 20, -52], look: [-28, 14, -35], fov: 55 },
  { name: 'clock tower / market rooftops', area: 'landmarks', seconds: 6, eye: [48, 28, -62], end: [44, 31, -51], look: [27, 18, -34], fov: 52 },
  { name: 'east canal / flowing terraces', area: 'canals', seconds: 6, eye: [48, 14, 6.5], end: [42, 15.5, 6.5], look: [35, 14, 0], fov: 70 },
  { name: 'aqueduct / double arcade', area: 'aqueducts', seconds: 6, eye: [-63, 26, -13], end: [-55, 29, -8], look: [-37, 14, 0], fov: 56 },
  { name: 'ring canal / rooftop drift', area: 'canals', seconds: 6, eye: [23, 31, -23], end: [20, 30, -23], look: [30, 12, -30], fov: 62 },
  { name: 'fountain / five cascades', area: 'fountain', seconds: 7, eye: [22, 36, -28], end: [19, 39, -24], look: [0, 32, 0], fov: 58 },
  { name: 'fountain crown / skyward', area: 'fountain', seconds: 6, eye: [11, 28, -13], end: [12, 31, -11], look: [0, 43, 0], fov: 65 },
  { name: 'upper city / cascade descent', area: 'canals', seconds: 7, eye: [0, 30, -16], end: [0, 27, -25], look: [0, 10, -48], fov: 68 },
  { name: 'backwater / quiet bridges', area: 'canals', seconds: 6, eye: [-29, 17, 30], end: [-25, 18, 26], look: [-15, 23, 15], fov: 66 },
  { name: 'harbor / sailing past', area: 'harbor', seconds: 7, eye: [-77, 6, -38], end: [-68, 8, -31], look: [-38, 11, -20], fov: 61 },
  { name: 'golden hour / island broadside', area: 'island', seconds: 8, eye: [-125, 68, 88], end: [-110, 58, 65], look: [0, 18, 0], fov: 51, daylight: 0.65 },
  { name: 'sunlit surf / spray against stone', area: 'surf', seconds: 7, eye: [-74, 5, 56], end: [-68, 8, 48], look: [-35, 5, 30], fov: 63, daylight: 0.65 },
  { name: 'blue hour / illuminated waterways', area: 'island', seconds: 8, eye: [94, 76, 94], end: [82, 68, 100], look: [0, 18, 0], fov: 51, daylight: 0.15 },
  { name: 'night fountain / water and gold', area: 'fountain', seconds: 7, eye: [-24, 37, 28], end: [-28, 41, 20], look: [0, 32, 0], fov: 59, daylight: 0.15 },
  { name: 'Water Seven / ocean farewell', area: 'island', seconds: 9, eye: [55, 55, -115], end: [95, 95, -175], look: [0, 17, 0], fov: 50 },
];

export function createWater7Mode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const { scene, camera } = sceneDefaults(); camera.near = 0.12; camera.far = 1700;
  scene.fog = new THREE.FogExp2(0x90cbdf, 0.00125);
  const water = createWater7Water(scene, budget), sunlight = uniform(1);
  const skyMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, fog: false, depthWrite: false });
  const skyHeight = positionLocal.y.div(780).clamp(0, 1);
  skyMaterial.colorNode = mix(mix(vec3(0.025, 0.055, 0.13), vec3(0.54, 0.79, 0.91), sunlight),
    mix(vec3(0.008, 0.02, 0.065), vec3(0.075, 0.4, 0.72), sunlight), skyHeight);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(780, 32, 18), skyMaterial); scene.add(sky);
  const cloudMaterial = new THREE.MeshBasicNodeMaterial({ color: 0xf2f8f3 });
  const clouds = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), cloudMaterial, 60);
  clouds.name = 'Water 7 / sea clouds'; clouds.frustumCulled = false; scene.add(clouds);
  const cloudPart = new THREE.Object3D();
  for (let i = 0; i < 60; i++) {
    const cluster = Math.floor(i / 5), lobe = i % 5, theta = cluster * 2.39996, r = 420 + cluster % 4 * 55;
    cloudPart.position.set(Math.cos(theta) * r + (lobe - 2) * 11, 170 + cluster % 3 * 15 + Math.sin(lobe * 1.7) * 3, Math.sin(theta) * r + Math.cos(lobe) * 8);
    cloudPart.scale.set(16 + lobe % 2 * 7, 5 + lobe % 3 * 3, 10 + lobe % 2 * 4);
    cloudPart.updateMatrix(); clouds.setMatrixAt(i, cloudPart.matrix);
  }
  const materials = new Map<THREE.Material, THREE.Material>();
  const models = whenLoaded([cityUrl], ([gltf]) => {
    const city = instantiate(gltf); city.root.name = 'Water 7 / supplied city';
    city.root.traverse(object => {
      const mesh = object as THREE.Mesh; if (!mesh.isMesh) return;
      mesh.geometry = mesh.geometry.clone(); mesh.frustumCulled = true;
      const shade = (source: THREE.Material) => {
        if (materials.has(source)) return materials.get(source)!;
        const old = source as THREE.MeshStandardMaterial; let result: THREE.Material;
        if (old.name === 'emissive_canal') result = water.canalMaterial;
        else if (old.name === 'emissive_waterfall') result = water.fallingMaterial;
        else if (old.name === 'emissive_fountain') result = water.fountainMaterial;
        else {
          const material = new THREE.MeshBasicNodeMaterial({ side: old.side });
          // This kit stores its palette in sRGB numbers; interpret them as sRGB before shading.
          const color = old.color.clone().convertSRGBToLinear();
          const diffuse = normalWorld.dot(vec3(-0.45, 0.8, -0.35)).max(0);
          const bands = diffuse.smoothstep(0.12, 0.16).mul(0.24).add(diffuse.smoothstep(0.58, 0.64).mul(0.24)).add(0.56);
          material.colorNode = vec3(color.r, color.g, color.b).mul(bands).mul(sunlight.mul(0.8).add(0.2));
          if (old.name.startsWith('emissive_')) {
            const strength = sunlight.oneMinus().mul(0.9).add(0.12).mul(water.mids.mul(0.15).add(1));
            material.colorNode = material.colorNode.add(vec3(old.emissive.r, old.emissive.g, old.emissive.b).mul(strength));
          }
          result = material;
        }
        result.name = old.name; materials.set(source, result); return result;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(shade) : shade(mesh.material);
    });
    city.materials.forEach(material => material.dispose()); city.node('sea_base').visible = false;
    const boats = ['ship_large', ...Array.from({ length: 8 }, (_, i) => `boat_0${i + 1}`)].map((name, i) => {
      const mesh = city.node(name), center = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
      const pivot = new THREE.Group(); pivot.position.set(center.x, 0, center.z); city.root.add(pivot); pivot.add(mesh); mesh.position.set(-center.x, 0, -center.z);
      return { pivot, x: center.x, z: center.z, index: i };
    });
    scene.add(city.root); scene.userData.assetsLoaded = true; return { city, boats };
  });
  let elapsed = 0, clock = 0, shotIndex = 0, sinceBeat = 1, lastOnset = false;
  const eye = new THREE.Vector3(), end = new THREE.Vector3(), look = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  scene.userData.assetsLoaded = false;
  const update = (frame: ModeFrame) => {
    resizeCamera(camera, frame.aspect);
    const dt = frame.reducedMotion ? 0 : THREE.MathUtils.clamp(frame.delta, 0, 0.1);
    const onset = frame.audio.onset && !lastOnset; lastOnset = frame.audio.onset;
    elapsed += dt; clock += dt; sinceBeat += dt;
    let shot = WATER7_SHOTS[shotIndex];
    if (dt > 0 && (elapsed >= shot.seconds || (elapsed > shot.seconds * 0.88 && onset && frame.response.impact > 0.6))) {
      elapsed = 0; shotIndex = (shotIndex + 1) % WATER7_SHOTS.length; shot = WATER7_SHOTS[shotIndex];
    }
    water.bass.value = approach(water.bass.value, frame.response.bass, dt, 0.35);
    water.mids.value = approach(water.mids.value, frame.audio.mid, dt, 0.22);
    water.highs.value = approach(water.highs.value, frame.audio.highs, dt, 0.15);
    water.pulse.value = approach(water.pulse.value, 0, dt, 0.7);
    if (dt > 0 && onset && sinceBeat > 0.3) { water.pulse.value = frame.reducedFlash ? 0.3 : Math.min(1, frame.response.impact); sinceBeat = 0; }
    sunlight.value = approach(sunlight.value, shot.daylight ?? 1, dt, 1.2); water.daylight.value = sunlight.value;
    clouds.rotation.y = clock * 0.003;
    cloudMaterial.color.setRGB(0.18 + sunlight.value * 0.72, 0.24 + sunlight.value * 0.7, 0.36 + sunlight.value * 0.6);
    (scene.fog as THREE.FogExp2).color.setRGB(0.025 + sunlight.value * 0.25, 0.055 + sunlight.value * 0.54, 0.12 + sunlight.value * 0.62);
    water.update(dt);
    const built = models.value;
    if (built) for (const { pivot, x, z, index } of built.boats) {
      const canal = index === 3 || index === 4 || index === 7 || index === 8;
      const sway = Math.sin(clock * 0.7 + index * 1.8), travel = Math.sin(clock * 0.16 + index) * (canal ? 0.7 : 1.7);
      pivot.position.set(x + (canal ? 0 : travel), sway * (canal ? 0.035 : 0.15 + water.bass.value * 0.12), z + travel);
      pivot.rotation.set(Math.sin(clock * 0.9 + index) * 0.012, 0, sway * (canal ? 0.006 : 0.025));
    }
    const phase = Math.min(1, elapsed / shot.seconds), ease = phase * phase * (3 - 2 * phase);
    eye.set(...shot.eye).lerp(end.set(...shot.end), ease); look.set(...shot.look);
    if (shot.orbit) eye.sub(look).applyAxisAngle(up, phase * shot.orbit).add(look);
    if (frame.aspect < 1) eye.sub(look).multiplyScalar(Math.min(1.7, 1 / frame.aspect)).add(look);
    camera.position.copy(eye); camera.lookAt(look);
    if (camera.fov !== shot.fov) { camera.fov = shot.fov; camera.updateProjectionMatrix(); }
    Object.assign(scene.userData, { shot: shot.name, shotIndex, area: shot.area, elapsed, clock, bass: water.bass.value,
      pulse: water.pulse.value, daylight: sunlight.value, waterTime: water.clock.value, ...water.stats() });
  };
  return { scene, camera, update, ready: models.ready,
    dispose() { models.dispose(); if (!models.value) water.dispose(); disposeScene(scene); },
  };
}
