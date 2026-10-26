import * as THREE from 'three/webgpu';
import { mix, normalize, positionLocal, uniform, vec3 } from 'three/tsl';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, approach, beatGate, settleStep } from './shared';
import { BoneOverlay, ClipPlayer, TempoTracker, createParticles, instantiate, loadTexture, repivot, shaftMaterial, whenLoaded, type Figure } from './figures';
import { seededRandom } from '../rendering/diagnostics';
import skeletonUrl from '../assets/models/skeleton.glb?url';
import instrumentsUrl from '../assets/models/band_instruments.glb?url';
import smokeUrl from '../assets/fx/smoke.png?url';

const RISER_TOP = 0.5;
type Role = 'drums' | 'guitar' | 'bass' | 'vocals';
/** Where each member stands on the riser, [x, z, turn], and the loop it plays. */
const LINEUP: Record<Role, { at: [number, number, number]; loop: string; tint: number }> = {
  drums: { at: [0, -1.2, 0], loop: 'drum_groove', tint: 0x7cf7ff },
  guitar: { at: [1.8, 0.2, -0.35], loop: 'guitar_strum', tint: 0xff5af0 },
  bass: { at: [-1.8, 0.2, 0.35], loop: 'bass_pluck', tint: 0x7cff8a },
  vocals: { at: [0, 0.85, 0], loop: 'sing', tint: 0xffd36a },
};

interface Member { role: Role; figure: Figure; player: ClipPlayer; head: THREE.Object3D; neck: THREE.Object3D; spine: THREE.Object3D; eyes?: THREE.MeshStandardMaterial }

/** A copy of one instrument node, keeping its file transform (the file stages instruments on the riser). */
function instrument(gltf: GLTF, name: string) {
  const source = gltf.scene.getObjectByName(name);
  if (!source) throw new Error(`Instrument file has no node named ${name}`);
  const copy = source.clone();
  copy.traverse((object) => { const mesh = object as THREE.Mesh; if (mesh.isMesh) mesh.material = (mesh.material as THREE.Material).clone(); });
  return copy;
}

/**
 * Hangs `item` on `bone` so it follows the clips: the item is posed in world space against the skeleton's rest
 * pose, then attached, which keeps that relation. `world` places it relative to the member's feet.
 */
function holdOn(member: THREE.Object3D, bone: THREE.Object3D, item: THREE.Object3D, world: THREE.Matrix4) {
  member.updateMatrixWorld(true);
  item.matrix.copy(member.matrixWorld).multiply(world); item.matrix.decompose(item.position, item.quaternion, item.scale);
  bone.attach(item);
}

export function createBandMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).far = 300;
  scene.fog = new THREE.FogExp2(0x06040a, 0.02);
  const time = uniform(0), pulse = uniform(0), random = seededRandom(13);
  // Room: black floor, a back wall that takes a little of the stage colour.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardNodeMaterial({ color: 0x0b0a0f, roughness: 0.4, metalness: 0.2 }));
  floor.rotation.x = -Math.PI / 2;
  const wallMaterial = new THREE.MeshBasicNodeMaterial();
  wallMaterial.colorNode = mix(vec3(0.01, 0.006, 0.02), vec3(0.06, 0.02, 0.09), normalize(positionLocal).y.add(0.5).clamp(0, 1)).mul(pulse.mul(1.5).add(1));
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 20), wallMaterial); wall.position.set(0, 9, -7);
  scene.add(floor, wall);
  const fill = new THREE.HemisphereLight(0x8a80b0, 0x080610, 0.6);
  const spots = [0x7cf7ff, 0xff5af0, 0x7cff8a, 0xffd36a].map((colour, i) => {
    const light = new THREE.SpotLight(colour, 80, 25, 0.38, 0.5, 1.5);
    const [x, z] = Object.values(LINEUP)[i].at;
    light.position.set(x * 1.4, 9, z + 5); light.target.position.set(x, 1.2, z);
    scene.add(light, light.target);
    return light;
  });
  scene.add(fill);
  // Beams from a back truss sweep through the haze.
  const beamGeometry = new THREE.CylinderGeometry(0.15, 2.6, 22, 16, 1, true); beamGeometry.translate(0, -11, 0);
  const beams = [-4.5, -1.5, 1.5, 4.5].map((x, i) => {
    const material = shaftMaterial(time), beam = new THREE.Mesh(beamGeometry, material);
    beam.position.set(x, 8, -5.5); material.color.setHSL(i / 4 + 0.5, 1, 0.5); scene.add(beam);
    return { beam, material };
  });
  const smoke = createParticles(loadTexture(smokeUrl), 120, { drag: 0.3, additive: false });
  scene.add(smoke.object);

  const members: Member[] = [], overlay = new BoneOverlay(), tempo = new TempoTracker();
  let kit: Record<'kick' | 'snare' | 'hihat' | 'crash' | 'ride', THREE.Object3D> | undefined;
  let glow: Record<'strings' | 'grille' | 'trim', THREE.MeshStandardMaterial[]> = { strings: [], grille: [], trim: [] };
  const models = whenLoaded([skeletonUrl, instrumentsUrl], ([skeletonModel, instruments]) => {
    const riser = instrument(instruments, 'stage_riser'); scene.add(riser);
    const drums = instrument(instruments, 'drum_kit'); scene.add(drums);
    scene.add(instrument(instruments, 'mic_stand'));
    for (const side of [1, -1]) { const amp = instrument(instruments, 'amp_stack'); amp.position.x *= side; amp.rotation.y = side * -0.3; scene.add(amp); }
    kit = {
      kick: repivot(drums.getObjectByName('kick_head')!), snare: repivot(drums.getObjectByName('snare_head')!),
      hihat: repivot(drums.getObjectByName('hihat_top')!), crash: repivot(drums.getObjectByName('cymbal_crash')!), ride: repivot(drums.getObjectByName('cymbal_ride')!),
    };
    for (const piece of Object.values(kit)) piece.userData.y0 = piece.position.y;
    for (const role of Object.keys(LINEUP) as Role[]) {
      const { at: [x, z, turn], loop, tint } = LINEUP[role], figure = instantiate(skeletonModel);
      figure.root.position.set(x, RISER_TOP, z); figure.root.rotation.y = turn;
      scene.add(figure.root);
      const eyes = figure.materials.get('emissive_eye');
      eyes?.emissive.setHex(tint);
      // Instruments ride on the bones that hold them; the clips were solved against these holds (skeleton v4.4 README).
      if (role === 'guitar' || role === 'bass') {
        const axe = instrument(instruments, role === 'guitar' ? 'guitar' : 'bass_guitar');
        // The instrument's origin is its fretting grip: at (0.12, 1.08, 0.26), neck 36.5° up toward the player's left (+X).
        const sling = new THREE.Matrix4().compose(new THREE.Vector3(0.12, 1.08, 0.26), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -(Math.PI / 2 - THREE.MathUtils.degToRad(36.5)))), new THREE.Vector3(1, 1, 1));
        holdOn(figure.root, figure.node('Spine'), axe, sling);
        axe.traverse((object) => { const mesh = object as THREE.Mesh; if (mesh.isMesh && (mesh.material as THREE.Material).name === 'emissive_strings') glow.strings.push(mesh.material as THREE.MeshStandardMaterial); });
      }
      if (role === 'drums') {
        // Sticks grip at the hand sockets. The drum clips pitch the hands down, so the stick's axis is set in the
        // socket's frame: forward, slightly down and in toward the snare at each hand's snare hit.
        for (const side of ['L', 'R'] as const) {
          const stick = instrument(instruments, `drumstick_${side}`);
          stick.position.set(0, 0, 0);
          stick.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(side === 'L' ? 0.39 : -0.39, -0.785, -0.48).normalize());
          figure.node(`socket_hand_${side}`).add(stick);
        }
      }
      const player = new ClipPlayer(figure.root, figure.clips);
      player.loop(loop, 0);
      members.push({ role, figure, player, eyes, head: overlay.track(figure.node('Head')), neck: overlay.track(figure.node('Neck')), spine: overlay.track(figure.node('Spine2')) });
    }
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const name = (mesh.material as THREE.Material).name;
      if (name === 'emissive_panel') glow.grille.push(mesh.material as THREE.MeshStandardMaterial);
      if (name === 'emissive_trim') glow.trim.push(mesh.material as THREE.MeshStandardMaterial);
    });
  });

  const fillGate = beatGate(12), crashGate = beatGate(2), powerGate = beatGate(8), jumpGate = beatGate(10);
  let beats = 0, kick = 0, snare = 0, crash = 0, crashSpin = 0, bang = 0;
  return {
    scene, camera,
    ready: models.ready,
    update(frame) {
      resizeCamera(camera as THREE.PerspectiveCamera, frame.aspect);
      time.value = frame.time;
      const step = settleStep(frame), { bounce, bass, loudness, impact } = frame.response, motion = frame.reducedMotion ? 0 : 1;
      const scale = tempo.update(frame.time, frame.audio.onset, frame.delta);
      pulse.value = approach(pulse.value, bounce, step, 0.1);
      if (frame.audio.onset) { beats++; kick = 1; if (beats % 2 === 0) snare = 1; }
      kick = Math.max(0, kick - step * 8); snare = Math.max(0, snare - step * 7);
      // Headbanging: every member's head snaps down on the beat, harder when the music pushes.
      bang = approach(bang, Math.pow(1 - tempo.phase, 3) * (0.3 + bounce) * motion, step, 0.03);
      for (const member of members) {
        const { player, role } = member;
        // Accents per role: a drum fill at the end of each 32-beat phrase, crashes on hard hits,
        // a power chord on drops, the singer jumping on the biggest ones.
        if (role === 'drums') {
          if (frame.audio.onset && beats % 32 === 31 && fillGate(frame.time, true)) player.play('drum_fill');
          else if (frame.audio.onset && impact > 0.8 && crashGate(frame.time, true) && player.play('drum_crash')) crash = 1;
        } else if (role === 'guitar' && frame.audio.onset && impact > 0.85 && loudness > 0.6 && powerGate(frame.time, true)) player.play('guitar_power');
        else if (role === 'vocals' && frame.audio.onset && impact > 0.9 && loudness > 0.7 && jumpGate(frame.time, true)) player.play('jump');
      }
      overlay.reset();
      for (const member of members) {
        member.player.update(frame.delta, scale);
        const weight = member.role === 'vocals' ? 0.5 : 1;
        overlay.turn(member.spine, bang * 0.12 * weight);
        overlay.turn(member.neck, bang * 0.2 * weight);
        overlay.turn(member.head, bang * 0.3 * weight + bass * 0.05 * motion);
        if (member.eyes) member.eyes.emissiveIntensity = 1 + loudness * 4 + bang * 3;
      }
      if (kit) {
        // The kit answers the music: the kick head punches, the snare head jumps, cymbals swing on crashes.
        kit.kick.scale.setScalar(1 + kick * 0.06 * motion);
        kit.snare.position.y = snare * 0.015 * motion + kit.snare.userData.y0;
        kit.hihat.position.y = (Math.sin(tempo.phase * Math.PI * 2) * 0.5 + 0.5) * frame.audio.highs * 0.03 * motion + kit.hihat.userData.y0;
        crash = Math.max(0, crash - step * 1.2); crashSpin += step * 9;
        kit.crash.rotation.set(Math.sin(crashSpin) * crash * 0.25 * motion, 0, Math.cos(crashSpin * 0.8) * crash * 0.2 * motion);
        kit.ride.rotation.x = Math.sin(frame.time * 4) * bounce * 0.05 * motion;
      }
      for (const material of glow.strings) material.emissiveIntensity = 0.15 + frame.audio.highs * 1.2;
      for (const material of glow.grille) material.emissiveIntensity = 0.3 + bass * 3;
      for (const material of glow.trim) material.emissiveIntensity = 0.5 + kick * 2 + bounce;
      spots.forEach((light, i) => { light.intensity = 12 + bounce * 35 + (beats % 4 === i ? 15 : 0); });
      beams.forEach(({ beam, material }, i) => {
        beam.rotation.set(Math.sin(frame.time * 0.6 + i) * 0.45 + 0.35, 0, Math.cos(frame.time * 0.45 + i * 1.3) * 0.5);
        material.color.setHSL((frame.hue + i / 4) % 1, 1, 0.5).multiplyScalar(0.05 + bounce * 0.1);
      });
      // Low haze drifts along the floor behind the riser front, lit faintly by the stage colour.
      if (frame.delta > 0 && random() < 0.15) smoke.emit(-5 + random() * 10, 0.6, -3 + random() * 3.5, (random() - 0.5) * 0.3, 0.05, 0.05, 7, 2 + random() * 1.5, 0.05, 0.04, 0.07);
      smoke.update(step);
      const sway = Math.sin(frame.time * 0.08);
      camera.position.set(sway * 2.5, 2.3 + Math.sin(frame.time * 0.17) * 0.25, 6.2 - Math.abs(sway) * 0.6);
      camera.lookAt(0, 1.5, -0.3);
    },
    dispose() { models.dispose(); for (const member of members) member.player.dispose(); disposeScene(scene); },
  };
}
