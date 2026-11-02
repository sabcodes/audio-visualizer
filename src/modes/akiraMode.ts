import * as THREE from 'three/webgpu';
import { abs, fract, mix, normalView, normalWorld, sin, uv, vec2, vec3, vec4 } from 'three/tsl';
import { instantiate, whenLoaded } from './figures';
import { approach, disposeScene, resizeCamera, sceneDefaults } from './shared';
import { createNightRiderEffects, createNightRiderThrottle } from './nightRiderEffects';
import { createAkiraCity, type AkiraDistrict } from './akiraCity';
import { presetBudget, type QualityBudget } from '../rendering/quality';
import type { ModeFrame, VisualMode } from './types';
import bikeUrl from '../assets/wave6/akira_bike.glb?url';

type Motion = 'cruise' | 'launch' | 'drift left' | 'drift right' | 'slalom' | 'wheelie' | 'brake slide' | 'burnout' | 'orbit';
interface AkiraShot {
  name: string; district: AkiraDistrict; motion: Motion; seconds: number;
  eye: readonly [number, number, number]; look: readonly [number, number, number];
  end: readonly [number, number, number]; fov: number; roll?: number;
}

// Skyline wides and upward city studies alternate with low tracking shots and machine details.
export const AKIRA_SHOTS: readonly AkiraShot[] = [
  { name: 'Neo Tokyo / jade canyon', district: 'jade megacity', motion: 'cruise', seconds: 4.8, eye: [-4.5, 1.3, -8.5], look: [0, 12, 30], end: [-3, 1.6, -7], fov: 66 },
  { name: 'scarlet machine / street level', district: 'jade megacity', motion: 'cruise', seconds: 3.3, eye: [3.1, 0.55, 2.7], look: [0, 0.6, 0], end: [3.5, 0.8, 1.4], fov: 45 },
  { name: 'ignition / red against jade', district: 'jade megacity', motion: 'launch', seconds: 2.8, eye: [-2.6, 0.25, 3.5], look: [0, 0.55, 0], end: [-3, 0.6, 2.8], fov: 49 },
  { name: 'green wall / side tracking', district: 'jade megacity', motion: 'cruise', seconds: 3.5, eye: [4.4, 0.85, -0.3], look: [0, 0.65, 0], end: [4.4, 1.4, 0.9], fov: 43 },
  { name: 'Kaneda slide / orange sparks', district: 'jade megacity', motion: 'brake slide', seconds: 3.4, eye: [3.7, 0.4, -3.4], look: [0, 0.5, 0], end: [3, 0.75, -2.5], fov: 50, roll: 0.08 },
  { name: 'tower canyon / look up', district: 'jade megacity', motion: 'cruise', seconds: 4.2, eye: [1.2, 0.5, -5.8], look: [0, 34, 24], end: [-1.2, 1.2, -5], fov: 78 },
  { name: 'amber district / arrival', district: 'amber downtown', motion: 'cruise', seconds: 4.4, eye: [-7, 4.5, -12], look: [0, 9, 20], end: [-4, 3, -9], fov: 64 },
  { name: 'vermilion / front three quarter', district: 'amber downtown', motion: 'cruise', seconds: 3.1, eye: [-3, 0.8, 3.5], look: [0, 0.6, 0], end: [-2.6, 0.45, 3], fov: 42 },
  { name: 'tail light / exhaust afterimage', district: 'amber downtown', motion: 'launch', seconds: 3.1, eye: [2, 0.45, -3.3], look: [0, 0.48, -0.45], end: [2.4, 0.8, -4], fov: 47 },
  { name: 'downtown / left carve', district: 'amber downtown', motion: 'drift left', seconds: 3.4, eye: [4.1, 1.2, 2.4], look: [0, 0.5, 0], end: [3.5, 0.65, 1], fov: 49, roll: 0.1 },
  { name: 'commercial towers / aerial', district: 'amber downtown', motion: 'cruise', seconds: 4.5, eye: [-5.5, 23, -20], look: [0, 7, 24], end: [-3.5, 18, -15], fov: 65 },
  { name: 'violet arcade / neon gates', district: 'violet arcade', motion: 'cruise', seconds: 3.9, eye: [1.8, 0.8, -5.8], look: [0, 2, 7], end: [-1.5, 1.2, -4.7], fov: 58 },
  { name: 'arcade / twin lane slalom', district: 'violet arcade', motion: 'slalom', seconds: 4, eye: [-0.1, 1.7, -5], look: [0, 0.5, 0.5], end: [0.8, 1.3, -4.6], fov: 52, roll: -0.06 },
  { name: 'arcade / rear wheel sparks', district: 'violet arcade', motion: 'drift right', seconds: 3.3, eye: [-2.5, 0.22, -2.8], look: [0, 0.38, -0.5], end: [-3.3, 0.6, -2], fov: 48, roll: -0.09 },
  { name: 'violet / wheelie profile', district: 'violet arcade', motion: 'wheelie', seconds: 3.4, eye: [4, 0.8, 0.8], look: [0, 0.8, 0], end: [3.7, 1.2, 1.5], fov: 44 },
  { name: 'skyway / city reveal', district: 'cyan skyway', motion: 'cruise', seconds: 5, eye: [-5, 3, -10], look: [0, 14, 32], end: [3, 4.5, -9], fov: 70 },
  { name: 'skyway / bird eye', district: 'cyan skyway', motion: 'slalom', seconds: 4, eye: [0.4, 12, -1.5], look: [0, 0, 1], end: [3, 10, -3], fov: 59 },
  { name: 'skyway / cockpit horizon', district: 'cyan skyway', motion: 'cruise', seconds: 3.3, eye: [0, 1.1, -0.95], look: [0, 3, 20], end: [0.08, 1.18, -0.85], fov: 73 },
  { name: 'blue hour / exhaust ribbon', district: 'cyan skyway', motion: 'drift left', seconds: 3.7, eye: [4.6, 2.8, -6], look: [0, 1.4, -1], end: [3.3, 1.6, -5], fov: 58 },
  { name: 'skyway / front wheel lift', district: 'cyan skyway', motion: 'wheelie', seconds: 3.4, eye: [-3.5, 0.3, 3.2], look: [0, 0.8, 0], end: [-4, 1.1, 1.6], fov: 49 },
  { name: 'reactor / red skyline', district: 'red reactor', motion: 'cruise', seconds: 4.7, eye: [-5, 2, -10], look: [0, 22, 30], end: [-2.5, 3, -8], fov: 72 },
  { name: 'redline / drag launch', district: 'red reactor', motion: 'launch', seconds: 3, eye: [2.9, 0.3, 3.4], look: [0, 0.55, 0], end: [3.4, 0.6, 2.1], fov: 49 },
  { name: 'reactor / stationary burnout', district: 'red reactor', motion: 'burnout', seconds: 3.6, eye: [3.1, 0.6, -2.6], look: [0, 0.45, -0.3], end: [3.5, 0.8, -1.4], fov: 46 },
  { name: 'reactor / opposite lock', district: 'red reactor', motion: 'drift right', seconds: 3.5, eye: [-3.6, 1.2, 2.5], look: [0, 0.5, 0], end: [-4, 0.5, 1], fov: 48, roll: -0.1 },
  { name: 'searchlights / industrial cathedral', district: 'red reactor', motion: 'cruise', seconds: 4.8, eye: [3, 3, -7], look: [-12, 54, 35], end: [-3, 5, -5], fov: 82 },
  { name: 'harbor / blue avenue', district: 'harbor lights', motion: 'cruise', seconds: 4.8, eye: [-6, 3, -10], look: [0, 7, 28], end: [-3, 2, -8], fov: 65 },
  { name: 'harbor / red machine orbit', district: 'harbor lights', motion: 'orbit', seconds: 6, eye: [3.4, 1.2, 2.8], look: [0, 0.5, 0], end: [3.4, 1.5, 2.8], fov: 43 },
  { name: 'harbor / long light trail', district: 'harbor lights', motion: 'slalom', seconds: 4.2, eye: [-6.5, 5.5, -12], look: [0, 1, -3], end: [-4, 4, -9], fov: 58 },
  { name: 'harbor / brake slide finale', district: 'harbor lights', motion: 'brake slide', seconds: 3.8, eye: [4, 0.35, 3], look: [0, 0.5, 0], end: [3.5, 1, 1.7], fov: 49 },
  { name: 'Neo Tokyo / disappearing taillight', district: 'jade megacity', motion: 'cruise', seconds: 5.5, eye: [-3, 1.3, -14], look: [0, 16, 35], end: [-5, 2.3, -22], fov: 68 },
];

/** A short history of emitted world positions, advected with the street: the trail actually follows turns. */
function createAfterglow(scene: THREE.Scene) {
  const count = 120, positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  const history = Array.from({ length: count }, () => new THREE.Vector3()), ages = new Float32Array(count).fill(10);
  const geometry = new THREE.BufferGeometry();
  const at = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const tint = new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', at); geometry.setAttribute('color', tint);
  const trail = new THREE.Line(geometry, new THREE.LineBasicNodeMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  trail.name = 'Akira / persistent exhaust afterglow'; trail.frustumCulled = false; scene.add(trail);
  // A broad, fading ribbon surrounds the hot core; its reflection is another flat ribbon on the road.
  const ribbonGeometry = new THREE.BufferGeometry(), ribbonAt = new THREE.BufferAttribute(new Float32Array((count - 1) * 36), 3).setUsage(THREE.DynamicDrawUsage);
  const ribbonTint = new THREE.BufferAttribute(new Float32Array((count - 1) * 36), 3).setUsage(THREE.DynamicDrawUsage);
  ribbonGeometry.setAttribute('position', ribbonAt); ribbonGeometry.setAttribute('color', ribbonTint);
  const material = new THREE.MeshBasicNodeMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const ribbon = new THREE.Mesh(ribbonGeometry, material); ribbon.frustumCulled = false; ribbon.name = 'Akira / exhaust hue ribbon'; scene.add(ribbon);
  const reflection = new THREE.Mesh(ribbonGeometry, material); reflection.scale.set(1, 0.001, 1); reflection.position.y = 0.008; reflection.frustumCulled = false; scene.add(reflection);
  let debt = 0, generation = -1;
  return {
    update(dt: number, origin: THREE.Vector3, velocity: number, boost: number, serial: number, limited: boolean) {
      if (serial !== generation) { generation = serial; history.forEach(p => p.copy(origin)); ages.fill(10); debt = 0; }
      for (let i = 0; i < count; i++) { history[i].z -= dt * velocity; ages[i] += dt; }
      debt += dt;
      while (debt >= 1 / 45) {
        debt -= 1 / 45;
        for (let i = count - 1; i > 0; i--) { history[i].copy(history[i - 1]); ages[i] = ages[i - 1]; }
        history[0].copy(origin); ages[0] = 0;
      }
      const strength = limited ? 0.45 : 1;
      for (let i = 0; i < count; i++) {
        const fade = Math.max(0, 1 - ages[i] / 2.6) ** 1.5 * strength;
        const warm = Math.min(1, ages[i] * 3);
        positions.set(history[i].toArray(), i * 3);
        const color = [3.4 * fade, (0.65 + (1 - warm) * 0.9) * fade, (0.035 + (1 - warm) * 2.8) * fade];
        colors.set(color, i * 3);
        if (i >= count - 1) continue;
        const width = (0.055 + ages[i] * 0.16 + boost * 0.055) * fade;
        const a = history[i], b = history[i + 1], j = i * 36;
        ribbonAt.array.set([a.x - width, a.y, a.z, a.x + width, a.y, a.z, b.x - width, b.y, b.z,
          a.x + width, a.y, a.z, b.x + width, b.y, b.z, b.x - width, b.y, b.z,
          a.x, a.y - width * 0.5, a.z, a.x, a.y + width * 0.5, a.z, b.x, b.y - width * 0.5, b.z,
          a.x, a.y + width * 0.5, a.z, b.x, b.y + width * 0.5, b.z, b.x, b.y - width * 0.5, b.z], j);
        const glowColor = color.map(c => c * 0.3);
        for (let v = 0; v < 12; v++) ribbonTint.array.set(glowColor, j + v * 3);
      }
      at.needsUpdate = tint.needsUpdate = ribbonAt.needsUpdate = ribbonTint.needsUpdate = true;
      return ages.filter(age => age < 2.6).length;
    },
  };
}

export function createAkiraMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const { scene, camera } = sceneDefaults(6); camera.near = 0.025; camera.far = 700;
  const city = createAkiraCity(scene, budget), throttle = createNightRiderThrottle(), effects = createNightRiderEffects(scene, budget);
  const trail = createAfterglow(scene);
  const actor = new THREE.Group(); actor.name = 'Akira / bike only'; scene.add(actor);
  let shotIndex = 0, elapsed = 0, serial = 0, wheelClock = 0, lastOnset = false, district: AkiraDistrict | undefined;
  const models = whenLoaded([bikeUrl], ([gltf]) => {
    const bike = instantiate(gltf), materials = new Map<THREE.Material, THREE.Material>(); bike.root.name = 'Akira supplied bike';
    bike.root.traverse(object => {
      const mesh = object as THREE.Mesh; if (!mesh.isMesh) return;
      mesh.geometry = mesh.geometry.clone();
      const shade = (source: THREE.Material) => {
        let material = materials.get(source); if (material) return material;
        const old = source as THREE.MeshStandardMaterial;
        const cel = new THREE.MeshBasicNodeMaterial({ transparent: old.transparent, opacity: old.opacity, side: old.side, depthWrite: !old.transparent });
        const diffuse = normalWorld.dot(vec3(-0.3, 0.85, 0.5)).max(0);
        const bands = diffuse.smoothstep(0.12, 0.16).mul(0.35).add(diffuse.smoothstep(0.6, 0.65).mul(0.35)).add(0.5);
        const rim = abs(normalView.z).oneMinus().pow(4).mul(0.2);
        cel.colorNode = vec3(old.color.r, old.color.g, old.color.b).mul(bands)
          .add(mix(city.primary, city.accent, normalWorld.x.mul(0.5).add(0.5)).mul(rim))
          .add(vec3(old.emissive.r, old.emissive.g, old.emissive.b).mul(old.emissiveIntensity));
        cel.name = old.name; materials.set(source, cel); return cel;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(shade) : shade(mesh.material);
    });
    bike.materials.forEach(material => material.dispose()); actor.add(bike.root);
    const wheels = ['front_wheel', 'rear_wheel', 'rear_axlecap_L', 'rear_axlecap_R'].map(name => {
      const node = bike.node(name); return { node, rest: node.quaternion.clone() };
    });
    // The supplied mesh's low right-side outlet ends behind the cylinder centre.
    const outlet = new THREE.Object3D(); outlet.name = 'Akira exhaust outlet'; outlet.position.set(0.13, 0.22, -0.72); bike.root.add(outlet);
    scene.userData.assetsLoaded = true;
    return { bike, wheels, outlet };
  });
  const shadowMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  shadowMaterial.colorNode = vec3(0.001, 0.002, 0.004); shadowMaterial.opacityNode = uv().sub(0.5).length().smoothstep(0.5, 0.12).mul(0.8);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 3), shadowMaterial); shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.001; scene.add(shadow);
  const origin = new THREE.Vector3(), direction = new THREE.Vector3(), contact = new THREE.Vector3(), eye = new THREE.Vector3(), look = new THREE.Vector3();
  const rearPivot = new THREE.Vector3(0, 0.34, -0.8), rotated = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), spin = new THREE.Quaternion(), axle = new THREE.Vector3(1, 0, 0);
  scene.userData.assetsLoaded = false;
  const update = (frame: ModeFrame) => {
    resizeCamera(camera, frame.aspect);
    const dt = frame.reducedMotion ? 0 : THREE.MathUtils.clamp(frame.delta, 0, 0.1);
    const onset = frame.audio.onset && !lastOnset; lastOnset = frame.audio.onset;
    throttle.update(frame); elapsed += dt;
    let shot = AKIRA_SHOTS[shotIndex];
    if (dt > 0 && (elapsed >= shot.seconds || (shot.motion === 'cruise' && elapsed > shot.seconds * 0.8 && onset && frame.response.impact > 0.5))) {
      elapsed = 0; shotIndex = (shotIndex + 1) % AKIRA_SHOTS.length; serial++; shot = AKIRA_SHOTS[shotIndex];
    }
    if (district !== shot.district) { district = shot.district; city.setDistrict(district); }
    const phase = Math.min(1, elapsed / shot.seconds), envelope = Math.sin(phase * Math.PI);
    const parked = shot.motion === 'orbit' || shot.motion === 'burnout';
    const velocity = parked ? 0 : (shot.motion === 'launch' ? 8 + phase * 23 : 19) + frame.response.bass * 8 + throttle.boost * 12;
    city.energy.value = approach(city.energy.value, 0.3 + frame.response.loudness * 0.5 + (frame.reducedFlash ? 0 : frame.response.impact * 0.15), dt, 0.3);
    city.update(dt, velocity);
    const drift = ['drift left', 'drift right', 'brake slide'].includes(shot.motion) ? envelope : shot.motion === 'slalom' ? Math.abs(Math.sin(phase * Math.PI * 2)) * 0.6 : 0;
    const side = shot.motion === 'drift right' ? -1 : 1;
    actor.position.set(0, 0, 0); actor.rotation.set(0, 0, 0);
    if (drift > 0) {
      const sway = shot.motion === 'slalom' ? Math.sin(phase * Math.PI * 2) : side * envelope;
      actor.rotation.set(0, sway * (shot.motion === 'brake slide' ? 1.15 : 0.38), -sway * 0.36);
      actor.position.set(sway * (shot.motion === 'brake slide' ? 1.5 : 0.75), Math.abs(sway) * 0.04, 0);
    }
    if (shot.motion === 'wheelie') {
      actor.rotation.x = -envelope * 0.5;
      actor.position.copy(rearPivot).sub(rotated.copy(rearPivot).applyEuler(actor.rotation));
    }
    if (shot.motion === 'launch') { actor.position.z = -0.35 + phase * 0.7; actor.rotation.x = -envelope * 0.045; }
    shadow.position.x = actor.position.x; shadow.position.z = actor.position.z; shadow.rotation.z = -actor.rotation.y;
    const built = models.value;
    let trailSamples = 0;
    if (built) {
      wheelClock = (wheelClock + dt * (shot.motion === 'burnout' ? 55 : velocity / 0.34)) % (Math.PI * 2);
      spin.setFromAxisAngle(axle, wheelClock);
      built.wheels.forEach(({ node, rest }, i) => { node.quaternion.copy(rest); if (!(shot.motion === 'burnout' && i === 0)) node.quaternion.premultiply(spin); });
      actor.updateMatrixWorld(true); built.outlet.getWorldPosition(origin);
      direction.set(0, 0.14, -1).transformDirection(actor.matrixWorld);
      built.bike.node('rear_wheel').getWorldPosition(contact); contact.y = 0.025;
      effects.update(frame, origin, direction, contact, throttle, drift, shot.motion === 'burnout', velocity, serial);
      trailSamples = trail.update(dt, origin, velocity, throttle.boost, serial, frame.reducedFlash);
    }
    const ease = phase * phase * (3 - 2 * phase);
    eye.set(...shot.eye).lerp(rotated.set(...shot.end), ease); look.set(...shot.look);
    if (shot.motion === 'orbit') eye.sub(look).applyAxisAngle(up, phase * Math.PI * 2).add(look);
    if (frame.aspect < 1.25) eye.sub(look).multiplyScalar(Math.min(2.2, 1.25 / frame.aspect)).add(look);
    camera.position.copy(eye); camera.lookAt(look); camera.rotateZ((shot.roll ?? 0) * envelope);
    const fov = shot.fov + (parked ? 0 : throttle.boost * 3);
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    Object.assign(scene.userData, { shot: shot.name, shotIndex, district, motion: shot.motion, elapsed, velocity,
      wheelClock, travel: city.travel.value, trailSamples, effects: { ...effects.stats, boost: throttle.boost, bursts: throttle.bursts } });
  };
  return { scene, camera, update, ready: models.ready,
    filter(input) {
      const p = uv(), edge = p.sub(0.5).mul(vec2(1, 0.7)).length();
      const grain = fract(sin(p.x.mul(1271).add(p.y.mul(3117)).add(city.clock.mul(11))).mul(43758)).sub(0.5).mul(0.009);
      return vec4(input.sample(p).rgb.mul(edge.smoothstep(0.8, 0.15).mul(0.13).add(0.87)).add(vec3(grain)).max(vec3(0)), 1);
    },
    dispose() { effects.dispose(); models.dispose(); disposeScene(scene); },
  };
}
