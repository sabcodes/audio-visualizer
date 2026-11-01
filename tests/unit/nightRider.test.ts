import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createNightRiderMode, NIGHT_RIDER_SHOTS } from '../../src/modes/nightRiderMode';
import type { ModeFrame } from '../../src/modes/types';
import { presetBudget } from '../../src/rendering/quality';
import { createNightRiderThrottle } from '../../src/modes/nightRiderEffects';

const frame = (): ModeFrame => ({ time: 0, delta: 0.1, aspect: 16 / 9, spectrumMapping: 'linear', sampleRate: 48000,
  hue: 0, reducedMotion: false, reducedFlash: true,
  response: { bass: 0, loudness: 0, impact: 0, bounce: 0 },
  audio: { waveform: new Float32Array(1024), spectrum: new Uint8Array(512), bass: 0, mid: 0, highs: 0, rms: 0, onset: false, time: 0 },
});

describe('Night Rider reel', () => {
  it('visits all 32 bike shots, six districts and every supplied bike animation in silence', () => {
    const mode = createNightRiderMode(presetBudget('compatibility')), f = frame(), seen = new Set<string>();
    for (let i = 0; i < Math.ceil(NIGHT_RIDER_SHOTS.reduce((n, s) => n + s.seconds + 0.1, 0) / f.delta) + 10; i++) {
      mode.update(f); seen.add(mode.scene.userData.shot);
      expect(mode.camera.position.y).toBeGreaterThan(0.2);
      expect(mode.camera.position.toArray().every(Number.isFinite)).toBe(true);
    }
    expect([...seen]).toEqual(NIGHT_RIDER_SHOTS.map((shot) => shot.name));
    expect(new Set(NIGHT_RIDER_SHOTS.map((shot) => shot.district)).size).toBe(6);
    expect(new Set(NIGHT_RIDER_SHOTS.map((shot) => shot.clip)).size).toBe(6);
    expect(new Set(NIGHT_RIDER_SHOTS.map((shot) => shot.motion).filter(Boolean)).size).toBe(7);
    mode.dispose(); expect(mode.scene.children).toHaveLength(0);
  });

  it('cuts on fresh strong onsets after the minimum hold, without skipping a stunt landing', () => {
    const mode = createNightRiderMode(presetBudget('compatibility')), f = frame();
    f.response = { ...f.response, impact: 1 };
    for (let i = 0; i < 21; i++) mode.update(f);
    f.audio = { ...f.audio, onset: true }; mode.update(f);
    expect(mode.scene.userData.shotIndex).toBe(1);
    // A latched onset is not a new beat.
    for (let i = 0; i < 11; i++) mode.update(f);
    expect(mode.scene.userData.shotIndex).toBe(1);
    f.audio = { ...f.audio, onset: false };
    while (mode.scene.userData.shotIndex !== 5) mode.update(f);
    for (let i = 0; i < 17; i++) { f.audio = { ...f.audio, onset: i % 2 === 0 }; mode.update(f); }
    expect(mode.scene.userData.shotIndex).toBe(5);
    for (let i = 0; i < 4; i++) mode.update(f);
    expect(mode.scene.userData.shotIndex).toBe(6);
    mode.dispose();
  });

  it('freezes a banked camera and scenery with reduced motion, and bounds stalled frames', () => {
    const mode = createNightRiderMode(presetBudget('compatibility')), f = frame();
    while (mode.scene.userData.shotIndex !== 5) mode.update(f);
    for (let i = 0; i < 8; i++) mode.update(f);
    const position = mode.camera.position.clone(), rotation = mode.camera.quaternion.clone();
    const tunnel = mode.scene.getObjectByName('light tunnel')!, tunnelZ = tunnel.position.z;
    f.reducedMotion = true; f.delta = 30; f.audio = { ...f.audio, onset: true };
    for (let i = 0; i < 100; i++) mode.update(f);
    expect(mode.camera.position.equals(position)).toBe(true);
    expect(mode.camera.quaternion.equals(rotation)).toBe(true);
    expect(tunnel.position.z).toBe(tunnelZ);
    expect(mode.scene.userData.shotIndex).toBe(5);
    f.reducedMotion = false; mode.update(f);
    expect(mode.scene.userData.shotIndex).toBe(5);
    mode.dispose();
  });

  it('retains all authored bike clips and the exhaust and wheel nodes used by the effects', () => {
    const bytes = readFileSync(new URL('../../src/assets/wave6/nr_bike.glb', import.meta.url));
    const bike = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    for (const node of ['BikeRoot', 'exhaust_tip', 'FrontWheel', 'RearWheel']) expect(bike.nodes.some((n: {name: string}) => n.name === node)).toBe(true);
    for (const clip of new Set(NIGHT_RIDER_SHOTS.map((shot) => shot.clip))) {
      const animation = bike.animations.find((a: { name: string }) => a.name === clip);
      expect(bike.accessors[animation.samplers[0].input].max[0]).toBeGreaterThan(0);
    }
  });
});

describe('Night Rider throttle', () => {
  it('fires on fresh musical edges, leaves gaps between exhaust bursts, and settles in silence', () => {
    const throttle = createNightRiderThrottle(), f = frame();
    f.audio = { ...f.audio, onset: true }; throttle.update(f);
    expect(throttle.bursts).toBe(0);
    f.audio = { ...f.audio, onset: false }; throttle.update(f);
    f.response = { bass: 0.8, loudness: 0.8, impact: 1, bounce: 0.8 };
    f.audio = { ...f.audio, onset: true }; throttle.update(f);
    expect(throttle.fired).toBe(true); expect(throttle.boost).toBeGreaterThan(0.5);
    for (let i = 0; i < 20; i++) throttle.update(f);
    expect(throttle.bursts).toBe(1);
    for (let hit = 0; hit < 2; hit++) {
      f.audio = { ...f.audio, onset: false }; throttle.update(f);
      f.audio = { ...f.audio, onset: true }; throttle.update(f);
      for (let i = 0; i < 5; i++) throttle.update(f);
    }
    expect(throttle.bursts).toBe(2);
    f.response = { bass: 0, loudness: 0, impact: 0, bounce: 0 }; f.audio = { ...f.audio, onset: false };
    for (let i = 0; i < 50; i++) throttle.update(f);
    expect(throttle.exhaust).toBeLessThan(0.001); expect(throttle.boost).toBeLessThan(0.001);
  });
  it('also triggers on bounce edges and freezes the current effect during reduced motion', () => {
    const throttle = createNightRiderThrottle(), f = frame();
    f.response = { bass: 0.8, loudness: 0.8, impact: 0, bounce: 0.8 }; throttle.update(f);
    expect(throttle.fired).toBe(true);
    const boost = throttle.boost, flame = throttle.exhaust;
    f.reducedMotion = true;
    for (let i = 0; i < 60; i++) throttle.update(f);
    expect(throttle.boost).toBe(boost); expect(throttle.exhaust).toBe(flame); expect(throttle.bursts).toBe(1);
  });
});
