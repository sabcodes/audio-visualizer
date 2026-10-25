import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { abs, cameraPosition, exp, float, max, min, mix, normalize, positionLocal, reflect, uniform, vec2, vec3 } from 'three/tsl';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, wrap, bandEnergies, approach, beatGate, createSpectrumTexture, spectrumAxisNode } from './shared';
import { presetBudget, type QualityBudget } from '../rendering/quality';

type F = Node<'float'>;
type V2 = Node<'vec2'>;

// ---------------------------------------------------------------- Liquid metaballs

/** A studio-chrome matcap computed in JS (no canvas), so it builds in any environment. */
export function chromeMatcap(size = 128) {
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const nx = (i + 0.5) / size * 2 - 1, ny = (j + 0.5) / size * 2 - 1, d = nx * nx + ny * ny, o = (j * size + i) * 4;
    if (d > 1) { data.set([0, 0, 0, 255], o); continue; }
    const nz = Math.sqrt(1 - d);
    // Reflect the view ray (0, 0, -1) about the normal; light the environment by direction.
    const rx = 2 * nz * nx, ry = 2 * nz * ny, rz = 2 * nz * nz - 1;
    const sky = Math.max(0, ry) ** 0.6 * 0.9, floor = Math.max(0, -ry) * 0.12, horizon = Math.exp(-ry * ry * 40) * 0.05;
    const left = Math.exp(-((rx + 0.75) ** 2 + (ry - 0.2) ** 2 + (rz - 0.5) ** 2) * 9), right = Math.exp(-((rx - 0.8) ** 2 + (ry - 0.1) ** 2 + (rz - 0.4) ** 2) * 9);
    const key = Math.exp(-((rx - 0.2) ** 2 + (ry - 0.8) ** 2) * 18) * 1.4;
    const r = sky + floor + horizon + left * 1.1 + right * 0.15 + key, g = sky + floor + horizon + left * 0.15 + right * 0.9 + key, b = sky * 1.1 + floor + horizon + left * 0.9 + right * 1.1 + key;
    data.set([r, g, b].map((v) => Math.round(Math.min(1, v) * 255)).concat(255), o);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
}

export const METABALLS = 8;

export function createMetaballMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const { scene, camera } = sceneDefaults(64);
  const matcap = chromeMatcap();
  const material = new THREE.MeshMatcapNodeMaterial({ matcap });
  const resolution = budget.particleScale < 1 ? 32 : budget.particleScale > 1 ? 52 : 42;
  const blobs = new MarchingCubes(resolution, material, false, false, 60000);
  blobs.scale.setScalar(34); blobs.frustumCulled = false;
  scene.add(blobs);
  const backdrop = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  const glow = uniform(new THREE.Color(0.05, 0.02, 0.08));
  backdrop.colorNode = glow.mul(normalize(positionLocal).y.mul(-0.5).add(0.6));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), backdrop));
  const bands = new Float32Array(METABALLS), level = new Float32Array(METABALLS), push = beatGate(0.3);
  let impulse = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      if (push(frame.time, frame.audio.onset)) impulse = 1;
      impulse = Math.max(0, impulse - frame.delta * 2.5);
      bandEnergies(frame, METABALLS, bands);
      blobs.reset();
      const t = frame.time * 0.5, spread = 0.2 + impulse * 0.1 + frame.response.bounce * 0.04;
      for (let i = 0; i < METABALLS; i++) {
        level[i] = approach(level[i], bands[i], frame.delta, 0.1);
        const a = t * (0.6 + i * 0.13) + i * 2.1, b = t * (0.45 + i * 0.09) + i * 1.3;
        const r = spread * (0.6 + level[i] * 0.8);
        blobs.addBall(0.5 + Math.sin(a) * Math.cos(b) * r, 0.5 + Math.sin(b * 1.3) * r * 0.8, 0.5 + Math.cos(a) * Math.cos(b) * r, 0.28 + level[i] * 0.55 + frame.response.bounce * 0.25, 12);
      }
      blobs.update();
      blobs.rotation.y += frame.delta * (0.2 + frame.audio.mid * 0.5);
      material.color.setHSL(wrap(frame.hue, 0, 1), 0.35, 0.75).multiplyScalar(1.2 + (frame.reducedFlash ? 0 : impulse * 0.6));
      glow.value.setHSL(wrap(frame.hue + 0.5, 0, 1), 0.6, 0.004 + frame.response.bounce * 0.006);
    },
    dispose() { disposeScene(scene); matcap.dispose(); },
  };
}

// ---------------------------------------------------------------- Ferrofluid

const FERRO_RADIUS = 46, SPACING = 3.4, ROOT3 = Math.sqrt(3);

export function createFerrofluidMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  const spectrum = createSpectrumTexture();
  const bass = uniform(0), hue = uniform(0), ripple = uniform(-1), logMapping = uniform(0), nyquist = uniform(24000), time = uniform(0);
  // Spikes sit on a hex lattice (two offset rectangular grids); each spike's height comes from its lattice point.
  const height = (p: V2): F => {
    const cell = vec2(SPACING, SPACING * ROOT3);
    const g1 = p.div(cell).round().mul(cell), g2 = p.div(cell).sub(0.5).round().add(0.5).mul(cell);
    const d1 = p.sub(g1).length(), d2 = p.sub(g2).length();
    const nearest = d1.lessThan(d2).select(g1, g2), d = min(d1, d2);
    const r = nearest.length().div(FERRO_RADIUS);
    const inside = r.smoothstep(1, 0.85);
    const energy = spectrumAxisNode(spectrum.texture, r.clamp(0, 1), logMapping, nyquist);
    const wave = exp(r.sub(ripple).mul(r.sub(ripple)).mul(-60)).mul(ripple.greaterThanEqual(0).select(float(1), float(0)));
    const amp = energy.mul(9).add(bass.mul(5)).add(wave.mul(6)).add(0.4).mul(inside).mul(r.mul(0.6).oneMinus());
    const spike = max(float(0), d.div(SPACING * 0.62).oneMinus()).pow(1.8).mul(amp);
    const pr = p.length().div(FERRO_RADIUS);
    const dome = pr.mul(pr).oneMinus().max(0).mul(bass.mul(2.5).add(1.2));
    return spike.add(dome);
  };
  const material = new THREE.MeshBasicNodeMaterial();
  const xz = positionLocal.xz;
  material.positionNode = vec3(positionLocal.x, height(xz), positionLocal.z);
  const e = 0.12, h0 = height(xz), hx = height(xz.add(vec2(e, 0))), hz = height(xz.add(vec2(0, e)));
  const normal = normalize(vec3(h0.sub(hx).div(e), 1, h0.sub(hz).div(e)));
  const view = normalize(cameraPosition.sub(vec3(positionLocal.x, h0, positionLocal.z)));
  const r = reflect(view.negate(), normal);
  // Black liquid metal: almost all of its look is the reflected studio — dark floor, two tinted softboxes overhead.
  const tone = (offset: number) => vec3(hue.add(offset), hue.add(offset + 2 / 3), hue.add(offset + 1 / 3)).fract().mul(6).sub(3).abs().sub(1).clamp(0, 1);
  const softA = exp(r.x.sub(0.45).mul(r.x.sub(0.45)).mul(-14)).mul(r.y.smoothstep(0.25, 0.7));
  const softB = exp(r.z.add(0.5).mul(r.z.add(0.5)).mul(-12)).mul(r.y.smoothstep(0.3, 0.8));
  const top = r.y.smoothstep(0.85, 1).mul(0.6);
  const fresnel = abs(view.y).oneMinus().pow(3).mul(0.6).add(0.08);
  const env = tone(0).mul(softA.mul(2.2)).add(tone(0.5).mul(softB.mul(1.6))).add(vec3(top));
  const liquid = env.mul(fresnel.add(0.3)).add(vec3(0.004, 0.004, 0.006));
  const radius = xz.length().div(FERRO_RADIUS);
  const tray = vec3(0.012, 0.012, 0.016).add(tone(0.5).mul(radius.sub(1.04).abs().smoothstep(0.02, 0).mul(0.8)));
  material.colorNode = mix(liquid, tray, radius.smoothstep(0.98, 1.01));
  const geometry = new THREE.PlaneGeometry(FERRO_RADIUS * 2.4, FERRO_RADIUS * 2.4, 340, 340); geometry.rotateX(-Math.PI / 2);
  const pool = new THREE.Mesh(geometry, material); pool.frustumCulled = false;
  scene.add(pool);
  const wave = beatGate(0.4);
  let rippleAge = -1, orbit = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      spectrum.update(frame.audio.spectrum);
      logMapping.value = frame.spectrumMapping === 'log' ? 1 : 0; nyquist.value = frame.sampleRate / 2;
      bass.value = approach(bass.value, frame.response.bounce, frame.delta, 0.06);
      hue.value = frame.hue; time.value = frame.time;
      if (wave(frame.time, frame.audio.onset)) rippleAge = 0;
      if (rippleAge >= 0) { rippleAge += frame.delta; if (rippleAge > 1.2) rippleAge = -1; }
      ripple.value = rippleAge < 0 ? -1 : rippleAge;
      orbit += frame.delta * 0.07;
      camera.position.set(Math.sin(orbit) * 62, 44 + Math.sin(frame.time * 0.2) * 4, Math.cos(orbit) * 62);
      camera.lookAt(0, 4, 0);
    },
    dispose() { disposeScene(scene); spectrum.dispose(); },
  };
}
