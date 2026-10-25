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
