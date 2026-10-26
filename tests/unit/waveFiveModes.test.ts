import { describe, expect, it } from 'vitest';
import { uniform } from 'three/tsl';
import { modeDefinitions, waveFiveModeDefinitions } from '../../src/modes/registry';
import { tvWallLayout } from '../../src/modes/crtModes';
import { INK_DISCS, INK_LAYOUTS } from '../../src/modes/inkDiscsMode';
import { GLOBE_CYCLE, globePhase } from '../../src/modes/orbModes';
import { SKY_LOOKS } from '../../src/modes/skyShardsMode';
import { BODY_SEGMENTS, DANCE_MOVES, poseBody, runPose } from '../../src/modes/bodyModel';
import { ALLEY_SLABS, alleyLayout } from '../../src/modes/figureShaderModes';
import { CLAW_GESTURES, CLAW_LAYOUTS } from '../../src/modes/clawHandsMode';
import { RELICS } from '../../src/modes/relicGlowMode';
import { growTree } from '../../src/modes/lanternTreeMode';
import { METRO, metroShot } from '../../src/modes/metroCarMode';
import { presetBudget } from '../../src/rendering/quality';
import type { ModeFrame } from '../../src/modes/types';

const frame = (): ModeFrame => ({ time: 2, delta: 1 / 60, aspect: 16 / 9, spectrumMapping: 'linear', sampleRate: 48000,
  hue: 0.3, reducedMotion: false, reducedFlash: true,
  response: { bass: 0, loudness: 0, impact: 0, bounce: 0 },
  audio: { waveform: new Float32Array(1024), spectrum: new Uint8Array(512), bass: 0, mid: 0, highs: 0, rms: 0, onset: false, time: 2 },
});

const IDS = ['crtSpill', 'tvWall', 'inkDiscs', 'crackedGlobe', 'dotVortex', 'skyShards', 'neonPortal', 'sparkPlume', 'dreamAlley', 'clawHands',
  'relicGlow', 'lanternTree', 'metroCar', 'slitDancer'];
// Compute-shader modes need native WebGPU; everything else also runs on WebGL2.
const GPU_ONLY = ['sparkPlume'];

describe('wave five modes', () => {
  it('registers the spec modes after wave 4, labelled experimental-wave5', () => {
    expect(waveFiveModeDefinitions.map((mode) => mode.id)).toEqual(IDS);
    expect(modeDefinitions.slice(85, 85 + IDS.length)).toEqual(waveFiveModeDefinitions);
    for (const mode of waveFiveModeDefinitions) {
      expect(mode.label.startsWith('<experimental-wave5> ')).toBe(true);
      expect(mode.backends, mode.id).toEqual(GPU_ONLY.includes(mode.id) ? ['webgpu'] : ['webgpu', 'webgl2']);
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
  it('poses every body segment finitely for each dance move and the run cycle', () => {
    for (const pose of [...Object.values(DANCE_MOVES), runPose(0.3, 1)]) {
      const posed = poseBody(pose, { skirt: true, hair: true }, 0.4, 2);
      expect(posed.segments).toHaveLength(BODY_SEGMENTS);
      for (const [a, r1, b, r2] of posed.segments) for (const v of [a.x, a.y, a.z, b.x, b.y, b.z, r1, r2]) expect(Number.isFinite(v)).toBe(true);
      expect(posed.head.y).toBeGreaterThan(1.2);
    }
  });
  it('builds seven alley slabs per layout with the tower last', () => {
    for (let v = 0; v < 4; v++) {
      const slabs = alleyLayout(v);
      expect(slabs).toHaveLength(ALLEY_SLABS);
      expect(slabs.at(-1)!.away).toEqual([0, 0, 0]);
    }
  });
  it('gives the claw hands at least six gestures and four layouts, X-cross first', () => {
    expect(CLAW_GESTURES.length).toBeGreaterThanOrEqual(6);
    expect(CLAW_LAYOUTS).toHaveLength(4);
    expect(Math.sign(CLAW_LAYOUTS[0][0][2])).toBe(-Math.sign(CLAW_LAYOUTS[0][1][2]));
  });
  it('builds twelve distinct relics in code', () => {
    expect(RELICS).toHaveLength(12);
    expect(new Set(RELICS.map((relic) => relic.name)).size).toBe(12);
    for (const relic of RELICS) {
      const { object, act } = relic.make(uniform(0));
      let meshes = 0; object.traverse((o) => { if ((o as { isMesh?: boolean }).isMesh) meshes++; });
      expect(meshes, relic.name).toBeGreaterThan(0);
      act(1.5, 0.8);
    }
  });
  it('grows a branching tree whose twigs spread wider than the trunk', () => {
    const { branches, tips } = growTree(5, 3);
    expect(branches[0].depth).toBe(0);
    expect(tips.length).toBeGreaterThan(20);
    expect(Math.max(...tips.map((t) => Math.hypot(t.x, t.z)))).toBeGreaterThan(3);
  });
  it('glides the metro camera one car per loop and rolls a full turn, so the loop is seamless', () => {
    const start = metroShot(0), end = metroShot(METRO.loop - 1e-6);
    expect(start.z - end.z).toBeCloseTo(METRO.pitch, 3);
    expect(end.roll).toBeCloseTo(Math.PI * 2, 3);
    expect(start.roll).toBe(0);
    expect(metroShot(METRO.loop / 2).roll).toBeCloseTo(Math.PI);
    expect(METRO.sections.length * 2).toBe(METRO.length);
    expect(METRO.pitch).toBeCloseTo(METRO.length + METRO.gangway);
    expect(metroShot(METRO.loop + 1).z).toBeCloseTo(metroShot(1).z);
  });
});
