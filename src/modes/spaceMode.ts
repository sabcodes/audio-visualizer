import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { Fn, Loop, abs, cos, exp, float, fract, mix, mx_fractal_noise_float, mx_noise_float, screenUV, sin, uniform, uniformArray, vec2, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import type { QualityBudget } from '../rendering/quality';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { hash2 } from './shaderModes';
import { createHits } from './hitPulse';
import { seededRandom } from '../rendering/diagnostics';

type F = Node<'float'>;
type V2 = Node<'vec2'>;

/** Meteors drawn at once (singles on beats, showers on big hits). */
export const METEORS = 32;

/** Black body-ish colour for a disk temperature 0 (cool, deep orange) – 1 (hot, blue-white). */
const temperature = (t: F) => mix(mix(vec3(0.9, 0.25, 0.05), vec3(1, 0.72, 0.42), t.smoothstep(0, 0.5)), vec3(0.85, 0.9, 1.1), t.smoothstep(0.5, 1));

/**
 * A lumpy rock: a fine icosphere pushed in and out by many octaves of sine noise, dented by craters, with
 * speckled vertex colour, so each seed is a different stone and none of them read as low-poly.
 */
export function asteroidGeometry(seed: number, detail = 5) {
  const geometry = new THREE.IcosahedronGeometry(1, detail), random = seededRandom(seed), position = geometry.attributes.position;
  const waves = Array.from({ length: 12 }, (_, i) => ({ axis: new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(), freq: 1.5 + i * 2.3 + random() * 2, phase: random() * 6, amp: 0.2 / Math.pow(i + 1, 1.15) }));
  const craters = Array.from({ length: 7 }, () => ({ at: new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(), radius: 0.15 + random() * 0.25, depth: 0.04 + random() * 0.06 }));
  const stretch = new THREE.Vector3(1 + random() * 0.6, 0.7 + random() * 0.3, 0.8 + random() * 0.4), v = new THREE.Vector3();
  const colours = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).normalize();
    let r = 1, grain = 0;
    for (const w of waves) { const wave = Math.sin(v.dot(w.axis) * w.freq + w.phase); r += wave * w.amp; grain += wave * w.amp; }
    for (const c of craters) {
      const d = v.angleTo(c.at) / c.radius;
      if (d < 1.3) r -= c.depth * (d < 1 ? 1 - d * d : -0.6 * (1.3 - d) / 0.3 * (d - 1) / 0.3 * 0.3);
    }
    // Speckled grey-brown: darker in hollows, a little lighter on the bumps.
    const tone = 0.75 + grain * 1.2 + (Math.sin(v.x * 37 + v.y * 23) * Math.sin(v.z * 31) * 0.08);
    colours.set([0.3 * tone, 0.285 * tone, 0.27 * tone], i * 3);
    v.multiplyScalar(r).multiply(stretch);
    position.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Outer Space: a deep starfield that scintillates like real stars, a black hole with a lensed, Doppler-bright
 * accretion disk, meteors (singles on beats, showers on big hits) and lit asteroids tumbling past.
 */
export function createOuterSpaceMode(budget: QualityBudget): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  const lens = camera as THREE.PerspectiveCamera;
  lens.fov = 55; lens.near = 0.1; lens.far = 400;
  const time = uniform(0), aspect = uniform(1), disk = uniform(0.6), spin = uniform(0), twinkle = uniform(0.5), flare = uniform(0), size = uniform(1);
  const meteorData = Array.from({ length: METEORS }, () => new THREE.Vector4(0, 0, 0, -1)), meteorHeads = Array.from({ length: METEORS }, () => new THREE.Vector4());
  const meteorStart = uniformArray(meteorData, 'vec4'), meteorHead = uniformArray(meteorHeads, 'vec4');

  const p = screenUV.sub(0.5).mul(vec2(aspect, 1)).mul(vec2(1, -1));
  // The black hole sits a little left of centre, with the disk tilted toward us.
  const centre = vec2(-0.12, 0.02), rel = p.sub(centre), r = rel.length(), rs = size.mul(0.075);
  // Lensing: background light is bent around the hole, strongest at the edge of the shadow.
  const bent = rel.sub(rel.normalize().mul(rs.mul(rs).div(r.max(0.001)).mul(1.8))).add(centre);

  /** Stars: three magnitude tiers on hashed grids. Each star's brightness follows fast, irregular scintillation. */
  const starLayer = (q: V2, cells: number, chance: number, magnitude: number, seed: number) => {
    const g = q.mul(cells), cell = g.floor(), h = hash2(cell.add(seed * 17.1)), h2 = hash2(cell.add(seed * 5.3));
    const offset = vec2(h2, hash2(cell.add(seed * 9.7))).sub(0.5).mul(0.7), d = fract(g).sub(0.5).sub(offset).length();
    const on = h.lessThan(chance).select(float(1), float(0));
    // Mostly steady with quick dips and spikes, each star at its own rate.
    const scint = mx_noise_float(vec3(h2.mul(311), time.mul(h.mul(9).add(5)), seed)).mul(twinkle).add(1).clamp(0.15, 2);
    const bright = h2.pow(3).mul(magnitude).mul(scint);
    const tint = mix(vec3(0.75, 0.82, 1.15), vec3(1.15, 0.85, 0.6), fract(h.mul(97)));
    return tint.mul(on.mul(d.smoothstep(0.07 + magnitude * 0.03, 0)).mul(bright));
  };
  const stars = starLayer(bent, 160, 0.06, 1.2, 1).add(starLayer(bent, 70, 0.04, 2.2, 2)).add(starLayer(bent, 28, 0.035, 4, 3));
  // A few bright stars with soft diffraction spikes.
  const big = bent.mul(7), bigCell = big.floor(), bh = hash2(bigCell.add(41)), local = fract(big).sub(0.5);
  const spikes = exp(abs(local.x).mul(-140)).mul(exp(abs(local.y).mul(-10))).add(exp(abs(local.y).mul(-140)).mul(exp(abs(local.x).mul(-10)))).add(exp(local.length().mul(-60)).mul(2));
  const bigTwinkle = mx_noise_float(vec3(bh.mul(91), time.mul(7), 4)).mul(twinkle.mul(0.6)).add(0.8);
  const bigStars = vec3(0.85, 0.9, 1).mul(bh.lessThan(0.06).select(float(1), float(0)).mul(spikes).mul(bigTwinkle).mul(0.45));
  // A faint dusty galactic band and nebula.
  const band = exp(bent.y.add(bent.x.mul(0.35)).mul(3.2).pow(2).negate());
  const dust = mx_fractal_noise_float(vec3(bent.mul(2.4), 3), 5, 2, 0.55).mul(0.5).add(0.5);
  const milky = mix(vec3(0.02, 0.018, 0.026), vec3(0.04, 0.03, 0.026), dust).mul(band.mul(dust.mul(dust).mul(1.6))).add(vec3(0.0015, 0.002, 0.005).mul(dust));

  // Accretion disk: thin and tilted, Keplerian streaks (inner spins faster), hotter inside, Doppler-bright on the
  // approaching side. The far half is lensed into an arc over the top of the shadow, and a fainter one under it.
  const tilt = 0.18, q = vec2(rel.x, rel.y.div(tilt)), d = q.length();
  const angle = spin.div(d.div(rs).pow(1.5).max(0.4));
  const swirl = vec2(q.x.mul(cos(angle)).sub(q.y.mul(sin(angle))), q.x.mul(sin(angle)).add(q.y.mul(cos(angle))));
  const streaks = mx_fractal_noise_float(vec3(swirl.div(rs).mul(1.6), d.div(rs).mul(1.2)), 4, 2, 0.55).mul(0.5).add(0.5);
  const ring = d.smoothstep(rs.mul(1.5), rs.mul(1.75)).mul(d.smoothstep(rs.mul(6), rs.mul(2.4)));
  const heat = d.div(rs).smoothstep(6, 1.6);
  const beam = q.x.div(d.max(0.001)).mul(-0.75).add(1).pow(2);
  const front = rel.y.lessThan(0).or(r.greaterThan(rs.mul(1.03)));
  const diskLight = temperature(heat.add(beam.mul(0.12))).mul(ring).mul(streaks.mul(1.3).add(0.25)).mul(beam).mul(heat.mul(0.8).add(0.15)).mul(disk).mul(front.select(float(1), float(0)));
  const arcTop = exp(r.sub(rs.mul(1.35)).abs().div(rs.mul(0.18)).negate()).mul(rel.y.greaterThan(0).select(float(1), float(0.35)));
  const arcLight = temperature(float(0.55)).mul(arcTop).mul(streaks.mul(0.7).add(0.5)).mul(rel.x.div(r.max(0.001)).mul(-0.4).add(1)).mul(disk).mul(0.9);
  const photon = exp(r.sub(rs.mul(1.04)).abs().div(rs.mul(0.02)).negate()).mul(1.4).mul(disk.mul(0.5).add(0.5));
  const shadow = r.smoothstep(rs.mul(0.98), rs.mul(1.02));

  // Meteors: bright heads with long fading trails.
  const meteors = Fn(() => {
    const total = float(0).toVar();
    Loop(METEORS, ({ i }) => {
      const start = meteorStart.element(i) as unknown as Node<'vec4'>, head = meteorHead.element(i) as unknown as Node<'vec4'>;
      const a = start.xy, b = head.xy, ab = b.sub(a), h = p.sub(a).dot(ab).div(ab.dot(ab).max(1e-6)).clamp(0, 1);
      const dist = p.sub(a.add(ab.mul(h))).length();
      total.addAssign(exp(dist.div(start.z.max(0.0005)).negate()).mul(h.pow(3)).mul(head.w).add(exp(p.sub(b).length().mul(-500)).mul(head.w).mul(1.5)));
    });
    return total;
  })();

  const flash = temperature(float(0.7)).mul(exp(r.div(rs.mul(5)).negate()).mul(flare).mul(0.5));
  scene.backgroundNode = stars.add(bigStars).add(milky).mul(shadow).add(diskLight).add(arcLight.mul(shadow)).add(vec3(1.3, 1.15, 1).mul(photon))
    .add(vec3(1, 0.95, 0.9).mul(meteors)).add(flash);

  // Asteroids: three rock shapes, instanced, tumbling toward and past the camera; lit warm from the disk.
  const rockMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0.05 });
  const perShape = budget.particleScale >= 2 ? 30 : budget.particleScale >= 1 ? 20 : 10, random = seededRandom(77);
  const shapes = [0, 1, 2].map((s) => new THREE.InstancedMesh(asteroidGeometry(s + 3, budget.particleScale >= 1 ? 5 : 4), rockMaterial, perShape));
  for (const mesh of shapes) mesh.frustumCulled = false;
  const rocks = shapes.flatMap((mesh, s) => Array.from({ length: perShape }, (_, i) => ({ mesh, i, s, x: 0, y: 0, z: 0, size: 1, axis: new THREE.Vector3(), turn: 0, rate: 0, speed: 1 })));
  const place = (rock: (typeof rocks)[number], far: boolean) => {
    rock.x = (random() - 0.5) * 60; rock.y = (random() - 0.5) * 34;
    // Keep the lane in front of the lens clear, so nothing fills the frame.
    if (Math.abs(rock.x) < 4 && Math.abs(rock.y) < 3) rock.x += rock.x < 0 ? -5 : 5; rock.z = far ? -150 - random() * 60 : -10 - random() * 200;
    rock.size = 0.3 + Math.pow(random(), 3) * 2.2; rock.axis.set(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
    rock.turn = random() * 6; rock.rate = 0.2 + random() * 0.8; rock.speed = 0.6 + random() * 0.8;
  };
  rocks.forEach((rock) => place(rock, false));
  const key = new THREE.DirectionalLight(0xffc89a, 2.2); key.position.set(-8, 4, 6);
  const fill = new THREE.HemisphereLight(0x223355, 0x050508, 0.35);
  scene.add(...shapes, key, fill);

  const hits = createHits({ decay: 0.4, interval: 0.3 });
  const meteorList = meteorData.map((data, i) => ({ data, head: meteorHeads[i], age: 99, life: 1, x: 0, y: 0, dx: 0, dy: 0, speed: 0, delay: 0 }));
  let next = 0, swirlPhase = 0, flight = 0, lastShower = -Infinity;
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), at = new THREE.Vector3(), scale = new THREE.Vector3();
  const launch = (x: number, y: number, angle: number, speed: number, delay: number) => {
    const meteor = meteorList[next]; next = (next + 1) % METEORS;
    Object.assign(meteor, { x, y, dx: Math.cos(angle), dy: Math.sin(angle), speed, age: -delay, life: 0.5 + random() * 0.4 });
    meteor.data.set(x, y, 0.0012 + random() * 0.0012, 0);
  };
  return {
    scene, camera,
    update(frame) {
      resizeCamera(lens, frame.aspect);
      time.value = frame.time; aspect.value = frame.aspect;
      const step = settleStep(frame), still = frame.reducedMotion, { bounce, bass, loudness, impact } = frame.response;
      hits.update(frame, 0.5);
      disk.value = approach(disk.value, 0.35 + bass * 0.6 + loudness * 0.15, step, 0.12);
      size.value = approach(size.value, 1 + bass * 0.08, step, 0.2);
      flare.value = hits.flash;
      twinkle.value = approach(twinkle.value, 0.35 + frame.audio.highs * 0.9 + loudness * 0.3, step, 0.1);
      if (!still) swirlPhase += frame.delta * (0.6 + bass * 1.2); spin.value = swirlPhase;
      // A beat sends a meteor; a big hit sets off a shower from one radiant, at most every 6 s.
      const half = frame.aspect / 2;
      if (frame.time < lastShower) lastShower = -Infinity;
      if (hits.fired && !still) {
        if (impact > 0.75 && frame.time - lastShower > 6) {
          lastShower = frame.time;
          const rx = (random() - 0.5) * half, ry = 0.55, base = -Math.PI / 2 + (random() - 0.5) * 0.6, count = frame.reducedFlash ? 10 : 22;
          for (let k = 0; k < count; k++) launch(rx + (random() - 0.5) * 0.3, ry + random() * 0.1, base + (random() - 0.5) * 0.7, 0.9 + random() * 0.8, random() * 1.2);
        } else launch((random() - 0.3) * half * 2, 0.2 + random() * 0.35, -Math.PI / 2 - 0.4 - random() * 0.6, 1 + random(), 0);
      }
      for (const meteor of meteorList) {
        meteor.age += step;
        const live = meteor.age > 0 && meteor.age < meteor.life, t = Math.max(0, meteor.age);
        const travel = t * meteor.speed, hx = meteor.x + meteor.dx * travel, hy = meteor.y + meteor.dy * travel;
        const tail = Math.min(travel, 0.12 + meteor.speed * 0.08);
        meteor.data.x = hx - meteor.dx * tail; meteor.data.y = hy - meteor.dy * tail;
        meteor.head.set(hx, hy, 0, live ? Math.sin(Math.PI * Math.min(1, meteor.age / meteor.life)) * 1.2 : 0);
      }
      // Asteroids drift toward the camera, faster with the bounce; a drop hurls a big one close past the lens.
      if (!still) flight = frame.delta * (6 + bounce * 22 + hits.level * 10);
      if (hits.fired && impact > 0.85 && !still) {
        const rock = rocks[Math.floor(random() * rocks.length)];
        place(rock, false); rock.z = -60; rock.x = (random() < 0.5 ? -1 : 1) * (7 + random() * 3); rock.y = (random() - 0.5) * 5; rock.size = 1.6 + random() * 0.8; rock.speed = 2.2;
      }
      for (const rock of rocks) {
        rock.z += flight * rock.speed;
        if (rock.z > 6) place(rock, true);
        rock.turn += step * rock.rate * (1 + bounce);
        rock.mesh.setMatrixAt(rock.i, matrix.compose(at.set(rock.x, rock.y, rock.z), quaternion.setFromAxisAngle(rock.axis, rock.turn), scale.setScalar(rock.size)));
      }
      for (const mesh of shapes) mesh.instanceMatrix.needsUpdate = true;
      key.intensity = 1.3 + bass * 1.6 + hits.flash * 1.2;
      lens.position.set(Math.sin(frame.time * 0.05) * 0.6, Math.sin(frame.time * 0.04) * 0.3, 0);
      lens.lookAt(0, 0, -100);
    },
    dispose() { disposeScene(scene); for (const mesh of shapes) mesh.geometry.dispose(); },
  };
}
