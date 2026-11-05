import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { instantiate } from '../../src/modes/figures';
import { createGiantPerformance } from '../../src/modes/giantPerformance';
import type { ModeFrame } from '../../src/modes/types';

const load = async () => {
  const bytes = readFileSync('src/assets/models/swamp_giant.glb');
  return new Promise<GLTF>((done, fail) => new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', done, fail));
};
const frame = (): ModeFrame => ({ time: 0, delta: 1 / 60, aspect: 16 / 9, spectrumMapping: 'linear', sampleRate: 48000, hue: 0,
  reducedMotion: false, reducedFlash: false, response: { bass: 0.7, loudness: 0.8, impact: 0, bounce: 0.7 },
  audio: { waveform: new Float32Array(1024), spectrum: new Uint8Array(512), bass: 0.7, mid: 0.6, highs: 0.4, rms: 0.6, onset: false, time: 0 } });

describe('rebuilt swamp ogre', () => {
  it('has a detailed smooth rig, real mouth/club sockets, and normalized skin weights', async () => {
    const model = await load(), figure = instantiate(model), nodes = new Set<string>();
    let triangles = 0, maxWeightError = 0;
    figure.root.traverse(object => {
      if ((object as THREE.Bone).isBone) { expect(nodes.has(object.name)).toBe(false); nodes.add(object.name); }
      const mesh = object as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
      if (mesh.isSkinnedMesh) {
        const w = mesh.geometry.attributes.skinWeight;
        for (let i = 0; i < w.count; i++) maxWeightError = Math.max(maxWeightError, Math.abs(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i) - 1));
      }
    });
    expect(triangles).toBeGreaterThan(50000); expect(triangles).toBeLessThan(110000);
    expect(maxWeightError).toBeLessThan(1e-5);
    expect((figure.node('Jaw') as THREE.Bone).isBone).toBe(true);
    expect(figure.node('socket_mouth').getWorldPosition(new THREE.Vector3()).toArray()).toEqual(expect.arrayContaining([expect.any(Number)]));
    expect(figure.node('socket_club_tip')).toBeDefined();
    expect(figure.materials.has('mouth_cavity')).toBe(true);
    expect(readFileSync('src/assets/models/swamp_giant.glb').includes(Buffer.from('/Users/'))).toBe(false);
  });

  it('waves, swings, jumps and fires from distinct beats, then lands and settles', async () => {
    const figure = instantiate(await load()), performance = createGiantPerformance(figure), f = frame();
    const tick = (n = 1) => { for (let i = 0; i < n; i++) { f.time += f.delta; performance.update(f); } };
    const beat = () => { f.audio = { ...f.audio, onset: true }; f.response = { ...f.response, impact: 1 }; tick(); f.audio = { ...f.audio, onset: false }; f.response = { ...f.response, impact: 0 }; };
    const tip = () => figure.node('socket_club_tip').getWorldPosition(new THREE.Vector3());
    tick(); const restTip = tip(); beat(); tick(15);
    expect(performance.state.action).toBe('club sweep'); expect(tip().distanceTo(restTip)).toBeGreaterThan(1);
    tick(15); beat(); tick(15);
    expect(performance.state.action).toBe('wave');
    expect(figure.node('LeftHand').getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(7);
    tick(15); beat(); tick(20);
    expect(performance.state.jumpHeight).toBeGreaterThan(1);
    const start = [...performance.state.position];
    tick(10); beat(); tick(14);
    expect(performance.state.beam).toBeGreaterThan(0.5); expect(performance.state.jaw).toBeGreaterThan(0.6);
    tick(70);
    expect(performance.state.jumpHeight).toBe(0); expect(performance.state.beam).toBe(0);
    expect(Math.abs(performance.state.position[0] - start[0])).toBeGreaterThan(0.01);
    expect(performance.state.position[1]).toBeCloseTo(0, 4);
    expect(figure.root.position.toArray().every(Number.isFinite)).toBe(true);
  });

  it('does not retrigger a held onset, caps flashes and freezes the whole pose', async () => {
    const figure = instantiate(await load()), performance = createGiantPerformance(figure), f = frame();
    f.audio = { ...f.audio, onset: true };
    for (let i = 0; i < 120; i++) performance.update(f);
    expect(performance.state.beats).toBe(1);
    for (let beat = 0; beat < 3; beat++) {
      f.audio = { ...f.audio, onset: false }; for (let i = 0; i < 30; i++) performance.update(f);
      f.audio = { ...f.audio, onset: true }; performance.update(f);
    }
    f.reducedFlash = true; f.audio = { ...f.audio, onset: false };
    for (let i = 0; i < 15; i++) performance.update(f);
    expect(performance.state.flash).toBeGreaterThan(0); expect(performance.state.flash).toBeLessThanOrEqual(0.4);
    const state = JSON.stringify(performance.state), head = figure.node('Head').quaternion.clone(), position = figure.root.position.clone();
    f.reducedMotion = true; f.delta = 30;
    for (let i = 0; i < 20; i++) performance.update(f);
    expect(figure.node('Head').quaternion.toArray()).toEqual(head.toArray()); expect(figure.root.position.toArray()).toEqual(position.toArray());
    expect(JSON.parse(state)).toMatchObject({ clock: performance.state.clock, jaw: performance.state.jaw, beam: performance.state.beam });
  });
});
