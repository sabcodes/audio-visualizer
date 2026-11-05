import * as THREE from 'three/webgpu';
import { float, mix, mx_noise_float, normalize, positionLocal, positionWorld, uniform, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, approach } from './shared';
import { createGlowPoints, createParticles, instantiate, loadTexture, prop, whenLoaded, type Figure } from './figures';
import { createGiantPerformance } from './giantPerformance';
import { seededRandom } from '../rendering/diagnostics';
import giantUrl from '../assets/models/swamp_giant.glb?url';
import swampUrl from '../assets/models/swamp_props.glb?url';
import emberUrl from '../assets/fx/ember.png?url';

/** Where the swamp props stand: [node, x, z, turn, scale]. The giant stands at the origin, facing the camera (+Z). */
export const SWAMP_LAYOUT: readonly (readonly [string, number, number, number, number])[] = [
  ['tree_dead_01', -14, -16, 0.4, 1.3], ['tree_dead_02', 15, -18, 2.2, 1.4], ['tree_dead_03', -24, -30, 1.1, 1.6], ['tree_dead_01', 26, -32, 3.4, 1.5],
  ['tree_dead_03', 6, -40, 0.2, 1.7], ['reed_clump_01', -7, 4, 0, 1.2], ['reed_clump_02', 8, 3, 1, 1.3], ['reed_clump_03', -12, -4, 2, 1.2],
  ['reed_clump_01', 12, -6, 0.6, 1.1], ['lily_cluster_01', -5, 9, 0, 1.4], ['lily_cluster_02', 6, 11, 1.4, 1.3], ['lily_cluster_03', -10, 14, 2.7, 1.2],
  ['lily_cluster_04', 11, 16, 0.8, 1.2], ['rock_mossy_01', -4.5, -2.5, 0, 1.4], ['rock_mossy_02', 5, -3, 1, 1.2], ['rock_mossy_03', -18, -10, 2, 2],
  ['rock_mossy_04', 18, -12, 0.5, 2.2], ['rock_mossy_05', 0, -9, 1.8, 1.6], ['mushroom_cluster_01', -3.5, -1, 0, 1.6], ['mushroom_cluster_02', 4, -1.5, 1, 1.5],
  ['mushroom_cluster_03', -9, -8, 2, 1.8], ['mushroom_cluster_04', 10, -9, 3, 1.8], ['mushroom_cluster_05', -16, -14, 0.5, 2], ['mushroom_cluster_06', 15, -15, 1.5, 2],
  ['jetty_broken', 13, 7, -0.9, 1.3],
];
const FIREFLIES = 120;

export function createGiantMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  camera.far = 800; camera.fov = 42; camera.updateProjectionMatrix();
  const random = seededRandom(404);
  const time = uniform(0), glow = uniform(0.3), haze = uniform(new THREE.Color(0.04, 0.09, 0.06));
  scene.fog = new THREE.FogExp2(0x0a1410, 0.018);
  // Sky: deep green-black with a pale moon glow low behind the trees.
  const skyMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  const dir = normalize(positionLocal), moon = dir.sub(normalize(vec3(-0.35, 0.28, -1))).length();
  skyMaterial.colorNode = mix(vec3(0.03, 0.06, 0.05), vec3(0.004, 0.008, 0.012), dir.y.smoothstep(-0.05, 0.5))
    .add(vec3(0.75, 0.85, 0.8).mul(moon.smoothstep(0.035, 0.028))).add(vec3(0.12, 0.18, 0.16).mul(moon.smoothstep(0.6, 0.05).mul(0.35)));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMaterial));
  // Water: dark and glossy, with slow ripples and rings that spread from each stomp.
  const ringAt = uniform(new THREE.Vector2(0, 0)), ringAge = uniform(10), ringStrength = uniform(0);
  const waterMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.4, metalness: 0.1 });
  const wp = positionWorld.xz, ripple = mx_noise_float(vec3(wp.mul(0.25), time.mul(0.25))).mul(0.5).add(0.5);
  const stompRing = wp.sub(ringAt).length().sub(ringAge.mul(9)).abs().smoothstep(0.9, 0).mul(ringStrength).mul(float(1).sub(ringAge.div(1.6)).max(0));
  waterMaterial.colorNode = mix(vec3(0.006, 0.014, 0.012), vec3(0.02, 0.05, 0.04), ripple);
  waterMaterial.emissiveNode = vec3(0.25, 1, 0.55).mul(stompRing.mul(0.8)).add(haze.mul(ripple.mul(0.2)));
  const water = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), waterMaterial); water.rotation.x = -Math.PI / 2; water.position.y = 0.05;
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 9, 0.6, 32), new THREE.MeshStandardNodeMaterial({ color: 0x1b2416, roughness: 0.95 }));
  mound.position.y = -0.2;
  scene.add(water, mound);
  // Light: cold moonlight from behind-left, a warm low fill, and green glow from the mushrooms.
  const moonLight = new THREE.DirectionalLight(0x9fc4d8, 2.2); moonLight.position.set(-12, 20, -14);
  const fill = new THREE.HemisphereLight(0x91a89e, 0x1a1712, 1.1);
  const front = new THREE.DirectionalLight(0xffd4a3, 3); front.position.set(6, 8, 18);
  // A cold rim from behind picks the giant's silhouette out of the fog.
  const rim = new THREE.DirectionalLight(0x9fe8c8, 2.2); rim.position.set(4, 12, -16);
  const mushroomLights = [-7, 7].map((x) => { const light = new THREE.PointLight(0x66ff88, 2, 16, 1.8); light.position.set(x, 1.2, -3); return light; });
  scene.add(moonLight, fill, front, rim, ...mushroomLights);
  // Fireflies drift over the water and gather round the giant when the music swells.
  const fireflies = createGlowPoints(loadTexture(emberUrl), FIREFLIES);
  const flies = Array.from({ length: FIREFLIES }, () => ({ x: (random() - 0.5) * 40, y: 0.5 + random() * 6, z: (random() - 0.5) * 30 - 4, phase: random() * 10 }));
  scene.add(fireflies.object);

  // A charged mouth emitter, bright core and softer fog shaft all follow the posed head socket.
  const laser = new THREE.Group(); laser.name = 'Ogre / mouth laser'; laser.visible = false;
  const coreMaterial = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(1.3, 3.8, 2.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const haloMaterial = new THREE.MeshBasicNodeMaterial({ color: 0x52ffc4, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const beamGeometry = new THREE.CylinderGeometry(1, 1, 1, 16).translate(0, 0.5, 0);
  const core = new THREE.Mesh(beamGeometry, coreMaterial), halo = new THREE.Mesh(beamGeometry, haloMaterial);
  const mouthGlow = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), haloMaterial);
  const blastLight = new THREE.PointLight(0x64ffd1, 0, 14, 1.5);
  laser.add(core, halo, mouthGlow, blastLight); scene.add(laser);
  const dust = createParticles(loadTexture(emberUrl), 100, { gravity: 2.5, drag: 1.8 }); scene.add(dust.object);
  let giant: Figure | undefined, performance: ReturnType<typeof createGiantPerformance> | undefined;
  let mouthSocket: THREE.Object3D | undefined, head: THREE.Object3D | undefined;
  let eyes: THREE.MeshStandardMaterial[] = [], fungus: THREE.MeshStandardMaterial[] = [];
  const models = whenLoaded([giantUrl, swampUrl], ([giantModel, swampModel]) => {
    giant = instantiate(giantModel);
    scene.add(giant.root);
    performance = createGiantPerformance(giant);
    mouthSocket = giant.node('socket_mouth'); head = giant.node('Head');
    eyes = [giant.materials.get('emissive_eye')!].filter(Boolean);
    fungus = [giant.materials.get('emissive_fungus')!].filter(Boolean);
    for (const [name, x, z, turn, scale] of SWAMP_LAYOUT) {
      const piece = prop(swampModel, name);
      piece.position.set(x, 0, z); piece.rotation.y = turn; piece.scale.setScalar(scale);
      piece.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry = mesh.geometry.clone();
        const material = (mesh.material as THREE.MeshStandardMaterial).clone();
        mesh.material = material;
        if (material.name === 'emissive_fungus') fungus.push(material);
      });
      scene.add(piece);
    }
    scene.userData.assetsLoaded = true;
  });

  const mouthWorld = new THREE.Vector3(), aim = new THREE.Vector3(), headRotation = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  let clock = 0, shake = 0;
  return {
    scene, camera,
    ready: models.ready,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      const step = frame.reducedMotion ? 0 : Math.min(0.1, Math.max(0, frame.delta));
      clock += step; time.value = clock;
      const { bounce, loudness } = frame.response;
      const pose = performance?.update(frame);
      if (pose && giant && mouthSocket && head) {
        if (pose.landed) {
          ringAt.value.set(giant.root.position.x, giant.root.position.z); ringAge.value = 0; ringStrength.value = frame.reducedFlash ? 0.35 : 0.9;
          shake = frame.reducedFlash ? 0.2 : 0.5;
          for (let i = 0; i < 28; i++) {
            const a = random() * Math.PI * 2, r = random() * 1.6;
            dust.emit(giant.root.position.x + Math.cos(a) * r, 0.2, giant.root.position.z + Math.sin(a) * r,
              Math.cos(a) * 3, 1 + random() * 2, Math.sin(a) * 3, 0.8, 0.09 + random() * 0.12, 0.4, 0.8, 0.55);
          }
        }
        mouthSocket.getWorldPosition(mouthWorld); head.getWorldQuaternion(headRotation);
        aim.set(0, 0, 1).applyQuaternion(headRotation).normalize();
        laser.position.copy(mouthWorld); laser.quaternion.setFromUnitVectors(up, aim);
        laser.visible = pose.charge > 0.01;
        const flash = pose.flash;
        core.visible = halo.visible = pose.beam > 0;
        core.scale.set(0.075 + flash * 0.075, 21 * pose.beam, 0.075 + flash * 0.075);
        halo.scale.set(0.28 + flash * 0.18, 21 * pose.beam, 0.28 + flash * 0.18);
        mouthGlow.scale.setScalar(0.15 + pose.charge * 0.4);
        coreMaterial.opacity = frame.reducedFlash ? 0.4 : 0.95;
        haloMaterial.opacity = (frame.reducedFlash ? 0.1 : 0.24) * pose.charge;
        blastLight.intensity = (frame.reducedFlash ? 2 : 10) * pose.charge;
        Object.assign(scene.userData, { ...pose, mouth: mouthWorld.toArray(), laserDirection: aim.toArray(), laserOrigin: laser.position.toArray() });
      }
      dust.update(step);
      ringAge.value += step;
      shake = Math.max(0, shake - step * 3.5);
      // Glow: eyes follow loudness, fungus breathes with the highs and flares on the beat.
      glow.value = approach(glow.value, loudness, step, 0.15);
      for (const material of eyes) material.emissiveIntensity = 0.5 + glow.value * (frame.reducedFlash ? 0.8 : 1.5);
      const spores = 0.35 + frame.audio.highs * 0.5 + bounce * (frame.reducedFlash ? 0.15 : 0.35);
      for (const material of fungus) material.emissiveIntensity = spores;
      for (const light of mushroomLights) light.intensity = 1 + spores * 3;
      haze.value.setRGB(0.04, 0.09, 0.06).multiplyScalar(0.6 + bounce);
      // Fireflies wander; louder music pulls them in toward the giant and brightens them.
      const pull = frame.reducedMotion ? 0 : bounce;
      for (let i = 0; i < FIREFLIES; i++) {
        const fly = flies[i], t = clock * 0.4 + fly.phase;
        if (!frame.reducedMotion) { fly.x += (Math.sin(t * 1.3) * 0.6 - fly.x * pull * 0.15) * step; fly.z += (Math.cos(t) * 0.6 - (fly.z + 2) * pull * 0.15) * step; }
        const blink = 0.4 + 0.6 * Math.max(0, Math.sin(t * 3 + fly.phase));
        fireflies.set(i, fly.x, fly.y + Math.sin(t * 2) * 0.4, fly.z, 0.16 + bounce * 0.12, 0.25 * blink, 1.1 * blink, 0.45 * blink);
      }
      fireflies.commit();
      const orbit = clock * 0.045, jitter = shake * 0.15;
      const distance = frame.aspect < 1 ? Math.max(1, 0.62 / frame.aspect) : 1;
      camera.position.set(Math.cos(orbit) * 10 * distance + Math.sin(clock * 40) * jitter, 5.3 + Math.sin(clock * 0.12) * 0.5 + Math.sin(clock * 47) * jitter, (23 + Math.sin(orbit) * 2) * distance);
      camera.lookAt(giant?.root.position.x ?? 0, 5.4, giant?.root.position.z ?? 0);
    },
    dispose() { models.dispose(); disposeScene(scene); },
  };
}
