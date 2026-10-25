import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { cos, mix, sin, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, wrap, bandEnergies, approach, beatGate, settleStep } from './shared';
import { seededRandom } from '../rendering/diagnostics';
import { createBeatPulse } from './beatPulse';
import { presetBudget, type QualityBudget } from '../rendering/quality';

type F = Node<'float'>;
const palette = (hue: F) => vec3(cos(hue.mul(Math.PI * 2)), cos(hue.mul(Math.PI * 2).sub(2.094)), cos(hue.mul(Math.PI * 2).add(2.094))).mul(0.5).add(0.5);

function fullscreen() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  camera.position.z = 1;
  const material = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  return { scene, camera, material };
}

// ---------------------------------------------------------------- Strange attractors

type Vec3 = [number, number, number];
export interface Attractor {
  name: string;
  /** Time step that keeps forward Euler stable on this system. */
  dt: number;
  center: Vec3;
  /** Scales the attractor to a unit-ish radius. */
  scale: number;
  /** Writes dp/dt for state (x, y, z); `tweak` (0–1, from the mids) nudges one parameter. */
  derive(x: number, y: number, z: number, tweak: number, out: Float32Array): void;
}
export const ATTRACTORS: readonly Attractor[] = [
  { name: 'lorenz', dt: 0.005, center: [0, 0, 26], scale: 1 / 22, derive(x, y, z, tweak, out) {
    out[0] = 10 * (y - x); out[1] = x * (28 + tweak * 8 - z) - y; out[2] = x * y - (8 / 3) * z;
  } },
  { name: 'aizawa', dt: 0.012, center: [0, 0, 0.7], scale: 1 / 1.4, derive(x, y, z, tweak, out) {
    const b = 0.7 - tweak * 0.05;
    out[0] = (z - b) * x - 3.5 * y; out[1] = 3.5 * x + (z - b) * y;
    out[2] = 0.6 + 0.95 * z - z * z * z / 3 - (x * x + y * y) * (1 + 0.25 * z) + 0.1 * z * x * x * x;
  } },
  { name: 'thomas', dt: 0.05, center: [0, 0, 0], scale: 1 / 3.6, derive(x, y, z, tweak, out) {
    const b = 0.208186 - tweak * 0.03;
    out[0] = Math.sin(y) - b * x; out[1] = Math.sin(z) - b * y; out[2] = Math.sin(x) - b * z;
  } },
  { name: 'halvorsen', dt: 0.005, center: [-3.5, -3.5, -3.5], scale: 1 / 8.5, derive(x, y, z, tweak, out) {
    const a = 1.89 + tweak * 0.2;
    out[0] = -a * x - 4 * y - 4 * z - y * y; out[1] = -a * y - 4 * z - 4 * x - z * z; out[2] = -a * z - 4 * x - 4 * y - x * x;
  } },
];
/** Seeds `count` states spaced along one long orbit, so particles start on the attractor itself. */
export function seedAlongOrbit(attractor: Attractor, count: number, out: Float32Array, random: () => number, spacing = 3) {
  const d = new Float32Array(3);
  let x = 0.1 + attractor.center[0] * 0.1, y = 0.2, z = 0.3 + attractor.center[2] * 0.5;
  for (let i = 0; i < 2000; i++) { attractor.derive(x, y, z, 0, d); x += d[0] * attractor.dt; y += d[1] * attractor.dt; z += d[2] * attractor.dt; }
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < spacing; k++) { attractor.derive(x, y, z, 0, d); x += d[0] * attractor.dt; y += d[1] * attractor.dt; z += d[2] * attractor.dt; }
    out[i * 3] = x + (random() - 0.5) * 1e-3; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
  }
}
const ATTRACTOR_RADIUS = 30, RIBBON_POINTS = 32;

export function createAttractorMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const { scene, camera } = sceneDefaults(80);
  const count = Math.round(1400 * budget.particleScale), random = seededRandom(23);
  // Each ribbon is one particle's recent path: a ring of shown positions drawn as fading segments.
  const state = new Float32Array(count * 3), shown = new Float32Array(count * 3), history = new Float32Array(count * RIBBON_POINTS * 3);
  const segments = new Float32Array(count * (RIBBON_POINTS - 1) * 6), colours = new Float32Array(segments.length), heat = new Float32Array(count), d = new Float32Array(3);
  let current = 0, head = 0;
  // State z is each system's natural 'up'.
  const place = (i: number, out: Float32Array, o: number) => {
    const { center, scale } = ATTRACTORS[current], k = scale * ATTRACTOR_RADIUS;
    out[o] = (state[i * 3] - center[0]) * k; out[o + 1] = (state[i * 3 + 2] - center[2]) * k; out[o + 2] = (state[i * 3 + 1] - center[1]) * k;
  };
  const geometry = new THREE.BufferGeometry();
  const segmentAttribute = new THREE.BufferAttribute(segments, 3), colourAttribute = new THREE.BufferAttribute(colours, 3);
  geometry.setAttribute('position', segmentAttribute); geometry.setAttribute('color', colourAttribute);
  const ribbons = new THREE.LineSegments(geometry, new THREE.LineBasicNodeMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  ribbons.frustumCulled = false; scene.add(ribbons);
  const switchGate = beatGate(8), tint = new THREE.Color();
  let morph = 1, idle = 0, tweak = 0, orbit = 0;
  const integrate = (substeps: number, pull: number) => {
    const attractor = ATTRACTORS[current];
    for (let i = 0; i < count; i++) {
      let x = state[i * 3], y = state[i * 3 + 1], z = state[i * 3 + 2], speed = 0;
      for (let s = 0; s < substeps; s++) {
        attractor.derive(x, y, z, tweak, d);
        x += d[0] * attractor.dt; y += d[1] * attractor.dt; z += d[2] * attractor.dt;
        speed = Math.hypot(d[0], d[1], d[2]) * attractor.scale;
      }
      if (!Number.isFinite(x + y + z) || Math.abs(x) + Math.abs(y) + Math.abs(z) > 1e3) { const j = Math.floor(random() * count) * 3; x = state[j]; y = state[j + 1]; z = state[j + 2]; }
      state[i * 3] = x; state[i * 3 + 1] = y; state[i * 3 + 2] = z;
      if (substeps > 0) heat[i] = Math.min(1, speed * 0.6);
      const o = i * 3, tx = shown[o], ty = shown[o + 1], tz = shown[o + 2];
      place(i, shown, o);
      if (pull < 1) { shown[o] = tx + (shown[o] - tx) * pull; shown[o + 1] = ty + (shown[o + 1] - ty) * pull; shown[o + 2] = tz + (shown[o + 2] - tz) * pull; }
      history.set(shown.subarray(o, o + 3), (i * RIBBON_POINTS + head) * 3);
    }
    head = (head + 1) % RIBBON_POINTS;
  };
  const rebuild = (hue: number, glow: number) => {
    for (let i = 0; i < count; i++) {
      // Hotter (faster) stretches glow brighter and shift hue; tails fade out.
      tint.setHSL(wrap(hue + heat[i] * 0.3, 0, 1), 0.85, 0.5).multiplyScalar((0.35 + heat[i] * 0.8) * glow);
      for (let k = 0; k < RIBBON_POINTS - 1; k++) {
        const a = (head + k) % RIBBON_POINTS, b = (a + 1) % RIBBON_POINTS, o = (i * (RIBBON_POINTS - 1) + k) * 6;
        segments.set(history.subarray((i * RIBBON_POINTS + a) * 3, (i * RIBBON_POINTS + a) * 3 + 3), o);
        segments.set(history.subarray((i * RIBBON_POINTS + b) * 3, (i * RIBBON_POINTS + b) * 3 + 3), o + 3);
        const f0 = (k / (RIBBON_POINTS - 1)) ** 1.5, f1 = ((k + 1) / (RIBBON_POINTS - 1)) ** 1.5;
        colours.set([tint.r * f0, tint.g * f0, tint.b * f0, tint.r * f1, tint.g * f1, tint.b * f1], o);
      }
    }
    segmentAttribute.needsUpdate = colourAttribute.needsUpdate = true;
  };
  seedAlongOrbit(ATTRACTORS[current], count, state, random, 60);
  for (let i = 0; i < count; i++) place(i, shown, i * 3);
  // Fill every ribbon's history so the first frame (and a reduced-motion still) already shows full trails.
  for (let k = 0; k < RIBBON_POINTS; k++) integrate(2, 1);
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      idle += frame.delta;
      if (switchGate(frame.time, frame.audio.onset && idle > 6) || idle > 24) {
        // Flow onto the next attractor: re-seed its states, then ease every ribbon from where it is shown.
        current = (current + 1) % ATTRACTORS.length; idle = 0; morph = 0;
        seedAlongOrbit(ATTRACTORS[current], count, state, random, 60);
      }
      morph = Math.min(1, morph + settleStep(frame) / 1.8);
      tweak = approach(tweak, frame.audio.mid, settleStep(frame), 0.5);
      const substeps = Math.min(4, Math.round(frame.delta * 60 * (1 + frame.response.bass * 1.5)));
      if (substeps > 0) integrate(substeps, morph < 1 ? 1 - Math.exp(-frame.delta / (0.5 * (1 - morph) + 0.05)) : 1);
      rebuild(frame.hue, 1 + frame.response.bounce * 0.5);
      orbit += frame.delta * 0.12;
      camera.position.set(Math.sin(orbit) * 72, 22, Math.cos(orbit) * 72);
      camera.lookAt(0, 0, 0);
    },
    dispose: () => disposeScene(scene),
  };
}

// ---------------------------------------------------------------- Physarum slime

export interface PhysarumSettings { sensorAngle: number; sensorDistance: number; turn: number; speed: number; repel: boolean }
/** One agent step on a toroidal grid: sense three trail samples ahead, turn toward (or away from) the strongest, move, deposit. */
export function physarumStep(agents: Float32Array, trail: Float32Array, w: number, h: number, settings: PhysarumSettings, deposit: (i: number) => number, random: () => number) {
  const { sensorAngle, sensorDistance, turn, speed, repel } = settings;
  const sense = (x: number, y: number, a: number) => {
    const sx = Math.floor(x + Math.cos(a) * sensorDistance), sy = Math.floor(y + Math.sin(a) * sensorDistance);
    return trail[((sy % h) + h) % h * w + ((sx % w) + w) % w];
  };
  for (let i = 0, n = agents.length / 3; i < n; i++) {
    let x = agents[i * 3], y = agents[i * 3 + 1], a = agents[i * 3 + 2];
    let left = sense(x, y, a - sensorAngle), front = sense(x, y, a), right = sense(x, y, a + sensorAngle);
    if (repel) { left = -left; front = -front; right = -right; }
    if (front < left && front < right) a += (random() < 0.5 ? -1 : 1) * turn;
    else if (left > right) a -= turn;
    else if (right > left) a += turn;
    x = (x + Math.cos(a) * speed + w) % w; y = (y + Math.sin(a) * speed + h) % h;
    agents[i * 3] = x; agents[i * 3 + 1] = y; agents[i * 3 + 2] = a;
    trail[Math.floor(y) * w + Math.floor(x)] += deposit(i);
  }
}
/** 3×3 box blur with wraparound, then decay; writes into `out`. */
export function diffuseTrail(trail: Float32Array, out: Float32Array, w: number, h: number, decay: number) {
  for (let y = 0; y < h; y++) {
    const up = ((y - 1 + h) % h) * w, row = y * w, down = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const l = (x - 1 + w) % w, r = (x + 1) % w;
      out[row + x] = (trail[up + l] + trail[up + x] + trail[up + r] + trail[row + l] + trail[row + x] + trail[row + r] + trail[down + l] + trail[down + x] + trail[down + r]) / 9 * decay;
    }
  }
}
const SLIME_BANDS = 8;

export function createPhysarumMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const w = budget.particleScale < 1 ? 320 : budget.particleScale > 1 ? 560 : 448, h = Math.round(w * 9 / 16);
  // About 12% of cells hold an agent: denser crowds merge into blobs instead of veins.
  const count = Math.round(w * h * 0.12), random = seededRandom(51);
  const agents = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Start scattered over the whole field with random headings; within a few seconds they self-organise into veins.
    agents.set([random() * w, random() * h, random() * Math.PI * 2], i * 3);
  }
  let trail = new Float32Array(w * h), spare = new Float32Array(w * h);
  const pixels = new Uint8Array(w * h), map = new THREE.DataTexture(pixels, w, h, THREE.RedFormat, THREE.UnsignedByteType);
  map.minFilter = map.magFilter = THREE.LinearFilter; map.needsUpdate = true;
  const { scene, camera, material } = fullscreen();
  const hue = uniform(0), glow = uniform(1), pulse = createBeatPulse();
  // The veins breathe with the bounce, and each beat's burst sends a ripple out from where it lands.
  const { uv: at, ring: wave } = pulse.warp(uv(), w / h);
  const density = texture(map, at).x;
  const veins = density.smoothstep(0.05, 0.8);
  const core = density.smoothstep(0.8, 1).mul(0.5);
  const lift = glow.mul(pulse.surge.mul(0.9).add(1)).add(wave.mul(1.8));
  material.colorNode = vec4(mix(vec3(0.004, 0.003, 0.008), palette(hue.add(density.mul(0.3))).mul(veins.mul(1.4)), veins).add(vec3(core)).mul(lift), 1);
  const settings: PhysarumSettings = { sensorAngle: 0.45, sensorDistance: 9, turn: 0.5, speed: 1, repel: false };
  const bands = new Float32Array(SLIME_BANDS), burstGate = beatGate(0.5);
  let repelFor = 0, hueKick = 0;
  const deposit = (i: number) => 3 + bands[i % SLIME_BANDS] * 6;
  const step = () => {
    physarumStep(agents, trail, w, h, settings, deposit, random);
    diffuseTrail(trail, spare, w, h, 0.9);
    [trail, spare] = [spare, trail];
  };
  for (let i = 0; i < 120; i++) step();
  const upload = () => {
    for (let i = 0; i < pixels.length; i++) pixels[i] = 255 * (1 - Math.exp(-trail[i] * 0.025));
    map.needsUpdate = true;
  };
  upload();
  return {
    scene, camera,
    update(frame) {
      bandEnergies(frame, SLIME_BANDS, bands);
      hue.value = frame.hue + hueKick;
      glow.value = approach(glow.value, 0.8 + frame.response.loudness * 0.5, settleStep(frame), 0.3);
      const beat = burstGate(frame.time, frame.audio.onset);
      // A beat spawns a burst: a tenth of the agents leap to a ring round a random point, heading outward.
      const cx = w * (0.2 + random() * 0.6), cy = h * (0.2 + random() * 0.6);
      pulse.update(frame, beat, [cx / w, cy / h]);
      if (beat) {
        hueKick = (hueKick + 0.05) % 1;
        for (let i = 0; i < count / 10; i++) {
          const j = Math.floor(random() * count), a = random() * Math.PI * 2;
          agents.set([cx + Math.cos(a) * 4, cy + Math.sin(a) * 4, a], j * 3);
        }
        if (frame.response.impact > 0.7) repelFor = 0.35;
      }
      repelFor = Math.max(0, repelFor - settleStep(frame));
      settings.sensorAngle = 0.35 + frame.response.loudness * 0.5;
      settings.speed = 0.9 + frame.response.bass * 1.2 + frame.response.bounce * 0.8;
      settings.repel = repelFor > 0;
      const steps = Math.min(3, Math.round(frame.delta * 60));
      for (let i = 0; i < steps; i++) step();
      if (steps > 0) upload();
    },
    dispose() { disposeScene(scene); map.dispose(); },
  };
}

// ---------------------------------------------------------------- Snowflake (Reiter crystal growth)

/** Axial neighbour offsets on a hex grid. */
const HEX = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]] as const;
export interface ReiterParams { alpha: number; beta: number; gamma: number }
/** Reiter's hexagonal crystal model on an axial grid of radius `radius`; cells outside the hexagon hold the background vapour. */
export function createReiter(radius: number) {
  const size = radius * 2 + 1, cells = size * size;
  const s = new Float32Array(cells), u = new Float32Array(cells), frozenAt = new Float32Array(cells);
  const inside = new Uint8Array(cells), neighbours = new Int32Array(cells * 6);
  for (let q = -radius; q <= radius; q++) for (let r = -radius; r <= radius; r++) {
    const i = (q + radius) * size + (r + radius);
    inside[i] = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) < radius ? 1 : 0;
    HEX.forEach(([dq, dr], k) => {
      const nq = Math.min(radius, Math.max(-radius, q + dq)), nr = Math.min(radius, Math.max(-radius, r + dr));
      neighbours[i * 6 + k] = (nq + radius) * size + (nr + radius);
    });
  }
  let steps = 0, extent = 0;
  const reset = (beta: number) => {
    s.fill(beta); frozenAt.fill(-1); steps = 0; extent = 0;
    const centre = radius * size + radius;
    s[centre] = 1; frozenAt[centre] = 0;
  };
  const receptive = new Uint8Array(cells);
  return {
    radius, size, s, frozenAt,
    get steps() { return steps; },
    /** Furthest frozen cell from the centre, in cells. */
    get extent() { return extent; },
    reset,
    step({ alpha, beta, gamma }: ReiterParams) {
      for (let i = 0; i < cells; i++) {
        let r = s[i] >= 1 ? 1 : 0;
        if (!r) for (let k = 0; k < 6; k++) if (s[neighbours[i * 6 + k]] >= 1) { r = 1; break; }
        receptive[i] = r;
        u[i] = r ? 0 : s[i];
      }
      steps++;
      for (let q = -radius; q <= radius; q++) for (let rr = -radius; rr <= radius; rr++) {
        const i = (q + radius) * size + (rr + radius);
        if (!inside[i]) { s[i] = beta; continue; }
        let sum = 0; for (let k = 0; k < 6; k++) sum += u[neighbours[i * 6 + k]];
        const diffused = u[i] + alpha / 2 * (sum / 6 - u[i]);
        const before = s[i];
        s[i] = diffused + (receptive[i] ? s[i] + gamma : 0);
        if (before < 1 && s[i] >= 1) { frozenAt[i] = steps; extent = Math.max(extent, Math.abs(q), Math.abs(rr), Math.abs(q + rr)); }
      }
    },
  };
}
export type Reiter = ReturnType<typeof createReiter>;

export function createSnowflakeMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const radius = budget.particleScale < 1 ? 70 : budget.particleScale > 1 ? 110 : 90;
  const crystal = createReiter(radius), random = seededRandom(66);
  const params: ReiterParams = { alpha: 1, beta: 0.4, gamma: 0.001 };
  // The next flake's shape follows the music heard while the last one grew: bass-heavy music grows broad plates
  // (more vapour), bright music grows fine branching dendrites (faster freezing), with a little chance on top.
  let heardBass = 0.3, heardHighs = 0.3;
  const newParams = () => {
    params.beta = 0.33 + Math.min(1, heardBass) * 0.12 + random() * 0.03;
    params.gamma = 0.0004 + Math.min(1, heardHighs) * 0.003 + random() * 0.0006;
  };
  crystal.reset(params.beta);
  const pixels = new Uint8Array(crystal.size * crystal.size * 4), map = new THREE.DataTexture(pixels, crystal.size, crystal.size, THREE.RGBAFormat, THREE.UnsignedByteType);
  map.minFilter = map.magFilter = THREE.LinearFilter; map.needsUpdate = true;
  const { scene, camera, material } = fullscreen();
  const aspect = uniform(16 / 9), hue = uniform(0), spin = uniform(0), melt = uniform(0), sparkle = uniform(0), pulse = createBeatPulse();
  // The flake breathes with the bounce and each beat sends a ripple through it that lights the ice it crosses.
  const { uv: at, ring: wave } = pulse.warp(uv(), 16 / 9);
  // Screen → axial hex coordinates (pointy-top), scaled so the hexagon fills most of the height.
  const p = at.sub(0.5).mul(vec2(aspect, 1)).mul(2.15 * radius);
  const c = cos(spin), sn = sin(spin);
  const x = p.x.mul(c).sub(p.y.mul(sn)), y = p.x.mul(sn).add(p.y.mul(c));
  const q = x.mul(Math.sqrt(3) / 3).sub(y.div(3)), r = y.mul(2 / 3);
  const cell = texture(map, vec2(q.add(radius + 0.5).div(crystal.size), r.add(radius + 0.5).div(crystal.size)));
  const ice = cell.x.smoothstep(0.45, 0.6), age = cell.y, vapour = cell.z;
  // Older ice (frozen early) is deeper blue; growth rings show as bands in the freeze time.
  const rings = sin(age.mul(60)).mul(0.5).add(0.5).pow(6).mul(0.35);
  const iceColour = mix(vec3(0.75, 0.9, 1.2), palette(hue.add(0.55)).mul(vec3(0.5, 0.8, 1.3)), age.oneMinus()).mul(rings.add(0.7)).mul(sparkle.mul(0.9).add(1)).mul(pulse.surge.mul(0.7).add(1).add(wave.mul(1.6)));
  const background = mix(vec3(0.002, 0.004, 0.012), vec3(0.01, 0.02, 0.05), uv().y).add(vec3(0.05, 0.12, 0.25).mul(vapour.mul(0.15)));
  material.colorNode = vec4(mix(background, iceColour.mul(melt.oneMinus()), ice.mul(melt.oneMinus().mul(0.85).add(0.15))), 1);
  const upload = () => {
    const steps = Math.max(1, crystal.steps);
    for (let i = 0; i < crystal.s.length; i++) {
      const frozen = crystal.frozenAt[i];
      pixels[i * 4] = Math.min(255, crystal.s[i] * 128);
      pixels[i * 4 + 1] = frozen < 0 ? 0 : 255 * (1 - frozen / steps);
      pixels[i * 4 + 2] = Math.min(255, Math.max(0, (crystal.s[i] - params.beta) * 2000 + 128));
    }
    map.needsUpdate = true;
  };
  for (let i = 0; i < 300; i++) crystal.step(params);
  upload();
  const meltGate = beatGate(6);
  let melting = -1, grown = 0, turn = 0, hueKick = 0, stillGrown = false;
  const flashGate = beatGate(0.35);
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect; hue.value = frame.hue + hueKick;
      heardBass = approach(heardBass, frame.response.bass, settleStep(frame), 4); heardHighs = approach(heardHighs, frame.audio.highs * 2, settleStep(frame), 4);
      const beat = flashGate(frame.time, frame.audio.onset);
      pulse.update(frame, beat);
      if (beat) hueKick = (hueKick + 0.04) % 1;
      sparkle.value = approach(sparkle.value, frame.audio.highs, settleStep(frame), 0.2);
      if (melting < 0 && (crystal.extent > radius * 0.85 || grown > 45 || meltGate(frame.time, frame.audio.onset && frame.response.impact > 0.8 && grown > 8))) melting = 0;
      if (melting >= 0) {
        melting += settleStep(frame);
        melt.value = Math.min(1, melting / 1.5);
        if (melting > 1.8) { newParams(); crystal.reset(params.beta); melting = -1; melt.value = 0; grown = 0; }
      }
      if (frame.reducedMotion && !stillGrown && crystal.extent < radius * 0.5) {
        // A frozen clock would leave a speck, so grow one full flake for the still.
        while (crystal.extent < radius * 0.6 && crystal.steps < 6000) crystal.step(params);
        stillGrown = true; upload();
      }
      const steps = melting >= 0 ? 0 : Math.min(30, Math.round(frame.delta * 60 * (6 + frame.response.bass * 14)));
      params.gamma = Math.max(0.0003, params.gamma * 0.98 + (0.0006 + frame.audio.highs * 0.004) * 0.02);
      for (let i = 0; i < steps; i++) crystal.step(params);
      if (steps > 0) { upload(); grown += frame.delta; }
      // It turns slowly at rest and spins up with the bounce.
      turn += frame.delta * (0.03 + frame.response.bounce * 0.35); spin.value = turn;
    },
    dispose() { disposeScene(scene); map.dispose(); },
  };
}

