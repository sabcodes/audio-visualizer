import { wrap } from '../modes/shared';
import type { ModeFrame } from '../modes/types';

export const STAR_RINGS = 40;
export const STARS_PER_RING = 44;
const DEPTH = 1400;

/** CPU state behind the star tunnel: 120 Hz spring offsets per star plus per-ring (z, rotation, pulse, hue). */
export class StarTunnelSimulation {
  readonly count = STAR_RINGS * STARS_PER_RING;
  readonly offsets = new Float32Array(this.count);
  readonly ringState = new Float32Array(STAR_RINGS * 4);
  private readonly velocities = new Float32Array(this.count);
  private readonly z = Float32Array.from({ length: STAR_RINGS }, (_, i) => -i * (DEPTH / STAR_RINGS));
  private readonly rotation = new Float32Array(STAR_RINGS);
  private readonly pulses: { z: number; amplitude: number }[] = [];
  private accumulator = 0;
  private lastOnsetTime = -Infinity;

  advance(frame: Pick<ModeFrame, 'delta' | 'time' | 'hue' | 'audio' | 'response'>) {
    const dt = Math.max(0, Math.min(0.05, frame.delta));
    if (frame.audio.onset && dt > 0 && frame.time - this.lastOnsetTime > 0.18) {
      this.lastOnsetTime = frame.time;
      this.pulses.push({ z: -DEPTH + 80, amplitude: 1 }); if (this.pulses.length > 8) this.pulses.shift();
      for (let i = 0; i < this.count; i += 7) this.velocities[i] += 40 + frame.response.impact * 60;
    }
    const forward = (200 + 700 * frame.response.bass) * dt;
    for (const pulse of this.pulses) { pulse.z += forward * 1.7; pulse.amplitude *= Math.exp(-dt * 0.5); }
    for (let i = this.pulses.length - 1; i >= 0; i--) if (this.pulses[i].z > 80 || this.pulses[i].amplitude < 0.05) this.pulses.splice(i, 1);
    this.accumulator += dt;
    const { offsets, velocities } = this;
    while (this.accumulator + 1e-10 >= 1 / 120) {
      for (let i = 0; i < this.count; i++) {
        velocities[i] += -offsets[i] * 65 / 120; velocities[i] *= Math.exp(-5 / 120);
        offsets[i] = Math.max(-18, Math.min(40, offsets[i] + velocities[i] / 120));
      }
      this.accumulator = Math.max(0, this.accumulator - 1 / 120);
    }
    for (let r = 0; r < STAR_RINGS; r++) {
      this.z[r] = wrap(this.z[r] + forward, -DEPTH, 40);
      this.rotation[r] += dt * (0.15 + frame.audio.mid * 2);
      let pulse = 0;
      for (const wave of this.pulses) pulse += wave.amplitude * Math.exp(-(((this.z[r] - wave.z) / 110) ** 2) / 2);
      const o = r * 4;
      this.ringState[o] = this.z[r]; this.ringState[o + 1] = this.rotation[r];
      this.ringState[o + 2] = pulse; this.ringState[o + 3] = wrap(frame.hue + r * 0.01, 0, 1);
    }
  }
}
