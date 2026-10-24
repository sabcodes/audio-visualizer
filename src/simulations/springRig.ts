const STEP = 1 / 240;

/** Damped springs on a flat array of joint angles, stepped at a fixed 240 Hz so the motion is the same at any frame rate. */
export class SpringRig {
  readonly values: Float32Array;
  readonly targets: Float32Array;
  private readonly velocities: Float32Array;
  private carry = 0;
  constructor(size: number, private readonly stiffness = 140, private readonly damping = 13) {
    this.values = new Float32Array(size); this.targets = new Float32Array(size); this.velocities = new Float32Array(size);
  }
  /** Adds an instantaneous velocity kick (e.g. a beat pop) to one channel. */
  kick(index: number, velocity: number) { this.velocities[index] += velocity; }
  advance(delta: number) {
    // Cap a stalled frame so springs don't integrate a multi-second jump.
    this.carry += Number.isFinite(delta) ? Math.min(Math.max(delta, 0), 0.25) : 0;
    while (this.carry >= STEP - 1e-9) {
      this.carry -= STEP;
      for (let i = 0; i < this.values.length; i++) {
        this.velocities[i] += (this.stiffness * (this.targets[i] - this.values[i]) - this.damping * this.velocities[i]) * STEP;
        this.values[i] += this.velocities[i] * STEP;
      }
    }
  }
}
