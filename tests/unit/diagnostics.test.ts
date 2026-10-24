/**
 * Tests for diagnostics module: frame timing analysis and utilities.
 * Covers: percentile calculation, finite filtering, clamping, deterministic randomness.
 */

import { describe, it, expect } from "vitest";
import { summarizeIntervals, seededRandom, clampDelta } from "../../src/rendering/diagnostics";

describe("diagnostics", () => {
  describe("summarizeIntervals", () => {
    it("handles empty array", () => {
      const result = summarizeIntervals([]);
      expect(result).toEqual({
        count: 0,
        medianMs: 0,
        p95Ms: 0,
        p99Ms: 0,
        missedFrames: 0,
      });
    });

    it("filters non-finite values", () => {
      const samples = [16.7, Infinity, 16.8, NaN, 16.6, -Infinity];
      const result = summarizeIntervals(samples);
      expect(result.count).toBe(3); // Only [16.7, 16.8, 16.6]
    });

    it("filters nonpositive values (invalid intervals)", () => {
      const samples = [16.7, 0, -5, 16.8, 16.6];
      const result = summarizeIntervals(samples);
      expect(result.count).toBe(3); // Only [16.7, 16.8, 16.6]
      expect(result.medianMs).toBe(16.7);
    });

    it("calculates median for odd count", () => {
      const samples = [10, 15, 20];
      const result = summarizeIntervals(samples);
      expect(result.medianMs).toBe(15);
    });

    it("calculates median for even count", () => {
      const samples = [10, 20, 30, 40];
      const result = summarizeIntervals(samples);
      // Nearest rank: ceil(0.5 * 4) - 1 = 1, so index 1 = 20.
      expect(result.medianMs).toBe(20);
    });

    it("calculates p95 percentile", () => {
      // Create 100 samples from 1 to 100
      const samples = Array.from({ length: 100 }, (_, i) => i + 1);
      const result = summarizeIntervals(samples);
      // p95: ceil((95/100)*100) - 1 = 95 - 1 = 94, so index 94 = 95
      expect(result.p95Ms).toBe(95);
    });

    it("calculates p99 percentile", () => {
      const samples = Array.from({ length: 100 }, (_, i) => i + 1);
      const result = summarizeIntervals(samples);
      // p99: ceil((99/100)*100) - 1 = 99 - 1 = 98, so index 98 = 99
      expect(result.p99Ms).toBe(99);
    });

    it("counts missed frames at 60 Hz threshold (18.33 ms)", () => {
      const threshold = (1.1 * 1000) / 60; // ~18.33 ms
      const samples = [16.7, 16.8, 18.0, 18.33, 19.0, 20.0];
      const result = summarizeIntervals(samples);
      // Frames > 18.33: [19.0, 20.0] = 2 missed frames
      expect(result.missedFrames).toBe(2);
    });

    it("handles single sample", () => {
      const samples = [16.7];
      const result = summarizeIntervals(samples);
      expect(result.count).toBe(1);
      expect(result.medianMs).toBe(16.7);
      expect(result.p95Ms).toBe(16.7);
      expect(result.p99Ms).toBe(16.7);
      expect(result.missedFrames).toBe(0);
    });

    it("handles all non-finite values", () => {
      const samples = [Infinity, NaN, -Infinity];
      const result = summarizeIntervals(samples);
      expect(result.count).toBe(0);
      expect(result.medianMs).toBe(0);
      expect(result.p95Ms).toBe(0);
      expect(result.p99Ms).toBe(0);
      expect(result.missedFrames).toBe(0);
    });

    it("correctly identifies no missed frames below threshold", () => {
      const threshold = (1.1 * 1000) / 60;
      const samples = [16.0, 16.5, 17.0, 17.5, 18.0, 18.3];
      const result = summarizeIntervals(samples);
      expect(result.missedFrames).toBe(0);
    });
  });

  describe("seededRandom", () => {
    it("returns deterministic values for same seed", () => {
      const rng1 = seededRandom(42);
      const values1 = Array.from({ length: 10 }, () => rng1());

      const rng2 = seededRandom(42);
      const values2 = Array.from({ length: 10 }, () => rng2());

      expect(values1).toEqual(values2);
    });

    it("returns different values for different seeds", () => {
      const rng1 = seededRandom(42);
      const values1 = Array.from({ length: 10 }, () => rng1());

      const rng2 = seededRandom(43);
      const values2 = Array.from({ length: 10 }, () => rng2());

      expect(values1).not.toEqual(values2);
    });

    it("produces values in range [0, 1)", () => {
      const rng = seededRandom(12345);
      for (let i = 0; i < 1000; i++) {
        const value = rng();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    });

    it("produces stable sequence across multiple calls", () => {
      const rng = seededRandom(999);
      const first5 = Array.from({ length: 5 }, () => rng());
      const next5 = Array.from({ length: 5 }, () => rng());

      // Create a fresh generator with same seed
      const rngFresh = seededRandom(999);
      const allFirst10 = Array.from({ length: 10 }, () => rngFresh());

      // Concatenated sequences should match
      expect([...first5, ...next5]).toEqual(allFirst10);
    });

    it("handles zero seed", () => {
      const rng = seededRandom(0);
      const values = Array.from({ length: 5 }, () => rng());
      expect(values.every((v) => Number.isFinite(v) && v >= 0 && v < 1)).toBe(true);
    });

    it("handles negative seed", () => {
      const rng = seededRandom(-42);
      const values = Array.from({ length: 5 }, () => rng());
      expect(values.every((v) => Number.isFinite(v) && v >= 0 && v < 1)).toBe(true);
    });

    it("handles nonfinite seed (Infinity normalized to uint32)", () => {
      const rng = seededRandom(Infinity);
      const values = Array.from({ length: 5 }, () => rng());
      expect(values.every((v) => Number.isFinite(v) && v >= 0 && v < 1)).toBe(true);
    });

    it("handles NaN seed (normalized to uint32 zero)", () => {
      const rng = seededRandom(NaN);
      const values = Array.from({ length: 5 }, () => rng());
      expect(values.every((v) => Number.isFinite(v) && v >= 0 && v < 1)).toBe(true);
    });

    it("large seed produces different sequence than small seed", () => {
      const rng1 = seededRandom(1);
      const vals1 = Array.from({ length: 5 }, () => rng1());

      const rng2 = seededRandom(999999999);
      const vals2 = Array.from({ length: 5 }, () => rng2());

      expect(vals1).not.toEqual(vals2);
    });

    it("handles large seed", () => {
      const rng = seededRandom(999999999);
      const values = Array.from({ length: 5 }, () => rng());
      expect(values.every((v) => Number.isFinite(v) && v >= 0 && v < 1)).toBe(true);
    });
  });

  describe("clampDelta", () => {
    it("returns 0 for negative values", () => {
      expect(clampDelta(-0.01)).toBe(0);
      expect(clampDelta(-1.0)).toBe(0);
    });

    it("returns value unchanged if within [0, 0.05]", () => {
      expect(clampDelta(0)).toBe(0);
      expect(clampDelta(0.025)).toBe(0.025);
      expect(clampDelta(0.05)).toBe(0.05);
    });

    it("clamps values exceeding 0.05", () => {
      expect(clampDelta(0.06)).toBe(0.05);
      expect(clampDelta(0.1)).toBe(0.05);
      expect(clampDelta(1.0)).toBe(0.05);
    });

    it("returns 0 for non-finite values", () => {
      expect(clampDelta(Infinity)).toBe(0);
      expect(clampDelta(-Infinity)).toBe(0);
      expect(clampDelta(NaN)).toBe(0);
    });

    it("handles very small positive values", () => {
      expect(clampDelta(0.0001)).toBe(0.0001);
    });

    it("handles boundary case at 0.05", () => {
      const val = 0.05;
      expect(clampDelta(val)).toBe(val);
      expect(clampDelta(val + Number.EPSILON)).toBe(0.05);
    });
  });
});
