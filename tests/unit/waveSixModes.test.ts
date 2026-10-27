import { describe, expect, it } from 'vitest';
import { modeDefinitions, waveFiveModeDefinitions, waveSixModeDefinitions } from '../../src/modes/registry';
import { WINDOW_PALETTES } from '../../src/modes/windowGridMode';
import { TRACER_HEADINGS, TRACER_PALETTES } from '../../src/modes/cloudTracerMode';
import { OVERLOOK, overlookTowers } from '../../src/modes/neonOverlookMode';
import { FOG_SHOTS, TOWER_HEIGHT, TOWER_SECTIONS, towerHalf } from '../../src/modes/fogTowersMode';
import { PETAL_LAYERS, petalGeometry } from '../../src/modes/glyphBloomMode';
import { PointSet, plexusGeometry } from '../../src/modes/pointCloud';
import { LIDAR, lidarForest, pathX } from '../../src/modes/lidarTrailMode';
import { SPROUT, growSprout } from '../../src/modes/scanSproutMode';
import { THERMAL, fishGeometry } from '../../src/modes/heatShoalMode';
import { FONT, FONT_CHARS, MACHINES } from '../../src/modes/slotHallMode';
import { GLASS_GRID, GLASS_POSES } from '../../src/modes/glassHandsMode';
import { EYE_SCENES, EYE_TRANSITIONS } from '../../src/modes/eyeStageMode';
import { LAMP_PATTERNS, hornGeometry } from '../../src/modes/nightParlourMode';
import { BLOB_IMAGES, pickBoxes, saliencyMap } from '../../src/modes/blobTrackMode';
import { seededRandom } from '../../src/rendering/diagnostics';
import { presetBudget } from '../../src/rendering/quality';
import type { ModeFrame } from '../../src/modes/types';

const frame = (): ModeFrame => ({ time: 2, delta: 1 / 60, aspect: 16 / 9, spectrumMapping: 'linear', sampleRate: 48000,
  hue: 0.3, reducedMotion: false, reducedFlash: true, sensitivity: 1.8,
  response: { bass: 0, loudness: 0, impact: 0, bounce: 0 },
  audio: { waveform: new Float32Array(1024), spectrum: new Uint8Array(512), bass: 0, mid: 0, highs: 0, rms: 0, onset: false, time: 2 },
});

const IDS = ['windowGrid', 'cloudTracer', 'neonOverlook', 'fogTowers', 'glyphBloom', 'lidarTrail', 'scanSprout', 'heatShoal', 'slotHall', 'toonBlaze', 'glassHands', 'glowTide', 'eyeStage', 'nightParlour', 'blobTrack', 'goldenGate'];
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
  it('gives Cloud Tracer four neon palettes and four headings', () => {
    expect(TRACER_PALETTES).toHaveLength(4);
    expect(TRACER_HEADINGS).toHaveLength(4);
  });
  it('lays the Neon Overlook city on its grid, tallest first, within the budget', () => {
    const towers = overlookTowers(300, seededRandom(1)), half = OVERLOOK.lots * (OVERLOOK.lot + OVERLOOK.street) / 2;
    expect(towers.length).toBeLessThanOrEqual(330);
    expect(towers[0].h).toBeGreaterThanOrEqual(towers[39].h);
    for (const t of towers) expect(Math.abs(t.x)).toBeLessThan(half);
  });
  it('narrows the Fog Towers tower upward to a point and keeps every lit window on the tower', () => {
    expect(towerHalf(0)).toBe(TOWER_SECTIONS[0].half);
    expect(towerHalf(TOWER_HEIGHT)).toBe(0);
    expect(FOG_SHOTS.length).toBeGreaterThanOrEqual(6);
    for (const shot of FOG_SHOTS) expect(Math.abs(shot.window[1])).toBeLessThan(towerHalf(shot.window[2]));
  });
  it('builds Glyph Bloom petals that get longer toward the outside', () => {
    for (let l = 1; l < PETAL_LAYERS.length; l++) expect(PETAL_LAYERS[l].length).toBeGreaterThan(PETAL_LAYERS[l - 1].length);
    const petal = petalGeometry(1.2, 0.1, 3); petal.computeBoundingBox();
    expect(petal.boundingBox!.max.y).toBeCloseTo(1.2, 1);
  });
  it('fills the point sets exactly, with plant points born in growth order and plexus lines within reach', () => {
    const forest = lidarForest(20000, seededRandom(2));
    expect(forest.count).toBe(20000);
    expect(pathX(0)).toBeCloseTo(pathX(-LIDAR.tile));
    const plant = growSprout(20000, seededRandom(3));
    expect(plant.count).toBe(20000);
    let maxBirth = 0; for (let i = 0; i < plant.count; i++) maxBirth = Math.max(maxBirth, plant.anchor[i * 4 + 3]);
    expect(maxBirth).toBeLessThan(1);
    expect(SPROUT.leaves).toBeGreaterThan(8);
    const { count } = plexusGeometry(plant, 100, 0.7, seededRandom(4));
    expect(count).toBeGreaterThan(50);
    const set = new PointSet(2); set.add(0, 0, 0, 0, 1, 0); set.add(1, 0, 0, 0, 1, 0); set.add(2, 0, 0, 0, 1, 0);
    expect(set.count).toBe(2);
  });
  it('runs the thermal ramp cold to hot and builds a fish', () => {
    const luma = THERMAL.map(([r, g, b]) => r + g + b);
    for (let k = 1; k < luma.length; k++) expect(luma[k]).toBeGreaterThan(luma[k - 1]);
    expect(fishGeometry().attributes.position.count).toBeGreaterThan(500);
  });
  it('spells the jackpot sign from the dot font', () => {
    for (const c of 'JACKPOT$0123456789.') expect(FONT_CHARS).toContain(c);
    for (const c of FONT_CHARS) expect(FONT[c]).toHaveLength(35);
    expect(MACHINES).toBe(7);
  });
  it('halves the Glass Hands grid on the lowest tier and offers five poses', () => {
    expect(GLASS_GRID.full[0] * GLASS_GRID.full[1]).toBeGreaterThanOrEqual(20);
    expect(GLASS_GRID.low[0] * GLASS_GRID.low[1]).toBe(12);
    expect(GLASS_POSES).toHaveLength(5);
  });
  it('gives Eye Stage six layouts, five transitions, and Night Parlour three lamp patterns', () => {
    expect(EYE_SCENES).toHaveLength(6);
    expect(EYE_TRANSITIONS).toHaveLength(5);
    expect(LAMP_PATTERNS).toHaveLength(3);
    expect(hornGeometry().attributes.position.count).toBeGreaterThan(100);
  });
  it('puts Blob Track boxes where the picture has detail, chained nearest first', () => {
    expect(BLOB_IMAGES).toHaveLength(4);
    const w = 32, h = 18, pixels = new Uint8ClampedArray(w * h * 4).fill(40);
    // A checkerboard patch in the right half: all the detail is there.
    for (let y = 4; y < 14; y++) for (let x = 20; x < 30; x++) { const v = (x + y) % 2 ? 255 : 0; pixels.set([v, v, v, 255], (y * w + x) * 4); }
    const boxes = pickBoxes(saliencyMap(pixels, w, h), w, h, 12, seededRandom(5));
    expect(boxes).toHaveLength(12);
    for (const [x] of boxes) expect(x).toBeGreaterThan(0.5);
  });
});
