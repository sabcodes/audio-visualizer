import * as THREE from 'three/webgpu';
import { float, fract, instancedBufferAttribute, mix, mx_noise_float, normalLocal, normalView, positionLocal, sin, cos, uniform, uv, vec2, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { VisualMode } from './types';
import { approach, disposeScene, resizeCamera, sceneDefaults, settleStep } from './shared';
import { createHits } from './hitPulse';
import { drive } from './waveSixShared';
import { whenLoaded } from './figures';
import { growTree } from './lanternTreeMode';
import { seededRandom } from '../rendering/diagnostics';
import { presetBudget, type QualityBudget } from '../rendering/quality';
import pumpkinUrl from '../assets/wave6/pumpkin_v1.glb?url';

const ATTACKS = ['eyes', 'mouth', 'combined', 'sweep'] as const;
export const PUMPKIN_SHOTS = ['front', 'side orbit', 'low angle', 'skin rise'] as const;
const SHOT_SECONDS = [6, 7, 7, 8];
const smooth = THREE.MathUtils.smoothstep;

/** The supplied pumpkin breaks a recessed screen plane, fires toward the viewer, then recoils. */
export function createEvilPumpkinMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const { scene, camera } = sceneDefaults(5.6);
  camera.fov = 42; camera.far = 45; camera.updateProjectionMatrix();
  scene.background = new THREE.Color(0x010003);
  const time = uniform(0), stageEnergy = uniform(0.1), fire = uniform(0), aspect = uniform(16 / 9);
  const hits = createHits({ decay: 0.22, interval: 0.18 });
  const random = seededRandom(1031);

  // Cover the camera frustum at every aspect, including ultrawide. The portal is a depth cue within the landscape.
  const backdrop = new THREE.MeshBasicNodeMaterial({ depthWrite: false });
  const p = uv().sub(0.5).mul(vec2(aspect, 1));
  const billow = mx_noise_float(vec3(p.mul(3.1), time.mul(0.045)));
  const smoke = mx_noise_float(vec3(p.mul(7).add(billow.mul(0.55)), time.mul(-0.065))).mul(0.5).add(0.5);
  const fineSmoke = mx_noise_float(vec3(p.mul(18), time.mul(0.08))).mul(0.5).add(0.5);
  const distance = p.mul(vec2(1, 0.88)).length();
  const eclipse = distance.sub(0.23).abs().smoothstep(0.14, 0.015);
  const horizon = p.y.add(0.28).abs().smoothstep(0.32, 0);
  backdrop.colorNode = mix(vec3(0.009, 0.002, 0.009), vec3(0.19, 0.012, 0.018), smoke.pow(2))
    .add(vec3(0.17, 0.025, 0.006).mul(eclipse).mul(smoke.mul(0.6).add(0.35)))
    .add(vec3(0.025, 0.065, 0.055).mul(horizon).mul(fineSmoke).mul(0.5))
    .mul(stageEnergy.mul(0.45).add(0.8));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), backdrop);
  screen.name = 'haunted full-width sky'; screen.position.z = -6; scene.add(screen);

  // Camera-aligned top/bottom masks have real depth. The head and jets can cross in front of them.
  // There are no side masks: the haunted landscape still reaches the entire width.
  const borderFrame = new THREE.Group(); borderFrame.name = 'pumpkin screen borders'; camera.add(borderFrame); scene.add(camera);
  const borderGeometry = new THREE.PlaneGeometry(1, 1);
  const black = new THREE.MeshBasicNodeMaterial({ color: 0x000000, fog: false });
  const edge = new THREE.MeshBasicNodeMaterial({ color: 0x67140d, fog: false });
  for (const side of [-1, 1]) {
    const bar = new THREE.Mesh(borderGeometry, black); bar.name = side > 0 ? 'top screen border' : 'bottom screen border';
    bar.position.y = side * 1.26; bar.scale.set(1.05, 2, 1); borderFrame.add(bar);
    const rim = new THREE.Mesh(borderGeometry, edge); rim.position.set(0, side * 0.261, 0.002); rim.scale.set(1.05, 0.002, 1); borderFrame.add(rim);
  }


  // The existing branching helper supplies bare, crooked silhouettes; no additional model assets are needed.
  const treePieces: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
    const { branches } = growTree(3, 140 + i + (side + 1) * 20);
    const transform = new THREE.Matrix4().compose(new THREE.Vector3(side * (1.7 + i * 1.22), -2.1, -2.4 - random() * 1.8),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, random() * 6, side * 0.15)), new THREE.Vector3(0.24, 0.3 + random() * 0.08, 0.22));
    for (const branch of branches) {
      const v = branch.b.clone().sub(branch.a);
      const piece = new THREE.CylinderGeometry(branch.r2 * 0.65, branch.r1 * 0.85, v.length(), 5);
      piece.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize()));
      piece.translate((branch.a.x + branch.b.x) / 2, (branch.a.y + branch.b.y) / 2, (branch.a.z + branch.b.z) / 2);
      piece.applyMatrix4(transform); treePieces.push(piece);
    }
  }
  const bark = new THREE.MeshStandardNodeMaterial({ color: 0x0b0507, roughness: 1, emissive: 0x120205, emissiveIntensity: 0.12 });
  const forest = new THREE.Mesh(mergeGeometries(treePieces), bark); forest.name = 'dead forest'; scene.add(forest);
  treePieces.forEach(piece => piece.dispose());

  const gateMaterial = new THREE.MeshBasicNodeMaterial();
  const gateNoise = mx_noise_float(positionLocal.mul(13).add(vec3(0, time.mul(0.18), 0))).mul(0.5).add(0.5);
  gateMaterial.colorNode = vec3(0.75, 0.055, 0.008).mul(gateNoise.pow(3)).mul(stageEnergy.add(0.5));
  const gate = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.025, 5, 100), gateMaterial);
  gate.name = 'ember portal'; gate.position.set(0, -0.02, -2); gate.scale.set(1.15, 0.86, 1); scene.add(gate);
  const shards = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(1), gateMaterial, 28);
  const shardPose = new THREE.Object3D();
  for (let i = 0; i < shards.count; i++) {
    const angle = i / shards.count * Math.PI * 2;
    shardPose.position.set(Math.cos(angle) * 1.25, Math.sin(angle) * 0.94 - 0.02, -1.97 + random() * 0.08);
    shardPose.rotation.set(random() * 3, angle, angle); shardPose.scale.set(0.018 + random() * 0.02, 0.04 + random() * 0.09, 0.025);
    shardPose.updateMatrix(); shards.setMatrixAt(i, shardPose.matrix);
  }
  scene.add(shards);

  // Low mist crosses the whole landscape, rather than ending at a rectangular frame.
  const mistMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const mistNoise = mx_noise_float(vec3(uv().mul(vec2(11, 3)).add(vec2(time.mul(0.04), 0)), time.mul(0.035))).mul(0.5).add(0.5);
  mistMaterial.colorNode = mix(vec3(0.025, 0.065, 0.052), vec3(0.13, 0.017, 0.006), mistNoise);
  mistMaterial.opacityNode = uv().y.smoothstep(0, 0.15).mul(uv().y.smoothstep(1, 0.2)).mul(mistNoise.pow(1.7)).mul(0.7);
  const mist = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mistMaterial);
  mist.name = 'full-width ground mist'; mist.position.set(0, -1.35, -1.5); scene.add(mist);

  scene.add(new THREE.HemisphereLight(0x4a526b, 0x170302, 0.65));
  const key = new THREE.DirectionalLight(0xff9969, 2.2); key.position.set(-2, 1.4, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0x7657ad, 2.4); rim.position.set(3, 1, -1); scene.add(rim);
  const furnace = new THREE.PointLight(0xff2406, 2, 8, 2); furnace.position.set(0, -0.4, -1.7); scene.add(furnace);

  const actor = new THREE.Group(); actor.name = 'evil pumpkin'; actor.position.z = -0.95; actor.scale.setScalar(1.3); scene.add(actor);
  const glowParts: { material: THREE.MeshStandardNodeMaterial; eye: boolean }[] = [];
  const model = whenLoaded([pumpkinUrl], ([gltf]) => {
    const root = gltf.scene.clone(true);
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Each mode owns its resources; disposing it must leave the loader's cached source intact.
      mesh.geometry = mesh.geometry.clone();
      const source = mesh.material as THREE.MeshStandardMaterial;
      const material = new THREE.MeshStandardNodeMaterial({ color: source.color, roughness: source.roughness, metalness: source.metalness, side: source.side });
      material.name = source.name;
      if (source.name === 'pumpkin') {
        const skin = positionLocal.add(vec3(mesh.position));
        const scorch = mx_noise_float(skin.mul(17)).mul(0.5).add(0.5);
        const grain = mx_noise_float(skin.mul(110)).mul(0.5).add(0.5);
        const vein = mx_noise_float(skin.mul(vec3(26, 19, 26))).abs().smoothstep(0.045, 0.008).mul(scorch.smoothstep(0.42, 0.7));
        material.colorNode = mix(vec3(0.012, 0.002, 0.001), vec3(0.33, 0.045, 0.006), scorch.smoothstep(0.2, 0.85)).mul(grain.mul(0.3).add(0.7));
        material.roughnessNode = grain.mul(0.25).add(0.65);
        material.emissiveNode = vec3(1, 0.055, 0.004).mul(vein).mul(stageEnergy.mul(0.6).add(0.2).add(fire.mul(0.4)));
        if (mesh.name === 'pumpkin_body') material.positionNode = positionLocal.add(normalLocal.mul(grain.sub(0.5).mul(0.003)));
      }
      if (source.name === 'stem_mat') material.color.setHex(0x4a5d19);
      if (source.emissive.r + source.emissive.g + source.emissive.b > 0) {
        material.emissive.copy(source.emissive); material.emissiveIntensity = 1.2;
        glowParts.push({ material, eye: mesh.name.includes('eye') });
      }
      mesh.material = material;
    });
    const browMaterial = new THREE.MeshStandardNodeMaterial({ color: 0x210502, roughness: 0.85, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const points = [[0.08, 0.105, 0.457], [0.3, 0.205, 0.345], [0.09, 0.24, 0.367]];
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap(([x, y, z]) => [x * side, y, z]), 3));
      geometry.computeVertexNormals();
      const brow = new THREE.Mesh(geometry, browMaterial); brow.name = side < 0 ? 'left angry brow' : 'right angry brow'; root.add(brow);
    }
    actor.add(root);
    const jaw = root.getObjectByName('mouth_jaw')!;
    const lids = ['eye_left_lid', 'eye_right_lid'].map(name => root.getObjectByName(name)!);
    return { jaw, jawRest: jaw.position.clone(), jawRotation: jaw.quaternion.clone(), lids, lidRest: lids.map(lid => lid.position.clone()) };
  });

  const auraMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const au = uv().sub(0.5), auraNoise = mx_noise_float(vec3(au.mul(12), time.mul(0.15))).mul(0.5).add(0.5);
  const auraRadius = au.length().add(auraNoise.mul(0.1));
  auraMaterial.colorNode = vec3(0.5, 0.018, 0.005).mul(stageEnergy.add(0.2));
  auraMaterial.opacityNode = auraRadius.smoothstep(0.48, 0.23).mul(auraRadius.smoothstep(0.14, 0.29)).mul(auraNoise).mul(0.65);
  const aura = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), auraMaterial); aura.name = 'cursed aura'; aura.position.z = -0.3; actor.add(aura);
  const smokeCount = budget.particleScale < 1 ? 18 : 28, smokeSeeds = new Float32Array(smokeCount * 4);
  for (let i = 0; i < smokeCount; i++) smokeSeeds.set([random(), random() * Math.PI * 2, random(), random()], i * 4);
  const ss = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(smokeSeeds, 4), 'vec4');
  const wispAge = fract(time.mul(0.13).add(ss.x)), wispAngle = ss.y.add(wispAge.mul(1.4));
  const wispRadius = wispAge.mul(0.38).add(0.43);
  const wispMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
  wispMaterial.positionNode = vec3(cos(wispAngle).mul(wispRadius), sin(ss.y).mul(0.2).sub(0.25).add(wispAge.mul(1.2)), float(-0.3).add(sin(wispAngle).mul(0.14)));
  wispMaterial.scaleNode = vec2(wispAge.mul(0.65).add(0.12));
  const wispNoise = mx_noise_float(vec3(uv().mul(6).add(ss.z.mul(10)), time.mul(0.12))).mul(0.5).add(0.5);
  wispMaterial.colorNode = mix(vec3(0.018, 0.006, 0.009), vec3(0.18, 0.035, 0.008), ss.w).mul(stageEnergy.add(0.55));
  wispMaterial.opacityNode = uv().sub(0.5).length().smoothstep(0.5, 0.1).mul(wispNoise).mul(wispAge.smoothstep(0, 0.15)).mul(wispAge.smoothstep(1, 0.55)).mul(0.55);
  const wisps = new THREE.Sprite(wispMaterial); wisps.geometry = wisps.geometry.clone(); wisps.count = smokeCount; wisps.frustumCulled = false; wisps.name = 'cursed smoke'; actor.add(wisps);

  // Broad, widening jets with a hot core, turbulent envelope and a soft muzzle flare. All inherit the head pose.
  const beamGeometry = new THREE.CylinderGeometry(1, 0.2, 1, 16, 12, true).translate(0, 0.5, 0);
  const beam = (name: string, origin: THREE.Vector3, colour: THREE.Vector3) => {
    const group = new THREE.Group(); group.name = name; group.position.copy(origin); group.visible = false; actor.add(group);
    const outer = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const noise = mx_noise_float(vec3(positionLocal.x.mul(7), positionLocal.y.mul(18).sub(time.mul(22)), positionLocal.z.mul(7))).mul(0.5).add(0.5);
    const fade = uv().y.oneMinus().pow(0.35);
    outer.colorNode = vec3(colour).mul(2.6).mul(noise.mul(0.7).add(0.6));
    outer.opacityNode = noise.smoothstep(0.12, 0.72).mul(fade).mul(normalView.z.abs().pow(0.7)).mul(fire).mul(0.65);
    const shell = new THREE.Mesh(beamGeometry, outer); group.add(shell);
    const coreMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    coreMaterial.colorNode = mix(colour, vec3(3, 2.7, 1.8), float(0.8));
    coreMaterial.opacityNode = fade.mul(fire).mul(0.9);
    const core = new THREE.Mesh(beamGeometry, coreMaterial); group.add(core);
    const flareMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    flareMaterial.colorNode = vec3(colour).mul(2.5);
    flareMaterial.opacityNode = uv().sub(0.5).length().smoothstep(0.5, 0.03).pow(2).mul(fire);
    const flare = new THREE.Sprite(flareMaterial); flare.geometry = flare.geometry.clone(); flare.scale.setScalar(0.36); flare.position.y = 0.015; group.add(flare);
    return { group, shell, core };
  };
  const beams = [beam('left eye laser', new THREE.Vector3(-0.18, 0.133, 0.47), new THREE.Vector3(1, 0.035, 0.008)),
    beam('right eye laser', new THREE.Vector3(0.18, 0.133, 0.47), new THREE.Vector3(1, 0.035, 0.008)),
    beam('mouth laser', new THREE.Vector3(0, -0.15, 0.49), new THREE.Vector3(1, 0.16, 0.015))];
  const yAxis = new THREE.Vector3(0, 1, 0), direction = new THREE.Vector3();
  const ringMaterial = new THREE.MeshBasicNodeMaterial({ color: 0xff4d16, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.61, 80), ringMaterial); ring.name = 'pop shockwave'; ring.position.z = 0.1; scene.add(ring);

  const sparkCount = Math.round(90 * Math.min(1.5, budget.particleScale));
  const sparks = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(1), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(2, 0.35, 0.02) }), sparkCount);
  sparks.name = 'pumpkin embers'; sparks.frustumCulled = false; sparks.visible = false; actor.add(sparks);
  const seeds = Array.from({ length: sparkCount }, () => [random(), random() * Math.PI * 2, random()]);
  const dummy = new THREE.Object3D();
  let motionTime = 0, age = 2, kind = -1, strength = 0, bounce = 0;
  let laserCharge = 0, laserWait = 10, laserCount = 0, closeAttack = false;
  let shot = 0, shotAge = 0;
  const look = new THREE.Vector3(0, 0.08, 0), nextEye = new THREE.Vector3(), nextLook = new THREE.Vector3();
  const shotFromEye = camera.position.clone(), shotFromLook = look.clone();
  const attackEye = new THREE.Vector3(), attackLook = new THREE.Vector3(0, 0.08, 0);
  const cameraDirection = new THREE.Vector3(), restCentre = new THREE.Vector3(0, -0.06, -0.95);
  return {
    scene, camera, ready: model.ready,
    update(frame) {
      const dt = frame.reducedMotion ? 0 : Math.min(0.1, Math.max(0, frame.delta));
      const step = Math.min(0.1, Math.max(0, settleStep(frame)));
      motionTime += dt; time.value = motionTime;
      age = Math.min(2, age + (frame.reducedMotion ? step : dt));
      laserWait += dt;
      hits.update(frame);
      const pace = Math.min(1.5, Math.max(0, drive(frame)));
      bounce = approach(bounce, pace, step, 0.12);
      // Integrate bounce energy instead of shooting on every eligible onset. Quiet passages do not bank shots.
      const audible = frame.response.loudness > 0.04;
      laserCharge = audible && !frame.reducedMotion
        ? Math.min(1, laserCharge + dt * pace * 0.16)
        : Math.max(0, laserCharge - step * 0.35);
      if (age >= 1.2) {
        shotAge += dt;
        if (shotAge >= SHOT_SECONDS[shot]) {
          shotFromEye.copy(camera.position); shotFromLook.copy(look);
          shot = (shot + 1) % PUMPKIN_SHOTS.length; shotAge = 0;
        }
      }
      const shotPhase = Math.min(1, shotAge / SHOT_SECONDS[shot]);
      // The skin glide finishes at the eyes before allowing its close-up laser reveal.
      if (hits.fired && audible && pace > 0.02 && laserCharge >= 1 && laserWait >= 5 && age >= 1.2
        && (shot !== 3 || shotPhase >= 0.82) && !frame.reducedMotion && dt > 0) {
        closeAttack = shot === 3;
        kind = closeAttack ? 0 : laserCount % ATTACKS.length;
        laserCount++; laserCharge = 0; laserWait = 0; age = 0;
        strength = Math.min(1, 0.4 + pace * 0.6);
      }
      const charge = (closeAttack ? 0 : 1) * (1 - smooth(age, 0, 0.1)) * strength;
      const pop = (closeAttack ? 0 : 1) * smooth(age, 0.08, 0.26) * (1 - smooth(age, 0.62, 1.1)) * strength * (frame.reducedMotion ? 0 : 1);
      const opening = smooth(age, 0.1, 0.24) * (1 - smooth(age, 0.6, 0.94)) * (frame.reducedMotion ? 0 : 1);
      const firing = smooth(age, 0.22, 0.28) * (1 - smooth(age, 0.54, 0.7)) * (frame.reducedMotion ? 0 : 1);
      const eyeAttack = kind !== 1, mouthAttack = kind !== 0;
      const sway = frame.reducedMotion ? 0 : Math.sin(motionTime * 1.7) * 0.045;
      const beatMove = frame.reducedMotion ? 0 : bounce * hits.level;
      const beatSide = hits.count % 2 ? -1 : 1;
      actor.position.set(pop * (kind % 2 ? -0.11 : 0.11) + beatSide * beatMove * 0.045, -0.06 + beatMove * 0.12, -0.95 + pop * 2.1 - charge * 0.12);
      actor.rotation.set(pop * 0.06, sway + beatSide * beatMove * 0.06 + pop * (kind % 2 ? -0.14 : 0.14), frame.reducedMotion ? 0 : Math.sin(motionTime * 1.7) * 0.025 + beatSide * beatMove * 0.045);
      const size = 1.3 + pop * 0.54;
      const squash = frame.reducedMotion ? 0 : charge * 0.08 + bounce * hits.level * 0.035;
      actor.scale.set(size * (1 + squash), size * (1 - squash), size);
      const parts = model.value;
      if (parts) {
        parts.jaw.position.copy(parts.jawRest); parts.jaw.position.y -= opening * (mouthAttack ? 0.025 : 0.008);
        parts.jaw.quaternion.copy(parts.jawRotation); parts.jaw.rotateX(-opening * (mouthAttack ? 0.5 : 0.15));
        parts.lids.forEach((lid, i) => { lid.position.copy(parts.lidRest[i]); lid.position.y += opening * 0.03; lid.position.z -= opening * 0.02; });
      }
      fire.value = firing * (frame.reducedFlash ? 0.42 : 0.8 + hits.level * 0.2);
      glowParts.forEach(({ material, eye }) => {
        const active = eye ? eyeAttack : mouthAttack;
        material.emissive.setHex(eye ? 0xff2809 : 0xff810c);
        material.emissiveIntensity = 0.7 + bounce * 0.2 + opening * (active ? (frame.reducedFlash ? 0.45 : 1.5) : 0.2);
      });
      beams.forEach(({ group, shell, core }, i) => {
        group.visible = firing > 0.001 && (i === 2 ? mouthAttack : eyeAttack);
        const side = i === 0 ? -1 : 1, sweep = kind === 3 ? Math.sin(age * 8) * 0.24 : 0;
        direction.set(i === 2 ? sweep : side * 0.43 + sweep, i === 2 ? -0.48 : -0.23, 1).normalize();
        group.quaternion.setFromUnitVectors(yAxis, direction);
        const width = (i === 2 ? 0.17 : 0.1) * (0.7 + firing * 0.3);
        shell.scale.set(width, 3.3, width); core.scale.set(width * 0.23, 3.3, width * 0.23);
      });
      const ringAge = Math.max(0, age - 0.2);
      ring.visible = ringAge > 0 && ringAge < 0.65 && !frame.reducedMotion;
      ring.scale.setScalar(1 + ringAge * 5);
      ringMaterial.opacity = (1 - Math.min(1, ringAge / 0.65)) * strength * (frame.reducedFlash ? 0.08 : 0.3);
      sparks.visible = firing > 0.001;
      if (sparks.visible) {
        seeds.forEach(([offset, angle, spread], i) => {
          const t = (motionTime * 1.5 + offset) % 1, r = t * (0.3 + spread * 0.8);
          dummy.position.set(Math.cos(angle) * r, -0.14 + Math.sin(angle) * r - t * t * 0.45, 0.5 + t * 2.9);
          dummy.rotation.set(angle, t * 12, spread * 6); dummy.scale.setScalar((1 - t) * (0.008 + spread * 0.012));
          dummy.updateMatrix(); sparks.setMatrixAt(i, dummy.matrix);
        });
        sparks.instanceMatrix.needsUpdate = true;
      }
      stageEnergy.value = 0.12 + bounce * 0.2 + (frame.reducedFlash ? 0 : hits.flash * 0.15);
      furnace.intensity = 2.5 + opening * (frame.reducedFlash ? 0.8 : 3);
      // A continuous tour between attacks; a pop-out returns to a frontal view before the head lunges.
      const portrait = Math.max(1, 0.9 / frame.aspect);
      const u = smooth(shotPhase, 0.15, 0.95);
      if (shot === 0) { nextEye.set(Math.sin(shotPhase * Math.PI) * 0.2, 0.08, 5.6 * portrait); nextLook.set(0, 0.08, -0.3); }
      else if (shot === 1) { nextEye.set(2.1 - u * 0.7, 0.35 + u * 0.15, 2.5 * portrait); nextLook.set(0, 0.04, -0.65); }
      else if (shot === 2) { nextEye.set(-0.7 + u * 0.45, -1.12 + u * 0.25, 2.5 * portrait); nextLook.set(0, 0.12, -0.65); }
      else { nextEye.set(0.12 - u * 0.06, -0.48 + u * 0.7, (0.62 - u * 0.12) * portrait); nextLook.set(0, -0.34 + u * 0.48, -0.4); }
      const blend = smooth(shotAge, 0, 1.6);
      nextEye.lerpVectors(shotFromEye, nextEye, blend); nextLook.lerpVectors(shotFromLook, nextLook, blend);
      if (!closeAttack && age < 1.2) {
        const attackView = smooth(age, 0, 0.18) * (1 - smooth(age, 0.82, 1.2));
        nextEye.lerp(attackEye.set(0, 0.08, 4.8 * portrait), attackView);
        nextLook.lerp(attackLook, attackView);
      }
      if (!frame.reducedMotion) { camera.position.copy(nextEye); look.copy(nextLook); camera.lookAt(look); }
      resizeCamera(camera, frame.aspect);
      const viewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      // Billboard the distant sky so side and low-angle shots never reveal its edges.
      camera.getWorldDirection(cameraDirection);
      screen.position.copy(camera.position).addScaledVector(cameraDirection, 16); screen.quaternion.copy(camera.quaternion);
      screen.scale.set(16 * viewHeight * frame.aspect * 1.02, 16 * viewHeight * 1.02, 1);
      aspect.value = frame.aspect;
      mist.scale.set((camera.position.distanceTo(mist.position) + 3) * viewHeight * frame.aspect * 1.05, 2.2, 1);
      // Keep the mask plane ahead of the resting pumpkin, independent of its beat/lunge movement.
      const borderDepth = Math.max(0.2, camera.position.distanceTo(restCentre) - 0.9);
      borderFrame.position.z = -borderDepth;
      borderFrame.scale.set(borderDepth * viewHeight * frame.aspect, borderDepth * viewHeight, 1);
      scene.userData.shot = PUMPKIN_SHOTS[shot]; scene.userData.shotPhase = shotPhase;
      scene.userData.laserCount = laserCount; scene.userData.laserCharge = laserCharge; scene.userData.closeAttack = closeAttack && age < 1.2;
      scene.userData.attack = kind < 0 ? 'idle' : ATTACKS[kind];
      scene.userData.lunge = pop; scene.userData.firing = firing;
    },
    dispose() { model.dispose(); disposeScene(scene); },
  };
}
