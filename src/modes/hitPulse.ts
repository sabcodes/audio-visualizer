import type { ModeFrame } from './types';
import { settleStep } from './shared';
import { seededRandom } from '../rendering/diagnostics';

/** Picks variants from a seeded sequence, never the same one twice in a row. */
export function variantSequence(count: number, seed = 1) {
  const random = seededRandom(seed);
  let current = 0;
  return {
    get current() { return current; },
    next() {
      current = count < 2 ? 0 : (current + 1 + Math.floor(random() * (count - 1))) % count;
      return current;
    },
  };
}

export interface HitOptions {
  /** Seconds for the flash to fall to 1/e. */
  decay: number;
  /** Shortest gap between hits; reduced flash raises it to a third of a second. */
  interval?: number;
  /** Number of hit variants to cycle through (0 for none). */
  variants?: number;
  seed?: number;
}

/**
 * The wave 4 pacing rule: audio fires an on/off trigger with a one-frame attack and a short exponential
 * decay, and each hit steps to the next picture variant. Reduced flash caps hits at three a second,
 * cuts the brightness jump to 40% and raises the dark floor.
 */
export function createHits({ decay, interval = 0.2, variants = 0, seed = 1 }: HitOptions) {
  const sequence = variantSequence(Math.max(1, variants), seed);
  let last = -Infinity, previousImpact = 0;
  const state = {
    /** Raw envelope, 1 on the hit frame and decaying. */
    level: 0,
    /** Brightness to add on top of the floor, already limited for reduced flash. */
    flash: 0,
    /** Dark floor between hits. */
    floor: 0.05,
    fired: false,
    variant: 0,
    count: 0,
    /** Seconds since the last hit. */
    age: Infinity,
    update(frame: ModeFrame, floor = 0.05) {
      const step = settleStep(frame), gap = frame.reducedFlash ? Math.max(interval, 1 / 3) : interval;
      if (frame.time < last) last = -Infinity; // Seek or track change: re-arm.
      // Onsets drive it; a sharp jump in impact (a hit the onset detector missed) also counts.
      const trigger = frame.audio.onset || frame.response.impact - previousImpact > 0.3;
      previousImpact = frame.response.impact;
      state.fired = trigger && frame.time - last >= gap;
      if (state.fired) {
        last = frame.time; state.level = 1; state.age = 0; state.count++;
        if (variants > 1) state.variant = sequence.next();
      } else {
        state.age += step;
        state.level *= Math.exp(-step / decay);
      }
      state.floor = frame.reducedFlash ? Math.max(floor * 2, 0.12) : floor;
      state.flash = state.level * (frame.reducedFlash ? 0.4 : 1);
      return state;
    },
    /** Floor plus flash, the overall brightness multiplier for a gated mode. */
    get gain() { return state.floor + (1 - state.floor) * state.flash; },
  };
  return state;
}
export type Hits = ReturnType<typeof createHits>;

/** Hex colour to linear RGB triple, for palettes written in sRGB as the spec gives them. */
export function linearRgb(hex: number): [number, number, number] {
  const channel = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return [channel((hex >> 16) & 255), channel((hex >> 8) & 255), channel(hex & 255)];
}
