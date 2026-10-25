import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { abs, exp, float, fract, max, mx_fractal_noise_float, mx_noise_float, positionWorld, sin, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import type { QualityBudget } from '../rendering/quality';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { hash2 } from './shaderModes';
import { createHits, variantSequence } from './hitPulse';
import { shadowSwitch } from './kitModes';
import { seededRandom } from '../rendering/diagnostics';

type F = Node<'float'>;
type V2 = Node<'vec2'>;

// ---------------------------------------------------------------- Black Maze

const MAZE = 9, LATTICE = MAZE * 2 + 1;

/** A perfect maze on a 9×9 grid as a 19×19 lattice: 1 where the floor is open (cells and carved passages). */
export function generateMaze(seed: number) {
  const random = seededRandom(seed), open = new Uint8Array(LATTICE * LATTICE);
  const visited = new Uint8Array(MAZE * MAZE), stack = [0];
  visited[0] = 1; open[LATTICE + 1] = 1;
  while (stack.length) {
    const cell = stack[stack.length - 1], x = cell % MAZE, y = Math.floor(cell / MAZE);
    const options = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).filter(([dx, dy]) => {
      const nx = x + dx, ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < MAZE && ny < MAZE && !visited[ny * MAZE + nx];
    });
    if (!options.length) { stack.pop(); continue; }
    const [dx, dy] = options[Math.floor(random() * options.length)], nx = x + dx, ny = y + dy;
    visited[ny * MAZE + nx] = 1;
    open[(y * 2 + 1 + dy) * LATTICE + x * 2 + 1 + dx] = 1;
    open[(ny * 2 + 1) * LATTICE + nx * 2 + 1] = 1;
    stack.push(ny * MAZE + nx);
  }
  return open;
}

/** Spotlight windows: centre and half size in maze units (0–9), never the same spot twice in a row. */
export const MAZE_WINDOWS = [[2, 2, 1.3, 1], [7, 7, 1.5, 1.2], [7, 2, 1.2, 1.4], [2.5, 6.5, 1.6, 1.1], [4.5, 4.5, 1.1, 1.1], [4.5, 1.5, 2.6, 0.9], [1.5, 4.5, 0.9, 2.4]] as const;

/** Lattice line i in maze units: even lines are the wide wall bands (0.62), odd lines the narrow paths. */
const WALL = 0.62;
const latticeStart = (i: number) => Math.floor(i / 2) + (i % 2 ? WALL : 0);
const latticeWidth = (i: number) => (i % 2 ? 1 - WALL : WALL);
/** Camera shots the maze cuts between: straight down, a zoom on the lit window, a low three-quarter view, an orbit, and inside a corridor. */
export const MAZE_SHOTS = ['top', 'zoom', 'low', 'orbit', 'corridor'] as const;

/** Open corridor runs (start cell, direction, length in lattice cells) long enough to fly a camera down. */
export function mazeCorridors(open: Uint8Array, minimum = 5) {
  const runs: { x: number; y: number; dx: number; dy: number; length: number }[] = [];
  for (let y = 1; y < LATTICE - 1; y++) for (let x = 1; x < LATTICE - 1; x++) {
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
      if (!open[y * LATTICE + x] || open[(y - dy) * LATTICE + x - dx]) continue;
      let length = 0;
      while (open[(y + dy * (length + 1)) * LATTICE + x + dx * (length + 1)]) length++;
      if (length >= minimum) runs.push({ x, y, dx, dy, length });
    }
  }
  return runs;
}

export function createBlackMazeMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  const lens = camera as THREE.PerspectiveCamera;
  const open = generateMaze(9), size = MAZE + WALL, centre = size / 2;
  scene.background = new THREE.Color(0x020203);
  scene.fog = new THREE.FogExp2(0x020203, 0.04);
  // Raw concrete: streaky grime and fine speckle, rough and matte.
  const concrete = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  const grime = mx_fractal_noise_float(positionWorld.mul(vec3(1.5, 6, 1.5)), 4, 2, 0.6).mul(0.5).add(0.5);
  const speck = mx_noise_float(positionWorld.mul(14)).mul(0.5).add(0.5);
  concrete.colorNode = vec3(0.15, 0.15, 0.16).mul(grime.mul(0.6).add(0.55)).mul(speck.mul(0.25).add(0.85));
  const walls: [number, number][] = [];
  for (let y = 0; y < LATTICE; y++) for (let x = 0; x < LATTICE; x++) if (!open[y * LATTICE + x]) walls.push([x, y]);
  const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), concrete, walls.length);
  const matrix = new THREE.Matrix4(), at = new THREE.Vector3(), scale = new THREE.Vector3(), turn = new THREE.Quaternion();
  walls.forEach(([x, y], i) => {
    const w = latticeWidth(x), d = latticeWidth(y);
    blocks.setMatrixAt(i, matrix.compose(at.set(latticeStart(x) + w / 2, 0.35, latticeStart(y) + d / 2), turn, scale.set(w, 0.7, d)));
  });
  blocks.castShadow = blocks.receiveShadow = true;
  const floorMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.95 });
  floorMaterial.colorNode = concrete.colorNode.mul(0.55);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), floorMaterial);
  floor.rotation.x = -Math.PI / 2; floor.position.set(centre, 0, centre); floor.receiveShadow = true;
  // The window: a hard-edged pool of light from straight above, snapping between spots; a wide wash for the reveals.
  const spot = new THREE.SpotLight(0xfff2e6, 0, 40, 0.12, 0.08, 1);
  spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0005;
  const wash = new THREE.DirectionalLight(0xe8e4ee, 0); wash.position.set(centre - 4, 12, centre + 5); wash.target.position.set(centre, 0, centre);
  const ambient = new THREE.HemisphereLight(0x8890a0, 0x050505, 0.02);
  scene.add(blocks, floor, spot, spot.target, wash, wash.target, ambient);

  const corridors = mazeCorridors(open);
  const hits = createHits({ decay: 0.18, interval: 0.4, variants: MAZE_WINDOWS.length, seed: 7 });
  const shots = variantSequence(MAZE_SHOTS.length, 13), random = seededRandom(31), shadows = shadowSwitch();
  const look = new THREE.Vector3(), from = new THREE.Vector3(), lit = new THREE.Vector3(2, 0, 2);
  let shot = 0, shotAge = 0, run = corridors[0], windowSize = 1.3;
  /** Aim the window at a spot, in maze units, sized to cover a w × h patch. */
  const aimWindow = (x: number, y: number, w: number, h: number) => { lit.set(x, 0, y); windowSize = Math.max(w, h); };
  return {
    scene, camera,
    simulate: shadows.simulate,
    update(frame) {
      resizeCamera(lens, frame.aspect);
      const step = settleStep(frame), still = frame.reducedMotion;
      hits.update(frame, 0.02);
      shotAge += step;
      if (hits.fired) {
        const [x, y, w, h] = MAZE_WINDOWS[hits.variant]; aimWindow(x, y, w, h);
        // Cut to a new angle on a hit once a shot has held for 3 s.
        if (shotAge > 3 && !still) {
          shot = shots.next(); shotAge = 0;
          if (MAZE_SHOTS[shot] === 'corridor' && corridors.length) {
            run = corridors[Math.floor(random() * corridors.length)];
            const mid = run.length / 2;
            aimWindow(latticeStart(run.x + run.dx * mid) + 0.2, latticeStart(run.y + run.dy * mid) + 0.2, 1.4, 1.4);
          }
        }
      }
      spot.position.set(lit.x, 14, lit.z); spot.target.position.copy(lit);
      spot.angle = Math.atan(windowSize / 14) * 1.5;
      spot.intensity = (0.25 + hits.flash * 0.75) * 260;
      // Every fourth hit lights the whole maze for a moment.
      const full = hits.count % 4 === 0 && hits.age < 0.12;
      wash.intensity = full ? 2.2 * (frame.reducedFlash ? 0.4 : 1) : 0;
      ambient.intensity = 0.06 + hits.floor * 0.3 + frame.response.loudness * 0.2;
      const t = shotAge, bass = frame.response.bass;
      switch (MAZE_SHOTS[shot]) {
        case 'top': from.set(centre, 13 - bass * 0.8, centre + 0.01); look.set(centre, 0, centre); lens.fov = 45; break;
        case 'zoom': from.set(lit.x + 0.3, 4.2 - Math.min(t * 0.25, 1.2) - bass * 0.4, lit.z + 1.2); look.copy(lit); lens.fov = 50; break;
        case 'low': from.set(centre - 7 + t * 0.15, 3.2, centre + 8); look.set(centre, 0, centre - 0.5); lens.fov = 50; break;
        case 'orbit': from.set(centre + Math.sin(t * 0.12) * 9, 6.5, centre + Math.cos(t * 0.12) * 9); look.set(centre, 0, centre); lens.fov = 50; break;
        case 'corridor': {
          // Eye height inside the walls, dollying slowly down the corridor.
          const travel = Math.min(run.length - 1, t * (0.5 + bass * 0.6));
          const cx = latticeStart(run.x + run.dx * travel) + latticeWidth(run.x) / 2, cy = latticeStart(run.y + run.dy * travel) + latticeWidth(run.y) / 2;
          from.set(cx, 0.28, cy); look.set(cx + run.dx * 4, 0.22, cy + run.dy * 4); lens.fov = 70; break;
        }
      }
      // A small handheld drift on every shot.
      const drift = still ? 0 : 0.03;
      lens.position.set(from.x + Math.sin(frame.time * 0.7) * drift, from.y + Math.sin(frame.time * 0.9) * drift, from.z);
      lens.lookAt(look);
      lens.updateProjectionMatrix();
    },
    dispose() { shadows.dispose(); disposeScene(scene); },
  };
}

// ---------------------------------------------------------------- Starfall Canopy

const STREAKS = 64;

/** Silhouette trunks: base x at the frame bottom and lean, looking up through the pines. */
export function canopyTrunks(count: number, seed = 5) {
  const random = seededRandom(seed);
  return Array.from({ length: count }, (_, i) => {
    const side = i / Math.max(1, count - 1) - 0.5;
    return { base: side * 2.4 + (random() - 0.5) * 0.2, top: side * 0.5 + (random() - 0.5) * 0.25, height: 0.55 + random() * 0.35, width: 0.012 + random() * 0.018 };
  });
}

export function createStarfallCanopyMode(budget: QualityBudget): VisualMode {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -1, 1);
  const time = uniform(0), aspect = uniform(1), sway = uniform(0), brightness = uniform(0), twinkle = uniform(1), sparkle = uniform(0), density = uniform(0);
  const trunkCount = budget.particleScale >= 2 ? 14 : budget.particleScale >= 1 ? 10 : 6;
  const background = new THREE.MeshBasicNodeMaterial({ depthWrite: false, depthTest: false });
  const p = uv().sub(0.5).mul(vec2(aspect, 1));
  // Stars: three size tiers on hashed grids, each with its own twinkle rate and phase.
  let stars: F = float(0);
  for (const [cells, chance, size, seed] of [[180, 0.06, 0.18, 1], [90, 0.035, 0.22, 2], [45, 0.03, 0.28, 3]] as const) {
    const g = p.mul(cells), cell = g.floor(), h = hash2(cell.add(seed * 17));
    const jitter = vec2(hash2(cell.add(seed * 5)), hash2(cell.add(seed * 9))).sub(0.5).mul(0.6);
    const d = fract(g).sub(0.5).sub(jitter).length();
    const rate = h.mul(2.5).add(0.5), flicker = sin(time.mul(rate).mul(twinkle).add(h.mul(60))).mul(0.4).add(0.6);
    // More of the sky fills in as the music gets louder; in silence there are no stars at all.
    stars = stars.add(h.lessThan(density.mul(chance)).select(float(1), float(0)).mul(d.smoothstep(size, 0)).mul(flicker).mul(seed === 3 ? 1.6 : 1));
  }
  // A handful of bright stars carry a diffraction cross.
  const big = p.mul(9), bigCell = big.floor(), bh = hash2(bigCell.add(41)), local = fract(big).sub(0.5);
  const cross = bh.lessThan(0.05).select(float(1), float(0)).mul(exp(local.x.abs().mul(-70)).mul(exp(local.y.abs().mul(-9))).add(exp(local.y.abs().mul(-70)).mul(exp(local.x.abs().mul(-9)))).add(exp(local.length().mul(-60)).mul(2)));
  const crossTwinkle = sin(time.mul(bh.mul(3).add(1)).add(bh.mul(30))).mul(0.35).add(0.65).add(sparkle.mul(0.5));
  const starLight = vec3(1, 0.97, 0.94).mul(stars).add(vec3(0.75, 0.83, 1).mul(cross.mul(crossTwinkle).mul(0.5)));
  const glow = exp(p.sub(vec2(0, 0.3)).length().mul(-1.8)).mul(0.08).mul(brightness.mul(0.8).add(0.2));
  const sky = vec3(0.0006, 0.0009, 0.003).add(vec3(0.004, 0.008, 0.03).mul(glow.mul(14)));
  // Silhouettes: tapering trunks converging upward, each carrying its own crown of needle clusters.
  let solid: F = float(0), crown: F = float(0);
  const swayed = p.add(vec2(sway.mul(p.y.add(0.5)).mul(0.02), 0));
  for (const trunk of canopyTrunks(trunkCount)) {
    const a = vec2(trunk.base * 0.5, -0.62), b = vec2(trunk.top * 0.5, -0.5 + trunk.height);
    const ba = b.sub(a), pa = p.sub(a), h = pa.dot(ba).div(ba.dot(ba)).clamp(0, 1);
    const width = float(trunk.width).mul(h.mul(-0.7).add(1));
    solid = max(solid, pa.sub(ba.mul(h)).length().smoothstep(width, width.mul(0.7)));
    // Branch tufts hug the upper part of the trunk (they sway with it), widest a little below the top.
    const sa = swayed.sub(a), hs = sa.dot(ba).div(ba.dot(ba)).clamp(0, 1.08);
    const reach = hs.smoothstep(0.35, 0.75).mul(hs.smoothstep(1.08, 0.85)).mul(0.095);
    crown = max(crown, sa.sub(ba.mul(hs)).length().smoothstep(reach.add(0.005), 0).mul(hs.greaterThan(0.3).select(float(1), float(0))));
  }
  const needles = mx_fractal_noise_float(vec3(swayed.mul(9), time.mul(0.02)), 4, 2.2, 0.6).add(mx_noise_float(vec3(swayed.mul(55), 1)).mul(0.25));
  const foliage = crown.mul(needles.add(0.45)).sub(0.5).smoothstep(0, 0.04);
  const silhouette = max(solid, foliage);
  const rim = foliage.mul(foliage.oneMinus()).mul(4).add(solid.mul(solid.oneMinus()).mul(4)).mul(0.02);
  background.colorNode = sky.add(starLight.mul(brightness)).mul(silhouette.oneMinus()).add(vec3(0.05, 0.09, 0.19).mul(rim)).add(vec3(glow.mul(silhouette.oneMinus()).mul(0.1)));
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), background);
  backdrop.renderOrder = -1;
  // Shooting stars: additive streaks with a tail that fades toward the back.
  const streakMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
  streakMaterial.colorNode = vec3(0.9, 0.95, 1).mul(uv().x.pow(3)).mul(uv().y.sub(0.5).abs().mul(2).oneMinus().pow(2)).mul(1.6);
  const streakGeometry = new THREE.PlaneGeometry(1, 1).translate(-0.5, 0, 0);
  const streaks = new THREE.InstancedMesh(streakGeometry, streakMaterial, STREAKS);
  streaks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(STREAKS * 3), 3);
  streaks.frustumCulled = false; streaks.renderOrder = 1;
  scene.add(backdrop, streaks);
  const meteors = Array.from({ length: STREAKS }, () => ({ x: 0, y: 0, dx: 0, dy: 0, age: 1, life: 0, length: 0 }));
  const random = seededRandom(61), matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), position = new THREE.Vector3(), scale = new THREE.Vector3(), axis = new THREE.Vector3(0, 0, 1), colour = new THREE.Color();
  let next = 0, loudFor = 0, lastStorm = -Infinity;
  const launch = (direction: number, life: number, delay = 0) => {
    const meteor = meteors[next]; next = (next + 1) % STREAKS;
    Object.assign(meteor, { x: (random() - 0.5) * 1.4, y: 0.05 + random() * 0.45, dx: Math.cos(direction), dy: Math.sin(direction), age: -delay, life, length: 0.15 + random() * 0.15 });
  };
  const hits = createHits({ decay: 0.5, interval: 0.7 });
  let swayPhase = 0;
  return {
    scene, camera,
    update(frame) {
      const halfWidth = frame.aspect / 2;
      if (camera.right !== halfWidth) { camera.left = -halfWidth; camera.right = halfWidth; camera.updateProjectionMatrix(); }
      backdrop.scale.set(frame.aspect, 1, 1);
      aspect.value = frame.aspect; time.value = frame.time;
      const step = settleStep(frame);
      hits.update(frame, 0.6);
      swayPhase += frame.reducedMotion ? 0 : frame.delta;
      sway.value = Math.sin(swayPhase * 0.7) * (0.6 + frame.response.bass * 2.4) + Math.sin(swayPhase * 1.9) * 0.3;
      // The sky only lights up with the music: dark in silence, filling with stars as it gets louder.
      brightness.value = approach(brightness.value, frame.response.loudness * 1.1 + frame.response.bass * 0.4 + hits.flash * 0.6, step, 0.15);
      density.value = approach(density.value, Math.min(1.2, frame.response.loudness * 1.3 + hits.flash * 0.3), step, 0.25);
      twinkle.value = 1 + frame.response.loudness * 1.5;
      sparkle.value = frame.audio.highs;
      // A hit sends a single shooting star; a sustained loud passage sets off a star storm (at most one per 8 s).
      if (hits.fired) launch(-0.5 - random() * 0.5 + (random() < 0.5 ? 0 : Math.PI - 1.2), 0.5);
      loudFor = frame.response.loudness > 0.7 ? loudFor + step : 0;
      if (frame.time < lastStorm) lastStorm = -Infinity;
      if (loudFor > 1.5 && frame.time - lastStorm > 8) {
        lastStorm = frame.time; loudFor = 0;
        const direction = -0.6 - random() * 0.3, count = frame.reducedFlash ? 20 : 20 + Math.floor(random() * 40);
        for (let i = 0; i < count; i++) launch(direction + (random() - 0.5) * 0.08, 0.5, random() * 2);
      }
      meteors.forEach((meteor, i) => {
        // Storm streaks wait their turn: a negative age is a delay before they appear.
        if (meteor.age < meteor.life) meteor.age += step;
        const t = meteor.age / Math.max(meteor.life, 1e-3), alive = meteor.age < meteor.life && meteor.age > 0;
        const travel = t * 0.8;
        position.set(meteor.x + meteor.dx * travel, meteor.y + meteor.dy * travel, 0);
        rotation.setFromAxisAngle(axis, Math.atan2(meteor.dy, meteor.dx));
        scale.set(alive ? meteor.length : 0, 0.004, 1);
        streaks.setMatrixAt(i, matrix.compose(position, rotation, scale));
        const fade = alive ? Math.sin(Math.PI * t) : 0;
        streaks.setColorAt(i, colour.setScalar(fade));
      });
      streaks.instanceMatrix.needsUpdate = true;
      if (streaks.instanceColor) streaks.instanceColor.needsUpdate = true;
    },
    dispose: () => disposeScene(scene),
  };
}

