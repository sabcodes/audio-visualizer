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
 * Render-scale controller: steps down one level on a slow full window, steps up only after
 * several consecutive fast windows, and holds still during warmup, cooldown, or a manual lock.
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

  get isLocked(): boolean {
    return this.locked !== null;
  }

  /** Returns the new scale when it changes, otherwise null. */
  sample(intervalMs: number, now: number): number | null {
    if (this.locked !== null || now < this.holdUntil) return null;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > OUTLIER_MS) return null;
    this.window.push(intervalMs);
    if (this.window.length < this.windowSize) return null;
    const { p95Ms } = summarizeIntervals(this.window);
    this.window = [];
    if (p95Ms > this.budgetMs * this.downRatio) {
      this.goodWindows = 0;
      return this.index > 0 ? this.step(-1, now) : null;
    }
    if (p95Ms < this.budgetMs * this.upRatio) {
      if (++this.goodWindows >= this.upWindows && this.index < this.steps.length - 1) return this.step(1, now);
      return null;
    }
    this.goodWindows = 0;
    return null;
  }

  /** Discards the current window and starts a warmup, e.g. after a mode switch or visibility change. */
  reset(now: number): void {
    this.window = [];
    this.goodWindows = 0;
    this.holdUntil = now + this.warmupMs;
  }

  /** Pins a scale; null returns to Auto from the last automatic level. */
  lock(scale: number | null): void {
    this.locked = scale;
    this.window = [];
    this.goodWindows = 0;
  }

  private step(direction: 1 | -1, now: number): number {
    this.index += direction;
    this.goodWindows = 0;
    this.holdUntil = now + this.cooldownMs;
    return this.steps[this.index];
  }
}
