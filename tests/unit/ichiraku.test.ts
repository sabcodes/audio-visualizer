import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ICHIRAKU_SHOTS, ICHIRAKU_PALETTES, createIchirakuMode } from '../../src/modes/ichirakuMode';
import { presetBudget } from '../../src/rendering/quality';
import type { ModeFrame } from '../../src/modes/types';

const frame = (): ModeFrame => ({ time: 0, delta: 0.1, aspect: 16 / 9, spectrumMapping: 'linear', sampleRate: 48000,
  hue: 0, reducedMotion: false, reducedFlash: false, response: { bass: 0, loudness: 0, impact: 0, bounce: 0 },
  audio: { waveform: new Float32Array(1024), spectrum: new Uint8Array(512), bass: 0, mid: 0, highs: 0, rms: 0, onset: false, time: 0 },
});

describe('Ichiraku / Neon Nights', () => {
  it('visits every camera angle and all neon palettes without audio, then disposes', () => {
    const mode = createIchirakuMode(presetBudget('compatibility')), f = frame(), shots = new Set<string>(), palettes = new Set<string>();
    const duration = ICHIRAKU_SHOTS.reduce((total, shot) => total + shot.seconds, 0);
    for (let i = 0; i < (duration + 2) / f.delta; i++) {
      mode.update(f); shots.add(mode.scene.userData.shot); palettes.add(mode.scene.userData.palette);
      expect(mode.camera.position.toArray().every(Number.isFinite)).toBe(true);
      expect(mode.camera.quaternion.toArray().every(Number.isFinite)).toBe(true);
    }
    expect([...shots]).toEqual(ICHIRAKU_SHOTS.map(s => s.name)); expect(palettes.size).toBe(ICHIRAKU_PALETTES.length);
    mode.dispose(); expect(mode.scene.children).toHaveLength(0);
  });
  it('separates kick and snare lamps, changes palette after eight beats, limits flashes and freezes animation', () => {
    const mode = createIchirakuMode(presetBudget('compatibility')), f = frame(); mode.update(f);
    const beat = (snare = false) => {
      f.response = { bass: 0, loudness: 0.3, impact: 0, bounce: 0 }; f.audio = { ...f.audio, onset: false, bass: 0, highs: 0 };
      for (let i = 0; i < 5; i++) mode.update(f);
      f.response = { bass: snare ? 0 : 1, loudness: 0.8, impact: 1, bounce: 1 }; f.audio = { ...f.audio, onset: true, bass: snare ? 0 : 1, highs: snare ? 1 : 0.1 }; mode.update(f);
    };
    beat(); expect(mode.scene.userData.main).toBeGreaterThan(mode.scene.userData.side); expect(mode.scene.userData.beats).toBe(1);
    for (let i = 0; i < 8; i++) mode.update(f); expect(mode.scene.userData.beats).toBe(1); // Held onset is one beat.
    beat(true); expect(mode.scene.userData.side).toBeGreaterThan(mode.scene.userData.main);
    for (let i = 0; i < 6; i++) beat(i % 2 === 0);
    expect(mode.scene.userData.beats).toBe(8); expect(mode.scene.userData.paletteIndex).toBe(1);
    f.reducedFlash = true; beat(); expect(mode.scene.userData.flash).toBe(0.4);
    const before = JSON.stringify(mode.scene.userData), camera = mode.camera.position.toArray();
    f.reducedMotion = true; f.delta = 20; for (let i = 0; i < 20; i++) mode.update(f);
    expect(JSON.stringify(mode.scene.userData)).toBe(before); expect(mode.camera.position.toArray()).toEqual(camera);
    f.reducedMotion = false; mode.update(f); expect(mode.scene.userData.clock).toBeCloseTo(JSON.parse(before).clock + 0.1);
    mode.dispose();
  });
  it('uses the supplied shop with independent emissive lamps and embedded curtain and roof textures', () => {
    const bytes = readFileSync(new URL('../../Model assets/Wave6 assets /ichiraku_ramen.glb', import.meta.url));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    for (const name of ['lantern_main', 'lantern_side', 'interior_glow', 'noren_panel_05', 'roof_main', 'stool_06'])
      expect(gltf.nodes.some((n: { name: string }) => n.name === name)).toBe(true);
    expect(gltf.materials.filter((m: { name: string }) => m.name.startsWith('emissive_'))).toHaveLength(3);
    expect(gltf.images).toHaveLength(2); expect(gltf.animations ?? []).toHaveLength(0);
  });
});
