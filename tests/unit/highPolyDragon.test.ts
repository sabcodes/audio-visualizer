import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { BoneOverlay, ClipPlayer, instantiate } from '../../src/modes/figures';
import { detailDragon, dragonStroke, dragonWings } from '../../src/modes/dragonDetail';

async function load() {
  const bytes = readFileSync('src/assets/models/dragon_hd.glb');
  return new Promise<GLTF>((resolve, reject) => new GLTFLoader().parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '', resolve, reject));
}

describe('refined dragon', () => {
  it('has a dense skin, restrained breathing and all original animation clips', async () => {
    const model = await load();
    let triangles = 0, displacement = 0, pointedTailVertices = 0;
    model.scene.traverse(object => {
      const mesh = object as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      triangles += mesh.geometry.index!.count / 3;
      if (mesh.morphTargetDictionary?.pulse_expand !== undefined) {
        const positions = mesh.geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
          if (positions.getZ(i) < -3.9) {
            pointedTailVertices++;
            expect(Math.hypot(positions.getX(i), positions.getY(i))).toBeLessThan(0.012);
          }
        }
      }
      const weights = mesh.geometry.attributes.skinWeight;
      for (let i = 0; i < weights.count; i++) {
        const total = weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i);
        if (Math.abs(total - 1) > 0.0001) throw new Error(`${mesh.name}: unnormalized skin weight ${total}`);
      }
      for (const target of mesh.geometry.morphAttributes.position ?? []) {
        for (let i = 0; i < target.count; i++) displacement = Math.max(displacement, new THREE.Vector3().fromBufferAttribute(target, i).length());
      }
    });
    expect(triangles).toBeGreaterThan(300000);
    expect(triangles).toBeLessThan(700000);
    expect(displacement).toBeGreaterThan(0);
    expect(pointedTailVertices).toBeGreaterThan(0);
    expect(displacement).toBeLessThan(0.01);
    expect(model.animations.map(clip => clip.name)).toEqual(expect.arrayContaining(['flight_base', 'head_roar', 'wings_flap', 'tail_wave']));
  });

  it('has smooth wing reversals and no jump at the cycle boundary', () => {
    const h = 0.0001;
    for (let phase = -1; phase < 2; phase += 0.01) {
      expect(Math.abs(dragonStroke(phase))).toBeLessThanOrEqual(1);
      expect(dragonStroke(phase + 1)).toBeCloseTo(dragonStroke(phase), 10);
      const before = (dragonStroke(phase) - dragonStroke(phase - h)) / h;
      const after = (dragonStroke(phase + h) - dragonStroke(phase)) / h;
      expect(Math.abs(before - after)).toBeLessThan(0.01);
    }
  });

  it('retains the blue palette and detailed facial, limb and talon geometry', async () => {
    const figure = instantiate(await load());
    const blue = figure.materials.get('mat_body')!.color, belly = figure.materials.get('mat_belly')!.color;
    const membrane = figure.materials.get('mat_membrane')!.color;
    expect(blue.b).toBeGreaterThan(blue.r * 3);
    expect(blue.b).toBeGreaterThan(blue.g * 1.8);
    expect(belly.b).toBeGreaterThan(belly.r * 1.2);
    expect(membrane.b).toBeGreaterThan(membrane.r * 2.7);
    expect((figure.node('head') as THREE.Mesh).geometry.index!.count / 3).toBeGreaterThan(80000);
    expect((figure.node('jaw') as THREE.Mesh).geometry.index!.count / 3).toBeGreaterThan(40000);
    for (const side of ['Left', 'Right']) for (const kind of ['Front', 'Hind']) {
      expect((figure.node(`${side}${kind}Leg`) as THREE.Mesh).geometry.index!.count / 3).toBeGreaterThan(20000);
      for (let digit = 0; digit < 4; digit++) {
        expect((figure.node(`${side}${kind}_digit_${digit}`) as THREE.SkinnedMesh).isSkinnedMesh).toBe(true);
        expect((figure.node(`${side}${kind}_talon_${digit}`) as THREE.Mesh).geometry.index!.count / 3).toBeGreaterThan(1000);
      }
    }
    for (const part of ['brow_L', 'brow_R', 'pupil_L', 'pupil_R', 'tongue']) expect(figure.node(part)).toBeDefined();
    const player = new ClipPlayer(figure.root, figure.clips);
    player.loop('flight_base', 0); player.update(0.25); figure.root.updateMatrixWorld(true);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    let maxStretch = 0, worst = '';
    for (const side of ['Left', 'Right']) for (const kind of ['Front', 'Hind']) {
      const mesh = figure.node(`${side}${kind}Leg`) as THREE.SkinnedMesh;
      mesh.skeleton.update();
      const index = mesh.geometry.index!, positions = mesh.geometry.attributes.position;
      for (let i = 0; i + 1 < index.count; i += 97) {
        const ia = index.getX(i), ib = index.getX(i + 1);
        const rest = a.fromBufferAttribute(positions, ia).distanceTo(b.fromBufferAttribute(positions, ib));
        if (rest < 0.002) continue;
        mesh.getVertexPosition(ia, a); mesh.getVertexPosition(ib, b);
        expect(a.toArray().every(Number.isFinite)).toBe(true);
        const stretch = a.distanceTo(b) / rest;
        if (stretch > maxStretch) { maxStretch = stretch; worst = `${side}${kind} vertex ${ia}`; }
      }
    }
    expect(maxStretch, worst).toBeLessThan(2.2);
    player.dispose();
  });

  it('has a narrow raised neck, a broad chest and baked contact shading', async () => {
    const model = await load();
    let neckWidth = 0, chestWidth = 0, waistWidth = 0, minNeck = Infinity, maxNeck = -Infinity, darkest = 1;
    model.scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const colour = mesh.geometry.attributes.color;
      expect(colour, `${mesh.name}: missing contact shading`).toBeDefined();
      for (let i = 0; i < colour.count; i++) darkest = Math.min(darkest, colour.getX(i));
      if (mesh.morphTargetDictionary?.pulse_expand === undefined) return;
      const p = mesh.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        if (p.getZ(i) > 1.5 && p.getZ(i) < 1.8) {
          neckWidth = Math.max(neckWidth, Math.abs(p.getX(i)));
          minNeck = Math.min(minNeck, p.getY(i)); maxNeck = Math.max(maxNeck, p.getY(i));
        }
        if (Math.abs(p.getZ(i)) < 0.4) chestWidth = Math.max(chestWidth, Math.abs(p.getX(i)));
        if (p.getZ(i) > -0.75 && p.getZ(i) < -0.6) waistWidth = Math.max(waistWidth, Math.abs(p.getX(i)));
      }
    });
    expect(neckWidth).toBeGreaterThan(0.05);
    expect(neckWidth / chestWidth).toBeLessThan(0.4);
    expect(waistWidth / chestWidth).toBeLessThan(0.78);
    expect((minNeck + maxNeck) / 2).toBeGreaterThan(0.4);
    expect(darkest).toBeLessThan(0.8);
    const head = model.scene.getObjectByName('Head')!.getWorldPosition(new THREE.Vector3());
    expect(head.y).toBeGreaterThan(0.6); expect(head.z).toBeGreaterThan(2.2);
  });

  it('keeps the middle of each limb segment attached to its own bone', async () => {
    const figure = instantiate(await load()); figure.root.updateMatrixWorld(true);
    const p = new THREE.Vector3(), start = new THREE.Vector3(), end = new THREE.Vector3();
    for (const side of ['Left', 'Right']) for (const kind of ['Front', 'Hind']) {
      const mesh = figure.node(`${side}${kind}Leg`) as THREE.SkinnedMesh;
      const positions = mesh.geometry.attributes.position, joints = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight;
      const chain = kind === 'Front' ? ['Root', 'Elbow', 'Wrist'] : ['Root', 'Knee', 'Ankle'];
      for (let segment = 0; segment < 2; segment++) {
        const bone = figure.node(`${side}${kind}${chain[segment]}`);
        bone.getWorldPosition(start); figure.node(`${side}${kind}${chain[segment + 1]}`).getWorldPosition(end);
        const axis = end.clone().sub(start), ownIndex = mesh.skeleton.bones.indexOf(bone as THREE.Bone);
        let samples = 0, foreignWeight = 0;
        for (let i = 0; i < positions.count; i++) {
          p.fromBufferAttribute(positions, i).applyMatrix4(mesh.bindMatrix).sub(start);
          const t = p.dot(axis) / axis.lengthSq();
          if (t < 0.45 || t > 0.55) continue;
          if (p.clone().addScaledVector(axis, -t).length() > 0.21) continue;
          samples++;
          let weight = 0;
          for (let slot = 0; slot < 4; slot++) if (joints.getComponent(i, slot) !== ownIndex) weight += weights.getComponent(i, slot);
          foreignWeight = Math.max(foreignWeight, weight);
        }
        expect(samples).toBeGreaterThan(10);
        expect(foreignWeight, `${side}${kind}${chain[segment]} bends between joints`).toBeLessThan(0.01);
      }
    }
  });

  it('folds the flight pose at the elbows and knees instead of only at the wrists', async () => {
    const figure = instantiate(await load()), player = new ClipPlayer(figure.root, figure.clips);
    player.loop('flight_base', 0); player.update(.25); figure.root.updateMatrixWorld(true);
    const root = new THREE.Vector3(), joint = new THREE.Vector3(), end = new THREE.Vector3();
    for (const side of ['Left', 'Right']) for (const kind of ['Front', 'Hind']) {
      const chain = kind === 'Front' ? ['Root', 'Elbow', 'Wrist'] : ['Root', 'Knee', 'Ankle'];
      figure.node(`${side}${kind}${chain[0]}`).getWorldPosition(root);
      figure.node(`${side}${kind}${chain[1]}`).getWorldPosition(joint);
      figure.node(`${side}${kind}${chain[2]}`).getWorldPosition(end);
      const bend = joint.clone().sub(root).angleTo(end.clone().sub(joint));
      expect(bend, `${side}${kind} is straight through the elbow/knee`).toBeGreaterThan(.9);
      expect(bend, `${side}${kind} is folded too tightly`).toBeLessThan(2.5);
      if (kind === 'Front') {
        // +Z faces the head: elbows project forward and forearms tuck back.
        // Bend magnitude alone also passes with the entire hinge reversed.
        expect(joint.z - root.z, `${side} front elbow bends backward`).toBeGreaterThan(.2);
        expect(end.z - joint.z, `${side} front forearm bends forward`).toBeLessThan(-.2);
        expect(joint.y).toBeLessThan(root.y);
        expect(end.y).toBeLessThan(joint.y);
      }
    }
    player.dispose();
  });

  it('flexes the fingers and keeps the posed body continuous over a full stroke', async () => {
    const figure = instantiate(await load()), overlay = new BoneOverlay(), wings = dragonWings(figure, overlay);
    const detail = detailDragon(figure);
    const player = new ClipPlayer(figure.root, figure.clips); player.loop('flight_base', 0);
    const body: THREE.SkinnedMesh[] = [];
    figure.root.traverse(o => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh && m.morphTargetDictionary?.pulse_expand !== undefined) body.push(m); });
    const neck = Array.from({ length: 6 }, (_, i) => overlay.track(figure.node(`Neck${i + 1}`)));
    const tail = Array.from({ length: 10 }, (_, i) => overlay.track(figure.node(`Tail${i + 1}`)));
    const finger = figure.node('LeftWingFinger3_1'), rotations: number[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    let maxStretch = 0, worst = '';
    for (let frame = 0; frame <= 60; frame++) {
      overlay.reset(); player.update(1 / 60);
      wings(frame / 60, 1, frame / 60); detail.update(frame / 60, 1);
      neck.forEach((bone, i) => overlay.turn(bone, Math.sin(frame * 0.12 - i * 0.7) * 0.07 + 0.07, 0, Math.sin(frame * 0.06 - i * 0.5) * 0.03));
      tail.forEach((bone, i) => overlay.turn(bone, Math.sin(frame * 0.08 - i * 0.45) * 0.03, 0, Math.sin(frame * 0.1 - i * 0.55) * 0.12));
      rotations.push(finger.rotation.x);
      figure.root.updateMatrixWorld(true);
      for (const mesh of body) {
        mesh.skeleton.update();
        const index = mesh.geometry.index!, position = mesh.geometry.attributes.position;
        for (let i = 0; i < index.count; i += 117) {
          const ia = index.getX(i), ib = index.getX(i + 1);
          const rest = a.fromBufferAttribute(position, ia).distanceTo(b.fromBufferAttribute(position, ib));
          if (rest < 0.0001) continue;
          mesh.getVertexPosition(ia, a); mesh.getVertexPosition(ib, b);
          const stretch = a.distanceTo(b) / rest;
          if (stretch > maxStretch) {
            maxStretch = stretch;
            worst = `${mesh.name} vertex ${ia}: ${new THREE.Vector3().fromBufferAttribute(position, ia).toArray()} at frame ${frame}`;
          }
        }
      }
    }
    expect(body.length).toBeGreaterThan(0);
    expect(maxStretch, worst).toBeLessThan(1.5);
    expect(Math.max(...rotations) - Math.min(...rotations)).toBeGreaterThan(0.15);
    player.dispose();
  });
});
