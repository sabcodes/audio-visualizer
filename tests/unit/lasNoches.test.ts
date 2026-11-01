import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createLasNochesMode, LAS_NOCHES_SHOTS, LAS_NOCHES_VENTS, lasNochesWeather } from '../../src/modes/lasNochesMode';
import type { ModeFrame } from '../../src/modes/types';
import { presetBudget } from '../../src/rendering/quality';

const frame = (): ModeFrame => ({ time: 0, delta: 0.1, aspect: 16 / 9, spectrumMapping: 'linear', sampleRate: 48000,
  hue: 0, reducedMotion: false, reducedFlash: false,
  response: { bass: 0, loudness: 0, impact: 0, bounce: 0 },
  audio: { waveform: new Float32Array(1024), spectrum: new Uint8Array(512), bass: 0, mid: 0, highs: 0, rms: 0, onset: false, time: 0 },
});

describe('Las Noches camera tour', () => {
  it('visits the palace, outposts and grove in silence and freezes the current view with reduced motion', () => {
    const mode = createLasNochesMode(presetBudget('compatibility')), f = frame(), seen = new Set<string>();
    for (let i = 0; i < LAS_NOCHES_SHOTS.length * 110; i++) {
      f.time += f.delta; mode.update(f); seen.add(mode.scene.userData.shot);
      expect(mode.camera.position.y).toBeGreaterThan(80);
    }
    expect([...seen]).toEqual(LAS_NOCHES_SHOTS.map((s) => s.name));
    const position = mode.camera.position.clone(), rotation = mode.camera.quaternion.clone(), shot = mode.scene.userData.shot;
    f.reducedMotion = true;
    for (let i = 0; i < 200; i++) { f.time += 1; f.audio = { ...f.audio, onset: true }; f.response = { bass: 1, impact: 1, loudness: 1, bounce: 1 }; mode.update(f); }
    expect(mode.camera.position.equals(position)).toBe(true);
    expect(mode.camera.quaternion.equals(rotation)).toBe(true);
    expect(mode.scene.userData.shot).toBe(shot);
    mode.dispose();
    expect(mode.scene.children).toHaveLength(0);
  });

  it('cuts on strong beats after a shorter hold, and keeps pauses and stalled frames from skipping shots', () => {
    const mode = createLasNochesMode(presetBudget('compatibility')), f = frame();
    for (let i = 0; i < 25; i++) mode.update(f);
    expect(mode.scene.userData.shot).toBe(LAS_NOCHES_SHOTS[0].name);
    f.audio = { ...f.audio, onset: true }; f.response = { bass: 1, impact: 1, loudness: 1, bounce: 1 };
    mode.update(f);
    expect(mode.scene.userData.shot).toBe(LAS_NOCHES_SHOTS[0].name);
    for (let i = 0; i < 4; i++) mode.update(f);
    expect(mode.scene.userData.shot).toBe(LAS_NOCHES_SHOTS[1].name);
    f.delta = 0; const position = mode.camera.position.clone();
    for (let i = 0; i < 200; i++) mode.update(f);
    expect(mode.camera.position.equals(position)).toBe(true);
    f.delta = 60; mode.update(f);
    expect(mode.scene.userData.shot).toBe(LAS_NOCHES_SHOTS[1].name);
    mode.dispose();
  });

  it('holds softer beats longer and falls back to an eight second cut during music', () => {
    const mode = createLasNochesMode(presetBudget('compatibility')), f = frame();
    f.response = { bass: 0.5, impact: 0.5, loudness: 0.6, bounce: 0.5 }; f.audio = { ...f.audio, onset: true };
    for (let i = 0; i < 40; i++) mode.update(f);
    expect(mode.scene.userData.shot).toBe(LAS_NOCHES_SHOTS[0].name);
    for (let i = 0; i < 7; i++) mode.update(f);
    expect(mode.scene.userData.shot).toBe(LAS_NOCHES_SHOTS[1].name);
    f.audio = { ...f.audio, onset: false };
    for (let i = 0; i < 82; i++) mode.update(f);
    expect(mode.scene.userData.shot).toBe(LAS_NOCHES_SHOTS[2].name);
    mode.dispose();
  });
});

describe('Las Noches lasting rain and musical vents', () => {
  it('lets the short gas introduction fade while holding the physical flame tendrils with the music', () => {
    const f = frame();
    for (let t = 0; t < 144; t++) expect(lasNochesWeather(t, f)).toEqual({ smoke: 0, fire: 0, rain: 0 });
    f.response = { bass: 1, loudness: 1, impact: 1, bounce: 1 }; f.audio = { ...f.audio, highs: 1, onset: true };
    for (const t of [0, 2, 60, 70]) expect(lasNochesWeather(t, f)).toMatchObject({ smoke: 0, fire: 0 });
    expect(lasNochesWeather(8, f).smoke).toBeGreaterThan(0.5);
    for (const t of [20, 28, 40, 49]) {
      expect(lasNochesWeather(t, f).smoke).toBe(0);
      expect(lasNochesWeather(t, f).fire).toBeGreaterThan(0.5);
    }
    expect(lasNochesWeather(49, f).rain).toBeGreaterThan(0.5);
    f.response = { ...f.response, impact: 0 };
    expect(lasNochesWeather(28, f).fire).toBeGreaterThan(0.3);
    expect(lasNochesWeather(28, f).fire).toBeLessThan(0.6);
  });

  it('hides gas particles during the longer flame passage while rain continues', () => {
    const mode = createLasNochesMode(presetBudget('compatibility')), f = frame();
    f.response = { bass: 1, loudness: 1, impact: 1, bounce: 1 }; f.audio = { ...f.audio, highs: 1 };
    for (let i = 0; i < 500; i++) {
      mode.update(f);
      if (i >= 210) {
        expect(mode.scene.getObjectByName('cylinder gas')?.visible).toBe(false);
        expect(mode.scene.getObjectByName('spiritual flames')?.visible).toBe(true);
        expect(mode.scene.getObjectByName('falling rain')?.visible).toBe(true);
      }
    }
    mode.dispose();
  });

  it('starts clear and keeps rain and the green sky after musical vents stop', () => {
    const mode = createLasNochesMode(presetBudget('compatibility')), f = frame();
    const effects = ['cylinder gas', 'spiritual flames', 'torn flame fragments', 'falling rain'];
    mode.update(f);
    for (const name of effects) expect(mode.scene.getObjectByName(name)?.visible, name).toBe(false);
    f.response = { bass: 1, loudness: 1, impact: 1, bounce: 1 }; f.audio = { ...f.audio, highs: 1, onset: true };
    const seen = new Set<string>();
    for (let i = 0; i < 600; i++) { mode.update(f); for (const name of effects) if (mode.scene.getObjectByName(name)?.visible) seen.add(name); }
    expect([...seen].sort()).toEqual(effects.sort());
    f.response = { bass: 0, loudness: 0, impact: 0, bounce: 0 }; f.audio = { ...f.audio, highs: 0, onset: false };
    for (let i = 0; i < 200; i++) mode.update(f);
    for (const name of effects.filter((name) => name !== 'falling rain')) expect(mode.scene.getObjectByName(name)?.visible, name).toBe(false);
    expect(mode.scene.getObjectByName('falling rain')?.visible).toBe(true);
    expect(mode.scene.userData.weather.clouds).toBeGreaterThan(0.59);
    expect(mode.scene.userData.weather.rain).toBeGreaterThan(0.54);
    mode.dispose();
  });

  it('starts rain with the first green smoke and retains it across multiple weather cycles', () => {
    const mode = createLasNochesMode(presetBudget('compatibility')), f = frame();
    f.response = { bass: 1, loudness: 1, impact: 1, bounce: 1 }; f.audio = { ...f.audio, highs: 1 };
    for (let i = 0; i < 39; i++) mode.update(f);
    expect(mode.scene.getObjectByName('falling rain')?.visible).toBe(false);
    for (let i = 0; i < 11; i++) mode.update(f);
    expect(mode.scene.getObjectByName('cylinder gas')?.visible).toBe(true);
    expect(mode.scene.getObjectByName('falling rain')?.visible).toBe(true);
    expect(mode.scene.userData.weather.clouds).toBeGreaterThan(0.1);
    for (let i = 0; i < 1500; i++) {
      mode.update(f);
      expect(mode.scene.getObjectByName('falling rain')?.visible).toBe(true);
    }
    expect(mode.scene.userData.weather.clouds).toBeGreaterThan(0.59);
    const fresh = createLasNochesMode(presetBudget('compatibility'));
    fresh.update(frame());
    expect(fresh.scene.getObjectByName('falling rain')?.visible).toBe(false);
    fresh.dispose();
    mode.dispose();
  });

  it('places all eleven emitters on the supplied model cylinder tops', () => {
    const bytes = readFileSync(new URL('../../src/assets/wave6/las_noches.glb', import.meta.url));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    const tops: number[][] = [];
    for (const node of gltf.nodes) {
      if (!/flared tower|cylinder/i.test(node.name)) continue;
      const accessor = gltf.accessors[gltf.meshes[node.mesh].primitives[0].attributes.POSITION], tr = node.translation ?? [0, 0, 0];
      tops.push([(accessor.min[0] + accessor.max[0]) / 2 + tr[0], accessor.max[1] + tr[1], (accessor.min[2] + accessor.max[2]) / 2 + tr[2]]);
    }
    expect(tops).toHaveLength(LAS_NOCHES_VENTS.length);
    LAS_NOCHES_VENTS.forEach((vent, i) => { for (let j = 0; j < 3; j++) expect(vent[j]).toBeCloseTo(tops[i][j], 1); });
  });
});
