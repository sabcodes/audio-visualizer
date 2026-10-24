/**
 * Pure diagnostics for frame timing analysis and utilities.
 * Stage 0 capability support: frame interval statistics, deterministic randomness, delta clamping.
 */

/**
 * Frame timing statistics: count, median, p95, p99 percentiles, and missed-frame count.
 * Missed-frame threshold: 1.1 × the refresh budget (18.33 ms at 60 Hz, 9.17 ms at 120 Hz).
 */
export interface FrameTimingStats {
  count: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  missedFrames: number;
}

/**
 * Summarize frame intervals into statistics.
 * Filters to positive finite values only, calculates nearest-rank percentiles, and counts frames exceeding 60 Hz threshold.
 * 
 * @param samplesMs Array of frame interval measurements in milliseconds
 * @param refreshHz Refresh rate the missed-frame budget is measured against
 * @returns Frame timing statistics with positive filtering and nearest-rank quantiles
 */
export function summarizeIntervals(samplesMs: number[], refreshHz = 60): FrameTimingStats {
  // Filter to positive finite values only (invalid intervals excluded)
  const finite = samplesMs.filter((v) => Number.isFinite(v) && v > 0);

  if (finite.length === 0) {
    return {
      count: 0,
      medianMs: 0,
      p95Ms: 0,
      p99Ms: 0,
      missedFrames: 0,
    };
  }

  // Sort for percentile calculation
  const sorted = [...finite].sort((a, b) => a - b);

  // Calculate nearest-rank percentiles
  const getPercentile = (p: number): number => {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  };

  const medianMs = getPercentile(50);
  const p95Ms = getPercentile(95);
  const p99Ms = getPercentile(99);

  // Count missed frames: 1.1 × the refresh budget
  const thresholdMs = (1.1 * 1000) / refreshHz;
  const missedFrames = finite.filter((v) => v > thresholdMs).length;

  return {
    count: finite.length,
    medianMs,
    p95Ms,
    p99Ms,
    missedFrames,
  };
}

/**
 * Create a deterministic seeded random number generator.
 * Uses linear congruential generator (LCG) with normalized uint32 seed and Math.imul for precision.
 * Returns a function that generates deterministic random values in [0, 1).
 * 
 * @param seed Initial seed value (normalized to uint32)
 * @returns Function that generates deterministic random numbers
 */
export function seededRandom(seed: number): () => number {
  // Normalize seed to uint32 to avoid negative NaN precision bugs
  let current = (seed >>> 0);

  return () => {
    // LCG: next = (a * current + c) >>> 0, using Math.imul for precision
    current = (Math.imul(1664525, current) + 1013904223) >>> 0;
    // Normalize to [0, 1) using 2**32 divisor
    return current / 4294967296;
  };
}

/**
 * Clamp a delta time value to a safe range [0, 0.05].
 * Ensures finite clamped values for simulation timesteps.
 * 
 * @param seconds Delta time in seconds
 * @returns Clamped delta time between 0 and 0.05 seconds
 */
export function clampDelta(seconds: number): number {
  // Ensure finite value, then clamp to [0, 0.05]
  if (!Number.isFinite(seconds)) {
    return 0;
  }
  return Math.max(0, Math.min(seconds, 0.05));
}
