import { describe, expect, it } from 'vitest';
import { BoxGeometry, DodecahedronGeometry, IcosahedronGeometry, OctahedronGeometry, TetrahedronGeometry } from 'three/webgpu';
import { waveOneModeDefinitions, modeDefinitions } from '../../src/modes/registry';
import { epicycleShape, epicycleTerms, polyhedronSegments, POLY_SEGMENTS, pendulumPhase, PENDULUMS, PENDULUM_CYCLE, EPICYCLE_SHAPES } from '../../src/modes/geometricModes';
import { ridgeProfile } from '../../src/modes/landscapeModes';
import { poseTargets, ROBOT_POSES, ROBOT_JOINTS } from '../../src/modes/robotMode';
import { bandEnergies, beatGate } from '../../src/modes/shared';
import { SpringRig } from '../../src/simulations/springRig';
import { presetBudget } from '../../src/rendering/quality';
import type { ModeFrame } from '../../src/modes/types';

const frame = (): ModeFrame => ({ time: 2, delta: 1 / 60, aspect: 16 / 9, spectrumMapping: 'linear', sampleRate: 48000,
  hue: 0.3, reducedMotion: false, reducedFlash: true,
  response: { bass: 0, loudness: 0, impact: 0, bounce: 0 },
  audio: { waveform: new Float32Array(1024), spectrum: new Uint8Array(512), bass: 0, mid: 0, highs: 0, rms: 0, onset: false, time: 2 },
});

describe('wave one modes', () => {
  it('registers ten new ids after the legacy 18, all on both backends', () => {
    expect(waveOneModeDefinitions.map((mode) => mode.id)).toEqual(['epicycles', 'polyhedra', 'pendulumWave', 'voronoi', 'inkMarble', 'aurora', 'ridgeline', 'synthwave', 'galaxy', 'robot']);
    expect(modeDefinitions.slice(18, 28)).toEqual(waveOneModeDefinitions);
    for (const mode of waveOneModeDefinitions) expect(mode.backends).toEqual(['webgpu', 'webgl2']);
  });
  it('each mode builds, survives silence, loud onsets and a stalled frame, then disposes', () => {
    for (const definition of waveOneModeDefinitions) {
      const mode = definition.create(presetBudget('compatibility')), f = frame();
      expect(mode.scene.children.length, definition.id).toBeGreaterThan(0);
      mode.update(f);
      f.audio.spectrum.fill(220); f.audio.waveform.fill(0.4);
      f.audio = { ...f.audio, bass: 1, mid: 1, highs: 1, onset: true };
      f.response = { bass: 1, loudness: 1, impact: 1, bounce: 1 }; f.reducedFlash = false;
      for (let i = 0; i < 90; i++) { f.time += 1 / 60; mode.update(f); }
      f.delta = 3; f.spectrumMapping = 'log'; mode.update(f);
      mode.scene.traverse((object) => {
        const position = (object as { geometry?: { attributes?: { position?: { array: ArrayLike<number> } } } }).geometry?.attributes?.position;
        if (position) expect(Array.from(position.array).every(Number.isFinite), definition.id).toBe(true);
        for (const value of [object.position.x, object.position.y, object.position.z, object.rotation.x, object.scale.y]) expect(Number.isFinite(value), definition.id).toBe(true);
      });
      mode.dispose();
      expect(mode.scene.children).toHaveLength(0);
    }
  });
});

describe('fourier epicycles', () => {
  it('reconstructs each target curve from 48 terms', () => {
    for (const shape of EPICYCLE_SHAPES) {
      const points = epicycleShape(shape, 256), terms = epicycleTerms(points, 48);
      let worst = 0;
      for (const i of [0, 37, 128, 200]) {
        let x = 0, y = 0;
        for (const term of terms) { const a = 2 * Math.PI * term.freq * i / 256 + term.phase; x += term.amp * Math.cos(a); y += term.amp * Math.sin(a); }
        worst = Math.max(worst, Math.hypot(x - points[i * 2], y - points[i * 2 + 1]));
      }
      expect(worst, shape).toBeLessThan(0.08);
      expect(terms[0].amp).toBeGreaterThanOrEqual(terms[47].amp);
    }
  });
});

describe('polyhedra morph', () => {
  it('splits every platonic solid into the same number of unit-radius segments', () => {
    for (const geometry of [new TetrahedronGeometry(1), new BoxGeometry(1, 1, 1), new OctahedronGeometry(1), new DodecahedronGeometry(1), new IcosahedronGeometry(1)]) {
      const segments = polyhedronSegments(geometry);
      expect(segments.length).toBe(POLY_SEGMENTS * 6);
      // Segment endpoints that are original vertices sit on the unit sphere; interior points sit inside it.
      let outside = 0;
      for (let i = 0; i < segments.length; i += 3) if (Math.hypot(segments[i], segments[i + 1], segments[i + 2]) > 1 + 1e-5) outside++;
      expect(outside).toBe(0);
      geometry.dispose();
    }
  });
});

describe('pendulum wave', () => {
  it('lines every pendulum up again after one cycle', () => {
    for (let i = 0; i < PENDULUMS; i++) expect(Math.cos(pendulumPhase(i, PENDULUM_CYCLE))).toBeCloseTo(1, 6);
    const spread = new Set(Array.from({ length: PENDULUMS }, (_, i) => Math.sign(Math.sin(pendulumPhase(i, PENDULUM_CYCLE / 4))).toFixed(0)));
    expect(spread.size).toBeGreaterThan(1);
  });
});

describe('ridgeline', () => {
  it('peaks in the middle, fades to flat edges, and rises with the spectrum', () => {
    const f = frame();
    const quiet = ridgeProfile(f, new Float32Array(141), () => 0.5)[70];
    f.audio.spectrum.fill(180);
    const profile = ridgeProfile(f, new Float32Array(141), () => 0.5);
    expect(profile[70]).toBeGreaterThan(quiet + 15);
    expect(profile[0]).toBeLessThan(profile[70] * 0.01);
    expect(profile[140]).toBeLessThan(profile[70] * 0.01);
  });
});

describe('shared helpers', () => {
  it('band energies average the whole axis in both mappings', () => {
    const f = frame(); f.audio.spectrum.fill(255);
    expect(Array.from(bandEnergies(f, 8))).toEqual(Array(8).fill(1));
    f.spectrumMapping = 'log';
    expect(Array.from(bandEnergies(f, 8)).every((v) => v === 1)).toBe(true);
  });
  it('beat gate rate-limits onsets and re-arms after a clock reset', () => {
    const gate = beatGate(0.5);
    expect(gate(1, true)).toBe(true);
    expect(gate(1.2, true)).toBe(false);
    expect(gate(1.6, false)).toBe(false);
    expect(gate(1.6, true)).toBe(true);
    expect(gate(0.1, true)).toBe(true);
  });
});

describe('robot rig', () => {
  it('springs overshoot toward a pose and settle identically at 30 and 120 Hz', () => {
    const run = (hz: number) => {
      const rig = new SpringRig(ROBOT_JOINTS.length * 3);
      poseTargets(ROBOT_POSES[2], rig.targets);
      let peak = 0;
      for (let i = 0; i < hz; i++) { rig.advance(1 / hz); peak = Math.max(peak, rig.values[2 * 3 + 2]); }
      return { peak, settled: Array.from(rig.values) };
    };
    const slow = run(30), fast = run(120);
    expect(fast.peak).toBeGreaterThan(1.5); // lShoulder z overshoots its 1.5 rad target
    fast.settled.forEach((value, i) => expect(value).toBeCloseTo(slow.settled[i], 4));
    expect(fast.settled[2 * 3 + 2]).toBeCloseTo(1.5, 1);
  });
  it('every pose names only real joints and unlisted joints relax to zero', () => {
    for (const pose of ROBOT_POSES) {
      for (const joint of Object.keys(pose)) expect(ROBOT_JOINTS).toContain(joint);
      const targets = poseTargets(pose, new Float32Array(ROBOT_JOINTS.length * 3).fill(9));
      expect(targets.every((v) => Math.abs(v) < Math.PI)).toBe(true);
    }
  });
  it('caps a stalled frame instead of integrating a multi-second jump', () => {
    const rig = new SpringRig(1); rig.targets[0] = 1;
    rig.advance(10);
    expect(rig.values[0]).toBeLessThan(2);
  });
});
