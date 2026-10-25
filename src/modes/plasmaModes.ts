import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { atan, cos, exp, float, fract, max, min, mix, mx_fractal_noise_float, mx_noise_float, screenCoordinate, sin, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import { disposeScene, approach, settleStep, createSpectrumTexture, spectrumAxisNode } from './shared';
import { fullscreen, hash2 } from './shaderModes';
import { createHits, linearRgb } from './hitPulse';
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
  const logMapping = uniform(0), nyquist = uniform(24000), core = uniform(0.5), grain = uniform(0.12), tear = uniform(0), tearSeed = uniform(0), shell = uniform(0), column = uniform(0.06);
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
    const x = p.x, y = p.y;
    // Torn rows: a few horizontal bands slide sideways on a hit.
    const row = y.mul(60).floor(), torn = hash2(vec2(row, tearSeed)).greaterThan(0.93).select(float(1), float(0)).mul(tear);
    const xt = x.add(torn.mul(hash2(vec2(row, tearSeed.add(3))).sub(0.5)).mul(0.3));
    const smoke = mx_fractal_noise_float(vec3(xt.mul(9), y.mul(2.2).sub(time.mul(0.35)), time.mul(0.1)), 4, 2, 0.55).mul(0.5).add(0.5);
    const columnMask = exp(xt.div(column).pow(2).negate());
    const powder = smoke.mul(columnMask).mul(1.4).add(columnMask.mul(0.15));
    // Vertical light spikes near the column, and a few long horizontal streaks.
    const spikeCell = xt.mul(260).floor();
    const spikes = hash2(vec2(spikeCell, 1)).greaterThan(0.94).select(float(1), float(0)).mul(exp(xt.abs().mul(-9))).mul(mx_noise_float(vec3(spikeCell, y.mul(3), time)).mul(0.5).add(0.5));
    const streak = exp(y.sub(0.22).abs().mul(-400)).add(exp(y.add(0.27).abs().mul(-500))).mul(exp(xt.abs().mul(-5))).mul(0.5);
    // Shell: a translucent veined sphere with a bright limb.
    const r = p.length().div(0.35), inside = r.smoothstep(1, 0.97);
    const veins = float(1).sub(mx_noise_float(vec3(p.mul(9), time.mul(0.2))).abs()).pow(10);
    const surface = mx_fractal_noise_float(vec3(p.mul(5), 2.5), 3, 2, 0.5).mul(0.5).add(0.5);
    const shellLight = inside.mul(surface.mul(0.25).add(r.pow(5).mul(0.6)).add(veins.mul(0.35))).add(exp(r.sub(1).abs().mul(-60)).mul(0.45));
    const light = mix(powder.add(spikes.mul(0.7)).add(streak.mul(tear.add(0.3))), shellLight.add(spikes.mul(0.3)), shell);
    const tone = mix(vec3(0.95), vec3(0.85, 0.9, 1.05), flash.mul(0.08));
    material.fragmentNode = vec4(tone.mul(light.mul(gain)).add(vec3(pixelNoise.mul(grain))).max(0), 1);
  }

  const variants = preset.mono ? 4 : SILHOUETTES.length;
  const hits = createHits({ decay: preset.decay, interval: preset.interval, variants, seed: preset.seed });
  const random = seededRandom(preset.seed * 7 + 1);
  let shellAge = Infinity, bloom = 1, swell = 0;
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
        // Variants: column flare, tear glitch, sphere shell, collapse.
        if (hits.fired) {
          if (hits.variant === 1 || hits.variant === 0) { tear.value = 1; tearSeed.value = Math.floor(random() * 1000); }
          if (hits.variant === 2) shellAge = 0;
        }
        shellAge += step;
        shell.value = shellAge < 1.2 ? Math.min(1, shellAge * 8) * Math.min(1, (1.2 - shellAge) * 4) : 0;
        tear.value = Math.max(0, tear.value - step * 5) * (frame.reducedFlash ? 0.5 : 1);
        column.value = 0.04 + swell * 0.04 + (hits.variant === 3 ? -hits.level * 0.02 : hits.level * 0.02);
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
  const aspect = uniform(1), time = uniform(0), coreSize = uniform(0.05), streak = uniform(0.6), fibres = uniform(0.5), fringe = uniform(0.004), burst = uniform(0), gain = uniform(1);
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
  // Vertical fibres: thin curved threads hanging up and down the axis, each its own colour.
  let threads: V3 = vec3(0);
  for (const [scale, seed] of [[260, 1], [420, 2], [680, 3]] as const) {
    const bend = mx_noise_float(vec3(p.y.mul(2.5), seed * 10, time.mul(0.15))).mul(0.05).mul(p.y.abs().add(0.2));
    const x = p.x.add(bend), cell = x.mul(scale).floor();
    const on = hash2(vec2(cell, seed)).lessThan(fibres.mul(0.35)).select(float(1), float(0));
    const thin = float(1).sub(fract(x.mul(scale)).sub(0.5).abs().mul(2)).pow(6);
    const hue = hash2(vec2(cell, seed + 9));
    const tint = mix(vec3(0.43, 0.85, 1), mix(vec3(1, 0.69, 0.44), vec3(0.6, 1, 0.69), hue.mul(2).fract()), hue);
    const reach = exp(x.abs().mul(-22)).mul(exp(p.y.abs().mul(-1.6)));
    threads = threads.add(tint.mul(on.mul(thin).mul(reach).mul(2.2)));
  }
  // Rainbow wings: at peaks the streak spreads into dispersed bands above and below.
  const wingAngle = atan(p.y, p.x.abs());
  const wings = exp(wingAngle.abs().mul(-9)).mul(exp(p.length().mul(-2.5))).mul(burst);
  const rainbow = vec3(cos(wingAngle.mul(14)), cos(wingAngle.mul(14).sub(2.1)), cos(wingAngle.mul(14).add(2.1))).mul(0.5).add(0.5);
  // Sensor speckle in a band along the horizon, and a sphere of speckle that bursts on a hit.
  const speck = hash2(screenCoordinate.xy.add(fract(time.mul(7.1)).mul(97))).greaterThan(0.985).select(float(0.5), float(0));
  const band = exp(p.y.abs().mul(-25)).mul(exp(p.x.abs().mul(-1.2)));
  const sphere = exp(p.length().sub(burst.mul(0.25)).abs().mul(-30)).mul(burst);
  const colour = light.add(threads).add(rainbow.mul(wings.mul(0.6))).add(vec3(0.73).mul(speck.mul(band.add(sphere).add(0.04))));
  material.fragmentNode = vec4(colour.mul(gain), 1);

  const hits = createHits({ decay: 0.26, interval: 0.8 });
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      const step = settleStep(frame);
      hits.update(frame, 0.5);
      coreSize.value = approach(coreSize.value, 0.025 + frame.response.bass * 0.04 + hits.flash * 0.02, step, 0.08);
      streak.value = approach(streak.value, 0.6 + frame.response.loudness * 1.4 + hits.flash * 0.6, step, 0.2);
      fibres.value = 0.25 + frame.audio.highs * 0.75;
      fringe.value = 0.003 + hits.flash * 0.01;
      burst.value = hits.flash;
      gain.value = 0.45 + hits.flash * 0.5;
    },
    dispose: () => disposeScene(scene),
  };
}

// ---------------------------------------------------------------- Hair Vortex

export function createHairVortexMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const aspect = uniform(1), time = uniform(0), arm = uniform(0), eye = uniform(0.1), length = uniform(1), gain = uniform(1), shed = uniform(0);
  const p = uv().sub(0.5).mul(vec2(aspect, 1));
  const r = p.length(), angle = atan(p.y, p.x);
  // Radial filaments: thousands of angular cells, each a hair of its own length and brightness.
  let hair: F = float(0);
  for (const [count, seed] of [[900, 1], [1500, 2], [2400, 3]] as const) {
    const a = angle.div(Math.PI * 2).add(0.5).mul(count).add(mx_noise_float(vec3(r.mul(3), seed, time.mul(0.05))).mul(1.5));
    const cell = a.floor(), h = hash2(vec2(cell, seed));
    const reach = h.mul(0.6).add(0.35).mul(length);
    const thin = float(1).sub(fract(a).sub(0.5).abs().mul(2)).pow(3);
    const along = r.smoothstep(eye, eye.add(0.03)).mul(r.smoothstep(reach, reach.mul(0.6)));
    hair = hair.add(thin.mul(along).mul(hash2(vec2(cell, seed + 5)).mul(0.7).add(0.3)));
  }
  // One spiral arm of fine bright grains sweeping round the eye like a comet.
  const spiral = fract(angle.div(Math.PI * 2).sub(r.log().mul(0.35)).sub(arm));
  const armBody = exp(spiral.sub(0.5).abs().mul(-9)).mul(r.smoothstep(eye, eye.add(0.05))).mul(exp(r.mul(-2.2)));
  const grains = hash2(screenCoordinate.xy.div(1.5).floor()).greaterThan(float(0.55).sub(shed.mul(0.2))).select(float(1), float(0.15));
  const blue = vec3(0.008, 0.03, 1).mul(hair.mul(0.55)).add(vec3(0.16, 0.4, 1).mul(armBody.mul(grains).mul(1.6)));
  const hole = r.smoothstep(eye.mul(0.95), eye.add(0.01));
  material.fragmentNode = vec4(blue.mul(hole).mul(gain).add(vec3(0.0006, 0.0014, 0.01)), 1);

  const hits = createHits({ decay: 0.5, interval: 0.5 });
  let phase = 0;
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      const step = settleStep(frame);
      hits.update(frame, 0.8);
      // The arm turns a quarter turn a second, faster when the music drives harder; no hard cuts.
      if (!frame.reducedMotion) phase += frame.delta * (0.18 + frame.response.bounce * 0.15);
      arm.value = phase;
      length.value = approach(length.value, 0.9 + frame.response.bass * 0.2, step, 0.25);
      eye.value = approach(eye.value, 0.09 + frame.response.bass * 0.02, step, 0.25);
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
