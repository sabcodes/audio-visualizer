import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { attribute, exp, float, fract, hash, mix, mx_fractal_noise_float, mx_noise_float, positionWorld, sin, texture as sampleTexture, uniform, uv, vec2, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { VisualMode } from './types';
import type { QualityBudget } from '../rendering/quality';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { createCinematic } from './cinematic';
import { hash2 } from './shaderModes';
import { createHits, linearRgb } from './hitPulse';
import { seededRandom } from '../rendering/diagnostics';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

const tier = (budget: QualityBudget, high: number, balanced: number, low: number) => budget.particleScale >= 2 ? high : budget.particleScale >= 1 ? balanced : low;
const rgb = (hex: number) => vec3(...linearRgb(hex));

/** A CRT shell standing on y = 0, screen facing +z: a rounded bezel box with a tapered housing behind it. */
export function crtShell(width: number, height: number, depth: number) {
  const bezel = new RoundedBoxGeometry(width, height, depth * 0.38, 3, Math.min(width, height) * 0.06).translate(0, height / 2, -depth * 0.19);
  // A four-sided frustum rotated so its wide end meets the bezel: the tube housing.
  const back = new THREE.CylinderGeometry(Math.hypot(width, height) * 0.24, Math.hypot(width, height) * 0.5, depth * 0.66, 4, 1).rotateY(Math.PI / 4).rotateX(-Math.PI / 2);
  back.scale(width / height > 1 ? 1 : width / height, width / height > 1 ? height / width : 1, 1);
  back.translate(0, height * 0.52, -depth * 0.38 - depth * 0.33);
  const merged = mergeGeometries([bezel.toNonIndexed(), back.toNonIndexed()]);
  bezel.dispose(); back.dispose();
  return merged;
}

/** The curved glass in front of a shell made by `crtShell`, bulging a little toward the viewer. */
export function crtGlass(width: number, height: number) {
  const glass = new THREE.PlaneGeometry(width * 0.8, height * 0.76, 16, 12), position = glass.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const u = position.getX(i) / (width * 0.4), v = position.getY(i) / (height * 0.38);
    position.setZ(i, 0.04 * Math.min(width, height) * (1 - (u * u + v * v) / 2));
  }
  glass.computeVertexNormals();
  return glass.translate(0, height / 2, 0.005);
}

/** CRT scanlines and a darkened rim, applied to a screen colour at glass uv. */
const tube = (colour: V3, at: Node<'vec2'>, lines: number) => {
  // A squircle falloff: the picture fills the rounded-rectangle glass and darkens only near its corners and edges.
  const c = at.sub(0.5).mul(2), edge = c.x.pow(4).add(c.y.pow(4)).pow(0.25), rim = edge.smoothstep(1.02, 0.7);
  return colour.mul(sin(at.y.mul(lines * Math.PI)).mul(0.18).add(0.82)).mul(rim);
};

// ---------------------------------------------------------------- CRT Spill

/** Emitter layout for the spill: jet length (m), fan width (rad), and how fast a kick's pulse runs down it (m/s). */
export const SPILL = { length: 2.4, fan: 0.44, pulseSpeed: 3.6, pulses: 4 } as const;

/**
 * CRT Spill (wave 5, clip 1): a dark wet concrete floor lit only by a CRT turned 35° to the camera, its mint
 * screen churning with folded noise and white veins on the bass. From the screen's lower edge a fan of fine
 * ice-blue sparkle sprays across the floor; each kick sends a bright pulse down the jet (the comb-like
 * fronts in the clip). A dim second set behind sprays upward on the mids. The palette never cycles.
 */
export function createCrtSpillMode(budget: QualityBudget): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).fov = 50;
  scene.background = new THREE.Color(0x000000);
  const finish = createCinematic({ grain: 0.06, halation: 0.35, vignette: 0.7, soften: 0.12, aberration: 0.002, shadows: [0.002, 0.004, 0.004] });
  const time = uniform(0), clock = uniform(0), glow = uniform(0.6), veins = uniform(0.1), shimmer = uniform(0), backSpray = uniform(0.3);
  const fronts = uniform(new THREE.Vector4(-9, -9, -9, -9));
  const world = new THREE.Group();
  // Screens: domain-warped noise in mint and white, with lightning-like veins that the bass thickens.
  const screenMaterial = (gain: F, tint: V3) => {
    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    const at = uv(), q = at.sub(0.5).mul(vec2(1.3, 1));
    const warp = vec2(mx_fractal_noise_float(vec3(q.mul(2.2), time.mul(0.35)), 3), mx_fractal_noise_float(vec3(q.mul(2.2).add(5.1), time.mul(0.35)), 3));
    const folds = mx_fractal_noise_float(vec3(q.add(warp.mul(0.6)).mul(3.2), time.mul(0.6)), 4).mul(0.5).add(0.5);
    const ridge = float(1).sub(mx_noise_float(vec3(q.add(warp.mul(0.4)).mul(5), time.mul(1.1))).abs()).pow(mix(float(30), float(9), veins));
    const colour = mix(tint.mul(folds.mul(0.7).add(0.45)), vec3(1, 1, 0.97), ridge.mul(veins.mul(1.4).add(0.15)).clamp(0, 1));
    material.colorNode = tube(colour.mul(gain), at, 220);
    return material;
  };
  const mint = rgb(0x8dffcf);
  const heroMaterial = screenMaterial(glow.mul(2.4), mint), backMaterial = screenMaterial(glow.mul(0.35).add(0.12), rgb(0x9fd8ff));
  const shellMaterial = new THREE.MeshStandardNodeMaterial({ color: 0x1b1d1f, roughness: 0.45, metalness: 0.05 });
  const hero = new THREE.Group(), back = new THREE.Group();
  hero.add(new THREE.Mesh(crtShell(1.05, 0.86, 0.95), shellMaterial));
  const heroGlass = new THREE.Mesh(crtGlass(1.05, 0.86), heroMaterial); hero.add(heroGlass);
  back.add(new THREE.Mesh(crtShell(0.7, 0.56, 0.65), shellMaterial), new THREE.Mesh(crtGlass(0.7, 0.56), backMaterial));
  hero.position.set(0.75, 0, 0.1); hero.rotation.y = -0.6;
  back.position.set(-0.85, 0, -1.7); back.rotation.y = 0.35;
  world.add(hero, back);
  // Thick black cables snaking in from the bottom left to the sets.
  const random = seededRandom(41), cableMaterial = new THREE.MeshStandardNodeMaterial({ color: 0x050506, roughness: 0.35 });
  const cablePieces: THREE.BufferGeometry[] = [];
  for (let c = 0; c < 7; c++) {
    const end = c % 3 === 2 ? new THREE.Vector3(-0.85, 0.03, -2.1) : new THREE.Vector3(0.75 + 0.3, 0.03, -0.55);
    const points = [new THREE.Vector3(-2.6 + random() * 0.6, 0.03, 2.6 + random() * 0.8)];
    for (let k = 1; k < 4; k++) points.push(new THREE.Vector3(-2 + k * 0.7 + (random() - 0.5) * 1.4, 0.03, 2.2 - k * 0.9 + (random() - 0.5) * 0.8));
    points.push(end);
    cablePieces.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 80, 0.022 + random() * 0.012, 8));
  }
  const cables = mergeGeometries(cablePieces); cablePieces.forEach((piece) => piece.dispose());
  world.add(new THREE.Mesh(cables, cableMaterial));
  scene.add(world);
  // The wet floor shows a mirrored copy of the sets through it; puddles let more of the reflection through.
  const mirror = world.clone(); mirror.scale.y = -1; scene.add(mirror);
  const floorMaterial = new THREE.MeshStandardNodeMaterial({ transparent: true, roughness: 0.3, metalness: 0 });
  const wet = mx_fractal_noise_float(vec3(positionWorld.x.mul(0.9), positionWorld.z.mul(0.9), 2), 4).mul(0.5).add(0.5).smoothstep(0.45, 0.62);
  const grit = mx_fractal_noise_float(vec3(positionWorld.xz.mul(14), 1), 3).mul(0.5).add(0.5);
  floorMaterial.colorNode = mix(rgb(0x2a2c2c), rgb(0x0c0d0d), wet).mul(grit.mul(0.5).add(0.6));
  floorMaterial.roughnessNode = mix(float(0.75), float(0.08), wet);
  floorMaterial.opacityNode = mix(float(0.93), float(0.5), wet);
  // Tiny glints in the wet patches, shimmering with the hats.
  const cell = positionWorld.xz.mul(90), glint = hash2(cell.floor()), twinkle = hash2(cell.floor().add(time.mul(9).floor()));
  const near = exp(positionWorld.xz.sub(vec2(0.3, 0.6)).length().div(1.4).negate());
  floorMaterial.emissiveNode = vec3(0.6, 0.95, 1).mul(glint.greaterThan(0.985).select(float(1), float(0)).mul(wet).mul(near).mul(twinkle.mul(shimmer).add(0.25)).mul(1.5));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), floorMaterial); floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  // Light from the screens.
  const heroLight = new THREE.PointLight(0x8dffcf, 3, 6, 1.6); scene.add(heroLight);
  const backLight = new THREE.PointLight(0x7fb8ff, 0.5, 4, 1.8); scene.add(backLight);
  scene.add(new THREE.AmbientLight(0x101414, 0.4));
  world.updateMatrixWorld(true);
  heroLight.position.copy(heroGlass.localToWorld(new THREE.Vector3(0, 0.43, 0.6)));
  backLight.position.copy(back.localToWorld(new THREE.Vector3(0, 0.3, 0.5)));

  // The spray: stateless streaks, each a flat quad on the floor stretched along its own direction of travel.
  const spray = (count: number, upward: boolean) => {
    const corners = new Float32Array(count * 8), seeds = new Float32Array(count * 16), index = new Uint32Array(count * 6);
    for (let i = 0; i < count; i++) {
      corners.set([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5], i * 8);
      const s = [random(), random(), random(), random()];
      for (let v = 0; v < 4; v++) seeds.set(s, i * 16 + v * 4);
      index.set([0, 1, 2, 0, 2, 3].map((k) => k + i * 4), i * 6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 12), 3));
    geometry.setAttribute('corner', new THREE.Float32BufferAttribute(corners, 2));
    geometry.setAttribute('seed', new THREE.Float32BufferAttribute(seeds, 4));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    const corner = attribute<'vec2'>('corner'), seed = attribute<'vec4'>('seed');
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    const life = fract(clock.mul(seed.x.mul(0.35).add(0.45)).add(seed.y.mul(7.1)));
    let centre: V3, along: V3, across: V3, brightness: F;
    if (!upward) {
      const angle = float(2.55).add(seed.y.sub(0.5).mul(SPILL.fan)).add(seed.z.sub(0.5).mul(0.15));
      const dir = vec3(angle.cos(), 0, angle.sin()), side = vec3(angle.sin().negate(), 0, angle.cos());
      const distance = life.pow(0.7).mul(SPILL.length).mul(seed.z.mul(0.45).add(0.55));
      const lift = life.mul(life.oneMinus()).mul(seed.w).mul(0.35);
      const origin = vec3(...heroGlass.localToWorld(new THREE.Vector3(-0.32, 0.12, 0.05)).toArray());
      centre = origin.add(dir.mul(distance)).add(vec3(0, lift.add(0.006), 0));
      along = dir.mul(seed.w.mul(0.07).add(0.05)); across = side.mul(0.007);
      // Each kick's pulse is a bright front running out along the jet; ripples between give the comb texture.
      const wave = (front: F) => exp(distance.sub(front).abs().div(0.07).negate());
      const pulses = wave(fronts.x).add(wave(fronts.y)).add(wave(fronts.z)).add(wave(fronts.w));
      const comb = sin(distance.mul(48).sub(clock.mul(6))).mul(0.5).add(0.5).pow(3);
      brightness = life.oneMinus().pow(1.4).mul(comb.mul(0.6).add(0.4)).mul(pulses.mul(2.5).add(glow.mul(0.5)).add(0.2));
    } else {
      const origin = vec3(...back.localToWorld(new THREE.Vector3(0.18, 0.15, 0.1)).toArray());
      const spread = vec3(seed.z.sub(0.5).mul(0.3), 0, seed.w.sub(0.5).mul(0.2));
      centre = origin.add(spread.mul(life.add(0.2))).add(vec3(0, life.pow(0.8).mul(seed.y.mul(0.5).add(0.5)).mul(0.9), 0));
      along = vec3(0, seed.w.mul(0.05).add(0.03), 0); across = vec3(0.005, 0, 0);
      brightness = life.oneMinus().mul(life.smoothstep(0, 0.1)).mul(backSpray);
    }
    material.positionNode = centre.add(along.mul(corner.x)).add(across.mul(corner.y));
    const fade = corner.y.abs().mul(2).oneMinus().mul(corner.x.add(0.5).pow(0.6));
    material.colorNode = mix(rgb(0x6fb8ff), vec3(0.9, 0.97, 1), hash(seed.x.mul(91)).mul(0.6)).mul(brightness.mul(fade).mul(1.6));
    const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; mesh.renderOrder = 2;
    return mesh;
  };
  scene.add(spray(tier(budget, 16000, 12000, 6000), false), spray(tier(budget, 2400, 1800, 900), true));

  const hits = createHits({ decay: 0.25, interval: 0.25 });
  const pulseAt = [-9, -9, -9, -9];
  let flow = 0, nextPulse = 0, push = 0, sinceHit = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time; finish.update(frame);
      const step = settleStep(frame), motion = frame.reducedMotion ? 0 : frame.delta, { bass, loudness, bounce } = frame.response;
      hits.update(frame, 0.1);
      sinceHit += step;
      // Kicks send a pulse down the jet; steady loud music with no onsets still pulses about every 1.4 s.
      if (hits.fired || (sinceHit > 1.4 && loudness > 0.3)) {
        pulseAt[nextPulse] = 0; nextPulse = (nextPulse + 1) % SPILL.pulses; sinceHit = 0;
        if (hits.fired) push = 1;
      }
      for (let k = 0; k < SPILL.pulses; k++) if (pulseAt[k] > -9) pulseAt[k] = pulseAt[k] > SPILL.length + 0.5 ? -9 : pulseAt[k] + step * SPILL.pulseSpeed * (1 + bounce * 0.5);
      fronts.value.set(...(pulseAt as [number, number, number, number]));
      flow += motion * (0.5 + loudness * 0.9);
      clock.value = flow;
      glow.value = approach(glow.value, 0.45 + bass * 0.55 + hits.flash * 0.35, step, 0.06);
      veins.value = approach(veins.value, Math.min(1, bass * 1.2 + hits.level * 0.4), step, 0.08);
      shimmer.value = approach(shimmer.value, frame.audio.highs, step, 0.05);
      backSpray.value = approach(backSpray.value, 0.15 + frame.audio.mid * 0.9, step, 0.1);
      heroLight.intensity = 1.5 + glow.value * 3;
      backLight.intensity = 0.3 + backSpray.value * 0.6;
      // Locked camera, 30° down, a slow handheld drift and a slight push on hits.
      push *= Math.exp(-step / 0.35);
      const drift = frame.reducedMotion ? 0 : frame.time, nudge = frame.reducedMotion ? 0 : push * 0.18 + bass * 0.05;
      camera.position.set(-0.2 + Math.sin(drift * 0.31) * 0.05, 2.25 + Math.sin(drift * 0.23) * 0.03 - nudge * 0.4, 4.3 - nudge);
      camera.lookAt(0.05, 0.35, -0.1);
    },
    filter: (input) => finish.filter(input),
    dispose: () => disposeScene(scene),
  };
}

// ---------------------------------------------------------------- TV Wall

export interface WallTv { x: number; y: number; w: number; h: number; tilt: number; z: number; big: boolean }

/**
 * Lays out the stack: three big sets on the floor and an irregular block of 7 columns × 4 rows above them,
 * with mixed sizes, small tilts, a few gaps and slight depth offsets, so it never reads as a clean grid.
 */
export function tvWallLayout(seed = 3): WallTv[] {
  const random = seededRandom(seed), tvs: WallTv[] = [];
  for (let i = 0; i < 3; i++) tvs.push({ x: (i - 1) * 1.75, y: 0, w: 1.6, h: 1.2, tilt: (random() - 0.5) * 0.03, z: (random() - 0.5) * 0.15, big: true });
  const columns = 7, widths = Array.from({ length: columns }, () => 0.82 + random() * 0.28), total = widths.reduce((a, b) => a + b, 0) + (columns - 1) * 0.06;
  let x = -total / 2;
  for (let c = 0; c < columns; c++) {
    let y = 1.27;
    for (let r = 0; r < 4; r++) {
      const h = 0.62 + random() * 0.24, w = widths[c] * (0.86 + random() * 0.14);
      // A few gaps toward the top corners keep the silhouette ragged.
      if (!(r === 3 && (c === 0 || c === columns - 1) && random() < 0.7)) {
        tvs.push({ x: x + widths[c] / 2 + (random() - 0.5) * 0.05, y, w, h, tilt: random() < 0.3 ? (random() - 0.5) * 0.1 : 0, z: (random() - 0.5) * 0.2, big: false });
      }
      y += h + 0.04;
    }
    x += widths[c] + 0.06;
  }
  return tvs;
}

/** Screen colours: the warm family the sequencer lights on kicks, and the cool family a snare adds. */
export const TV_WARM = [0xff7a1e, 0xff4a1a, 0xffa828, 0xb02a1a] as const;
export const TV_COOL = [0xd8d4d0, 0xb8a0e8, 0xe8e0e0] as const;

/**
 * TV Wall (wave 5, clip 2): a red room with a stack of about thirty CRTs. Each kick steps a sequencer that
 * lights 6–12 screens in flat orange, red and amber blocks with VHS banding for half a second or so; a
 * snare adds a cool grey or lilac layer; the three big sets at the bottom take turns, the lit one moving
 * left, right and back. A few grey-white anchors stay on even in silence.
 */
export function createTvWallMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).fov = 52;
  scene.background = new THREE.Color(0x070101);
  scene.fog = new THREE.Fog(0x1a0303, 7, 22);
  const finish = createCinematic({ grain: 0.06, halation: 0.3, vignette: 0.55, soften: 0.12, aberration: 0.003, shadows: [0.006, 0.001, 0.001] });
  const time = uniform(0), wash = uniform(0.3);
  const layout = tvWallLayout(), count = layout.length;
  // Per-screen state: rgb is the lit colour times its level; the shader reads it by screen index.
  const stateData = new Float32Array(count * 4), stateTexture = new THREE.DataTexture(stateData, count, 1, THREE.RGBAFormat, THREE.FloatType);
  stateTexture.minFilter = stateTexture.magFilter = THREE.NearestFilter; stateTexture.needsUpdate = true;
  const shells: THREE.BufferGeometry[] = [], glasses: THREE.BufferGeometry[] = [];
  const place = (geometry: THREE.BufferGeometry, tv: WallTv) => geometry.rotateZ(tv.tilt).translate(tv.x, tv.y, tv.z);
  layout.forEach((tv, i) => {
    shells.push(place(crtShell(tv.w, tv.h, Math.min(tv.w, tv.h) * 1.1), tv));
    const glass = place(crtGlass(tv.w, tv.h), tv);
    glass.setAttribute('screen', new THREE.Float32BufferAttribute(new Float32Array(glass.attributes.position.count).fill(i), 1));
    glasses.push(glass);
  });
  const shellGeometry = mergeGeometries(shells), glassGeometry = mergeGeometries(glasses);
  shells.forEach((g) => g.dispose()); glasses.forEach((g) => g.dispose());
  const group = new THREE.Group();
  group.add(new THREE.Mesh(shellGeometry, new THREE.MeshStandardNodeMaterial({ color: 0x1a1414, roughness: 0.5, metalness: 0.1 })));
  const glassMaterial = new THREE.MeshBasicNodeMaterial({ fog: false });
  const screenId = attribute<'float'>('screen'), state = sampleTexture(stateTexture, vec2(screenId.add(0.5).div(count), 0.5));
  const at = uv(), seedA = hash(screenId.mul(17.3)), seedB = hash(screenId.mul(41.9));
  // A flat colour block covering 60–100% of the glass, a pale horizontal band in the lower half, a slow roll and static.
  const roll = fract(at.y.add(time.mul(seedA.mul(0.12).add(0.03))));
  const block = at.x.smoothstep(seedA.mul(0.25).sub(0.02), seedA.mul(0.25).add(0.04)).mul(at.y.smoothstep(seedB.mul(0.2), seedB.mul(0.2).add(0.06)));
  const band = exp(roll.sub(seedB.mul(0.3).add(0.15)).abs().div(0.06).negate()).mul(0.6);
  const staticNoise = hash2(at.mul(vec2(160, 120)).floor().add(time.mul(30).floor())).mul(0.25).add(0.75);
  const level = state.rgb.dot(vec3(0.33)).clamp(0, 1);
  const lit = mix(state.rgb, state.rgb.add(vec3(0.6, 0.55, 0.5).mul(level)), band).mul(block.mul(0.85).add(0.15)).mul(staticNoise);
  // Dark glass picks up a faint red reflection of the room.
  glassMaterial.colorNode = tube(lit.mul(2.2).add(rgb(0x2a0606).mul(wash.mul(0.4).add(0.1))), at, 180);
  group.add(new THREE.Mesh(glassGeometry, glassMaterial));
  group.position.set(0, 0, 0);
  scene.add(group);
  // Glossy dark floor: the mirrored stack seen through a translucent surface.
  const mirror = group.clone(); mirror.scale.y = -1; scene.add(mirror);
  const floorMaterial = new THREE.MeshStandardNodeMaterial({ transparent: true, roughness: 0.25, color: 0x0a0202 });
  floorMaterial.opacityNode = mx_fractal_noise_float(vec3(positionWorld.xz.mul(0.8), 3), 3).mul(0.1).add(0.82);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), floorMaterial); floor.rotation.x = -Math.PI / 2; scene.add(floor);
  // The room: a deep red back wall with an orange-red wash that grows with the lit screens, and a shelf silhouette upper left.
  const wallMaterial = new THREE.MeshBasicNodeMaterial();
  const wallNoise = mx_fractal_noise_float(vec3(positionWorld.xy.mul(0.25), time.mul(0.05)), 3).mul(0.5).add(0.5);
  const centreGlow = exp(positionWorld.xy.sub(vec2(0, 2.4)).length().div(5).negate());
  wallMaterial.colorNode = mix(rgb(0x1c0303), rgb(0xa8200c), centreGlow.mul(wash).mul(wallNoise.mul(0.5).add(0.6)));
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 16), wallMaterial); wall.position.set(0, 6, -1.4); scene.add(wall);
  const shelfMaterial = new THREE.MeshStandardNodeMaterial({ color: 0x0c0505, roughness: 0.8 });
  const shelfPieces: THREE.BufferGeometry[] = [];
  for (let r = 0; r < 5; r++) shelfPieces.push(new THREE.BoxGeometry(3.2, 0.05, 0.4).translate(-6.6, 3.2 + r * 0.7, -0.9));
  for (let c = 0; c < 4; c++) shelfPieces.push(new THREE.BoxGeometry(0.05, 3, 0.05).translate(-8.1 + c * 1, 4.6, -0.75));
  scene.add(new THREE.Mesh(mergeGeometries(shelfPieces), shelfMaterial)); shelfPieces.forEach((g) => g.dispose());
  scene.add(new THREE.HemisphereLight(0x6a1010, 0x100202, 0.7));
  const screenLight = new THREE.PointLight(0xff5a1a, 4, 14, 1.4); screenLight.position.set(0, 2.6, 3); scene.add(screenLight);
  const rimLight = new THREE.PointLight(0xff2a10, 6, 16, 1.5); rimLight.position.set(-4, 6, 1.5); scene.add(rimLight);

  const random = seededRandom(13), bigIndices = [0, 1, 2];
  const upper = layout.map((_, i) => i).filter((i) => !layout[i].big);
  // Grey-white anchors that stay lit: spread through the block.
  const anchors = new Set([upper[3], upper[12], upper[20]].filter((i) => i !== undefined));
  const screens = layout.map((_, i) => ({ colour: new THREE.Color(anchors.has(i) ? TV_COOL[0] : TV_WARM[0]), level: 0, until: anchors.has(i) ? Infinity : 0 }));
  const hits = createHits({ decay: 0.2, interval: 0.2 });
  let bigLit = 0, bigDir = 1, sinceStep = 0, push = 0;
  const light = (i: number, palette: readonly number[], seconds: number) => { screens[i].colour.setHex(palette[Math.floor(random() * palette.length)]); screens[i].until = time.value + seconds; };
  const advance = (bass: number, snare: boolean) => {
    const free = upper.filter((i) => !anchors.has(i));
    if (snare) {
      for (let k = 0, n = 2 + Math.floor(random() * 3); k < n; k++) light(free[Math.floor(random() * free.length)], TV_COOL.slice(1), 0.4 + random() * 0.5);
    } else {
      // A step mask: 6–12 warm screens on, each for 0.4–1.0 s.
      for (let k = 0, n = 6 + Math.floor(random() * 7); k < n; k++) light(free[Math.floor(random() * free.length)], TV_WARM, 0.4 + random() * 0.6);
    }
    if (bass > 0.3 || !snare) { bigLit += bigDir; if (bigLit === 2 || bigLit === 0) bigDir = -bigDir; }
    sinceStep = 0;
  };
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time; finish.update(frame);
      const step = settleStep(frame), { bass, loudness } = frame.response;
      hits.update(frame, 0.1);
      sinceStep += step;
      if (hits.fired) { advance(bass, frame.audio.highs > frame.audio.bass + 0.15); push = 1; }
      // Loud passages with no onsets keep stepping at about 2.5 steps a second.
      else if (loudness > 0.3 && sinceStep > 0.4) advance(bass, false);
      const peak = frame.reducedFlash ? 0.7 : 1, rise = frame.reducedFlash ? 0.12 : 0.04;
      let litCount = 0;
      screens.forEach((screen, i) => {
        const big = layout[i].big;
        const on = big ? i === bigIndices[bigLit] && loudness > 0.05 : screen.until > frame.time;
        if (big) screen.colour.setHex(TV_WARM[2]);
        const target = on ? (anchors.has(i) ? 0.45 : peak) : 0;
        screen.level = approach(screen.level, target, step, target > screen.level ? rise : 0.15);
        litCount += screen.level;
        stateData.set([screen.colour.r * screen.level, screen.colour.g * screen.level, screen.colour.b * screen.level, 1], i * 4);
      });
      stateTexture.needsUpdate = true;
      wash.value = approach(wash.value, 0.15 + loudness * 0.4 + litCount / count, step, 0.12);
      screenLight.intensity = 1 + litCount * 0.6;
      // Locked, slightly low camera drifting ±1.5% sideways, nudging in on hits.
      push *= Math.exp(-step / 0.3);
      const drift = frame.reducedMotion ? 0 : frame.time, nudge = frame.reducedMotion ? 0 : push * 0.15 + bass * 0.08;
      camera.position.set(Math.sin(drift * 0.17) * 0.12, 1.5, 8.6 - nudge);
      camera.lookAt(0, 2.25, 0);
    },
    filter: (input) => finish.filter(input),
    dispose() { disposeScene(scene); stateTexture.dispose(); },
  };
}
