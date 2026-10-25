import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { abs, cos, float, fract, instancedBufferAttribute, mix, mx_fractal_noise_float, mx_noise_float, positionLocal, positionWorld, sin, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { ModeFrame, VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, wrap, bandEnergies, approach, beatGate, createSpectrumTexture, spectrumAxisNode, spectrumBin, settleStep } from './shared';
import { seededRandom } from '../rendering/diagnostics';
import { presetBudget, type QualityBudget } from '../rendering/quality';

type F = Node<'float'>;
/** HSL(h, 1, l) as in THREE.Color.setHSL, for per-fragment hues. */
const hsl = (hue: F, lightness: number) => vec3(hue, hue.add(2 / 3), hue.add(1 / 3)).fract().mul(6).sub(3).abs().sub(1).clamp(0, 1)
  .sub(0.5).mul(1 - Math.abs(lightness * 2 - 1)).add(lightness);

// ---------------------------------------------------------------- Aurora curtains

const CURTAINS = 5;

export function createAuroraMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  camera.position.set(0, 6, 60); camera.lookAt(0, 22, -40);
  const time = uniform(0), hue = uniform(0);
  // Sky: deep gradient on a far backdrop, plus a fixed seeded starfield.
  const sky = new THREE.MeshBasicNodeMaterial({ depthWrite: false });
  sky.colorNode = mix(vec3(0.004, 0.01, 0.03), vec3(0.02, 0.05, 0.11), uv().y.oneMinus().pow(2));
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(900, 500), sky); backdrop.position.set(0, 60, -300); backdrop.renderOrder = -2;
  const random = seededRandom(7), starPositions = new Float32Array(900 * 3);
  for (let i = 0; i < 900; i++) starPositions.set([(random() - 0.5) * 700, 4 + random() * 240, -280], i * 3);
  const starGeometry = new THREE.BufferGeometry(); starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const starMaterial = new THREE.PointsNodeMaterial({ color: 0xaabbdd, transparent: true, opacity: 0.8, depthWrite: false });
  scene.add(backdrop, new THREE.Points(starGeometry, starMaterial));

  const strengths = Array.from({ length: CURTAINS }, () => uniform(0.2));
  const curtains: THREE.Mesh[] = [];
  for (let i = 0; i < CURTAINS; i++) {
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const p = positionLocal, along = uv().x, up = uv().y;
    const sway = sin(p.x.mul(0.035).add(time.mul(0.25).add(i * 1.7))).mul(14)
      .add(mx_noise_float(vec3(p.x.mul(0.02), time.mul(0.12), i * 3.1)).mul(10));
    material.positionNode = vec3(p.x, p.y, p.z.add(sway));
    // Vertical rays: high-frequency noise along the curtain, stretched up its height.
    const rays = mx_fractal_noise_float(vec3(along.mul(38).add(i * 9), up.mul(0.6).sub(time.mul(0.35)), time.mul(0.08)), 3, 2, 0.5).mul(0.5).add(0.5).pow(2.2);
    const base = up.smoothstep(0, 0.08).mul(up.smoothstep(1, 0.25)).mul(along.smoothstep(0, 0.12)).mul(along.smoothstep(1, 0.88));
    const lower = vec3(0.1, 1, 0.45), upper = hsl(hue.add(0.78 + i * 0.03), 0.55);
    const colour = mix(lower, upper, up.smoothstep(0.25, 0.9));
    material.colorNode = colour.mul(rays.mul(strengths[i].mul(3).add(0.35)).mul(base));
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(260, 70, 160, 24), material);
    curtain.position.set((i - 2) * 24, 52 + i * 3, -120 - i * 22); curtain.frustumCulled = false;
    curtains.push(curtain); scene.add(curtain);
    // Lake reflection: a flipped, dimmed copy of the same curtain.
    const reflection = curtain.clone(); reflection.material = material.clone();
    (reflection.material as THREE.MeshBasicNodeMaterial).colorNode = colour.mul(rays.mul(strengths[i].mul(3).add(0.35)).mul(base)).mul(0.28);
    reflection.scale.y = -1; reflection.position.y = -curtain.position.y - 6; scene.add(reflection); curtains.push(reflection);
  }

  // Mountain silhouettes and a dark lake plane that hides the reflection's lower half.
  const ridge = (seed: number, height: number, z: number, shade: number) => {
    const r = seededRandom(seed), shape = new THREE.Shape();
    shape.moveTo(-400, -4);
    for (let x = -400; x <= 400; x += 14) shape.lineTo(x, height * (0.35 + r() * 0.65) * (0.6 + 0.4 * Math.sin(x * 0.012 + seed)));
    shape.lineTo(400, -4);
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(shade, shade * 1.2, shade * 1.6) }));
    mesh.position.set(0, -2, z); return mesh;
  };
  scene.add(ridge(3, 34, -95, 0.012), ridge(11, 22, -60, 0.004));
  const lake = new THREE.MeshBasicNodeMaterial({ transparent: true, opacity: 0.55, depthWrite: false });
  lake.colorNode = vec3(0.004, 0.012, 0.025).add(sin(positionWorld.z.mul(0.8).add(time.mul(1.5))).mul(0.004));
  const water = new THREE.Mesh(new THREE.PlaneGeometry(900, 400), lake); water.rotation.x = -Math.PI / 2; water.position.set(0, -2.5, -100);
  scene.add(water);

  const bands = new Float32Array(CURTAINS), flare = beatGate(0.6);
  let surge = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time * (1 + frame.response.bass * 0.4); hue.value = frame.hue;
      if (flare(frame.time, frame.audio.onset)) surge = 1;
      surge = Math.max(0, surge - settleStep(frame) * 1.6);
      bandEnergies(frame, CURTAINS, bands);
      const lift = frame.reducedFlash ? 0 : surge * 0.5;
      strengths.forEach((strength, i) => { strength.value = approach(strength.value, bands[i] * 1.3 + frame.response.bounce * 0.4 + lift, settleStep(frame), 0.15); });
      camera.position.x = Math.sin(frame.time * 0.05) * 8;
      camera.lookAt(0, 22, -40);
    },
    dispose: () => disposeScene(scene),
  };
}

// ---------------------------------------------------------------- Pulsar ridgeline

const RIDGE_ROWS = 48, RIDGE_POINTS = 140, RIDGE_WIDTH = 70, RIDGE_SPACING = 2.4;

/** Ridge height profile for one row: spectrum mirrored about the centre (bass in the middle) under a soft window. */
export function ridgeProfile(frame: Parameters<typeof spectrumBin>[0] & Pick<ModeFrame, 'response'>, out: Float32Array, jitter: () => number) {
  const n = out.length, bins = frame.audio.spectrum.length, phase = jitter() * Math.PI * 2;
  const response = frame.response.bounce;
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1) * 2 - 1, u = Math.min(1, Math.abs(x) * 1.1);
    const window = Math.exp(-x * x * 5.5);
    const bin = spectrumBin(frame, u, Math.floor(Math.pow(u, 1.6) * (bins - 1)));
    // Smooth per-row ripples instead of per-point noise keep each line a clean ridge.
    const ripple = Math.sin(x * 13 + phase) * 0.6 + Math.sin(x * 31 + phase * 2.3) * 0.35 + 1;
    out[i] = window * (Math.pow((frame.audio.spectrum[bin] || 0) / 255, 1.6) * 16 + ripple * 2.4 + response * 4);
  }
  return out;
}

export function createRidgelineMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  camera.position.set(0, 30, 92); camera.lookAt(0, 6, -26);
  const random = seededRandom(19);
  const rows = Array.from({ length: RIDGE_ROWS }, () => {
    const heights = new Float32Array(RIDGE_POINTS);
    // Fill: a black strip from the baseline up to the ridge hides rows behind it.
    const fillPositions = new Float32Array(RIDGE_POINTS * 2 * 3), fillGeometry = new THREE.BufferGeometry();
    fillGeometry.setAttribute('position', new THREE.BufferAttribute(fillPositions, 3));
    const index: number[] = [];
    for (let i = 0; i < RIDGE_POINTS - 1; i++) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    fillGeometry.setIndex(index);
    const fill = new THREE.Mesh(fillGeometry, new THREE.MeshBasicNodeMaterial({ color: 0x000000, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    const linePositions = new Float32Array(RIDGE_POINTS * 3), lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    const lineMaterial = new THREE.LineBasicNodeMaterial({ color: 0xffffff });
    const line = new THREE.Line(lineGeometry, lineMaterial);
    for (const object of [fill, line]) { object.frustumCulled = false; scene.add(object); }
    for (let i = 0; i < RIDGE_POINTS; i++) {
      const x = (i / (RIDGE_POINTS - 1) - 0.5) * RIDGE_WIDTH;
      fillPositions.set([x, 0, 0, x, 0, 0], i * 6); linePositions.set([x, 0, 0], i * 3);
    }
    return { heights, fillPositions, fillGeometry, linePositions, lineGeometry, lineMaterial, fill, line };
  });
  let newest = 0, scroll = 0, seeded = false;
  const draw = (row: typeof rows[number]) => {
    for (let i = 0; i < RIDGE_POINTS; i++) { row.fillPositions[i * 6 + 4] = row.heights[i]; row.linePositions[i * 3 + 1] = row.heights[i]; }
    row.fillGeometry.attributes.position.needsUpdate = true; row.lineGeometry.attributes.position.needsUpdate = true;
  };
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      // Seed every row on the first frame so a paused clock never shows an empty field.
      if (!seeded) { seeded = true; for (const row of rows) { ridgeProfile(frame, row.heights, random); draw(row); } }
      scroll += frame.delta * (5 + frame.response.bass * 14);
      // Each whole step recycles the oldest row to the front with the current spectrum.
      while (scroll >= 1) {
        scroll -= 1; newest = (newest + 1) % RIDGE_ROWS;
        const row = rows[newest];
        ridgeProfile(frame, row.heights, random);
        if (frame.response.impact > 0.5) for (let i = 0; i < RIDGE_POINTS; i++) row.heights[i] *= 1 + frame.response.impact * 0.25;
        draw(row);
      }
      for (let k = 0; k < RIDGE_ROWS; k++) {
        const row = rows[(newest - k + RIDGE_ROWS) % RIDGE_ROWS], z = 30 - (k + scroll) * RIDGE_SPACING;
        row.fill.position.z = row.line.position.z = z;
        // Oldest rows dim into the distance; the front row picks up the palette.
        const fade = 1 - k / RIDGE_ROWS;
        row.lineMaterial.color.setHSL(wrap(frame.hue + k * 0.004, 0, 1), k < 2 ? 0.8 : 0.15, 0.35 + fade * 0.55);
      }
    },
    dispose: () => disposeScene(scene),
  };
}

// ---------------------------------------------------------------- Synthwave sunset grid

export function createSynthwaveMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  camera.position.set(0, 7, 40); camera.lookAt(0, 9, -100);
  const spectrum = createSpectrumTexture();
  const time = uniform(0), scroll = uniform(0), bass = uniform(0), hue = uniform(0), logMapping = uniform(0), nyquist = uniform(24000);

  const skyMaterial = new THREE.MeshBasicNodeMaterial({ depthWrite: false });
  skyMaterial.colorNode = mix(vec3(0.6, 0.08, 0.35), vec3(0.02, 0.0, 0.08), uv().y.smoothstep(0.35, 1));
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(1400, 600), skyMaterial); sky.position.set(0, 120, -520); sky.renderOrder = -2;

  // Sun: vertical gradient disc with horizontal slats cut through its lower half.
  const sunMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const s = uv().sub(0.5), y = s.y.add(0.5);
  const slat = fract(y.mul(14).sub(time.mul(0.6))).step(y.smoothstep(0.55, 0.0).mul(0.75)).oneMinus();
  const disc = s.length().smoothstep(0.5, 0.485);
  sunMaterial.colorNode = mix(vec3(3.2, 0.25, 0.9), vec3(3.4, 2.4, 0.3), y.smoothstep(0.1, 0.95));
  sunMaterial.opacityNode = disc.mul(y.greaterThan(0.5).select(float(1), slat));
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), sunMaterial); sun.position.set(0, 40, -470); sun.renderOrder = -1;

  // Ground: grid lines in world space that scroll toward the camera, with spectrum mountains either side of the road.
  const groundMaterial = new THREE.MeshBasicNodeMaterial();
  const p = positionLocal, side = abs(p.x);
  const terrain = mx_fractal_noise_float(vec3(p.x.mul(0.035), p.z.sub(scroll).mul(0.035), 0), 3, 2, 0.5).mul(0.5).add(0.5);
  const energy = spectrumAxisNode(spectrum.texture, side.sub(22).div(110).clamp(0, 1), logMapping, nyquist);
  const mask = side.smoothstep(22, 46);
  const height = mask.mul(terrain.mul(28).add(energy.mul(36)).mul(p.z.add(470).div(470).clamp(0.25, 1)));
  groundMaterial.positionNode = vec3(p.x, height, p.z);
  const gx = fract(p.x.div(6)).sub(0.5).abs(), gz = fract(p.z.sub(scroll).div(6)).sub(0.5).abs();
  const line = gx.min(gz).smoothstep(0.035, 0.0);
  const distance = p.z.negate().div(470).clamp(0, 1);
  const neon = hsl(hue.add(0.83), 0.55).mul(bass.mul(1.6).add(1.8));
  groundMaterial.colorNode = mix(vec3(0.03, 0.0, 0.06), neon, line.mul(distance.oneMinus().pow(0.6))).add(vec3(0.5, 0.05, 0.4).mul(distance.pow(3).mul(0.4)));
  const geometry = new THREE.PlaneGeometry(320, 520, 200, 260); geometry.rotateX(-Math.PI / 2); geometry.translate(0, 0, -220);
  const ground = new THREE.Mesh(geometry, groundMaterial); ground.frustumCulled = false;
  scene.add(sky, sun, ground);

  let travelled = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      spectrum.update(frame.audio.spectrum);
      logMapping.value = frame.spectrumMapping === 'log' ? 1 : 0; nyquist.value = frame.sampleRate / 2;
      travelled += frame.delta * (22 + frame.response.bass * 50);
      scroll.value = travelled; time.value = frame.time; hue.value = frame.hue;
      bass.value = frame.reducedMotion ? approach(bass.value, frame.response.bounce, settleStep(frame), 0.4) : frame.response.bounce;
      sun.scale.setScalar(1 + bass.value * 0.12);
      camera.position.y = 7 + Math.sin(frame.time * 0.4) * 0.8;
      camera.rotation.z = Math.sin(frame.time * 0.23) * 0.02;
    },
    dispose() { disposeScene(scene); spectrum.dispose(); },
  };
}

// ---------------------------------------------------------------- FFT galaxy

const GALAXY_ARMS = 4;

export function createGalaxyMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  const count = Math.round(40000 * budget.particleScale);
  const spectrum = createSpectrumTexture();
  const time = uniform(0), bass = uniform(0), hue = uniform(0), wave = uniform(-1), logMapping = uniform(0), nyquist = uniform(24000);
  const random = seededRandom(23), seeds = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    // Radius biased toward the core; arms plus a diffuse halo of off-arm stars.
    const r = Math.pow(random(), 1.8), arm = Math.floor(random() * GALAXY_ARMS), spread = (random() - 0.5) * (random() < 0.15 ? 2.4 : 0.55);
    seeds.set([r, arm * Math.PI * 2 / GALAXY_ARMS + spread * (1.1 - r), (random() - 0.5) * (1 - r) * 0.18, random()], i * 4);
  }
  const seed = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(seeds, 4), 'vec4');
  const r = seed.x, energy = spectrumAxisNode(spectrum.texture, r, logMapping, nyquist);
  // Differential rotation: inner stars lap the outer ones.
  const angle = seed.y.add(r.mul(5.5)).add(time.mul(0.12).div(r.add(0.15)));
  const radius = r.mul(70).mul(energy.mul(0.18).add(1)).mul(float(1).add(bass.mul(0.12).mul(r.oneMinus())));
  const waveHit = r.sub(wave).abs().smoothstep(0.06, 0).mul(wave.greaterThanEqual(0).select(float(1), float(0)));
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  material.positionNode = vec3(cos(angle).mul(radius), seed.z.mul(40).add(energy.mul(seed.w.sub(0.5)).mul(6)), sin(angle).mul(radius));
  const core = vec3(1.6, 1.15, 0.7), outer = hsl(hue.add(seed.w.mul(0.12)), 0.6);
  const brightness = energy.mul(1.6).add(0.35).add(waveHit.mul(2.2)).add(r.smoothstep(0.12, 0).mul(bass.mul(0.6).add(0.5)));
  material.colorNode = mix(core, outer, r.smoothstep(0.05, 0.45)).mul(brightness);
  material.opacityNode = uv().sub(0.5).length().smoothstep(0.5, 0.05).mul(0.55);
  material.scaleNode = vec2(seed.w.mul(0.35).add(0.25).add(waveHit.mul(0.4)));
  const sprite = new THREE.Sprite(material); sprite.geometry = sprite.geometry.clone(); sprite.count = count; sprite.frustumCulled = false;
  scene.add(sprite);
  const pulse = beatGate(0.5);
  let waveAge = -1, orbit = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      spectrum.update(frame.audio.spectrum);
      logMapping.value = frame.spectrumMapping === 'log' ? 1 : 0; nyquist.value = frame.sampleRate / 2;
      if (pulse(frame.time, frame.audio.onset)) waveAge = 0;
      if (waveAge >= 0) { waveAge += settleStep(frame); if (waveAge > 1.6) waveAge = -1; }
      wave.value = waveAge < 0 || frame.reducedFlash ? -1 : waveAge / 1.4;
      time.value = frame.time; hue.value = frame.hue; bass.value = frame.response.bounce;
      orbit += frame.delta * 0.05;
      camera.position.set(Math.sin(orbit) * 95, 52 + Math.sin(frame.time * 0.1) * 10, Math.cos(orbit) * 95);
      camera.lookAt(0, 0, 0);
    },
    dispose() { disposeScene(scene); spectrum.dispose(); },
  };
}
