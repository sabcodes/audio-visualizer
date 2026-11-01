import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSpaceShipMode, shipFlightPose, SPACE_SHIP_SHOTS, SHIP_CANNONS, SHIP_EXHAUSTS } from '../../src/modes/spaceShipMode';
import { presetBudget } from '../../src/rendering/quality';
import type { ModeFrame } from '../../src/modes/types';

const frame = (): ModeFrame => ({ time: 0, delta: 0.1, aspect: 16 / 9, spectrumMapping: 'linear', sampleRate: 48000,
  hue: 0, reducedMotion: false, reducedFlash: false, sensitivity: 1.8,
  response: { bass: 0, loudness: 0, impact: 0, bounce: 0 },
  audio: { waveform: new Float32Array(1024), spectrum: new Uint8Array(512), bass: 0, mid: 0, highs: 0, rms: 0, onset: false, time: 0 },
});

describe('Space Ship flight', () => {
  it('tours every angle, completes a roll and clears the near-miss asteroid while keeping lasers quiet in silence', () => {
    const mode = createSpaceShipMode(presetBudget('compatibility')), f = frame(), seen = new Set<string>();
    let nearMiss = false;
    for (let i = 0; i < 650; i++) {
      mode.update(f); seen.add(mode.scene.userData.shot);
      expect(mode.scene.userData.activeLasers).toBe(0);
      const obstacle = mode.scene.getObjectByName('slalom near miss')!;
      if (obstacle.visible && Math.abs(obstacle.position.z) < 7) {
        nearMiss = true;
        expect(mode.scene.getObjectByName('Arwing flight rig')!.position.distanceTo(obstacle.position)).toBeGreaterThan(7);
      }
      expect(mode.camera.position.toArray().every(Number.isFinite)).toBe(true);
    }
    expect([...seen]).toEqual(SPACE_SHIP_SHOTS.map((s) => s.name));
    expect(nearMiss).toBe(true);
    expect(shipFlightPose('roll', 0).roll).toBe(0);
    expect(shipFlightPose('roll', 0.5).roll).toBeCloseTo(Math.PI);
    expect(shipFlightPose('roll', 1).roll).toBeCloseTo(Math.PI * 2);
    expect(shipFlightPose('dodge', 1).x).toBeCloseTo(0);
    mode.dispose(); expect(mode.scene.children).toHaveLength(0);
  });

  it('puts sensitivity-scaled bounce into stars and planets while ship choreography stays identical', () => {
    const quiet = createSpaceShipMode(presetBudget('compatibility')), music = createSpaceShipMode(presetBudget('compatibility'));
    const a = frame(), b = frame(); b.response = { ...b.response, bounce: 1 };
    for (let i = 0; i < 20; i++) { quiet.update(a); music.update(b); }
    expect(music.scene.userData.pulse).toBeGreaterThan(0.9);
    expect(quiet.scene.userData.pulse).toBe(0);
    expect(music.scene.getObjectByName('Aurelia ringed giant')!.scale.x).toBeGreaterThan(quiet.scene.getObjectByName('Aurelia ringed giant')!.scale.x);
    expect(music.scene.getObjectByName('Arwing flight rig')!.position.equals(quiet.scene.getObjectByName('Arwing flight rig')!.position)).toBe(true);
    b.sensitivity = 0.45;
    for (let i = 0; i < 30; i++) music.update(b);
    expect(music.scene.userData.pulse).toBeCloseTo(0.25, 3);
    b.reducedFlash = true;
    for (let i = 0; i < 30; i++) music.update(b);
    expect(music.scene.userData.pulse).toBeLessThan(0.06);
    quiet.dispose(); music.dispose();
  });

  it('freezes flight, camera, exhaust, debris and lasers with reduced motion and bounds stalled frames', () => {
    const mode = createSpaceShipMode(presetBudget('compatibility')), f = frame();
    while (mode.scene.userData.maneuver !== 'lasers') mode.update(f);
    for (let i = 0; i < 20; i++) mode.update(f);
    f.audio = { ...f.audio, onset: true }; f.response = { ...f.response, impact: 1 }; mode.update(f);
    f.reducedMotion = true; f.delta = 30;
    mode.update(f);
    const position = mode.camera.position.clone(), rotation = mode.camera.quaternion.clone();
    const actor = mode.scene.getObjectByName('Arwing flight rig')!, shipPosition = actor.position.clone(), shipRotation = actor.quaternion.clone();
    const bolt = mode.scene.children.find((o) => o.name === 'cannon bolt' && o.visible)!, boltPosition = bolt.position.clone();
    const exhaust = mode.scene.getObjectByName('ion exhaust')!, exhaustScale = exhaust.scale.clone();
    for (let i = 0; i < 80; i++) mode.update(f);
    expect(mode.camera.position.equals(position)).toBe(true); expect(mode.camera.quaternion.equals(rotation)).toBe(true);
    expect(actor.position.equals(shipPosition)).toBe(true); expect(actor.quaternion.equals(shipRotation)).toBe(true);
    expect(bolt.position.equals(boltPosition)).toBe(true); expect(exhaust.scale.equals(exhaustScale)).toBe(true);
    f.reducedMotion = false; mode.update(f);
    expect(mode.scene.userData.maneuver).toBe('lasers');
    expect(mode.scene.userData.phase).toBeLessThan(0.4);
    mode.dispose();
  });

  it('surges the exhaust and fires exactly one twin volley per fresh beat, including impact-only detections', () => {
    const mode = createSpaceShipMode(presetBudget('compatibility')), f = frame();
    while (mode.scene.userData.maneuver !== 'lasers') mode.update(f);
    f.delta = 1 / 60;
    const exhaust = mode.scene.getObjectByName('ion exhaust')!, idleLength = exhaust.scale.z;
    const step = (onset: boolean, impact: number, count = 1) => {
      f.audio = { ...f.audio, onset }; f.response = { ...f.response, impact };
      for (let i = 0; i < count; i++) mode.update(f);
    };
    step(true, 0.9);
    expect(mode.scene.userData.activeLasers).toBe(2);
    expect(exhaust.scale.z).toBeGreaterThan(idleLength + 2);
    const peak = exhaust.scale.z;
    step(true, 0.9, 24); // A held onset must not become an automatic firing timer.
    expect(mode.scene.userData.activeLasers).toBe(2);
    expect(exhaust.scale.z).toBeLessThan(peak);
    step(false, 0, 10); step(true, 0.9);
    expect(mode.scene.userData.activeLasers).toBe(4);
    step(false, 0, 13); step(false, 0.9); // The shared response can detect a beat the onset detector missed.
    expect(mode.scene.userData.activeLasers).toBe(6);
    step(false, 0, 120);
    expect(mode.scene.userData.activeLasers).toBe(0);
    expect(exhaust.scale.z).toBeCloseTo(idleLength, 3);
    f.reducedFlash = true; step(true, 0.9);
    expect(mode.scene.userData.activeLasers).toBe(2);
    expect(mode.scene.userData.thrust).toBeLessThanOrEqual(0.25);
    mode.dispose();
  });

  it('ships the supplied skinned model and attaches effects at its actual nozzle and muzzle geometry', () => {
    const bytes = readFileSync(new URL('../../src/assets/wave6/arwing_v1.glb', import.meta.url));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    expect(bytes.length).toBe(1647900);
    expect(gltf.animations.map((a: { name: string }) => a.name)).toContain('wing_flex');
    expect(gltf.skins[0].joints).toHaveLength(5);
    for (const [prefix, sockets] of [['mesh_engine_inner', SHIP_EXHAUSTS], ['mesh_cannon_muzzle', SHIP_CANNONS]] as const) {
      sockets.forEach((socket, i) => {
        const node = gltf.nodes.find((n: { name: string }) => n.name === prefix + (i ? '.001' : ''));
        const bounds = gltf.accessors[gltf.meshes[node.mesh].primitives[0].attributes.POSITION];
        for (let axis = 0; axis < 3; axis++) expect(socket[axis]).toBeCloseTo((bounds.min[axis] + bounds.max[axis]) / 2, 1);
      });
    }
  });
});
