import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { float, fract, mix, min, positionLocal, sin, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { hash2 } from './shaderModes';
import { GLYPHS, glyphAtlas } from './retroModes';
import { createHits, linearRgb, variantSequence } from './hitPulse';
import { drive } from './waveSixShared';
import { seededRandom } from '../rendering/diagnostics';

type V3 = Node<'vec3'>;

/** Colour ramps, [shadow, body, highlight]: white-grey, red with white highlights, blue, and red/white mixed per glyph. */
export const BLOOM_PALETTES: readonly (readonly [number, number, number])[] = [
  [0x2a2a30, 0x9a9aa4, 0xffffff], [0x3a0206, 0xd8141e, 0xffe0d8], [0x020a3a, 0x2a6aff, 0xd8ecff], [0x3a0206, 0xd8141e, 0xffffff],
];
/** Rosette layers, inside out: petal count, length, how far open (radians from upright) and ruffle. */
export const PETAL_LAYERS = [
  { count: 6, length: 0.7, open: 0.35, ruffle: 0.06 }, { count: 7, length: 0.95, open: 0.65, ruffle: 0.09 },
  { count: 8, length: 1.2, open: 0.95, ruffle: 0.12 }, { count: 9, length: 1.45, open: 1.2, ruffle: 0.14 }, { count: 10, length: 1.6, open: 1.42, ruffle: 0.16 },
] as const;
const ROWS = 104;

/** One ruffled petal: tapered outline, cupped across, curling back toward the tip, with a wavy edge. */
export function petalGeometry(length: number, ruffle: number, seed: number) {
  const geometry = new THREE.PlaneGeometry(1, 1, 14, 20), p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) * 2, v = p.getY(i) + 0.5;
    const width = (0.12 + 0.9 * Math.pow(Math.sin(Math.PI * Math.min(v, 0.97) * 0.85), 0.7)) * length * 0.82;
    const wave = Math.sin(u * 7 + seed * 5) * ruffle * v * v + Math.sin(u * 15 + seed * 9) * ruffle * 0.35 * v;
    p.setXYZ(i, u * width * 0.5, v * length, u * u * 0.18 * length - v * v * 0.35 * length + wave);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Glyph Bloom (wave 6, #11): one big ruffled flower and its dark leaves on black, drawn entirely from tiny glyphs,
 * so it looks woven from text. The flower is lit and rendered normally, then a glyph pass reads each small cell's
 * brightness and draws the matching glyph in the section's colours. Kicks swap the palette and flutter the petals,
 * bass opens the bloom, hats make the glyphs shimmer, loudness thickens them, and strong hits scatter the glyphs
 * outward before they settle back.
 */
export function createGlyphBloomMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  const perspective = camera as THREE.PerspectiveCamera;
  perspective.fov = 38;
  scene.background = new THREE.Color(0x000000);
  const random = seededRandom(1111);
  const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(-2, 4, 3);
  const rim = new THREE.DirectionalLight(0xffffff, 0.9); rim.position.set(3, 1, -3);
  scene.add(key, rim, new THREE.AmbientLight(0xffffff, 0.04));
  // Materials tag themselves by colour ratio (lighting is white, so green/red survives): petals white, stamens
  // half green, leaves no green.
  const petalMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, side: THREE.DoubleSide });
  // Fine veins running out along each petal, darker toward the heart.
  const veins = sin(positionLocal.x.mul(90).add(sin(positionLocal.y.mul(9)).mul(2))).mul(0.12).add(0.88);
  petalMaterial.colorNode = vec3(1).mul(veins).mul(positionLocal.y.smoothstep(0, 0.6).mul(0.55).add(0.45));
  const leafMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.7, side: THREE.DoubleSide, color: new THREE.Color(0.5, 0, 0.5) });
  const stamenMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.4, color: new THREE.Color(1, 0.5, 1) });
  const flower = new THREE.Group(); scene.add(flower);
  const petals: { mesh: THREE.Mesh; open: number; layer: number; phase: number }[] = [];
  PETAL_LAYERS.forEach((layer, l) => {
    for (let k = 0; k < layer.count; k++) {
      const pivot = new THREE.Group(); pivot.rotation.y = (k / layer.count) * Math.PI * 2 + l * 0.4 + random() * 0.2;
      const mesh = new THREE.Mesh(petalGeometry(layer.length * (0.9 + random() * 0.2), layer.ruffle, random() * 10), petalMaterial);
      mesh.position.z = 0.04 * l;
      pivot.add(mesh); flower.add(pivot);
      petals.push({ mesh, open: layer.open + (random() - 0.5) * 0.15, layer: l, phase: random() * Math.PI * 2 });
    }
  });
  // Stamens: a tuft of short stalks with heads in the middle.
  for (let k = 0; k < 26; k++) {
    const a = random() * Math.PI * 2, r = random() * 0.12, h = 0.25 + random() * 0.2;
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, h, 5), stamenMaterial);
    stalk.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); stalk.rotation.set(Math.sin(a) * r * 3, 0, -Math.cos(a) * r * 3); flower.add(stalk);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), stamenMaterial); head.position.set(Math.cos(a) * r * 1.6, h, Math.sin(a) * r * 1.6); flower.add(head);
  }
  // Leaves behind and below the bloom, drawn the same way in dim grey.
  const leaves = new THREE.Group(); scene.add(leaves);
  for (let k = 0; k < 5; k++) {
    const leaf = new THREE.Mesh(petalGeometry(2.4 + random() * 0.8, 0.05, random() * 10), leafMaterial);
    // Fanned out behind the bloom, lower left to lower right, pointing away from the camera.
    leaf.rotation.set(0, 0, Math.PI * (0.55 + k * 0.22)); leaf.rotateX(-0.5);
    leaf.position.set(0, -0.15, -0.6); leaves.add(leaf);
  }
  // Seen three-quarters from the side, as in the clip, so the petal silhouettes read.
  flower.rotation.set(0.55, 0, -0.35); flower.position.set(0.2, -0.3, 0);

  // The glyph pass.
  const atlas = glyphAtlas(), aspect = uniform(16 / 9), time = uniform(0), rows = uniform(ROWS), scatter = uniform(0), shimmer = uniform(0), threshold = uniform(0.06);
  const shadow = uniform(new THREE.Color()), body = uniform(new THREE.Color()), highlight = uniform(new THREE.Color()), mixed = uniform(0);
  const filter = (input: THREE.TextureNode) => {
    const res = vec2(rows.mul(aspect).mul(1.4), rows), grid = uv().mul(res), cell = grid.floor(), inCell = fract(grid);
    // Strong hits scatter each glyph outward from the bloom's heart by its own amount, then they settle.
    const fromCentre = cell.add(0.5).div(res).sub(vec2(0.5, 0.52)).mul(vec2(aspect, 1));
    const push = fromCentre.normalize().mul(hash2(cell).mul(0.7).add(0.3)).add(vec2(hash2(cell.add(3.3)).sub(0.5), hash2(cell.add(8.1)).sub(0.5)).mul(0.6));
    const source = cell.add(0.5).div(res).sub(push.mul(scatter).mul(vec2(aspect.reciprocal(), 1)).mul(0.25));
    const sample = input.sample(source.clamp(0, 1)).rgb;
    const level = sample.r.max(sample.b), tag = sample.g.div(level.max(1e-3));
    const shown = level.sub(threshold).max(0).div(threshold.oneMinus()).pow(0.75).clamp(0, 0.999);
    // Hats flip each cell's glyph by a step or two.
    const flick = hash2(cell.add(time.mul(12).floor())).mul(shimmer).mul(3).floor();
    const glyph = shown.mul(GLYPHS.length - 1).floor().add(shown.greaterThan(0).select(float(1), float(0))).add(flick).min(GLYPHS.length - 1);
    const pixel = inCell.mul(vec2(6, 8)).floor();
    const inside = pixel.x.lessThan(5).and(pixel.y.lessThan(7)).select(float(1), float(0));
    const lit = texture(atlas, vec2(glyph.mul(5).add(min(pixel.x, float(4))).add(0.5).div(GLYPHS.length * 5), min(pixel.y, float(6)).add(0.5).div(7))).x.mul(inside);
    // Colour: the palette's ramp on petals (half the glyphs white in the mixed palette), dim grey on leaves, warm on stamens.
    const whiteGlyph = hash2(cell.add(5.5)).lessThan(mixed);
    const ramp: V3 = mix(mix(shadow, body, shown.smoothstep(0, 0.55)), highlight, shown.smoothstep(0.6, 0.98));
    const petalColour = whiteGlyph.select(mix(vec3(0.35), vec3(1.2), shown), ramp);
    const colour = tag.lessThan(0.25).select(vec3(0.16, 0.16, 0.18).mul(shown.mul(1.5).add(0.3)), tag.lessThan(0.75).select(vec3(1.3, 0.85, 0.35).mul(shown.add(0.4)), petalColour));
    return vec4(colour.mul(lit).mul(1.5), 1);
  };

  const hits = createHits({ decay: 0.25, interval: 0.3 }), palettes = variantSequence(BLOOM_PALETTES.length, 21);
  const setPalette = (index: number) => {
    const [a, b, c] = BLOOM_PALETTES[index];
    shadow.value.setRGB(...linearRgb(a)); body.value.setRGB(...linearRgb(b)); highlight.value.setRGB(...linearRgb(c)); mixed.value = index === 3 ? 0.4 : 0;
  };
  setPalette(0);
  let orbit = 0, flutter = 0, scatterLevel = 0, opening = 0, push = 0;
  return {
    scene, camera, filter,
    update(frame) {
      resizeCamera(perspective, frame.aspect);
      aspect.value = frame.aspect; time.value = frame.time;
      const step = settleStep(frame), motion = frame.reducedMotion ? 0 : frame.delta, { bass, loudness, impact } = frame.response;
      hits.update(frame, 0.1);
      if (hits.fired) {
        setPalette(palettes.next()); flutter = 1;
        if (impact > 0.8) scatterLevel = frame.reducedFlash ? 0.5 : 1;
      }
      flutter = Math.max(0, flutter - step * 2.2);
      scatterLevel = Math.max(0, scatterLevel - step * 1.6);
      scatter.value = scatterLevel * scatterLevel;
      opening = approach(opening, bass * 0.22 + drive(frame) * 0.08, step, 0.25);
      for (const petal of petals) {
        const sway = Math.sin(frame.time * 2.3 + petal.phase) * 0.03 + Math.sin(frame.time * 9 + petal.phase) * flutter * 0.14 * (1 + petal.layer * 0.2);
        petal.mesh.rotation.x = -(petal.open + opening * (0.5 + petal.layer * 0.25) + sway);
      }
      shimmer.value = approach(shimmer.value, Math.max(0, frame.audio.highs - 0.25) * 1.2, step, 0.05);
      threshold.value = approach(threshold.value, 0.09 - loudness * 0.06, step, 0.2);
      // A slow orbit of about ±20° and a gentle push-in that breathes with the music.
      orbit += motion * (0.12 + drive(frame) * 0.15);
      push = approach(push, loudness, step, 1.5);
      const yaw = Math.sin(orbit) * 0.35, distance = 5.4 - push * 0.45;
      perspective.position.set(Math.sin(yaw) * distance, 0.9 + Math.sin(orbit * 0.7) * 0.25, Math.cos(yaw) * distance);
      perspective.lookAt(0, 0.2, 0);
      flower.rotation.z = -0.35 + Math.sin(frame.time * 0.3) * 0.08;
    },
    dispose() { disposeScene(scene); atlas.dispose(); },
  };
}
