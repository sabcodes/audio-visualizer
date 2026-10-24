import { expect, it } from 'vitest';
import { Line, Mesh, Group } from 'three/webgpu';
import { createLineMode } from '../../src/modes/lineModes';
import { createSpatialMode } from '../../src/modes/spatialModes';
import { glitchAmounts } from '../../src/modes/filterModes';
import type { ModeFrame } from '../../src/modes/types';
const frame = (): ModeFrame => ({ time: 2, delta: 1 / 60, aspect: 16 / 9,
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
