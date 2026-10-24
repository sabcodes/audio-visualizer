import { describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Scene } from 'three/webgpu';
import { ModeRegistry, modeDefinitions, legacyModeDefinitions, type ModeDefinition } from '../../src/modes/registry';

function definition(id: string): ModeDefinition {
  return { id, label: id, output: 'scene', backends: ['webgpu', 'webgl2'], create: vi.fn(() => ({ scene: new Scene(), camera: new PerspectiveCamera(), update: vi.fn(), dispose: vi.fn() })) };
}
describe('mode ownership', () => {
  it('registers all 18 legacy modes exactly once alongside labeled probes', () => {
    expect(legacyModeDefinitions.map((mode) => mode.id)).toEqual(['circle', 'spiral', 'star', 'cube', 'particles', 'errors', 'lissajous', 'boids', 'fftTunnel', 'kaleidoPlane', 'city', 'glitchRing', 'vjRings', 'neonKaleido', 'starTunnel', 'bloomTunnel', 'glitchFX', 'godrays']);
    expect(new Set(modeDefinitions.map((mode) => mode.id)).size).toBe(modeDefinitions.length);
    expect(() => new ModeRegistry([definition('a'), definition('a')])).toThrow('Duplicate');
  });
  it('allocates lazily and disposes the prior mode exactly once', () => {
    const a = definition('a'); const b = definition('b');
    const registry = new ModeRegistry([a, b]);
    expect(a.create).not.toHaveBeenCalled();
    const first = registry.select('a', 'webgpu');
    registry.select('b', 'webgpu');
    expect(first.dispose).toHaveBeenCalledTimes(1);
    registry.clear(); registry.clear();
    expect(first.dispose).toHaveBeenCalledTimes(1);
  });
  it('rejects unknown or unsupported modes without replacing the active one', () => {
    const gl = { ...definition('gl'), backends: ['webgl2'] as const };
    const registry = new ModeRegistry([definition('a'), gl]);
    const first = registry.select('a', 'webgpu');
    expect(() => registry.select('missing', 'webgpu')).toThrow('Unknown');
    expect(() => registry.select('gl', 'webgpu')).toThrow('unavailable');
    expect(first.dispose).not.toHaveBeenCalled();
  });
  it('creates fresh cameras on switching back rather than sharing mutated state', () => {
    const registry = new ModeRegistry();
    const first = registry.select('scene', 'webgl2');
    first.camera.position.set(1, 2, 3);
    registry.select('rings', 'webgl2');
    const next = registry.select('scene', 'webgl2');
    expect(next.camera).not.toBe(first.camera);
    expect(next.camera.position.z).toBe(85);
    registry.clear();
  });
});
