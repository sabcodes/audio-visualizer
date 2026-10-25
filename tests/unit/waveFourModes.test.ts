import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { modeDefinitions, waveFourModeDefinitions } from '../../src/modes/registry';
import { createHits, variantSequence } from '../../src/modes/hitPulse';
import { generateMaze, mazeCorridors, MAZE_WINDOWS } from '../../src/modes/natureModes';
import { HAND_TIMING, handVisit } from '../../src/modes/moonPondMode';
import { ORB_RADII, stepOrbs, stepBlobs, type Blob } from '../../src/modes/lensModes';
import { BOWTIE_SHAPES, bowtieBlend } from '../../src/modes/bilateralModes';
import { GROWTH_FORMS, growForm } from '../../src/modes/bloomTouchMode';
import { WAREHOUSE_GRADES } from '../../src/modes/kitModes';
import { STAIR_COLOURS, UNDERGROUND_ANGLES } from '../../src/modes/interiorModes';
import { SCULPTURES } from '../../src/modes/creatureKitModes';
import { seededRandom } from '../../src/rendering/diagnostics';
import { presetBudget } from '../../src/rendering/quality';
import type { ModeFrame } from '../../src/modes/types';

const frame = (): ModeFrame => ({ time: 2, delta: 1 / 60, aspect: 16 / 9, spectrumMapping: 'linear', sampleRate: 48000,
  hue: 0.3, reducedMotion: false, reducedFlash: true,
  response: { bass: 0, loudness: 0, impact: 0, bounce: 0 },
  audio: { waveform: new Float32Array(1024), spectrum: new Uint8Array(512), bass: 0, mid: 0, highs: 0, rms: 0, onset: false, time: 2 },
});

const IDS = ['prismBowtie', 'blockBowtie', 'pongOrbs', 'candyOrb', 'moonPond', 'liquidChrome', 'mirrorPlasma', 'grainSmoke', 'anamorphicFlare', 'hairVortex',
  'windfield', 'blackMaze', 'starfallCanopy', 'silkThreads', 'chromeStreaks', 'signalNight', 'beaconRings', 'lightLeakFilm', 'warehouseHall', 'redStairwell',
  'underground', 'endlessStairs', 'templeDescent', 'lavaGolem', 'lightForest', 'redCrystalHall', 'poleSparks', 'bloomTouch', 'emberSmoke'];

describe('wave four modes', () => {
  it('registers all 29 spec modes after the figure modes, labelled experimental-wave4', () => {
    expect(waveFourModeDefinitions.map((mode) => mode.id).sort()).toEqual([...IDS].sort());
    expect(modeDefinitions.slice(56, 85)).toEqual(waveFourModeDefinitions);
    for (const mode of waveFourModeDefinitions) {
      expect(mode.label.startsWith('<experimental-wave4> ')).toBe(true);
      expect(mode.backends).toEqual(['webgpu', 'webgl2']);
    }
  });
  it('each mode builds, survives silence, loud onsets and a stalled frame, then disposes', () => {
    for (const definition of waveFourModeDefinitions) {
      const mode = definition.create(presetBudget('compatibility')), f = frame();
      expect(mode.scene.children.length, definition.id).toBeGreaterThan(0);
      mode.update(f);
      f.audio.spectrum.fill(220); f.audio.waveform.fill(0.4);
      f.audio = { ...f.audio, bass: 1, mid: 1, highs: 1, onset: true };
      f.response = { bass: 1, loudness: 1, impact: 1, bounce: 1 }; f.reducedFlash = false;
      for (let i = 0; i < 90; i++) { f.time += 1 / 60; mode.update(f); }
      f.reducedMotion = true; f.delta = 3; f.spectrumMapping = 'log'; mode.update(f);
      mode.scene.traverse((object) => {
        for (const value of [object.position.x, object.position.y, object.position.z, object.rotation.x, object.scale.y]) expect(Number.isFinite(value), definition.id).toBe(true);
      });
      mode.dispose();
      expect(mode.scene.children, definition.id).toHaveLength(0);
    }
  });
});

describe('hit envelope (wave 4 pacing)', () => {
  it('never picks the same variant twice in a row', () => {
    const sequence = variantSequence(5, 3);
    let previous = sequence.current;
    for (let i = 0; i < 200; i++) { const next = sequence.next(); expect(next).not.toBe(previous); previous = next; }
  });
  it('attacks in one frame, decays fast, and caps reduced-flash hits at three a second', () => {
    const hits = createHits({ decay: 0.15, interval: 0.1 }), f = frame();
    f.reducedFlash = false; f.audio = { ...f.audio, onset: true };
    expect(hits.update(f).level).toBe(1);
    f.audio = { ...f.audio, onset: false };
    for (let i = 0; i < 18; i++) { f.time += 1 / 60; hits.update(f); }
    expect(hits.level).toBeLessThan(1 / 3); // At least a 3× fall within 300 ms.
    const capped = createHits({ decay: 0.15, interval: 0.1 }), g = frame();
    g.reducedFlash = true; g.audio = { ...g.audio, onset: true };
    let fired = 0;
    for (let i = 0; i < 60; i++) { g.time += 1 / 60; if (capped.update(g).fired) fired++; }
    expect(fired).toBeLessThanOrEqual(3);
    expect(capped.flash).toBeLessThanOrEqual(0.4);
  });
});

describe('wave four helpers', () => {
  it('generates a perfect 9×9 maze: every cell open and reachable', () => {
    const open = generateMaze(9), size = 19, seen = new Set<number>([size + 1]), queue = [size + 1];
    while (queue.length) {
      const i = queue.pop()!;
      for (const step of [1, -1, size, -size]) if (open[i + step] && !seen.has(i + step)) { seen.add(i + step); queue.push(i + step); }
    }
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) expect(seen.has((y * 2 + 1) * size + x * 2 + 1)).toBe(true);
    // A tree on 81 cells has exactly 80 passages.
    expect(open.reduce((sum, v) => sum + v, 0)).toBe(81 + 80);
    for (const [x, y] of MAZE_WINDOWS) { expect(x).toBeGreaterThan(0); expect(y).toBeLessThan(9); }
  });
  it('finds open corridors in the maze for the inside-the-maze camera', () => {
    const open = generateMaze(9), runs = mazeCorridors(open);
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) for (let i = 0; i <= run.length; i++) expect(open[(run.y + run.dy * i) * 19 + run.x + run.dx * i]).toBe(1);
  });
  it('walks the Moon Pond hand through reach, touch, lift and away', () => {
    const { descend, touch, lift } = HAND_TIMING;
    expect(handVisit(0)).toEqual({ phase: 'descend', reach: 0 });
    expect(handVisit(descend + 1)).toEqual({ phase: 'touch', reach: 1 });
    expect(handVisit(descend + touch + lift / 2).phase).toBe('lift');
    expect(handVisit(descend + touch + lift + 5)).toEqual({ phase: 'away', reach: 0 });
    for (let t = 0; t < descend; t += 0.1) expect(handVisit(t + 0.1).reach).toBeGreaterThanOrEqual(handVisit(t).reach);
  });
  it('keeps the orbs in frame and apart', () => {
    const orbs = ORB_RADII.map((r, i) => ({ x: i * 0.1, y: 0, vx: 3, vy: -2, r }));
    for (let i = 0; i < 600; i++) stepOrbs(orbs, 16 / 9, 1 / 60);
    for (const orb of orbs) { expect(Math.abs(orb.x)).toBeLessThanOrEqual(8 / 9); expect(Math.abs(orb.y)).toBeLessThanOrEqual(0.5); }
  });
  it('liquid blobs settle toward their targets without blowing up', () => {
    const blobs: Blob[] = Array.from({ length: 6 }, (_, i) => ({ x: 0, y: 0, vx: 1, vy: 0, r: 0.1, tx: i * 0.1 - 0.25, ty: 0, life: 0 }));
    for (let i = 0; i < 600; i++) stepBlobs(blobs, 16 / 9, 1 / 60, 0.5);
    for (const blob of blobs) expect(Number.isFinite(blob.x) && Math.abs(blob.x) <= 8 / 9).toBe(true);
  });
  it('blends two bowtie silhouettes per hit with weights that sum to one', () => {
    const random = seededRandom(1);
    for (let primary = 0; primary < BOWTIE_SHAPES; primary++) {
      const weights = bowtieBlend(primary, frame(), random);
      expect(weights.reduce((a, b) => a + b)).toBeCloseTo(1);
      expect(weights[primary]).toBeGreaterThan(0.5);
      expect(weights.filter((w) => w > 0).length).toBe(2);
    }
  });
  it('grows each bloom form from the fingertip, with stems, leaves and several flower shapes', () => {
    for (const form of GROWTH_FORMS) {
      const elements = growForm(form, 4, 900);
      expect(elements.length, form).toBeGreaterThan(20);
      expect(elements.length).toBeLessThanOrEqual(900);
      expect(elements.some((e) => e.kind === 0) && elements.some((e) => e.kind >= 1 && e.kind <= 3), form).toBe(true);
      expect(new Set(elements.filter((e) => e.kind >= 4).map((e) => e.kind)).size, form).toBeGreaterThan(1);
      // The earliest elements sit at the fingertip.
      const first = [...elements].sort((a, b) => a.at - b.at)[0];
      expect(Math.hypot(first.x, first.y), form).toBeLessThan(0.05);
    }
  });
  it('cycles colours the spec lists', () => {
    expect(WAREHOUSE_GRADES).toHaveLength(3);
    expect(STAIR_COLOURS).toHaveLength(5);
    expect(UNDERGROUND_ANGLES.length).toBeGreaterThanOrEqual(3);
  });
});

// The supplied kits embed textures, which Node can't decode; skip images and check names only.
const load = (name: string) => {
  const bytes = readFileSync(`src/assets/wave4/${name}.glb`);
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'skip-textures', loadTexture: () => Promise.resolve(new THREE.Texture()) }) as never);
  return new Promise<GLTF>((done, fail) => loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '', done, fail));
};
const CONTRACT: Record<string, { nodes: string[]; materials: string[]; clips?: string[]; morphs?: string[] }> = {
  kitA: { nodes: ['wall_plain', 'wall_window', 'wall_pipes', 'pillar_square', 'girder_straight', 'floor_slab', 'catwalk_grate', 'ceiling_slab', 'stair_flight', 'stair_landing', 'light_tube', 'shaft_ring', 'rail_track', 'tram_carriage', 'panel_red'], materials: ['emissive_panel', 'emissive_tube', 'emissive_window'] },
  kitB: { nodes: ['tier_a', 'tier_b', 'tier_c', 'ledge', 'cap_slab', 'chain', 'lantern_a', 'lantern_b'], materials: ['kitB_atlas', 'emissive_lantern'] },
  kitC: { nodes: SCULPTURES.map(([name]) => name), materials: ['emissive_line'], morphs: ['wings_down'] },
  kitG: { nodes: ['torso', 'arm_l', 'leg_l'], materials: ['kitG_atlas', 'emissive_cracks'], clips: ['idle', 'stomp', 'slam', 'turn'] },
  kitH: { nodes: ['stair_flight', 'stair_landing', 'scaffold_tube_4m', 'scaffold_clamp', 'floor_plate', 'handrail', 'strip_light'], materials: ['emissive_strip'] },
  coupe: { nodes: ['coupe'], materials: ['emissive_headlight', 'emissive_taillight'] },
};

describe('wave four asset contract', () => {
  it.each(Object.entries(CONTRACT))('%s has every node, material, morph and clip the modes look up', async (name, contract) => {
    const gltf = await load(name), nodes = new Set<string>(), materials = new Set<string>(), morphs = new Set<string>();
    gltf.scene.traverse((object) => {
      nodes.add(object.name);
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of [mesh.material].flat()) materials.add(material.name);
      for (const morph of Object.keys(mesh.morphTargetDictionary ?? {})) morphs.add(morph);
    });
    for (const node of contract.nodes) expect(nodes.has(node), node).toBe(true);
    for (const material of contract.materials) expect(materials.has(material), material).toBe(true);
    for (const morph of contract.morphs ?? []) expect(morphs.has(morph), morph).toBe(true);
    for (const clip of contract.clips ?? []) expect(gltf.animations.some((a) => a.name === clip), clip).toBe(true);
  });
});
