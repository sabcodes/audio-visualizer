import * as THREE from 'three/webgpu';
import { abs, instancedBufferAttribute, mix, mx_noise_float, normalLocal, normalView, normalWorld, positionLocal, sin, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { QualityBudget } from '../rendering/quality';
import { seededRandom } from '../rendering/diagnostics';
import type { VisualMode } from './types';
import { approach, beatGate, disposeScene, resizeCamera, settleStep, wrap } from './shared';
import { instantiate, whenLoaded } from './figures';
import { asteroidGeometry } from './spaceMode';
import { drive } from './waveSixShared';
import shipUrl from '../assets/wave6/arwing_v1.glb?url';

// The supplied GLB faces +Z. These are the centres of its exhaust caps and cannon muzzles.
export const SHIP_EXHAUSTS = [[0.3, -0.1, -3.12], [-0.3, -0.1, -3.12]] as const;
export const SHIP_CANNONS = [[0.62, -0.38, 1.25], [-0.62, -0.38, 1.25]] as const;
type Maneuver = 'cruise' | 'roll' | 'lasers' | 'dodge';
interface FlightShot { name: string; seconds: number; eye: readonly [number, number, number]; look: readonly [number, number, number]; maneuver: Maneuver }
export const SPACE_SHIP_SHOTS: readonly FlightShot[] = [
  { name: 'Into the star sea', seconds: 7, eye: [7, 3.5, -14], look: [0, 0, 2], maneuver: 'cruise' },
  { name: 'Port wing flyby', seconds: 6, eye: [11, 3, 4], look: [0, 0, 0], maneuver: 'cruise' },
  { name: 'Nose camera', seconds: 6, eye: [-5, 2.2, 13], look: [0, 0, 0], maneuver: 'cruise' },
  { name: 'Above the rings', seconds: 6, eye: [1, 16, -5], look: [0, 0, 1], maneuver: 'cruise' },
  { name: 'Barrel roll', seconds: 5, eye: [4, 3, -15], look: [0, 0, 1], maneuver: 'roll' },
  { name: 'Twin ion engines', seconds: 6, eye: [-4, 1.4, -10], look: [0, -0.1, -1], maneuver: 'cruise' },
  { name: 'Laser run', seconds: 7, eye: [-8, 4, -14], look: [0, 0, 6], maneuver: 'lasers' },
  { name: 'Asteroid slalom', seconds: 7, eye: [2, 5, -18], look: [0, 0, 7], maneuver: 'dodge' },
  { name: 'Under the wings', seconds: 6, eye: [-8, -6, 8], look: [0, 0, 0], maneuver: 'cruise' },
  { name: 'Planetfall panorama', seconds: 8, eye: [15, 8, -23], look: [0, 0, 3], maneuver: 'cruise' },
];

/** A complete stunt has neutral endpoints, so camera cuts never leave the ship upside down. */
export function shipFlightPose(maneuver: Maneuver, phase: number) {
  const u = THREE.MathUtils.clamp(phase, 0, 1), turn = u * Math.PI * 2;
  const roll = THREE.MathUtils.smoothstep(u, 0.12, 0.88) * Math.PI * 2;
  return {
    x: maneuver === 'dodge' ? 7.5 * Math.sin(Math.PI * u) ** 2 : maneuver === 'roll' ? Math.sin(turn) * 0.9 : 0,
    y: maneuver === 'dodge' ? Math.sin(turn) * 1.5 : maneuver === 'roll' ? (1 - Math.cos(turn)) * 0.65 : 0,
    roll: maneuver === 'roll' ? roll : maneuver === 'dodge' ? -Math.sin(turn) * 0.65 : 0,
    pitch: maneuver === 'dodge' ? Math.sin(turn) * 0.14 : 0,
  };
}

/** Directed space flight: audio belongs to starlight and planetary atmospheres, not ship scale or position. */
export function createSpaceShipMode(budget: QualityBudget): VisualMode {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(52, 1, 0.1, 1400);
  scene.background = new THREE.Color(0x01030b);
  const random = seededRandom(4204), time = uniform(0), pulse = uniform(0), starSize = uniform(1), thrust = uniform(0);
  const actor = new THREE.Group(); actor.name = 'Arwing flight rig'; scene.add(actor);
  const sun = new THREE.DirectionalLight(0xd6eaff, 3.2); sun.position.set(-15, 20, 12);
  const rimLight = new THREE.DirectionalLight(0x687cff, 2); rimLight.position.set(4, -2, -12);
  scene.add(sun, rimLight, new THREE.HemisphereLight(0xb3ceff, 0x2d163d, 1.5));

  // A world-space nebula surrounds every angle, with dark dust lanes through its blue/violet gas.
  const skyMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  const sky = positionLocal.normalize(), cloud = mx_noise_float(sky.mul(4.2).add(vec3(7, 2, 9))).mul(0.5).add(0.5);
  const fine = mx_noise_float(sky.mul(12)).mul(0.5).add(0.5);
  const band = sky.y.add(sky.x.mul(0.35)).abs().smoothstep(0.7, 0.02);
  skyMaterial.colorNode = mix(vec3(0.005, 0.013, 0.04), vec3(0.07, 0.013, 0.085), cloud)
    .mul(band).mul(cloud.pow(2)).mul(fine.mul(0.8).add(0.2)).add(vec3(0.0008, 0.0015, 0.005));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(650, 40, 24), skyMaterial));

  const starsCount = Math.round(3800 * Math.min(2, budget.particleScale)), seeds = new Float32Array(starsCount * 4);
  for (let i = 0; i < starsCount; i++) {
    const azimuth = random() * Math.PI * 2, y = random() * 2 - 1, r = 260 + random() * 280;
    const horizontal = Math.sqrt(1 - y * y);
    seeds.set([Math.cos(azimuth) * horizontal * r, y * r, Math.sin(azimuth) * horizontal * r, random()], i * 4);
  }
  const seed = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(seeds, 4), 'vec4');
  const starMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const p = uv().sub(0.5), disc = p.length().smoothstep(0.5, 0.015).pow(3);
  const cross = p.x.abs().smoothstep(0.025, 0).mul(p.y.abs().smoothstep(0.45, 0))
    .add(p.y.abs().smoothstep(0.025, 0).mul(p.x.abs().smoothstep(0.45, 0)));
  const shimmer = sin(time.mul(0.65).add(seed.w.mul(150))).mul(0.12).add(0.88);
  starMaterial.positionNode = seed.xyz;
  starMaterial.scaleNode = vec2(seed.w.pow(5).mul(2.3).add(0.6)).mul(starSize);
  starMaterial.colorNode = mix(vec3(0.48, 0.7, 1.4), vec3(1.4, 1.03, 0.68), seed.w).mul(pulse.mul(1.5).add(0.65));
  starMaterial.opacityNode = disc.add(cross.mul(seed.w.pow(8)).mul(0.45)).mul(shimmer);
  const stars = new THREE.Sprite(starMaterial); stars.geometry = stars.geometry.clone(); stars.count = starsCount;
  stars.frustumCulled = false; stars.name = 'bouncing starlight'; scene.add(stars);

  const planets: { group: THREE.Group; radius: number }[] = [];
  const planetGeometry = new THREE.SphereGeometry(1, 64, 40);
  const addPlanet = (name: string, at: [number, number, number], radius: number, tint: THREE.Color, ringed = false) => {
    const group = new THREE.Group(); group.name = name; group.position.fromArray(at); group.scale.setScalar(radius); scene.add(group);
    const surface = new THREE.MeshBasicNodeMaterial();
    const noise = mx_noise_float(normalLocal.mul(7)).mul(0.5).add(0.5);
    const stripes = sin(normalLocal.y.mul(35).add(noise.mul(8))).mul(0.5).add(0.5);
    const pattern = ringed ? stripes : noise.smoothstep(0.38, 0.63);
    const light = normalWorld.dot(vec3(-0.6, 0.65, -0.4).normalize()).max(0);
    surface.colorNode = mix(vec3(tint.r, tint.g, tint.b).mul(0.18), vec3(tint.r, tint.g, tint.b), pattern)
      .mul(light.pow(0.65).mul(0.95).add(0.035));
    group.add(new THREE.Mesh(planetGeometry, surface));
    const atmosphere = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending });
    const edge = abs(normalView.z).oneMinus().pow(3);
    atmosphere.colorNode = vec3(tint.r, tint.g, tint.b).mul(pulse.mul(1.2).add(0.45));
    atmosphere.opacityNode = edge.mul(0.75);
    const shell = new THREE.Mesh(planetGeometry, atmosphere); shell.scale.setScalar(1.055); shell.name = 'bouncing atmosphere'; group.add(shell);
    if (ringed) {
      const ringMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false });
      const radial = positionLocal.length(), grain = sin(radial.mul(170)).mul(0.18).add(0.75);
      ringMaterial.colorNode = vec3(0.4, 0.57, 0.72).mul(grain).mul(pulse.mul(0.25).add(0.7));
      ringMaterial.opacityNode = grain.mul(radial.sub(1.85).abs().smoothstep(0.09, 0.04).mul(0.65).add(0.15));
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.3, 2.35, 128), ringMaterial);
      ring.rotation.set(-1.15, 0.2, 0.3); group.add(ring);
    }
    planets.push({ group, radius });
  };
  addPlanet('Aurelia ringed giant', [-64, 30, 108], 27, new THREE.Color(0.34, 0.62, 1), true);
  addPlanet('Rose moon', [74, -28, -110], 22, new THREE.Color(0.83, 0.25, 0.46));
  addPlanet('Glacial world', [80, 48, 110], 13, new THREE.Color(0.2, 0.8, 0.68));

  // Keep ambient debris outside the swept wing envelope. One directed near miss owns the slalom lane.
  const rockMaterial = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.96 });
  const rocks = new THREE.InstancedMesh(asteroidGeometry(47, 3), rockMaterial, budget.preset === 'compatibility' ? 64 : 110);
  rocks.name = 'passing asteroid belt'; rocks.frustumCulled = false; rocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(rocks);
  const rockSeeds = Array.from({ length: rocks.count }, () => {
    const angle = random() * Math.PI * 2, radius = 15 + random() ** 1.5 * 65;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z: random() * 300 - 120, size: 0.5 + random() ** 2 * 3, spin: random() * 6 };
  });
  const dummy = new THREE.Object3D();
  const obstacle = new THREE.Mesh(asteroidGeometry(19, 3), rockMaterial); obstacle.name = 'slalom near miss'; obstacle.scale.setScalar(2); obstacle.visible = false; scene.add(obstacle);

  const flameMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const ripple = sin(uv().y.mul(40).sub(time.mul(35))).mul(0.15).add(0.85);
  flameMaterial.colorNode = mix(vec3(0.08, 0.24, 2.6), vec3(0.55, 1.8, 3.2), uv().y.pow(2)).mul(thrust.mul(0.9).add(0.65));
  flameMaterial.opacityNode = uv().y.pow(0.6).mul(ripple).mul(0.65);
  const coreMaterial = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(1.9, 2.5, 3), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
  coreMaterial.colorNode = vec3(1.9, 2.5, 3).mul(thrust.mul(0.5).add(0.65));
  const nozzleMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  nozzleMaterial.colorNode = vec3(0.18, 0.8, 2.8).mul(thrust.mul(1.4).add(0.55)); nozzleMaterial.opacityNode = disc.mul(0.8);
  const cone = new THREE.CylinderGeometry(0.145, 0.005, 1, 20, 1, true).translate(0, -0.5, 0).rotateX(Math.PI / 2);
  const coreCone = new THREE.CylinderGeometry(0.08, 0.001, 1, 12, 1, true).translate(0, -0.5, 0).rotateX(Math.PI / 2);
  const exhausts = SHIP_EXHAUSTS.map((at) => {
    const group = new THREE.Group(); group.position.fromArray(at); group.name = 'ion exhaust'; actor.add(group);
    group.add(new THREE.Mesh(cone, flameMaterial), new THREE.Mesh(coreCone, coreMaterial));
    group.children[1].scale.z = 0.65;
    const flare = new THREE.Sprite(nozzleMaterial); flare.geometry = flare.geometry.clone(); flare.position.fromArray(at); flare.position.z -= 0.02; flare.scale.setScalar(0.9); actor.add(flare);
    return group;
  });

  const laserMaterial = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0.24, 3.2, 0.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const laserGeometry = new THREE.CylinderGeometry(0.035, 0.035, 3.5, 8).rotateX(Math.PI / 2);
  const bolts = Array.from({ length: 24 }, () => {
    const mesh = new THREE.Mesh(laserGeometry, laserMaterial); mesh.visible = false; mesh.name = 'cannon bolt'; scene.add(mesh);
    return { mesh, velocity: new THREE.Vector3(), age: 10 };
  });
  const muzzleMaterial = new THREE.SpriteNodeMaterial({ color: new THREE.Color(0.4, 2.5, 0.9), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  muzzleMaterial.opacityNode = disc;
  const muzzles = SHIP_CANNONS.map((at) => {
    const sprite = new THREE.Sprite(muzzleMaterial); sprite.geometry = sprite.geometry.clone(); sprite.position.fromArray(at); sprite.scale.setScalar(0.65); sprite.visible = false; actor.add(sprite); return sprite;
  });

  const models = whenLoaded([shipUrl], ([gltf]) => {
    const ship = instantiate(gltf);
    ship.root.name = 'supplied Arwing';
    ship.root.traverse((object) => { const mesh = object as THREE.Mesh; if (mesh.isMesh) mesh.geometry = mesh.geometry.clone(); });
    actor.add(ship.root);
    const mixer = new THREE.AnimationMixer(ship.root), flex = ship.clips.get('wing_flex');
    if (flex) mixer.clipAction(flex).play();
    scene.userData.assetsLoaded = true;
    return { ship, mixer };
  });

  const beat = beatGate(0.14);
  let shotIndex = 0, elapsed = 0, travel = 0, shotStart = true, muzzleAge = 1, boltIndex = 0, lastOnset = false, previousImpact = 0;
  const look = new THREE.Vector3(), eye = new THREE.Vector3(), previousEye = new THREE.Vector3(), previousLook = new THREE.Vector3();
  return {
    scene, camera, ready: models.ready,
    update(frame) {
      const dt = frame.reducedMotion ? 0 : THREE.MathUtils.clamp(frame.delta, 0, 0.1);
      const step = Math.min(0.1, Math.max(0, settleStep(frame)));
      elapsed += dt; time.value += dt; travel = wrap(travel + dt * 21, 0, 300);
      if (elapsed >= SPACE_SHIP_SHOTS[shotIndex].seconds) {
        previousEye.copy(camera.position).sub(actor.position); previousLook.copy(look).sub(actor.position);
        elapsed -= SPACE_SHIP_SHOTS[shotIndex].seconds; shotIndex = (shotIndex + 1) % SPACE_SHIP_SHOTS.length; shotStart = false;
      }
      const shot = SPACE_SHIP_SHOTS[shotIndex], phase = elapsed / shot.seconds;
      const pose = shipFlightPose(shot.maneuver, phase);
      actor.position.set(pose.x + Math.sin(time.value * 0.4) * 0.35, pose.y + Math.sin(time.value * 0.55) * 0.18, 0);
      actor.rotation.set(pose.pitch + Math.cos(time.value * 0.55) * 0.025, Math.cos(time.value * 0.4) * 0.025, pose.roll + Math.sin(time.value * 0.4) * 0.035, 'YXZ');
      models.value?.mixer.update(dt * 0.65);
      const targetPulse = Math.min(2, Math.max(0, drive(frame))) * (frame.reducedFlash ? 0.2 : 1);
      pulse.value = approach(pulse.value, targetPulse, step, targetPulse > pulse.value ? 0.045 : 0.24);
      starSize.value = 1 + (frame.reducedMotion ? 0 : pulse.value * 0.65);
      for (const planet of planets) planet.group.scale.setScalar(planet.radius * (1 + (frame.reducedMotion ? 0 : pulse.value * 0.025)));
      // Share one fresh beat trigger between the engine surge and the twin cannon volley.
      const trigger = (frame.audio.onset && !lastOnset) || frame.response.impact - previousImpact > 0.3;
      lastOnset = frame.audio.onset; previousImpact = frame.response.impact;
      const fired = dt > 0 && beat(time.value, trigger);
      thrust.value *= Math.exp(-step / 0.18);
      if (fired) thrust.value = Math.min(1.5, 0.7 + frame.response.impact * 0.4 + Math.max(0, drive(frame)) * 0.25);
      if (frame.reducedFlash) thrust.value = Math.min(0.25, thrust.value);
      if (!frame.reducedMotion) for (const exhaust of exhausts) exhaust.scale.z = 2.3 + thrust.value * 2.4;
      for (let i = 0; i < rocks.count; i++) {
        const seed = rockSeeds[i];
        dummy.position.set(seed.x, seed.y, wrap(seed.z - travel, -120, 180));
        dummy.rotation.set(seed.spin + time.value * 0.08, seed.spin * 2 + time.value * 0.12, seed.spin);
        dummy.scale.setScalar(seed.size); dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix);
      }
      rocks.instanceMatrix.needsUpdate = true;
      obstacle.visible = shot.maneuver === 'dodge'; obstacle.position.set(0, 0, 65 * (1 - 2 * phase)); obstacle.rotation.set(time.value * 0.2, time.value * 0.15, 0);

      muzzleAge += dt;
      actor.updateMatrixWorld(true);
      if (fired && shot.maneuver === 'lasers') {
        muzzleAge = 0;
        for (const at of SHIP_CANNONS) {
          const bolt = bolts[boltIndex++ % bolts.length]; bolt.age = 0; bolt.mesh.visible = true;
          bolt.mesh.position.fromArray(at).applyMatrix4(actor.matrixWorld); bolt.mesh.quaternion.copy(actor.quaternion);
          bolt.velocity.set(0, 0, 85).applyQuaternion(actor.quaternion);
        }
      }
      for (const bolt of bolts) {
        bolt.age += dt; bolt.mesh.visible = bolt.age < 1.5;
        if (bolt.mesh.visible) bolt.mesh.position.addScaledVector(bolt.velocity, dt);
      }
      for (const muzzle of muzzles) muzzle.visible = !frame.reducedFlash && muzzleAge < 0.07;
      laserMaterial.opacity = frame.reducedFlash ? 0.5 : 1;
      eye.set(...shot.eye); look.set(...shot.look);
      const arc = Math.sin(phase * Math.PI) * 0.08, x = eye.x;
      eye.x = x * Math.cos(arc) + eye.z * Math.sin(arc); eye.z = eye.z * Math.cos(arc) - x * Math.sin(arc);
      if (!shotStart) {
        const blend = THREE.MathUtils.smoothstep(elapsed, 0, 0.8);
        eye.lerpVectors(previousEye, eye, blend); look.lerpVectors(previousLook, look, blend);
      }
      eye.sub(look).multiplyScalar(Math.max(1, 1.4 / Math.max(0.2, frame.aspect))).add(look);
      eye.add(actor.position); look.add(actor.position); camera.position.copy(eye); camera.lookAt(look); resizeCamera(camera, frame.aspect);
      scene.userData.shot = shot.name; scene.userData.shotIndex = shotIndex; scene.userData.maneuver = shot.maneuver;
      scene.userData.phase = phase; scene.userData.pulse = pulse.value; scene.userData.thrust = thrust.value; scene.userData.activeLasers = bolts.filter((bolt) => bolt.mesh.visible).length;
    },
    dispose() {
      const built = models.value;
      if (built) {
        built.mixer.stopAllAction(); built.mixer.uncacheRoot(built.ship.root);
        const skeletons = new Set<THREE.Skeleton>();
        built.ship.root.traverse((object) => { if ((object as THREE.SkinnedMesh).isSkinnedMesh) skeletons.add((object as THREE.SkinnedMesh).skeleton); });
        skeletons.forEach((skeleton) => skeleton.dispose());
      }
      models.dispose(); disposeScene(scene);
    },
  };
}
