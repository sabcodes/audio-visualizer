import { describe, expect, it } from 'vitest';
import { ResponseEnvelope } from '../../src/audio/VisualResponse';
import type { AudioFrame } from '../../src/audio/AudioEngine';
import { FlockSimulation } from '../../src/simulations/flock';
const frame = (bass = 0, rms = 0): AudioFrame => ({ bass, rms, mid: 0, highs: 0, onset: false, time: 0, waveform: new Float32Array(1024), spectrum: new Uint8Array(512) });
describe('expressive visual response', () => {
  it('is silent at startup, including invalid scalar inputs', () => {
    const response = new ResponseEnvelope(); expect(response.update(frame(), 1 / 60).bounce).toBe(0);
    expect(response.update(frame(NaN, Infinity), NaN).bounce).toBe(0);
  });
  it('hits harder with sensitivity and clamps runaway inputs', () => {
    const quiet = new ResponseEnvelope().update(frame(0.1, 0.03), 1 / 60, 0.5).bounce;
    const strong = new ResponseEnvelope().update(frame(0.1, 0.03), 1 / 60, 2).bounce;
    expect(strong).toBeGreaterThan(quiet * 2);
    expect(new ResponseEnvelope().update(frame(100, 100), 1 / 60, 100).bounce).toBeLessThanOrEqual(1.4);
  });
  it('decays hit impulses during sustained bass instead of sticking at maximum', () => {
    const envelope = new ResponseEnvelope(), input = frame(0.9, 0.4);
    const initial = envelope.update(input, 1 / 60).bounce;
    for (let i = 0; i < 120; i++) { input.time += 1 / 60; envelope.update(input, 1 / 60); }
    const settled = envelope.update(input, 1 / 60);
    expect(settled.bounce).toBeLessThan(initial * 0.6); expect(settled.impact).toBeLessThan(0.001);
  });
  it('responds to loudness and reduces displacement with reduced motion', () => {
    const normal = new ResponseEnvelope().update(frame(0.3, 0.2), 1 / 60, 1.8).bounce;
    const reduced = new ResponseEnvelope().update(frame(0.3, 0.2), 1 / 60, 1.8, true).bounce;
    expect(reduced).toBeCloseTo(normal * 0.2);
    expect(new ResponseEnvelope().update(frame(0, 0.2), 1 / 60).bounce).toBeGreaterThan(0);
  });
  it('clears state at silence without stale hits on pause', () => {
    const envelope = new ResponseEnvelope(); envelope.update(frame(1, 0.5), 1 / 60);
    expect(envelope.update(frame(), 1 / 60)).toEqual({ bass: 0, loudness: 0, impact: 0, bounce: 0 });
  });
});
describe('fixed-step flock parity', () => {
  it('has equivalent one-second state at 30, 60, and 120 Hz', () => {
    const runs = [30, 60, 120].map((hz) => { const flock = new FlockSimulation(); for (let i = 0; i < hz; i++) flock.advance(1 / hz, 0.5); return flock.boids; });
    expect(runs[0]).toEqual(runs[1]); expect(runs[1]).toEqual(runs[2]);
  });
  it('freezes at zero delta and stays finite and bounded through bursts', () => {
    const flock = new FlockSimulation(), before = structuredClone(flock.boids);
    flock.advance(0, 1); expect(flock.boids).toEqual(before);
    for (let i = 0; i < 200; i++) flock.advance(0.05, 1);
    for (const b of flock.boids) { expect(Object.values(b).every(Number.isFinite)).toBe(true); expect(Math.abs(b.px)).toBeLessThanOrEqual(35); expect(Math.abs(b.py)).toBeLessThanOrEqual(20); }
  });
});
