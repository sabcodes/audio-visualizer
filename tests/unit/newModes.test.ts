import { describe, expect, it } from 'vitest';
import { BoxGeometry, DodecahedronGeometry, IcosahedronGeometry, OctahedronGeometry, TetrahedronGeometry } from 'three/webgpu';
import { waveOneModeDefinitions, waveTwoModeDefinitions, modeDefinitions } from '../../src/modes/registry';
import { chladni, CHLADNI_MODES, KNOTS } from '../../src/modes/geometricModes';
import { tentacleBend, KRAKEN_SEGMENTS } from '../../src/modes/creatureModes';
import { fireworkKind } from '../../src/modes/nightModes';
import { chromeMatcap } from '../../src/modes/physicsModes';
import { LOOKS, PANEL_HOMES, PANELS, lookTargets } from '../../src/modes/arenaMode';
import { Sprite } from 'three/webgpu';
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
  it('registers eleven new ids after the legacy 18, all on both backends', () => {
    expect(waveOneModeDefinitions.map((mode) => mode.id)).toEqual(['epicycles', 'polyhedra', 'pendulumWave', 'voronoi', 'inkMarble', 'aurora', 'ridgeline', 'synthwave', 'galaxy', 'robot', 'neonCity']);
    expect(modeDefinitions.slice(18, 29)).toEqual(waveOneModeDefinitions);
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
    expect(profile[70]).toBeGreaterThan(quiet + 8);
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

describe('wave two modes', () => {
  it('registers eleven more ids after wave one, all on both backends', () => {
    expect(waveTwoModeDefinitions.map((mode) => mode.id)).toEqual(['kraken', 'torusKnot', 'chladni', 'metaballs', 'ocean', 'eventHorizon', 'fireworks', 'abyss', 'disco', 'ferrofluid', 'arena']);
    expect(modeDefinitions.slice(29, 40)).toEqual(waveTwoModeDefinitions);
    expect(new Set(modeDefinitions.map((mode) => mode.id)).size).toBe(modeDefinitions.length);
  });
  it('each mode builds, survives silence, loud onsets and a stalled frame, then disposes', () => {
    for (const definition of waveTwoModeDefinitions) {
      const mode = definition.create(presetBudget('compatibility')), f = frame();
      mode.update(f);
      f.audio.spectrum.fill(220);
      f.audio = { ...f.audio, bass: 1, mid: 1, highs: 1, onset: true, rms: 0.5 };
      f.response = { bass: 1, loudness: 1, impact: 1, bounce: 1 }; f.reducedFlash = false;
      for (let i = 0; i < 90; i++) { f.time += 1 / 60; mode.update(f); }
      f.delta = 3; f.spectrumMapping = 'log'; mode.update(f);
      mode.scene.traverse((object) => {
        const position = (object as { geometry?: { attributes?: { position?: { array: ArrayLike<number> } } } }).geometry?.attributes?.position;
        if (position) expect(Array.from(position.array).every(Number.isFinite), definition.id).toBe(true);
        for (const value of [object.position.x, object.position.y, object.rotation.x, object.scale.y]) expect(Number.isFinite(value), definition.id).toBe(true);
      });
      mode.dispose();
      expect(mode.scene.children).toHaveLength(0);
    }
  });
  it('chladni sand gathers on nodal lines', () => {
    for (const [n, m] of CHLADNI_MODES) {
      expect(chladni(n, m, 0.3, 0.3).value).toBeCloseTo(0, 10); // the diagonal is always nodal
      const { value, dx, dy } = chladni(n, m, 0.2, 0.7), h = 1e-5;
      expect(dx).toBeCloseTo((chladni(n, m, 0.2 + h, 0.7).value - value) / h, 2);
      expect(dy).toBeCloseTo((chladni(n, m, 0.2, 0.7 + h).value - value) / h, 2);
    }
  });
  it('kraken arms curl further with energy and fling outward on a whip', () => {
    const total = (curl: number, whip: number) => Array.from({ length: KRAKEN_SEGMENTS }, (_, s) => tentacleBend(s, curl, whip, 0)).reduce((a, b) => a + b, 0);
    expect(total(2, 0)).toBeGreaterThan(total(0, 0) + 2);
    expect(total(0, 1)).toBeLessThan(total(0, 0));
  });
  it('fireworks pick the burst type from the spectrum balance', () => {
    expect(fireworkKind(0.8, 0.3, 0.2)).toBe(0);
    expect(fireworkKind(0.3, 0.6, 0.2)).toBe(1);
    expect(fireworkKind(0.2, 0.3, 0.7)).toBe(2);
  });
  it('the chrome matcap is opaque inside the disc and lit from above', () => {
    const texture = chromeMatcap(32), data = texture.image.data as Uint8Array;
    const at = (i: number, j: number) => data[(j * 32 + i) * 4];
    expect(at(16, 28)).toBeGreaterThan(at(16, 4)); // up-facing normals reflect the bright sky
    expect(data[3]).toBe(255);
    texture.dispose();
  });
  it('torus knots are all coprime pairs, so each one is a single closed knot', () => {
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    for (const [p, q] of KNOTS) expect(gcd(p, q)).toBe(1);
  });
});

describe('arena light panels', () => {
  it('six fixed panels light up three at a time, sometimes all six', () => {
    expect(PANELS).toBe(6);
    expect(new Set(PANEL_HOMES.map(([x, y, z]) => `${x},${y},${z}`)).size).toBe(6);
    const sizes = LOOKS.map((look, index) => lookTargets(index, new Float32Array(PANELS)).reduce((a, b) => a + b, 0));
    expect(sizes.every((n) => n === 3 || n === 6)).toBe(true);
    expect(sizes).toContain(6);
    // Consecutive trios hand over to the other three panels rather than relighting the same ones.
    expect(LOOKS[0].some((p) => LOOKS[1].includes(p))).toBe(false);
  });
  it('no new mode shares the default sprite geometry, which disposing would destroy', () => {
    for (const definition of [...waveOneModeDefinitions, ...waveTwoModeDefinitions]) {
      const mode = definition.create(presetBudget('balanced')), shared = new Sprite().geometry;
      mode.scene.traverse((object) => { if (object instanceof Sprite) expect(object.geometry, definition.id).not.toBe(shared); });
      mode.dispose();
    }
  });
});
