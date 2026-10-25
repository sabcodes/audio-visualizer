import * as THREE from 'three/webgpu';
import { atan, attribute, cos, exp, float, instanceIndex, max, mix, positionLocal, sin, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import type { QualityBudget } from '../rendering/quality';
import { settleStep, disposeScene, approach } from './shared';
import { TempoTracker, createGlowPoints, createParticles, loadTexture } from './figures';
import { createHand, handPlacement, type HandPose } from './handModel';
import { createCinematic } from './cinematic';
import { createHits, linearRgb, variantSequence } from './hitPulse';
import { seededRandom } from '../rendering/diagnostics';
import sparkUrl from '../assets/fx/spark.png?url';
import emberUrl from '../assets/fx/ember.png?url';

/** Element kinds: 0 stem, 1–3 leaves (pointed, round, serrated), 4–8 flowers (five-petal, daisy, star lily, tulip, four-petal). */
export const ELEMENT_KINDS = 9;
/** The shapes a growth can take; each cycle picks a different one. */
export const GROWTH_FORMS = ['bush', 'cascade', 'spiral', 'crown', 'tall'] as const;
export type GrowthForm = (typeof GROWTH_FORMS)[number];

export interface GrowthElement { x: number; y: number; at: number; kind: number; size: number; turn: number; hue: number }

/**
 * Grows one plant from the fingertip as branching stems: leaves alternate along each stem, side shoots split
 * off, and flowers open at the tips and some nodes. `at` (0–1) is when each element appears as the growth
 * front travels outward. Positions are relative to the fingertip, in frame-height units.
 */
export function growForm(form: GrowthForm, seed: number, limit: number) {
  const random = seededRandom(seed), out: GrowthElement[] = [];
  const shape = {
    bush: { trunks: 5, length: 0.2, bend: 0.6, depth: 3, spread: 1.6, flowers: 0.35, aim: 0.9 },
    cascade: { trunks: 3, length: 0.42, bend: -2.4, depth: 2, spread: 0.7, flowers: 0.25, aim: 1.1 },
    spiral: { trunks: 2, length: 0.5, bend: 4.2, depth: 2, spread: 0.9, flowers: 0.2, aim: 0.7 },
    crown: { trunks: 9, length: 0.14, bend: 0.4, depth: 2, spread: Math.PI * 2, flowers: 0.6, aim: 1.2 },
    tall: { trunks: 1, length: 0.6, bend: 0.5, depth: 3, spread: 0.3, flowers: 0.3, aim: 1.2 },
  }[form];
  const flowerKind = () => 4 + Math.floor(random() * 5);
  const branch = (x: number, y: number, angle: number, length: number, depth: number, start: number) => {
    const steps = Math.max(4, Math.round(length / 0.018)), bend = shape.bend * (0.6 + random() * 0.8) * (random() < 0.5 ? 1 : -1) * (form === 'cascade' ? -1 : 1);
    let side = random() < 0.5 ? 1 : -1;
    for (let s = 0; s < steps && out.length < limit; s++) {
      const t = start + (s / steps) * (1 - start) * 0.6;
      angle += bend * (length / steps) * (form === 'cascade' ? 1 + s / steps : 1);
      const dx = Math.cos(angle) * length / steps, dy = Math.sin(angle) * length / steps;
      out.push({ x: x + dx / 2, y: y + dy / 2, at: t, kind: 0, size: length / steps * 1.4, turn: angle - Math.PI / 2, hue: 0 });
      x += dx; y += dy;
      if (s % 2 === 1) {
        side = -side;
        out.push({ x, y, at: t + 0.03, kind: 1 + Math.floor(random() * 3), size: 0.022 + random() * 0.018, turn: angle + side * (0.8 + random() * 0.5) - Math.PI / 2, hue: random() });
      }
      if (depth > 1 && s > 1 && random() < 0.16) branch(x, y, angle + (random() < 0.5 ? 1 : -1) * (0.5 + random() * 0.5), length * (0.45 + random() * 0.25), depth - 1, t);
      if (random() < shape.flowers * 0.12) out.push({ x, y, at: t + 0.05, kind: flowerKind(), size: 0.022 + random() * 0.015, turn: random() * 6.3, hue: random() });
    }
    // A flower (sometimes a small cluster) opens at the tip.
    const cluster = random() < shape.flowers ? 3 : 1;
    for (let c = 0; c < cluster && out.length < limit; c++) {
      out.push({ x: x + (random() - 0.5) * 0.03 * (c ? 1 : 0), y: y + (random() - 0.5) * 0.03 * (c ? 1 : 0), at: Math.min(1, start + 0.62 + c * 0.04), kind: flowerKind(), size: (0.03 + random() * 0.025) * (c ? 0.7 : 1), turn: random() * 6.3, hue: random() });
    }
  };
  for (let k = 0; k < shape.trunks; k++) {
    const angle = shape.aim + (shape.trunks > 1 ? (k / (shape.trunks - 1) - 0.5) * shape.spread : 0) + (random() - 0.5) * 0.3;
    branch(0, 0, angle, shape.length * (0.7 + random() * 0.6), shape.depth, random() * 0.15);
  }
  return out;
}

/** Bloom Touch flower palettes (petal, centre), picked by an element's hue. */
const PETALS = [0xffc83a, 0xff5a8a, 0xffffff, 0xff8a5a, 0xb07aff, 0x7ac8ff].map((hex) => linearRgb(hex));

export function createBloomTouchMode(budget: QualityBudget): VisualMode {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -5, 5);
  const capacity = budget.particleScale >= 2 ? 1400 : budget.particleScale >= 1 ? 900 : 450;
  const aspect = uniform(1), time = uniform(0), rimGlow = uniform(1);
  const finish = createCinematic({ grain: 0.035, halation: 0.35, vignette: 0.5, soften: 0.08, shadows: [0.004, 0.003, 0.003] });
  scene.background = new THREE.Color(0x020304);
  // The hand: raymarched, cel-shaded in three skin tones, with a red rim light and a dark outline.
  const hand = createHand();
  hand.blend.value = 0.012;
  const handMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false });
  const p = uv().sub(0.5).mul(vec2(aspect, 1));
  const traced = hand.trace(p), n = traced.normal;
  const light = vec3(0.55, 0.45, 0.7).normalize(), ndl = n.dot(light);
  const skinShadow = vec3(...linearRgb(0xc97a68)), skin = vec3(...linearRgb(0xe8a090)), skinLight = vec3(...linearRgb(0xf5c2ae));
  const tone = mix(mix(skinShadow, skin, ndl.smoothstep(0.1, 0.16)), skinLight, ndl.smoothstep(0.82, 0.87)).mul(0.72);
  const creased = mix(tone, skinShadow.mul(0.8), traced.occlusion.oneMinus().mul(0.7));
  const rim = n.z.oneMinus().pow(2.5).mul(n.x.smoothstep(0.3, -0.6)).mul(rimGlow);
  const inkEdge = n.z.smoothstep(0.12, 0.3);
  const body = mix(vec3(0.16, 0.06, 0.05), creased.add(vec3(1, 0.2, 0.15).mul(rim.mul(1.6))), inkEdge);
  // Outside the hand: a brown ink outline where rays graze it, then a soft red glow.
  const outline = traced.closest.smoothstep(0.0035, 0.002).mul(traced.hit.oneMinus());
  const halo = exp(traced.closest.div(0.03).negate()).mul(traced.hit.oneMinus()).mul(rimGlow).mul(0.35);
  const handColour = mix(mix(vec3(1, 0.24, 0.18).mul(halo), vec3(0.12, 0.05, 0.04), outline), body, traced.hit);
  handMaterial.colorNode = handColour;
  handMaterial.opacityNode = max(traced.hit, max(outline, halo));
  const handQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), handMaterial); handQuad.renderOrder = 1; handQuad.frustumCulled = false;
  // Plant elements: stems, three leaf shapes and five flower shapes, drawn as instanced cards.
  const geometry = new THREE.PlaneGeometry(1, 1);
  const kinds = new Float32Array(capacity), hues = new Float32Array(capacity);
  const kindAttribute = new THREE.InstancedBufferAttribute(kinds, 1), hueAttribute = new THREE.InstancedBufferAttribute(hues, 1);
  kindAttribute.setUsage(THREE.DynamicDrawUsage); hueAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('kind', kindAttribute); geometry.setAttribute('hue', hueAttribute);
  const kind = attribute<'float'>('kind'), hue = attribute<'float'>('hue');
  const q = uv().sub(0.5).mul(2), r = q.length(), theta = atan(q.y, q.x);
  const is = (k: number) => kind.sub(k).abs().lessThan(0.5);
  // Signed outlines (negative inside) for each kind.
  const stem = max(q.x.abs().sub(0.22), q.y.abs().sub(1));
  const pointed = q.x.abs().mul(1.9).add(q.y.mul(q.y)).sub(1);
  const round = q.mul(vec2(1.3, 1)).length().sub(0.95);
  const serrated = pointed.add(sin(q.y.mul(18)).mul(0.08));
  const fivePetal = r.sub(cos(theta.mul(5)).mul(0.22).add(0.72));
  const daisy = r.sub(cos(theta.mul(12)).abs().pow(0.5).mul(0.55).add(0.3));
  const star = r.sub(cos(theta.mul(3)).abs().pow(3).mul(0.65).add(0.3));
  const tulip = max(q.mul(vec2(1.25, 1)).length().sub(0.85), q.y.sub(cos(q.x.mul(9.4)).mul(0.12).add(0.65)));
  const fourPetal = r.sub(cos(theta.mul(4)).mul(0.25).add(0.65));
  const shape = is(0).select(stem, is(1).select(pointed, is(2).select(round, is(3).select(serrated, is(4).select(fivePetal, is(5).select(daisy, is(6).select(star, is(7).select(tulip, fourPetal))))))));
  const leafy = kind.lessThan(3.5);
  const lit = q.x.add(q.y.mul(0.5)).smoothstep(-0.7, 0.7);
  const leafColour = mix(vec3(...linearRgb(0x1f8a3a)), vec3(...linearRgb(0x8ae04a)), lit.mul(hue.mul(0.4).add(0.6))).mul(q.x.abs().smoothstep(0, 0.07).mul(0.25).add(0.75));
  const stemColour = vec3(...linearRgb(0x2a7a2a));
  // Petal colour from the hue; a contrasting centre; darker toward the base of each petal.
  let petal: THREE.Node<'vec3'> = vec3(...PETALS[0]);
  PETALS.forEach((rgb, i) => { if (i) petal = hue.greaterThan(i / PETALS.length).select(vec3(...rgb), petal); });
  const centre = r.smoothstep(0.24, 0.16);
  const flowerColour = mix(petal.mul(r.smoothstep(0.1, 0.7).mul(0.45).add(0.6)), vec3(1, 0.78, 0.25), centre);
  const glowEdge = shape.smoothstep(-0.2, 0).mul(shape.lessThan(0).select(float(1), float(0)));
  const colour = is(0).select(stemColour, leafy.select(leafColour, flowerColour));
  const plantMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false });
  plantMaterial.colorNode = colour.mul(1.15).add(mix(vec3(0.6, 1, 0.4), petal, leafy.select(float(0), float(1))).mul(glowEdge.mul(0.7)));
  plantMaterial.opacityNode = shape.lessThan(0).select(float(1), exp(shape.mul(-12)).mul(0.22));
  plantMaterial.positionNode = positionLocal.add(vec3(sin(time.mul(1.6).add(instanceIndex.toFloat())).mul(0.01), 0, 0));
  const plant = new THREE.InstancedMesh(geometry, plantMaterial, capacity); plant.frustumCulled = false; plant.renderOrder = 2;
  const fireflies = createGlowPoints(loadTexture(emberUrl), 61); fireflies.object.renderOrder = 3;
  const sparks = createParticles(loadTexture(sparkUrl), 240, { drag: 1.5 }); sparks.object.renderOrder = 3;
  scene.add(handQuad, plant, fireflies.object, sparks.object);

  const random = seededRandom(5), bugs = Array.from({ length: 60 }, () => ({ x: random() - 0.5, y: random() - 0.5, phase: random() * 10 }));
  const forms = variantSequence(GROWTH_FORMS.length, 12), tempo = new TempoTracker();
  const hits = createHits({ decay: 0.5, interval: 0.5 });
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), axis = new THREE.Vector3(0, 0, 1), position = new THREE.Vector3(), size = new THREE.Vector3();
  const pose: HandPose = { curl: [0, 0.95, 1, 1], thumb: 0.2, spread: 0 };
  let elements: GrowthElement[] = [], cycle = 0, growth = 0, beatAt = -10, seed = 1, burst = false, breathe = 0;
  const regrow = () => {
    elements = growForm(GROWTH_FORMS[forms.next()], seed++, capacity);
    elements.forEach((element, i) => { kinds[i] = element.kind; hues[i] = element.hue; });
    kindAttribute.needsUpdate = hueAttribute.needsUpdate = true;
    growth = 0; burst = false;
  };
  regrow();
  /** Bounce on a beat: a quick pop and a damped wobble, arriving later for elements further along the plant. */
  const bounce = (since: number) => since < 0 ? 0 : Math.sin(Math.min(since * 16, Math.PI)) * Math.exp(-since * 4);
  return {
    scene, camera,
    update(frame) {
      const half = frame.aspect / 2;
      if (camera.right !== half) { camera.left = -half; camera.right = half; camera.updateProjectionMatrix(); }
      aspect.value = frame.aspect; time.value = frame.time; finish.update(frame);
      handQuad.scale.set(frame.aspect, 1, 1);
      const step = settleStep(frame);
      hits.update(frame, 0.6);
      tempo.update(frame.time, frame.audio.onset, frame.delta);
      if (frame.audio.onset) beatAt = frame.time;
      // The hand barely moves: a slow breath, and the fingertip nudges up on each beat.
      breathe += frame.reducedMotion ? 0 : frame.delta;
      const nudge = frame.reducedMotion ? 0 : bounce(frame.time - beatAt) * 0.012;
      const tips = hand.pose(pose, handPlacement(-half + 0.3, -0.5 + Math.sin(breathe * 0.6) * 0.006 + nudge, 0.4, -0.6, 0.1, -0.95));
      const tipX = tips[0].x, tipY = tips[0].y + 0.01;
      // A new plant every ~9 s, in a different form; each hit pushes the growth along and pops a few blossoms.
      cycle += step;
      growth = Math.min(1.2, growth + step / 6 * (1 + frame.response.loudness) + (hits.fired ? 0.05 : 0));
      if (cycle > 9 || (growth >= 1.2 && cycle > 6)) { cycle = 0; regrow(); }
      const fade = growth > 1.05 ? Math.max(0, 1 - (growth - 1.05) / 0.15) : 1;
      if (growth > 1.05 && !burst) {
        burst = true;
        for (let k = 0; k < 120; k++) { const a = random() * Math.PI * 2, v = 0.2 + random() * 0.5; sparks.emit(tipX, tipY + 0.05, 0.1, Math.cos(a) * v, Math.sin(a) * v, 0, 0.6 + random() * 0.6, 0.012, 0.5, 1.6, 0.4); }
      }
      const beat = frame.reducedMotion ? 0 : 1, swell = 1 + frame.response.bass * 0.12;
      for (let i = 0; i < capacity; i++) {
        const element = elements[i];
        if (!element) { plant.setMatrixAt(i, matrix.makeScale(0, 0, 0)); continue; }
        // Elements pop in with an overshoot as the growth front reaches them, then bounce on every beat.
        const age = Math.max(0, Math.min(1, (growth - element.at) / 0.12));
        const pop = age <= 0 ? 0 : 1 + 0.7 * Math.sin(age * Math.PI) * (1 - age) * 2.2;
        const flower = element.kind >= 4, stem = element.kind === 0;
        const jump = bounce(frame.time - beatAt - Math.hypot(element.x, element.y) * 0.8) * beat * (flower ? 0.35 : stem ? 0 : 0.15);
        const s = element.size * Math.min(pop, 1.6) * (1 + jump) * fade * (stem ? 1 : swell);
        position.set(tipX + element.x * (1 + jump * 0.15), tipY + element.y * (1 + jump * 0.15), 0);
        rotation.setFromAxisAngle(axis, element.turn + (flower ? jump * 0.6 : jump * 0.4));
        plant.setMatrixAt(i, matrix.compose(position, rotation, stem ? size.set(element.size * 0.35 * fade, s * 0.5, 1) : size.set(s, flower ? s : s * 1.6, 1)));
      }
      plant.instanceMatrix.needsUpdate = true;
      sparks.update(step);
      rimGlow.value = approach(rimGlow.value, 0.6 + frame.response.loudness * 0.8 + hits.flash * 0.5, step, 0.1);
      const density = 0.2 + frame.response.loudness * 0.8;
      bugs.forEach((bug, i) => {
        const on = i / bugs.length < density, blink = Math.max(0, Math.sin(frame.time * 2 + bug.phase));
        fireflies.set(i, tipX + bug.x * 0.9 + Math.sin(frame.time * 0.3 + bug.phase) * 0.05, tipY + bug.y * 0.7, 0.2, on ? 0.012 : 0, 0.6 * blink, 1.4 * blink, 0.4 * blink, 1);
      });
      // A glow at the fingertip that never quite goes out.
      fireflies.set(60, tipX, tipY, 0.3, 0.05 + frame.response.bass * 0.03 + hits.flash * 0.03, 1.2, 1.6, 0.7, 0.8);
      fireflies.commit();
    },
    filter: (input) => finish.filter(input),
    dispose() { disposeScene(scene); },
  };
}

