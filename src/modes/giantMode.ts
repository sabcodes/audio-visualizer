import * as THREE from 'three/webgpu';
import { float, mix, mx_noise_float, normalize, positionLocal, positionWorld, sin, uniform, uv, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, approach, beatGate, settleStep } from './shared';
import { BoneOverlay, ClipPlayer, TempoTracker, createGlowPoints, instantiate, loadTexture, prop, whenLoaded, type Figure } from './figures';
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
const FIREFLIES = 120, GIANT_SCALE = 2.2;
const DANCES = ['groove', 'arm_swing', 'clap_overhead'] as const;

export function createGiantMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).far = 800;
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
  const moonLight = new THREE.DirectionalLight(0x9fc4d8, 1.6); moonLight.position.set(-12, 20, -14);
  const fill = new THREE.HemisphereLight(0x5a8070, 0x0a0f08, 0.55);
  const front = new THREE.DirectionalLight(0xffc890, 0.9); front.position.set(6, 8, 18);
  // A cold rim from behind picks the giant's silhouette out of the fog.
  const rim = new THREE.DirectionalLight(0x9fe8c8, 2.2); rim.position.set(4, 12, -16);
  const mushroomLights = [-7, 7].map((x) => { const light = new THREE.PointLight(0x66ff88, 2, 16, 1.8); light.position.set(x, 1.2, -3); return light; });
  scene.add(moonLight, fill, front, rim, ...mushroomLights);
  // Fireflies drift over the water and gather round the giant when the music swells.
  const fireflies = createGlowPoints(loadTexture(emberUrl), FIREFLIES);
  const flies = Array.from({ length: FIREFLIES }, () => ({ x: (random() - 0.5) * 40, y: 0.5 + random() * 6, z: (random() - 0.5) * 30 - 4, phase: random() * 10 }));
  scene.add(fireflies.object);

  let giant: Figure | undefined, player: ClipPlayer | undefined;
  const overlay = new BoneOverlay(), tempo = new TempoTracker();
  let bones: Record<'hips' | 'spine' | 'neck' | 'head' | 'belly' | 'jaw' | 'armL' | 'armR' | 'thighL' | 'thighR' | 'kneeL' | 'kneeR', THREE.Object3D> | undefined;
  let feet: THREE.Object3D[] = [], eyes: THREE.MeshStandardMaterial[] = [], fungus: THREE.MeshStandardMaterial[] = [];
  const models = whenLoaded([giantUrl, swampUrl], ([giantModel, swampModel]) => {
    giant = instantiate(giantModel);
    // The model is 4.3 m tall; scaled up it towers over the trees' lower branches like a giant should.
    giant.root.scale.setScalar(GIANT_SCALE);
    scene.add(giant.root);
    player = new ClipPlayer(giant.root, giant.clips);
    player.loop('idle', 0);
    bones = { hips: giant.node('Hips'), spine: giant.node('Spine2'), neck: giant.node('Neck'), head: giant.node('Head'), belly: giant.node('Belly'), jaw: giant.node('Jaw'), armL: giant.node('LeftArm'), armR: giant.node('RightArm'),
      thighL: giant.node('LeftUpLeg'), thighR: giant.node('RightUpLeg'), kneeL: giant.node('LeftLeg'), kneeR: giant.node('RightLeg') };
    for (const bone of Object.values(bones)) overlay.track(bone);
    // The exported foot sockets sit at twice their true offset (a Blender export bug), so the rings start from the foot bones.
    feet = [giant.node('LeftFoot'), giant.node('RightFoot')];
    eyes = [giant.materials.get('emissive_eye')!].filter(Boolean);
    fungus = [giant.materials.get('emissive_fungus')!].filter(Boolean);
    for (const [name, x, z, turn, scale] of SWAMP_LAYOUT) {
      const piece = prop(swampModel, name);
      piece.position.set(x, 0, z); piece.rotation.y = turn; piece.scale.setScalar(scale);
      piece.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh && (mesh.material as THREE.Material).name === 'emissive_fungus') { mesh.material = (mesh.material as THREE.MeshStandardMaterial).clone(); fungus.push(mesh.material as THREE.MeshStandardMaterial); }
      });
      scene.add(piece);
    }
  });

  const stompGate = beatGate(1.1), chestGate = beatGate(6), roarGate = beatGate(9), footWorld = new THREE.Vector3();
  let beats = 0, idle = 0, nextFoot = 0, sway = 0, pump = 0, stompAt = -1, stompFoot = 0, belly = 0, bellyVelocity = 0, shake = 0, nod = 0, loudHold = 0;
  return {
    scene, camera,
    ready: models.ready,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time;
      const step = settleStep(frame), { bounce, bass, loudness, impact } = frame.response;
      const scale = tempo.update(frame.time, frame.audio.onset, frame.delta);
      idle = frame.audio.onset ? 0 : idle + frame.delta;
      if (player && giant && bones) {
        // Base loop: while the music plays the dance changes every 16 beats (groove, arm swing, clap);
        // in silence it falls back to the breathing idle.
        const playing = bounce > 0.12 || idle < 1.5;
        player.loop(playing ? DANCES[Math.floor(beats / 16) % DANCES.length] : 'idle');
        if (frame.audio.onset) beats++;
        // Accents: stomps on hard hits (alternating feet), a chest beat every 16 beats, a roar when it gets loud.
        loudHold = loudness > 0.8 ? loudHold + frame.delta : 0;
        if (frame.audio.onset && impact > 0.55 && stompGate(frame.time, true) && player.play(nextFoot ? 'stomp_R' : 'stomp_L')) {
          stompFoot = nextFoot; nextFoot = 1 - nextFoot; stompAt = 0.45;
        } else if (loudHold > 1.2 && roarGate(frame.time, true)) player.play('roar');
        else if (frame.audio.onset && beats % 16 === 0 && chestGate(frame.time, true)) player.play('chest_beat');
        else if (idle > 6 && !player.playingShot) { player.play('look_around'); idle = 2; }
        overlay.reset();
        player.update(frame.delta, scale);
        // The music on top of the clips: the head bobs on the bass, the spine leans into the loudness,
        // and the belly jiggles on a spring that each kick strikes.
        nod = approach(nod, bass, step, 0.06);
        const motion = frame.reducedMotion ? 0 : 1;
        // Each beat throws the weight to the other side; the dip lands on the beat and recovers through it.
        // Whenever music plays the dance has a base strength, and the bounce adds to it.
        const drive = (playing ? 0.45 + bounce * 0.8 : bounce) * motion;
        const beatSide = tempo.beats % 2 ? 1 : -1, dip = Math.pow(1 - tempo.phase, 2.5) * drive;
        sway = approach(sway, beatSide * drive, step, 0.12);
        pump = approach(pump, (playing ? 0.35 + frame.audio.mid * 0.6 : 0) * motion, step, 0.1);
        overlay.turn(bones.hips, 0, sway * 0.12, sway * 0.07);
        // Bone axes (probed from the model): +X leans the spine and head forward, −X swings an arm forward.
        overlay.turn(bones.spine, loudness * 0.05 * motion + dip * 0.14, 0, -sway * 0.08);
        overlay.turn(bones.neck, nod * 0.12 * motion + dip * 0.1);
        overlay.turn(bones.head, nod * 0.15 * motion + dip * 0.15, 0, sway * 0.1);
        // Arms pump with the mids, alternating with the sway.
        overlay.turn(bones.armL, -Math.sin(tempo.phase * Math.PI) * pump * 0.5 * (beatSide > 0 ? 1 : 0.4));
        overlay.turn(bones.armR, -Math.sin(tempo.phase * Math.PI) * pump * 0.5 * (beatSide < 0 ? 1 : 0.4));
        // Knees bend into each dip so the body drops while the feet stay planted.
        for (const [thigh, knee] of [[bones.thighL, bones.kneeL], [bones.thighR, bones.kneeR]]) { overlay.turn(thigh, -dip * 0.35); overlay.turn(knee, dip * 0.6); }
        giant.root.position.y = -dip * 0.3;
        bellyVelocity += (-(belly) * 260 - bellyVelocity * 9) * Math.min(frame.delta, 1 / 30) + (frame.audio.onset ? bass * 3 * motion : 0);
        belly += bellyVelocity * Math.min(frame.delta, 1 / 30);
        bones.belly.scale.setScalar(1 + belly * 0.5);
        giant.root.scale.set(GIANT_SCALE * (1 + belly * 0.03), GIANT_SCALE * (1 - nod * 0.03 * motion), GIANT_SCALE * (1 + belly * 0.03));
        // The foot lands 0.45 s into a stomp clip: send a ring across the water from it and shake the camera.
        if (stompAt >= 0) {
          stompAt -= frame.delta * scale;
          if (stompAt < 0) {
            feet[stompFoot].getWorldPosition(footWorld);
            ringAt.value.set(footWorld.x, footWorld.z); ringAge.value = 0; ringStrength.value = 0.6 + impact * 0.6;
            shake = frame.reducedMotion ? 0 : 1;
          }
        }
      }
      ringAge.value += step;
      shake = Math.max(0, shake - step * 3.5);
      // Glow: eyes follow loudness, fungus breathes with the highs and flares on the beat.
      glow.value = approach(glow.value, loudness, step, 0.15);
      for (const material of eyes) material.emissiveIntensity = 0.6 + glow.value * 3.5;
      const spores = 0.25 + frame.audio.highs * 0.9 + bounce * 0.5;
      for (const material of fungus) material.emissiveIntensity = spores;
      for (const light of mushroomLights) light.intensity = 1 + spores * 3;
      haze.value.setRGB(0.04, 0.09, 0.06).multiplyScalar(0.6 + bounce);
      // Fireflies wander; louder music pulls them in toward the giant and brightens them.
      const pull = frame.reducedMotion ? 0 : bounce;
      for (let i = 0; i < FIREFLIES; i++) {
        const fly = flies[i], t = frame.time * 0.4 + fly.phase;
        if (!frame.reducedMotion) { fly.x += (Math.sin(t * 1.3) * 0.6 - fly.x * pull * 0.15) * frame.delta; fly.z += (Math.cos(t) * 0.6 - (fly.z + 2) * pull * 0.15) * frame.delta; }
        const blink = 0.4 + 0.6 * Math.max(0, Math.sin(t * 3 + fly.phase));
        fireflies.set(i, fly.x, fly.y + Math.sin(t * 2) * 0.4, fly.z, 0.16 + bounce * 0.12, 0.25 * blink, 1.1 * blink, 0.45 * blink);
      }
      fireflies.commit();
      const orbit = frame.time * 0.05, jitter = shake * 0.35;
      camera.position.set(Math.sin(orbit) * 6 + Math.sin(frame.time * 40) * jitter, 3 + Math.sin(frame.time * 0.2) * 0.4 + Math.sin(frame.time * 47) * jitter, 15 + Math.cos(orbit) * 1.5);
      camera.lookAt(0, 4.6, 0);
    },
    dispose() { models.dispose(); player?.dispose(); disposeScene(scene); },
  };
}
