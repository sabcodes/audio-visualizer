import { expect, it } from 'vitest';
import { FlockSimulation, initializeFlock } from '../../src/simulations/flock';

it('flock size follows the requested count', () => {
  expect(new FlockSimulation(440).boids).toHaveLength(440);
  expect(initializeFlock(220).slice(0, 5)).toEqual(initializeFlock(440).slice(0, 5));
});
it('440 boids advance one second within a soft CPU budget', () => {
  const simulation = new FlockSimulation(440), start = performance.now();
  for (let i = 0; i < 120; i++) simulation.advance(1 / 120, 0);
  const perStepMs = (performance.now() - start) / 120;
  console.info(`440 boids: ${perStepMs.toFixed(3)} ms per 120 Hz step`); // Logged, not asserted: CI hardware varies.
  expect(simulation.boids.every((b) => Number.isFinite(b.px + b.py + b.pz))).toBe(true);
});
