import { describe, expect, it } from 'vitest';
import { modeDefinitions, waveFiveModeDefinitions } from '../../src/modes/registry';
import { tvWallLayout } from '../../src/modes/crtModes';
import { INK_DISCS, INK_LAYOUTS } from '../../src/modes/inkDiscsMode';
import { GLOBE_CYCLE, globePhase } from '../../src/modes/orbModes';
import { SKY_LOOKS } from '../../src/modes/skyShardsMode';
import { presetBudget } from '../../src/rendering/quality';
import type { ModeFrame } from '../../src/modes/types';

const frame = (): ModeFrame => ({ time: 2, delta: 1 / 60, aspect: 16 / 9, spectrumMapping: 'linear', sampleRate: 48000,
  hue: 0.3, reducedMotion: false, reducedFlash: true,
  response: { bass: 0, loudness: 0, impact: 0, bounce: 0 },
  audio: { waveform: new Float32Array(1024), spectrum: new Uint8Array(512), bass: 0, mid: 0, highs: 0, rms: 0, onset: false, time: 2 },
});

const IDS = ['crtSpill', 'tvWall', 'inkDiscs', 'crackedGlobe', 'dotVortex', 'skyShards'];

describe('wave five modes', () => {
  it('registers the code-only spec modes after wave 4, labelled experimental-wave5', () => {
    expect(waveFiveModeDefinitions.map((mode) => mode.id)).toEqual(IDS);
    expect(modeDefinitions.slice(85, 91)).toEqual(waveFiveModeDefinitions);
    for (const mode of waveFiveModeDefinitions) {
      expect(mode.label.startsWith('<experimental-wave5> ')).toBe(true);
      expect(mode.backends).toEqual(['webgpu', 'webgl2']);
    }
  });
  it('each mode builds, survives silence, a 130 BPM kick pattern, loud onsets and a stalled frame, then disposes', () => {
    for (const definition of waveFiveModeDefinitions) {
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

describe('wave five helpers', () => {
  it('stacks about thirty TVs: three big ones on the floor, the block above them without overlaps in a column', () => {
    const tvs = tvWallLayout();
    expect(tvs.filter((tv) => tv.big)).toHaveLength(3);
    expect(tvs.length).toBeGreaterThanOrEqual(26);
    expect(tvs.length).toBeLessThanOrEqual(31);
    for (const tv of tvs.filter((t) => !t.big)) expect(tv.y).toBeGreaterThan(1.2);
    for (const a of tvs) for (const b of tvs) {
      if (a === b || a.big || b.big || Math.abs(a.x - b.x) > 0.1) continue;
      expect(Math.abs(a.y - b.y) >= Math.min(a.h, b.h)).toBe(true);
    }
  });
  it('runs the globe scanner top to bottom, filling the cap first and veining it after', () => {
    const start = globePhase(GLOBE_CYCLE.spot), end = globePhase(GLOBE_CYCLE.pass), late = globePhase(GLOBE_CYCLE.veins);
    expect(start.ring).toBeCloseTo(1);
    expect(end.ring).toBeLessThan(-0.8);
    expect(start.spot).toBeCloseTo(1);
    expect(start.fill).toBeGreaterThan(end.fill);
    expect(late.veins).toBe(1);
    expect(globePhase(0).veins).toBe(0);
    expect(globePhase(1).ringGlow).toBe(0);
  });
  it('keeps every ink layout inside the frame with the droplet at the bottom', () => {
    for (const layout of INK_LAYOUTS) {
      expect(layout).toHaveLength(INK_DISCS);
      const drop = layout[INK_DISCS - 1];
      for (const disc of layout) { expect(Math.abs(disc.y) + disc.r).toBeLessThan(0.5); expect(disc.y).toBeGreaterThanOrEqual(drop.y); }
    }
  });
  it('offers eight panel skies plus the base dusk', () => {
    expect(SKY_LOOKS).toHaveLength(9);
    expect(SKY_LOOKS.at(-1)!.name).toBe('base dusk');
  });
});
