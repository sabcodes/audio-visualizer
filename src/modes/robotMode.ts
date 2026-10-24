import * as THREE from 'three/webgpu';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, wrap, bandEnergies, approach, beatGate } from './shared';
import { SpringRig } from '../simulations/springRig';
import { seededRandom } from '../rendering/diagnostics';

export const ROBOT_JOINTS = ['torso', 'head', 'lShoulder', 'lElbow', 'rShoulder', 'rElbow', 'lHip', 'lKnee', 'rHip', 'rKnee'] as const;
type Joint = typeof ROBOT_JOINTS[number];
export type RobotPose = Partial<Record<Joint, [number, number, number]>>;

// Arms and legs hang along -y. +z swings the left (+x) arm outward, -x raises a limb forward, +x on a knee bends it back.
export const ROBOT_POSES: readonly RobotPose[] = [
  { lShoulder: [0, 0, 0.35], rShoulder: [0, 0, -0.35], lElbow: [-1.2, 0, 0], rElbow: [-1.2, 0, 0], lHip: [-0.35, 0, 0], lKnee: [0.7, 0, 0], rHip: [-0.35, 0, 0], rKnee: [0.7, 0, 0] },
  { torso: [0, 0.2, 0.15], head: [0, -0.3, -0.1], rShoulder: [0, 0, -2.7], lShoulder: [-0.4, 0, 0.5], lElbow: [-1.4, 0, 0], lHip: [0, 0, 0.15] },
  { head: [0, 0.45, 0], lShoulder: [0, 0, 1.5], rShoulder: [0, 0, -1.5], lElbow: [0, 0, 1.57], rElbow: [0, 0, -1.57], lHip: [-0.2, 0, 0], lKnee: [0.4, 0, 0], rHip: [-0.2, 0, 0], rKnee: [0.4, 0, 0] },
  { torso: [0.25, 0, 0], lShoulder: [-1.5, 0, 0.1], rShoulder: [-1.5, 0, -0.1], lHip: [-0.9, 0, 0.25], lKnee: [1.5, 0, 0], rHip: [-0.9, 0, -0.25], rKnee: [1.5, 0, 0] },
  { torso: [0, 0, 0.32], head: [0.1, 0, -0.25], lShoulder: [0, 0, 2.6], rShoulder: [0, 0, -0.6], rElbow: [-1.1, 0, 0], rHip: [0, 0, -0.3] },
  { torso: [-0.1, 0, 0], rHip: [-1.2, 0, 0], rKnee: [0.35, 0, 0], lKnee: [0.25, 0, 0], lHip: [-0.1, 0, 0], lShoulder: [0, 0, 0.95], rShoulder: [0, 0, -0.95] },
  { head: [0.2, 0, 0], lShoulder: [0, 0, 2.6], rShoulder: [0, 0, -2.6], lElbow: [0, 0, 0.6], rElbow: [0, 0, -0.6], lHip: [-0.3, 0, 0], lKnee: [0.6, 0, 0], rHip: [-0.3, 0, 0], rKnee: [0.6, 0, 0] },
];
/** Spring targets for one pose: unlisted joints relax to zero. */
export function poseTargets(pose: RobotPose, out: Float32Array) {
  out.fill(0);
  ROBOT_JOINTS.forEach((joint, j) => { const angles = pose[joint]; if (angles) out.set(angles, j * 3); });
  return out;
}

const THIGH = 6, SHIN = 6, FOOT = 1;
const LED_COLUMNS = 4, LED_ROWS = 3, VISOR_BARS = 8;

export function createRobotMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  camera.position.set(0, 16, 44); camera.lookAt(0, 13, 0);
  const chrome = new THREE.MeshStandardNodeMaterial({ color: 0xc4ccd8, metalness: 0.55, roughness: 0.3 });
  const dark = new THREE.MeshStandardNodeMaterial({ color: 0x1a1d24, metalness: 0.3, roughness: 0.6 });
  const box = (w: number, h: number, d: number, material: THREE.Material, y = -h / 2, z = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); mesh.position.set(0, y, z); return mesh;
  };
  const joint = (parent: THREE.Object3D, x: number, y: number, z = 0) => { const group = new THREE.Group(); group.position.set(x, y, z); parent.add(group); return group; };

  const hips = new THREE.Group(); scene.add(hips);
  hips.add(box(6, 2, 3, dark, 0));
  const torso = joint(hips, 0, 1);
  torso.add(box(7, 8, 4, chrome, 4.5), box(5, 1.2, 3, dark, 0.4));
  const neck = joint(torso, 0, 9);
  neck.add(box(1.4, 1, 1.4, dark, 0.3));
  const head = joint(neck, 0, 0.8);
  head.add(box(5, 4.5, 4.5, chrome, 2.4), box(4.4, 1.6, 0.4, dark, 2.8, 2.3));
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.2), dark); antenna.position.set(1.4, 5.6, 0); head.add(antenna);
  const tipMaterial = new THREE.MeshBasicNodeMaterial();
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), tipMaterial); tip.position.set(1.4, 6.8, 0); head.add(tip);

  // Visor EQ bars and the chest LED meter are unlit so they glow through bloom.
  const glow = new THREE.MeshBasicNodeMaterial();
  const visorBars = Array.from({ length: VISOR_BARS }, (_, i) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.36, 1.3, 0.1), glow);
    bar.position.set((i - (VISOR_BARS - 1) / 2) * 0.5, 2.8, 2.55); head.add(bar); return bar;
  });
  const ledMaterials = Array.from({ length: LED_ROWS }, () => new THREE.MeshBasicNodeMaterial());
  for (let row = 0; row < LED_ROWS; row++) for (let column = 0; column < LED_COLUMNS; column++) {
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.2), ledMaterials[row]);
    led.position.set((column - (LED_COLUMNS - 1) / 2) * 1.2, 6.4 - row * 1.05, 2.05); torso.add(led);
  }

  const limb = (parent: THREE.Object3D, x: number, y: number, upper: [number, number], lower: [number, number], end: THREE.Mesh) => {
    const root = joint(parent, x, y);
    root.add(new THREE.Mesh(new THREE.SphereGeometry(upper[0] * 0.75, 12, 8), dark), box(upper[0], upper[1], upper[0], chrome));
    const middle = joint(root, 0, -upper[1]);
    middle.add(new THREE.Mesh(new THREE.SphereGeometry(lower[0] * 0.7, 12, 8), dark), box(lower[0], lower[1], lower[0], chrome));
    end.position.y = -lower[1] - end.position.y; middle.add(end);
    return [root, middle] as const;
  };
  const hand = () => box(1.8, 1.6, 1.8, dark, 0.8);
  const foot = () => box(2.4, FOOT, 4, dark, FOOT / 2, 0.8);
  const [lShoulder, lElbow] = limb(torso, 4.3, 7.8, [1.6, 5], [1.4, 4.5], hand());
  const [rShoulder, rElbow] = limb(torso, -4.3, 7.8, [1.6, 5], [1.4, 4.5], hand());
  const [lHip, lKnee] = limb(hips, 1.8, -1, [2, THIGH], [1.8, SHIN], foot());
  const [rHip, rKnee] = limb(hips, -1.8, -1, [2, THIGH], [1.8, SHIN], foot());
  const groups: Record<Joint, THREE.Object3D> = { torso, head, lShoulder, lElbow, rShoulder, rElbow, lHip, lKnee, rHip, rKnee };

  // Stage: dark floor with a ring that pulses on beats, plus coloured rim lights that follow the palette.
  const ringMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(new THREE.RingGeometry(9, 9.6, 96), ringMaterial); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(80, 64), new THREE.MeshStandardNodeMaterial({ color: 0x0c0d12, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  const key = new THREE.DirectionalLight(0xffffff, 3.2); key.position.set(10, 30, 25);
  const rimLeft = new THREE.PointLight(0xff00ff, 2400, 0, 2), rimRight = new THREE.PointLight(0x00ffff, 2400, 0, 2);
  rimLeft.position.set(-16, 22, -6); rimRight.position.set(16, 22, -6);
  scene.add(floor, ring, key, rimLeft, rimRight, new THREE.HemisphereLight(0x8090ff, 0x201020, 2));

  const rig = new SpringRig(ROBOT_JOINTS.length * 3 + 1), random = seededRandom(5);
  const POP = ROBOT_JOINTS.length * 3; // Extra channel: head pop height.
  poseTargets(ROBOT_POSES[0], rig.targets);
  const nextPose = beatGate(0.28), bands = new Float32Array(VISOR_BARS * 2);
  let pose = 0, sinceBeat = 0, ringAge = 9, groove = 0, meter = 0;
  const legHeight = (hip: THREE.Object3D, knee: THREE.Object3D) => THIGH * Math.cos(hip.rotation.x) * Math.cos(hip.rotation.z) + SHIN * Math.cos(hip.rotation.x + knee.rotation.x) * Math.cos(hip.rotation.z);
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      sinceBeat += frame.delta;
      const beat = nextPose(frame.time, frame.audio.onset);
      // Silence: keep dancing on a slow internal clock.
      if (beat || sinceBeat > 1.6) {
        sinceBeat = 0; ringAge = 0;
        let next = Math.floor(random() * (ROBOT_POSES.length - 1)); if (next >= pose) next++;
        pose = next; poseTargets(ROBOT_POSES[pose], rig.targets);
        rig.kick(POP, 6 + frame.response.bass * 10);
      }
      rig.targets[POP] = frame.response.bounce * 0.8;
      rig.advance(frame.delta);
      ROBOT_JOINTS.forEach((name, j) => groups[name].rotation.set(rig.values[j * 3], rig.values[j * 3 + 1], rig.values[j * 3 + 2]));
      groove += frame.delta * (2.2 + frame.response.bass * 3);
      torso.rotation.y += Math.sin(groove) * 0.12; head.rotation.x += Math.sin(groove * 2) * 0.06;
      neck.position.y = 9 + Math.max(0, rig.values[POP]) * 0.9;
      // Keep the lower foot planted: hip height follows the bent legs.
      hips.position.y = Math.max(legHeight(lHip, lKnee), legHeight(rHip, rKnee)) + FOOT + 1 + Math.sin(groove * 2) * 0.15;

      bandEnergies(frame, VISOR_BARS * 2, bands);
      visorBars.forEach((bar, i) => { bar.scale.y = approach(bar.scale.y, 0.15 + bands[VISOR_BARS + i] * 2.2, frame.delta, 0.05); });
      meter = approach(meter, frame.response.bass, frame.delta, 0.06);
      const flash = frame.reducedFlash ? 0 : frame.response.impact;
      glow.color.setHSL(wrap(frame.hue + 0.5, 0, 1), 1, 0.55).multiplyScalar(2.4);
      tipMaterial.color.setHSL(wrap(frame.hue, 0, 1), 1, 0.5).multiplyScalar(1.5 + meter * 3);
      ledMaterials.forEach((material, row) => {
        const lit = meter * LED_ROWS > LED_ROWS - 1 - row - 0.3;
        material.color.setHSL(wrap(frame.hue + row * 0.12, 0, 1), 1, lit ? 0.55 : 0.08).multiplyScalar(lit ? 2.6 + flash : 1);
      });
      ringAge += frame.delta;
      ring.scale.setScalar(1 + ringAge * 1.8);
      ringMaterial.color.setHSL(wrap(frame.hue + 0.5, 0, 1), 1, 0.55).multiplyScalar(Math.max(0, 1 - ringAge / 1.2) * (frame.reducedFlash ? 0.8 : 2.5));
      rimLeft.color.setHSL(wrap(frame.hue, 0, 1), 1, 0.5); rimRight.color.setHSL(wrap(frame.hue + 0.5, 0, 1), 1, 0.5);
      camera.position.x = Math.sin(frame.time * 0.15) * 10;
      camera.lookAt(0, 13, 0);
    },
    dispose: () => disposeScene(scene),
  };
}
