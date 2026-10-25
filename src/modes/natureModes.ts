import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { abs, exp, float, fract, max, mix, mx_fractal_noise_float, mx_noise_float, screenCoordinate, sin, texture as sampleTexture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import type { QualityBudget } from '../rendering/quality';
import { disposeScene, approach, settleStep } from './shared';
import { fullscreen, hash2 } from './shaderModes';
import { createHits } from './hitPulse';
import { seededRandom } from '../rendering/diagnostics';

type F = Node<'float'>;
type V2 = Node<'vec2'>;

// ---------------------------------------------------------------- Windfield

export function createWindfieldMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const aspect = uniform(1), time = uniform(0), gust = uniform(0), gustFront = uniform(-10), lean = uniform(0.3), shimmer = uniform(0), growth = uniform(0.7), dolly = uniform(0), cloudTime = uniform(0);
  const p = uv().sub(0.5).mul(vec2(aspect, 1));
  const horizon = float(-0.08).add(dolly.mul(0.02));
  // Sky and cumulus: a flat base on the horizon, cauliflower tops that rise as the clouds grow.
  const above = p.y.sub(horizon);
  const cx = p.x.mul(1.1).add(cloudTime.mul(0.01));
  const tops = mx_fractal_noise_float(vec3(cx.mul(1.6), 0, cloudTime.mul(0.02)), 3, 2, 0.5).mul(0.5).add(0.5).mul(0.55).add(0.2).mul(growth);
  const billow = mx_fractal_noise_float(vec3(cx.mul(5), above.mul(5), cloudTime.mul(0.05)), 5, 2, 0.55);
  const puff = tops.sub(above).add(billow.mul(0.16));
  const cloud = puff.smoothstep(0, 0.035).mul(above.smoothstep(-0.005, 0.02));
  // Self-shadowing: compare the billow with a sample toward the sun (up and left); denser toward the light means shade.
  const towardSun = mx_fractal_noise_float(vec3(cx.mul(5).sub(0.12), above.mul(5).add(0.1), cloudTime.mul(0.05)), 5, 2, 0.55);
  const shade = billow.sub(towardSun).mul(-3).add(0.6).clamp(0, 1).mul(0.7).add(mx_fractal_noise_float(vec3(cx.mul(14), above.mul(14), cloudTime.mul(0.05)), 3, 2, 0.5).mul(0.15));
  const cloudColour = mix(vec3(0.58, 0.63, 0.69), vec3(0.9, 0.92, 0.94), above.div(tops.max(0.05)).smoothstep(0.05, 0.6).mul(0.6).add(shade.mul(0.5)).clamp(0, 1));
  const sky = mix(vec3(0.16, 0.42, 0.68), vec3(0.027, 0.24, 0.53), above.mul(2.2).clamp(0, 1));
  const skyColour = mix(sky, cloudColour, cloud);
  // Meadow: perspective ground with broad gust waves rolling across it and fine blades that lean with the wind.
  const below = horizon.sub(p.y).max(0.002), depth = float(0.14).div(below);
  const plane = vec2(p.x.mul(depth), depth);
  const wind = time.mul(0.6);
  const swell = mx_fractal_noise_float(vec3(plane.x.mul(0.25).sub(wind.mul(0.4)), plane.y.mul(0.35).add(wind.mul(0.25)), time.mul(0.05)), 3, 2, 0.5);
  const front = exp(plane.x.mul(0.3).add(plane.y.mul(0.1)).sub(gustFront).abs().mul(-1.4)).mul(gust);
  const bright = swell.mul(0.9).add(0.5).add(front.mul(0.6)).clamp(0, 1.4);
  // Blades: streaks stretched along the lean, finer toward the horizon.
  const scale = float(0.3).div(below.add(0.12));
  const bx = p.x.add(p.y.mul(lean.add(swell.mul(0.25)).add(front.mul(0.4)))).mul(scale.sqrt()).mul(120);
  const by = p.y.mul(scale).mul(14);
  const blades = mx_fractal_noise_float(vec3(bx, by, 3), 2, 2, 0.5).mul(0.5).add(0.5);
  const tips = hash2(vec2(bx.floor(), by.mul(2).floor())).greaterThan(0.95).select(float(1), float(0)).mul(shimmer);
  const grass = mix(vec3(0.03, 0.16, 0.015), vec3(0.2, 0.56, 0.07), bright.mul(blades.mul(0.9).add(0.25)).clamp(0, 1.2)).add(vec3(0.3, 0.45, 0.2).mul(tips.mul(0.4)));
  const haze = below.smoothstep(0, 0.08);
  const ground = mix(mix(vec3(0.2, 0.35, 0.3), grass, haze), grass, 1);
  material.fragmentNode = vec4(p.y.greaterThan(horizon).select(skyColour, ground), 1);

  const hits = createHits({ decay: 0.8, interval: 2 });
  let frontAt = -10, clock = 0;
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      const step = settleStep(frame), still = frame.reducedMotion;
      hits.update(frame, 1);
      // A hit sends a gust front rolling across the field.
      if (hits.fired && !still) frontAt = -8;
      frontAt += step * 6; gustFront.value = frontAt;
      gust.value = approach(gust.value, frontAt < 20 ? 0.6 + frame.response.bass : frame.response.bass * 0.5, step, 0.4);
      lean.value = approach(lean.value, still ? 0.2 : 0.2 + frame.response.loudness * 0.6, step, 0.5);
      shimmer.value = frame.audio.highs;
      dolly.value = approach(dolly.value, still ? 0 : frame.response.bass, step, 0.6);
      // Time-lapse clouds: they billow and grow, then a new bank rolls in.
      clock += still ? 0 : frame.delta;
      cloudTime.value = clock * 6;
      growth.value = 0.6 + 0.4 * Math.abs(Math.sin(clock * 0.02));
    },
    dispose: () => disposeScene(scene),
  };
}

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

export function createBlackMazeMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const open = generateMaze(9), data = new Float32Array(LATTICE * LATTICE);
  open.forEach((value, i) => { data[i] = value; });
  const lattice = new THREE.DataTexture(data, LATTICE, LATTICE, THREE.RedFormat, THREE.FloatType);
  lattice.minFilter = lattice.magFilter = THREE.NearestFilter; lattice.needsUpdate = true;
  const aspect = uniform(1), window = uniform(new THREE.Vector4(2, 2, 1.3, 1)), light = uniform(0), reveal = uniform(0), ambient = uniform(0.02), shadow = uniform(0.18);
  const p = uv().sub(0.5).mul(vec2(aspect, 1));
  // The maze fills the frame height; walls are wide plateaus and the paths narrow grooves.
  const t = p.div(0.96).add(0.5).mul(MAZE + 0.62);
  const WALL = 0.62;
  const latticeIndex = (v: F) => { const k = v.floor(), f = fract(v); return f.lessThan(WALL).select(k.mul(2), k.mul(2).add(1)); };
  const isOpen = (q: V2) => {
    const index = vec2(latticeIndex(q.x), latticeIndex(q.y));
    const inside = q.x.greaterThanEqual(0).and(q.y.greaterThanEqual(0)).and(q.x.lessThan(MAZE + WALL)).and(q.y.lessThan(MAZE + WALL));
    return inside.select(sampleTexture(lattice, index.add(0.5).div(LATTICE)).r, float(0));
  };
  const groove = isOpen(t);
  // Shadow: a groove pixel is dark when the wall toward the light overhangs it.
  const shaded = isOpen(t.add(vec2(-1, 1).mul(shadow))).oneMinus().mul(groove);
  // Bevel: wall pixels next to a groove catch a highlight on one side and darken on the other.
  const nearLit = isOpen(t.add(vec2(0.05, -0.05))).mul(groove.oneMinus());
  const nearDark = isOpen(t.add(vec2(-0.05, 0.05))).mul(groove.oneMinus());
  const grime = mx_fractal_noise_float(vec3(t.mul(vec2(1.5, 6)), 1), 4, 2, 0.6).mul(0.5).add(0.5);
  const speck = mx_noise_float(vec3(t.mul(14), 2)).mul(0.5).add(0.5);
  const concrete = vec3(0.15, 0.15, 0.16).mul(grime.mul(0.6).add(0.55)).mul(speck.mul(0.25).add(0.85));
  const albedo = groove.greaterThan(0.5).select(concrete.mul(0.55).mul(shaded.mul(-0.85).add(1)), concrete.mul(nearLit.mul(0.6).add(1)).mul(nearDark.mul(-0.5).add(1)));
  // The window: a hard-edged rectangle of light that snaps between spots, plus the brief full reveals.
  const d = t.sub(window.xy).abs().sub(window.zw);
  const inWindow = max(d.x, d.y).smoothstep(0.08, -0.08);
  const lamp = inWindow.mul(light).add(reveal).add(ambient);
  material.fragmentNode = vec4(albedo.mul(lamp).mul(2.4).add(vec3(0.004, 0.003, 0.005)), 1);

  const hits = createHits({ decay: 0.18, interval: 0.4, variants: MAZE_WINDOWS.length, seed: 7 });
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect;
      hits.update(frame, 0.02);
      if (hits.fired) { const [x, y, w, h] = MAZE_WINDOWS[hits.variant]; window.value.set(x, y, w, h); }
      // Every fourth hit lights the whole maze for a moment.
      const full = hits.count % 4 === 0 && hits.age < 0.12;
      reveal.value = full ? 0.6 * (frame.reducedFlash ? 0.4 : 1) : 0;
      // The window holds after the flash; it only dims toward the dark floor.
      light.value = 0.2 + hits.flash * 0.8;
      ambient.value = hits.floor * 0.25 + frame.response.loudness * 0.03;
      shadow.value = 0.12 + frame.response.bass * 0.18;
    },
    dispose() { disposeScene(scene); lattice.dispose(); },
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
  const time = uniform(0), aspect = uniform(1), sway = uniform(0), brightness = uniform(1), twinkle = uniform(1), sparkle = uniform(0);
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
    stars = stars.add(h.lessThan(chance).select(float(1), float(0)).mul(d.smoothstep(size, 0)).mul(flicker).mul(seed === 3 ? 1.6 : 1));
  }
  // A handful of bright stars carry a diffraction cross.
  const big = p.mul(9), bigCell = big.floor(), bh = hash2(bigCell.add(41)), local = fract(big).sub(0.5);
  const cross = bh.lessThan(0.05).select(float(1), float(0)).mul(exp(local.x.abs().mul(-70)).mul(exp(local.y.abs().mul(-9))).add(exp(local.y.abs().mul(-70)).mul(exp(local.x.abs().mul(-9)))).add(exp(local.length().mul(-60)).mul(2)));
  const crossTwinkle = sin(time.mul(bh.mul(3).add(1)).add(bh.mul(30))).mul(0.35).add(0.65).add(sparkle.mul(0.5));
  const starLight = vec3(1, 0.97, 0.94).mul(stars).add(vec3(0.75, 0.83, 1).mul(cross.mul(crossTwinkle).mul(0.5)));
  const glow = exp(p.sub(vec2(0, 0.3)).length().mul(-1.8)).mul(0.08);
  const sky = vec3(0.0006, 0.0009, 0.003).add(vec3(0.004, 0.008, 0.03).mul(glow.mul(14)));
  // Silhouettes: tapering trunks converging upward, needle clusters swaying around their crowns and the frame edge.
  let solid: F = float(0);
  for (const trunk of canopyTrunks(trunkCount)) {
    const a = vec2(trunk.base * 0.5, -0.62), b = vec2(trunk.top * 0.5, -0.5 + trunk.height);
    const ba = b.sub(a), pa = p.sub(a), h = pa.dot(ba).div(ba.dot(ba)).clamp(0, 1);
    const width = float(trunk.width).mul(h.mul(-0.7).add(1));
    solid = max(solid, pa.sub(ba.mul(h)).length().smoothstep(width, width.mul(0.7)));
  }
  const swayed = p.add(vec2(sway.mul(p.y.add(0.5)).mul(0.02), 0));
  const needles = mx_fractal_noise_float(vec3(swayed.mul(6), time.mul(0.02)), 4, 2.2, 0.6).add(mx_noise_float(vec3(swayed.mul(55), 1)).mul(0.25));
  const edge = abs(p.x).div(aspect.mul(0.5)).max(p.y.add(0.5).oneMinus().mul(0.4)).pow(2).add(p.y.sub(0.5).abs().oneMinus().smoothstep(0.7, 1).mul(0.6));
  const foliage = needles.add(edge.mul(0.7)).sub(0.55).smoothstep(0, 0.04);
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
      brightness.value = approach(brightness.value, 0.75 + frame.response.loudness * 0.6, step, 0.3);
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

