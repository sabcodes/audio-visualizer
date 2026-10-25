import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { atan, cos, dot, float, fract, max, mix, normalize, pow, sin, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import { disposeScene, createSpectrumTexture, spectrumAxisNode, beatGate, approach, settleStep, bandEnergies, wrap } from './shared';
import { createPingPong } from './pingPong';
import { createBeatPulse } from './beatPulse';
import { seededRandom } from '../rendering/diagnostics';
import { presetBudget, type QualityBudget } from '../rendering/quality';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
const hash2 = (p: V2) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
const palette = (hue: F) => vec3(cos(hue.mul(Math.PI * 2)), cos(hue.mul(Math.PI * 2).sub(2.094)), cos(hue.mul(Math.PI * 2).add(2.094))).mul(0.5).add(0.5);
const TAU = Math.PI * 2;

/** Simulation grid for a quality budget, kept 16:9. */
export const gridFor = (budget: QualityBudget, base: number) => {
  const scale = budget.particleScale < 1 ? 0.67 : budget.particleScale > 1 ? 1.33 : 1;
  return [Math.round(base * scale), Math.round(base * scale * 9 / 16)] as const;
};

/** A fullscreen quad scene whose material is swapped to the view of the latest simulation state. */
function display() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  camera.position.z = 1;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicNodeMaterial());
  scene.add(mesh);
  return { scene, camera, mesh };
}

// ---------------------------------------------------------------- Reaction-diffusion

/** Gray-Scott feed/kill pairs: coral, maze, mitosis spots, worms. */
export const RD_PRESETS: readonly (readonly [number, number])[] = [[0.0545, 0.062], [0.029, 0.057], [0.0367, 0.0649], [0.078, 0.061]];
const RD_WARMUP = 400;

export function createReactionDiffusionMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const [w, h] = gridFor(budget, 384);
  const { scene, camera, mesh } = display();
  const sim = createPingPong(w, h);
  const spectrum = createSpectrumTexture();
  const feed = uniform(RD_PRESETS[0][0]), kill = uniform(RD_PRESETS[0][1]), first = uniform(1), ring = uniform(-1), seed = uniform(0);
  const hue = uniform(0), logMapping = uniform(0), nyquist = uniform(24000), glow = uniform(1);
  const texel = vec2(1 / w, 1 / h), aspect = w / h, pulse = createBeatPulse();
  const step = sim.pass((read) => {
    const p = uv(), c = read(p).xy;
    const at = (x: number, y: number) => read(p.add(texel.mul(vec2(x, y)))).xy;
    const lap = at(-1, 0).add(at(1, 0)).add(at(0, -1)).add(at(0, 1)).mul(0.2)
      .add(at(-1, -1).add(at(1, -1)).add(at(-1, 1)).add(at(1, 1)).mul(0.05)).sub(c);
    const a = c.x, b = c.y, reaction = a.mul(b).mul(b);
    const nextA = a.add(lap.x.sub(reaction).add(feed.mul(a.oneMinus())));
    // Beats paint the spectrum round a ring (mirrored so the figure stays balanced).
    const q = p.sub(0.5).mul(vec2(aspect, 1)), angle = atan(q.y, q.x).div(TAU).add(0.5);
    const energy = spectrumAxisNode(spectrum.texture, angle.mul(2).sub(1).abs(), logMapping, nyquist);
    const paint = ring.greaterThanEqual(0).select(q.length().sub(ring).abs().smoothstep(0.012, 0).mul(energy.mul(0.8).add(0.1)), float(0));
    const nextB = b.add(lap.y.mul(0.5).add(reaction).sub(kill.add(feed).mul(b))).add(paint);
    // First frame: clean reagent with scattered droplets of the catalyst.
    const droplet = hash2(p.mul(vec2(w, h)).div(7).floor().add(seed)).greaterThan(0.93).select(float(1), float(0));
    const state = mix(vec2(nextA, nextB).clamp(0, 1), vec2(1, droplet), first);
    return vec4(state, 0, 1);
  });
  const view = sim.view((read) => {
    // The organism breathes with the bounce and ripples on each beat; the ripple lights the ridges it crosses.
    const { uv: p, ring: wave } = pulse.warp(uv(), aspect), b = read(p).y;
    // Emboss from the catalyst gradient so the pattern reads as wet ridges.
    const dx = read(p.add(vec2(texel.x, 0))).y.sub(read(p.sub(vec2(texel.x, 0))).y);
    const dy = read(p.add(vec2(0, texel.y))).y.sub(read(p.sub(vec2(0, texel.y))).y);
    const normal = normalize(vec3(dx.mul(-6), dy.mul(-6), 1));
    const diffuse = max(float(0), dot(normal, normalize(vec3(-0.5, 0.6, 0.7))));
    const highlight = pow(max(float(0), dot(normal, normalize(vec3(-0.25, 0.3, 1)))), float(40)).mul(b.smoothstep(0.15, 0.3));
    const body = palette(hue.add(b.mul(0.35))).mul(b.smoothstep(0.08, 0.45)).mul(diffuse.mul(0.7).add(0.3));
    const ground = mix(vec3(0.004, 0.004, 0.01), palette(hue.add(0.5)).mul(0.02), p.y);
    const lift = glow.mul(pulse.surge.mul(0.35).add(0.85)).add(wave.mul(0.7));
    return vec4(ground.add(body.mul(lift)).add(vec3(highlight.mul(pulse.surge.mul(0.5).add(0.5)))), 1);
  });
  mesh.material = view();
  const paintGate = beatGate(0.6), bands = new Float32Array(3);
  let preset = 0, beats = 0, warmed = false, steps = 0, presetBlend = 1, from = 0, hueKick = 0;
  return {
    scene, camera,
    update(frame) {
      spectrum.update(frame.audio.spectrum);
      logMapping.value = frame.spectrumMapping === 'log' ? 1 : 0; nyquist.value = frame.sampleRate / 2;
      hue.value = frame.hue + hueKick;
      glow.value = approach(glow.value, 0.85 + frame.response.loudness * 0.4, settleStep(frame), 0.3);
      ring.value = -1;
      const beat = paintGate(frame.time, frame.audio.onset);
      pulse.update(frame, beat);
      if (beat) {
        hueKick = (hueKick + 0.03) % 1;
        bandEnergies(frame, 3, bands);
        ring.value = 0.12 + bands[0] * 0.25;
        // Every twelfth beat drifts to the next pattern family.
        if (++beats % 12 === 0) { from = preset; preset = (preset + 1) % RD_PRESETS.length; presetBlend = 0; }
      }
      presetBlend = Math.min(1, presetBlend + settleStep(frame) / 4);
      const [f0, k0] = RD_PRESETS[from], [f1, k1] = RD_PRESETS[preset], loud = frame.response.loudness * 0.004;
      feed.value = f0 + (f1 - f0) * presetBlend + loud; kill.value = k0 + (k1 - k0) * presetBlend;
      // About 8 steps per 60 Hz frame, faster when the music pushes; a frozen clock (pause, reduced motion) holds the pattern still.
      steps = Math.min(20, Math.round(frame.delta * 480 * (0.7 + frame.response.bounce * 1.2)));
    },
    simulate(renderer) {
      if (!warmed) {
        step(renderer); first.value = 0;
        for (let i = 1; i < RD_WARMUP; i++) step(renderer);
        warmed = true;
      }
      for (let i = 0; i < steps; i++) { step(renderer); if (i === 0) ring.value = -1; }
      mesh.material = view();
    },
    dispose() { disposeScene(scene); sim.dispose(); spectrum.dispose(); },
  };
}

// ---------------------------------------------------------------- MilkDrop-style feedback warp

export function createFeedbackMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const [w, h] = gridFor(budget, 640);
  const { scene, camera, mesh } = display();
  const sim = createPingPong(w, h);
  const spectrum = createSpectrumTexture();
  const waveData = new Uint8Array(512), wave = new THREE.DataTexture(waveData, 512, 1, THREE.RedFormat, THREE.UnsignedByteType);
  wave.minFilter = wave.magFilter = THREE.LinearFilter; wave.needsUpdate = true;
  const zoom = uniform(0), spin = uniform(0), swirl = uniform(0), time = uniform(0), hue = uniform(0), decay = uniform(0.96);
  const pulse = uniform(0), useWave = uniform(1), level = uniform(0.2), logMapping = uniform(0), nyquist = uniform(24000);
  const aspect = w / h;
  const step = sim.pass((read) => {
    const p = uv(), q = p.sub(0.5).mul(vec2(aspect, 1)), r = q.length();
    // Warp the previous frame: zoom toward the centre, rotate, and swirl by radius.
    const turn = spin.add(sin(r.mul(7).sub(time.mul(0.8))).mul(swirl));
    const c = cos(turn), s = sin(turn);
    const warped = vec2(q.x.mul(c).sub(q.y.mul(s)), q.x.mul(s).add(q.y.mul(c))).mul(zoom.oneMinus());
    const previous = read(warped.div(vec2(aspect, 1)).add(0.5)).xyz.mul(decay);
    // Inject a waveform ring (or, with reduced motion, the calmed spectrum) plus a beat pulse.
    const angle = atan(q.y, q.x).div(TAU).add(0.5);
    const radiusWave = texture(wave, vec2(angle.mul(2).sub(1).abs(), 0.5)).x.sub(0.5).mul(0.16);
    const radiusSpectrum = spectrumAxisNode(spectrum.texture, angle.mul(2).sub(1).abs(), logMapping, nyquist).mul(0.12);
    const ringRadius = float(0.2).add(level.mul(0.08)).add(mix(radiusSpectrum, radiusWave, useWave));
    const line = r.sub(ringRadius).abs().smoothstep(0.006, 0.0005);
    const beat = r.sub(pulse.mul(0.5)).abs().smoothstep(0.01, 0).mul(pulse.greaterThan(0).select(pulse.oneMinus(), float(0)));
    const ink = palette(hue.add(angle.mul(0.5))).mul(line.mul(1.2)).add(palette(hue.add(0.5)).mul(beat.mul(1.2)));
    return vec4(max(previous, ink), 1);
  });
  const view = sim.view((read) => {
    const p = uv(), q = p.sub(0.5);
    // Slight chromatic fringe toward the edges, then a soft vignette.
    const split = q.mul(0.006);
    const colour = vec3(read(p.add(split)).x, read(p).y, read(p.sub(split)).z);
    return vec4(colour.mul(q.length().mul(1.3).smoothstep(1, 0.2).mul(0.85).add(0.15)), 1);
  });
  mesh.material = view();
  const pulseGate = beatGate(0.4);
  let pulseAge = -1, direction = 1, zoomLevel = 0, spinLevel = 0;
  return {
    scene, camera,
    update(frame) {
      spectrum.update(frame.audio.spectrum);
      logMapping.value = frame.spectrumMapping === 'log' ? 1 : 0; nyquist.value = frame.sampleRate / 2;
      const samples = frame.audio.waveform, stride = Math.max(1, Math.floor(samples.length / 512));
      for (let i = 0; i < 512; i++) waveData[i] = Math.max(0, Math.min(255, ((samples[i * stride] || 0) * 0.5 + 0.5) * 255));
      wave.needsUpdate = true;
      time.value = frame.time; hue.value = frame.hue;
      if (pulseGate(frame.time, frame.audio.onset)) { pulseAge = 0; direction = -direction; }
      if (pulseAge >= 0) { pulseAge += settleStep(frame); if (pulseAge > 1) pulseAge = -1; }
      pulse.value = pulseAge < 0 || frame.reducedFlash ? 0 : pulseAge;
      const moving = frame.reducedMotion ? 0 : 1, scaled = Math.min(2, frame.delta * 60) * moving;
      zoomLevel = approach(zoomLevel, (0.008 + frame.response.bass * 0.035) * scaled, settleStep(frame), 0.1);
      spinLevel = approach(spinLevel, (0.004 + frame.audio.mid * 0.02) * direction * scaled, settleStep(frame), 0.3);
      zoom.value = zoomLevel; spin.value = spinLevel; swirl.value = 0.01 * scaled;
      decay.value = frame.reducedMotion ? 0.9 : 0.915 + frame.response.loudness * 0.04;
      level.value = approach(level.value, frame.response.loudness, settleStep(frame), 0.15);
      useWave.value = frame.reducedMotion ? 0 : 1;
    },
    simulate(renderer) { step(renderer); mesh.material = view(); },
    dispose() { disposeScene(scene); sim.dispose(); spectrum.dispose(); wave.dispose(); },
  };
}

// ---------------------------------------------------------------- Curl-noise flow ribbons

/** Stream-function terms: wave vector (kx, ky), angular speed and phase. Velocity is its curl, so the flow never converges. */
const FLOW_TERMS = [[2.1, 1.3, 0.21, 0.4], [-1.4, 2.7, -0.17, 1.9], [3.3, -2.2, 0.29, 3.1], [0.7, -3.9, -0.23, 5.2]] as const;
const FLOW_BANDS = 8;

/** Divergence-free velocity at (x, y): the curl of a sum-of-sines stream function, plus an optional vortex. */
export function flowVelocity(x: number, y: number, t: number, scale: number, out: Float32Array) {
  let vx = 0, vy = 0;
  for (const [kx, ky, w, phase] of FLOW_TERMS) {
    const c = Math.cos((kx * x + ky * y) * scale + w * t + phase) * scale;
    vx += c * ky; vy -= c * kx;
  }
  out[0] = vx; out[1] = vy;
  return out;
}

export function createCurlFlowMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const [w, h] = gridFor(budget, 640);
  const { scene, camera, mesh } = display();
  const sim = createPingPong(w, h);
  const count = Math.round(6000 * budget.particleScale), random = seededRandom(31);
  // Each particle draws the segment it travelled this frame into the fading buffer, so streams read as silk.
  const segments = new Float32Array(count * 6), colours = new Float32Array(count * 6), life = new Float32Array(count);
  const respawn = (i: number) => {
    const x = (random() * 2 - 1) * 1.9, y = random() * 2 - 1;
    segments.set([x, y, 0, x, y, 0], i * 6); life[i] = 2 + random() * 4;
  };
  for (let i = 0; i < count; i++) { respawn(i); life[i] *= random(); }
  const geometry = new THREE.BufferGeometry();
  const segmentAttribute = new THREE.BufferAttribute(segments, 3), colourAttribute = new THREE.BufferAttribute(colours, 3);
  geometry.setAttribute('position', segmentAttribute); geometry.setAttribute('color', colourAttribute);
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicNodeMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  lines.frustumCulled = false;
  const particles = new THREE.Scene(); particles.add(lines);
  const particleCamera = new THREE.OrthographicCamera(-16 / 9, 16 / 9, 1, -1, 0, 2); particleCamera.position.z = 1;
  const decay = uniform(0.95);
  const step = sim.pass((read) => vec4(read(uv()).xyz.mul(decay), 1));
  const view = sim.view((read) => {
    const colour = read(uv()).xyz;
    // Soft-clip and darken the mids so dense streams stay coloured instead of piling up to white.
    return vec4(pow(colour.div(colour.add(1)), vec3(1.4)).mul(1.1), 1);
  });
  mesh.material = view();
  const vortexGate = beatGate(0.5), velocity = new Float32Array(2), bands = new Float32Array(FLOW_BANDS), tint = new THREE.Color();
  let clock = 0, vortex = 0, vx = 0, vy = 0, kick = 0, drawn = false, moved = false;
  const advance = (dt: number, speed: number, scale: number) => {
    for (let i = 0; i < count; i++) {
      let x = segments[i * 6 + 3], y = segments[i * 6 + 4];
      flowVelocity(x, y, clock, scale, velocity);
      // A steady drift carries streams across the frame instead of leaving them circling in fixed eddies.
      let ux = velocity[0] * 0.35 + 1, uy = velocity[1] * 0.35;
      if (vortex > 0) {
        // A beat drops a vortex ring that wraps nearby streams around it.
        const dx = x - vx, dy = y - vy, falloff = vortex * Math.exp(-(dx * dx + dy * dy) * 6) * 4;
        ux += -dy * falloff; uy += dx * falloff;
      }
      x += ux * speed * dt; y += uy * speed * dt;
      life[i] -= dt;
      if (life[i] <= 0 || Math.abs(x) > 1.95 || Math.abs(y) > 1.05) respawn(i);
      else segments.set([segments[i * 6 + 3], segments[i * 6 + 4], 0, x, y, 0], i * 6);
    }
    segmentAttribute.needsUpdate = true;
  };
  return {
    scene, camera,
    update(frame) {
      bandEnergies(frame, FLOW_BANDS, bands);
      if (vortexGate(frame.time, frame.audio.onset)) { vortex = 1; kick = 1; vx = (random() * 2 - 1) * 1.2; vy = (random() * 2 - 1) * 0.7; }
      vortex = Math.max(0, vortex - settleStep(frame) * 1.2); kick = Math.max(0, kick - settleStep(frame) * 2.5);
      // Streams are dim at rest and swell with the bounce, flaring briefly on each beat.
      // The reduced-motion still is traced once with few passes, so it needs a stronger, steady tint to show.
      const swell = frame.reducedMotion ? 9 : 0.6 + frame.response.bounce * 1.1 + kick * 0.6;
      for (let i = 0; i < count; i++) {
        const band = i % FLOW_BANDS;
        tint.setHSL(wrap(frame.hue + band / FLOW_BANDS * 0.35, 0, 1), 0.9, 0.55).multiplyScalar((0.01 + bands[band] * 0.08) * swell);
        colours.set([tint.r, tint.g, tint.b, tint.r, tint.g, tint.b], i * 6);
      }
      colourAttribute.needsUpdate = true;
      const dt = Math.min(frame.delta, 1 / 20);
      moved = dt > 0;
      if (moved) { clock += dt; advance(dt, 0.3 + frame.response.bass * 0.7 + kick * 0.9, 1 + frame.response.loudness * 0.5); }
      decay.value = 0.93 + frame.response.loudness * 0.02;
    },
    simulate(renderer) {
      const draw = (target: THREE.WebGPURenderer) => target.render(particles, particleCamera);
      if (moved) step(renderer, draw);
      else if (!drawn) {
        // A clock frozen from the start (reduced motion) would show bare dots, so trace the streams once into a still.
        decay.value = 0.95;
        for (let i = 0; i < 90; i++) { advance(1 / 60, 0.3, 1); step(renderer, draw); }
      }
      drawn = true;
      mesh.material = view();
    },
    dispose() { disposeScene(scene); disposeScene(particles); sim.dispose(); },
  };
}
