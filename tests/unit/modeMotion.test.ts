import { expect, it } from 'vitest';
import { Line, Mesh, Group, MeshBasicMaterial, InstancedMesh } from 'three/webgpu';
import { createSpectrumTexture } from '../../src/modes/shared';
import { createLineMode } from '../../src/modes/lineModes';
import { createSpatialMode } from '../../src/modes/spatialModes';
import { StarTunnelSimulation } from '../../src/simulations/starTunnel';
import { glitchAmounts } from '../../src/modes/filterModes';
import type { ModeFrame } from '../../src/modes/types';
const frame = (): ModeFrame => ({ time: 2, delta: 1 / 60, aspect: 16 / 9, spectrumMapping: 'linear', sampleRate: 48000,
  hue: 0.3, reducedMotion: false, reducedFlash: true,
  response: { bass: 0, loudness: 0, impact: 0, bounce: 0 },
  audio: { waveform: new Float32Array(1024), spectrum: new Uint8Array(512), bass: 0, mid: 0, highs: 0, rms: 0, onset: false, time: 2 },
});
it('circle uses signed waveform displacement and added bounce rather than unsigned spectrum', () => {
  const mode = createLineMode('circle'), f = frame();
  const positions = (mode.scene.children[0] as Line).geometry.attributes.position;
  mode.update(f); expect(positions.getX(0)).toBeCloseTo(20); expect(positions.getY(0)).toBe(0);
  f.audio.waveform[0] = -0.5; mode.update(f); expect(positions.getY(0)).toBeCloseTo(-12.8);
  f.response = { ...f.response, bounce: 1 }; mode.update(f); expect(positions.getX(0)).toBeGreaterThan(25);
  mode.dispose();
});
it('bloom tunnel translates and rotates equally at 30 and 120 Hz', () => {
  const runs = [30, 120].map((hz) => {
    const mode = createSpatialMode('bloomTunnel'), f = frame();
    f.delta = 1 / hz;
    for (let i = 0; i < hz; i++) mode.update(f);
    const torus = (mode.scene.children[0] as Group).children[0] as Mesh;
    const result = { z: torus.position.z, rotation: torus.rotation.z };
    mode.dispose(); return result;
  });
  expect(runs[0].z).toBeCloseTo(runs[1].z, 8);
  expect(runs[0].rotation).toBeCloseTo(runs[1].rotation, 8);
});
it('reduced flash keeps cone brightness independent of impact while geometry still reacts', () => {
  const mode = createSpatialMode('godrays'), f = frame(); mode.update(f);
  const cone = (mode.scene.children[0] as Group).children[0] as Mesh;
  const before = cone.scale.y;
  f.response = { ...f.response, bounce: 1 }; mode.update(f);
  expect(cone.scale.y).toBeGreaterThan(before);
  expect(Array.isArray(cone.material) ? 0 : cone.material.opacity).toBe(0.18);
  mode.dispose();
});
it('glitch FX keeps the legacy RGB shift in silence and gates bursts behind reduced flash', () => {
  const f = frame();
  expect(glitchAmounts(f)).toEqual({ shift: 0.0015, burst: 0 });
  f.reducedFlash = false;
  const times = Array.from({ length: 600 }, (_, i) => i / 60);
  expect(times.some((time) => glitchAmounts({ ...f, time }).burst > 0)).toBe(true);
  expect(glitchAmounts({ ...f, response: { ...f.response, impact: 1 }, reducedFlash: true }).shift).toBeLessThanOrEqual(0.003);
});
it('city writes its 784 instance matrices once, then animates from the spectrum on the GPU', () => {
  const mode = createSpatialMode('city'), f = frame();
  const city = mode.scene.children.find((child) => child instanceof InstancedMesh) as InstancedMesh;
  const before = city.instanceMatrix.version;
  f.audio.spectrum.fill(200);
  for (let i = 0; i < 3; i++) mode.update(f);
  expect(city.instanceMatrix.version).toBe(before);
  mode.dispose();
});
it('spectrum texture copies each frame and bumps its version once per update', () => {
  const spectrum = createSpectrumTexture();
  const before = spectrum.texture.version;
  const data = new Uint8Array(512).fill(7);
  for (let i = 0; i < 3; i++) spectrum.update(data);
  expect(spectrum.texture.version).toBe(before + 3);
  expect((spectrum.texture.image.data as Uint8Array)[511]).toBe(7);
  spectrum.dispose();
});
it('star tunnel spring stays bounded and frame-rate independent', () => {
  const run = (hz: number) => {
    const simulation = new StarTunnelSimulation();
    const f = frame(); f.delta = 1 / hz;
    for (let i = 0; i < hz * 2; i++) { f.time = i / hz; f.audio = { ...f.audio, onset: i === 0 }; simulation.advance(f); }
    return Float32Array.from(simulation.offsets);
  };
  const slow = run(30), fast = run(120);
  expect(Math.min(...fast)).toBeGreaterThanOrEqual(-18);
  expect(Math.max(...fast)).toBeLessThanOrEqual(40);
  expect(Math.max(...fast.map((v) => Math.abs(v)))).toBeGreaterThan(0);
  slow.forEach((value, i) => expect(value).toBeCloseTo(fast[i], 6));
});
it('bloom tunnel shimmer matches the legacy rate (ms clock → seconds × 4)', () => {
  const lightness = (time: number) => {
    const mode = createSpatialMode('bloomTunnel'), f = frame();
    f.time = time; f.delta = 0; mode.update(f);
    const torus = (mode.scene.children[0] as Group).children[0] as Mesh;
    const hsl = { h: 0, s: 0, l: 0 };
    ((Array.isArray(torus.material) ? torus.material[0] : torus.material) as MeshBasicMaterial).color.getHSL(hsl);
    mode.dispose(); return hsl.l;
  };
  expect(lightness(0)).toBeCloseTo(0.6, 6);
  expect(lightness(Math.PI / 8)).toBeCloseTo(1, 6);
});
it('fft tunnel reads log-spaced bins when spectrum mapping is log', () => {
  const radiusAtMidpoint = (mapping: 'linear' | 'log') => {
    const mode = createLineMode('fftTunnel'), f = { ...frame(), spectrumMapping: mapping, sampleRate: 48000 };
    f.audio.spectrum[14] = 255; // ≈ 690 Hz, where u = 0.5 lands on a 30 Hz–16 kHz log axis
    mode.update(f);
    const positions = (mode.scene.children[0] as Line).geometry.attributes.position;
    const radius = Math.hypot(positions.getX(64), positions.getY(64)); mode.dispose(); return radius;
  };
  expect(radiusAtMidpoint('log')).toBeGreaterThan(radiusAtMidpoint('linear') * 1.3);
});
