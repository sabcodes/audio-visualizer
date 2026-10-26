import { describe, expect, it } from 'vitest';
import { modeDefinitions, waveFiveModeDefinitions, waveSixModeDefinitions } from '../../src/modes/registry';
import { WINDOW_PALETTES } from '../../src/modes/windowGridMode';
import { presetBudget } from '../../src/rendering/quality';
import type { ModeFrame } from '../../src/modes/types';

const frame = (): ModeFrame => ({ time: 2, delta: 1 / 60, aspect: 16 / 9, spectrumMapping: 'linear', sampleRate: 48000,
  hue: 0.3, reducedMotion: false, reducedFlash: true, sensitivity: 1.8,
  response: { bass: 0, loudness: 0, impact: 0, bounce: 0 },
  audio: { waveform: new Float32Array(1024), spectrum: new Uint8Array(512), bass: 0, mid: 0, highs: 0, rms: 0, onset: false, time: 2 },
});

const IDS = ['windowGrid', 'cloudTracer', 'neonOverlook', 'fogTowers', 'glyphBloom', 'lidarTrail', 'scanSprout', 'heatShoal', 'slotHall', 'toonBlaze', 'glassHands', 'glowTide', 'eyeStage'];
// Compute-shader modes need native WebGPU; everything else also runs on WebGL2.
const GPU_ONLY: string[] = [];

describe('wave six modes', () => {
  it('registers the spec modes after wave 5, labelled experimental-wave6', () => {
    expect(waveSixModeDefinitions.map((mode) => mode.id)).toEqual(IDS);
    const start = 88 + waveFiveModeDefinitions.length;
    expect(modeDefinitions.slice(start, start + IDS.length)).toEqual(waveSixModeDefinitions);
    for (const mode of waveSixModeDefinitions) {
      expect(mode.label.startsWith('<experimental-wave6> ')).toBe(true);
      expect(mode.backends, mode.id).toEqual(GPU_ONLY.includes(mode.id) ? ['webgpu'] : ['webgpu', 'webgl2']);
    }
  });
  it('each mode builds, survives silence, a 130 BPM kick/snare pattern, loud onsets and a stalled frame, then disposes', () => {
    for (const definition of waveSixModeDefinitions) {
      const mode = definition.create(presetBudget('compatibility')), f = frame();
      expect(mode.scene.children.length, definition.id).toBeGreaterThan(0);
      mode.update(f);
      // Kick every 0.46 s (130 BPM), the snare (hat-heavy onset) on the off-beats.
      for (let i = 0; i < 240; i++) {
        f.time += 1 / 60;
        const beat = Math.floor(f.time / (60 / 130 / 2)), onset = Math.abs(f.time % (60 / 130 / 2)) < 1 / 60;
        const snare = beat % 2 === 1;
        f.audio = { ...f.audio, onset, bass: snare ? 0.2 : 0.9, highs: snare ? 0.8 : 0.2, mid: 0.5 };
        f.response = { bass: snare ? 0.2 : 0.9, loudness: 0.7, impact: onset ? 1 : 0, bounce: 0.5 };
        f.reducedFlash = i < 120;
        mode.update(f);
      }
      f.reducedMotion = true; f.delta = 3; f.spectrumMapping = 'log'; mode.update(f);
      mode.scene.traverse((object) => {
        for (const value of [object.position.x, object.position.y, object.position.z, object.rotation.x, object.scale.y]) expect(Number.isFinite(value), definition.id).toBe(true);
      });
      mode.dispose();
      expect(mode.scene.children, definition.id).toHaveLength(0);
    }
  });
});

describe('wave six helpers', () => {
  it('starts Window Grid on acid green and offers five palettes', () => {
    expect(WINDOW_PALETTES).toHaveLength(5);
    expect(WINDOW_PALETTES[0][0] >> 8 & 255).toBeGreaterThan(200);
  });
});
