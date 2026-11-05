import { expect, it, vi } from 'vitest';
import { Mesh, RenderTarget } from 'three/webgpu';
import { ModeRegistry } from '../../src/modes/registry';
import { presetBudget } from '../../src/rendering/quality';
import { SnapshotTransition, snapshotSize } from '../../src/rendering/SnapshotTransition';
import { volumetricBudget } from '../../src/modes/volumetricMode';
import { createGpuFlockMode, flockBudget } from '../../src/modes/gpuFlockMode';

it('bounds native flock density and neighbors, with a portable CPU fallback', () => {
  expect((['compatibility', 'balanced', 'high', 'ultra'] as const).map(preset => flockBudget(presetBudget(preset)))).toEqual([
    { count: 110, neighbors: 0 }, { count: 1024, neighbors: 32 }, { count: 2048, neighbors: 48 }, { count: 4096, neighbors: 64 },
  ]);
  for (const backend of ['webgpu', 'webgl2'] as const) {
    const mode = new ModeRegistry().create('boids', backend, presetBudget('balanced'));
    expect(Boolean(mode.scene.getObjectByName('gpu-flock'))).toBe(backend === 'webgpu');
    mode.dispose();
  }
});

it('runs a fixed 120 Hz GPU step and freezes without dispatch under reduced motion', () => {
  const mode = createGpuFlockMode(presetBudget('balanced'));
  const renderer = { compute: vi.fn() };
  const frame = { delta: 1 / 60, reducedMotion: false, reducedFlash: true, response: { impact: 0, bounce: 0 }, aspect: 1, hue: 0 } as import('../../src/modes/types').ModeFrame;
  mode.update(frame); mode.simulate!(renderer as unknown as import('three/webgpu').WebGPURenderer);
  expect(renderer.compute).toHaveBeenCalledTimes(2);
  expect(renderer.compute.mock.calls[0][0]).not.toBe(renderer.compute.mock.calls[1][0]);
  renderer.compute.mockClear(); mode.update({ ...frame, reducedMotion: true }); mode.simulate!(renderer as unknown as import('three/webgpu').WebGPURenderer);
  expect(renderer.compute).not.toHaveBeenCalled(); mode.dispose();
});

it('bounds volumetric sample counts and renders below output resolution', () => {
  const settings = (['compatibility', 'balanced', 'high', 'ultra'] as const).map(preset => volumetricBudget(presetBudget(preset)));
  expect(settings.map(setting => setting.samples)).toEqual([0, 24, 40, 64]);
  expect(settings.slice(1).every(setting => setting.scale > 0 && setting.scale < 1)).toBe(true);
});

it('uses scattering only on native WebGPU with a non-compatibility preset', () => {
  const registry = new ModeRegistry();
  for (const [backend, preset, volumetric] of [['webgpu', 'balanced', true], ['webgpu', 'high', true], ['webgpu', 'compatibility', false], ['webgl2', 'high', false]] as const) {
    const mode = registry.create('godrays', backend, presetBudget(preset));
    const volume = mode.scene.getObjectByName('raymarched-light-shafts') as Mesh | undefined;
    expect(Boolean(volume)).toBe(volumetric);
    if (volumetric) {
      expect(volume!.userData.samples).toBe(volumetricBudget(presetBudget(preset)).samples);
      const dispose = vi.spyOn(volume!.geometry, 'dispose');
      mode.dispose(); expect(dispose).toHaveBeenCalledOnce();
    } else mode.dispose();
  }
});

it('caps snapshots at 1080p, preserves aspect and never enlarges a small output', () => {
  expect(snapshotSize(7680, 4320)).toEqual({ width: 1920, height: 1080 });
  expect(snapshotSize(1080, 1920)).toEqual({ width: 608, height: 1080 });
  expect(snapshotSize(640, 360)).toEqual({ width: 640, height: 360 });
});

it('does not leave a snapshot framebuffer bound when outgoing rendering fails', async () => {
  const transition = new SnapshotTransition();
  const previous = new RenderTarget(2, 2);
  let current = previous;
  const renderer = {
    compileAsync: vi.fn(async () => {}),
    getRenderTarget: () => current,
    setRenderTarget: (target: RenderTarget) => { current = target; },
  };
  // This renderer seam only exercises target ownership, without initializing a physical GPU.
  await transition.prepare(renderer as unknown as import('three/webgpu').WebGPURenderer);
  expect(() => transition.capture(renderer as unknown as import('three/webgpu').WebGPURenderer, 4000, 3000, () => { throw new Error('render failed'); })).toThrow('render failed');
  expect(current).toBe(previous);
  expect(transition.active).toBe(false);
  transition.dispose(); previous.dispose();
});
