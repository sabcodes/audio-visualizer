import * as THREE from 'three/webgpu';
import { abs, attribute, float, fract, mix, mx_noise_float, normalLocal, normalize, positionLocal, positionWorld, uniform, vec2, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { createHits, linearRgb, variantSequence } from './hitPulse';
import { sectionWatch } from './waveSixShared';
import { seededRandom } from '../rendering/diagnostics';
import { presetBudget, type QualityBudget } from '../rendering/quality';

/** The tower's stacked sections, bottom up: half-width of the footprint and the top of the section, in metres. */
export const TOWER_SECTIONS: readonly { top: number; half: number }[] = [
  { top: 70, half: 36 }, { top: 250, half: 30 }, { top: 300, half: 33 }, { top: 470, half: 25 }, { top: 560, half: 19 },
];
export const TOWER_HEIGHT = 700;
const FLOOR = 3.6;
/** Half-width of the core at height y (the crown above the last section tapers to a point). */
export function towerHalf(y: number) {
  for (const section of TOWER_SECTIONS) if (y <= section.top) return section.half;
  const last = TOWER_SECTIONS[TOWER_SECTIONS.length - 1];
  return Math.max(0, last.half * (1 - (y - last.top) / (TOWER_HEIGHT - last.top)));
}

/** Fog palettes (scene-linear, kept dark under the global bloom): teal, grey, red, purple, beige. */
export const FOG_PALETTES: readonly number[] = [0x2a8a7a, 0x6a7478, 0xa01420, 0x5a4a8a, 0x9a8a78];

/**
 * Camera set-ups on the tower: where the camera stands, what it looks at, how it creeps during the shot, and the
 * lit window (face 0–3 = +x, +z, −x, −z; across the face in metres; height).
 */
export const FOG_SHOTS: readonly { from: readonly [number, number, number]; to: readonly [number, number, number]; creep: readonly [number, number, number]; window: readonly [number, number, number] }[] = [
  { from: [14, 2, 58], to: [-4, 330, 30], creep: [0, 5, -2], window: [1, -8, 118] },
  { from: [80, 160, 70], to: [0, 230, 0], creep: [-4, 3, 0], window: [0, 9, 205] },
  { from: [95, 430, 80], to: [0, 600, 0], creep: [0, 6, 0], window: [1, 4, 520] },
  { from: [70, 140, 18], to: [30, 168, -10], creep: [0, 3, 3], window: [0, -6, 162] },
  { from: [30, 225, 95], to: [0, 300, 30], creep: [3, 2, 0], window: [1, 12, 284] },
  { from: [330, 8, 420], to: [0, 320, 0], creep: [-6, 2, 0], window: [3, 5, 342] },
  { from: [62, 4, 12], to: [36, 300, -6], creep: [0, 4, 2], window: [0, -12, 96] },
];

/**
 * Fog Towers (wave 6, #16): one futuristic gothic-brutalist tower rising into heavy fog, seen from the ground and
 * from its flanks. The camera holds each shot with a slow creep, then cuts to another part of the tower; in each
 * shot only one window (sometimes a small room of two or three) glows warm orange-red. Kicks flash that window,
 * strong hits or every couple of bars cut to the next shot, bass thickens the fog and the glow from above, and a
 * section change swaps the fog's colour.
 */
export function createFogTowersMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  const perspective = camera as THREE.PerspectiveCamera;
  perspective.fov = 55; perspective.far = 3000;
  const random = seededRandom(1616);
  const fogColour = uniform(new THREE.Color()), glowAbove = uniform(0.6), time = uniform(0), rainFall = uniform(0), rainAmount = uniform(0.4);
  const fog = new THREE.FogExp2(0x000000, 0.0042);
  scene.fog = fog;
  // Sky: the fog colour, brightest straight up where the light comes through.
  const sky = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  const up = normalize(positionLocal).y;
  sky.colorNode = fogColour.mul(up.max(0).pow(0.8).mul(glowAbove).mul(1.3).add(0.35));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(2400, 32, 16), sky));
  // Light comes down through the fog in its colour; the street below is nearly black.
  const hemi = new THREE.HemisphereLight(0xffffff, 0x050505, 2.2); scene.add(hemi);
  const top = new THREE.DirectionalLight(0xffffff, 1.6); top.position.set(30, 200, 60); scene.add(top);

  // Concrete: board-marked, stained, with a recessed window grid on the core faces.
  const concrete = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  const along = abs(normalLocal.x).greaterThan(0.5).select(positionWorld.z, positionWorld.x);
  const stain = mx_noise_float(vec3(along.mul(0.08), positionWorld.y.mul(0.01), 0)).mul(0.5).add(0.5);
  const boards = mx_noise_float(vec3(along.mul(0.6), positionWorld.y.mul(4), 3)).mul(0.08).add(1);
  concrete.colorNode = vec3(0.1, 0.104, 0.11).mul(stain.mul(0.5).add(0.6)).mul(boards);
  const core = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0 });
  const cell = vec2(along.div(2.2), positionWorld.y.div(FLOOR)), f = fract(cell);
  const glassPane = f.x.smoothstep(0.08, 0.14).mul(f.x.smoothstep(0.92, 0.86)).mul(f.y.smoothstep(0.22, 0.3)).mul(f.y.smoothstep(0.9, 0.84));
  const reflect = mx_noise_float(vec3(cell.floor().mul(0.37), 1)).mul(0.5).add(0.5);
  core.colorNode = mix(vec3(0.04, 0.042, 0.045).mul(stain.mul(0.4).add(0.7)), fogColour.mul(reflect.mul(0.12).add(0.02)), glassPane);
  core.roughnessNode = mix(float(0.9), float(0.6), glassPane);

  const box = new THREE.BoxGeometry(1, 1, 1);
  const add = (material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) => {
    const mesh = new THREE.Mesh(box, material); mesh.position.set(x, y, z); mesh.scale.set(w, h, d); scene.add(mesh); return mesh;
  };
  // Core sections and the stepped, pointed crown with corner spires.
  let floor = 0;
  for (const section of TOWER_SECTIONS) { add(core, 0, (floor + section.top) / 2, 0, section.half * 2, section.top - floor, section.half * 2); floor = section.top; }
  const last = TOWER_SECTIONS[TOWER_SECTIONS.length - 1];
  for (let k = 0; k < 6; k++) {
    const y0 = last.top + k * 22, half = towerHalf(y0 + 11);
    add(concrete, 0, y0 + 11, 0, half * 2, 22, half * 2);
  }
  const spire = new THREE.ConeGeometry(1, 1, 4); spire.rotateY(Math.PI / 4);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    for (const section of TOWER_SECTIONS.slice(2)) {
      const m = new THREE.Mesh(spire, concrete); m.position.set(sx * section.half, section.top + 24, sz * section.half); m.scale.set(3.5, 48, 3.5); scene.add(m);
    }
  }
  const needle = new THREE.Mesh(spire, concrete); needle.position.set(0, TOWER_HEIGHT + 40, 0); needle.scale.set(4, 120, 4); scene.add(needle);

  // Floor slabs and deep vertical fins, instanced: the facade's horizontal bands and its gothic ribs.
  const scale = Math.max(0.5, Math.min(1, budget.particleScale));
  const slabs: THREE.Matrix4[] = [], fins: THREE.Matrix4[] = [];
  const dummy = new THREE.Object3D();
  const place = (list: THREE.Matrix4[], x: number, y: number, z: number, w: number, h: number, d: number) => { dummy.position.set(x, y, z); dummy.scale.set(w, h, d); dummy.updateMatrix(); list.push(dummy.matrix.clone()); };
  floor = 0;
  TOWER_SECTIONS.forEach((section, s) => {
    const half = section.half;
    // Balcony bands every few floors stick out further; plain floors are thin lips.
    for (let y = floor + FLOOR; y < section.top; y += FLOOR * (scale < 1 ? 2 : 1)) {
      const band = Math.round(y / FLOOR) % 4 === 0, out = band ? 2.6 : 0.7, thick = band ? 1.1 : 0.35;
      place(slabs, 0, y, 0, half * 2 + out * 2, thick, half * 2 + out * 2);
    }
    // Fins: deeper and denser low down, every metre-and-a-half on the middle sections.
    const spacing = s === 0 ? 6 : s % 2 ? 3.2 : 4.4, depth = s === 0 ? 4 : 2.2;
    for (let face = 0; face < 4; face++) for (let a = -half + spacing / 2; a < half; a += spacing / (scale < 1 ? 0.5 : 1)) {
      const height = section.top - floor, y = floor + height / 2, out = half + depth / 2;
      const [x, z] = face === 0 ? [out, a] : face === 1 ? [a, out] : face === 2 ? [-out, a] : [a, -out];
      place(fins, x, y, z, face % 2 ? 0.6 : depth, height, face % 2 ? depth : 0.6);
    }
    // Buttress piers at the corners, stepping out at each section.
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) place(fins, sx * (half + 1.5), (floor + section.top) / 2, sz * (half + 1.5), 7, section.top - floor, 7);
    floor = section.top;
  });
  // The cantilevered blocks: a band of rooms thrusting out over the street on the +z side, and a smaller one on −x.
  add(core, 0, 285, 30, 52, 26, 26); add(concrete, 0, 271, 30, 54, 3, 28);
  add(core, -38, 120, 0, 18, 22, 34);
  for (const [list, geometry] of [[slabs, box], [fins, box]] as const) {
    const mesh = new THREE.InstancedMesh(geometry, concrete, list.length);
    list.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    scene.add(mesh);
  }

  // The one lit room: a few warm panes in a recess and a point light spilling onto the fins.
  const roomMaterial = new THREE.MeshBasicNodeMaterial({ fog: false });
  const roomLevel = uniform(0.4), pane = new THREE.PlaneGeometry(2.9, 3.1);
  const flicker = mx_noise_float(vec3(time.mul(3), 0, 0)).mul(0.08).add(1);
  roomMaterial.colorNode = vec3(...linearRgb(0xff5a1e)).mul(roomLevel.mul(9)).mul(flicker);
  const room = new THREE.Group(); scene.add(room);
  const panes = [0, 1, 2].map((k) => { const m = new THREE.Mesh(pane, roomMaterial); m.position.set((k - 1) * 3.1, 0, 0); room.add(m); return m; });
  const spill = new THREE.PointLight(0xff4a14, 0, 36, 1.8); spill.position.set(0, 0, 3); room.add(spill);

  // Rain: fine streaks close to the camera.
  const drops = Math.round(2500 * budget.particleScale), rain = new Float32Array(drops * 6), tails = new Float32Array(drops * 2);
  for (let i = 0; i < drops; i++) { const x = (random() - 0.5) * 120, y = random() * 120, z = (random() - 0.5) * 120; rain.set([x, y, z, x, y, z], i * 6); tails[i * 2 + 1] = 1; }
  const rainGeometry = new THREE.BufferGeometry();
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(rain, 3)); rainGeometry.setAttribute('tail', new THREE.BufferAttribute(tails, 1));
  const rainMaterial = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const eye = uniform(new THREE.Vector3());
  const dropY = fract(positionLocal.y.sub(rainFall).div(120)).mul(120).sub(60);
  rainMaterial.positionNode = vec3(positionLocal.x.add(eye.x).add(dropY.mul(0.08)), dropY.add(eye.y).add(attribute<'float'>('tail').mul(2.2)), positionLocal.z.add(eye.z));
  rainMaterial.colorNode = fogColour.mul(0.5).add(0.03).mul(fract(positionLocal.x.mul(0.71)).lessThan(rainAmount).select(float(1), float(0)));
  const rainLines = new THREE.LineSegments(rainGeometry, rainMaterial); rainLines.frustumCulled = false; scene.add(rainLines);

  const hits = createHits({ decay: 1.1, interval: 0.25 }), shots = variantSequence(FOG_SHOTS.length, 16), palettes = variantSequence(FOG_PALETTES.length, 3), section = sectionWatch(50);
  const colour = new THREE.Color(), target = new THREE.Vector3(), look = new THREE.Vector3();
  let shot = 0, held = 0, kicks = 0, density = 0.0042, roomGlow = 0.3, rainPhase = 0;
  const setPalette = (index: number) => {
    colour.setRGB(...linearRgb(FOG_PALETTES[index])).multiplyScalar(0.55); fogColour.value.copy(colour); fog.color.copy(colour);
    hemi.color.copy(colour).lerp(new THREE.Color(1, 1, 1), 0.35); top.color.copy(hemi.color);
  };
  const cutTo = (index: number) => {
    shot = index; held = 0; kicks = 0;
    const [face, across, y] = FOG_SHOTS[index].window, half = towerHalf(y) + 0.15, angle = face * Math.PI / 2;
    // A room of two or three panes now and then, otherwise a single window.
    const cluster = random() < 0.35 ? 3 : random() < 0.5 ? 2 : 1;
    panes.forEach((m, k) => { m.visible = k < cluster; });
    room.position.set(Math.cos(angle) * half - Math.sin(angle) * across, y, Math.sin(angle) * half + Math.cos(angle) * across);
    room.rotation.set(0, Math.PI / 2 - angle, 0);
  };
  setPalette(0); cutTo(0);
  return {
    scene, camera,
    update(frame) {
      resizeCamera(perspective, frame.aspect);
      time.value = frame.time;
      const step = settleStep(frame), motion = frame.reducedMotion ? 0 : frame.delta, { bass, loudness, impact } = frame.response;
      hits.update(frame, 0.12);
      if (section(frame)) setPalette(palettes.next());
      held += step;
      if (hits.fired) kicks++;
      // Strong hits or every eight kicks cut to a new part of the tower, never faster than every three seconds;
      // in silence the shot still changes every twelve.
      if (held > 3 && ((hits.fired && impact > 0.85) || kicks >= 8)) cutTo(shots.next());
      else if (held > 12) cutTo(shots.next());
      // The window pops on a kick and fades slowly; loudness raises its resting level.
      roomGlow = approach(roomGlow, 0.25 + loudness * 0.35, step, 0.8);
      roomLevel.value = roomGlow + hits.flash * 0.9;
      spill.intensity = roomLevel.value * 380;
      density = approach(density, 0.0032 + bass * 0.0035, step, 0.5); fog.density = density;
      glowAbove.value = approach(glowAbove.value, 0.5 + bass * 0.6, step, 0.4);
      rainAmount.value = approach(rainAmount.value, 0.25 + frame.audio.highs * 0.6, step, 0.3);
      rainPhase += motion * 70; rainFall.value = rainPhase;
      // Hold the shot with a slow creep.
      const s = FOG_SHOTS[shot], creep = frame.reducedMotion ? 0 : held;
      target.set(s.from[0] + s.creep[0] * creep, s.from[1] + s.creep[1] * creep, s.from[2] + s.creep[2] * creep);
      look.set(...s.to);
      perspective.position.copy(target); perspective.lookAt(look);
      eye.value.copy(target);
    },
    dispose() { disposeScene(scene); scene.fog = null; },
  };
}
