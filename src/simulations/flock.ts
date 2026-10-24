import { seededRandom } from '../rendering/diagnostics';
import { wrap } from '../modes/shared';
export interface Boid { px: number; py: number; pz: number; vx: number; vy: number; vz: number; }
export function initializeFlock(): Boid[] {
  const random = seededRandom(42);
  return Array.from({ length: 220 }, () => ({ px: (random() - 0.5) * 70, py: (random() - 0.5) * 40, pz: (random() - 0.5) * 70, vx: (random() - 0.5) * 10, vy: (random() - 0.5) * 10, vz: (random() - 0.5) * 10 }));
}
/** Bounded CPU adapter for parity: fixed step, double buffered, no per-agent allocation. */
export class FlockSimulation {
  readonly boids = initializeFlock();
  private readonly previous = this.boids.map((b) => ({ ...b }));
  private remainder = 0;
  advance(seconds: number, impact: number) {
    this.remainder += Number.isFinite(seconds) ? Math.max(0, Math.min(0.05, seconds)) : 0;
    while (this.remainder + 1e-10 >= 1 / 120) {
      this.step(1 / 120, Math.max(0, Math.min(1, impact)));
      this.remainder = Math.max(0, this.remainder - 1 / 120);
    }
  }
  private step(dt: number, impact: number) {
    for (let i = 0; i < this.boids.length; i++) Object.assign(this.previous[i], this.boids[i]);
    for (let i = 0; i < this.boids.length; i++) {
      const b = this.previous[i], next = this.boids[i];
      let ax = 0, ay = 0, az = 0, vx = 0, vy = 0, vz = 0, cx = 0, cy = 0, cz = 0, count = 0;
      for (let j = 0; j < this.previous.length; j++) {
        if (i === j) continue;
        const other = this.previous[j];
        const x = other.px - b.px, y = other.py - b.py, z = other.pz - b.pz;
        const d2 = x * x + y * y + z * z;
        if (d2 < 196) { count++; vx += other.vx; vy += other.vy; vz += other.vz; cx += other.px; cy += other.py; cz += other.pz; }
        if (d2 > 0.0001 && d2 < 64) { const force = 12 / Math.sqrt(d2); ax -= x * force; ay -= y * force; az -= z * force; }
      }
      if (count) {
        ax += (vx / count - b.vx) * 0.8 + (cx / count - b.px) * 0.4;
        ay += (vy / count - b.vy) * 0.8 + (cy / count - b.py) * 0.4;
        az += (vz / count - b.vz) * 0.8 + (cz / count - b.pz) * 0.4;
      }
      const r = Math.max(1, Math.hypot(b.px, b.py, b.pz));
      next.vx = b.vx + (ax + b.px / r * impact * 100) * dt;
      next.vy = b.vy + (ay + b.py / r * impact * 100) * dt;
      next.vz = b.vz + (az + b.pz / r * impact * 100) * dt;
      const cap = Math.min(1, 30 / Math.max(0.001, Math.hypot(next.vx, next.vy, next.vz)));
      next.vx *= cap; next.vy *= cap; next.vz *= cap;
      next.px = wrap(b.px + next.vx * dt, -35, 35);
      next.py = wrap(b.py + next.vy * dt, -20, 20);
      next.pz = wrap(b.pz + next.vz * dt, -35, 35);
    }
  }
}
