import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { GG, GG_SHOTS, LanePath, analyticCableY, cableProfile, type ShotPose } from '../../src/modes/goldenGateMode';

describe('golden gate bridge', () => {
  it('walks a lane by arc length and looks it up by z', () => {
    const lane = new LanePath(1.5, [[-100, 0], [0, 10], [100, 10]]);
    expect(lane.length).toBeCloseTo(Math.hypot(100, 10) + 100);
    expect(lane.yAt(-50)).toBeCloseTo(5);
    expect(lane.yAt(500)).toBe(10);
    const point = new THREE.Vector3(), slope = lane.at(lane.arcAt(-50), point);
    expect(point.toArray().map((n) => Number(n.toFixed(3)))).toEqual([1.5, 5, -50]);
    expect(slope).toBeCloseTo(Math.atan2(10, 100));
    expect(lane.at(lane.arcAt(50), point)).toBe(0);
  });
  it('recovers a cable centreline from tube vertices', () => {
    // A ring of eight vertices around the analytic cable every metre.
    const positions: number[] = [];
    for (let z = -GG.anchorZ; z <= GG.anchorZ; z += 1) for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2;
      positions.push(-17.2 + Math.cos(a) * 0.45, analyticCableY(z) + Math.sin(a) * 0.45, z);
    }
    const cable = cableProfile([positions])!;
    expect(cable.x).toBeCloseTo(-17.2, 1);
    for (const z of [-900, -640, -300, 0, 400, 700]) expect(Math.abs(cable.yAt(z) - analyticCableY(z))).toBeLessThan(1.5);
    expect(cableProfile([[0, 0, 5000]])).toBeUndefined();
  });
  it('every shot gives a finite camera that is not looking at itself', () => {
    const flat = new LanePath(4.7, [[-1300, 60], [-983, 75], [983, 75], [1390, 58]]);
    const cable = (x: number) => new LanePath(x, Array.from({ length: 50 }, (_, i) => [-983 + i * 40.1, analyticCableY(-983 + i * 40.1)] as const));
    const context = { ride: 400, lane: flat, cables: [cable(-17.2), cable(17.2)] as const };
    const pose: ShotPose = { eye: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3(), fov: 0, near: 0 };
    expect(GG_SHOTS.length).toBeGreaterThanOrEqual(15);
    for (const shot of GG_SHOTS) for (const t of [0, 5, 30]) {
      shot.pose(t, context, pose);
      for (const n of [...pose.eye.toArray(), ...pose.look.toArray(), pose.fov, pose.near]) expect(Number.isFinite(n), shot.name).toBe(true);
      expect(pose.eye.distanceTo(pose.look), shot.name).toBeGreaterThan(10);
      expect(pose.fov).toBeGreaterThan(1);
      // Never looking straight along the up vector (lookAt would be undefined).
      const forward = pose.look.clone().sub(pose.eye).normalize();
      expect(Math.abs(forward.dot(pose.up.clone().normalize())), shot.name).toBeLessThan(0.999);
    }
  });
});
