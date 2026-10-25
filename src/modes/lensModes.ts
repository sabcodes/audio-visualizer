import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { atan, cos, exp, float, fract, mix, mx_fractal_noise_float, mx_noise_float, normalize, screenCoordinate, sin, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import { disposeScene, approach, settleStep } from './shared';
import { fullscreen, hash2, palette } from './shaderModes';
import { createHits, linearRgb } from './hitPulse';
import { seededRandom } from '../rendering/diagnostics';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

const centred = (aspect: F) => uv().sub(0.5).mul(vec2(aspect, 1));
const vec3Uniform = (hex: number) => uniform(new THREE.Vector3(...linearRgb(hex)));

// ---------------------------------------------------------------- Pong Orbs

/** Orb radii as a fraction of frame height: two small emitters and the big glass bubble. */
export const ORB_RADII = [0.022, 0.035, 0.3] as const;

/** Moves circles around the frame, bouncing off the edges and off each other (equal-density discs). */
export function stepOrbs(orbs: { x: number; y: number; vx: number; vy: number; r: number }[], aspect: number, delta: number) {
  for (const orb of orbs) {
    orb.x += orb.vx * delta; orb.y += orb.vy * delta;
    const halfX = aspect / 2 - orb.r * 0.4, halfY = 0.5 - orb.r * 0.4;
    if (Math.abs(orb.x) > halfX) { orb.x = Math.sign(orb.x) * halfX; orb.vx = -orb.vx; }
    if (Math.abs(orb.y) > halfY) { orb.y = Math.sign(orb.y) * halfY; orb.vy = -orb.vy; }
  }
  for (let i = 0; i < orbs.length; i++) for (let j = i + 1; j < orbs.length; j++) {
    const a = orbs[i], b = orbs[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = a.r + b.r;
    if (d >= min || d < 1e-6) continue;
    const nx = dx / d, ny = dy / d, ma = a.r * a.r, mb = b.r * b.r;
    const push = (min - d) / (ma + mb);
    a.x -= nx * push * mb; a.y -= ny * push * mb; b.x += nx * push * ma; b.y += ny * push * ma;
    const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (relative < 0) {
      const impulse = 2 * relative / (ma + mb);
      a.vx += impulse * mb * nx; a.vy += impulse * mb * ny; b.vx -= impulse * ma * nx; b.vy -= impulse * ma * ny;
    }
  }
}

export function createPongOrbsMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const aspect = uniform(1), time = uniform(0), gain = uniform(0.1), plasma = uniform(0), spread = uniform(0.03), rayCount = uniform(30), pulse = uniform(0);
  const orbUniforms = ORB_RADII.map(() => uniform(new THREE.Vector3()));
  const p = centred(aspect);
  const big = orbUniforms[2];
  // Prism cones from each small orb toward the big one; R, G and B use slightly different widths for a fringe.
  const cone = (emitter: V3, half: F) => {
    const toward = normalize(big.xy.sub(emitter.xy)), v = p.sub(emitter.xy);
    const along = v.dot(toward), across = v.x.mul(toward.y).sub(v.y.mul(toward.x));
    const angle = atan(across, along).abs();
    const inside = angle.smoothstep(half, half.mul(0.55)).mul(along.greaterThan(0).select(float(1), float(0)));
    const striae = cos(atan(across, along).mul(rayCount).add(time.mul(0.7))).mul(0.5).add(0.5).pow(2).mul(0.7).add(0.3);
    return inside.mul(striae).mul(exp(along.mul(-1.1))).mul(along.smoothstep(emitter.z, emitter.z.mul(2.5)));
  };
  let rays: V3 = vec3(0);
  for (const emitter of orbUniforms.slice(0, 2)) {
    const half = float(0.24);
    rays = rays.add(vec3(cone(emitter, half.add(spread)), cone(emitter, half), cone(emitter, half.sub(spread))));
  }
  // Glass orbs: dark interior, a hairline rim, a fresnel brightening and two soft internal reflections.
  let glass: V3 = vec3(0), mask: F = float(0);
  orbUniforms.forEach((orb, index) => {
    const d = p.sub(orb.xy).length(), r = orb.z;
    const inside = d.smoothstep(r, r.mul(0.985)), rim = exp(d.sub(r).abs().div(0.0035).negate());
    const fresnel = d.div(r).clamp(0, 1).pow(4).mul(inside);
    if (index < 2) {
      // Emitters burn white-hot with a soft halo.
      glass = glass.add(vec3(1, 0.95, 0.97).mul(inside.mul(1.3).add(exp(d.div(r.mul(0.5)).negate()).mul(0.25))));
      return;
    }
    const highlight = exp(p.sub(orb.xy.add(vec2(r.mul(-0.35), r.mul(0.4)))).length().div(r.mul(0.18)).negate());
    const swirl = p.sub(orb.xy).div(r);
    // Plasma: thin bright veins from the ridges of two noise octaves.
    const vein = (scale: number, speed: number) => float(1).sub(mx_noise_float(vec3(swirl.mul(scale), time.mul(speed))).abs()).pow(14);
    const veins = vein(3.2, 1.3).add(vein(6.5, 2.1).mul(0.6)).mul(inside);
    const body = vec3(0.012, 0.001, 0.005).mul(inside).add(vec3(1, 0.25, 0.63).mul(fresnel.mul(pulse.mul(0.3).add(0.05))));
    const lit = body.add(vec3(1, 0.85, 0.95).mul(rim.mul(0.7))).add(vec3(1, 0.7, 0.85).mul(highlight.mul(0.25)))
      .add(rays.mul(inside).mul(gain).mul(0.8));
    const white = vec3(1, 0.9, 0.97).mul(inside.mul(0.9).add(veins.mul(1.6))).add(vec3(1, 0.5, 0.8).mul(exp(d.div(r).negate()).mul(0.4)));
    glass = glass.add(mix(lit, white, plasma));
    mask = mask.max(inside);
  });
  material.fragmentNode = vec4(rays.mul(mask.oneMinus().mul(0.8).add(0.2)).mul(gain).mul(0.6).add(glass.mul(gain.mul(0.4).add(0.6))), 1);

  const hits = createHits({ decay: 0.16, interval: 0.2 });
  const random = seededRandom(31);
  const orbs = ORB_RADII.map((r, i) => ({ x: [-0.6, -0.35, 0.25][i], y: [0.2, -0.15, 0][i], vx: (random() - 0.5) * 0.3, vy: (random() - 0.5) * 0.3, r }));
  let plasmaLevel = 0;
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      hits.update(frame, 0.08);
      const step = settleStep(frame);
      if (hits.fired && !frame.reducedMotion) {
        for (const orb of orbs) { const kick = 0.25 / Math.sqrt(orb.r * 10); orb.vx += (random() - 0.5) * kick; orb.vy += (random() - 0.5) * kick; }
        // Every fourth hit the big bubble flashes into a white veined plasma ball.
        if (hits.count % 4 === 0) plasmaLevel = 1;
      }
      for (const orb of orbs) {
        const damp = Math.exp(-step * 0.4); orb.vx *= damp; orb.vy *= damp;
        // The big bubble is drawn gently back toward the middle so it stays in frame.
        if (orb.r > 0.2) { orb.vx -= orb.x * 0.15 * step; orb.vy -= orb.y * 0.15 * step; }
      }
      if (!frame.reducedMotion) stepOrbs(orbs, frame.aspect, frame.delta);
      plasmaLevel = Math.max(0, plasmaLevel - step / 0.09);
      plasma.value = Math.min(1, plasmaLevel * 1.5) * (frame.reducedFlash ? 0.4 : 1);
      const swell = 1 + frame.response.bass * 0.08;
      orbs.forEach((orb, i) => orbUniforms[i].value.set(orb.x, orb.y, orb.r * swell));
      pulse.value = approach(pulse.value, frame.response.bass, step, 0.08);
      rayCount.value = 24 + Math.round(frame.audio.highs * 24);
      spread.value = 0.02 + frame.audio.highs * 0.04;
      gain.value = hits.floor * 0.5 + hits.flash * 1.1;
    },
    dispose: () => disposeScene(scene),
  };
}

// ---------------------------------------------------------------- Candy Orb

export const CANDY_PALETTES = [
  { colours: [0xff8a1e, 0xffd36a, 0xe0301e], iridescent: 0 },
  { colours: [0x4d9bff, 0x9af0d0, 0xffd56a], iridescent: 0.35 },
  { colours: [0xffb0d8, 0xb0e0ff, 0xfff0b0], iridescent: 1 },
] as const;

export function createCandyOrbMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const aspect = uniform(1), time = uniform(0), swirl = uniform(0), holeAt = uniform(new THREE.Vector2(0.03, -0.02)), holeRadius = uniform(0.11), rimWidth = uniform(0.06), gain = uniform(1);
  const caustic = uniform(0), iridescent = uniform(0), bloom = uniform(0.4), pulse = uniform(0);
  const colours = CANDY_PALETTES[0].colours.map(vec3Uniform);
  const p = centred(aspect), radius = float(0.4), r = p.length().div(radius), theta = atan(p.y, p.x);
  const disc = r.smoothstep(1.0, 0.985);
  const fromHole = p.sub(holeAt).length();
  const hole = fromHole.smoothstep(holeRadius, holeRadius.add(0.035));
  // Silky flow: noise sampled in polar coordinates that spin faster near the hole.
  const spin = theta.add(swirl.mul(r.oneMinus().mul(1.5).add(0.4)));
  const flow = mx_fractal_noise_float(vec3(cos(spin).mul(r.mul(2.2)), sin(spin).mul(r.mul(2.2)), time.mul(0.12)), 3, 2, 0.5).mul(0.5).add(0.5);
  const grooves = sin(fromHole.mul(Math.PI * 2 * 180).add(flow.mul(6))).mul(0.5).add(0.5).mul(0.18).add(0.82);
  // The caustic slides around the rim; the light comes from that side.
  const lit = cos(theta.sub(caustic)).mul(0.5).add(0.5);
  const band = lit.pow(5).mul(r.smoothstep(0.35, 0.95));
  const base = mix(colours[2], colours[0], flow.add(lit.mul(0.6)).clamp(0, 1));
  const film = palette(r.mul(1.4).add(flow.mul(0.8)).add(theta.div(Math.PI * 2)));
  const tint = mix(base, film, iridescent.mul(flow.mul(0.6).add(0.4)));
  const rim = exp(r.sub(0.985).abs().div(rimWidth.mul(0.25)).negate()).mul(lit.mul(0.6).add(0.4));
  const body = tint.mul(r.smoothstep(0.15, 0.9).mul(0.75).add(0.25)).mul(grooves).mul(lit.mul(0.8).add(0.35))
    .add(colours[1].mul(band.mul(0.7))).add(colours[1].mul(rim.mul(0.4)));
  // Dark core with a soft edge; outside the disc a faint glow and drifting dust.
  const halo = exp(r.sub(1).max(0).mul(-7)).mul(bloom).mul(r.greaterThan(0.99).select(float(1), float(0)));
  const dust = hash2(screenCoordinate.xy.div(3).floor()).greaterThan(0.9985).select(float(0.5), float(0));
  const colour = body.mul(disc).mul(hole).mul(pulse.mul(0.3).add(0.85)).add(colours[0].mul(halo.mul(0.35))).add(vec3(1, 0.6, 0.4).mul(dust.mul(disc.oneMinus())));
  material.fragmentNode = vec4(colour.mul(gain), 1);

  const hits = createHits({ decay: 0.4, interval: 0.6, variants: CANDY_PALETTES.length, seed: 17 });
  const random = seededRandom(41);
  let swirlPhase = 0, causticPhase = 0, holeTargetX = 0.03, holeTargetY = -0.02;
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      const step = settleStep(frame), still = frame.reducedMotion ? 0 : 1;
      hits.update(frame, 0.9);
      if (hits.fired) {
        CANDY_PALETTES[hits.variant].colours.forEach((hex, i) => colours[i].value.set(...linearRgb(hex)));
        iridescent.value = CANDY_PALETTES[hits.variant].iridescent;
        if (still) { holeTargetX = (random() - 0.5) * 0.16; holeTargetY = (random() - 0.5) * 0.12; }
      }
      swirlPhase += frame.delta * (0.2 + frame.audio.mid * 1.2) * still + hits.flash * 0.02 * still;
      causticPhase += frame.delta * Math.PI * 2 * 0.15 * still;
      swirl.value = swirlPhase; caustic.value = causticPhase;
      holeAt.value.set(approach(holeAt.value.x, holeTargetX, step, 0.3), approach(holeAt.value.y, holeTargetY, step, 0.3));
      holeRadius.value = approach(holeRadius.value, 0.12 + frame.response.bass * 0.05, step, 0.1);
      rimWidth.value = 0.04 + frame.response.bass * 0.05;
      pulse.value = hits.flash;
      bloom.value = 0.25 + frame.response.loudness * 0.6;
      gain.value = 0.5 + hits.flash * 0.15;
    },
    dispose: () => disposeScene(scene),
  };
}

// ---------------------------------------------------------------- Liquid Chrome

export const CHROME_PALETTES = [[0xff7a1a, 0xffffff, 0x3a66ff], [0x1a2cc8, 0x5ad0ff, 0xffffff], [0xff3fb0, 0xff7a1a, 0x7a3cff]] as const;
const BLOBS = 12, DROPLETS = 6;

export interface Blob { x: number; y: number; vx: number; vy: number; r: number; tx: number; ty: number; life: number }

/** One step of the blob sheet: springs toward wandering targets, soft collisions (merging lets them overlap), droplets fade. */
export function stepBlobs(blobs: Blob[], aspect: number, delta: number, merge: number) {
  for (const blob of blobs) {
    blob.vx += (blob.tx - blob.x) * 1.5 * delta; blob.vy += (blob.ty - blob.y) * 1.5 * delta;
    const damp = Math.exp(-delta * 1.2); blob.vx *= damp; blob.vy *= damp;
    blob.x += blob.vx * delta; blob.y += blob.vy * delta;
    const halfX = aspect / 2, halfY = 0.5;
    if (Math.abs(blob.x) > halfX) { blob.x = Math.sign(blob.x) * halfX; blob.vx *= -0.6; }
    if (Math.abs(blob.y) > halfY) { blob.y = Math.sign(blob.y) * halfY; blob.vy *= -0.6; }
  }
  // Blobs resist overlapping past a fraction of their radii; a higher merge level lets them fuse further.
  const reach = 0.95 - merge * 0.5;
  for (let i = 0; i < blobs.length; i++) for (let j = i + 1; j < blobs.length; j++) {
    const a = blobs[i], b = blobs[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = (a.r + b.r) * reach;
    if (d >= min || d < 1e-6 || a.r <= 0 || b.r <= 0) continue;
    const push = (min - d) * 0.5 * 2 * delta, nx = dx / d, ny = dy / d;
    a.vx -= nx * push; a.vy -= ny * push; b.vx += nx * push; b.vy += ny * push;
  }
}

export function createLiquidChromeMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const aspect = uniform(1), time = uniform(0), highlight = uniform(1), sparkle = uniform(0.3), gain = uniform(1);
  const blobUniforms = Array.from({ length: BLOBS + DROPLETS }, () => uniform(new THREE.Vector3(0, 0, 0)));
  const colours = CHROME_PALETTES[0].map(vec3Uniform);
  const p = centred(aspect);
  // Metaball field and its analytic gradient.
  let field: F = float(0), gradient: V2 = vec2(0);
  for (const blob of blobUniforms) {
    const delta = p.sub(blob.xy), d2 = delta.dot(delta).add(1e-4), r2 = blob.z.mul(blob.z);
    field = field.add(r2.div(d2));
    gradient = gradient.sub(delta.mul(r2.mul(2)).div(d2.mul(d2)));
  }
  // Crinkles in the surface, so highlights break into the razor slivers of the reference.
  const crinkle = vec2(mx_fractal_noise_float(vec3(p.mul(3.5), time.mul(0.3)), 2, 2.2, 0.5), mx_fractal_noise_float(vec3(p.mul(3.5).add(13), time.mul(0.3)), 2, 2.2, 0.5));
  const slope = gradient.div(field.mul(field).max(1e-3)).mul(0.12).add(crinkle.mul(0.5));
  const normal = normalize(vec3(slope.negate(), 1));
  // Studio softboxes reflected from above; R, G and B use slightly different normals for the chromatic edge.
  const env = (bend: number) => {
    const n = normalize(vec3(slope.mul(-bend), 1)), rx = n.x.mul(n.z).mul(2), ry = n.y.mul(n.z).mul(2);
    // Each softbox is a narrow band of reflection angles, so the highlights come out as thin slivers.
    const stripe = (v: F, at: number) => v.smoothstep(at, at + 0.04).sub(v.smoothstep(at + 0.07, at + 0.14));
    return colours[1].mul(stripe(rx, 0.3)).add(colours[0].mul(stripe(ry.negate(), 0.26)))
      .add(colours[2].mul(stripe(ry, 0.34))).add(colours[0].mul(stripe(rx.negate(), 0.4)).mul(0.6));
  };
  const reflection = vec3(env(0.92).x, env(1).y, env(1.08).z);
  const inside = field.smoothstep(0.92, 1.05);
  const edge = exp(field.sub(1).abs().div(0.012).negate()).mul(highlight).mul(inside);
  const grazing = normal.z.oneMinus().mul(3).clamp(0, 1);
  const glints = hash2(screenCoordinate.xy.div(2).floor().add(time.floor())).greaterThan(0.997).select(float(1), float(0)).mul(sparkle).mul(edge.add(grazing).min(1));
  const surface = vec3(0.008, 0.008, 0.011).add(reflection.mul(1.4)).add(colours[2].mul(grazing.pow(4).mul(0.12)));
  const colour = surface.mul(inside).add(mix(colours[0], vec3(1), 0.4).mul(edge.mul(0.5))).add(vec3(glints));
  material.fragmentNode = vec4(colour.mul(gain).add(vec3(0.005, 0.005, 0.007)), 1);

  const hits = createHits({ decay: 0.25, interval: 0.3, variants: CHROME_PALETTES.length, seed: 3 });
  const random = seededRandom(97);
  const wander = () => [(random() - 0.5) * 1.1, (random() - 0.5) * 0.6] as const;
  const blobs: Blob[] = Array.from({ length: BLOBS + DROPLETS }, (_, i) => {
    const [tx, ty] = wander();
    return { x: tx, y: ty, vx: 0, vy: 0, r: i < BLOBS ? 0.06 + random() * 0.09 : 0, tx, ty, life: 0 };
  });
  const baseRadius = blobs.map((blob) => blob.r);
  let nextDroplet = BLOBS, retarget = 0;
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      const step = settleStep(frame), still = frame.reducedMotion;
      hits.update(frame, 0.6);
      retarget -= step;
      if (retarget < 0) { retarget = 1.5; const blob = blobs[Math.floor(random() * BLOBS)]; [blob.tx, blob.ty] = wander(); }
      if (hits.fired) {
        CHROME_PALETTES[hits.variant].forEach((hex, i) => colours[i].value.set(...linearRgb(hex)));
        if (!still) {
          // Kick every blob away from a random point, and pinch a few droplets off at the seams.
          const [hx, hy] = wander();
          for (const blob of blobs.slice(0, BLOBS)) {
            const dx = blob.x - hx, dy = blob.y - hy, d = Math.max(0.05, Math.hypot(dx, dy));
            blob.vx += dx / d * 0.4 * (0.5 + frame.response.bass); blob.vy += dy / d * 0.4 * (0.5 + frame.response.bass);
          }
          for (let k = 0; k < 2; k++) {
            const a = blobs[Math.floor(random() * BLOBS)], droplet = blobs[nextDroplet];
            nextDroplet = BLOBS + (nextDroplet - BLOBS + 1) % DROPLETS;
            Object.assign(droplet, { x: a.x + a.r, y: a.y, vx: (random() - 0.5) * 0.6, vy: (random() - 0.5) * 0.6, r: 0.025 + random() * 0.02, life: 1.5, tx: a.x, ty: a.y });
          }
        }
      }
      // Quiet passages drain the sheet to a few small blobs; loud ones swell it.
      const swell = 0.6 + frame.response.loudness * 0.35 + frame.response.bass * 0.25;
      blobs.forEach((blob, i) => {
        if (i < BLOBS) blob.r = approach(blob.r, baseRadius[i] * swell * (i < 4 || frame.response.loudness > 0.15 ? 1 : 0.35), step, 0.3);
        else { blob.life -= step; blob.r = Math.max(0, blob.life > 0 ? blob.r : blob.r - step * 0.05); }
      });
      if (!still) stepBlobs(blobs, frame.aspect, Math.min(frame.delta, 1 / 20), frame.audio.mid);
      blobs.forEach((blob, i) => blobUniforms[i].value.set(blob.x, blob.y, blob.r));
      highlight.value = 0.5 + frame.response.loudness * 1.2;
      sparkle.value = frame.audio.highs;
      gain.value = 0.7 + hits.flash * 0.6;
    },
    dispose: () => disposeScene(scene),
  };
}

