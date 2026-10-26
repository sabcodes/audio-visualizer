import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  Fn, abs, attribute, dot, exp, float, floor, fract, instancedBufferAttribute, mix, mx_fractal_noise_float, mx_fractal_noise_vec3, mx_noise_float, normalize, positionLocal,
  positionWorld, sign, sin, smoothstep, step, transformNormalToView, uniform, uv, varying, vec2, vec3,
} from 'three/tsl';
import type { VisualMode } from './types';
import type { QualityBudget } from '../rendering/quality';
import { sceneDefaults, resizeCamera, disposeScene, approach, beatGate, settleStep } from './shared';
import { TempoTracker, createParticles, loadTexture } from './figures';
import { wingStroke } from './flightModes';
import { tier } from './creatureKitModes';
import { createCinematic } from './cinematic';
import { seededRandom } from '../rendering/diagnostics';
import emberUrl from '../assets/fx/ember.png?url';
import smokeUrl from '../assets/fx/smoke.png?url';
import sparkUrl from '../assets/fx/spark.png?url';

/**
 * Western Phoenix: a fire bird built entirely in code (lofted body, ~150 instanced feathers on a code-driven wing
 * rig, camera-facing tail plumes) flying down an endless canyon of black basalt with a lava river, lava falls
 * painted onto the cliff faces, ember storms and smoke. The bird holds station near the origin; the canyon is
 * displaced in the vertex shader from `travel`, so it streams past without any geometry moving.
 */

const LAVA_Y = 0.8, TERRAIN_Z = -250, BIRD_Y = 15;
/** The canyon's centre line, shared by the terrain shader and the bird's steering (w = distance down the valley). */
export const meander = (w: number) => Math.sin(w * 0.012) * 14 + Math.sin(w * 0.031 + 1.3) * 5;
const meanderNode = (w: Node<'float'>) => sin(w.mul(0.012)).mul(14).add(sin(w.mul(0.031).add(1.3)).mul(5));
const rgb = (r: number, g: number, b: number) => vec3(r, g, b);

/** Canyon height at (x, w): a lava floor with rock islands, cliffs that rise steeply with distance from the centre line, jagged with ridged noise. */
const canyonHeight = Fn(([x, w]: [Node<'float'>, Node<'float'>]) => {
  const broad = mx_fractal_noise_float(vec3(x.mul(0.018), w.mul(0.014), 0.5), 3, 2, 0.5);
  // The wall line wanders in plan, cutting gullies and buttresses into the cliffs.
  const d = abs(x.sub(meanderNode(w))).add(mx_noise_float(vec3(w.mul(0.11), x.mul(0.03), 1.7)).mul(5));
  const rise = smoothstep(14, float(31).add(broad.mul(5)), d);
  const ridge = float(1).sub(abs(mx_noise_float(vec3(x.mul(0.06), w.mul(0.045), 3.1)))).pow(2);
  const floorBumps = mx_noise_float(vec3(x.mul(0.13), w.mul(0.13), 7)).mul(1.3).sub(0.2).mul(rise.oneMinus());
  const spires = smoothstep(0.35, 0.8, mx_noise_float(vec3(x.mul(0.035), w.mul(0.03), 9))).mul(28).mul(rise);
  const h = rise.pow(1.3).mul(float(58).add(broad.mul(24))).add(ridge.mul(16).mul(rise)).add(spires);
  // Ledges: pull the cliff toward 7 m terraces, so the faces break into steps rather than draping.
  const band = h.div(7), terrace = floor(band).add(smoothstep(0.55, 0.9, fract(band))).mul(7);
  return mix(h, terrace, rise.mul(0.55)).add(floorBumps);
});

/** A cheap float hash shared by the cliff and lava shaders, so lava falls and their splash pools line up. */
const hash1 = (n: Node<'float'>) => fract(sin(n.mul(12.9898)).mul(43758.5453));

/** Lava falls on the cliff faces: one chance per 70 m of valley on each side. Returns the fall's mask and its flow coordinate. */
function lavaFall(x: Node<'float'>, w: Node<'float'>) {
  const side = sign(x.sub(meanderNode(w))), cell = floor(w.div(70)), key = cell.mul(2).add(side);
  const present = step(0.42, hash1(key)), centre = cell.add(0.2).add(hash1(key.add(17)).mul(0.6)).mul(70);
  const width = hash1(key.add(5)).mul(4).add(2.5);
  const across = abs(w.sub(centre)).add(mx_noise_float(vec3(w.mul(0.4), 0, cell)).mul(1.2));
  return { mask: smoothstep(width, width.mul(0.25), across).mul(present), across, cell, top: hash1(key.add(9)).mul(28).add(22) };
}

/**
 * A feather vane: dark ember-brown barbs, a pale rachis, and fire that licks along the edges and burns at the tip.
 * `fire` is how much this feather burns (primaries and plumes most), `seed` decorrelates the flicker.
 */
function featherMaterial(fire: Node<'float'>, seed: Node<'float'>, heat: Node<'float'>, time: Node<'float'>) {
  const material = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.6, alphaTest: 0.5 });
  const across = uv().x.sub(0.5).abs().mul(2), along = uv().y;
  const barbs = smoothstep(0, 0.4, fract(along.mul(46).add(across.mul(9)).add(seed.mul(3))).sub(0.5).abs().mul(2));
  const rachis = smoothstep(0.09, 0, across);
  const base = mix(rgb(0.06, 0.016, 0.008), rgb(0.36, 0.08, 0.018), along.mul(0.6).add(across.mul(0.35)));
  material.colorNode = base.mul(barbs.mul(0.5).add(0.6)).add(rgb(0.4, 0.2, 0.05).mul(rachis.mul(0.35)));
  const flicker = mx_noise_float(vec3(along.mul(5).sub(time.mul(4)), across.mul(2), seed.mul(17))).mul(0.5).add(0.5);
  const edge = smoothstep(0.45, 1, across), tip = smoothstep(0.3, 1, along);
  const burn = edge.mul(0.55).add(tip).mul(fire).mul(flicker.mul(0.9).add(0.35)).mul(heat);
  const hot = mix(rgb(0.95, 0.2, 0.025), rgb(1, 0.68, 0.28), tip.mul(flicker));
  material.emissiveNode = hot.mul(burn.mul(4.5)).add(rgb(0.35, 0.06, 0.01).mul(heat.mul(0.2)));
  // A ragged, separated vane edge rather than a clean leaf outline.
  material.opacityNode = step(across, float(0.95).sub(fract(along.mul(21).add(seed.mul(5))).mul(0.2)).sub(smoothstep(0.92, 1, along).mul(0.6)));
  return material;
}

/** Body plumage: overlapping scalloped contour feathers whose seams glow like embers. */
function plumageMaterial(heat: Node<'float'>, time: Node<'float'>, rows: number) {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.65 });
  const q = vec2(uv().x.mul(34), uv().y.mul(rows)), row = floor(q.y);
  const shifted = q.x.add(row.mul(0.5)), jitter = hash1(floor(shifted).add(row.mul(31.7)));
  const cell = fract(vec2(shifted, q.y)).sub(vec2(0.5, 1)).mul(vec2(1, 1.25));
  const scallop = cell.length(), seam = smoothstep(0.5, 0.62, scallop.add(jitter.mul(0.06)));
  const flicker = mx_noise_float(vec3(uv().mul(vec2(6, 14)), time.mul(1.5))).mul(0.5).add(0.5);
  const tone = mix(rgb(0.09, 0.025, 0.01), rgb(0.38, 0.1, 0.022), uv().y.mul(0.35).add(scallop.mul(0.4)).add(jitter.mul(0.25)));
  material.colorNode = tone.mul(seam.oneMinus().mul(0.18).add(0.82)).mul(mx_noise_float(vec3(uv().mul(vec2(80, 120)), 2)).mul(0.25).add(0.85));
  material.emissiveNode = mix(rgb(0.9, 0.18, 0.02), rgb(1, 0.55, 0.18), flicker).mul(seam.mul(flicker).mul(heat).mul(0.9).mul(jitter.mul(0.8).add(0.2)));
  return material;
}

/**
 * A smooth tube through `points` with an elliptical section [width, height] at each point (linear between them),
 * closed at both ends. `u` runs around, `v` along, for the plumage pattern. `reference` picks the section's up.
 */
export function loft(points: THREE.Vector3[], sections: [number, number][], options: { segments?: number; around?: number; reference?: THREE.Vector3 } = {}) {
  const { segments = 40, around = 18, reference = new THREE.Vector3(0, 1, 0) } = options;
  const curve = new THREE.CatmullRomCurve3(points), position: number[] = [], texcoord: number[] = [], index: number[] = [];
  const tangent = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(), at = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, f = t * (sections.length - 1), k = Math.min(sections.length - 2, Math.floor(f)), r = f - k;
    // Close the ends: the section shrinks to a point over the last sliver.
    const close = Math.min(1, Math.sin(Math.min(1, t / 0.04) * Math.PI / 2), Math.sin(Math.min(1, (1 - t) / 0.04) * Math.PI / 2));
    const width = THREE.MathUtils.lerp(sections[k][0], sections[k + 1][0], r) * close, height = THREE.MathUtils.lerp(sections[k][1], sections[k + 1][1], r) * close;
    curve.getPointAt(t, at); curve.getTangentAt(t, tangent);
    side.crossVectors(tangent, reference).normalize(); up.crossVectors(side, tangent).normalize();
    for (let j = 0; j <= around; j++) {
      const a = (j / around) * Math.PI * 2;
      position.push(at.x + side.x * Math.cos(a) * width + up.x * Math.sin(a) * height, at.y + side.y * Math.cos(a) * width + up.y * Math.sin(a) * height, at.z + side.z * Math.cos(a) * width + up.z * Math.sin(a) * height);
      texcoord.push(j / around, t);
    }
  }
  for (let i = 0; i < segments; i++) for (let j = 0; j < around; j++) {
    const a = i * (around + 1) + j, b = a + around + 1;
    index.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(texcoord, 2));
  geometry.setIndex(index); geometry.computeVertexNormals();
  return geometry;
}

/** One feather blade, root at the origin, tip at +Z 1, vane across X, cambered slightly in Y. Scaled per instance. */
function featherGeometry() {
  const along = 14, across = 4, position: number[] = [], texcoord: number[] = [], index: number[] = [];
  for (let i = 0; i <= along; i++) {
    const v = i / along, half = 0.5 * Math.sin(Math.min(1, v * 1.15) * Math.PI) ** 0.7 * (v < 0.08 ? v / 0.08 : 1);
    for (let j = 0; j <= across; j++) {
      const u = j / across, x = (u - 0.5) * 2 * half;
      position.push(x, -0.08 * x * x - 0.04 * v * v, v); texcoord.push(u, v);
    }
  }
  for (let i = 0; i < along; i++) for (let j = 0; j < across; j++) {
    const a = i * (across + 1) + j, b = a + across + 1;
    index.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(texcoord, 2));
  geometry.setIndex(index); geometry.computeVertexNormals();
  return geometry;
}

/**
 * Additive flame puffs with a colour ramp over life (white-gold core, orange, then a smoky red), shaped by noise so
 * a stream of them reads as licking fire. Simulated on the CPU like `createParticles`.
 */
function createFlames(capacity: number, time: Node<'float'>) {
  const position = new Float32Array(capacity * 4), info = new Float32Array(capacity * 4);
  const velocity = new Float32Array(capacity * 3), age = new Float32Array(capacity).fill(1), life = new Float32Array(capacity).fill(1), size = new Float32Array(capacity);
  const positionAttribute = new THREE.InstancedBufferAttribute(position, 4), infoAttribute = new THREE.InstancedBufferAttribute(info, 4);
  positionAttribute.setUsage(THREE.DynamicDrawUsage); infoAttribute.setUsage(THREE.DynamicDrawUsage);
  const at = instancedBufferAttribute<'vec4'>(positionAttribute, 'vec4'), data = instancedBufferAttribute<'vec4'>(infoAttribute, 'vec4');
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  material.positionNode = at.xyz; material.scaleNode = vec2(at.w);
  const t = data.x, seed = data.y, c = uv().sub(0.5).mul(2);
  // A tongue rather than a puff: taller than wide, torn by turbulence that rises through it.
  const turbulence = mx_noise_float(vec3(c.mul(2.6).add(vec2(seed.mul(13), time.mul(-2.6))), seed.mul(5).add(time.mul(0.7)))).mul(0.6);
  const shape = smoothstep(0.9, 0.2, vec2(c.x.mul(1.6), c.y.add(0.3).mul(0.7)).length().add(turbulence)).mul(smoothstep(1, 0.55, c.length()));
  const colour = mix(mix(rgb(1, 0.48, 0.12).mul(1.7), rgb(1, 0.2, 0.02).mul(1.15), smoothstep(0, 0.3, t)), rgb(0.4, 0.04, 0.005).mul(0.45), smoothstep(0.45, 0.95, t));
  material.colorNode = colour.mul(data.z);
  material.opacityNode = shape.mul(t.oneMinus().pow(1.4)).mul(t.mul(10).min(1)).mul(0.55);
  const sprites = new THREE.Sprite(material);
  sprites.geometry = sprites.geometry.clone(); sprites.count = capacity; sprites.frustumCulled = false;
  let next = 0;
  return {
    object: sprites,
    emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, seconds: number, scale: number, brightness: number, seed: number) {
      const i = next; next = (next + 1) % capacity;
      position.set([x, y, z, scale], i * 4); velocity.set([vx, vy, vz], i * 3);
      info[i * 4 + 1] = seed; info[i * 4 + 2] = brightness;
      age[i] = 0; life[i] = seconds; size[i] = scale;
    },
    update(delta: number) {
      const keep = Math.exp(-1.6 * delta);
      for (let i = 0; i < capacity; i++) {
        if (age[i] >= life[i]) { position[i * 4 + 3] = 0; info[i * 4] = 1; continue; }
        age[i] += delta;
        const t = Math.min(1, age[i] / life[i]);
        velocity[i * 3] *= keep; velocity[i * 3 + 1] = velocity[i * 3 + 1] * keep + 3 * delta; velocity[i * 3 + 2] *= keep;
        position[i * 4] += velocity[i * 3] * delta; position[i * 4 + 1] += velocity[i * 3 + 1] * delta; position[i * 4 + 2] += velocity[i * 3 + 2] * delta;
        position[i * 4 + 3] = size[i] * (0.7 + t * 0.9);
        info[i * 4] = t;
      }
      positionAttribute.needsUpdate = true; infoAttribute.needsUpdate = true;
    },
  };
}

interface Feather { parent: THREE.Object3D; at: THREE.Vector3; dir: THREE.Vector3; up: THREE.Vector3; length: number; width: number; fire: number; fan?: { side: number; base: number; spread: number } }

const PLUMES = 7, PLUME_POINTS = 30;

/** The bird: body, head and beak, legs, two wings on a code-driven rig, feathers and tail plumes. Faces +Z, left wing on +X. */
function buildPhoenix(heat: Node<'float'>, time: Node<'float'>) {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const plumage = plumageMaterial(heat, time, 46);
  // Torso and neck in one smooth loft, from the tail base up the neck.
  body.add(new THREE.Mesh(loft(
    [new THREE.Vector3(0, -0.02, -1.15), new THREE.Vector3(0, 0, -0.55), new THREE.Vector3(0, 0.05, 0.1), new THREE.Vector3(0, 0.22, 0.55), new THREE.Vector3(0, 0.6, 0.85), new THREE.Vector3(0, 0.9, 1.0)],
    [[0.14, 0.12], [0.34, 0.36], [0.46, 0.5], [0.42, 0.45], [0.29, 0.3], [0.22, 0.23]], { segments: 48, around: 22 }), plumage));
  // Head: a rounded skull with a hooked golden beak; the lower beak hinges open on a screech.
  const head = new THREE.Group(); head.position.set(0, 0.98, 1.02); head.rotation.x = 0.25; head.scale.setScalar(1.3); body.add(head);
  head.add(new THREE.Mesh(loft([new THREE.Vector3(0, -0.02, -0.22), new THREE.Vector3(0, 0.03, -0.02), new THREE.Vector3(0, 0.02, 0.16), new THREE.Vector3(0, -0.01, 0.3)],
    [[0.15, 0.15], [0.2, 0.2], [0.17, 0.16], [0.1, 0.09]], { segments: 24, around: 20 }), plumageMaterial(heat, time, 10)));
  const beakMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.4 });
  beakMaterial.colorNode = mix(rgb(0.45, 0.24, 0.05), rgb(0.12, 0.05, 0.02), uv().y);
  beakMaterial.emissiveNode = rgb(1, 0.45, 0.08).mul(smoothstep(0.6, 1, uv().x.sub(0.5).abs().mul(2)).mul(0.4).add(0.08)).mul(heat);
  head.add(new THREE.Mesh(loft([new THREE.Vector3(0, 0, 0.2), new THREE.Vector3(0, -0.01, 0.38), new THREE.Vector3(0, -0.07, 0.5), new THREE.Vector3(0, -0.16, 0.53), new THREE.Vector3(0, -0.23, 0.48)],
    [[0.075, 0.09], [0.06, 0.075], [0.04, 0.05], [0.025, 0.03], [0.006, 0.006]], { segments: 24, around: 14 }), beakMaterial));
  const jaw = new THREE.Group(); jaw.position.set(0, -0.07, 0.2); head.add(jaw);
  jaw.add(new THREE.Mesh(loft([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.03, 0.14), new THREE.Vector3(0, -0.06, 0.25)], [[0.06, 0.04], [0.045, 0.028], [0.006, 0.006]], { segments: 16, around: 12 }), beakMaterial));
  const throat = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(4, 1.4, 0.2) }));
  throat.position.set(0, -0.06, 0.24); head.add(throat);
  const eyeMaterial = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(4, 2.6, 0.9) });
  for (const s of [1, -1]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), eyeMaterial); eye.position.set(s * 0.15, 0.06, 0.12); head.add(eye); }
  // Legs hang below the belly with talons curled, swinging a little with each wingbeat.
  const legMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.2 });
  legMaterial.colorNode = rgb(0.07, 0.045, 0.035).mul(fract(uv().y.mul(18)).mul(0.4).add(0.7));
  legMaterial.emissiveNode = rgb(0.6, 0.12, 0.02).mul(heat.mul(0.15));
  const legs = [1, -1].map((s) => {
    const leg = new THREE.Group(); leg.position.set(s * 0.17, -0.3, -0.05); body.add(leg);
    leg.add(new THREE.Mesh(loft([new THREE.Vector3(0, 0.1, 0), new THREE.Vector3(0, -0.25, -0.08), new THREE.Vector3(0, -0.55, -0.12)], [[0.08, 0.08], [0.06, 0.06], [0.045, 0.045]], { segments: 12, around: 10, reference: new THREE.Vector3(0, 0, 1) }), legMaterial));
    for (const [dx, dz] of [[-0.06, 1], [0, 1], [0.06, 1], [0, -1]]) {
      leg.add(new THREE.Mesh(loft([new THREE.Vector3(0, -0.55, -0.12), new THREE.Vector3(dx, -0.62, -0.12 + dz * 0.1), new THREE.Vector3(dx * 1.3, -0.72, -0.12 + dz * 0.15), new THREE.Vector3(dx * 1.4, -0.78, -0.12 + dz * 0.1)],
        [[0.03, 0.03], [0.025, 0.025], [0.016, 0.016], [0.004, 0.004]], { segments: 10, around: 8, reference: new THREE.Vector3(1, 0, 0) }), legMaterial));
    }
    return leg;
  });

  const feathers: Feather[] = [], v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z), UP = v(0, 1, 0);
  const add = (parent: THREE.Object3D, at: THREE.Vector3, dir: THREE.Vector3, length: number, width: number, fire: number, up = UP, fan?: Feather['fan']) =>
    feathers.push({ parent, at, dir: dir.normalize(), up: up.clone().normalize(), length, width, fire, fan });
  // Wings: shoulder (upper arm) → elbow (forearm) → wrist (hand), each a group the flap rotates, lofted arm inside.
  const wings = [1, -1].map((s) => {
    const shoulder = new THREE.Group(); shoulder.position.set(s * 0.3, 0.32, 0.4); body.add(shoulder);
    const elbow = new THREE.Group(); elbow.position.set(s * 1.25, 0.05, -0.15); shoulder.add(elbow);
    const wrist = new THREE.Group(); wrist.position.set(s * 1.45, 0, 0.12); elbow.add(wrist);
    shoulder.add(new THREE.Mesh(loft([v(0, 0, 0), v(s * 0.6, 0.04, -0.06), v(s * 1.25, 0.05, -0.15)], [[0.2, 0.13], [0.16, 0.1], [0.11, 0.07]], { segments: 14, around: 12, reference: v(0, 0, 1) }), plumage));
    elbow.add(new THREE.Mesh(loft([v(0, 0, 0), v(s * 0.7, 0, 0.06), v(s * 1.45, 0, 0.12)], [[0.11, 0.07], [0.09, 0.06], [0.07, 0.045]], { segments: 14, around: 10, reference: v(0, 0, 1) }), plumage));
    wrist.add(new THREE.Mesh(loft([v(0, 0, 0), v(s * 0.5, 0, 0), v(s * 1.0, 0, -0.08)], [[0.07, 0.045], [0.055, 0.035], [0.03, 0.02]], { segments: 10, around: 10, reference: v(0, 0, 1) }), plumage));
    // Primaries: ten long "fingers" fanning from straight out to swept back; they spread on the downstroke.
    for (let k = 0; k < 10; k++) {
      const t = k / 9;
      add(wrist, v(s * (1.0 - t * 0.95), -0.01 - k * 0.006, -0.06 + t * 0.02), v(s, 0, 0), 2.5 - t * 0.9, 0.42, 1, v(0, 1, s * 0.08), { side: s, base: 0.08 + t * 1.15, spread: 0.12 + t * 0.25 });
    }
    // Secondaries along the forearm and tertials along the upper arm, sweeping back to the trailing edge.
    for (let k = 0; k < 14; k++) { const t = k / 13; add(elbow, v(s * 1.45 * (1 - t), -0.02 - (k % 2) * 0.008, 0.08 - t * 0.12), v(s * 0.18 * (1 - t), 0, -1), 1.75 - t * 0.2, 0.42, 0.7); }
    for (let k = 0; k < 7; k++) { const t = k / 6; add(shoulder, v(s * 1.2 * (1 - t), -0.02, -0.12 + t * 0.05), v(s * 0.05, 0, -1), 1.5 - t * 0.45, 0.42, 0.45); }
    // Two rows of coverts over the arm, shorter, on top; small alula-like coverts over the hand.
    for (let k = 0; k < 12; k++) { const t = k / 11; add(k < 6 ? shoulder : elbow, k < 6 ? v(s * 1.2 * (1 - t * 2), 0.05, -0.05) : v(s * 1.45 * (1 - (t - 0.5) * 2), 0.05, 0.08), v(s * 0.12, 0, -1), 0.85, 0.32, 0.25); }
    for (let k = 0; k < 10; k++) { const t = k / 9; add(k < 5 ? shoulder : elbow, k < 5 ? v(s * 1.2 * (1 - t * 2), 0.09, 0.05) : v(s * 1.45 * (1 - (t - 0.5) * 2), 0.08, 0.12), v(s * 0.2, 0, -1), 0.5, 0.2, 0.2); }
    for (let k = 0; k < 6; k++) { const t = k / 5; add(wrist, v(s * 0.9 * (1 - t), 0.05, 0.02), v(s, 0, -0.5 - t), 0.9 - t * 0.2, 0.22, 0.4); }
    return { side: s, shoulder, elbow, wrist };
  });
  // Tail fan at the base of the plumes, hackles around the neck, a mantle down the back, and a flame crest.
  const tail = new THREE.Group(); tail.position.set(0, 0, -1.05); body.add(tail);
  for (let k = 0; k < 9; k++) { const a = (k / 8 - 0.5) * 1.2; add(tail, v(0, 0.03 * Math.cos(a * 2), 0), v(Math.sin(a), -0.15, -Math.cos(a)), 1.45 - Math.abs(a) * 0.4, 0.34, 0.85); }
  for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; add(body, v(Math.sin(a) * 0.2, 0.62 + Math.cos(a) * 0.2, 0.82), v(Math.sin(a) * 0.5, Math.cos(a) * 0.3 - 0.6, -1), 0.65, 0.22, 0.35); }
  for (let k = 0; k < 10; k++) { const t = k / 9; add(body, v((k % 2 ? 1 : -1) * 0.12, 0.42 - t * 0.35, 0.35 - t * 1.25), v((k % 2 ? 1 : -1) * 0.25, 0.05, -1), 0.8, 0.28, 0.3); }
  for (let k = 0; k < 6; k++) { const a = (k / 5 - 0.5) * 0.9; add(head, v(Math.sin(a) * 0.08, 0.15, -0.1), v(Math.sin(a) * 0.6, 0.9, -1), 0.55 + Math.cos(a * 2) * 0.25, 0.2, 1); }

  const seeds = new Float32Array(feathers.length), fires = new Float32Array(feathers.length), random = seededRandom(1771);
  feathers.forEach((feather, i) => { seeds[i] = random(); fires[i] = feather.fire; });
  const fireAttribute = new THREE.InstancedBufferAttribute(fires, 1), seedAttribute = new THREE.InstancedBufferAttribute(seeds, 1);
  const vanes = new THREE.InstancedMesh(featherGeometry(), featherMaterial(instancedBufferAttribute<'float'>(fireAttribute, 'float'), instancedBufferAttribute<'float'>(seedAttribute, 'float'), heat, time), feathers.length);
  vanes.frustumCulled = false; vanes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // Tail plumes: long camera-facing ribbons whose shape is computed each frame (fan, droop, curl, travelling wave).
  const plumeVerts = PLUMES * PLUME_POINTS * 2, plumePosition = new Float32Array(plumeVerts * 3), plumeNormal = new Float32Array(plumeVerts * 3);
  const plumeUv = new Float32Array(plumeVerts * 2), plumeSeed = new Float32Array(plumeVerts), plumeIndex: number[] = [];
  for (let p = 0; p < PLUMES; p++) for (let i = 0; i < PLUME_POINTS; i++) {
    const a = (p * PLUME_POINTS + i) * 2;
    plumeUv.set([0, i / (PLUME_POINTS - 1), 1, i / (PLUME_POINTS - 1)], a * 2); plumeSeed[a] = plumeSeed[a + 1] = p / PLUMES;
    if (i < PLUME_POINTS - 1) plumeIndex.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const plumeGeometry = new THREE.BufferGeometry();
  const plumePositionAttribute = new THREE.BufferAttribute(plumePosition, 3), plumeNormalAttribute = new THREE.BufferAttribute(plumeNormal, 3);
  plumePositionAttribute.setUsage(THREE.DynamicDrawUsage); plumeNormalAttribute.setUsage(THREE.DynamicDrawUsage);
  plumeGeometry.setAttribute('position', plumePositionAttribute); plumeGeometry.setAttribute('normal', plumeNormalAttribute);
  plumeGeometry.setAttribute('uv', new THREE.BufferAttribute(plumeUv, 2)); plumeGeometry.setAttribute('seed', new THREE.BufferAttribute(plumeSeed, 1));
  plumeGeometry.setIndex(plumeIndex);
  const plumes = new THREE.Mesh(plumeGeometry, featherMaterial(float(1.15), attribute<'float'>('seed', 'float'), heat, time));
  plumes.frustumCulled = false;
  // Plume centre lines in world space, for flame emission (PLUMES × PLUME_POINTS × xyz).
  const plumeLine = new Float32Array(PLUMES * PLUME_POINTS * 3);
  const tips = new Float32Array(feathers.length * 3);

  const local = new THREE.Matrix4(), world = new THREE.Matrix4(), basis = new THREE.Matrix4(), x = new THREE.Vector3(), y = new THREE.Vector3(), dir = new THREE.Vector3();
  const tip = new THREE.Vector3(), point = new THREE.Vector3(), step3 = new THREE.Vector3(), side = new THREE.Vector3(), toCamera = new THREE.Vector3(), normal = new THREE.Vector3();
  const tailBase = new THREE.Vector3();
  return {
    root, body, head, jaw, legs, wings, vanes, plumes, feathers, tips, plumeLine,
    /** Poses every feather and plume from the rig (call after posing the groups); `fan` opens the primaries. */
    pose(fan: number, plumeTime: number, lift: number, camera: THREE.Camera) {
      root.updateMatrixWorld(true);
      feathers.forEach((feather, i) => {
        dir.copy(feather.dir);
        if (feather.fan) { const a = feather.fan.base * (1 + (fan - 1) * 0.5) + feather.fan.spread * (fan - 1); dir.set(feather.fan.side * Math.cos(a), 0, -Math.sin(a)); }
        x.crossVectors(feather.up, dir).normalize(); y.crossVectors(dir, x);
        basis.makeBasis(x.multiplyScalar(feather.width), y, dir.multiplyScalar(feather.length)).setPosition(feather.at);
        world.multiplyMatrices(feather.parent.matrixWorld, local.copy(basis));
        vanes.setMatrixAt(i, world);
        tip.set(0, 0, 0.92).applyMatrix4(world); tips.set([tip.x, tip.y, tip.z], i * 3);
      });
      vanes.instanceMatrix.needsUpdate = true;
      camera.getWorldPosition(toCamera);
      tailBase.set(0, 0, -1.1).applyMatrix4(body.matrixWorld);
      for (let p = 0; p < PLUMES; p++) {
        const spread = (p / (PLUMES - 1) - 0.5) * 2, length = 4.6 - Math.abs(spread) * 1.1, seg = length / (PLUME_POINTS - 1);
        point.copy(tailBase);
        for (let i = 0; i < PLUME_POINTS; i++) {
          const t = i / (PLUME_POINTS - 1);
          const yaw = spread * (0.55 + t * 0.4) + Math.sin(plumeTime * 1.7 - i * 0.32 + p * 1.1) * (0.03 + t * 0.16);
          const pitch = -0.65 + t * t * 1.1 + Math.sin(plumeTime * 2.1 - i * 0.28 + p * 0.7) * (0.04 + t * 0.12) - lift * t * 0.35;
          step3.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).transformDirection(body.matrixWorld);
          if (i > 0) point.addScaledVector(step3, seg);
          plumeLine.set([point.x, point.y, point.z], (p * PLUME_POINTS + i) * 3);
          // Width: a thin quill, then a burning vane that swells toward the end and closes to a point.
          const width = 0.06 + 0.42 * THREE.MathUtils.smoothstep(t, 0.25, 0.8) * (1 - THREE.MathUtils.smoothstep(t, 0.9, 1)) + 0.05 * Math.sin(t * 9 + p);
          side.subVectors(toCamera, point).cross(step3).normalize();
          normal.crossVectors(side, step3).normalize();
          const a = (p * PLUME_POINTS + i) * 2;
          plumePosition.set([point.x - side.x * width / 2, point.y - side.y * width / 2, point.z - side.z * width / 2, point.x + side.x * width / 2, point.y + side.y * width / 2, point.z + side.z * width / 2], a * 3);
          plumeNormal.set([normal.x, normal.y, normal.z, normal.x, normal.y, normal.z], a * 3);
        }
      }
      plumePositionAttribute.needsUpdate = true; plumeNormalAttribute.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------- The mode

export function createFirePhoenixMode(budget: QualityBudget): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  const lens = camera as THREE.PerspectiveCamera;
  lens.fov = 50; lens.far = 1200;
  const time = uniform(0), travel = uniform(0), lavaPulse = uniform(0), heat = uniform(0.6);
  const finish = createCinematic({ grain: 0.05, halation: 0.45, vignette: 0.55, soften: 0.12, shadows: [0.01, 0.004, 0.002] });
  const haze = new THREE.Color(0x3a170b);
  scene.fog = new THREE.FogExp2(haze, 0.0058);

  // Sky: low smoke lit orange from below, a bright hazy opening far down the valley.
  const skyMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  const sky = normalize(positionLocal), opening = dot(sky, normalize(vec3(0, 0.06, -1))).max(0);
  const smoke = mx_fractal_noise_float(vec3(sky.xz.div(sky.y.add(0.3)).mul(1.4).add(vec2(time.mul(0.01), time.mul(0.02))), time.mul(0.015)), 4, 2, 0.5).mul(0.5).add(0.5);
  const horizon = rgb(haze.r, haze.g, haze.b), zenith = rgb(0.03, 0.022, 0.02);
  skyMaterial.colorNode = mix(horizon, zenith, smoothstep(0, 0.35, sky.y)).mul(smoothstep(0.3, 0.8, smoke).mul(0.85).oneMinus())
    .add(rgb(1, 0.5, 0.2).mul(opening.pow(16).mul(0.45).add(opening.pow(90).mul(2.5))).mul(smoothstep(0.3, 0.7, smoke).mul(0.75).oneMinus()))
    .add(rgb(0.6, 0.18, 0.04).mul(smoothstep(0.35, 0, sky.y).mul(smoke).mul(0.35).mul(lavaPulse.mul(0.6).add(1))));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), skyMaterial));

  // The canyon: one plane displaced by `canyonHeight`, normals from finite differences in the vertex stage.
  const [segX, segZ] = [tier(budget, 260, 200, 130), tier(budget, 520, 400, 260)];
  const terrainGeometry = new THREE.PlaneGeometry(320, 700, segX, segZ).rotateX(-Math.PI / 2);
  const rock = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
  const tx = positionLocal.x, tw = positionLocal.z.add(TERRAIN_Z).sub(travel), th = canyonHeight(tx, tw);
  rock.positionNode = vec3(tx, th, positionLocal.z);
  const e = 0.9, slopeNormal = normalize(vec3(th.sub(canyonHeight(tx.add(e), tw)), e, th.sub(canyonHeight(tx, tw.add(e)))));
  const surfaceNormal = varying(slopeNormal);
  const rp = vec3(positionWorld.x, positionWorld.y, positionWorld.z.sub(travel));
  // Rock grain: a noisy tilt of the shading normal, so faces read as fractured stone between the vertices.
  rock.normalNode = transformNormalToView(normalize(surfaceNormal.add(mx_fractal_noise_vec3(rp.mul(vec3(0.3, 0.6, 0.3)), 2, 2, 0.5).mul(0.4))));
  const grit = mx_fractal_noise_float(rp.mul(0.3), 2, 2, 0.5).mul(0.5).add(0.5);
  const strata = sin(rp.y.mul(1.3).add(mx_noise_float(rp.mul(0.04)).mul(5))).mul(0.5).add(0.5).pow(3);
  const basalt = mix(rgb(0.03, 0.022, 0.019), rgb(0.12, 0.08, 0.062), grit.mul(0.6).add(strata.mul(0.45)));
  const height = rp.y.sub(LAVA_Y);
  const underglow = exp(height.mul(-0.09)).mul(0.5).add(exp(height.mul(-0.6)).mul(1.5));
  const veins = smoothstep(0.018, 0, abs(mx_noise_float(rp.mul(0.07)))).mul(smoothstep(0.55, 0.75, grit)).mul(exp(height.mul(-0.05)));
  const fall = lavaFall(positionWorld.x, rp.z);
  const steep = smoothstep(0.85, 0.5, surfaceNormal.y);
  const cascade = fall.mask.mul(steep).mul(smoothstep(fall.top, fall.top.sub(4), rp.y)).mul(smoothstep(LAVA_Y - 1, LAVA_Y + 2, rp.y));
  const flow = mx_fractal_noise_float(vec3(fall.across.mul(0.45), rp.y.mul(0.11).add(time.mul(2.6)), fall.cell), 2, 2, 0.5).mul(0.5).add(0.5);
  const molten = mix(rgb(0.9, 0.16, 0.02).mul(1.1), rgb(1, 0.55, 0.16).mul(2.4), smoothstep(0.35, 0.8, flow));
  rock.emissiveNode = rgb(0.7, 0.14, 0.02).mul(underglow.mul(lavaPulse.mul(0.8).add(0.6)))
    .add(rgb(1, 0.28, 0.04).mul(veins.mul(lavaPulse.mul(0.6).add(0.3))))
    .add(molten.mul(cascade.mul(smoothstep(0.25, 0.55, flow).mul(0.8).add(0.35))));
  rock.colorNode = mix(basalt, rgb(0.02, 0.01, 0.006), cascade);
  const terrain = new THREE.Mesh(terrainGeometry, rock);
  terrain.position.z = TERRAIN_Z; terrain.frustumCulled = false;
  scene.add(terrain);

  // The lava river: domain-warped noise for crust plates over molten cracks, flowing toward the camera; it churns
  // brighter where a lava fall lands.
  const lavaMaterial = new THREE.MeshBasicNodeMaterial();
  const lp = vec2(positionWorld.x, positionWorld.z.sub(travel).sub(time.mul(1.4)));
  const warp = mx_fractal_noise_float(vec3(lp.mul(0.035), time.mul(0.04)), 3, 2, 0.5);
  const plates = mx_fractal_noise_float(vec3(lp.mul(0.1).add(warp.mul(1.8)), time.mul(0.08)), 4, 2, 0.5);
  const channel = smoothstep(9, 1, abs(positionWorld.x.sub(meanderNode(positionWorld.z.sub(travel))))).mul(smoothstep(-0.1, 0.4, warp));
  const cracks = smoothstep(0.07, 0, abs(plates)).max(channel), crust = cracks.oneMinus();
  const splash = lavaFall(positionWorld.x, positionWorld.z.sub(travel)).mask.mul(smoothstep(9, 15.5, abs(positionWorld.x.sub(meanderNode(positionWorld.z.sub(travel))))));
  const hot = mix(rgb(0.75, 0.12, 0.012).mul(1.3), rgb(1, 0.5, 0.14).mul(2.6), cracks.mul(channel.mul(0.5).add(0.5)).add(splash.mul(0.5)).min(1));
  lavaMaterial.colorNode = mix(hot, rgb(0.04, 0.012, 0.006).add(rgb(0.3, 0.04, 0.005).mul(plates.add(0.3).max(0))), crust.mul(splash.mul(0.7).oneMinus())).mul(lavaPulse.mul(0.5).add(0.75));
  const lava = new THREE.Mesh(new THREE.PlaneGeometry(320, 700).rotateX(-Math.PI / 2), lavaMaterial);
  lava.position.set(0, LAVA_Y, TERRAIN_Z);
  scene.add(lava);

  // Light: lava from below, a warm back light down the valley, a cool dim front fill, and the bird's own fire.
  const under = new THREE.HemisphereLight(0x3a2a28, 0xff5a1a, 1.3);
  const back = new THREE.DirectionalLight(0xffa060, 1.6); back.position.set(0, 40, -80);
  const front = new THREE.DirectionalLight(0x8090b0, 0.35); front.position.set(10, 10, 40);
  const birdFire = new THREE.PointLight(0xff7a2a, 30, 30, 1.4);
  scene.add(under, back, front, birdFire);

  const phoenix = buildPhoenix(heat, time);
  scene.add(phoenix.root, phoenix.vanes, phoenix.plumes);
  const flames = createFlames(tier(budget, 3600, 2600, 1300), time);
  const sparks = createParticles(loadTexture(sparkUrl), tier(budget, 900, 600, 300), { drag: 0.6, gravity: 5 });
  const embers = createParticles(loadTexture(emberUrl), tier(budget, 2600, 1600, 800), { drag: 0.15, gravity: -0.7 });
  const smokeColumns = createParticles(loadTexture(smokeUrl), tier(budget, 220, 160, 90), { drag: 0.05, gravity: -0.4, additive: false });
  scene.add(smokeColumns.object, embers.object, flames.object, sparks.object);

  // Flame sources, weighted by how much each feather burns; plume vanes burn most of all.
  const sources: number[] = [];
  phoenix.feathers.forEach((feather, i) => { for (let k = 0; k < Math.round(feather.fire * 4); k++) sources.push(i); });
  const random = seededRandom(4242), tempo = new TempoTracker(), flareGate = beatGate(6);
  const centre = new THREE.Vector3();
  let stroke = 1, power = 0.6, lastStroke = 0, flare = 0, spreadHold = 0, screech = 0, speed = 18, birdX = 0, roll = 0, glide = 0, emitDebt = 0, emberDebt = 0;
  return {
    scene, camera,
    ready: Promise.resolve(),
    update(frame) {
      resizeCamera(lens, frame.aspect);
      time.value = frame.time; finish.update(frame);
      const step = settleStep(frame), { bounce, bass, loudness, impact } = frame.response, motion = frame.reducedMotion ? 0 : 1;
      tempo.update(frame.time, frame.audio.onset, frame.delta);
      // The flight: faster when the music pushes, steering down the canyon's centre line and banking into its turns.
      speed = approach(speed, 16 + bounce * 22 + loudness * 8, step, 0.6);
      travel.value += speed * frame.delta;
      const w = -travel.value, ahead = meander(w + 12), here = meander(w);
      birdX = approach(birdX, here + Math.sin(frame.time * 0.23) * 3 * motion, step, 0.4);
      roll = approach(roll, THREE.MathUtils.clamp((ahead - here) * -0.09, -0.5, 0.5) * motion, step, 0.5);
      lavaPulse.value = approach(lavaPulse.value, bass, step, 0.12);

      // Wingbeats: a full downstroke on each beat; when the music is quiet, a slow glide beat keeps the bird aloft.
      if (frame.audio.onset && stroke > 0.55) { stroke = 0; power = 0.55 + bounce * 0.8; lastStroke = frame.time; }
      else if (frame.time - lastStroke > 2.6 && stroke >= 1) { stroke = 0; power = 0.3; lastStroke = frame.time; }
      stroke = Math.min(1, stroke + frame.delta * 1.5);
      // A drop: wings flung open and held high, a screech, and the whole bird bursts into flame.
      if (frame.audio.onset && impact > 0.85 && loudness > 0.55 && flareGate(frame.time, true)) { flare = 1; spreadHold = 1; screech = 1; }
      flare = Math.max(0, flare - step / 1.6); spreadHold = Math.max(0, spreadHold - step / 2.2); screech = Math.max(0, screech - step / 0.9);
      heat.value = approach(heat.value, 0.55 + loudness * 0.7 + bass * 0.5 + flare * (frame.reducedFlash ? 0.5 : 1.4), step, 0.15);
      glide += frame.delta;

      const lift = wingStroke(stroke) * power * motion, lag = wingStroke(Math.max(0, stroke - 0.07)) * power * motion, lag2 = wingStroke(Math.max(0, stroke - 0.13)) * power * motion;
      const hold = THREE.MathUtils.smoothstep(spreadHold, 0, 0.4);
      // Rest pose is a raised V (as in the reference); the downstroke sweeps through it.
      const dihedral = 0.62 + Math.sin(glide * 0.8) * 0.05 * motion;
      const { body, head, jaw, legs, wings } = phoenix;
      for (const { side, shoulder, elbow, wrist } of wings) {
        shoulder.rotation.set(0.05 - lift * 0.08, side * (0.12 - Math.max(0, lift) * 0.25) * (1 - hold), side * THREE.MathUtils.lerp(dihedral + lift, 0.75, hold));
        elbow.rotation.set(0, side * (0.1 + Math.max(0, lag) * 0.45) * (1 - hold), side * THREE.MathUtils.lerp(lag * 0.45 - 0.08, -0.1, hold));
        wrist.rotation.set(0, side * (0.08 + Math.max(0, lag2) * 0.4) * (1 - hold), side * THREE.MathUtils.lerp(lag2 * 0.5 - 0.12, -0.05, hold));
      }
      phoenix.root.position.set(birdX, BIRD_Y + Math.sin(frame.time * 0.37) * 1.6 * motion - lift * 0.5, 0);
      phoenix.root.rotation.set(-0.12 - lift * 0.06 - hold * 0.15, Math.sin(frame.time * 0.19) * 0.12 * motion, roll);
      head.rotation.set(0.25 - screech * 0.45 * motion + lift * 0.1, Math.sin(frame.time * 0.5) * 0.15 * motion, 0);
      jaw.rotation.x = Math.max(screech, loudness > 0.85 ? 0.3 : 0) * 0.55;
      legs.forEach((leg, i) => { leg.rotation.x = 0.35 + lag * 0.2 + Math.sin(frame.time * 1.3 + i) * 0.05 * motion; });
      body.rotation.x = -lift * 0.05;
      const fan = 1 + Math.max(0, -lift) * 0.5 + hold * 0.6 - Math.max(0, lift) * 0.3;
      phoenix.pose(fan, frame.time * (frame.reducedMotion ? 0.3 : 1) + glide * bounce * 0.5, lift, camera);

      // Fire: flame puffs leave the burning feathers and stream back in the slipstream.
      const tips = phoenix.tips, line = phoenix.plumeLine, wind = 4 + speed * 0.3;
      emitDebt += frame.delta * (260 + loudness * 420 + flare * 1400) * Math.max(0.5, Math.min(1, budget.particleScale));
      const brightness = 0.8 + heat.value * 0.7;
      while (emitDebt >= 1) {
        emitDebt -= 1;
        let px: number, py: number, pz: number;
        if (random() < 0.32) {
          const i = Math.min(PLUME_POINTS - 1, Math.floor(PLUME_POINTS * (0.45 + random() * 0.55))) + Math.floor(random() * PLUMES) * PLUME_POINTS;
          px = line[i * 3]; py = line[i * 3 + 1]; pz = line[i * 3 + 2];
        } else {
          const f = sources[Math.floor(random() * sources.length)];
          px = tips[f * 3]; py = tips[f * 3 + 1]; pz = tips[f * 3 + 2];
        }
        flames.emit(px + (random() - 0.5) * 0.2, py + (random() - 0.5) * 0.2, pz + (random() - 0.5) * 0.2,
          (random() - 0.5) * 1.2, 0.8 + random() * 1.8, -wind * (0.45 + random() * 0.5), 0.45 + random() * 0.55 + flare * 0.4, (0.7 + random() * 0.9) * (0.8 + heat.value * 0.4), brightness, random());
      }
      // Sparks fly off the wingtips with the highs and on beats.
      const sparkCount = (frame.audio.onset ? 14 : 0) + Math.floor(frame.audio.highs * 4 * random() + flare * 6);
      for (let k = 0; k < sparkCount; k++) {
        const f = sources[Math.floor(random() * sources.length)];
        sparks.emit(tips[f * 3], tips[f * 3 + 1], tips[f * 3 + 2], (random() - 0.5) * 8, random() * 6, -wind - random() * 6, 0.6 + random() * 0.8, 0.12 + random() * 0.12, 1.6, 0.8, 0.3);
      }
      // The canyon air: embers rising off the lava and streaming past, and dark smoke columns.
      emberDebt += frame.delta * (320 + loudness * 420 + frame.audio.highs * 300) * Math.max(0.5, Math.min(1, budget.particleScale));
      while (emberDebt >= 1) {
        emberDebt -= 1;
        const near = random() < 0.5, z = near ? -50 + random() * 60 : -160 + random() * 175, x = meander(z - travel.value) + (random() - 0.5) * (near ? 22 : 34);
        embers.emit(x, near ? BIRD_Y - 12 + random() * 24 : LAVA_Y + random() * 40, z, (random() - 0.5) * 1.5, 0.5 + random() * 2.5, speed * (0.9 + random() * 0.2), 4 + random() * 4, near ? 0.08 + random() * 0.18 : 0.15 + random() * 0.35, 2.2, 0.6 + random() * 0.35, 0.15);
      }
      if (frame.delta > 0 && random() < frame.delta * 6) {
        const z = -220 + random() * 150, x = meander(z - travel.value) + (random() - 0.5) * 30;
        smokeColumns.emit(x, LAVA_Y + 2, z, (random() - 0.5) * 2, 3 + random() * 3, speed, 14 + random() * 6, 18 + random() * 16, 0.035, 0.022, 0.02);
      }
      flames.update(step); sparks.update(step); embers.update(step); smokeColumns.update(step);
      birdFire.position.set(birdX, phoenix.root.position.y + 0.5, 0.5);
      birdFire.intensity = 15 + heat.value * 35;

      // Camera: ahead of the bird and off to one side, looking back up the valley so the canyon recedes behind it.
      const swing = 0.5 + Math.sin(frame.time * 0.06) * 0.3 * (motion * 0.8 + 0.2), distance = 11 - bounce * 1.2 * motion;
      const shake = flare * 0.25 * motion;
      centre.set(birdX, phoenix.root.position.y + 0.6, 0);
      camera.position.set(centre.x + Math.sin(swing) * distance + Math.sin(frame.time * 31) * shake, centre.y - 3.2 + Math.sin(frame.time * 0.13) * 1.2 + Math.cos(frame.time * 27) * shake, centre.z + Math.cos(swing) * distance);
      camera.lookAt(centre.x - Math.sin(swing) * 1.2, centre.y, centre.z - 3);
    },
    filter: (input) => finish.filter(input),
    dispose() { disposeScene(scene); },
  };
}
