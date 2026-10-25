import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { atan, cos, exp, float, fract, max, min, mix, mx_fractal_noise_float, mx_noise_float, screenCoordinate, sin, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import { disposeScene, approach, settleStep, createSpectrumTexture, spectrumAxisNode } from './shared';
import { fullscreen, hash2 } from './shaderModes';
import { createHits, linearRgb, variantSequence } from './hitPulse';
import { seededRandom } from '../rendering/diagnostics';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

const box = (p: V2, half: V2) => { const d = p.abs().sub(half); return vec2(d.x.max(0), d.y.max(0)).length().add(min(max(d.x, d.y), 0)); };
const ellipse = (p: V2, radii: V2) => p.div(radii).length().sub(1).mul(min(radii.x, radii.y));
const rotate = (p: V2, angle: number) => vec2(p.x.mul(Math.cos(angle)).sub(p.y.mul(Math.sin(angle))), p.x.mul(Math.sin(angle)).add(p.y.mul(Math.cos(angle))));

/**
 * Mirror Plasma silhouettes in one folded quadrant, as signed distances: A green slabs, B a long-rayed star,
 * C a butterfly, D a wing pair, E a single point that re-blooms.
 */
const SILHOUETTES = [
  (q: V2) => min(box(q.sub(vec2(0.16, 0.09)), vec2(0.13, 0.05)), box(q.sub(vec2(0.07, 0.25)), vec2(0.2, 0.035))),
  (q: V2) => { const r = q.length(), a = atan(q.y, q.x); return r.sub(cos(a.mul(4)).abs().pow(10).mul(0.42).add(0.06)); },
  (q: V2) => min(ellipse(rotate(q.sub(vec2(0.17, 0.13)), -0.7), vec2(0.2, 0.09)), ellipse(q.sub(vec2(0.05, 0.03)), vec2(0.05, 0.12))),
  (q: V2) => ellipse(rotate(q.sub(vec2(0.26, 0.06)), -0.18), vec2(0.3, 0.05)),
  (q: V2) => q.length().sub(0.015),
];
export const PLASMA_PALETTES = [
  [0x3cff7a, 0x2ef2ff, 0xff8a3d], [0x2ef2ff, 0xffffff, 0xe0572b], [0xff3fd0, 0x2ef2ff, 0xff8a3d], [0x3a4bff, 0xff3fd0, 0x2ef2ff], [0x2ef2ff, 0xffffff, 0x3cff7a],
] as const;

/** Grain Smoke forms: S column, shell outline, veined sphere, spray, veined oval ring, smoke ribbon. */
export const GRAIN_FORMS = 6;

export interface PlasmaPreset {
  /** Monochrome film look (Grain Smoke) instead of the mirrored colour sculpture. */
  mono: boolean;
  decay: number;
  interval: number;
  seed: number;
}

/**
 * One engine, two presets. Filaments are contour lines of a slowly flowing noise field, broken into dots so
 * the picture reads as built from points; a silhouette mask decides where they gather. Hits swap the
 * silhouette (colour preset) or open the column into a veined sphere shell (mono preset).
 */
export function createPlasmaEngine(preset: PlasmaPreset): VisualMode {
  const { scene, camera, material } = fullscreen();
  const spectrum = createSpectrumTexture();
  const aspect = uniform(1), time = uniform(0), gain = uniform(0.1), flash = uniform(0), spread = uniform(1), bloomSize = uniform(1);
  const logMapping = uniform(0), nyquist = uniform(24000), core = uniform(0.5), grain = uniform(0.12), tear = uniform(0), tearSeed = uniform(0), column = uniform(0.06);
  const fromForm = uniform(0), toForm = uniform(0), morph = uniform(1), scale = uniform(1), sway = uniform(1);
  const weights = SILHOUETTES.map((_, i) => uniform(i === 0 ? 1 : 0));
  const colours = PLASMA_PALETTES[0].map((hex) => uniform(new THREE.Vector3(...linearRgb(hex))));
  const p = uv().sub(0.5).mul(vec2(aspect, 1));
  const pixelNoise = hash2(screenCoordinate.xy.add(fract(time.mul(17.3)).mul(311))).sub(0.5);
  const flowLines = (q: V2, scale: number, speed: number, count: number) => {
    const n = mx_fractal_noise_float(vec3(q.mul(scale), time.mul(speed)), 2, 2, 0.5);
    return float(1).sub(fract(n.mul(count)).sub(0.5).abs().mul(2)).pow(14);
  };
  if (!preset.mono) {
    const q = p.abs().div(bloomSize);
    let sdf: F = float(0);
    // Exactly one weight is 1 (hard cuts between silhouettes), so the blend is a selection.
    weights.forEach((weight, i) => { sdf = sdf.add(SILHOUETTES[i](q).mul(weight)); });
    const mask = sdf.smoothstep(0.03, -0.02), aura = exp(sdf.max(0).mul(-14)).mul(0.35);
    const r = q.length(), angle = atan(q.y, q.x);
    // Each band of the spectrum pushes one lobe out along its own angle.
    const energy = spectrumAxisNode(spectrum.texture, angle.div(Math.PI / 2).clamp(0, 1), logMapping, nyquist);
    const lobe = r.smoothstep(energy.mul(0.55).mul(spread).add(0.03), energy.mul(0.2)).mul(0.5);
    const filaments = flowLines(q, 3.5, 0.12, 9).mul(0.8).add(flowLines(q.add(7), 6, 0.2, 6).mul(0.5));
    const radial = float(1).sub(fract(angle.mul(48).add(mx_noise_float(vec3(q.mul(4), time.mul(0.3))).mul(2))).sub(0.5).abs().mul(2)).pow(20).mul(r.smoothstep(0.02, 0.2)).mul(exp(r.mul(-3)));
    // Bell outlines: dotted rings around the core, like jellyfish domes.
    const bell = exp(fract(r.mul(6).sub(time.mul(0.15))).sub(0.5).abs().mul(-40)).mul(exp(r.mul(-4))).mul(0.4);
    const dots = hash2(screenCoordinate.xy.div(2).floor().add(time.floor())).greaterThan(0.55).select(float(1), float(0.25));
    const strands = filaments.mul(mask.add(aura)).add(radial.mul(spread)).add(lobe.mul(filaments.add(0.3))).add(bell.mul(mask.add(0.2)));
    const tint = mix(colours[2], colours[0], mx_noise_float(vec3(q.mul(2), time.mul(0.1))).mul(0.5).add(0.5));
    const heart = exp(r.mul(-18)).mul(core);
    const rgb = tint.mul(strands.mul(dots).mul(1.5)).add(colours[1].mul(heart.add(mask.mul(0.07)))).add(vec3(1).mul(mask.mul(flash).mul(0.12)));
    material.fragmentNode = vec4(rgb.mul(gain).add(vec3(pixelNoise.mul(0.01))), 1);
  } else {
    // Torn rows: a few horizontal bands slide sideways on a hit.
    const row = p.y.mul(60).floor(), torn = hash2(vec2(row, tearSeed)).greaterThan(0.93).select(float(1), float(0)).mul(tear);
    const xt = p.x.add(torn.mul(hash2(vec2(row, tearSeed.add(3))).sub(0.5)).mul(0.3));
    // Mid-morph the smoke churns: one form dissolves into drifting powder and gathers again as the next.
    const churn = morph.mul(float(1).sub(morph)).mul(4);
    const drift = vec2(mx_noise_float(vec3(xt.mul(3), p.y.mul(3), time.mul(0.4))), mx_noise_float(vec3(xt.mul(3).add(5), p.y.mul(3), time.mul(0.4))));
    const q = vec2(xt, p.y).add(drift.mul(churn.mul(0.14).add(0.012))).div(scale);
    const smoke = mx_fractal_noise_float(vec3(q.x.mul(9), q.y.mul(2.2).sub(time.mul(0.35)), time.mul(0.1)), 4, 2, 0.55).mul(0.5).add(0.5);
    const veins = float(1).sub(mx_noise_float(vec3(q.mul(9), time.mul(0.2))).abs()).pow(10);
    const surface = mx_fractal_noise_float(vec3(q.mul(5), time.mul(0.05)), 3, 2, 0.5).mul(0.5).add(0.5);
    const tall = q.y.abs().smoothstep(0.46, 0.3);
    /** The forms from the clip: S column, shell outline, veined sphere, horizontal spray, veined oval ring, smoke ribbon. */
    const forms: ((index: number) => F)[] = [
      () => { const cx = sin(q.y.mul(7).add(time.mul(0.6))).mul(0.05).mul(sway); return exp(q.x.sub(cx).div(column).pow(2).negate()).mul(smoke.mul(smoke).mul(2.2).add(0.1)).mul(tall); },
      () => { const r = q.length().div(0.33); return exp(r.sub(1).abs().mul(-40)).mul(0.6).add(r.smoothstep(1, 0.96).mul(surface.mul(0.18).add(exp(q.x.abs().mul(-300)).mul(0.5)))); },
      () => { const r = q.length().div(0.3), inside = r.smoothstep(1, 0.96); return inside.mul(surface.mul(0.3).add(veins.mul(0.55)).add(r.pow(5).mul(0.5))).add(exp(r.sub(1).abs().mul(-50)).mul(0.4)); },
      () => { const a = atan(q.y, q.x.abs()), rays = float(1).sub(fract(a.mul(40).add(mx_noise_float(vec3(q.mul(3), time.mul(0.3))).mul(3))).sub(0.5).abs().mul(2)).pow(8); return exp(q.y.abs().mul(-7)).mul(exp(q.x.abs().mul(-2.5))).mul(rays.mul(0.9).add(smoke.mul(0.6))); },
      () => { const w = q.mul(vec2(1, 0.75)).add(drift.mul(0.05)), rr = w.length().div(0.3); return exp(rr.sub(1).abs().mul(-12)).mul(smoke.mul(1.1).add(veins.mul(0.7))); },
      () => { const cx = sin(q.y.mul(5).add(time.mul(0.5))).mul(0.14), width = sin(q.y.mul(3).sub(time.mul(0.3))).mul(0.025).add(0.05); return exp(q.x.sub(cx).div(width).pow(2).negate()).mul(smoke.mul(1.3).add(veins.mul(0.4))).mul(tall); },
    ];
    const formAt = (index: F) => forms.reduce<F>((acc, build, i) => index.equal(i).select(build(i), acc), float(0));
    const ease = morph.mul(morph).mul(float(3).sub(morph.mul(2)));
    const powder = mix(formAt(fromForm), formAt(toForm), ease);
    // Vertical light spikes near the centre, and a few long horizontal streaks.
    const spikeCell = xt.mul(260).floor();
    const spikes = hash2(vec2(spikeCell, 1)).greaterThan(0.94).select(float(1), float(0)).mul(exp(xt.abs().mul(-9))).mul(mx_noise_float(vec3(spikeCell, p.y.mul(3), time)).mul(0.5).add(0.5));
    const streak = exp(p.y.sub(0.22).abs().mul(-400)).add(exp(p.y.add(0.27).abs().mul(-500))).mul(exp(xt.abs().mul(-5))).mul(0.5);
    const light = powder.add(spikes.mul(0.6)).add(streak.mul(tear.add(0.3)));
    const tone = mix(vec3(0.95), vec3(0.85, 0.9, 1.05), flash.mul(0.08));
    material.fragmentNode = vec4(tone.mul(light.mul(gain)).add(vec3(pixelNoise.mul(grain))).max(0), 1);
  }

  const variants = preset.mono ? 3 : SILHOUETTES.length;
  const hits = createHits({ decay: preset.decay, interval: preset.interval, variants, seed: preset.seed });
  const random = seededRandom(preset.seed * 7 + 1);
  const forms = variantSequence(GRAIN_FORMS, preset.seed + 3);
  let formAge = 0, bloom = 1, swell = 0;
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      const step = settleStep(frame);
      spectrum.update(frame.audio.spectrum);
      logMapping.value = frame.spectrumMapping === 'log' ? 1 : 0; nyquist.value = frame.sampleRate / 2;
      hits.update(frame, preset.mono ? 0.35 : 0.06);
      swell = approach(swell, frame.response.bass, step, 0.1);
      if (preset.mono) {
        // Hits: column flare, tear glitch, collapse. The form only changes on a strong hit after a hold, or
        // on any hit once a form has run long, and then morphs over 1.6 s instead of cutting.
        if (hits.fired) {
          if (hits.variant === 1) { tear.value = 1; tearSeed.value = Math.floor(random() * 1000); }
          const strong = frame.response.impact > 0.7 || frame.response.bass > 0.75;
          if (morph.value >= 1 && ((strong && formAge > 6) || formAge > 14)) {
            fromForm.value = toForm.value; toForm.value = forms.next(); morph.value = 0; formAge = 0;
          }
        }
        formAge += step;
        morph.value = Math.min(1, morph.value + step / 1.6);
        tear.value = Math.max(0, tear.value - step * 5) * (frame.reducedFlash ? 0.5 : 1);
        column.value = 0.04 + swell * 0.04 + (hits.variant === 2 ? -hits.level * 0.02 : hits.level * 0.025);
        scale.value = approach(scale.value, 1 + frame.response.bounce * 0.12 + hits.level * 0.08, step, 0.08);
        sway.value = 1 + frame.response.loudness * 1.5;
        grain.value = 0.08 + frame.response.loudness * 0.08;
        flash.value = hits.flash;
        gain.value = hits.floor * 1.4 + hits.flash * 0.9 + frame.response.loudness * 0.4;
        return;
      }
      if (hits.fired) {
        weights.forEach((weight, i) => { weight.value = i === hits.variant ? 1 : 0; });
        PLASMA_PALETTES[hits.variant].forEach((hex, i) => colours[i].value.set(...linearRgb(hex)));
        bloom = 0.15;
      }
      // Each new silhouette blooms out from a small point.
      bloom = approach(bloom, 1, step, 0.12);
      bloomSize.value = bloom * (1 + swell * 0.25);
      spread.value = 0.6 + frame.response.loudness * 0.8;
      core.value = 0.4 + swell * 1.2;
      flash.value = hits.flash;
      gain.value = hits.floor + hits.flash * 1.3;
    },
    dispose() { disposeScene(scene); spectrum.dispose(); },
  };
}

export const createMirrorPlasmaMode = () => createPlasmaEngine({ mono: false, decay: 0.22, interval: 0.35, seed: 13 });
export const createGrainSmokeMode = () => createPlasmaEngine({ mono: true, decay: 0.3, interval: 0.6, seed: 29 });

// ---------------------------------------------------------------- Anamorphic Flare

export function createAnamorphicFlareMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const spectrum = createSpectrumTexture();
  const aspect = uniform(1), time = uniform(0), coreSize = uniform(0.05), streak = uniform(0.6), fibres = uniform(0.5), fringe = uniform(0.004), burst = uniform(0), gain = uniform(1);
  const drive = uniform(0.3), kick = uniform(0), bend = uniform(1), climb = uniform(0), logMapping = uniform(0), nyquist = uniform(24000);
  const p = uv().sub(0.5).mul(vec2(aspect, 1));
  const channel = (offset: F) => {
    const q = p.add(vec2(offset, 0));
    const r = q.length();
    const glow = exp(r.div(coreSize).negate()).mul(1.3).add(exp(r.div(coreSize.mul(3)).negate()).mul(0.08));
    // The anamorphic streak: very thin vertically, long horizontally.
    const line = exp(q.y.abs().mul(-180)).mul(exp(q.x.abs().div(streak.mul(0.45)).negate())).mul(1.3);
    return glow.add(line);
  };
  const light = vec3(channel(fringe), channel(float(0)), channel(fringe.negate()));
  // Vertical fibres: each one listens to its own band, so they grow and shrink independently; light pulses
  // run up some and down others, and a hit shoots them all out before they fall back.
  let threads: V3 = vec3(0);
  for (const [scale, seed] of [[260, 1], [420, 2], [680, 3]] as const) {
    const wobble = mx_noise_float(vec3(p.y.mul(2.5), seed * 10, time.mul(0.3))).mul(0.05).mul(p.y.abs().add(0.2)).mul(bend);
    const x = p.x.add(wobble), cell = x.mul(scale).floor();
    const on = hash2(vec2(cell, seed)).lessThan(fibres.mul(0.4)).select(float(1), float(0));
    const thin = float(1).sub(fract(x.mul(scale)).sub(0.5).abs().mul(2)).pow(6);
    const hue = hash2(vec2(cell, seed + 9)), band = hash2(vec2(cell, seed + 4));
    const tint = mix(vec3(0.43, 0.85, 1), mix(vec3(1, 0.69, 0.44), vec3(0.6, 1, 0.69), hue.mul(2).fract()), hue);
    const energy = spectrumAxisNode(spectrum.texture, band.mul(0.6), logMapping, nyquist);
    const height = energy.mul(drive).mul(1.4).add(kick.mul(0.45)).add(0.08).mul(hue.mul(0.8).add(0.5));
    const up = band.greaterThan(0.5).select(float(1), float(-1)), speed = hash2(vec2(cell, seed + 2)).mul(0.6).add(0.3);
    const pulses = float(1).sub(fract(p.y.mul(4).sub(time.mul(speed).mul(up)).sub(climb.mul(up)).add(hue.mul(7))).sub(0.5).abs().mul(2)).pow(10);
    const reach = exp(x.abs().mul(-14)).mul(p.y.abs().smoothstep(height, height.mul(0.25)));
    threads = threads.add(tint.mul(on.mul(thin).mul(reach).mul(pulses.mul(3).add(0.5)).mul(3)));
  }
  // Rainbow wings: at peaks the streak spreads into dispersed bands above and below.
  const wingAngle = atan(p.y, p.x.abs());
  const wings = exp(wingAngle.abs().mul(-9)).mul(exp(p.length().mul(-2.5))).mul(burst);
  const rainbow = vec3(cos(wingAngle.mul(14)), cos(wingAngle.mul(14).sub(2.1)), cos(wingAngle.mul(14).add(2.1))).mul(0.5).add(0.5);
  // Sensor speckle in a band along the horizon, and a sphere of speckle that bursts on a hit.
  const speck = hash2(screenCoordinate.xy.add(fract(time.mul(7.1)).mul(97))).greaterThan(0.985).select(float(0.5), float(0));
  const band = exp(p.y.abs().mul(-25)).mul(exp(p.x.abs().mul(-1.2)));
  const sphere = exp(p.length().sub(kick.oneMinus().mul(0.3)).abs().mul(-30)).mul(kick);
  const colour = light.add(threads).add(rainbow.mul(wings.mul(0.6))).add(vec3(0.73).mul(speck.mul(band.add(sphere).add(0.04))));
  material.fragmentNode = vec4(colour.mul(gain), 1);

  const hits = createHits({ decay: 0.26, interval: 0.3 });
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      const step = settleStep(frame);
      spectrum.update(frame.audio.spectrum);
      logMapping.value = frame.spectrumMapping === 'log' ? 1 : 0; nyquist.value = frame.sampleRate / 2;
      hits.update(frame, 0.5);
      const bounce = frame.response.bounce;
      // Motion follows the sensitivity-scaled response; reduced flash only tempers brightness.
      coreSize.value = approach(coreSize.value, 0.022 + frame.response.bass * 0.05 + hits.level * 0.025, step, 0.05);
      streak.value = approach(streak.value, 0.5 + frame.response.loudness * 1.2 + bounce * 0.8 + hits.level * 0.6, step, 0.12);
      drive.value = approach(drive.value, 0.25 + frame.response.loudness * 0.9 + bounce * 0.5, step, 0.1);
      kick.value = hits.level;
      bend.value = approach(bend.value, 1 + frame.response.bass * 4, step, 0.15);
      if (!frame.reducedMotion) climb.value += frame.delta * bounce * 1.5;
      fibres.value = 0.3 + frame.audio.highs * 0.6 + bounce * 0.3;
      fringe.value = 0.003 + hits.flash * 0.01;
      burst.value = hits.flash;
      gain.value = 0.45 + hits.flash * 0.5;
    },
    dispose() { disposeScene(scene); spectrum.dispose(); },
  };
}

// ---------------------------------------------------------------- Hair Vortex

/** Inner and outer colours for Hair Vortex; the field drifts from one pair to the next. */
export const VORTEX_PALETTES = [
  [0x0a1aff, 0x3a6bff], [0x2a0bff, 0xc23cff], [0x0636ff, 0x2ef2ff], [0x4b1cff, 0xff4fd8], [0x0019c8, 0x9fd4ff],
] as const;

export function createHairVortexMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const aspect = uniform(1), time = uniform(0), arm = uniform(0), eye = uniform(0.1), length = uniform(1), gain = uniform(1), shed = uniform(0);
  const twist = uniform(0), sway = uniform(0), wave = uniform(-1), waveLevel = uniform(0), flow = uniform(0);
  const inner = uniform(new THREE.Vector3(...linearRgb(VORTEX_PALETTES[0][0]))), outer = uniform(new THREE.Vector3(...linearRgb(VORTEX_PALETTES[0][1])));
  const p = uv().sub(0.5).mul(vec2(aspect, 1));
  const r = p.length();
  // Differential rotation: the inside turns faster than the edge, so the whole field swirls, not just the arm.
  const angle = atan(p.y, p.x).add(twist.div(r.add(0.25)));
  const ring = exp(r.sub(wave).abs().mul(-14)).mul(waveLevel);
  // Radial filaments: thousands of angular cells, each a hair whose length breathes on its own.
  let hair: F = float(0);
  for (const [count, seed] of [[900, 1], [1500, 2], [2400, 3]] as const) {
    const a = angle.div(Math.PI * 2).add(0.5).mul(count).add(mx_noise_float(vec3(r.mul(3), seed, flow)).mul(sway.mul(3).add(1.5)));
    const cell = a.floor(), h = hash2(vec2(cell, seed));
    const grow = mx_noise_float(vec3(cell.mul(0.07), seed, flow.mul(1.6))).mul(0.35).add(1);
    const reach = h.mul(0.6).add(0.35).mul(length).mul(grow).add(ring.mul(0.08));
    const thin = float(1).sub(fract(a).sub(0.5).abs().mul(2)).pow(3);
    const along = r.smoothstep(eye, eye.add(0.03)).mul(r.smoothstep(reach, reach.mul(0.6)));
    hair = hair.add(thin.mul(along).mul(hash2(vec2(cell, seed + 5)).mul(0.7).add(0.3)));
  }
  // One spiral arm of fine bright grains sweeping round the eye like a comet.
  const spiral = fract(angle.div(Math.PI * 2).sub(r.log().mul(0.35)).sub(arm));
  const armBody = exp(spiral.sub(0.5).abs().mul(-9)).mul(r.smoothstep(eye, eye.add(0.05))).mul(exp(r.mul(-2.2)));
  const grains = hash2(screenCoordinate.xy.div(1.5).floor()).greaterThan(float(0.55).sub(shed.mul(0.2))).select(float(1), float(0.15));
  // Gradient: inner colour near the eye to outer colour at the edge, rippled by angle so it is never a flat ring.
  const t = r.mul(1.6).add(sin(angle.mul(3).add(flow.mul(2))).mul(0.18)).clamp(0, 1);
  const tint = mix(inner, outer, t);
  const colour = tint.mul(hair.mul(0.6).mul(ring.mul(1.4).add(1))).add(mix(outer, vec3(0.9, 0.95, 1), 0.3).mul(armBody.mul(grains).mul(1.6)));
  const hole = r.smoothstep(eye.mul(0.95), eye.add(0.01));
  material.fragmentNode = vec4(colour.mul(hole).mul(gain).add(vec3(0.0006, 0.0014, 0.01)), 1);

  const hits = createHits({ decay: 0.5, interval: 0.4 });
  const palettes = variantSequence(VORTEX_PALETTES.length, 31);
  const target = { inner: new THREE.Vector3(), outer: new THREE.Vector3() };
  target.inner.copy(inner.value); target.outer.copy(outer.value);
  let phase = 0, spin = 0, drift = 0, paletteAge = 0;
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      const step = settleStep(frame), still = frame.reducedMotion;
      hits.update(frame, 0.8);
      const bounce = frame.response.bounce;
      // The arm turns a quarter turn a second, faster when the music drives harder; no hard cuts.
      if (!still) {
        phase += frame.delta * (0.18 + bounce * 0.25);
        spin += frame.delta * (0.05 + bounce * 0.12);
        drift += frame.delta * (0.25 + frame.response.loudness * 0.6);
      }
      arm.value = phase; twist.value = spin; flow.value = drift;
      sway.value = approach(sway.value, frame.response.bass * 1.2, step, 0.15);
      // Each hit sends a bright ring out through the hair.
      if (hits.fired && !still) { wave.value = eye.value; waveLevel.value = 0.6 + frame.response.impact; }
      wave.value += step * 0.6; waveLevel.value *= Math.exp(-step / 0.6);
      length.value = approach(length.value, 0.85 + frame.response.bass * 0.35 + hits.level * 0.1, step, 0.15);
      eye.value = approach(eye.value, 0.09 + frame.response.bass * 0.03, step, 0.2);
      // A new colour pair on a hit every 8 s or so, blended in over a couple of seconds.
      paletteAge += step;
      if (hits.fired && paletteAge > 8) {
        const next = VORTEX_PALETTES[palettes.next()];
        target.inner.set(...linearRgb(next[0])); target.outer.set(...linearRgb(next[1])); paletteAge = 0;
      }
      inner.value.lerp(target.inner, 1 - Math.exp(-step / 0.8)); outer.value.lerp(target.outer, 1 - Math.exp(-step / 0.8));
      shed.value = hits.flash;
      gain.value = approach(gain.value, 0.75 + frame.response.loudness * 0.35 + hits.flash * 0.15, step, 0.2);
    },
    dispose: () => disposeScene(scene),
  };
}

// ---------------------------------------------------------------- Ember Smoke

/** Ember Smoke forms: sphere, stacked blobs, hollow ring, two lobes. */
export const SMOKE_FORMS = 4;

export function createEmberSmokeMode(budget: { particleScale: number }): VisualMode {
  const { scene, camera, material } = fullscreen();
  const steps = budget.particleScale >= 2 ? 24 : budget.particleScale >= 1 ? 16 : 10;
  const aspect = uniform(1), time = uniform(0), expand = uniform(1), heat = uniform(0.5), dust = uniform(0.5), gain = uniform(1), sparkle = uniform(0.3);
  const from = uniform(0), to = uniform(0), blend = uniform(1);
  const p = uv().sub(0.5).mul(vec2(aspect, 1));
  // Signed distance of each form at a point (x, y, z), in units of the frame height.
  const form = (index: F, x: F, y: F, z: F) => {
    const sphere = vec3(x, y, z).length().sub(0.26);
    const stacked = min(min(vec3(x, y.sub(0.2), z).length().sub(0.16), vec3(x.add(0.04), y.add(0.02), z).length().sub(0.18)), vec3(x.sub(0.03), y.add(0.24), z).length().sub(0.15));
    const ring = vec2(vec2(x, y).length().sub(0.22), z).length().sub(0.08);
    const lobes = min(vec3(x.sub(0.13), y, z).length().sub(0.17), vec3(x.add(0.13), y.mul(1.1), z).length().sub(0.17));
    return index.lessThan(0.5).select(sphere, index.lessThan(1.5).select(stacked, index.lessThan(2.5).select(ring, lobes)));
  };
  // A short march through the volume, front to back, accumulating glow.
  let glow: F = float(0), depthCore: F = float(0), transmit: F = float(1);
  for (let i = 0; i < steps; i++) {
    const z = float(0.4 - 0.8 * (i + 0.5) / steps);
    const warp = mx_noise_float(vec3(p.mul(4), z.mul(4).add(time.mul(0.25)))).mul(0.07);
    const x = p.x.add(warp).div(expand), y = p.y.add(warp.mul(0.7)).div(expand);
    const sdf = mix(form(from, x, y, z), form(to, x, y, z), blend);
    const puff = mx_fractal_noise_float(vec3(x.mul(5), y.mul(5).sub(time.mul(0.2)), z.mul(5)), 3, 2, 0.5).mul(0.5).add(0.5);
    const density = sdf.mul(-7).add(puff.mul(1.6).sub(0.45)).clamp(0, 1).mul(0.8 / steps * 10);
    const hot = sdf.mul(-6).clamp(0, 1).mul(heat);
    glow = glow.add(density.mul(transmit).mul(hot.mul(1.5).add(0.5)));
    depthCore = depthCore.add(density.mul(transmit).mul(hot.pow(2)));
    transmit = transmit.mul(float(1).sub(density.mul(0.5)).max(0));
  }
  const orange = vec3(1, 0.1, 0.028), white = vec3(1, 0.82, 0.62);
  const smoke = mix(orange.mul(glow), white.mul(glow), depthCore.div(glow.max(1e-3)).clamp(0, 1));
  // Ember dust: sparse grains everywhere, densest around the smoke.
  const cell = screenCoordinate.xy.div(2).floor(), h = hash2(cell.add(time.mul(0.5).floor()));
  const embers = h.greaterThan(float(0.995).sub(glow.min(1).mul(0.06).mul(dust))).select(float(1), float(0)).mul(sin(time.mul(6).add(h.mul(50))).mul(0.3).add(0.7).add(sparkle));
  const colour = vec3(0.023, 0.003, 0.002).add(smoke.mul(1.4)).add(vec3(1, 0.43, 0.22).mul(embers.mul(0.8)));
  material.fragmentNode = vec4(colour.mul(gain), 1);

  const hits = createHits({ decay: 0.4, interval: 1, variants: SMOKE_FORMS, seed: 19 });
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      const step = settleStep(frame);
      hits.update(frame, 0.8);
      // A hit morphs to the next form over 0.4 s.
      if (hits.fired) { from.value = to.value; to.value = hits.variant; blend.value = 0; }
      blend.value = Math.min(1, blend.value + step / 0.4);
      expand.value = approach(expand.value, 0.85 + frame.response.bass * 0.35, step, 0.15);
      heat.value = approach(heat.value, 0.35 + frame.response.bass * 0.8 + hits.flash * 0.3, step, 0.1);
      dust.value = 0.3 + frame.response.loudness;
      sparkle.value = frame.audio.highs * 0.5;
      gain.value = 0.85 + hits.flash * 0.2;
    },
    dispose: () => disposeScene(scene),
  };
}
