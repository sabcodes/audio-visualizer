import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AKIRA_SHOTS, createAkiraMode } from '../../src/modes/akiraMode';
import { AKIRA_DISTRICTS } from '../../src/modes/akiraCity';
import { presetBudget } from '../../src/rendering/quality';
import type { ModeFrame } from '../../src/modes/types';

const frame = (): ModeFrame => ({ time: 0, delta: 0.1, aspect: 16 / 9, spectrumMapping: 'linear', sampleRate: 48000,
  hue: 0, reducedMotion: false, reducedFlash: true, response: { bass: 0, loudness: 0, impact: 0, bounce: 0 },
  audio: { waveform: new Float32Array(1024), spectrum: new Uint8Array(512), bass: 0, mid: 0, highs: 0, rms: 0, onset: false, time: 0 },
});

describe('Akira / Neo Tokyo', () => {
  it('plays the complete city reel in silence, with finite camera transforms and no skipped districts', () => {
    const mode = createAkiraMode(presetBudget('compatibility')), f = frame(), seen = new Set<string>();
    const duration = AKIRA_SHOTS.reduce((n, s) => n + s.seconds, 0);
    for (let i = 0; i < (duration + 4) / f.delta; i++) {
      mode.update(f); seen.add(mode.scene.userData.shot);
      expect(mode.camera.position.toArray().every(Number.isFinite)).toBe(true);
      expect(mode.camera.quaternion.toArray().every(Number.isFinite)).toBe(true);
    }
    expect([...seen]).toEqual(AKIRA_SHOTS.map(s => s.name));
    expect(new Set(AKIRA_SHOTS.map(s => s.district))).toEqual(new Set(Object.keys(AKIRA_DISTRICTS)));
    expect(new Set(AKIRA_SHOTS.map(s => s.motion)).size).toBe(9);
    mode.dispose(); expect(mode.scene.children).toHaveLength(0);
  });

  it('freezes camera, actor and city during reduced motion and bounds a stalled frame', () => {
    const mode = createAkiraMode(presetBudget('compatibility')), f = frame();
    while (mode.scene.userData.shotIndex !== 4) mode.update(f);
    for (let i = 0; i < 10; i++) mode.update(f);
    const before = JSON.stringify(mode.scene.userData);
    const rotation = mode.camera.quaternion.clone(), position = mode.camera.position.clone();
    f.reducedMotion = true; f.delta = 30;
    for (let i = 0; i < 40; i++) mode.update(f);
    expect(JSON.stringify(mode.scene.userData)).toBe(before);
    expect(mode.camera.quaternion.equals(rotation)).toBe(true); expect(mode.camera.position.equals(position)).toBe(true);
    f.reducedMotion = false; mode.update(f); expect(mode.scene.userData.shotIndex).toBe(4);
    mode.dispose();
  });

  it('uses the supplied static bike, including independent wheels and exhaust, without character assets', () => {
    const bytes = readFileSync(new URL('../../src/assets/wave6/akira_bike.glb', import.meta.url));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    for (const name of ['front_wheel', 'rear_wheel', 'exhaust', 'front_fairing', 'windscreen']) {
      expect(gltf.nodes.some((n: { name: string }) => n.name === name)).toBe(true);
    }
    expect(gltf.animations ?? []).toHaveLength(0); expect(gltf.skins ?? []).toHaveLength(0);
  });
});
