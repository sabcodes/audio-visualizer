import { describe, expect, it } from 'vitest';
import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import { createEvilPumpkinMode, PUMPKIN_SHOTS } from '../../src/modes/evilPumpkinMode';
import { waveSixModeDefinitions } from '../../src/modes/registry';
import { presetBudget } from '../../src/rendering/quality';
import type { ModeFrame } from '../../src/modes/types';

const frame = (): ModeFrame => ({ time: 0, delta: 1 / 60, aspect: 16 / 9, spectrumMapping: 'linear', sampleRate: 48000,
  hue: 0, reducedMotion: false, reducedFlash: false, sensitivity: 1.8,
  response: { bass: 0, loudness: 0, impact: 0, bounce: 0 },
  audio: { waveform: new Float32Array(1024), spectrum: new Uint8Array(512), bass: 0, mid: 0, highs: 0, rms: 0, onset: false, time: 0 },
});

describe('Evil Pumpkin', () => {
  it('uses the requested menu label', () => {
    expect(waveSixModeDefinitions.find(mode => mode.id === 'evilPumpkin')?.label).toBe('<experimental wave6> evil pumpkin');
  });
  it('dances on every beat while bounce builds less frequent, beat-aligned laser bursts', () => {
    const mode = createEvilPumpkinMode(presetBudget('compatibility')), f = frame();
    const actor = mode.scene.getObjectByName('evil pumpkin')!;
    const bursts: number[] = [], attacks: string[] = [];
    let previousCount = 0;
    for (let i = 0; i < 1800; i++) {
      const hit = i % 30 === 0;
      f.response = { bass: 1, loudness: 0.8, impact: hit ? 1 : 0, bounce: 1 };
      f.audio = { ...f.audio, onset: hit }; f.time += f.delta; mode.update(f);
      if (i === 60) { expect(actor.position.y).toBeGreaterThan(0.04); expect(mode.scene.userData.laserCount).toBe(0); }
      if (mode.scene.userData.laserCount !== previousCount) {
        expect(hit).toBe(true); bursts.push(f.time); attacks.push(mode.scene.userData.attack);
        previousCount = mode.scene.userData.laserCount;
      }
      if (mode.scene.userData.firing > 0.95 && !mode.scene.userData.closeAttack) {
        expect(actor.position.z).toBeGreaterThan(0.9);
        expect(actor.scale.x).toBeGreaterThan(1.7);
      }
    }
    expect(bursts.length).toBeGreaterThanOrEqual(3); expect(bursts.length).toBeLessThan(6);
    expect(bursts[0]).toBeGreaterThan(6);
    for (let i = 1; i < bursts.length; i++) expect(bursts[i] - bursts[i - 1]).toBeGreaterThanOrEqual(5);
    expect(attacks.slice(0, 3)).toEqual(['eyes', 'mouth', 'combined']);
    mode.dispose(); expect(mode.scene.children).toHaveLength(0);
  });
  it('uses bounce to control frequency, with a five-second minimum interval', () => {
    const counts = [0.25, 1.5].map(bounce => {
      const mode = createEvilPumpkinMode(presetBudget('compatibility')), f = frame();
      let previous = 0, last = -10;
      for (let i = 0; i < 2400; i++) {
        const hit = i % 15 === 0;
        f.response = { bass: 1, loudness: 0.8, impact: hit ? 1 : 0, bounce };
        f.audio = { ...f.audio, onset: hit }; f.time += f.delta; mode.update(f);
        if (mode.scene.userData.laserCount !== previous) {
          expect(f.time - last).toBeGreaterThanOrEqual(5); last = f.time; previous = mode.scene.userData.laserCount;
        }
      }
      mode.dispose(); return previous;
    });
    expect(counts[0]).toBe(1); expect(counts[1]).toBeGreaterThan(5);
  });
  it('tours side, low and rising skin shots while keeping the sky and depth borders full width', () => {
    const mode = createEvilPumpkinMode(presetBudget('compatibility')), f = frame();
    const sky = mode.scene.getObjectByName('haunted full-width sky')!;
    const camera = mode.camera as PerspectiveCamera, seen = new Set<string>();
    for (let i = 0; i < 1800; i++) {
      f.time += f.delta; mode.update(f); seen.add(mode.scene.userData.shot);
      expect(camera.position.toArray().every(Number.isFinite)).toBe(true);
    }
    expect([...seen]).toEqual(PUMPKIN_SHOTS);
    for (const aspect of [9 / 16, 16 / 9, 32 / 9]) {
      f.aspect = aspect; mode.update(f); mode.scene.updateMatrixWorld(true);
      for (const side of [-1, 1]) {
        const corner = new Vector3(side * 0.5, side * 0.5, 0).applyMatrix4(sky.matrixWorld).project(camera);
        expect(corner.x).toBeCloseTo(side * 1.02); expect(corner.y).toBeCloseTo(side * 1.02);
      }
      const top = mode.scene.getObjectByName('top screen border')!;
      const innerEdge = new Vector3(0, -0.5, 0).applyMatrix4(top.matrixWorld).project(camera);
      expect(innerEdge.y).toBeCloseTo(0.52);
      expect(mode.scene.getObjectByName('bottom screen border')).toBeDefined();
    }
    mode.dispose();
  });
  it('stays framed in silence, respects zero sensitivity and suppresses attacks in reduced motion', () => {
    const mode = createEvilPumpkinMode(presetBudget('compatibility')), f = frame();
    f.audio = { ...f.audio, onset: true };
    for (let i = 0; i < 180; i++) { f.time += f.delta; mode.update(f); }
    expect(mode.scene.userData.attack).toBe('idle');
    f.response = { bass: 1, loudness: 1, impact: 1, bounce: 1 }; f.sensitivity = 0;
    for (let i = 0; i < 180; i++) { f.time += f.delta; mode.update(f); }
    expect(mode.scene.userData.attack).toBe('idle');
    f.sensitivity = 1.8; f.reducedMotion = true;
    const actor = mode.scene.getObjectByName('evil pumpkin')!;
    mode.update(f); const position = actor.position.clone(), scale = actor.scale.clone(), rotation = actor.quaternion.clone();
    for (let i = 0; i < 180; i++) { f.time += f.delta; mode.update(f); }
    expect(actor.position.equals(position)).toBe(true); expect(actor.scale.equals(scale)).toBe(true); expect(actor.quaternion.equals(rotation)).toBe(true);
    expect(mode.scene.userData.firing).toBe(0);
    mode.dispose();
  });
});
