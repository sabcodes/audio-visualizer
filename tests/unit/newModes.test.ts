import { describe, expect, it } from 'vitest';
import { BoxGeometry, DodecahedronGeometry, IcosahedronGeometry, OctahedronGeometry, TetrahedronGeometry } from 'three/webgpu';
import { waveOneModeDefinitions, waveTwoModeDefinitions, waveThreeModeDefinitions, modeDefinitions } from '../../src/modes/registry';
import { flowVelocity, RD_PRESETS } from '../../src/modes/feedbackModes';
import { ATTRACTORS, seedAlongOrbit, physarumStep, diffuseTrail, createReiter } from '../../src/modes/generativeModes';
import { tonearmYaw, GLYPHS, glyphAtlas, ledZone, LED_SEGMENTS } from '../../src/modes/retroModes';
import { lightningPath } from '../../src/modes/stormMode';
import { Vector3 } from 'three/webgpu';
import { chladni, CHLADNI_MODES, KNOTS } from '../../src/modes/geometricModes';
import { tentacleBend, KRAKEN_SEGMENTS } from '../../src/modes/creatureModes';
import { fireworkKind } from '../../src/modes/nightModes';
import { chromeMatcap } from '../../src/modes/physicsModes';
import { BEAM_PROGRAMS, LOOKS, MAX_TILT, PANEL_HOMES, PANELS, beamAim, lookTargets } from '../../src/modes/arenaMode';
import { Sprite } from 'three/webgpu';
import { epicycleShape, epicycleTerms, polyhedronSegments, POLY_SEGMENTS, pendulumPhase, PENDULUMS, PENDULUM_CYCLE, EPICYCLE_SHAPES } from '../../src/modes/geometricModes';
import { ridgeProfile } from '../../src/modes/landscapeModes';
import { poseTargets, ROBOT_POSES, ROBOT_JOINTS } from '../../src/modes/robotMode';
import { bandEnergies, beatGate, settleStep } from '../../src/modes/shared';
import { CalmAudio } from '../../src/audio/calmAudio';
import { createBeatPulse } from '../../src/modes/beatPulse';
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
  it('moving heads sweep smoothly, stay below the horizon and swing up and down', () => {
    for (let program = 0; program < BEAM_PROGRAMS; program++) {
      let low = Infinity, high = -Infinity;
      for (let m = 0; m < 20; m += 0.01) {
        const [tilt, pan] = beamAim(program, m, 2, 3), [nextTilt, nextPan] = beamAim(program, m + 0.01, 2, 3);
        expect(tilt).toBeGreaterThanOrEqual(0); expect(tilt).toBeLessThanOrEqual(MAX_TILT); expect(Math.abs(pan)).toBeLessThan(0.6);
        // No snaps: a hundredth of the motion clock moves a head by well under a degree.
        expect(Math.abs(nextTilt - tilt) + Math.abs(nextPan - pan)).toBeLessThan(0.015);
        low = Math.min(low, tilt); high = Math.max(high, tilt);
      }
      expect(high - low, `program ${program}`).toBeGreaterThan(0.3);
    }
  });
  it('no new mode shares the default sprite geometry, which disposing would destroy', () => {
    for (const definition of [...waveOneModeDefinitions, ...waveTwoModeDefinitions]) {
      const mode = definition.create(presetBudget('balanced')), shared = new Sprite().geometry;
      mode.scene.traverse((object) => { if (object instanceof Sprite) expect(object.geometry, definition.id).not.toBe(shared); });
      mode.dispose();
    }
  });
});

describe('reduced motion', () => {
  const audio = (level: number, onset = false) => ({ waveform: new Float32Array(8), spectrum: new Uint8Array(512).fill(level), bass: level / 255, mid: 0, highs: 0, rms: level / 255, onset, time: 0 });
  it('calms audio: no onsets, the first frame snaps, later jumps ease in over about half a second', () => {
    const calm = new CalmAudio();
    const first = calm.update(audio(200, true), 1 / 60);
    expect(first.onset).toBe(false); expect(first.spectrum[10]).toBe(200); expect(first.bass).toBeCloseTo(200 / 255);
    const eased = calm.update(audio(0, true), 1 / 60);
    expect(eased.spectrum[10]).toBeGreaterThan(190); expect(eased.bass).toBeGreaterThan(0.7);
    for (let i = 0; i < 180; i++) calm.update(audio(0), 1 / 60);
    expect(calm.update(audio(0), 1 / 60).spectrum[10]).toBeLessThan(5);
    calm.reset(); expect(calm.update(audio(120), 1 / 60).spectrum[10]).toBe(120);
  });
  it('settles transients with a nominal step while the clock is frozen', () => {
    expect(settleStep({ delta: 0, reducedMotion: true })).toBeCloseTo(1 / 60);
    expect(settleStep({ delta: 0.02, reducedMotion: false })).toBe(0.02);
  });
  it('beat pulse ripples on a beat and fades out, but never moves with reduced motion', () => {
    const pulse = createBeatPulse(), f = frame();
    f.response = { bass: 0.5, loudness: 0.5, impact: 0.8, bounce: 0.6 };
    pulse.update(f, true);
    expect(pulse.ripple).toBeGreaterThan(0.5); expect(pulse.surge.value).toBeCloseTo(0.6);
    for (let i = 0; i < 90; i++) pulse.update(f, false);
    expect(pulse.ripple).toBe(0);
    const still = createBeatPulse(), g = frame(); g.reducedMotion = true; g.delta = 0;
    still.update(g, true);
    expect(still.ripple).toBe(0);
  });
  it('every new mode holds a finite still with a frozen clock, even through loud frames', () => {
    for (const definition of [...waveOneModeDefinitions, ...waveTwoModeDefinitions, ...waveThreeModeDefinitions]) {
      const mode = definition.create(presetBudget('compatibility')), f = frame();
      f.reducedMotion = true; f.delta = 0;
      f.audio.spectrum.fill(200); f.audio = { ...f.audio, bass: 0.9, mid: 0.8, highs: 0.7, rms: 0.6 };
      f.response = { bass: 0.8, loudness: 0.8, impact: 0.2, bounce: 0.2 };
      for (let i = 0; i < 60; i++) mode.update(f);
      mode.scene.updateMatrixWorld(true);
      mode.scene.traverse((object) => { for (const value of object.matrixWorld.elements) expect(Number.isFinite(value), definition.id).toBe(true); });
      mode.dispose();
    }
  });
});

describe('wave three modes', () => {
  it('registers ten more ids after wave two, all on both backends', () => {
    expect(waveThreeModeDefinitions.map((mode) => mode.id)).toEqual(['reactionDiffusion', 'feedback', 'curlFlow', 'attractor', 'physarum', 'snowflake', 'turntable', 'ascii', 'ledAnalyzer', 'storm']);
    expect(modeDefinitions.slice(40, 50)).toEqual(waveThreeModeDefinitions);
    for (const mode of waveThreeModeDefinitions) expect(mode.backends).toEqual(['webgpu', 'webgl2']);
    expect(new Set(modeDefinitions.map((mode) => mode.id)).size).toBe(modeDefinitions.length);
  });
  it('each mode builds, survives silence, loud onsets and a stalled frame, then disposes', () => {
    for (const definition of waveThreeModeDefinitions) {
      const mode = definition.create(presetBudget('compatibility')), f = frame();
      mode.update(f);
      f.audio.spectrum.fill(220); f.audio.waveform.fill(0.4);
      f.audio = { ...f.audio, bass: 1, mid: 1, highs: 1, onset: true, rms: 0.5 };
      f.response = { bass: 1, loudness: 1, impact: 1, bounce: 1 }; f.reducedFlash = false;
      for (let i = 0; i < 60; i++) { f.time += 1 / 60; mode.update(f); }
      f.delta = 3; f.spectrumMapping = 'log'; mode.update(f);
      mode.scene.traverse((object) => {
        const position = (object as { geometry?: { attributes?: { position?: { array: ArrayLike<number> } } } }).geometry?.attributes?.position;
        if (position) expect(Array.from(position.array).every(Number.isFinite), definition.id).toBe(true);
        for (const value of [object.position.x, object.position.y, object.rotation.y, object.scale.y]) expect(Number.isFinite(value), definition.id).toBe(true);
      });
      mode.dispose();
      expect(mode.scene.children).toHaveLength(0);
    }
  });
  it('flow velocity is divergence-free, so streams never pile up', () => {
    // Float64 buffers so the finite differences aren't swamped by float32 rounding.
    const buffer = () => new Float64Array(2) as unknown as Float32Array, at = buffer(), dx = buffer(), dy = buffer(), h = 1e-5;
    for (const [x, y, t] of [[0.1, 0.2, 0], [-1.3, 0.7, 4], [1.8, -0.9, 11]]) {
      flowVelocity(x + h, y, t, 1.3, dx); flowVelocity(x - h, y, t, 1.3, at);
      const ddx = (dx[0] - at[0]) / (2 * h);
      flowVelocity(x, y + h, t, 1.3, dy); flowVelocity(x, y - h, t, 1.3, at);
      expect(Math.abs(ddx + (dy[1] - at[1]) / (2 * h))).toBeLessThan(1e-4);
    }
  });
  it('reaction-diffusion presets stay inside the Gray-Scott pattern-forming region', () => {
    for (const [feed, kill] of RD_PRESETS) { expect(feed).toBeGreaterThan(0.01); expect(feed).toBeLessThan(0.09); expect(kill).toBeGreaterThan(0.045); expect(kill).toBeLessThan(0.07); }
  });
  it('every attractor stays bounded from seeds along its orbit', () => {
    const d = new Float32Array(3), random = (() => { let s = 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    for (const attractor of ATTRACTORS) {
      const state = new Float32Array(30);
      seedAlongOrbit(attractor, 10, state, random);
      for (let step = 0; step < 4000; step++) for (let i = 0; i < 10; i++) {
        attractor.derive(state[i * 3], state[i * 3 + 1], state[i * 3 + 2], 0.5, d);
        for (let k = 0; k < 3; k++) state[i * 3 + k] += d[k] * attractor.dt;
      }
      for (let i = 0; i < 10; i++) {
        const r = Math.hypot(state[i * 3] - attractor.center[0], state[i * 3 + 1] - attractor.center[1], state[i * 3 + 2] - attractor.center[2]) * attractor.scale;
        expect(r, attractor.name).toBeLessThan(3);
      }
    }
  });
  it('physarum agents stay on the torus and deposit, and diffusion only loses trail to decay', () => {
    const w = 40, h = 30, agents = new Float32Array([5, 5, 0, 39.5, 29.5, 1, 0.2, 15, 3]), trail = new Float32Array(w * h);
    for (let i = 0; i < 50; i++) physarumStep(agents, trail, w, h, { sensorAngle: 0.5, sensorDistance: 4, turn: 0.4, speed: 1.3, repel: i % 2 === 0 }, () => 1, Math.random);
    for (let i = 0; i < agents.length; i += 3) { expect(agents[i]).toBeGreaterThanOrEqual(0); expect(agents[i]).toBeLessThan(w); expect(agents[i + 1]).toBeGreaterThanOrEqual(0); expect(agents[i + 1]).toBeLessThan(h); }
    const total = trail.reduce((a, b) => a + b, 0), out = new Float32Array(w * h);
    expect(total).toBeCloseTo(150);
    diffuseTrail(trail, out, w, h, 0.9);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(total * 0.9, 3);
  });
  it('the Reiter crystal grows with six-fold symmetry', () => {
    const crystal = createReiter(30), params = { alpha: 1, beta: 0.4, gamma: 0.002 };
    crystal.reset(params.beta);
    for (let i = 0; i < 400; i++) crystal.step(params);
    expect(crystal.extent).toBeGreaterThan(3);
    const at = (q: number, r: number) => crystal.s[(q + 30) * crystal.size + (r + 30)];
    // Rotating (q, r) by 60° about the centre maps to (-r, q + r).
    for (const [q, r] of [[4, 1], [7, -2], [2, 5]]) expect(at(-r, q + r)).toBeCloseTo(at(q, r), 4);
  });
  it('the tonearm yaw puts the stylus at the requested radius', () => {
    const pivot: [number, number] = [22, -14];
    for (const radius of [14, 10, 6]) {
      const yaw = tonearmYaw(pivot, 26.6, radius);
      expect(Math.hypot(pivot[0] + Math.cos(yaw) * 26.6, pivot[1] + Math.sin(yaw) * 26.6)).toBeCloseTo(radius, 4);
    }
  });
  it('the glyph ramp grows denser, and the atlas packs every glyph', () => {
    const lit = GLYPHS.map((glyph) => glyph.join('').split('#').length - 1);
    expect(lit[0]).toBe(0); expect(lit[lit.length - 1]).toBeGreaterThan(lit[1]);
    const atlas = glyphAtlas();
    expect(atlas.image.width).toBe(GLYPHS.length * 5); expect(atlas.image.height).toBe(7);
    atlas.dispose();
  });
  it('LED zones run green, amber, red from the bottom', () => {
    expect(ledZone(0)).toBe(0); expect(ledZone(LED_SEGMENTS - 1)).toBe(2);
    expect(Array.from({ length: LED_SEGMENTS }, (_, s) => ledZone(s))).toEqual([...Array.from({ length: LED_SEGMENTS }, (_, s) => ledZone(s))].sort());
  });
  it('lightning runs from cloud to ground in connected segments', () => {
    const out = new Float32Array(160 * 6), top = new Vector3(0, 110, -100), bottom = new Vector3(10, 0, -90);
    const written = lightningPath(top, bottom, Math.random, out);
    expect(written).toBeGreaterThan(64);
    expect(out[1]).toBeCloseTo(110); expect(out[63 * 6 + 4]).toBeCloseTo(0);
    for (let i = 1; i < 64; i++) for (let k = 0; k < 3; k++) expect(out[i * 6 + k]).toBeCloseTo(out[(i - 1) * 6 + 3 + k]);
  });
});
