import * as THREE from 'three/webgpu';
import { exp, float, fract, positionView, uniform, uv, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { createHits } from './hitPulse';
import { drive, isSnare } from './waveSixShared';
import { PointSet, createPointCloud } from './pointCloud';
import { seededRandom } from '../rendering/diagnostics';
import { presetBudget, type QualityBudget } from '../rendering/quality';

/** The forest repeats every TILE metres along the path, so the walk never ends. */
export const LIDAR = { tile: 48, points: 600_000 };
/** Where the path runs across at depth z (a gentle S that repeats with the tile). */
export const pathX = (z: number) => Math.sin((z / LIDAR.tile) * Math.PI * 2) * 1.2;

/** The scanned forest: path and grassy verges, trunks lining the path, crowns closing overhead, bushes. */
export function lidarForest(count: number, random: () => number) {
  const set = new PointSet(count), tile = LIDAR.tile;
  // Ground: a flat, smooth path and rougher verges rising slightly away from it.
  for (let i = 0; i < count * 0.32; i++) {
    const z = -random() * tile, side = (random() * 2 - 1) * 9, x = pathX(z) + side, off = Math.abs(side);
    const y = off < 1.4 ? (random() - 0.5) * 0.03 : Math.min(0.6, (off - 1.4) * 0.06) + random() * random() * 0.35;
    set.add(x, y, z, 0, 1, 0);
  }
  // Trees along both sides, closer and denser near the path; crowns arch over it.
  const trees = Math.round(tile * 1.3);
  for (let t = 0; t < trees; t++) {
    const z = -random() * tile, side = random() < 0.5 ? -1 : 1, x = pathX(z) + side * (2.2 + Math.pow(random(), 1.6) * 7);
    const radius = 0.15 + random() * 0.3, height = 5 + random() * 5;
    set.cylinder(Math.round(count * 0.14 / trees), x, z, radius, 0, height, random);
    // Crowns lean in over the path, low enough to close the tunnel just above head height.
    set.blob(Math.round(count * 0.3 / trees), x - side * 1.8, height - 0.5, z, 3 + random() * 2, 2.2 + random(), 3 + random() * 2, random);
  }
  // Bushes and ferns at the path's edge.
  const bushes = Math.round(tile * 3);
  for (let b = 0; b < bushes; b++) {
    const z = -random() * tile, side = random() < 0.5 ? -1 : 1, x = pathX(z) + side * (1.6 + random() * 6);
    set.blob(Math.round(count * 0.23 / bushes), x, 0.6 + random() * 0.6, z, 0.8 + random() * 1.2, 0.6 + random() * 0.9, 0.8 + random() * 1.2, random);
  }
  while (!set.full) { const z = -random() * tile; set.add(pathX(z) + (random() - 0.5) * 3, random() * 0.05, z, 0, 1, 0); }
  return set;
}

/**
 * LIDAR Trail (wave 6, #10): a slow night walk down a forest path seen as a dense monochrome LIDAR scan, bright
 * near the camera and fading to black in the tunnel of trees ahead. Kicks blow the points outward along their
 * normals and they snap back, snares send a scanner sweep down the path, bass swells the points and the exposure,
 * hats shake them, and loudness sets the walking pace.
 */
export function createLidarTrailMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  const perspective = camera as THREE.PerspectiveCamera;
  perspective.fov = 62; perspective.near = 0.05; perspective.far = 120;
  scene.background = new THREE.Color(0x000000);
  const random = seededRandom(1010);
  const walked = uniform(0), exposure = uniform(1), sweepAt = uniform(-1), sweepLevel = uniform(0);
  const set = lidarForest(Math.round(LIDAR.points * budget.particleScale), random);
  // The walk: points wrap round the tile so the forest streams past forever; the camera stays at z = 0.
  const cloud = createPointCloud(set, {
    // fract rather than mod: WGSL's float remainder keeps the sign of negative depths.
    place: (p) => vec3(p.x, p.y, fract(p.z.add(walked).div(LIDAR.tile)).mul(LIDAR.tile).sub(LIDAR.tile - 4)),
  });
  const depth = positionView.z.negate();
  // Bright near the camera, falling to black down the tunnel; the scanner plane flares as it passes.
  const near = exp(depth.div(8).negate()).mul(1.6).add(exp(depth.div(20).negate()).mul(0.2)).mul(depth.smoothstep(42, 26));
  // Near points grow so the scan stays dense close up (they would otherwise thin to sparse specks).
  cloud.material.sizeNode = cloud.uniforms.size.mul(float(5).div(depth.max(0.5)).clamp(1, 3.5));
  const sweep = cloud.nodes.placed.z.negate().sub(sweepAt).abs().smoothstep(1.2, 0).mul(sweepLevel);
  const grain = cloud.nodes.seed.mul(0.5).add(0.5);
  const tone = near.mul(grain).mul(exposure).add(sweep.mul(1.5)) as Node<'float'>;
  // Round, soft-edged dots rather than squares.
  const disc = uv().sub(0.5).length().smoothstep(0.5, 0.2);
  cloud.material.colorNode = vec3(0.92, 0.95, 1).mul(tone.mul(0.16)).mul(cloud.nodes.shown).mul(disc);
  cloud.material.opacityNode = float(1);
  scene.add(cloud.sprite);

  const hits = createHits({ decay: 0.18, interval: 0.2 });
  let travel = 0, burst = 0, sweepAge = -1, pace = 0, bob = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(perspective, frame.aspect);
      cloud.uniforms.time.value = frame.time;
      const step = settleStep(frame), motion = frame.reducedMotion ? 0 : frame.delta, { bass, loudness } = frame.response;
      hits.update(frame, 0.1);
      if (hits.fired) {
        if (isSnare(frame) || sweepAge < 0 && hits.count % 4 === 0) sweepAge = 0;
        else burst = Math.max(burst, 0.5 + frame.response.impact * 0.5);
      }
      // Kicks: the scan blows outward and snaps back in about a third of a second; the slider scales how far.
      burst = Math.max(0, burst - step * 3);
      cloud.uniforms.scatter.value = burst * burst * (0.6 + drive(frame) * 0.5) * (frame.reducedFlash ? 0.6 : 1);
      if (sweepAge >= 0) { sweepAge += step; if (sweepAge > 1.6) sweepAge = -1; }
      sweepAt.value = sweepAge < 0 ? -10 : sweepAge * 26; sweepLevel.value = sweepAge < 0 ? 0 : (1 - sweepAge / 1.6) * (frame.reducedFlash ? 0.4 : 1);
      exposure.value = approach(exposure.value, 0.8 + bass * 0.8 + hits.flash * 0.3, step, 0.08);
      cloud.uniforms.size.value = approach(cloud.uniforms.size.value, 1.3 + bass * 1.4, step, 0.1);
      cloud.uniforms.jitter.value = approach(cloud.uniforms.jitter.value, Math.max(0, frame.audio.highs - 0.3) * 0.08, step, 0.04);
      // Walking pace follows loudness; never fully still.
      pace = approach(pace, 0.6 + loudness * 1.6, step, 1);
      travel += motion * pace; walked.value = travel;
      bob += motion * pace * 2.2;
      // Stay on the path: world z = 0 shows the tile at −4 − travel, and the view looks 8 m further on.
      perspective.position.set(pathX(-4 - travel), 1.6 + Math.sin(bob) * 0.03, 0);
      perspective.lookAt(pathX(-12 - travel) + Math.sin(frame.time * 0.13) * 0.4, 1.3, -8);
    },
    dispose: () => disposeScene(scene),
  };
}
