import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { Break, Fn, If, Loop, float, min, mix, uniform, uniformArray, vec3 } from 'three/tsl';

type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

/**
 * A hand and forearm as a chain of tapered capsules, blended with a smooth minimum and raymarched in a
 * fullscreen pass. Joints are posed on the CPU each frame, so the hand can point, curl and dip; the shader
 * only sees segment end points (xyz) and radii (w) in screen units (frame height = 1, z toward the viewer).
 */
export const HAND_SEGMENTS = 22;
const STEPS = 56;

export interface HandPose {
  /** Curl per finger, 0 straight – 1 fully folded: index, middle, ring, pinky. */
  curl: readonly [number, number, number, number];
  /** Thumb curl, 0 out – 1 across the palm. */
  thumb: number;
  /** Extra fan between the fingers, radians. */
  spread: number;
  /** Wrist bend, radians: positive folds the hand toward the palm side of the forearm (the arm swings back). */
  wrist?: number;
}

const FINGERS = [
  { base: [0.3, 0.95], lengths: [0.42, 0.25, 0.2], radii: [0.086, 0.078, 0.07, 0.064], fan: -0.07 },
  { base: [0.1, 0.99], lengths: [0.46, 0.28, 0.21], radii: [0.088, 0.08, 0.072, 0.065], fan: 0 },
  { base: [-0.1, 0.96], lengths: [0.42, 0.26, 0.2], radii: [0.083, 0.076, 0.068, 0.062], fan: 0.07 },
  { base: [-0.29, 0.88], lengths: [0.33, 0.2, 0.17], radii: [0.073, 0.066, 0.06, 0.055], fan: 0.16 },
] as const;

/**
 * Forward kinematics for one pose: writes each segment as (a.xyz, r1) and (b.xyz, r2), already moved into
 * screen space by `placement`, and returns the fingertips (index first, thumb last) in screen space.
 */
export function poseHand(pose: HandPose, placement: THREE.Matrix4, outA: THREE.Vector4[], outB: THREE.Vector4[]) {
  const scale = new THREE.Vector3().setFromMatrixScale(placement).x;
  const segments: [THREE.Vector3, number, THREE.Vector3, number][] = [];
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // Forearm (turned about the wrist), palm (four metacarpals, a fleshy pad) and the thumb's mound.
  const elbow = v(0, -6, -0.05).applyAxisAngle(v(1, 0, 0), -(pose.wrist ?? 0));
  segments.push([elbow, 0.36, v(0, -0.05, 0), 0.25]);
  for (const finger of FINGERS) segments.push([v(finger.base[0] * 0.55, 0.05, 0), 0.13, v(finger.base[0], finger.base[1] - 0.02, 0), 0.115]);
  segments.push([v(0.02, 0.28, 0.03), 0.24, v(0, 0.66, 0.02), 0.22]);
  segments.push([v(0.14, 0.12, 0.05), 0.17, v(0.33, 0.36, 0.08), 0.13]);
  const tips: THREE.Vector3[] = [];
  const axisX = v(1, 0, 0), axisZ = v(0, 0, 1);
  FINGERS.forEach((finger, f) => {
    let at = v(finger.base[0], finger.base[1], 0);
    const dir = v(0, 1, 0).applyAxisAngle(axisZ, finger.fan * (1 + pose.spread * 4));
    const bends = [1.25, 1.55, 1.05].map((angle) => angle * pose.curl[f]);
    finger.lengths.forEach((length, j) => {
      // Bend toward the palm (+Z) about the finger's own sideways axis.
      const side = axisX.clone().applyAxisAngle(axisZ, finger.fan);
      dir.applyAxisAngle(side, bends[j]);
      const next = at.clone().addScaledVector(dir, length);
      segments.push([at, finger.radii[j], next, finger.radii[j + 1]]);
      at = next;
    });
    tips.push(at);
  });
  // Thumb: blend between an open and a folded direction per joint.
  const open = [v(0.75, 0.55, 0.3), v(0.6, 0.75, 0.25), v(0.45, 0.85, 0.2)], folded = [v(0.2, 0.75, 0.65), v(-0.35, 0.55, 0.75), v(-0.7, 0.2, 0.7)];
  let at = v(0.33, 0.36, 0.08);
  [0.3, 0.25, 0.2].forEach((length, j) => {
    const dir = open[j].clone().normalize().lerp(folded[j].clone().normalize(), pose.thumb).normalize();
    const next = at.clone().addScaledVector(dir, length);
    segments.push([at, [0.105, 0.092, 0.082][j], next, [0.092, 0.082, 0.072][j]]);
    at = next;
  });
  tips.push(at);
  segments.forEach(([a, r1, b, r2], i) => {
    const pa = a.clone().applyMatrix4(placement), pb = b.clone().applyMatrix4(placement);
    outA[i].set(pa.x, pa.y, pa.z, r1 * scale); outB[i].set(pb.x, pb.y, pb.z, r2 * scale);
  });
  return tips.map((tip) => tip.applyMatrix4(placement));
}

/** Uniforms for one posed hand plus the raymarch that turns them into a hit, a normal and a silhouette distance. */
export function createHand() {
  const a = Array.from({ length: HAND_SEGMENTS }, () => new THREE.Vector4()), b = Array.from({ length: HAND_SEGMENTS }, () => new THREE.Vector4());
  const segA = uniformArray(a, 'vec4'), segB = uniformArray(b, 'vec4');
  const bounds = uniform(new THREE.Vector4(-1, -1, 1, 1)), blend = uniform(0.03);
  const sdf = Fn(([p]: [V3]) => {
    const d = float(1e3).toVar();
    Loop(HAND_SEGMENTS, ({ i }) => {
      const sa = segA.element(i) as unknown as Node<'vec4'>, sb = segB.element(i) as unknown as Node<'vec4'>;
      const pa = p.sub(sa.xyz), ba = sb.xyz.sub(sa.xyz);
      const h = pa.dot(ba).div(ba.dot(ba).max(1e-8)).clamp(0, 1);
      const di = pa.sub(ba.mul(h)).length().sub(mix(sa.w, sb.w, h));
      // Polynomial smooth minimum: joints and the palm flow into each other instead of meeting at creases.
      const k = blend, s = k.sub(d.sub(di).abs()).max(0).div(k);
      d.assign(min(d, di).sub(s.mul(s).mul(k).mul(0.25)));
    });
    return d;
  });
  /** Orthographic march toward −z at screen point `p`: x = depth reached, y = hit (0/1), z = closest approach. */
  const march = Fn(([p]: [V2]) => {
    const t = float(0).toVar(), hit = float(0).toVar(), closest = float(1e3).toVar();
    const inside = p.x.greaterThan(bounds.x).and(p.y.greaterThan(bounds.y)).and(p.x.lessThan(bounds.z)).and(p.y.lessThan(bounds.w));
    If(inside, () => {
      Loop(STEPS, () => {
        const d = sdf(vec3(p, float(1).sub(t)));
        closest.assign(min(closest, d));
        If(d.lessThan(0.0006), () => { hit.assign(1); Break(); });
        t.addAssign(d.mul(0.9));
        If(t.greaterThan(2), () => { Break(); });
      });
    });
    return vec3(t, hit, closest);
  });
  const normalAt = (pos: V3) => {
    const e = 0.0015;
    const k1 = vec3(1, -1, -1), k2 = vec3(-1, -1, 1), k3 = vec3(-1, 1, -1), k4 = vec3(1, 1, 1);
    return k1.mul(sdf(pos.add(k1.mul(e)))).add(k2.mul(sdf(pos.add(k2.mul(e))))).add(k3.mul(sdf(pos.add(k3.mul(e))))).add(k4.mul(sdf(pos.add(k4.mul(e))))).normalize();
  };
  return {
    sdf, blend,
    /** Trace the hand at screen point `p`; `pos` and `normal` are only meaningful where `hit` is 1. */
    trace(p: V2) {
      const result = march(p), pos = vec3(p, float(1).sub(result.x)), normal = normalAt(pos);
      return { hit: result.y, closest: result.z, pos, normal, occlusion: sdf(pos.add(normal.mul(0.02))).div(0.02).clamp(0, 1) };
    },
    /** Pose the hand for this frame; returns fingertip positions in screen units (index … pinky, thumb). */
    pose(pose: HandPose, placement: THREE.Matrix4) {
      const tips = poseHand(pose, placement, a, b);
      // Screen-space bounds of every segment, so pixels away from the hand skip the march.
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const v of [...a, ...b]) { x0 = Math.min(x0, v.x - v.w); y0 = Math.min(y0, v.y - v.w); x1 = Math.max(x1, v.x + v.w); y1 = Math.max(y1, v.y + v.w); }
      bounds.value.set(x0 - 0.03, y0 - 0.03, x1 + 0.03, y1 + 0.03);
      return tips;
    },
  };
}
export type Hand = ReturnType<typeof createHand>;

/** A placement matrix: screen position, size (palm width ≈ 0.8 × scale) and orientation. */
export function handPlacement(x: number, y: number, scale: number, roll: number, pitch = 0, yaw = 0) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'ZYX')), new THREE.Vector3(scale, scale, scale));
}

