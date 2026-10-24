import * as THREE from 'three/webgpu';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, wrap, bandEnergies, approach, beatGate } from './shared';

// ---------------------------------------------------------------- Fourier epicycles

export interface EpicycleTerm { freq: number; amp: number; phase: number }
export type EpicycleShape = 'rose' | 'star' | 'trefoil' | 'heart';
export const EPICYCLE_SHAPES: readonly EpicycleShape[] = ['rose', 'star', 'trefoil', 'heart'];

/** A closed curve sampled at n points as interleaved (x, y), roughly unit-sized. */
export function epicycleShape(shape: EpicycleShape, n: number): Float32Array {
  const points = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / n * Math.PI * 2;
    let x: number, y: number;
    if (shape === 'rose') { const r = Math.cos(5 * t) * 0.8 + 0.2; x = r * Math.cos(t); y = r * Math.sin(t); }
    else if (shape === 'star') { const r = 0.55 + 0.45 * Math.abs(((t / (Math.PI / 5)) % 2) - 1); x = r * Math.cos(t - Math.PI / 2); y = r * Math.sin(t - Math.PI / 2); }
    else if (shape === 'trefoil') { x = (Math.sin(t) + 2 * Math.sin(2 * t)) / 3; y = (Math.cos(t) - 2 * Math.cos(2 * t)) / 3; }
    else { x = Math.pow(Math.sin(t), 3); y = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16; }
    points[i * 2] = x; points[i * 2 + 1] = y;
  }
  return points;
}
/** Complex DFT of a closed curve, largest terms first, keeping `terms` of them. */
export function epicycleTerms(points: Float32Array, terms: number): EpicycleTerm[] {
  const n = points.length / 2, out: EpicycleTerm[] = [];
  for (let k = 0; k < n; k++) {
    const freq = k <= n / 2 ? k : k - n;
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      const a = -2 * Math.PI * k * i / n, x = points[i * 2], y = points[i * 2 + 1];
      re += x * Math.cos(a) - y * Math.sin(a); im += x * Math.sin(a) + y * Math.cos(a);
    }
    out.push({ freq, amp: Math.hypot(re, im) / n, phase: Math.atan2(im, re) });
  }
  return out.sort((a, b) => b.amp - a.amp).slice(0, terms);
}

const EPI_TERMS = 48, EPI_SEGMENTS = 40, EPI_TRAIL = 720, EPI_SCALE = 34;

export function createEpicycleMode(): VisualMode {
  const { scene, camera } = sceneDefaults(90);
  const library = EPICYCLE_SHAPES.map((shape) => epicycleTerms(epicycleShape(shape, 256), EPI_TERMS));
  const line = (count: number, segments: boolean, colors?: Float32Array) => {
    const positions = new Float32Array(count * 3), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: !!colors });
    const object = segments ? new THREE.LineSegments(geometry, material) : new THREE.Line(geometry, material);
    object.frustumCulled = false; scene.add(object);
    return { positions, geometry, material };
  };
  const circles = line(EPI_TERMS * EPI_SEGMENTS * 2, true), arms = line(EPI_TERMS + 1, false);
  const fade = new Float32Array(EPI_TRAIL * 3), trail = line(EPI_TRAIL, false, fade);
  const history = new Float32Array(EPI_TRAIL * 2);
  const bands = new Float32Array(EPI_TERMS), smooth = new Float32Array(EPI_TERMS);
  const nextShape = beatGate(2.4);
  const tint = new THREE.Color();
  let shape = 0, blend = 1, previous = 0, phase = 0, head = 0, filled = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      if (nextShape(frame.time, frame.audio.onset)) { previous = shape; shape = (shape + 1) % library.length; blend = 0; }
      blend = Math.min(1, blend + frame.delta / 0.8);
      phase += (0.12 + frame.response.bass * 0.35) * frame.delta;
      bandEnergies(frame, EPI_TERMS, bands);
      let x = 0, y = 0;
      arms.positions.fill(0);
      const ease = blend * blend * (3 - 2 * blend);
      for (let i = 0; i < EPI_TERMS; i++) {
        smooth[i] = approach(smooth[i], bands[Math.min(EPI_TERMS - 1, Math.abs(library[shape][i].freq))], frame.delta, 0.08);
        const blendTerm = (term: EpicycleTerm) => {
          const a = term.freq * phase * Math.PI * 2 + term.phase;
          return [Math.cos(a) * term.amp, Math.sin(a) * term.amp];
        };
        const [ax, ay] = blendTerm(library[previous][i]), [bx, by] = blendTerm(library[shape][i]);
        const gain = EPI_SCALE * (1 + smooth[i] * 0.9 + frame.response.bounce * 0.25);
        const dx = (ax + (bx - ax) * ease) * gain, dy = (ay + (by - ay) * ease) * gain, r = Math.hypot(dx, dy);
        for (let s = 0; s < EPI_SEGMENTS; s++) {
          const p = (i * EPI_SEGMENTS + s) * 6, a0 = s / EPI_SEGMENTS * Math.PI * 2, a1 = (s + 1) / EPI_SEGMENTS * Math.PI * 2;
          circles.positions[p] = x + Math.cos(a0) * r; circles.positions[p + 1] = y + Math.sin(a0) * r;
          circles.positions[p + 3] = x + Math.cos(a1) * r; circles.positions[p + 4] = y + Math.sin(a1) * r;
        }
        x += dx; y += dy;
        arms.positions[(i + 1) * 3] = x; arms.positions[(i + 1) * 3 + 1] = y;
      }
      history[head * 2] = x; history[head * 2 + 1] = y;
      head = (head + 1) % EPI_TRAIL; filled = Math.min(EPI_TRAIL, filled + 1);
      // Oldest first so the fixed colour ramp reads as a fading tail.
      for (let i = 0; i < EPI_TRAIL; i++) {
        const back = Math.min(EPI_TRAIL - 1 - i, filled - 1), source = (head - 1 - back + EPI_TRAIL * 2) % EPI_TRAIL;
        trail.positions[i * 3] = history[source * 2]; trail.positions[i * 3 + 1] = history[source * 2 + 1];
        const glow = Math.pow(i / (EPI_TRAIL - 1), 1.3) * 3.2;
        tint.setHSL(wrap(frame.hue + i / EPI_TRAIL * 0.25, 0, 1), 1, 0.55);
        fade[i * 3] = tint.r * glow; fade[i * 3 + 1] = tint.g * glow; fade[i * 3 + 2] = tint.b * glow;
      }
      circles.material.color.setHSL(wrap(frame.hue + 0.5, 0, 1), 0.7, 0.5);
      circles.material.opacity = 0.5 + frame.audio.highs * 0.3;
      arms.material.color.setRGB(1.6, 1.6, 1.6);
      for (const target of [circles, arms, trail]) target.geometry.attributes.position.needsUpdate = true;
      trail.geometry.attributes.color.needsUpdate = true;
      scene.rotation.z = Math.sin(frame.time * 0.1) * 0.15;
    },
    dispose: () => disposeScene(scene),
  };
}

// ---------------------------------------------------------------- Polyhedra morph

export const POLY_SEGMENTS = 60;
/** Each platonic solid's true edges split into exactly POLY_SEGMENTS pieces, unit circumradius, so any two can be lerped. */
export function polyhedronSegments(geometry: THREE.BufferGeometry): Float32Array {
  const edges = new THREE.EdgesGeometry(geometry, 1), source = edges.attributes.position;
  const count = source.count / 2, pieces = POLY_SEGMENTS / count;
  if (!Number.isInteger(pieces)) throw new Error(`Edge count ${count} does not divide ${POLY_SEGMENTS}`);
  const list: { a: THREE.Vector3; b: THREE.Vector3; key: number }[] = [];
  for (let e = 0; e < count; e++) {
    const a = new THREE.Vector3().fromBufferAttribute(source, e * 2).normalize(), b = new THREE.Vector3().fromBufferAttribute(source, e * 2 + 1).normalize();
    const mid = a.clone().add(b);
    list.push({ a, b, key: Math.atan2(mid.z, mid.x) + Math.round(mid.y * 4) * 10 });
  }
  // A stable spatial order keeps morphs from crossing every edge through the centre.
  list.sort((p, q) => p.key - q.key);
  const out = new Float32Array(POLY_SEGMENTS * 6);
  let o = 0;
  for (const { a, b } of list) {
    for (let k = 0; k < pieces; k++) {
      const p0 = a.clone().lerp(b, k / pieces), p1 = a.clone().lerp(b, (k + 1) / pieces);
      out.set([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z], o); o += 6;
    }
  }
  edges.dispose();
  return out;
}

export function createPolyhedraMode(): VisualMode {
  const { scene, camera } = sceneDefaults(70);
  const solids = [new THREE.TetrahedronGeometry(1), new THREE.BoxGeometry(1, 1, 1), new THREE.OctahedronGeometry(1), new THREE.DodecahedronGeometry(1), new THREE.IcosahedronGeometry(1)]
    .map((geometry) => { const segments = polyhedronSegments(geometry); geometry.dispose(); return segments; });
  const shells = [{ scale: 22, spin: 1, offset: 0, solid: 0 }, { scale: 10, spin: -1.6, offset: 0.5, solid: 2 }].map((shell) => {
    const positions = new Float32Array(POLY_SEGMENTS * 6), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const lines = new THREE.LineSegments(geometry, material); lines.frustumCulled = false;
    const nodeMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const nodes = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), nodeMaterial, POLY_SEGMENTS * 2); nodes.frustumCulled = false;
    const group = new THREE.Group(); group.add(lines, nodes); scene.add(group);
    return { ...shell, positions, geometry, material, nodeMaterial, nodes, group, from: shell.solid, to: shell.solid, progress: 1 };
  });
  const advance = beatGate(1.4), dummy = new THREE.Object3D();
  let idle = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      idle += frame.delta;
      // Silence still cycles slowly so the mode never freezes on one solid.
      if (advance(frame.time, frame.audio.onset) || idle > 6) {
        idle = 0;
        for (const shell of shells) { shell.from = shell.to; shell.to = (shell.to + 1) % solids.length; shell.progress = 0; }
      }
      const spectrum = frame.audio.spectrum;
      for (const shell of shells) {
        shell.progress = Math.min(1, shell.progress + frame.delta / (0.9 - frame.response.bass * 0.5));
        const t = shell.progress, ease = t < 1 ? 1 - Math.pow(1 - t, 3) * Math.cos(t * Math.PI * 1.5) : 1;
        const from = solids[shell.from], to = solids[shell.to], scale = shell.scale * (1 + frame.response.bounce * 0.35);
        for (let v = 0; v < POLY_SEGMENTS * 2; v++) {
          const p = v * 3, push = 1 + (spectrum[(v * 4) % spectrum.length] || 0) / 255 * 0.22;
          for (let c = 0; c < 3; c++) shell.positions[p + c] = (from[p + c] + (to[p + c] - from[p + c]) * ease) * scale * push;
          dummy.position.set(shell.positions[p], shell.positions[p + 1], shell.positions[p + 2]);
          dummy.scale.setScalar(v % 2 ? 0 : (0.16 + frame.response.bass * 0.3) * shell.scale / 22);
          dummy.updateMatrix(); shell.nodes.setMatrixAt(v, dummy.matrix);
        }
        shell.geometry.attributes.position.needsUpdate = true; shell.nodes.instanceMatrix.needsUpdate = true;
        shell.group.rotation.x += 0.21 * shell.spin * frame.delta * (1 + frame.audio.mid);
        shell.group.rotation.y += 0.33 * shell.spin * frame.delta * (1 + frame.audio.mid);
        const flash = frame.reducedFlash ? 0 : frame.response.impact * 0.5;
        shell.material.color.setHSL(wrap(frame.hue + shell.offset, 0, 1), 1, 0.55).multiplyScalar(3.2 + flash);
        shell.nodeMaterial.color.setHSL(wrap(frame.hue + shell.offset + 0.1, 0, 1), 1, 0.65).multiplyScalar(1.4 + flash);
      }
    },
    dispose: () => disposeScene(scene),
  };
}

// ---------------------------------------------------------------- Pendulum wave

export const PENDULUMS = 36, PENDULUM_CYCLE = 60, PENDULUM_BASE = 51;
/** Pendulum i swings PENDULUM_BASE + i times per cycle, so all of them line up again every PENDULUM_CYCLE seconds of τ. */
export const pendulumPhase = (i: number, tau: number) => 2 * Math.PI * (PENDULUM_BASE + i) / PENDULUM_CYCLE * tau;

export function createPendulumMode(): VisualMode {
  const { scene, camera } = sceneDefaults(90);
  camera.position.set(-64, 8, 60); camera.lookAt(0, 6, 0);
  const length = (i: number) => 30 * Math.pow(PENDULUM_BASE / (PENDULUM_BASE + i), 2); // Real period ∝ √L.
  const spacing = 2.3, top = 22;
  const bobMaterial = new THREE.MeshBasicNodeMaterial();
  const bobs = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), bobMaterial, PENDULUMS); bobs.frustumCulled = false;
  bobs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PENDULUMS * 3), 3);
  const strings = new Float32Array(PENDULUMS * 6), stringGeometry = new THREE.BufferGeometry();
  stringGeometry.setAttribute('position', new THREE.BufferAttribute(strings, 3));
  const stringMaterial = new THREE.LineBasicNodeMaterial({ transparent: true, opacity: 0.45, depthWrite: false });
  const stringLines = new THREE.LineSegments(stringGeometry, stringMaterial); stringLines.frustumCulled = false;
  const barMaterial = new THREE.MeshBasicNodeMaterial({ color: 0x223344 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, PENDULUMS * spacing + 4), barMaterial); bar.position.y = top;
  scene.add(bobs, stringLines, bar);
  const bands = new Float32Array(PENDULUMS), amplitude = new Float32Array(PENDULUMS).fill(0.35);
  const resync = beatGate(6), dummy = new THREE.Object3D(), color = new THREE.Color();
  let tau = 4, rewind = 0, rewindFrom = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      if (resync(frame.time, frame.audio.onset && frame.response.impact > 0.6)) { rewind = 1; rewindFrom = tau; }
      if (rewind > 0) {
        // Ease τ to the next whole cycle, where every pendulum lines up again.
        rewind = Math.max(0, rewind - frame.delta / 0.9);
        const goal = Math.ceil(rewindFrom / PENDULUM_CYCLE) * PENDULUM_CYCLE, k = 1 - rewind;
        tau = rewindFrom + (goal - rewindFrom) * (k * k * (3 - 2 * k));
        if (rewind === 0) tau = goal + 0.001;
      } else tau += frame.delta * (0.6 + frame.response.bass * 1.6);
      bandEnergies(frame, PENDULUMS, bands);
      for (let i = 0; i < PENDULUMS; i++) {
        amplitude[i] = approach(amplitude[i], 0.32 + bands[i] * 0.5 + frame.response.bounce * 0.15, frame.delta, 0.12);
        const angle = amplitude[i] * Math.sin(pendulumPhase(i, tau)), L = length(i), z = (i - (PENDULUMS - 1) / 2) * spacing;
        const x = Math.sin(angle) * L, y = top - Math.cos(angle) * L;
        dummy.position.set(x, y, z); dummy.scale.setScalar(1 + bands[i] * 0.6); dummy.updateMatrix();
        bobs.setMatrixAt(i, dummy.matrix);
        color.setHSL(wrap(frame.hue + i / PENDULUMS * 0.45, 0, 1), 1, 0.55).multiplyScalar(1.4 + bands[i] * 1.5);
        bobs.setColorAt(i, color);
        strings.set([0, top, z, x, y, z], i * 6);
      }
      bobs.instanceMatrix.needsUpdate = true; bobs.instanceColor!.needsUpdate = true;
      stringGeometry.attributes.position.needsUpdate = true;
      stringMaterial.color.setHSL(wrap(frame.hue + 0.5, 0, 1), 0.4, 0.7);
      scene.rotation.y = Math.sin(frame.time * 0.07) * 0.25;
    },
    dispose: () => disposeScene(scene),
  };
}
