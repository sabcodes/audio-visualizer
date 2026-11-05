import * as THREE from 'three/webgpu';
import type { ModeFrame } from './types';
import { approach } from './shared';
import { TempoTracker, type Figure } from './figures';

export const OGRE_ACTIONS = ['club sweep', 'wave', 'jump', 'laser roar', 'overhead swing', 'chest roar', 'jump', 'laser roar'] as const;
const SCALE = 2.2, TAU = Math.PI * 2;
const smooth = (t: number) => { t = THREE.MathUtils.clamp(t, 0, 1); return t * t * (3 - 2 * t); };

/** One coherent pose, evaluated from rest each frame: no accumulated offsets or competing animation clips. */
export function createGiantPerformance(figure: Figure) {
  const names = ['Hips', 'Spine', 'Spine2', 'Neck', 'Head', 'Jaw', 'Brow', 'Belly',
    'LeftShoulder', 'RightShoulder', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand',
    'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot'];
  const bones = new Map(names.map(name => { const bone = figure.node(name); return [name, { bone, rest: bone.quaternion.clone() }] as const; }));
  const euler = new THREE.Euler(), quaternion = new THREE.Quaternion(), tempo = new TempoTracker();
  const parentRotation = new THREE.Quaternion(), weaponRotation = new THREE.Quaternion();
  const weaponDirection = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const turn = (name: string, x = 0, y = 0, z = 0) => {
    const { bone, rest } = bones.get(name)!;
    bone.quaternion.copy(rest).multiply(quaternion.setFromEuler(euler.set(x, y, z)));
  };
  let clock = 0, lastBeat = -10, onsetHeld = false, previousImpact = 0, actionAt = -10, jumpAt = -10, laserAt = -10;
  let jumpStart = new THREE.Vector2(), jumpEnd = new THREE.Vector2(), landPending = false;
  let energy = 0, bass = 0, hit = 0, beatCount = 0, actionIndex = 0, jaw = 0;
  const state = { clock: 0, beats: 0, action: 'idle', energy: 0, hit: 0, jaw: 0, jumpHeight: 0, crouch: 0,
    beam: 0, charge: 0, flash: 0, landed: false, fired: false, position: [0, 0, 0] };
  figure.root.name = 'Swamp Ogre / character';
  figure.root.scale.setScalar(SCALE);
  return {
    state,
    update(frame: ModeFrame) {
      const dt = frame.reducedMotion ? 0 : Math.min(0.1, Math.max(0, frame.delta));
      if (dt === 0) { state.landed = state.fired = false; return state; }
      clock += dt;
      const rising = frame.audio.onset && !onsetHeld;
      onsetHeld = frame.audio.onset;
      const fired = (rising || frame.response.impact - previousImpact > 0.3) && clock - lastBeat >= (frame.reducedFlash ? 1 / 3 : 0.24);
      previousImpact = frame.response.impact;
      if (fired) {
        lastBeat = clock; hit = 1; beatCount++;
        actionIndex = (beatCount - 1) % OGRE_ACTIONS.length; actionAt = clock;
        if (OGRE_ACTIONS[actionIndex] === 'jump' && clock - jumpAt > 0.95) {
          jumpAt = clock; landPending = true;
          jumpStart.set(figure.root.position.x, figure.root.position.z);
          const angle = beatCount * 1.7;
          jumpEnd.set(Math.sin(angle) * 1.25, Math.cos(angle) * 0.7);
        }
        if (OGRE_ACTIONS[actionIndex] === 'laser roar') laserAt = clock;
      } else hit *= Math.exp(-dt / 0.16);
      tempo.update(clock, fired, dt);
      energy = approach(energy, Math.max(frame.response.loudness, frame.response.bounce), dt, 0.16);
      bass = approach(bass, frame.response.bass, dt, 0.1);
      const playing = clock - lastBeat < 1.5 || energy > 0.15;
      const age = clock - actionAt, action = OGRE_ACTIONS[actionIndex];
      const accent = Math.sin(Math.PI * Math.min(1, age / 0.65)) ** 2;
      const rhythm = Math.sin(tempo.phase * TAU), sway = Math.sin(clock * tempo.timeScale * Math.PI * 2) * energy;
      const laserAge = clock - laserAt;
      const charge = laserAge < 0.16 ? smooth(laserAge / 0.16) : laserAge < 0.38 ? 1 : Math.max(0, 1 - (laserAge - 0.38) / 0.2);
      const beam = laserAge >= 0.16 && laserAge < 0.58 ? Math.min(1, (laserAge - 0.16) / 0.035) * Math.min(1, (0.58 - laserAge) / 0.16) : 0;
      const roar = action.includes('roar') ? accent : 0;
      jaw = approach(jaw, Math.max(roar * 0.85, charge * 0.95, playing ? 0.06 + energy * (0.1 + Math.max(0, rhythm) * 0.12) : 0.03), dt, 0.055);

      // Anticipation -> parabolic airborne arc -> soft landing. Lateral travel happens only in the air.
      const jumpAge = clock - jumpAt, flight = THREE.MathUtils.clamp((jumpAge - 0.14) / 0.56, 0, 1);
      const jumping = jumpAge < 0.88;
      const height = jumping ? Math.sin(Math.PI * flight) * (1.15 + bass * 0.55) : 0;
      const crouch = jumpAge < 0.14 ? smooth(jumpAge / 0.14) * 0.4
        : jumpAge > 0.7 && jumpAge < 0.88 ? Math.sin((jumpAge - 0.7) / 0.18 * Math.PI) * 0.32 : 0;
      const landed = landPending && jumpAge >= 0.7;
      if (landed) landPending = false;
      if (jumping || landed) {
        const u = smooth(flight);
        figure.root.position.x = THREE.MathUtils.lerp(jumpStart.x, jumpEnd.x, u);
        figure.root.position.z = THREE.MathUtils.lerp(jumpStart.y, jumpEnd.y, u);
      }
      const dip = playing ? hit * (jumping ? 0 : 0.12) : 0;
      figure.root.position.y = height - crouch - dip;
      figure.root.rotation.y = -0.12 + sway * 0.12 + (action === 'club sweep' ? Math.sin(age / 0.65 * Math.PI * 2) * accent * 0.24 : 0);
      // Keep the boots level and compensate for the lowered hips instead of sliding them through the floor.
      const leg1 = 0.85, leg2 = Math.hypot(0.61, 0.1), distance = THREE.MathUtils.clamp(leg1 + leg2 - (crouch + dip) / SCALE, 0.7, leg1 + leg2);
      const hip = -Math.acos(THREE.MathUtils.clamp((leg1 * leg1 + distance * distance - leg2 * leg2) / (2 * leg1 * distance), -1, 1));
      const knee = Math.PI - Math.acos(THREE.MathUtils.clamp((leg1 * leg1 + leg2 * leg2 - distance * distance) / (2 * leg1 * leg2), -1, 1));
      for (const side of ['Left', 'Right']) {
        const tuck = jumping ? Math.sin(flight * Math.PI) * 0.55 : 0;
        turn(`${side}UpLeg`, hip - tuck);
        turn(`${side}Leg`, knee + tuck * 1.5);
        turn(`${side}Foot`, -hip - knee - tuck * 0.5);
      }
      turn('Hips', 0, sway * 0.04, sway * 0.025);
      turn('Spine', -roar * 0.08, 0, -sway * 0.035);
      turn('Spine2', hit * 0.05 - roar * 0.13, sway * 0.06, -sway * 0.025);
      turn('Neck', -roar * 0.09 + charge * 0.12);
      turn('Head', -roar * 0.12 + charge * 0.16 + Math.sin(clock * 3.5) * energy * 0.025, Math.sin(clock * 0.45) * 0.12);
      turn('Jaw', jaw);
      turn('Brow', -roar * 0.06, 0, Math.sin(clock * 0.8) * 0.025);
      turn('Belly');
      bones.get('Belly')!.bone.scale.set(1 + Math.sin(clock * 2.2) * 0.015 + hit * 0.015, 1, 1);
      const wave = action === 'wave' ? accent : 0, overhead = action === 'overhead swing' ? accent : 0;
      const sweep = action === 'club sweep' ? accent : 0;
      turn('LeftShoulder', 0, 0, wave * 0.12);
      turn('RightShoulder', 0, sweep * 0.14, -overhead * 0.1);
      turn('LeftArm', -0.12 - hit * 0.12 - roar * 0.15, 0, 0.08 + wave * 2.15 + roar * 0.5 + height * 0.15);
      turn('LeftForeArm', -0.15 - wave * 0.3 - roar * 0.3, wave * Math.sin(age * 18) * 0.25);
      turn('LeftHand', 0, 0, wave * Math.sin(age * 18) * 0.3);
      turn('RightArm', -0.12 - sweep * 0.55 - overhead * 0.35 - roar * 0.18, sweep * 0.1, -0.1 - sweep * 0.45 - overhead * 2.15 - roar * 0.4 - height * 0.1);
      turn('RightForeArm', -0.13 - sweep * 0.5 - overhead * 0.3);
      // Counter-rotate the gripping wrist: the heavy club arcs outside the silhouette instead of through the shoulder.
      const hand = bones.get('RightHand')!.bone;
      figure.root.updateMatrixWorld(true);
      hand.parent!.getWorldQuaternion(parentRotation);
      weaponDirection.set(-0.18 - sweep * 0.65 - overhead * 0.12, 0.95 - sweep * 0.5, 0.15 + sweep * 0.35 - overhead * 0.2).normalize();
      weaponRotation.setFromUnitVectors(up, weaponDirection);
      hand.quaternion.copy(parentRotation.invert().multiply(weaponRotation));
      figure.root.updateMatrixWorld(true);
      Object.assign(state, { clock, beats: beatCount, action: playing ? action : 'idle', energy, hit, jaw,
        jumpHeight: height, crouch, beam, charge, flash: beam * (frame.reducedFlash ? 0.4 : 1), landed, fired,
        position: figure.root.position.toArray() });
      return state;
    },
  };
}
