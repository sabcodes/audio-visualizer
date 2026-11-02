import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { WATER7_SHOTS, createWater7Mode } from '../../src/modes/water7Mode';
import { presetBudget } from '../../src/rendering/quality';
import type { ModeFrame } from '../../src/modes/types';

const frame = (): ModeFrame => ({ time: 0, delta: 0.1, aspect: 16 / 9, spectrumMapping: 'linear', sampleRate: 48000,
  hue: 0, reducedMotion: false, reducedFlash: false, response: { bass: 0, loudness: 0, impact: 0, bounce: 0 },
  audio: { waveform: new Float32Array(1024), spectrum: new Uint8Array(512), bass: 0, mid: 0, highs: 0, rms: 0, onset: false, time: 0 },
});

describe('Water 7 / City of Water', () => {
  it('visits the full island, canals, fountain and surf in silence and disposes', () => {
    const mode = createWater7Mode(presetBudget('compatibility')), f = frame(), seen = new Set<string>();
    const duration = WATER7_SHOTS.reduce((n, s) => n + s.seconds, 0);
    for (let i = 0; i < (duration + 1) / f.delta; i++) {
      mode.update(f); seen.add(mode.scene.userData.shot);
      expect(mode.camera.position.toArray().every(Number.isFinite)).toBe(true);
      expect(mode.camera.quaternion.toArray().every(Number.isFinite)).toBe(true);
    }
    expect([...seen]).toEqual(WATER7_SHOTS.map(s => s.name));
    expect(new Set(WATER7_SHOTS.map(s => s.area))).toEqual(new Set(['island', 'surf', 'gateway', 'canals', 'landmarks', 'aqueducts', 'fountain', 'harbor']));
    mode.dispose(); expect(mode.scene.children).toHaveLength(0);
  });
  it('responds to bass and onset edges, caps reduced flashes and freezes the water with reduced motion', () => {
    const mode = createWater7Mode(presetBudget('compatibility')), f = frame();
    for (let i = 0; i < 10; i++) mode.update(f);
    f.response = { bass: 1, loudness: 1, impact: 1, bounce: 1 }; f.audio = { ...f.audio, onset: true, mid: 1, highs: 1 };
    mode.update(f); expect(mode.scene.userData.pulse).toBe(1);
    mode.update(f); expect(mode.scene.userData.pulse).toBeLessThan(1);
    for (let i = 0; i < 10; i++) mode.update(f);
    expect(mode.scene.userData.bass).toBeGreaterThan(0.9); expect(mode.scene.userData.waveHeight).toBeGreaterThan(5);
    f.audio = { ...f.audio, onset: false }; mode.update(f); f.reducedFlash = true; f.audio = { ...f.audio, onset: true }; mode.update(f);
    expect(mode.scene.userData.pulse).toBe(0.3);
    const before = JSON.stringify(mode.scene.userData), camera = mode.camera.position.toArray();
    const wave = Array.from((mode.scene.getObjectByName('Water 7 / breaking wave 1') as any).geometry.attributes.position.array);
    f.reducedMotion = true; f.delta = 20; for (let i = 0; i < 10; i++) mode.update(f);
    expect(JSON.stringify(mode.scene.userData)).toBe(before); expect(mode.camera.position.toArray()).toEqual(camera);
    expect(Array.from((mode.scene.getObjectByName('Water 7 / breaking wave 1') as any).geometry.attributes.position.array)).toEqual(wave);
    f.reducedMotion = false; mode.update(f); expect(mode.scene.userData.clock).toBeCloseTo(JSON.parse(before).clock + 0.1);
    mode.dispose();
  });
  it('uses the supplied Wave6 city with canals, bridges, waterfall sheets and boats', () => {
    const bytes = readFileSync(new URL('../../Model assets/Wave6 assets /Water 7 v2 model.glb', import.meta.url));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    for (const name of ['fountain_central', 'waterfalls', 'canal_front', 'ring_canal_mid', 'arch_gateway_front', 'boat_08', 'aqueduct_back'])
      expect(gltf.nodes.some((n: { name: string }) => n.name === name)).toBe(true);
  });
});
