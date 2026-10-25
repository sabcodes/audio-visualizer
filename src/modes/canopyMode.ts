import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { abs, attribute, cos, exp, float, max, mix, mx_fractal_noise_float, sin, uniform, uniformArray, uv, vec2, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import type { QualityBudget } from '../rendering/quality';
import { disposeScene, approach, settleStep } from './shared';
import { createHits } from './hitPulse';
import { seededRandom } from '../rendering/diagnostics';

type F = Node<'float'>;

/** Silhouette trunks: base x at the frame bottom and lean, looking up through the trees. */
export function canopyTrunks(count: number, seed = 5) {
  const random = seededRandom(seed);
  return Array.from({ length: count }, (_, i) => {
    const side = i / Math.max(1, count - 1) - 0.5;
    return { base: side * 2.4 + (random() - 0.5) * 0.2, top: side * 0.5 + (random() - 0.5) * 0.25, height: 0.55 + random() * 0.35, width: 0.012 + random() * 0.018 };
  });
}

/** One branch: where it leaves its trunk, its direction and length, and the leaves hung along it. */
export interface CanopyBranch { trunk: number; t: number; x: number; y: number; angle: number; length: number }
export interface CanopyLeaf { trunk: number; t: number; branch: number; along: number; x: number; y: number; size: number; angle: number; hue: number; phase: number }

/**
 * Branches and leaves for the trunks. Every leaf is hung from a point on a branch (or the trunk top), so it
 * can never float free: its position is that point plus a short stalk.
 */
export function canopyLayout(trunks: ReturnType<typeof canopyTrunks>, leavesPerBranch: number, seed = 9) {
  const random = seededRandom(seed), branches: CanopyBranch[] = [], leaves: CanopyLeaf[] = [];
  trunks.forEach((trunk, k) => {
    const ax = trunk.base * 0.5, ay = -0.62, bx = trunk.top * 0.5, by = -0.5 + trunk.height;
    const lean = Math.atan2(by - ay, bx - ax), count = 4 + Math.floor(random() * 4);
    for (let j = 0; j < count; j++) {
      const t = 0.45 + (j / count) * 0.55 + random() * 0.05, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      const side = j % 2 ? 1 : -1, angle = lean + side * (0.5 + random() * 0.6), length = 0.05 + random() * 0.11;
      const b = branches.push({ trunk: k, t, x, y, angle, length }) - 1;
      for (let l = 0; l < leavesPerBranch; l++) {
        // Leaves crowd toward the branch tip, each on a short stalk off the branch.
        const along = Math.sqrt(random()), px = x + Math.cos(angle) * length * along, py = y + Math.sin(angle) * length * along;
        const spread = 0.012 + along * 0.022, a = random() * Math.PI * 2;
        leaves.push({ trunk: k, t, branch: b, along, x: px + Math.cos(a) * spread * random(), y: py + Math.sin(a) * spread * random(), size: 0.012 + random() * 0.012, angle: random() * Math.PI * 2, hue: random(), phase: random() * 10 });
      }
    }
    // A crown cluster at the trunk top.
    for (let l = 0; l < leavesPerBranch; l++) {
      const a = random() * Math.PI * 2, r = 0.03 * Math.sqrt(random());
      leaves.push({ trunk: k, t: 1, branch: -1, along: 1, x: bx + Math.cos(a) * r, y: by + Math.sin(a) * r, size: 0.012 + random() * 0.012, angle: random() * Math.PI * 2, hue: random(), phase: random() * 10 });
    }
  });
  return { branches, leaves };
}

const BIRDS = 14;

/**
 * Daylight Canopy (the Starfall Canopy mode, turned to day): looking straight up through a ring of trunks into a
 * blue sky. Clouds drift and gust with the music, the trunks sway, the leaves (each hung from a branch) flutter
 * with the bounce, and flocks of birds cross overhead on the beats.
 */
export function createStarfallCanopyMode(budget: QualityBudget): VisualMode {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -1, 1);
  const trunkCount = budget.particleScale >= 2 ? 14 : budget.particleScale >= 1 ? 11 : 8;
  const leavesPerBranch = budget.particleScale >= 2 ? 44 : budget.particleScale >= 1 ? 34 : 22;
  const time = uniform(0), aspect = uniform(1), drift = uniform(0), gust = uniform(0), sun = uniform(0.5), flutter = uniform(0.2), flutterRate = uniform(2);
  const trunks = canopyTrunks(trunkCount), { branches, leaves } = canopyLayout(trunks, leavesPerBranch);
  // Per-trunk sway at the top, in frame units; everything hung from a trunk moves with it (more toward the top).
  const swayValues = trunks.map(() => 0), sway = uniformArray(swayValues, 'float');
  const sunAt = vec2(0.12, 0.28);

  // Sky: deep blue at the edges, pale near the sun, with clouds drifting across.
  const skyMaterial = new THREE.MeshBasicNodeMaterial({ depthWrite: false, depthTest: false });
  const p = uv().sub(0.5).mul(vec2(aspect, 1)), toSun = p.sub(sunAt).length();
  const sky = mix(vec3(0.42, 0.66, 0.95), vec3(0.06, 0.26, 0.7), toSun.mul(1.3).clamp(0, 1).pow(0.8));
  const q = p.mul(1.8).add(vec2(drift, drift.mul(0.35)));
  const cloudField = mx_fractal_noise_float(vec3(q, time.mul(0.03)), 5, 2, 0.55).mul(0.5).add(0.5);
  const cloud = cloudField.smoothstep(float(0.52).sub(gust.mul(0.06)), 0.72);
  const shade = mx_fractal_noise_float(vec3(q.add(sunAt.sub(p).normalize().mul(0.04)), time.mul(0.03)), 5, 2, 0.55).mul(0.5).add(0.5);
  const cloudColour = mix(vec3(0.62, 0.66, 0.74), vec3(1, 0.99, 0.96), shade.sub(cloudField).mul(-6).add(0.7).clamp(0, 1));
  const glow = exp(toSun.mul(-7)).mul(sun.mul(0.6).add(0.5)).add(exp(toSun.mul(-30)).mul(1.5));
  skyMaterial.colorNode = mix(sky, cloudColour, cloud.mul(0.92)).add(vec3(1, 0.95, 0.8).mul(glow));
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), skyMaterial); backdrop.renderOrder = 0;

  /** Sway offset for a point at height `t` (0 base – 1 top) of trunk `k`, plus the branch's own bob. */
  const swayAt = (k: F, t: F) => (sway.element(k) as unknown as F).mul(t.mul(t));

  // Wood: trunks and branches as tapered strips in one geometry. Each vertex knows its trunk, height and how far
  // out along its branch it sits, so the shader sways it.
  const wood: number[] = [], woodTrunk: number[] = [], woodT: number[] = [], woodAlong: number[] = [], woodSide: number[] = [], index: number[] = [];
  const strip = (points: [number, number][], widths: number[], trunk: number, ts: number[], alongs: number[]) => {
    const start = wood.length / 3;
    points.forEach(([x, y], i) => {
      const [nx, ny] = points[Math.min(i + 1, points.length - 1)], [px, py] = points[Math.max(i - 1, 0)];
      const dx = nx - px, dy = ny - py, len = Math.hypot(dx, dy) || 1, ox = -dy / len * widths[i], oy = dx / len * widths[i];
      wood.push(x + ox, y + oy, 0, x - ox, y - oy, 0);
      woodTrunk.push(trunk, trunk); woodT.push(ts[i], ts[i]); woodAlong.push(alongs[i], alongs[i]); woodSide.push(1, -1);
      if (i < points.length - 1) { const v = start + i * 2; index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
    });
  };
  trunks.forEach((trunk, k) => {
    const ax = trunk.base * 0.5, ay = -0.62, bx = trunk.top * 0.5, by = -0.5 + trunk.height, steps = 16;
    const ts = Array.from({ length: steps + 1 }, (_, i) => i / steps);
    strip(ts.map((t) => [ax + (bx - ax) * t, ay + (by - ay) * t]), ts.map((t) => trunk.width * (1 - t * 0.7)), k, ts, ts.map(() => 0));
  });
  for (const branch of branches) {
    const steps = 6, us = Array.from({ length: steps + 1 }, (_, i) => i / steps), width = trunks[branch.trunk].width * (1 - branch.t * 0.7) * 0.45;
    strip(us.map((u) => [branch.x + Math.cos(branch.angle) * branch.length * u, branch.y + Math.sin(branch.angle) * branch.length * u + u * u * 0.01]), us.map((u) => width * (1 - u * 0.75)), branch.trunk, us.map(() => branch.t), us);
  }
  const woodGeometry = new THREE.BufferGeometry();
  woodGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wood, 3));
  woodGeometry.setAttribute('trunk', new THREE.Float32BufferAttribute(woodTrunk, 1));
  woodGeometry.setAttribute('height', new THREE.Float32BufferAttribute(woodT, 1));
  woodGeometry.setAttribute('along', new THREE.Float32BufferAttribute(woodAlong, 1));
  woodGeometry.setAttribute('side', new THREE.Float32BufferAttribute(woodSide, 1));
  woodGeometry.setIndex(index);
  const woodMaterial = new THREE.MeshBasicNodeMaterial({ depthWrite: false, depthTest: false, side: THREE.DoubleSide });
  const trunkIndex = attribute<'float'>('trunk'), height = attribute<'float'>('height'), along = attribute<'float'>('along');
  const bob = sin(time.mul(flutterRate.mul(0.5)).add(trunkIndex.mul(1.7)).add(height.mul(9))).mul(flutter).mul(0.01).mul(along.mul(along));
  woodMaterial.positionNode = attribute<'vec3'>('position').add(vec3(swayAt(trunkIndex, height), bob, 0));
  // Bark seen against the sky: near-black with a warm rim on the side facing the sun.
  const rimSide = attribute<'float'>('side').mul(0.5).add(0.5);
  woodMaterial.colorNode = mix(vec3(0.018, 0.014, 0.01), vec3(0.2, 0.13, 0.06), rimSide.pow(6).mul(0.6));
  const woodMesh = new THREE.Mesh(woodGeometry, woodMaterial); woodMesh.frustumCulled = false; woodMesh.renderOrder = 2;

  // Leaves: one quad per leaf, placed in the shader at its anchor plus the sway, spinning a little as it flutters.
  const leafCorner: number[] = [], leafAnchor: number[] = [], leafData: number[] = [], leafLook: number[] = [], leafIndex: number[] = [];
  leaves.forEach((leaf, i) => {
    for (const [cx, cy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      leafCorner.push(cx, cy, 0); leafAnchor.push(leaf.x, leaf.y); leafData.push(leaf.trunk, leaf.t, leaf.along); leafLook.push(leaf.size, leaf.angle, leaf.hue, leaf.phase);
    }
    const v = i * 4; leafIndex.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
  });
  const leafGeometry = new THREE.BufferGeometry();
  leafGeometry.setAttribute('position', new THREE.Float32BufferAttribute(leafCorner, 3));
  leafGeometry.setAttribute('anchor', new THREE.Float32BufferAttribute(leafAnchor, 2));
  leafGeometry.setAttribute('leaf', new THREE.Float32BufferAttribute(leafData, 3));
  leafGeometry.setAttribute('look', new THREE.Float32BufferAttribute(leafLook, 4));
  leafGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(leaves.flatMap(() => [0, 0, 1, 0, 0, 1, 1, 1]), 2));
  leafGeometry.setIndex(leafIndex);
  const leafMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
  const corner = attribute<'vec3'>('position'), anchor = attribute<'vec2'>('anchor'), leafInfo = attribute<'vec3'>('leaf'), look = attribute<'vec4'>('look');
  const spin = look.y.add(sin(time.mul(flutterRate).add(look.w)).mul(flutter));
  const local = vec2(corner.x.mul(0.55), corner.y).mul(look.x).mul(vec2(1, gust.mul(0.08).add(1)));
  const turned = vec2(local.x.mul(cos(spin)).sub(local.y.mul(sin(spin))), local.x.mul(sin(spin)).add(local.y.mul(cos(spin))));
  const leafBob = sin(time.mul(flutterRate.mul(0.5)).add(leafInfo.x.mul(1.7)).add(leafInfo.y.mul(9))).mul(flutter).mul(0.01).mul(leafInfo.z.mul(leafInfo.z));
  leafMaterial.positionNode = vec3(anchor.add(turned).add(vec2(swayAt(leafInfo.x, leafInfo.y), leafBob)), 0);
  // Leaves are backlit: translucent greens, glowing yellow-green toward the sun, with a darker midrib.
  const lu = uv().sub(0.5).mul(2), shape = lu.x.abs().mul(1.9).add(lu.y.mul(lu.y)).sub(1);
  const worldLeaf = anchor.sub(sunAt).length();
  const leafGreen = mix(vec3(0.05, 0.16, 0.03), vec3(0.2, 0.42, 0.06), look.z);
  const backlit = mix(leafGreen, vec3(0.55, 0.75, 0.15), exp(worldLeaf.mul(-4)).mul(sun.mul(0.4).add(0.6)));
  leafMaterial.colorNode = backlit.mul(lu.x.abs().smoothstep(0, 0.08).mul(0.3).add(0.7)).mul(lu.y.mul(0.25).add(0.85));
  leafMaterial.opacityNode = shape.lessThan(0).select(float(1), float(0));
  leafMaterial.alphaTest = 0.5;
  const leafMesh = new THREE.Mesh(leafGeometry, leafMaterial); leafMesh.frustumCulled = false; leafMesh.renderOrder = 3;

  // Birds: dark silhouettes, two wing arcs that beat; positions are updated from the CPU each frame.
  const birdPosition = new Float32Array(BIRDS * 4 * 3), birdState = new Float32Array(BIRDS * 4 * 3), birdIndex: number[] = [];
  for (let i = 0; i < BIRDS; i++) { const v = i * 4; birdIndex.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
  const birdGeometry = new THREE.BufferGeometry();
  const birdPositionAttribute = new THREE.BufferAttribute(birdPosition, 3), birdStateAttribute = new THREE.BufferAttribute(birdState, 3);
  birdPositionAttribute.setUsage(THREE.DynamicDrawUsage); birdStateAttribute.setUsage(THREE.DynamicDrawUsage);
  birdGeometry.setAttribute('position', birdPositionAttribute); birdGeometry.setAttribute('state', birdStateAttribute);
  birdGeometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(Array.from({ length: BIRDS }, () => [0, 0, 1, 0, 0, 1, 1, 1]).flat()), 2));
  birdGeometry.setIndex(birdIndex);
  const birdMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false });
  const state = attribute<'vec3'>('state'), bu = uv().sub(0.5).mul(2);
  // Wings: a thin arc whose tips rise and fall with the flap (state.x, -1 down – 1 up); a small body in the middle.
  const wingLine = abs(bu.y.sub(abs(bu.x).pow(0.9).mul(state.x.mul(0.55)).add(abs(bu.x).mul(abs(bu.x)).mul(-0.25))));
  const wing = wingLine.lessThan(float(0.09).mul(abs(bu.x).mul(-0.7).add(1))).and(abs(bu.x).lessThan(0.95));
  const body = bu.mul(vec2(1, 1.6)).length().lessThan(0.16);
  birdMaterial.colorNode = vec3(0.03, 0.035, 0.05);
  birdMaterial.opacityNode = max(wing.select(float(1), float(0)), body.select(float(1), float(0))).mul(state.y);
  const birdMesh = new THREE.Mesh(birdGeometry, birdMaterial); birdMesh.frustumCulled = false; birdMesh.renderOrder = 1;
  scene.add(backdrop, birdMesh, woodMesh, leafMesh);

  const random = seededRandom(61), birds = Array.from({ length: BIRDS }, () => ({ x: 0, y: 0, vx: 0, vy: 0, size: 0, phase: 0, rate: 0, life: 0 }));
  const hits = createHits({ decay: 0.4, interval: 0.4 });
  let next = 0, lastFlock = -Infinity, clock = 0, cloudClock = 0, kick = 0;
  const launchFlock = (half: number) => {
    // A small V crossing the sky from one side to the other.
    const count = 3 + Math.floor(random() * 4), fromLeft = random() < 0.5, y = -0.05 + random() * 0.4, speed = 0.16 + random() * 0.1, slope = (random() - 0.5) * 0.15;
    for (let i = 0; i < count; i++) {
      const bird = birds[next]; next = (next + 1) % BIRDS;
      const rank = Math.ceil(i / 2), wing = i % 2 ? 1 : -1;
      Object.assign(bird, { x: (fromLeft ? -half - 0.06 : half + 0.06) - (fromLeft ? 1 : -1) * rank * 0.06, y: y + wing * rank * 0.04, vx: (fromLeft ? 1 : -1) * speed, vy: slope * speed,
        size: 0.03 + random() * 0.012, phase: random() * 6, rate: 7 + random() * 3, life: 1 });
    }
  };
  return {
    scene, camera,
    update(frame) {
      const half = frame.aspect / 2;
      if (camera.right !== half) { camera.left = -half; camera.right = half; camera.updateProjectionMatrix(); }
      backdrop.scale.set(frame.aspect, 1, 1);
      aspect.value = frame.aspect; time.value = frame.time;
      const step = settleStep(frame), still = frame.reducedMotion, { bounce, bass, loudness } = frame.response;
      hits.update(frame, 0.6);
      if (!still) { clock += frame.delta; cloudClock += frame.delta * (0.012 + loudness * 0.05 + bounce * 0.03); }
      drift.value = cloudClock;
      gust.value = approach(gust.value, bass, step, 0.3);
      sun.value = approach(sun.value, 0.4 + bass * 0.8 + hits.flash * 0.5, step, 0.15);
      // The canopy sways with the music: a slow lean plus a kick on each hit that rings out.
      if (hits.fired) kick = 1;
      kick *= Math.exp(-step / 0.5);
      const amount = still ? 0 : 0.006 + bounce * 0.022 + kick * 0.02;
      trunks.forEach((_, k) => { swayValues[k] = Math.sin(clock * (0.7 + k * 0.03) + k * 1.3) * amount + Math.sin(clock * 2.3 + k) * kick * 0.012; });
      sway.array = swayValues;
      flutter.value = approach(flutter.value, still ? 0 : 0.12 + bounce * 0.7 + kick * 0.3, step, 0.12);
      flutterRate.value = approach(flutterRate.value, 2 + loudness * 5, step, 0.3);
      // Birds fly over on the beats, at most one flock every 2.5 s.
      if (frame.time < lastFlock) lastFlock = -Infinity;
      if (hits.fired && frame.time - lastFlock > 2.5 && !still) { lastFlock = frame.time; launchFlock(half); }
      birds.forEach((bird, i) => {
        if (bird.life > 0) {
          bird.x += bird.vx * step * (1 + bounce * 0.6); bird.y += bird.vy * step;
          if (Math.abs(bird.x) > half + 0.25) bird.life = 0;
        }
        const flap = Math.sin(clock * bird.rate * (1 + bounce * 0.4) + bird.phase), s = bird.size, facing = Math.sign(bird.vx) || 1;
        const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
        corners.forEach(([cx, cy], c) => {
          const o = (i * 4 + c) * 3;
          birdPosition.set([bird.x + cx * s * facing, bird.y + cy * s * 0.6, 0], o);
          birdState.set([flap, bird.life > 0 ? 1 : 0, 0], o);
        });
      });
      birdPositionAttribute.needsUpdate = birdStateAttribute.needsUpdate = true;
    },
    dispose: () => disposeScene(scene),
  };
}
