import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { exp, float, fract, instanceIndex, instancedBufferAttribute, mix, normalize, positionLocal, sin, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, wrap, bandEnergies, beatGate } from './shared';
import { seededRandom } from '../rendering/diagnostics';
import { presetBudget, type QualityBudget } from '../rendering/quality';

// ---------------------------------------------------------------- Beat fireworks

export const FIREWORK_SLOTS = 24, FUSE = 0.9;
/** Kind and age (seconds after bursting) of the bursts shown as a still under reduced motion. */
const STILL_BURSTS: [FireworkKind, number][] = [[0, 0.7], [1, 1.5], [2, 0.5], [0, 1.1], [1, 0.9]];
export type FireworkKind = 0 | 1 | 2; // peony, willow, crackle
/** Kick-heavy beats burst as peonies, mid-heavy as willows, hat-heavy as crackle. */
export function fireworkKind(low: number, mid: number, high: number): FireworkKind {
  if (high > low * 1.2 && high > mid) return 2;
  return mid > low ? 1 : 0;
}

export function createFireworksMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  camera.position.set(0, 26, 150); camera.lookAt(0, 52, 0);
  const perBurst = Math.round(220 * Math.min(2, budget.particleScale)), count = FIREWORK_SLOTS * perBurst;
  const random = seededRandom(4);
  // Each spark carries its burst's origin + start time and colour + kind, rewritten for that slot on launch.
  const seeds = new Float32Array(count * 4), origins = new Float32Array(count * 4).fill(-100), looks = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const z = random() * 2 - 1, a = random() * Math.PI * 2, s = Math.sqrt(1 - z * z), speed = 0.75 + random() * 0.25;
    seeds.set([Math.cos(a) * s * speed, z * speed, Math.sin(a) * s * speed, random()], i * 4);
  }
  const originAttribute = new THREE.InstancedBufferAttribute(origins, 4), lookAttribute = new THREE.InstancedBufferAttribute(looks, 4);
  const seed = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(seeds, 4), 'vec4');
  const burst = instancedBufferAttribute<'vec4'>(originAttribute, 'vec4'), look = instancedBufferAttribute<'vec4'>(lookAttribute, 'vec4');
  const clock = uniform(0), brightness = uniform(1);
  const kind = look.w, t = clock.sub(burst.w).sub(FUSE);
  const isWillow = kind.equal(1).select(float(1), float(0)), isCrackle = kind.equal(2).select(float(1), float(0));
  const speed = mix(mix(float(46), float(30), isWillow), float(52), isCrackle), gravity = mix(float(6), float(12), isWillow), life = mix(mix(float(2.2), float(3.6), isWillow), float(1.6), isCrackle);
  const drag = 1.5, travel = exp(t.max(0).mul(-drag)).oneMinus().div(drag);
  const position = burst.xyz.add(seed.xyz.mul(speed).mul(travel)).sub(vec3(0, t.max(0).mul(t.max(0)).mul(gravity).mul(0.5), 0));
  const age = t.div(life), alive = t.greaterThan(0).select(float(1), float(0)).mul(age.lessThan(1).select(float(1), float(0)));
  const crackle = fract(sin(seed.w.mul(91.7).add(clock.mul(23).floor())).mul(43758.5453)).lessThan(0.45).select(float(1), float(0)).mul(isCrackle).add(isCrackle.oneMinus());
  const fade = age.oneMinus().clamp(0, 1).pow(1.4).mul(alive).mul(crackle);
  const sparkMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  sparkMaterial.positionNode = position;
  sparkMaterial.colorNode = look.xyz.mul(brightness).mul(fade.mul(3.2));
  sparkMaterial.opacityNode = uv().sub(0.5).length().smoothstep(0.5, 0.05);
  sparkMaterial.scaleNode = vec2(mix(float(1.5), float(1.2), isWillow).mul(alive));
  // Reflection on the water: the same sparks mirrored below y = 0, dimmed and stretched.
  const reflectionMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  reflectionMaterial.positionNode = vec3(position.x, position.y.mul(-0.9).sub(2), position.z);
  reflectionMaterial.colorNode = look.xyz.mul(brightness).mul(fade.mul(0.5));
  reflectionMaterial.opacityNode = uv().sub(0.5).mul(vec2(1, 0.4)).length().smoothstep(0.5, 0.05);
  reflectionMaterial.scaleNode = vec2(mix(float(1.5), float(1.2), isWillow).mul(alive));
  const sprite = (material: THREE.SpriteNodeMaterial, instances: number) => {
    const object = new THREE.Sprite(material); object.geometry = object.geometry.clone(); object.count = instances; object.frustumCulled = false; scene.add(object);
  };
  sprite(sparkMaterial, count); sprite(reflectionMaterial, count);
  // Rockets: one ember per slot climbing from the shore to its burst point during the fuse.
  const rockets = new Float32Array(FIREWORK_SLOTS * 4).fill(-100), rocketAttribute = new THREE.InstancedBufferAttribute(rockets, 4);
  const rocket = instancedBufferAttribute<'vec4'>(rocketAttribute, 'vec4');
  const climb = clock.sub(rocket.w).div(FUSE);
  const climbing = climb.greaterThan(0).select(float(1), float(0)).mul(climb.lessThan(1).select(float(1), float(0)));
  const eased = climb.clamp(0, 1).oneMinus().pow(2).oneMinus();
  const rocketMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  rocketMaterial.positionNode = vec3(rocket.x, rocket.y.mul(eased), rocket.z);
  rocketMaterial.colorNode = vec3(2.4, 1.4, 0.6).mul(climbing);
  rocketMaterial.opacityNode = uv().sub(0.5).length().smoothstep(0.5, 0.05);
  rocketMaterial.scaleNode = vec2(climbing.mul(1.1));
  sprite(rocketMaterial, FIREWORK_SLOTS);

  const skyMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  const dir = normalize(positionLocal);
  skyMaterial.colorNode = mix(vec3(0.02, 0.025, 0.06), vec3(0.002, 0.003, 0.012), dir.y.smoothstep(0, 0.45));
  const waterMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, opacity: 0.75, depthWrite: false });
  waterMaterial.colorNode = vec3(0.004, 0.008, 0.02);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2000, 1200), waterMaterial); water.rotation.x = -Math.PI / 2; water.position.y = -0.5; water.renderOrder = -1;
  const shape = new THREE.Shape(); shape.moveTo(-600, 0);
  for (let x = -600; x <= 600; x += 12) shape.lineTo(x, 3 + Math.abs(Math.sin(x * 0.05) * 6 + Math.sin(x * 0.13) * 4) * (random() < 0.25 ? 2.5 : 1));
  shape.lineTo(600, 0);
  const shore = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicNodeMaterial({ color: 0x010103 })); shore.position.set(0, 0, -260);
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), skyMaterial), shore, water);

  const launchGate = beatGate(0.18), bands = new Float32Array(3), colour = new THREE.Color();
  let time = 0, next = 0, idle = 0, tableau = false;
  const launch = (kind: FireworkKind, hue: number, start = time) => {
    const i = next; next = (next + 1) % FIREWORK_SLOTS;
    const x = (random() - 0.5) * 150, y = 48 + random() * 50, z = (random() - 0.5) * 70 - 20;
    if (kind === 1) colour.setRGB(2.2, 1.4, 0.45);
    else if (kind === 2) colour.setRGB(2.4, 2.4, 2.6);
    else colour.setHSL(wrap(hue + random() * 0.5, 0, 1), 1, 0.55).multiplyScalar(1.4);
    for (let k = i * perBurst; k < (i + 1) * perBurst; k++) { origins.set([x, y, z, start], k * 4); looks.set([colour.r, colour.g, colour.b, kind], k * 4); }
    rockets.set([x, y, z, start], i * 4);
    originAttribute.needsUpdate = lookAttribute.needsUpdate = rocketAttribute.needsUpdate = true;
  };
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time += Math.max(0, Math.min(frame.delta, 0.25)); idle += frame.delta;
      if (frame.reducedMotion) {
        // The clock is frozen: stage one still of bursts at different ages instead of launching on beats.
        if (!tableau) { STILL_BURSTS.forEach(([kind, age]) => launch(kind, frame.hue, time - FUSE - age)); tableau = true; }
      } else if (launchGate(frame.time, frame.audio.onset || frame.response.impact > 0.55)) { bandEnergies(frame, 3, bands); launch(fireworkKind(bands[0], bands[1], bands[2]), frame.hue); idle = 0; }
      else if (idle > 0.9) { launch(0, frame.hue); idle = 0; }
      if (!frame.reducedMotion) tableau = false;
      clock.value = time;
      brightness.value = frame.reducedFlash ? 0.7 : 1 + frame.response.bounce * 0.4;
      camera.position.x = Math.sin(frame.time * 0.05) * 12;
      camera.lookAt(0, 52, 0);
    },
    dispose: () => disposeScene(scene),
  };
}

// ---------------------------------------------------------------- Mirror-ball disco

const BALL_RADIUS = 9, BALL_ROWS = 26, SPOTS = 180, BEAMS = 14, ROOM = 76;

export function createDiscoMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  const random = seededRandom(70);
  const time = uniform(0), sparkle = uniform(0), flip = uniform(0), bass = uniform(0);
  const ball = new THREE.Group(); ball.position.y = 14; scene.add(ball);
  // Mirror tiles laid out row by row so they stay square near the poles.
  const tiles: THREE.Matrix4[] = [], dummy = new THREE.Object3D();
  for (let row = 0; row < BALL_ROWS; row++) {
    const lat = (row + 0.5) / BALL_ROWS * Math.PI - Math.PI / 2, ring = Math.max(4, Math.round(BALL_ROWS * 2 * Math.cos(lat)));
    for (let k = 0; k < ring; k++) {
      const lon = (k + (row % 2) * 0.5) / ring * Math.PI * 2;
      dummy.position.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)).multiplyScalar(BALL_RADIUS);
      dummy.lookAt(dummy.position.clone().multiplyScalar(2)); dummy.updateMatrix(); tiles.push(dummy.matrix.clone());
    }
  }
  const tileMaterial = new THREE.MeshBasicNodeMaterial();
  const flicker = fract(sin(float(instanceIndex).mul(78.233).add(time.mul(14).floor().mul(3.1))).mul(43758.5453));
  const face = fract(sin(float(instanceIndex).mul(12.9898)).mul(43758.5453));
  tileMaterial.colorNode = vec3(0.18, 0.19, 0.22).add(vec3(face.mul(0.12))).add(vec3(flicker.lessThan(sparkle).select(float(4), float(0))));
  const tileMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.05, 1.05, 0.2), tileMaterial, tiles.length);
  tiles.forEach((matrix, i) => tileMesh.setMatrixAt(i, matrix));
  ball.add(tileMesh);
  const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 60), new THREE.MeshBasicNodeMaterial({ color: 0x222222 })); hanger.position.y = 14 + BALL_RADIUS + 30;
  scene.add(hanger);

  // Light spots ride with the ball: unit directions on the room's wall, coloured from a rotating palette.
  const spotData = new Float32Array(SPOTS * 4), directions: THREE.Vector3[] = [];
  for (let i = 0; i < SPOTS; i++) {
    const z = random() * 2 - 1, a = random() * Math.PI * 2, s = Math.sqrt(1 - z * z);
    const direction = new THREE.Vector3(Math.cos(a) * s, z, Math.sin(a) * s); directions.push(direction);
    spotData.set([direction.x * ROOM, direction.y * ROOM, direction.z * ROOM, random()], i * 4);
  }
  const spot = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(spotData, 4), 'vec4');
  const spotMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  spotMaterial.positionNode = spot.xyz;
  const tone = (h: Node<'float'>) => vec3(h, h.add(2 / 3), h.add(1 / 3)).fract().mul(6).sub(3).abs().sub(1).clamp(0, 1);
  const spotHue = spot.w.mul(3).floor().div(3).add(flip);
  spotMaterial.colorNode = tone(spotHue).mul(bass.mul(1.6).add(0.8));
  spotMaterial.opacityNode = uv().sub(0.5).length().smoothstep(0.5, 0.2).mul(0.85);
  spotMaterial.scaleNode = vec2(float(2.6).add(bass.mul(1.2)));
  const spots = new THREE.Sprite(spotMaterial); spots.geometry = spots.geometry.clone(); spots.count = SPOTS; spots.frustumCulled = false;
  ball.add(spots);
  // Beams: thin additive cones from the ball out to a few of the spots.
  const beamGeometry = new THREE.CylinderGeometry(0.05, 1.3, ROOM, 10, 1, true); beamGeometry.translate(0, ROOM / 2, 0);
  const beamMaterials: THREE.MeshBasicNodeMaterial[] = [];
  for (let i = 0; i < BEAMS; i++) {
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(beamGeometry, material);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), directions[i * 7]);
    beamMaterials.push(material); ball.add(beam);
  }
  // Sweeping wash lights from the floor corners.
  const washes = [-1, 1].flatMap((x) => [-1, 1].map((z) => {
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const geometry = new THREE.CylinderGeometry(0.4, 7, 110, 16, 1, true); geometry.translate(0, 55, 0);
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x * 50, -30, z * 40); scene.add(mesh);
    return { mesh, material, x, z };
  }));
  const roomMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  roomMaterial.colorNode = vec3(0.012, 0.006, 0.02).add(vec3(0.02, 0.0, 0.03).mul(normalize(positionLocal).y.add(1).mul(0.5)));
  const floorMaterial = new THREE.MeshBasicNodeMaterial();
  const tilesOnFloor = positionLocal.xy.div(8).floor();
  const floorGlow = fract(sin(tilesOnFloor.x.mul(12.9).add(tilesOnFloor.y.mul(78.2)).add(time.mul(2).floor())).mul(43758.5)).lessThan(0.18).select(float(1), float(0));
  floorMaterial.colorNode = vec3(0.01, 0.008, 0.015).add(tone(flip.add(fract(tilesOnFloor.x.mul(0.17).add(tilesOnFloor.y.mul(0.31))))).mul(floorGlow.mul(bass.mul(0.6).add(0.15))));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(ROOM, 64), floorMaterial); floor.rotation.x = -Math.PI / 2; floor.position.y = -30;
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(ROOM + 2, 48, 24), roomMaterial), floor);

  const flipGate = beatGate(0.45), colour = new THREE.Color();
  let spin = 0, orbit = 0, flipValue = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time; bass.value = frame.response.bounce;
      sparkle.value = 0.02 + frame.audio.highs * 0.25;
      if (flipGate(frame.time, frame.audio.onset)) flipValue = (flipValue + (frame.reducedFlash ? 0.08 : 0.33)) % 1;
      flip.value = wrap(frame.hue + flipValue, 0, 1);
      spin += frame.delta * (0.25 + frame.response.bass * 0.6);
      ball.rotation.y = spin;
      ball.scale.setScalar(1 + frame.response.bounce * 0.05);
      beamMaterials.forEach((material, i) => material.color.setHSL(wrap(flip.value + Math.floor(i / 5) / 3, 0, 1), 1, 0.5).multiplyScalar(0.03 + frame.response.bounce * 0.05));
      washes.forEach((wash, i) => {
        wash.mesh.rotation.set(Math.sin(frame.time * 0.6 + i) * 0.5 - wash.z * 0.25, 0, Math.cos(frame.time * 0.5 + i * 1.3) * 0.5 - wash.x * 0.3);
        wash.material.color.copy(colour.setHSL(wrap(flip.value + i * 0.25, 0, 1), 1, 0.5)).multiplyScalar(0.03 + frame.response.bounce * 0.05);
      });
      orbit += frame.delta * 0.08;
      camera.position.set(Math.sin(orbit) * 48, -6 + Math.sin(frame.time * 0.15) * 4, Math.cos(orbit) * 48);
      camera.lookAt(0, 10, 0);
    },
    dispose: () => disposeScene(scene),
  };
}
