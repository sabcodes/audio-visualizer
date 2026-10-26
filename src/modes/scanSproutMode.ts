import * as THREE from 'three/webgpu';
import { attribute, mx_noise_float, positionLocal, uniform, uv, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { createHits } from './hitPulse';
import { drive } from './waveSixShared';
import { PointSet, createPointCloud, plexusGeometry, unfold } from './pointCloud';
import { seededRandom } from '../rendering/diagnostics';
import { presetBudget, type QualityBudget } from '../rendering/quality';

export const SPROUT = { height: 6, leaves: 16, points: 200_000, flares: 10 };

/**
 * A leafy plant grown as points: a wavering stem that rises with growth and broad, drooping, serrated leaves that
 * unfold from the stem in turn (alternating round the stem by the golden angle), over a low tangle of undergrowth.
 * Every point's anchor is where it grows from and its birth is the growth level it appears at.
 */
export function growSprout(count: number, random: () => number) {
  const set = new PointSet(count), { height, leaves } = SPROUT;
  const stemAt = (y: number): [number, number, number] => [Math.sin(y * 0.9) * 0.18, y, Math.cos(y * 0.7) * 0.12];
  // Undergrowth: small leaves at the base, there from the start.
  for (let i = 0; i < count * 0.08; i++) {
    const a = random() * Math.PI * 2, r = Math.sqrt(random()) * 2.2, y = random() * random() * 0.7;
    set.add(Math.cos(a) * r, y, Math.sin(a) * r, 0, 1, 0, [Math.cos(a) * r * 0.6, 0, Math.sin(a) * r * 0.6], random() * 0.05);
  }
  // Stem: grows bottom to top over most of the cycle.
  for (let i = 0; i < count * 0.05; i++) {
    const t = random(), y = t * height, [x, , z] = stemAt(y), a = random() * Math.PI * 2, r = 0.09 * (1 - t * 0.6);
    set.add(x + Math.cos(a) * r, y, z + Math.sin(a) * r, Math.cos(a), 0, Math.sin(a), [x, y - 0.25, z], t * 0.88);
  }
  // Leaves: big low down, smaller near the top, each unfolding from its node once the stem reaches it.
  const perLeaf = Math.floor((count - set.count) / leaves);
  for (let l = 0; l < leaves; l++) {
    const t = (l + 0.6) / leaves, y = t * height * 0.95, base = stemAt(y), birth = t * 0.86 + 0.02;
    const size = 2.5 - t * 1.5, turn = l * 2.39996, droop = 0.35 + random() * 0.2, lift = 0.5 - t * 0.3;
    const dir = new THREE.Vector3(Math.cos(turn), 0, Math.sin(turn)), side = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let k = 0; k < perLeaf; k++) {
      // Points cluster on the midrib and the lateral veins so the leaf reads as a scanned surface with structure.
      const u = Math.pow(random(), 0.85), veinPick = random();
      const outline = Math.pow(Math.sin(Math.PI * Math.min(0.98, u) ** 0.75), 0.9) * 0.85 * (1 + 0.08 * Math.sin(u * 40));
      let v = (random() * 2 - 1) * outline;
      if (veinPick < 0.05) v *= 0.06;
      else if (veinPick < 0.13) { const vein = Math.floor(random() * 6) / 6 + 0.08; v = (random() < 0.5 ? -1 : 1) * (u - vein) * 1.4; if (Math.abs(v) > outline || u < vein) v = 0; }
      const along = u * size, across = v * size;
      const p = new THREE.Vector3(...base).addScaledVector(dir, along).addScaledVector(side, across);
      // Rise, droop toward the tip, and a roll about the midrib so the blade faces up and out rather than lying flat.
      p.y += lift * along - droop * along * along / size + across * 0.45 + Math.abs(v) * size * 0.2 + Math.sin(across * 6) * 0.03;
      set.add(p.x, p.y, p.z, dir.x * 0.3, 1, dir.z * 0.3, base, birth);
    }
  }
  // The rounding remainder goes to the stem.
  while (!set.full) { const t = random(), y = t * height, [x, , z] = stemAt(y); set.add(x, y, z, 0, 1, 0, [x, y - 0.25, z], t * 0.88); }
  return set;
}

/**
 * Scan Sprout (wave 6, #12): a glowing acid-green plant scan on black, growing from a low tangle into a tall
 * leafy stalk over about half a minute, then resetting. Its leaves are fine green particles with white-green hot
 * spots, and plexus lines flicker between nearby points. Kicks step the growth on (a leaf unfolds) and burst the
 * plexus, bass lifts the glow, hats fire sparkle flares, loudness speeds growth and the particle shimmer.
 */
export function createScanSproutMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  const perspective = camera as THREE.PerspectiveCamera;
  perspective.fov = 45;
  scene.background = new THREE.Color(0x000000);
  const random = seededRandom(1212);
  const glow = uniform(1), shimmer = uniform(0), fade = uniform(1), plexusLevel = uniform(0.3);
  const set = growSprout(Math.round(SPROUT.points * budget.particleScale), random);
  const cloud = createPointCloud(set, { span: 0.05 });
  // Acid green, with drifting white-green hot spots and a sparkle per point.
  const hot = mx_noise_float(cloud.nodes.placed.mul(1.3).add(vec3(0, cloud.uniforms.time.mul(0.25), 0))).mul(0.5).add(0.5).smoothstep(0.62, 0.9);
  const twinkle = mx_noise_float(cloud.nodes.placed.mul(25).add(vec3(cloud.uniforms.time.mul(3), 0, 0))).mul(shimmer).add(1);
  const disc = uv().sub(0.5).length().smoothstep(0.5, 0.15);
  cloud.material.colorNode = vec3(0.18, 1, 0.08).add(vec3(0.6, 0.4, 0.6).mul(hot)).mul(hot.mul(2.5).add(0.35)).mul(cloud.nodes.seed.mul(0.6).add(0.4))
    .mul(twinkle).mul(glow).mul(fade).mul(cloud.nodes.shown).mul(cloud.nodes.amount.mul(0.7).add(0.3)).mul(disc).mul(0.2);
  scene.add(cloud.sprite);

  // Plexus: thin additive lines between nearby points, growing with them and flickering.
  const plexus = plexusGeometry(set, Math.round(900 * Math.min(1.5, budget.particleScale)), 0.7, random);
  const lineMaterial = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const grown = unfold(positionLocal, attribute<'vec4'>('anchor'), cloud.uniforms.growth, 0.05);
  lineMaterial.positionNode = grown.position;
  const flick = mx_noise_float(vec3(attribute<'float'>('seed').mul(91), cloud.uniforms.time.mul(2.5), 0)).mul(0.5).add(0.5).smoothstep(0.45, 0.8);
  lineMaterial.colorNode = vec3(0.45, 1, 0.35).mul(flick).mul(plexusLevel).mul(grown.shown).mul(grown.amount).mul(fade).mul(0.16);
  const lines = new THREE.LineSegments(plexus.geometry, lineMaterial); lines.frustumCulled = false; scene.add(lines);

  // Faint stars.
  const stars = new Float32Array(1500 * 3);
  for (let i = 0; i < 1500; i++) { const a = random() * Math.PI * 2, u = random() * 2 - 1, r = 60; stars.set([Math.cos(a) * Math.sqrt(1 - u * u) * r, u * r, Math.sin(a) * Math.sqrt(1 - u * u) * r], i * 3); }
  const starGeometry = new THREE.BufferGeometry(); starGeometry.setAttribute('position', new THREE.BufferAttribute(stars, 3));
  const starMaterial = new THREE.PointsNodeMaterial({ transparent: true, depthWrite: false });
  starMaterial.colorNode = vec3(0.5, 0.6, 0.55).mul(mx_noise_float(positionLocal.mul(0.3).add(vec3(cloud.uniforms.time.mul(0.5), 0, 0))).mul(0.5).add(0.5)).mul(0.5);
  scene.add(new THREE.Points(starGeometry, starMaterial));

  // Sparkle flares: four-point stars that pop on hats at points the plant has already grown.
  const flareMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const q = uv().sub(0.5).abs(), flareLevel = uniform(0);
  const star = q.x.mul(q.y).mul(400).add(q.length().mul(6)).reciprocal().sub(0.12).max(0);
  flareMaterial.colorNode = vec3(0.7, 1, 0.6).mul(star).mul(flareLevel);
  const flares = Array.from({ length: SPROUT.flares }, () => {
    const sprite = new THREE.Sprite(flareMaterial); sprite.geometry = sprite.geometry.clone(); sprite.scale.setScalar(0.9); sprite.visible = false; scene.add(sprite);
    return { sprite, life: 0 };
  });

  const hits = createHits({ decay: 0.3, interval: 0.25 });
  let growth = 0.02, hold = 0, orbit = 0, burst = 0, nextFlare = 0;
  const p = new THREE.Vector3();
  return {
    scene, camera,
    update(frame) {
      resizeCamera(perspective, frame.aspect);
      cloud.uniforms.time.value = frame.time;
      const step = settleStep(frame), motion = frame.reducedMotion ? 0 : frame.delta, { bass, loudness } = frame.response;
      hits.update(frame, 0.1);
      // Growth: steady, faster when loud; each kick steps it on so a leaf unfolds on the beat.
      if (growth < 1) {
        growth += motion * (0.022 + loudness * 0.025) + (hits.fired ? 0.012 * (1 + drive(frame) * 0.5) : 0);
        fade.value = approach(fade.value, 1, step, 0.5);
      } else {
        // Full grown: hold a few seconds, fade out and start again from the undergrowth.
        hold += step;
        if (hold > 5) fade.value = approach(fade.value, 0, step, 0.6);
        if (hold > 8) { growth = 0.02; hold = 0; }
      }
      cloud.uniforms.growth.value = Math.min(1.05, growth);
      if (hits.fired) burst = 1;
      burst = Math.max(0, burst - step * 2);
      plexusLevel.value = 0.3 + burst * (frame.reducedFlash ? 0.5 : 1.2) + loudness * 0.3;
      glow.value = approach(glow.value, 0.7 + bass * 0.9 + hits.flash * 0.3, step, 0.1);
      shimmer.value = approach(shimmer.value, loudness * 0.8, step, 0.2);
      cloud.uniforms.size.value = approach(cloud.uniforms.size.value, 1.6 + bass * 0.8, step, 0.1);
      // Hats: a sparkle flare on a grown point.
      nextFlare -= step;
      if (frame.audio.highs > 0.45 && nextFlare <= 0) {
        const flare = flares.find((f) => f.life <= 0);
        for (let tries = 0; flare && tries < 20; tries++) {
          const i = Math.floor(random() * set.count);
          if (set.anchor[i * 4 + 3] < growth - 0.05) { p.fromArray(set.position, i * 3); flare.sprite.position.copy(p); flare.life = 1; break; }
        }
        nextFlare = frame.reducedFlash ? 0.33 : 0.12;
      }
      for (const flare of flares) { flare.life = Math.max(0, flare.life - step * 3); flare.sprite.visible = flare.life > 0; flare.sprite.scale.setScalar(0.4 + flare.life * 0.9); }
      flareLevel.value = frame.reducedFlash ? 0.5 : 1;
      // A slow orbit; the camera tilts up and backs away as the plant grows.
      orbit += motion * (0.08 + drive(frame) * 0.06);
      const g = Math.min(1, growth), distance = 4.8 + g * 3.6;
      perspective.position.set(Math.sin(orbit) * distance, 2.2 + g * 4.2, Math.cos(orbit) * distance);
      perspective.lookAt(0, 0.6 + g * 2.4, 0);
    },
    dispose: () => disposeScene(scene),
  };
}
