import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { figureModeDefinitions, modeDefinitions, waveThreeModeDefinitions } from '../../src/modes/registry';
import { TempoTracker } from '../../src/modes/figures';
import { wingStroke, ISLANDS } from '../../src/modes/flightModes';
import { crowdLayout } from '../../src/modes/crowdMode';
import { createSoftBody } from '../../src/modes/jellyMode';
import { SWAMP_LAYOUT } from '../../src/modes/giantMode';
import { seededRandom } from '../../src/rendering/diagnostics';
import { presetBudget } from '../../src/rendering/quality';
import type { ModeFrame } from '../../src/modes/types';

const frame = (): ModeFrame => ({ time: 2, delta: 1 / 60, aspect: 16 / 9, spectrumMapping: 'linear', sampleRate: 48000,
  hue: 0.3, reducedMotion: false, reducedFlash: true,
  response: { bass: 0.6, loudness: 0.7, impact: 0.9, bounce: 0.5 },
  audio: { waveform: new Float32Array(1024), spectrum: new Uint8Array(512).fill(120), bass: 0.6, mid: 0.5, highs: 0.4, rms: 0.5, onset: true, time: 2 },
});

const load = (name: string) => {
  const bytes = readFileSync(`src/assets/models/${name}.glb`), loader = new GLTFLoader();
  // Node has no image decoder; the contract only needs names, so embedded textures are skipped.
  loader.register(() => ({ name: 'skip-textures', loadTexture: () => Promise.resolve(new THREE.Texture()) }) as never);
  return new Promise<GLTF>((done, fail) => loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '', done, fail));
};
const names = (gltf: GLTF) => {
  const nodes = new Set<string>(), materials = new Set<string>(), morphs = new Set<string>();
  gltf.scene.traverse((object) => {
    nodes.add(object.name);
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of [mesh.material].flat()) materials.add(material.name);
    for (const morph of Object.keys(mesh.morphTargetDictionary ?? {})) morphs.add(morph);
  });
  return { nodes, materials, morphs, clips: new Set(gltf.animations.map((clip) => clip.name)) };
};
const range = (prefix: string, count: number, pad = 2) => Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(pad, '0')}`);

/** Everything each mode looks up by name in its models; a re-exported file that drops one would break the mode. */
const CONTRACT: Record<string, { nodes?: string[]; materials?: string[]; morphs?: string[]; clips?: string[] }> = {
  swamp_giant: {
    nodes: ['Hips', 'Spine2', 'Neck', 'Head', 'Belly', 'Jaw', 'LeftArm', 'RightArm', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot'],
    materials: ['emissive_eye', 'emissive_fungus'],
    clips: ['idle', 'groove', 'arm_swing', 'clap_overhead', 'stomp_L', 'stomp_R', 'roar', 'chest_beat', 'look_around'],
  },
  swamp_props: { nodes: [...new Set(SWAMP_LAYOUT.map(([name]) => name))], materials: ['emissive_fungus'] },
  dragon: {
    nodes: ['wing_L_upper', 'wing_L_fore', 'wing_R_upper', 'wing_R_fore', 'head', 'jaw', ...range('neck_', 6), ...range('tail_', 10)],
    materials: ['emissive_vents', 'emissive_mouth'], clips: ['glide', 'breath_fire', 'roar', 'bank_L', 'bank_R'],
  },
  phoenix_fenghuang: {
    nodes: ['chest', ...range('crest_', 3).map((crest) => `${crest}_01`), ...['L', 'R'].flatMap((s) => [`wing_${s}_upper`, `wing_${s}_fore`, `wing_${s}_hand`, ...range(`wing_${s}_feather_`, 6)]),
      ...['A', 'B', 'C', 'D', 'E'].flatMap((s) => range(`tail_${s}_`, 4))],
    materials: ['emissive_plumage', 'emissive_ocelli', 'emissive_cyan_tuft', 'emissive_crest_beads', 'emissive_eye'], clips: ['glide'],
  },
  sky_spires: { nodes: [...ISLANDS] },
  mascot_blob: { nodes: ['body'], materials: ['jelly', 'emissive_core', 'emissive_cheeks'], morphs: ['squash', 'stretch', 'lean_L', 'lean_R', 'blink', 'mouth_open'], clips: ['bounce', 'jump', 'cheer', 'wave', 'look_around'] },
  crowd_props: { nodes: ['barrier_fence', 'speaker_stack', 'truss_tower', 'confetti_cannon'] },
  skeleton: { nodes: ['Spine', 'Spine2', 'Neck', 'Head', 'LeftHand', 'RightHand'], materials: ['emissive_eye'], clips: ['drum_groove', 'guitar_strum', 'bass_pluck', 'sing', 'drum_fill', 'drum_crash', 'guitar_power', 'jump'] },
  band_instruments: {
    nodes: ['stage_riser', 'drum_kit', 'mic_stand', 'amp_stack', 'guitar', 'bass_guitar', 'drumstick_L', 'drumstick_R', 'kick_head', 'snare_head', 'hihat_top', 'cymbal_crash', 'cymbal_ride'],
    materials: ['emissive_strings', 'emissive_panel', 'emissive_trim'],
  },
  jelly_blob: { nodes: ['jelly', 'jelly_face'], morphs: ['squash', 'stretch'] },
};

describe('figure mode assets', () => {
  for (const [file, expected] of Object.entries(CONTRACT)) {
    it(`${file}.glb has every part its mode looks up by name`, async () => {
      const found = names(await load(file));
      for (const kind of ['nodes', 'materials', 'morphs', 'clips'] as const) {
        for (const name of expected[kind] ?? []) expect(found[kind].has(name), `${file}: missing ${kind.slice(0, -1)} ${name}`).toBe(true);
      }
    });
  }
  it('dancers tag every vertex with a part ID in COLOR_0 red and the glow stick in its alpha', async () => {
    for (const file of ['dancer', 'dancer_b', 'dancer_c']) {
      let mesh: THREE.Mesh | undefined;
      (await load(file)).scene.traverse((object) => { if (!mesh && (object as THREE.Mesh).isMesh) mesh = object as THREE.Mesh; });
      const colour = mesh!.geometry.attributes.color;
      expect(colour.itemSize, file).toBe(4);
      const parts = new Set<number>();
      let glowing = 0;
      for (let i = 0; i < colour.count; i++) { parts.add(Math.round(colour.getX(i) * 5)); if (colour.getW(i) > 0.5) glowing++; }
      expect([...parts].sort(), file).toEqual([0, 1, 2, 3, 4, 5]);
      expect(glowing, file).toBeGreaterThan(0);
    }
  });
});

describe('figure modes', () => {
  it('register after wave three, labelled experimental, on both backends', () => {
    expect(figureModeDefinitions.map((mode) => mode.id)).toEqual(['swampGiant', 'dragon', 'phoenix', 'crowdMascot', 'skeletonBand', 'jellyBlob']);
    expect(modeDefinitions.slice(50, 56)).toEqual(figureModeDefinitions);
    expect(modeDefinitions.slice(40, 50)).toEqual(waveThreeModeDefinitions);
    for (const mode of figureModeDefinitions) { expect(mode.label.startsWith('<EXPERIMENTAL> ')).toBe(true); expect(mode.backends).toEqual(['webgpu', 'webgl2']); }
  });
  it('build, update through loud beats and a frozen clock, and dispose before their models arrive', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const definition of figureModeDefinitions) {
      const mode = definition.create(presetBudget('compatibility')), f = frame();
      for (let i = 0; i < 30; i++) { f.time += 1 / 60; f.audio = { ...f.audio, onset: i % 10 === 0 }; mode.update(f); }
      f.reducedMotion = true; f.delta = 0; mode.update(f);
      mode.dispose();
      // `ready` never rejects, even when the model cannot load (no server in unit tests).
      await expect(mode.ready).resolves.toBeUndefined();
    }
    warn.mockRestore();
  });
});

describe('figure motion helpers', () => {
  it('wing strokes rest at both ends, lift first, then bottom out in the downstroke', () => {
    expect(wingStroke(0)).toBe(0); expect(wingStroke(1)).toBe(0);
    expect(wingStroke(0.15)).toBeCloseTo(0.55);
    expect(wingStroke(0.35)).toBeCloseTo(-0.9);
    for (let t = 0; t < 1; t += 0.01) expect(Math.abs(wingStroke(t + 0.01) - wingStroke(t))).toBeLessThan(0.08);
  });
  it('tempo tracks beat spacing and folds it into 80–160 BPM', () => {
    const at = (gap: number) => {
      const tracker = new TempoTracker();
      for (let t = 0; t < 30; t += 1 / 60) tracker.update(t, Math.abs((t / gap) - Math.round(t / gap)) * gap < 1 / 120, 1 / 60);
      return tracker.timeScale;
    };
    expect(at(0.5)).toBeCloseTo(1, 1);
    expect(at(0.4)).toBeCloseTo(1.25, 1);
    expect(at(1)).toBeCloseTo(1, 1); // 60 BPM folds up to 120
  });
  it('the crowd stands on rings round the stage, facing it', () => {
    for (const [x, z, facing, , distance] of crowdLayout(500, seededRandom(1))) {
      expect(distance).toBeGreaterThanOrEqual(8.5); expect(distance).toBeLessThanOrEqual(26);
      // Facing +Z rotated by `facing` points back at the origin.
      expect(Math.sin(facing) * x + Math.cos(facing) * z).toBeCloseTo(-Math.hypot(x, z), 5);
    }
  });
  it('soft body welds seams, springs back after a kick, and keeps its base pinned', () => {
    const geometry = new THREE.SphereGeometry(1, 16, 12); geometry.translate(0, 1, 0);
    const body = createSoftBody(geometry.attributes.position as THREE.BufferAttribute, geometry.index);
    expect(body.count).toBeLessThan(geometry.attributes.position.count);
    for (let p = 0; p < body.count; p++) body.kick(p, 1, -1, 0);
    let peak = 0;
    for (let i = 0; i < 30; i++) { body.step(1 / 60); peak = Math.max(peak, ...Array.from(body.offset).map(Math.abs)); }
    expect(peak).toBeGreaterThan(0.02);
    for (let i = 0; i < 600; i++) body.step(1 / 60);
    expect(Math.max(...Array.from(body.offset).map(Math.abs))).toBeLessThan(1e-3);
    const bottom = Array.from({ length: body.count }, (_, p) => p).find((p) => body.home[p * 3 + 1] < 1e-6)!;
    body.kick(bottom, 5, 5, 5); body.step(1 / 60);
    expect(Math.abs(body.offset[bottom * 3 + 1])).toBe(0);
  });
});
