import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { exp, float, fract, mix, mx_noise_float, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import { disposeScene, approach, settleStep } from './shared';
import { fullscreen, hash2 } from './shaderModes';
import { createHits, linearRgb, variantSequence } from './hitPulse';
import { DANCE_MOVES, blendPose, createBody, runPose, type BodyPose, type DanceMove } from './bodyModel';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

const rgb = (hex: number) => vec3(...linearRgb(hex));
const vec3Uniform = (hex: number) => uniform(new THREE.Vector3(...linearRgb(hex)));

/** Adds a beat groove to a key pose: bounce bends the knees and swings the arms, so the figure never freezes. */
export function groove(base: BodyPose, t: number, amount: number): BodyPose {
  const s = Math.sin(t), c = Math.cos(t);
  return {
    ...base,
    bob: base.bob - Math.abs(s) * 0.04 * amount, twist: base.twist + c * 0.12 * amount,
    arms: [{ ...base.arms[0], swing: base.arms[0].swing + s * 0.35 * amount, bend: base.arms[0].bend + Math.abs(c) * 0.3 * amount }, { ...base.arms[1], swing: base.arms[1].swing - s * 0.35 * amount, bend: base.arms[1].bend + Math.abs(s) * 0.3 * amount }],
    legs: [{ ...base.legs[0], bend: base.legs[0].bend + Math.abs(s) * 0.25 * amount }, { ...base.legs[1], bend: base.legs[1].bend + Math.abs(s) * 0.25 * amount }],
  };
}

/** Steps through dance moves on hits (never the same twice) and blends into each over `glide` seconds. */
export function createChoreography(moves: readonly DanceMove[], seed: number, glide = 0.25) {
  const sequence = variantSequence(moves.length, seed);
  let from: BodyPose = DANCE_MOVES[moves[0]], to: BodyPose = from, progress = 1;
  return {
    get move() { return moves[sequence.current]; },
    next(current: BodyPose) { from = current; to = DANCE_MOVES[moves[sequence.next()]]; progress = 0; },
    update(step: number): BodyPose {
      progress = Math.min(1, progress + step / glide);
      const eased = progress * progress * (3 - 2 * progress);
      return blendPose(from, to, eased);
    },
  };
}

// ---------------------------------------------------------------- Slit Dancer

/** Scanlines per frame height, and the two palettes (haze, streak, hot core). */
export const SLIT_LINES = 300;
export const SLIT_PALETTES = [[0x18204a, 0x4d6bff, 0xc8d0ff], [0x1a0503, 0xff5a3a, 0xffc8a8]] as const;

/**
 * Slit Dancer (wave 5, clip 12): a dancer in profile dissolved into thousands of horizontal light streaks,
 * standing on a mirror-black floor that reflects them. The body reads only from where the streaks are dense.
 * Kicks flip the palette between blue-violet and red-orange and change the move; a breakdown blacks out and
 * the drop comes back as a close, blown-out shot.
 */
export function createSlitDancerMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const aspect = uniform(1), time = uniform(0), smear = uniform(0), length = uniform(0.5), presence = uniform(1), haze = uniform(0.3), legs = uniform(0);
  const floorY = uniform(-0.34), blown = uniform(0);
  const hazeTone = vec3Uniform(SLIT_PALETTES[0][0]), streakTone = vec3Uniform(SLIT_PALETTES[0][1]), coreTone = vec3Uniform(SLIT_PALETTES[0][2]);
  const body = createBody({ hair: true });
  const streaks = (p: V2) => {
    const row = p.y.add(0.5).mul(SLIT_LINES), line = row.floor(), lineY = line.add(0.5).div(SLIT_LINES).sub(0.5);
    const thin = exp(fract(row).sub(0.5).abs().div(float(0.18).add(blown.mul(0.3))).negate());
    let total: F = float(0);
    // Two layers of streak cells per line: short dense ones and long sparse ones, each sampling the body at its centre.
    for (const [width, threshold, seed] of [[0.016, 0.25, 1.7], [0.05, 0.6, 5.3]] as const) {
      const offset = hash2(vec2(line, seed)).mul(width);
      const cellX = p.x.add(offset).div(width), id = cellX.floor(), at = fract(cellX);
      const h = hash2(vec2(id, line.add(seed * 31))), keep = h.greaterThan(threshold);
      const len = hash2(vec2(id.add(9.1), line)).mul(0.7).add(0.3).mul(length);
      const start = hash2(vec2(id.add(3.3), line)).mul(float(1).sub(len));
      const inStreak = at.smoothstep(start, start.add(0.06)).mul(at.smoothstep(start.add(len), start.add(len).sub(0.06)));
      // The body's density at the streak's centre, smeared sideways by its motion.
      const centreX = id.add(start).add(len.mul(0.5)).mul(width).sub(offset).sub(smear.mul(h.sub(0.5)).mul(2));
      const d = body.distance(vec2(centreX, lineY), 0.02);
      const density = d.negate().div(0.025).clamp(0, 1).add(exp(d.max(0).div(0.006).negate()).mul(0.25));
      const legWeight = float(1).add(legs.mul(lineY.sub(floorY).div(0.3).oneMinus().clamp(0, 1)));
      total = total.add(inStreak.mul(keep.select(float(1), float(0))).mul(density).mul(legWeight).mul(h.mul(0.8).add(0.8)));
    }
    return total.mul(thin);
  };
  const p = uv().sub(0.5).mul(vec2(aspect, 1));
  const above = streaks(p);
  // The floor mirrors the streaks, pulled down and broken by faint ripples.
  const mirrored = vec2(p.x.add(mx_noise_float(vec2(p.y.mul(40), time.mul(0.6))).mul(0.006)), floorY.mul(2).sub(p.y));
  const reflection = streaks(mirrored).mul(exp(floorY.sub(p.y).div(0.14).negate()).mul(0.3));
  const onFloor = p.y.lessThan(floorY);
  const lit = onFloor.select(reflection, above).mul(presence);
  const glow = exp(body.distance(vec2(p.x, onFloor.select(mirrored.y, p.y)), 0.05).max(0).div(0.16).negate()).mul(haze).mul(presence).mul(onFloor.select(float(0.4), float(1)));
  const backdrop = hazeTone.mul(exp(p.sub(vec2(0, 0.05)).length().div(0.55).negate()).mul(0.6));
  const colour: V3 = backdrop.mul(presence.mul(0.7).add(0.3)).add(hazeTone.mul(glow.mul(1.5))).add(mix(streakTone, coreTone, lit.sub(0.8).clamp(0, 1)).mul(lit.mul(1.4)));
  material.fragmentNode = vec4(colour, 1);

  const moves: DanceMove[] = ['armSwing', 'wideBack', 'legLift', 'star', 'squat', 'twist', 'reach'];
  const dance = createChoreography(moves, 21, 0.22), hits = createHits({ decay: 0.2, interval: 0.25 });
  const target = SLIT_PALETTES.map((set) => set.map((hex) => new THREE.Vector3(...linearRgb(hex))));
  let palette = 0, quiet = 0, loud = 0, blackout = false, closeUp = 0, groovePhase = 0, yaw = Math.PI / 2, lastHead = 0, current = DANCE_MOVES.idle;
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      const step = settleStep(frame), motion = frame.reducedMotion ? 0 : frame.delta, { bass, loudness, bounce } = frame.response;
      hits.update(frame, 0.05);
      // A breakdown is a quiet stretch after the music has been going for a while (not the silence before it starts).
      quiet = loudness < 0.1 ? quiet + step : 0;
      if (loudness > 0.25) loud += step;
      if (quiet > 1.5 && loud > 4) { blackout = true; loud = 0; }
      if (hits.fired) {
        palette = 1 - palette;
        dance.next(current);
        // The drop after a breakdown comes back close and blown out for a couple of seconds.
        if (blackout) { blackout = false; closeUp = 2.2; }
      }
      closeUp = Math.max(0, closeUp - step);
      // Reduced flash crossfades the palette instead of cutting it.
      const fade = frame.reducedFlash ? 0.15 : 0.02;
      [hazeTone, streakTone, coreTone].forEach((u, k) => { const t = target[palette][k]; u.value.set(approach(u.value.x, t.x, step, fade), approach(u.value.y, t.y, step, fade), approach(u.value.z, t.z, step, fade)); });
      groovePhase += motion * (2 + bounce * 4);
      current = groove(dance.update(step), groovePhase, 0.4 + bounce * 0.8);
      // Side view turning toward three-quarters and back.
      yaw = Math.PI / 2 - (Math.sin(frame.time * 0.25) * 0.5 + 0.5) * 0.8;
      const close = closeUp > 0 ? 1 : 0;
      blown.value = approach(blown.value, close, step, 0.2);
      const height = 0.66 + blown.value * 0.9, y = floorY.value - blown.value * 0.55;
      body.pose(current, Math.sin(frame.time * 0.3) * 0.05, y, height, yaw, frame.time);
      smear.value = approach(smear.value, Math.min(0.08, Math.abs(body.head.x - lastHead) / Math.max(step, 1e-3) * 0.04) + frame.audio.mid * 0.02, step, 0.08);
      lastHead = body.head.x;
      length.value = approach(length.value, 0.4 + frame.audio.mid * 0.6 + blown.value * 0.3, step, 0.1);
      legs.value = approach(legs.value, bass * 0.8, step, 0.08);
      presence.value = approach(presence.value, blackout ? 0 : 0.75 + hits.flash * 0.25, step, blackout ? 0.25 : 0.05);
      haze.value = approach(haze.value, 0.25 + loudness * 0.4 + blown.value * 0.6, step, 0.1);
    },
    dispose: () => disposeScene(scene),
  };
}

// ---------------------------------------------------------------- Neon Portal

/** Palette scenes, one per ~16 hits: frame edge, core light, fog. */
export const PORTAL_SCENES = [
  { edge: 0x2affe8, core: 0xd8fff8, fog: 0x7ff5ff },
  { edge: 0xc8ff3a, core: 0x2ad8c0, fog: 0xd8fff0 },
  { edge: 0xff3aa8, core: 0x9a4aff, fog: 0xffb8f0 },
] as const;
export const PORTAL_FRAMES = 9;

/**
 * Neon Portal (wave 5, clip 3): a free-standing cube of nine nested glowing square frames on night grass,
 * receding into a fog-filled tunnel with a bright back-lit core. Two dancers inside read only as soft
 * shadows in the haze. Kicks ripple the frames from the inside out and flash the core; the bass thickens
 * the fog; a breakdown drops it all to dim pink edges and the next kick rebuilds frames, core, then fog.
 */
export function createNeonPortalMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const aspect = uniform(1), time = uniform(0), zoom = uniform(1), ripple = uniform(9), edgeLight = uniform(1), coreLight = uniform(1), fogLight = uniform(0.6);
  const edgeTone = vec3Uniform(PORTAL_SCENES[0].edge), coreTone = vec3Uniform(PORTAL_SCENES[0].core), fogTone = vec3Uniform(PORTAL_SCENES[0].fog);
  const dancers = [createBody({ hair: true, skirt: true, build: 0.9 }), createBody({ build: 1 })];
  const centre = vec2(0, 0.06), outer = 0.34;
  const p = uv().sub(0.5).mul(vec2(aspect, 1)).div(zoom), q = p.sub(centre);
  const box = q.x.abs().max(q.y.abs());
  // Nested frames: each smaller by a perspective squeeze, thinner with depth, brightness rippling outward on a kick.
  // The dancers stand between the fourth and fifth frames, so the deeper frames pass behind them.
  let frames: V3 = vec3(0), backFrames: V3 = vec3(0);
  for (let k = 0; k < PORTAL_FRAMES; k++) {
    const size = outer * Math.pow(0.82, k), width = 0.0035 * Math.pow(0.86, k);
    const d = box.sub(size).abs();
    const wave = exp(ripple.sub(PORTAL_FRAMES - 1 - k).abs().div(1.2).negate());
    const glow = exp(d.div(width).negate()).mul(1.6).add(exp(d.div(width * 6).negate()).mul(0.35));
    const lit = edgeTone.mul(glow.mul(wave.mul(1.5).add(0.6)).mul(Math.pow(0.9, k)));
    if (k < 4) frames = frames.add(lit); else backFrames = backFrames.add(lit);
  }
  const insideOuter = box.smoothstep(outer, outer - 0.01);
  // Core: the back wall glowing through layered fog that is densest at the far end.
  const deepest = outer * Math.pow(0.82, PORTAL_FRAMES - 1);
  const coreGlow = exp(box.sub(deepest).max(0).div(0.05).negate()).mul(1.4).add(exp(q.length().div(0.12).negate()).mul(0.5));
  const haze = exp(box.div(outer).mul(2.2).negate()).mul(insideOuter).add(exp(box.sub(outer).max(0).div(0.08).negate()).mul(0.15));
  const swirl = mx_noise_float(vec3(q.mul(6), time.mul(0.25))).mul(0.25).add(0.85);
  const coreLightColour = coreTone.mul(coreGlow.mul(coreLight)).add(fogTone.mul(haze.mul(fogLight).mul(swirl)));
  // The dancers stand mid-tunnel: dark, edge-softened shadows, thinned by the fog in front of them.
  let shadow: F = float(0);
  for (const dancer of dancers) {
    const d = dancer.distance(p, 0.02);
    shadow = shadow.max(d.smoothstep(0.008, -0.006));
  }
  const fogFront = fogLight.mul(0.35).add(0.1);
  let colour: V3 = coreLightColour.add(backFrames.mul(edgeLight)).mul(shadow.mul(float(1).sub(fogFront)).oneMinus());
  colour = colour.add(frames.mul(edgeLight));
  // Ground: dark grass under the portal with a coloured spill in front of it, and a dim night sky above.
  const ground = p.y.lessThan(centre.y.sub(outer));
  const grass = mx_noise_float(vec3(p.x.mul(220), p.y.mul(60), 1)).mul(0.5).add(0.5);
  const spill = exp(vec2(q.x.div(0.5), p.y.sub(centre.y.sub(outer)).div(0.12)).length().negate().mul(1.5));
  const groundColour = vec3(0.004, 0.008, 0.005).mul(grass.add(0.5)).add(edgeTone.mul(spill.mul(edgeLight.mul(0.18)).mul(grass.mul(0.6).add(0.4)))).add(coreTone.mul(spill.mul(coreLight.mul(0.08))));
  const sky = vec3(0.002, 0.003, 0.008).add(fogTone.mul(exp(q.length().div(0.6).negate()).mul(fogLight.mul(0.04))));
  colour = ground.select(groundColour, colour.add(sky.mul(insideOuter.oneMinus())));
  material.fragmentNode = vec4(colour, 1);

  const hits = createHits({ decay: 0.18, interval: 0.2 });
  const choreography = [createChoreography(['armSwing', 'twist', 'idle', 'reach', 'wideBack'], 4, 0.5), createChoreography(['twist', 'armSwing', 'reach', 'idle', 'wideBack'], 9, 0.5)];
  const poses = [DANCE_MOVES.idle, DANCE_MOVES.idle];
  const scenes = PORTAL_SCENES.map((s) => [s.edge, s.core, s.fog].map((hex) => new THREE.Vector3(...linearRgb(hex))));
  const breakdownTone = [0x5a1838, 0x080208, 0x100410].map((hex) => new THREE.Vector3(...linearRgb(hex)));
  let palette = 0, quiet = 0, loud = 0, dark = false, rebuild = 9, rippleAt = 9, phase = 0, framing = 0;
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      const step = settleStep(frame), motion = frame.reducedMotion ? 0 : frame.delta, { bass, loudness, bounce } = frame.response;
      hits.update(frame, 0.08);
      quiet = loudness < 0.1 ? quiet + step : 0;
      if (loudness > 0.25) loud += step;
      if (quiet > 2 && loud > 4) { dark = true; loud = 0; }
      if (hits.fired) {
        rippleAt = -1;
        if (dark) { dark = false; rebuild = 0; }
        if (hits.count % 16 === 0) palette = (palette + 1) % PORTAL_SCENES.length;
        if (hits.count % 32 === 0) framing = 1 - framing;
        if (hits.count % 3 === 0) choreography.forEach((c, i) => c.next(poses[i]));
      }
      rippleAt += step / 0.15 * (PORTAL_FRAMES / 4);
      ripple.value = Math.min(rippleAt, 12);
      rebuild += step;
      // Rebuild after a breakdown: frame edges, then the core, then the fog (about 0.2 s apart).
      const stage = (at: number) => Math.min(1, Math.max(0, (rebuild - at) / 0.25));
      const tones = dark ? breakdownTone : scenes[palette];
      [edgeTone, coreTone, fogTone].forEach((u, k) => { const t = tones[k]; u.value.set(approach(u.value.x, t.x, step, 0.3), approach(u.value.y, t.y, step, 0.3), approach(u.value.z, t.z, step, 0.3)); });
      const flashCap = frame.reducedFlash ? 0.4 : 1;
      edgeLight.value = dark ? 0.35 : stage(0) * (0.8 + hits.flash * 0.6 * flashCap);
      coreLight.value = dark ? 0.05 : stage(0.2) * (0.7 + hits.flash * 0.8 * flashCap + bass * 0.3);
      fogLight.value = approach(fogLight.value, dark ? 0.05 : stage(0.4) * (0.4 + bass * 0.8), step, 0.15);
      zoom.value = approach(zoom.value, framing ? 0.72 : 1, step, 1.2);
      phase += motion * (1.8 + bounce * 3);
      const scale = 0.4 + frame.audio.mid * 1.1;
      choreography.forEach((c, i) => {
        poses[i] = groove(c.update(step), phase + i * 1.3, scale);
        dancers[i].pose(poses[i], (i ? 0.055 : -0.05) + Math.sin(frame.time * 0.4 + i * 2) * 0.02, 0.06 - 0.165, 0.29, (i ? -0.5 : 0.6) + Math.sin(frame.time * 0.5 + i) * 0.4, frame.time);
      });
    },
    dispose: () => disposeScene(scene),
  };
}

// ---------------------------------------------------------------- Dream Alley

export interface AlleySlab { o: [number, number, number]; u: [number, number, number]; v: [number, number, number]; away: [number, number, number]; notch: number; hole: [number, number, number, number]; seed: number }
export const ALLEY_SLABS = 7;

/**
 * The street's slabs for one layout variant: two left walls, a tilted sky slab, three right slabs and the
 * tower at the vanishing point. Each has an origin and two edge vectors (metres), the direction it slides
 * away in on a collapse, a stepped top edge (`notch`) and a dark window cut-out (`hole`, in slab uv).
 */
export function alleyLayout(variant: number): AlleySlab[] {
  const tall = [9, 13, 7, 11][variant % 4], towerX = [-3, 1.5, -1, -4.5][variant % 4], hole = [[0.55, 0.25, 0.7, 0.55], [0.2, 0.35, 0.35, 0.7], [0.7, 0.15, 0.85, 0.4], [0.35, 0.45, 0.5, 0.75]][variant % 4] as [number, number, number, number];
  return [
    { o: [-4, 0, -3], u: [0, 0, -28], v: [0, tall, 0], away: [-1, 0, 0], notch: 0.18, hole, seed: 1 + variant },
    { o: [-5.5, 0, -31], u: [0.5, 0, -18], v: [0, tall + 6, 0], away: [-1, 0, 0], notch: 0.1, hole: [0, 0, 0, 0], seed: 7 + variant },
    { o: [-7, 13, -5], u: [14, 0, 0], v: [0, 3, -38], away: [0, 1, 0], notch: 0, hole: [0, 0, 0, 0], seed: 13 + variant },
    { o: [3.8, 0, -2.5], u: [1.2, 0, -12], v: [0, 6 + variant % 3, 0], away: [1, 0, 0], notch: 0.25, hole: [0, 0, 0, 0], seed: 19 + variant },
    { o: [5.5, 0, -16], u: [-0.8, 0, -15], v: [0, 12, 0], away: [1, 0, 0], notch: 0.12, hole: [0.3, 0.5, 0.45, 0.8], seed: 23 + variant },
    { o: [5, 0, -32], u: [0, 0, -12], v: [0, 19, 0], away: [1, 0, 0], notch: 0.08, hole: [0, 0, 0, 0], seed: 29 + variant },
    { o: [towerX, 0, -48], u: [6, 0, 0], v: [0, 34, 0], away: [0, 0, 0], notch: 0.05, hole: [0, 0, 0, 0], seed: 31 + variant },
  ];
}

/**
 * Dream Alley (wave 5, clip 5): a white glowing runner in a flaring coat heads away down a violet-blue street
 * built as a collage of angled facade slabs with pure-black voids between them. A kick collapses the slabs
 * in a staggered wipe (the runner swells toward the camera), then they return in a new layout; snares flare
 * the coat; a breakdown leaves only the runner and the tower. Runner and facades are all code.
 */
export function createDreamAlleyMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const aspect = uniform(1), time = uniform(0), fov = uniform(0.87), glow = uniform(0.8), wash = uniform(0.4), rim = uniform(0), lamp = uniform(0);
  const slabUniforms = Array.from({ length: ALLEY_SLABS }, () => ({ o: uniform(new THREE.Vector3()), u: uniform(new THREE.Vector3()), v: uniform(new THREE.Vector3()), extra: uniform(new THREE.Vector4()), hole: uniform(new THREE.Vector4()) }));
  const runner = createBody({ skirt: true, build: 0.92 });
  const p = uv().sub(0.5).mul(vec2(aspect, 1));
  const ro = vec3(0, 1.3, 0), rd = vec3(p.x, p.y.sub(0.04), fov.negate()).normalize();
  // Nearest slab hit: t, slab uv, seed, and edge-vector lengths for the window grid.
  let bestT: F = float(1e4), bestUv: V2 = vec2(0), bestSeed: F = float(0), bestSize: V2 = vec2(1);
  for (const slab of slabUniforms) {
    const n = slab.u.cross(slab.v), denom = rd.dot(n);
    const t = slab.o.sub(ro).dot(n).div(denom.abs().max(1e-5).mul(denom.sign()));
    const h = ro.add(rd.mul(t)).sub(slab.o);
    const su = h.dot(slab.u).div(slab.u.dot(slab.u)), sv = h.dot(slab.v).div(slab.v.dot(slab.v));
    // Stepped top edge: the slab's height drops in blocks along its length.
    const step = hash2(vec2(su.mul(5).floor(), slab.extra.y)).mul(slab.extra.z);
    const inHole = su.greaterThan(slab.hole.x).and(su.lessThan(slab.hole.z)).and(sv.greaterThan(slab.hole.y)).and(sv.lessThan(slab.hole.w));
    const inside = su.greaterThan(0).and(su.lessThan(1)).and(sv.greaterThan(0)).and(sv.lessThan(float(1).sub(step))).and(t.greaterThan(0)).and(t.lessThan(bestT)).and(inHole.not()).and(slab.extra.x.greaterThan(0.01));
    bestT = inside.select(t, bestT); bestUv = inside.select(vec2(su, sv), bestUv); bestSeed = inside.select(slab.extra.y, bestSeed);
    bestSize = inside.select(vec2(slab.u.length(), slab.v.length()), bestSize);
  }
  // Facade: a night window grid (random lit panes), a dim gradient, haze with height, a neon streak and a lamp.
  const cell = bestUv.mul(bestSize).div(vec2(0.8, 1.15)), id = cell.floor(), at = fract(cell);
  const pane = at.x.smoothstep(0.18, 0.24).mul(at.x.smoothstep(0.82, 0.76)).mul(at.y.smoothstep(0.22, 0.28)).mul(at.y.smoothstep(0.78, 0.72));
  // Lit windows come in clusters (whole flats), each pane a little different, brighter toward its lower half like a lamp inside.
  const cluster = hash2(id.div(vec2(3, 2)).floor().add(bestSeed.mul(17)));
  const litPane = hash2(id.add(bestSeed.mul(17))).greaterThan(cluster.mul(0.5).add(0.45)).select(hash2(id.add(2.2)).mul(0.6).add(0.4), float(0));
  const paneTone = mix(rgb(0x7f98ff), rgb(0xd8c8ff), hash2(id.add(5.5))).mul(at.y.oneMinus().mul(0.5).add(0.6));
  const wall = mix(rgb(0x0a0c2a), rgb(0x2a1c5a), bestUv.y.mul(0.6).add(hash2(vec2(bestSeed, 3)).mul(0.4)));
  const streakAt = hash2(vec2(bestSeed, 9)).mul(0.6).add(0.2);
  const neon = exp(bestUv.y.sub(streakAt).abs().mul(bestSize.y).div(0.08).negate()).mul(hash2(vec2(bestSeed, 4)).greaterThan(0.5).select(float(1), float(0)));
  let facade: V3 = wall.add(paneTone.mul(pane.mul(litPane).mul(0.6))).add(mix(rgb(0xff4ad8), rgb(0x4ad8ff), hash2(vec2(bestSeed, 6))).mul(neon.mul(0.8)));
  facade = facade.add(rgb(0x6a5aff).mul(mx_noise_float(vec3(bestUv.mul(vec2(3, 6)), time.mul(0.1))).mul(0.5).add(0.5).mul(0.08)));
  const hitSlab = bestT.lessThan(1e3);
  const fog = exp(bestT.div(55).negate());
  // Mist hangs low in the street and thickens with distance.
  const mist = exp(ro.add(rd.mul(bestT)).y.div(3).negate()).mul(0.12);
  facade = facade.mul(fog).add(rgb(0x2a2470).mul(fog.oneMinus().mul(0.35).add(mist)));
  // Floor: a dark glossy street with a violet wash, hard angular shadows and the runner's light pooled ahead.
  const floorT = ro.y.div(rd.y.negate().max(1e-4)), onFloor = rd.y.lessThan(0).and(floorT.lessThan(bestT));
  const fp = ro.add(rd.mul(floorT));
  const wedge = fp.x.add(fp.z.mul(0.22)).add(hash2(vec2(fp.z.div(5).floor(), 2)).mul(1.5)).lessThan(-1.2).or(fp.x.sub(fp.z.mul(0.12)).greaterThan(2.4));
  const pool = exp(vec2(fp.x, fp.z.add(5)).length().div(1.6).negate());
  const floorColour = rgb(0x0c0a24).mul(wash.mul(0.8).add(0.4)).mul(wedge.select(float(0.08), float(1))).mul(exp(floorT.div(40).negate()))
    .add(rgb(0xc8d0ff).mul(pool.mul(glow.mul(0.25)))).add(rgb(0x8a7aff).mul(exp(fp.x.abs().div(0.6).negate()).mul(exp(floorT.div(25).negate())).mul(wash.mul(0.12))));
  let colour: V3 = onFloor.select(floorColour, hitSlab.select(facade, vec3(0)));
  // A street lamp's glow bobbing in the middle distance.
  colour = colour.add(rgb(0xd8d0ff).mul(exp(p.sub(vec2(0.02, float(0.02).add(lamp.mul(0.01)))).length().div(0.025).negate()).mul(0.5)));
  // The runner: a hot white silhouette with a soft rim and a wide bloom, and a faint reflection on the street.
  const d = runner.distance(p, 0.01);
  const body = d.smoothstep(0.002, -0.002);
  const halo = exp(d.max(0).div(0.008).negate()).mul(float(0.35).add(rim)).add(exp(d.max(0).div(0.06).negate()).mul(0.12));
  const feet = float(-0.235);
  const mirrorD = runner.distance(vec2(p.x, feet.mul(2).sub(p.y)), 0.03);
  const reflection = exp(mirrorD.max(0).div(0.02).negate()).mul(p.y.lessThan(feet).select(float(1), float(0))).mul(exp(feet.sub(p.y).div(0.06).negate())).mul(0.3);
  colour = mix(colour, vec3(1, 0.98, 1).mul(glow.mul(0.3).add(0.85)), body).add(rgb(0xc0b8ff).mul(halo.add(reflection).mul(glow)));
  material.fragmentNode = vec4(colour, 1);

  const hits = createHits({ decay: 0.2, interval: 0.25 }), layouts = variantSequence(4, 8);
  const live = alleyLayout(0).map((slab) => ({ ...slab, presence: 1, delay: 0 }));
  let layout = alleyLayout(0), collapse = -1, lastCollapse = -10, stride = 0, flare = 0, quiet = 0, loud = 0, zoom = 1, push = 0;
  const gone = [0, 2, 1, 3, 4, 5]; // collapse order: left wall and sky first, then the rest
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      const step = settleStep(frame), motion = frame.reducedMotion ? 0 : frame.delta, { bass, loudness, bounce } = frame.response;
      hits.update(frame, 0.08);
      quiet = loudness < 0.1 ? quiet + step : 0;
      if (loudness > 0.25) loud += step;
      const breakdown = quiet > 1.5 && loud > 4;
      if (frame.time < lastCollapse) lastCollapse = -10;
      if (hits.fired) {
        push = 1;
        const snare = frame.audio.highs > frame.audio.bass + 0.15;
        if (snare) { flare = 1; rim.value = frame.reducedFlash ? 0.4 : 1; }
        else if (frame.time - lastCollapse > 2.4) {
          // Collapse: slabs slide away in a staggered 0.4 s wipe, then return in three steps in a new layout.
          lastCollapse = frame.time; collapse = 0; layout = alleyLayout(layouts.next());
          gone.forEach((index, k) => { live[index].delay = k * 0.07; });
        }
      }
      if (collapse >= 0) collapse += step;
      if (collapse > 2.2) collapse = -1;
      live.forEach((slab, i) => {
        const away = collapse >= 0 && collapse < 0.9 && i !== 6;
        const returning = collapse >= 0.9 ? Math.min(1, Math.max(0, (collapse - 0.9 - Math.floor(i / 2.4) * 0.3) / 0.3)) : 1;
        if (collapse >= 0.9 && returning > 0) Object.assign(slab, { ...layout[i], presence: slab.presence, delay: slab.delay });
        const target = breakdown && i !== 6 ? 0 : away ? (collapse < slab.delay ? 1 : 0) : returning;
        slab.presence = approach(slab.presence, target, step, 0.08);
        const slide = (1 - slab.presence) * 18;
        slabUniforms[i].o.value.set(slab.o[0] + slab.away[0] * slide, slab.o[1] + slab.away[1] * slide, slab.o[2] + slab.away[2] * slide);
        slabUniforms[i].u.value.set(...slab.u); slabUniforms[i].v.value.set(...slab.v);
        slabUniforms[i].extra.value.set(slab.presence, slab.seed, slab.notch, 0);
        slabUniforms[i].hole.value.set(...slab.hole);
      });
      // The runner swells toward the camera during the collapse and settles back as the slabs return.
      zoom = approach(zoom, collapse >= 0 && collapse < 1.2 ? 1.6 : 1, step, 0.25);
      stride += motion * 1.5 * (1 + bounce * 0.3);
      flare = Math.max(Math.abs(Math.sin(stride * Math.PI * 2)) * 0.45, flare * Math.exp(-step / 0.3));
      rim.value *= Math.exp(-step / 0.2);
      const height = 0.31 * zoom, x = Math.sin(frame.time * 0.4) * 0.015;
      runner.pose(runPose(stride, flare), x, -0.235 - (zoom - 1) * 0.12, height, Math.PI, frame.time);
      push *= Math.exp(-step / 0.25);
      fov.value = 0.87 + push * 0.05;
      glow.value = approach(glow.value, 0.6 + bass * 0.7, step, 0.08);
      wash.value = approach(wash.value, 0.3 + loudness * 0.8, step, 0.15);
      lamp.value = frame.reducedMotion ? 0 : Math.sin(stride * Math.PI * 4);
    },
    dispose: () => disposeScene(scene),
  };
}
