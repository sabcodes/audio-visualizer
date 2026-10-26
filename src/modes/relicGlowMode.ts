import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { exp, float, fract, hash, mix, positionLocal, screenCoordinate, sin, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { hash2, palette } from './shaderModes';
import { createHits, linearRgb } from './hitPulse';
import { seededRandom } from '../rendering/diagnostics';

type V3 = Node<'vec3'>;

interface Relic { name: string; tint: number; make(time: Node<'float'>): { object: THREE.Object3D; act(t: number, level: number): void } }

const standard = (hex: number, roughness = 0.35, metalness = 0, emissive = 0) => {
  const material = new THREE.MeshStandardNodeMaterial({ color: hex, roughness, metalness });
  if (emissive) { material.emissive = new THREE.Color(hex); material.emissiveIntensity = emissive; }
  return material;
};
const glowing = (colour: V3) => { const material = new THREE.MeshBasicNodeMaterial(); material.colorNode = colour; return material; };
const box = (w: number, h: number, d: number, r = 0.05) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2) * 0.99);
const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z); return m; };
const rgb = (hex: number) => vec3(...linearRgb(hex));

/**
 * The twelve objects in clip order, each built from primitives in code (no models): a turntable object with
 * its own small "alive" action. Everything is seen through a coarse pixel grid, so silhouettes matter more
 * than detail.
 */
export const RELICS: readonly Relic[] = [
  { name: 'controller', tint: 0x7dffa0, make() {
    const g = new THREE.Group(), shell = standard(0x2a2e33, 0.4);
    g.add(mesh(box(1.3, 0.5, 0.36, 0.2), shell));
    for (const side of [-1, 1]) {
      const horn = mesh(new THREE.CapsuleGeometry(0.21, 0.5, 6, 16), shell, side * 0.52, -0.32, 0); horn.rotation.z = side * 0.45; g.add(horn);
      const stick = mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.12, 20), standard(0x16181b), side * 0.24, -0.12, 0.22); stick.rotation.x = Math.PI / 2; g.add(stick);
    }
    const pad = standard(0x1a1c20);
    g.add(mesh(new THREE.BoxGeometry(0.22, 0.07, 0.05), pad, -0.42, 0.06, 0.19), mesh(new THREE.BoxGeometry(0.07, 0.22, 0.05), pad, -0.42, 0.06, 0.19));
    [[0.42, 0.15, 0x3fe08a], [0.53, 0.05, 0xff4a5a], [0.42, -0.05, 0x5aa8ff], [0.31, 0.05, 0xff7ad8]].forEach(([x, y, c]) => g.add(mesh(new THREE.SphereGeometry(0.045, 12, 8), standard(c, 0.2, 0, 0.6), x, y, 0.19)));
    return { object: g, act: (t) => { g.rotation.x = 0.5 + Math.sin(t * 2) * 0.08; } };
  } },
  { name: 'tamagotchi', tint: 0xff9ad8, make(time) {
    const g = new THREE.Group(), egg = mesh(new THREE.SphereGeometry(0.55, 32, 24), standard(0xf2a8d8, 0.3)); egg.scale.set(0.85, 1, 0.45); g.add(egg);
    const screen = mesh(new THREE.PlaneGeometry(0.42, 0.42), glowing(palette(uv().x.add(uv().y).mul(0.8).add(time.mul(0.6))).mul(1.6)), 0, 0.08, 0.252); screen.rotation.z = Math.PI / 4; g.add(screen);
    for (const x of [-0.18, 0, 0.18]) g.add(mesh(new THREE.SphereGeometry(0.05, 12, 8), standard(0xffe07a, 0.3), x, -0.32, 0.22));
    // A bead chain looped through the top, swinging.
    const chain = new THREE.Group(); chain.position.set(0, 0.55, 0); g.add(chain);
    for (let k = 0; k < 14; k++) { const a = (k / 13) * Math.PI; chain.add(mesh(new THREE.SphereGeometry(0.035, 10, 8), standard(0xd0d4dc, 0.2, 0.8), Math.cos(a) * 0.22, 0.05 + Math.sin(a) * 0.3, 0)); }
    return { object: g, act: (t, level) => { chain.rotation.z = Math.sin(t * 5) * (0.35 + level * 0.3); } };
  } },
  { name: 'gba sp', tint: 0x9ab8ff, make(time) {
    const g = new THREE.Group(), body = standard(0x5a6ad0, 0.3, 0.2);
    const lower = mesh(box(0.9, 0.12, 0.85, 0.06), body, 0, 0, 0.42); g.add(lower);
    g.add(mesh(new THREE.BoxGeometry(0.16, 0.03, 0.05), standard(0x202020), -0.25, 0.07, 0.45), mesh(new THREE.BoxGeometry(0.05, 0.03, 0.16), standard(0x202020), -0.25, 0.07, 0.45));
    for (const x of [0.2, 0.3]) g.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 16), standard(0x303038), x, 0.07, 0.42 - (x - 0.2)));
    const flap = new THREE.Group(); g.add(flap);
    flap.add(mesh(box(0.9, 0.12, 0.85, 0.06), body, 0, 0, -0.42));
    const screen = mesh(new THREE.PlaneGeometry(0.62, 0.42), glowing(mix(rgb(0x3a8aff), rgb(0x8aff6a), uv().y.add(sin(uv().x.mul(12).add(time.mul(2))).mul(0.1)).smoothstep(0.35, 0.6)).mul(1.4)), 0, 0.065, -0.44);
    screen.rotation.x = -Math.PI / 2; flap.add(screen);
    return { object: g, act: (t) => { const open = Math.min(1, t / 0.7); flap.rotation.x = -(0.52 + open * 1.22); g.rotation.x = 0.7; } };
  } },
  { name: 'crushed can', tint: 0xff3a2a, make() {
    const geometry = new THREE.CylinderGeometry(0.33, 0.33, 1.1, 40, 24), p = geometry.attributes.position, random = seededRandom(4);
    const dents = Array.from({ length: 7 }, () => [random() * Math.PI * 2, (random() - 0.5) * 0.9, 0.1 + random() * 0.12]);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
      let squeeze = 1 - Math.exp(-(y * y) / 0.08) * 0.28;
      for (const [da, dy, depth] of dents) squeeze -= depth * Math.exp(-(((a - da + Math.PI * 3) % (Math.PI * 2) - Math.PI) ** 2) / 0.15 - (y - dy) ** 2 / 0.04);
      p.setXYZ(i, x * squeeze, y * (1 - 0.15 * Math.exp(-(y * y) / 0.1)), z * squeeze);
    }
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.25, metalness: 0.6 });
    // Red with a white ribbon wave round the middle.
    const around = positionLocal.x.atan(positionLocal.z), wave = positionLocal.y.sub(sin(around.mul(2)).mul(0.12)).abs().smoothstep(0.08, 0.05);
    material.colorNode = mix(rgb(0xd0101a), vec3(0.95), wave);
    const can = new THREE.Mesh(geometry, material);
    return { object: can, act: (t) => { can.rotation.z = 0.3 + Math.sin(t) * 0.1; } };
  } },
  { name: 'dice', tint: 0xff4040, make() {
    const g = new THREE.Group(), red = standard(0xd01818, 0.25), pip = standard(0xffffff, 0.3);
    const dice = [0, 1, 2].map((k) => {
      const die = new THREE.Group(); die.add(mesh(box(0.42, 0.42, 0.42, 0.07), red));
      for (const [x, y] of [[-0.1, -0.1], [0.1, 0.1], [0, 0]]) die.add(mesh(new THREE.SphereGeometry(0.035, 10, 8), pip, x, y, 0.205));
      for (const [x, y] of [[-0.1, -0.1], [0.1, 0.1]]) die.add(mesh(new THREE.SphereGeometry(0.035, 10, 8), pip, 0.205, x, y));
      die.position.y = (k - 1) * 0.46; g.add(die); return die;
    });
    return { object: g, act: (t) => dice.forEach((die, k) => { die.rotation.y = t * (1.2 + k * 0.7) * (k % 2 ? -1 : 1); die.rotation.x = 0.3; }) };
  } },
  { name: 'cigarette', tint: 0xffa040, make() {
    const g = new THREE.Group();
    const filter = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.55, 24), standard(0xe08a30, 0.6), 0, -0.2, 0);
    const paper = mesh(new THREE.CylinderGeometry(0.105, 0.11, 0.3, 24), standard(0xf2f0ea, 0.7), 0, 0.22, 0);
    const ash = mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.18, 16), standard(0x8a8a88, 0.9), 0, 0.46, 0);
    const ember = mesh(new THREE.SphereGeometry(0.06, 12, 8), standard(0xff5a1a, 0.5, 0, 2.5), 0, 0.38, 0);
    g.add(filter, paper, ash, ember);
    const flakes = Array.from({ length: 8 }, (_, k) => { const f = mesh(new THREE.BoxGeometry(0.04, 0.02, 0.04), standard(0xb0b0ac, 0.9), 0, 0.58, 0); f.userData.k = k; g.add(f); return f; });
    g.rotation.z = -1.1;
    return { object: g, act: (t, level) => flakes.forEach((f, k) => { const a = k * 0.8 + t; f.position.set(Math.cos(a) * 0.08, 0.58 + Math.abs(Math.sin(t * 3 + k)) * (0.05 + level * 0.08), Math.sin(a) * 0.08); f.rotation.set(t * 2 + k, t + k, 0); }) };
  } },
  { name: 'ball', tint: 0xffb020, make() {
    const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.4 });
    const p = positionLocal.normalize(), swoosh = p.y.sub(sin(p.x.mul(3)).mul(0.35)).abs().smoothstep(0.09, 0.05).mul(p.z.greaterThan(0).select(float(1), float(0)));
    material.colorNode = mix(rgb(0xffa010), vec3(1), swoosh);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.55, 40, 28), material);
    return { object: ball, act: (t) => { ball.rotation.set(t * 2.2, t * 0.7, 0); } };
  } },
  { name: 'nokia', tint: 0x9aff7a, make(time) {
    const g = new THREE.Group(); g.add(mesh(box(0.56, 1.25, 0.22, 0.18), standard(0x27324a, 0.35)));
    const screen = mesh(new THREE.PlaneGeometry(0.36, 0.28), glowing(mix(rgb(0x7aff6a), rgb(0x1a5a1a), uv().y.sub(0.62).abs().smoothstep(0.02, 0.06).mul(uv().x.sub(0.5).abs().lessThan(0.32).select(float(1), float(0))).oneMinus().mul(0.8)).mul(sin(time.mul(3)).mul(0.1).add(1.1))), 0, 0.3, 0.112);
    g.add(screen);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) g.add(mesh(box(0.11, 0.07, 0.03, 0.02), standard(0x9affa0, 0.4, 0, 0.8), (c - 1) * 0.14, -0.15 - r * 0.1, 0.115));
    return { object: g, act: (t) => { g.rotation.x = Math.sin(t * 1.6) * 0.3; } };
  } },
  { name: 'sneaker', tint: 0xff5050, make() {
    const g = new THREE.Group();
    const sole = mesh(box(1.15, 0.14, 0.42, 0.06), standard(0xf4f4f0, 0.6), 0, -0.2, 0); g.add(sole);
    const upper = mesh(new THREE.SphereGeometry(0.5, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2), standard(0xf0f0ec, 0.5), 0.05, -0.14, 0); upper.scale.set(1.05, 0.62, 0.42); g.add(upper);
    const heel = mesh(box(0.34, 0.4, 0.4, 0.12), standard(0xf0f0ec, 0.5), -0.36, 0.0, 0); g.add(heel);
    const collar = mesh(new THREE.TorusGeometry(0.14, 0.04, 8, 20), standard(0x202020, 0.6), -0.3, 0.2, 0); collar.rotation.x = Math.PI / 2; g.add(collar);
    for (const z of [-1, 1]) { const swoosh = mesh(new THREE.TorusGeometry(0.32, 0.03, 6, 24, 1.8), standard(0xd02020, 0.4), 0.05, -0.08, z * 0.215); swoosh.rotation.z = 3.6; g.add(swoosh); }
    const laces = Array.from({ length: 4 }, (_, k) => { const lace = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), standard(0xffffff, 0.5), -0.1 + k * 0.1, 0.12 - k * 0.02, 0); lace.rotation.x = Math.PI / 2; g.add(lace); return lace; });
    return { object: g, act: (t) => { laces.forEach((lace, k) => { lace.position.y = 0.12 - k * 0.02 + Math.abs(Math.sin(t * 6 + k)) * 0.06; }); g.rotation.z = Math.sin(t * 1.5) * 0.15; g.position.y = Math.sin(t * 3) * 0.05; } };
  } },
  { name: 'hatchback', tint: 0xffa040, make() {
    const g = new THREE.Group(), paint = standard(0xe07020, 0.35, 0.3), glass = standard(0x101820, 0.1, 0.5);
    g.add(mesh(box(1.6, 0.36, 0.78, 0.12), paint, 0, 0.0, 0));
    const cabin = mesh(new THREE.CylinderGeometry(0.5, 0.65, 0.34, 4, 1), glass, -0.1, 0.33, 0); cabin.rotation.y = Math.PI / 4; cabin.scale.set(1.15, 1, 0.72); g.add(cabin);
    for (const [x, z] of [[-0.5, 0.38], [0.5, 0.38], [-0.5, -0.38], [0.5, -0.38]]) { const wheel = mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.14, 20), standard(0x111111, 0.8), x, -0.18, z); wheel.rotation.x = Math.PI / 2; g.add(wheel); }
    for (const z of [-0.26, 0.26]) g.add(mesh(new THREE.SphereGeometry(0.06, 10, 8), standard(0xfff2c0, 0.2, 0, 2), 0.8, 0.04, z));
    return { object: g, act: (t) => { g.rotation.y = t * 0.6; } };
  } },
  { name: 'lighter', tint: 0xff3030, make() {
    const g = new THREE.Group(), body = mesh(box(0.36, 0.85, 0.18, 0.06), standard(0xd01820, 0.2)); g.add(body);
    g.add(mesh(box(0.36, 0.2, 0.19, 0.03), standard(0xc0c4c8, 0.25, 0.9), 0, 0.52, 0));
    const wheel = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 16), standard(0x808488, 0.3, 0.9), 0.06, 0.66, 0); wheel.rotation.x = Math.PI / 2; g.add(wheel);
    return { object: g, act: (t) => { const crush = Math.min(1, Math.max(0, (t - 0.25) / 0.4)); body.scale.set(1 + crush * 0.25, 1 - crush * 0.35, 1 + crush * 0.3); body.rotation.z = crush * 0.12; } };
  } },
  { name: 'ring toss', tint: 0x6aff6a, make() {
    const g = new THREE.Group(), tan = standard(0xc8a070, 0.6);
    g.add(mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.1, 32), tan, 0, -0.5, 0), mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 16), tan, 0, 0, 0));
    const rings = [0, 1, 2, 3, 4].map((k) => { const ring = mesh(new THREE.TorusGeometry(0.2 - k * 0.02, 0.06, 12, 28), standard(0x2ad04a, 0.25), 0, -0.38 + k * 0.15, 0); ring.rotation.x = Math.PI / 2; g.add(ring); return ring; });
    return { object: g, act: (t) => {
      // The rings slump into a green puddle around the pole.
      const melt = Math.min(1, Math.max(0, (t - 0.5) / 0.8));
      rings.forEach((ring, k) => { ring.position.y = mix1(-0.38 + k * 0.15, -0.42 + k * 0.01, melt); ring.scale.set(1 + melt * (1 + k * 0.3), 1 + melt * (1 + k * 0.3), 1 - melt * 0.8); });
    } };
  } },
];
const mix1 = (a: number, b: number, t: number) => a + (b - a) * t;

/** Rows in the pixel grid at rest (the frame is this many blocks tall). */
export const RELIC_ROWS = 96;

/**
 * Relic Glow (wave 5, clip 7): one glowing retro object at a time in a black void, seen as a coarse pixelated
 * render with a red–blue fringe on its edges and a soft halo in its own colour. Kicks shatter it into its
 * pixel blocks and form the next one (never the same twice); mids spin it, bass widens the halo, hats make
 * the pixel size flicker, loudness widens the fringe.
 */
export function createRelicGlowMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).fov = 35;
  scene.background = new THREE.Color(0x000000);
  const time = uniform(0), aspect = uniform(1), rows = uniform(RELIC_ROWS), fringe = uniform(2), halo = uniform(0.5), dissolve = uniform(0), tint = uniform(new THREE.Vector3(1, 1, 1));
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(2, 3, 4);
  const rim = new THREE.DirectionalLight(0xffffff, 2.2); rim.position.set(-3, 1, -3);
  scene.add(key, rim, new THREE.AmbientLight(0xffffff, 0.15));
  const stage = new THREE.Group(); stage.position.y = -0.1; scene.add(stage);
  const built = RELICS.map((relic) => { const made = relic.make(time); made.object.visible = false; stage.add(made.object); return made; });
  let current = 0;
  built[0].object.visible = true;
  const hits = createHits({ decay: 0.2, interval: 0.6 });
  const bag: number[] = [];
  const nextRelic = () => {
    if (!bag.length) bag.push(...RELICS.map((_, i) => i));
    let pick = bag.splice(Math.floor(Math.random() * bag.length), 1)[0];
    if (pick === current) { bag.push(pick); pick = bag.splice(0, 1)[0]; }
    return pick;
  };
  let age = 0, spin = 0, swap = -1, sinceSwap = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time; aspect.value = frame.aspect;
      const step = settleStep(frame), motion = frame.reducedMotion ? 0 : frame.delta, { bass, loudness } = frame.response;
      hits.update(frame, 0.1);
      sinceSwap += step;
      // Kicks advance (at most every 0.6 s); loud music with no onsets still advances every 1.6 s.
      if (swap < 0 && (hits.fired || (sinceSwap > 1.6 && loudness > 0.3))) { swap = 0; sinceSwap = 0; }
      if (swap >= 0) {
        swap += step;
        // 0.15 s shattering out, swap at the midpoint, 0.15 s forming in.
        if (swap >= 0.15 && built[current].object.visible) { built[current].object.visible = false; current = nextRelic(); built[current].object.visible = true; age = 0; }
        dissolve.value = swap < 0.15 ? swap / 0.15 : Math.max(0, 1 - (swap - 0.15) / 0.15);
        if (swap > 0.3) { swap = -1; dissolve.value = 0; }
      }
      age += motion;
      spin += motion * (0.5 + frame.audio.mid * 2);
      const object = built[current].object;
      object.rotation.y = spin; built[current].act(age, frame.response.bounce);
      stage.rotation.x = Math.sin(frame.time * 0.4) * 0.12;
      tint.value.set(...linearRgb(RELICS[current].tint));
      halo.value = approach(halo.value, 0.35 + bass * 0.8 + hits.flash * 0.2, step, 0.08);
      fringe.value = approach(fringe.value, 1.5 + loudness * 2.5, step, 0.1);
      // Hats make the pixel size flicker by about a block.
      rows.value = RELIC_ROWS + (frame.audio.highs > 0.5 ? Math.round((Math.random() - 0.5) * 8) : 0);
      camera.position.set(0, 0.25, 6.4); camera.lookAt(0, -0.05, 0);
    },
    // The look: nearest-sampled low-res blocks, an RGB offset along x, a halo tinted by the object, a block dissolve.
    filter: (input) => {
      const res = vec2(rows.mul(aspect), rows), cell = uv().mul(res), id = cell.floor();
      const h = hash2(id), shattered = h.lessThan(dissolve);
      const drift = vec2(hash2(id.add(3.1)).sub(0.5), hash2(id.add(7.7)).sub(0.5)).mul(dissolve).mul(6);
      const at = (offset: Node<'float'>) => id.add(drift).add(vec2(offset, 0)).add(0.5).div(res).clamp(0, 1);
      const r = input.sample(at(fringe.mul(-0.5))).r, g = input.sample(at(float(0))).g, b = input.sample(at(fringe.mul(0.5))).b;
      const sharp = vec3(r, g, b).mul(shattered.select(float(0), float(1)));
      // A soft halo in the object's own colour around the middle of the frame (taps of the source would ghost it).
      const fromMiddle = uv().sub(vec2(0.5, 0.52)).mul(vec2(aspect, 1)).length();
      const glow = tint.mul(halo).mul(exp(fromMiddle.div(0.2).negate()).mul(0.35));
      const centre = uv().sub(0.5).mul(vec2(aspect, 1)).length();
      const grain = hash(screenCoordinate.x.add(screenCoordinate.y.mul(1931)).add(fract(time).mul(977))).sub(0.5).mul(0.04);
      const colour = sharp.add(glow).mul(centre.smoothstep(0.9, 0.25).mul(0.8).add(0.2)).add(grain);
      return vec4(colour.max(vec3(0)), 1);
    },
    dispose: () => disposeScene(scene),
  };
}
