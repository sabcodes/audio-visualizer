import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { cos, dot, float, fract, max, min, mix, mx_fractal_noise_float, select, sin, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import { disposeScene, createSpectrumTexture, spectrumAxisNode, beatGate, approach, settleStep } from './shared';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
export const hash2 = (p: V2) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
/** Cosine palette: hue in turns, matching the existing fullscreen modes' RGB phase offsets. */
export const palette = (hue: F) => vec3(cos(hue.mul(Math.PI * 2)), cos(hue.mul(Math.PI * 2).sub(2.094)), cos(hue.mul(Math.PI * 2).add(2.094))).mul(0.5).add(0.5);

export function fullscreen() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  camera.position.z = 1;
  const material = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  return { scene, camera, material };
}

export function createVoronoiMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const spectrum = createSpectrumTexture();
  const time = uniform(0), aspect = uniform(1), bass = uniform(0), hue = uniform(0), flash = uniform(0), flashSeed = uniform(0);
  const logMapping = uniform(0), nyquist = uniform(24000);
  const p = uv().sub(0.5).mul(vec2(aspect, 1)).mul(bass.mul(-1.4).add(7)).add(vec2(time.mul(0.05), time.mul(0.03)));
  const cell = p.floor(), local = fract(p);
  // 3×3 neighbourhood unrolled into the graph: nearest (f1), second (f2) and the nearest cell's id.
  let f1: F = float(8), f2: F = float(8), id: F = float(0);
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    const neighbour = cell.add(vec2(x, y)), h = hash2(neighbour), h2 = hash2(neighbour.add(17.3));
    const point = vec2(sin(time.mul(0.7).add(h.mul(6.283))), cos(time.mul(0.6).add(h2.mul(6.283)))).mul(0.38).add(0.5);
    const d = vec2(x, y).add(point).sub(local).length();
    f2 = min(f2, max(f1, d)); id = select(d.lessThan(f1), h, id); f1 = min(f1, d);
  }
  const energy = spectrumAxisNode(spectrum.texture, id.mul(0.85), logMapping, nyquist);
  const lead = f2.sub(f1).smoothstep(0, 0.06);
  const facet = f1.smoothstep(0.75, 0).mul(0.35).add(0.65);
  const lit = fract(id.mul(7.13).add(flashSeed)).lessThan(flash.mul(0.35)).select(float(1), float(0)).mul(flash);
  const glass = palette(hue.add(id.mul(0.45))).mul(energy.mul(1.9).add(0.18)).mul(facet).add(lit.mul(1.2));
  const edge = palette(hue.add(0.5)).mul(f2.sub(f1).smoothstep(0.06, 0).mul(0.25).mul(energy));
  material.fragmentNode = vec4(glass.mul(lead).add(edge), 1);
  const flashGate = beatGate(0.3);
  let flashLevel = 0;
  return {
    scene, camera,
    update(frame) {
      time.value = frame.time; aspect.value = frame.aspect; hue.value = frame.hue;
      bass.value = frame.reducedMotion ? approach(bass.value, frame.response.bounce, settleStep(frame), 0.4) : frame.response.bounce;
      spectrum.update(frame.audio.spectrum);
      logMapping.value = frame.spectrumMapping === 'log' ? 1 : 0; nyquist.value = frame.sampleRate / 2;
      if (flashGate(frame.time, frame.audio.onset)) { flashLevel = 1; flashSeed.value = (flashSeed.value + 0.37) % 1; }
      flashLevel = Math.max(0, flashLevel - settleStep(frame) * 3);
      flash.value = frame.reducedFlash ? flashLevel * 0.25 : flashLevel;
    },
    dispose() { disposeScene(scene); spectrum.dispose(); },
  };
}

export function createInkMarbleMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const time = uniform(0), aspect = uniform(1), warp = uniform(1), flow = uniform(0), hue = uniform(0), shock = uniform(10), film = uniform(1), ringGlow = uniform(0.6);
  const centred = uv().sub(0.5).mul(vec2(aspect, 1));
  // Beat shockwave: a ring that pushes the domain outward as it expands.
  const radius = centred.length(), ring = radius.sub(shock.mul(0.9)).abs().smoothstep(0.12, 0).mul(shock.mul(-1.2).exp());
  const p = centred.mul(radius.max(0.001).reciprocal().mul(ring.mul(0.25)).add(1)).mul(1.1);
  const t = time.mul(0.06).add(flow);
  const fbm = (q: V2, z: F) => mx_fractal_noise_float(vec3(q.x, q.y, z), 4, 2, 0.5);
  const q = vec2(fbm(p, t), fbm(p.add(vec2(5.2, 1.3)), t.add(3)));
  const r = vec2(fbm(p.add(q.mul(warp.mul(1.6))).add(vec2(1.7, 9.2)), t.mul(1.3)), fbm(p.add(q.mul(warp.mul(1.6))).add(vec2(8.3, 2.8)), t.mul(1.3)));
  const n = fbm(p.add(r.mul(warp.mul(1.5))), t.mul(0.7));
  // Thin-film interference: thickness sweeps the cosine palette, darker where the ink pools.
  const thickness = n.mul(film.mul(1.1).add(0.7)).add(r.length().mul(0.6));
  const sheen = palette(thickness.add(hue)).mul(palette(thickness.mul(1.7).add(hue).add(0.33)).mul(0.6).add(0.4));
  const ink = n.mul(0.5).add(0.5).smoothstep(0.15, 0.85);
  const vignette = radius.smoothstep(1.1, 0.25).mul(0.6).add(0.4);
  material.fragmentNode = vec4(sheen.mul(ink.mul(1.4).add(0.08)).mul(vignette).add(vec3(ring.mul(ringGlow))), 1);
  const shockGate = beatGate(0.5);
  let shockAge = 10, flowPhase = 0;
  return {
    scene, camera,
    update(frame) {
      time.value = frame.time; aspect.value = frame.aspect; hue.value = frame.hue;
      // Reduced motion eases the whole-field warp so the marble drifts instead of jumping with each kick.
      const calm = frame.reducedMotion ? 1 - Math.exp(-settleStep(frame) / 0.6) : 1;
      warp.value += (0.8 + frame.response.bounce * 1.1 - warp.value) * calm;
      film.value += (0.6 + frame.response.bass * 1.4 - film.value) * calm;
      flowPhase += frame.audio.mid * frame.delta * 0.6; flow.value = flowPhase;
      if (shockGate(frame.time, frame.audio.onset)) shockAge = 0;
      shockAge += settleStep(frame); shock.value = shockAge;
      ringGlow.value = frame.reducedFlash ? 0 : 0.6;
    },
    dispose: () => disposeScene(scene),
  };
}

