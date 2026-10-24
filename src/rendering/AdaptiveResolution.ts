import { summarizeIntervals } from './diagnostics';

export interface AdaptiveResolutionOptions {
  budgetMs?: number;
  steps?: readonly number[];
  windowSize?: number;
  downRatio?: number;
  upRatio?: number;
  upWindows?: number;
  cooldownMs?: number;
  warmupMs?: number;
}

/** Ignore hidden-tab gaps and one-time shader compiles; they say nothing about steady-state cost. */
const OUTLIER_MS = 250;

/**
 * Render-scale controller. Frame intervals are vsync-quantised, so "fast" can't mean "under budget":
 * a window counts as slow only when intervals miss the budget AND the measured frame cost (CPU + GPU,
 * when known) is high; a window within budget counts as good. After enough good windows it probes one
 * level up; a probe followed by a slow window steps back down and doubles the wait before the next probe.
 * It holds still during warmup, cooldown, or a manual lock.
 */
export class AdaptiveResolution {
  budgetMs: number;
  private readonly steps: readonly number[];
  private readonly windowSize: number;
  private readonly downRatio: number;
  private readonly upRatio: number;
  private readonly upWindows: number;
  private readonly cooldownMs: number;
  private readonly warmupMs: number;
  private index: number;
  private window: number[] = [];
  private costs: number[] = [];
  private probing = false;
  private backoff = 1;
  private goodWindows = 0;
  private holdUntil = 0;
  private locked: number | null = null;

  constructor(options: AdaptiveResolutionOptions = {}) {
    this.budgetMs = options.budgetMs ?? 1000 / 60;
    this.steps = options.steps ?? [0.5, 0.625, 0.75, 0.875, 1];
    this.windowSize = options.windowSize ?? 120;
    this.downRatio = options.downRatio ?? 1.1;
    this.upRatio = options.upRatio ?? 0.75;
    this.upWindows = options.upWindows ?? 3;
    this.cooldownMs = options.cooldownMs ?? 2000;
    this.warmupMs = options.warmupMs ?? 5000;
    this.index = this.steps.length - 1;
  }

  get scale(): number {
    return this.locked ?? this.steps[this.index];
  }

  /** True while warmup or cooldown holds the scale still. */
  isHolding(now: number): boolean {
    return now < this.holdUntil;
  }

  get isLocked(): boolean {
    return this.locked !== null;
  }

  /**
   * Returns the new scale when it changes, otherwise null. `costMs` is the frame's measured work
   * (CPU submit + GPU time); omit it when GPU time is unavailable and intervals alone decide.
   */
  sample(intervalMs: number, now: number, costMs?: number | null): number | null {
    if (this.locked !== null || now < this.holdUntil) return null;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > OUTLIER_MS) return null;
    this.window.push(intervalMs);
    if (costMs != null && Number.isFinite(costMs) && costMs >= 0) this.costs.push(costMs);
    if (this.window.length < this.windowSize) return null;
    const { p95Ms } = summarizeIntervals(this.window);
    const cost = this.costs.length ? summarizeIntervals(this.costs).medianMs : null;
    this.window = []; this.costs = [];
    const slow = p95Ms > this.budgetMs * this.downRatio && (cost === null || cost > this.budgetMs * this.upRatio);
    if (slow) {
      this.goodWindows = 0;
      if (this.probing) { this.backoff *= 2; this.probing = false; }
      return this.index > 0 ? this.step(-1, now) : null;
    }
    if (this.probing) { this.probing = false; this.backoff = 1; }
    if (++this.goodWindows >= this.upWindows * this.backoff && this.index < this.steps.length - 1) {
      this.probing = true;
      return this.step(1, now);
    }
    return null;
  }

  /** Discards the current window and starts a warmup, e.g. after a mode switch or visibility change. */
  reset(now: number): void {
    this.window = []; this.costs = [];
    this.goodWindows = 0;
    this.holdUntil = now + this.warmupMs;
  }

  /** Pins a scale; null returns to Auto from the last automatic level. */
  lock(scale: number | null): void {
    this.locked = scale;
    this.window = []; this.costs = [];
    this.goodWindows = 0;
  }

  private step(direction: 1 | -1, now: number): number {
    this.index += direction;
    this.goodWindows = 0;
    this.holdUntil = now + this.cooldownMs;
    return this.steps[this.index];
  }
}
