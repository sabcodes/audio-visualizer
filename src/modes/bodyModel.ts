import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { Fn, Loop, float, min, mix, uniformArray } from 'three/tsl';

type V2 = Node<'vec2'>;

/**
 * A code-built human figure for the wave 5 silhouette modes: a skeleton of tapered capsules posed in code
 * (forward kinematics from a few joint angles), projected onto the screen and blended into one smooth 2D
 * distance field. The clips read their figures as silhouettes (backlit in fog, streaks, dots, a white glow),
 * so the outline is what matters, not the surface.
 */
export const BODY_SEGMENTS = 22;

export interface LimbPose { swing: number; out: number; bend: number }
export interface BodyPose {
  /** Forward lean of the torso, radians. */
  lean: number;
  /** Torso turn about the spine, radians. */
  twist: number;
  /** Sideways bend of the torso, radians. */
  tilt: number;
  /** Pelvis height offset (crouch negative, jump positive), metres. */
  bob: number;
  /** Arms (left, right): swing forward (π overhead), raise out to the side, elbow bend forward. */
  arms: readonly [LimbPose, LimbPose];
  /** Legs (left, right): swing forward, spread out to the side, knee bend backward. */
  legs: readonly [LimbPose, LimbPose];
  /** Skirt or coat flare, 0 hanging – 1 fully out; ignored when the figure has none. */
  flare?: number;
}

const limb = (swing: number, out: number, bend: number): LimbPose => ({ swing, out, bend });
const pose = (p: Partial<BodyPose> & Pick<BodyPose, 'arms' | 'legs'>): BodyPose => ({ lean: 0, twist: 0, tilt: 0, bob: 0, ...p });

/** Key poses for the dance modes (Neon Portal, Slit Dancer); a mode blends between them on its own beat. */
export const DANCE_MOVES = {
  idle: pose({ arms: [limb(0.1, 0.15, 0.3), limb(0.1, 0.15, 0.3)], legs: [limb(0, 0.06, 0.05), limb(0, 0.06, 0.05)] }),
  armSwing: pose({ twist: 0.25, arms: [limb(1.6, 0.2, 0.4), limb(-0.7, 0.2, 0.3)], legs: [limb(0.2, 0.06, 0.2), limb(-0.15, 0.06, 0.1)] }),
  legLift: pose({ lean: 0.1, bob: 0.02, arms: [limb(0.3, 1.3, 0.3), limb(0.3, 1.3, 0.3)], legs: [limb(1.4, 0.05, 1.7), limb(0, 0.04, 0.05)] }),
  squat: pose({ lean: 0.45, bob: -0.32, arms: [limb(1.2, 0.3, 0.6), limb(1.2, 0.3, 0.6)], legs: [limb(1.2, 0.25, 2.1), limb(1.2, 0.25, 2.1)] }),
  star: pose({ bob: 0.16, arms: [limb(0.3, 2.4, 0.1), limb(0.3, 2.4, 0.1)], legs: [limb(0.1, 0.5, 0.1), limb(0.1, 0.5, 0.1)] }),
  wideBack: pose({ lean: -0.15, arms: [limb(-0.9, 0.35, 0.2), limb(-0.9, 0.35, 0.2)], legs: [limb(0.15, 0.35, 0.15), limb(-0.1, 0.35, 0.1)] }),
  twist: pose({ twist: 0.7, tilt: 0.1, arms: [limb(1.0, 0.8, 1.6), limb(0.6, 0.9, 1.8)], legs: [limb(0.25, 0.1, 0.4), limb(-0.1, 0.12, 0.1)] }),
  reach: pose({ tilt: -0.15, arms: [limb(2.9, 0.25, 0.1), limb(0, 0.6, 1.9)], legs: [limb(0, 0.12, 0.05), limb(0.3, 0.05, 0.5)] }),
} satisfies Record<string, BodyPose>;
export type DanceMove = keyof typeof DANCE_MOVES;

/** One stride of a run (phase 0–1 is two steps): knees drive, arms counter-swing, the body bobs twice. */
export function runPose(phase: number, flare = 0): BodyPose {
  const a = phase * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
  const leg = (sign: number) => limb(sign * s * 0.75 + 0.15, 0.04, 0.4 + Math.max(0, -sign * c) * 1.4 + Math.max(0, sign * s) * 0.4);
  const arm = (sign: number) => limb(-sign * s * 0.8, 0.12, 1.3);
  return { lean: 0.22, twist: s * 0.15, tilt: 0, bob: Math.abs(Math.cos(a)) * 0.05 - 0.03, arms: [arm(1), arm(-1)], legs: [leg(1), leg(-1)], flare };
}

/** Floating: arms a little out, legs together with pointed feet, a slow sway. */
export function hoverPose(t: number): BodyPose {
  const sway = Math.sin(t * 0.8);
  return pose({ lean: 0.05 + sway * 0.03, tilt: sway * 0.04, arms: [limb(0.15 + sway * 0.1, 0.55, 0.25), limb(0.15 - sway * 0.1, 0.55, 0.25)], legs: [limb(0.05, 0.03, 0.15 + sway * 0.05), limb(-0.05, 0.03, 0.05)] });
}

const mixLimb = (a: LimbPose, b: LimbPose, t: number) => limb(a.swing + (b.swing - a.swing) * t, a.out + (b.out - a.out) * t, a.bend + (b.bend - a.bend) * t);
/** Linear blend of two poses (joint angles interpolate, so a blend is always a valid pose). */
export function blendPose(a: BodyPose, b: BodyPose, t: number): BodyPose {
  const m = (x: number, y: number) => x + (y - x) * t;
  return {
    lean: m(a.lean, b.lean), twist: m(a.twist, b.twist), tilt: m(a.tilt, b.tilt), bob: m(a.bob, b.bob), flare: m(a.flare ?? 0, b.flare ?? 0),
    arms: [mixLimb(a.arms[0], b.arms[0], t), mixLimb(a.arms[1], b.arms[1], t)], legs: [mixLimb(a.legs[0], b.legs[0], t), mixLimb(a.legs[1], b.legs[1], t)],
  };
}

export interface BodyStyle { skirt?: boolean; hair?: boolean; build?: number }

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** Direction for a limb: `side` is −1 for the left (screen-left when facing the viewer), +1 for the right. */
const limbDirection = (swing: number, out: number, side: number) => v(side * Math.sin(out), -Math.cos(out) * Math.cos(swing), Math.cos(out) * Math.sin(swing));

/**
 * Forward kinematics: the figure stands at the origin facing +z (1.75 m tall), turned by `yaw` and seen from
 * the front. Returns segments as [a, r1, b, r2] in metres, plus the head centre and feet for emitters.
 */
export function poseBody(p: BodyPose, style: BodyStyle = {}, yaw = 0, time = 0) {
  const build = style.build ?? 1;
  const segments: [THREE.Vector3, number, THREE.Vector3, number][] = [];
  const pelvis = v(0, 0.95 + p.bob, 0);
  // The upper body turns and leans about the pelvis.
  const upper = new THREE.Matrix4().makeRotationY(p.twist).multiply(new THREE.Matrix4().makeRotationZ(-p.tilt)).multiply(new THREE.Matrix4().makeRotationX(p.lean));
  const up = (q: THREE.Vector3) => q.applyMatrix4(upper).add(pelvis);
  const chest = up(v(0, 0.43, 0)), neck = up(v(0, 0.55, 0.01)), head = up(v(0, 0.68, 0.02));
  segments.push([pelvis.clone(), 0.14 * build, chest.clone(), 0.16 * build]);
  const shoulders = [-1, 1].map((side) => up(v(side * 0.19 * build, 0.47, 0)));
  segments.push([shoulders[0], 0.065 * build, shoulders[1], 0.065 * build]);
  segments.push([chest.clone(), 0.05, neck, 0.05]);
  segments.push([head.clone(), 0.105, head.clone().add(v(0, 0.035, 0.01)), 0.1]);
  p.arms.forEach((arm, i) => {
    const side = i ? 1 : -1, rot = (d: THREE.Vector3) => d.applyMatrix4(new THREE.Matrix4().extractRotation(upper));
    const elbow = shoulders[i].clone().add(rot(limbDirection(arm.swing, arm.out, side)).multiplyScalar(0.29));
    const wrist = elbow.clone().add(rot(limbDirection(arm.swing + arm.bend, arm.out * 0.8, side)).multiplyScalar(0.26));
    const hand = wrist.clone().add(rot(limbDirection(arm.swing + arm.bend * 1.1, arm.out * 0.8, side)).multiplyScalar(0.1));
    segments.push([shoulders[i].clone(), 0.052 * build, elbow, 0.042 * build], [elbow.clone(), 0.04 * build, wrist, 0.031], [wrist.clone(), 0.034, hand, 0.028]);
  });
  const hips = [-1, 1].map((side) => pelvis.clone().add(v(side * 0.1 * build, -0.04, 0)));
  segments.push([hips[0], 0.1 * build, hips[1], 0.1 * build]);
  const feet: THREE.Vector3[] = [];
  p.legs.forEach((leg, i) => {
    const side = i ? 1 : -1;
    const knee = hips[i].clone().add(limbDirection(leg.swing, leg.out, side).multiplyScalar(0.45));
    const ankle = knee.clone().add(limbDirection(leg.swing - leg.bend, leg.out * 0.6, side).multiplyScalar(0.43));
    const toe = ankle.clone().add(limbDirection(leg.swing - leg.bend + Math.PI / 2 - 0.25, 0, side).multiplyScalar(0.17));
    segments.push([hips[i].clone(), 0.082 * build, knee, 0.056 * build], [knee.clone(), 0.052 * build, ankle, 0.037], [ankle.clone(), 0.038, toe, 0.028]);
    feet.push(toe);
  });
  // A skirt or coat: four panels from the waist, flaring out (and lagging behind a little) with `flare`.
  const waist = pelvis.clone().add(v(0, 0.12, 0)), flare = p.flare ?? 0;
  for (let k = 0; k < 4; k++) {
    if (!style.skirt) { segments.push([v(0, -50, 0), 0, v(0, -50, 0), 0]); continue; }
    const angle = (k / 4) * Math.PI * 2 + Math.PI / 4 + Math.sin(time * 3 + k) * 0.15 * flare;
    const reach = 0.12 + flare * 0.32;
    const hem = pelvis.clone().add(v(Math.sin(angle) * reach, -0.5 + flare * 0.22, Math.cos(angle) * reach - flare * 0.12));
    segments.push([waist.clone(), 0.11, hem, 0.06 + flare * 0.05]);
  }
  // Long hair: one soft capsule from the crown down the back.
  if (style.hair) segments.push([head.clone().add(v(0, 0.06, -0.04)), 0.1, head.clone().add(v(Math.sin(time * 1.3) * 0.03, -0.32, -0.1)), 0.06]);
  else segments.push([v(0, -50, 0), 0, v(0, -50, 0), 0]);
  const turn = new THREE.Matrix4().makeRotationY(yaw);
  for (const s of segments) { s[0].applyMatrix4(turn); s[2].applyMatrix4(turn); }
  return { segments, head: head.applyMatrix4(turn), feet: feet.map((f) => f.applyMatrix4(turn)) };
}

/**
 * One figure as uniforms plus its 2D distance field. `pose` writes the segments projected to the screen
 * (frame height = 1, `x`, `y` the feet, `height` the figure's height in frame heights).
 */
export function createBody(style: BodyStyle = {}) {
  const a = Array.from({ length: BODY_SEGMENTS }, () => new THREE.Vector4()), b = Array.from({ length: BODY_SEGMENTS }, () => new THREE.Vector4());
  const segA = uniformArray(a, 'vec4'), segB = uniformArray(b, 'vec4');
  const sdf = Fn(([p, k]: [V2, Node<'float'>]) => {
    const d = float(1e3).toVar();
    Loop(BODY_SEGMENTS, ({ i }) => {
      const sa = segA.element(i) as unknown as Node<'vec4'>, sb = segB.element(i) as unknown as Node<'vec4'>;
      const pa = p.sub(sa.xy), ba = sb.xy.sub(sa.xy);
      const h = pa.dot(ba).div(ba.dot(ba).max(1e-8)).clamp(0, 1);
      const di = pa.sub(ba.mul(h)).length().sub(mix(sa.w, sb.w, h));
      const s = k.sub(d.sub(di).abs()).max(0).div(k);
      d.assign(min(d, di).sub(s.mul(s).mul(k).mul(0.25)));
    });
    return d;
  });
  const head = new THREE.Vector2(), feet = [new THREE.Vector2(), new THREE.Vector2()];
  return {
    /** Signed distance to the silhouette at screen point `p` (frame heights); `blend` softens the joints. */
    distance: (p: V2, blend: Node<'float'> | number = 0.012) => sdf(p, typeof blend === 'number' ? float(blend) : blend),
    head, feet,
    /** The posed segments in screen units (a, r1, b, r2 as vec4 pairs), on the CPU and as shader arrays. */
    segments: { a, b, nodes: { a: segA, b: segB } },
    pose(next: BodyPose, x: number, y: number, height: number, yaw = 0, time = 0) {
      const posed = poseBody(next, style, yaw, time), scale = height / 1.75;
      posed.segments.forEach(([pa, r1, pb, r2], i) => {
        a[i].set(x + pa.x * scale, y + pa.y * scale, pa.z * scale, r1 * scale);
        b[i].set(x + pb.x * scale, y + pb.y * scale, pb.z * scale, r2 * scale);
      });
      head.set(x + posed.head.x * scale, y + posed.head.y * scale);
      posed.feet.forEach((f, i) => feet[i].set(x + f.x * scale, y + f.y * scale));
    },
  };
}
export type Body = ReturnType<typeof createBody>;
