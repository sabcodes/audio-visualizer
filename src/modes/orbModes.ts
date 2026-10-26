import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { atan, cos, exp, float, fract, fwidth, log, mix, mx_fractal_noise_float, mx_noise_float, mx_worley_noise_vec2, sin, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import { disposeScene, approach, settleStep } from './shared';
import { fullscreen, palette } from './shaderModes';
import { createHits, linearRgb } from './hitPulse';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

const centred = (aspect: F) => uv().sub(0.5).mul(vec2(aspect, 1));
const rgb = (hex: number) => vec3(...linearRgb(hex));
const rotate2 = (p: V2, angle: F) => vec2(p.x.mul(cos(angle)).sub(p.y.mul(sin(angle))), p.x.mul(sin(angle)).add(p.y.mul(cos(angle))));

// ---------------------------------------------------------------- Dot Vortex

/** Orb radius as a fraction of frame height, and the lens strength (Einstein radius squared) at rest. */
export const VORTEX_ORB = 0.16, VORTEX_LENS = 0.035;

/**
 * Dot Vortex (wave 5, clip 10): a white orb with a pink rim, wrapped in an
 * endless dotted lattice that a gravitational lens bends into a fan above and a curling spiral below, with
 * tangential streaks across the equator. The orb barely moves: the bounce lives in the lattice (inward
 * scroll, twist and lens strength pulse with the bass), and the rainbow rotates around it.
 */
export function createDotVortexMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const aspect = uniform(1), radius = uniform(VORTEX_ORB), lens = uniform(VORTEX_LENS), scroll = uniform(0), twist = uniform(0.02);
  const hueShift = uniform(0), tilt = uniform(0), pulse = uniform(0), gain = uniform(0.9), nudge = uniform(new THREE.Vector2());
  const p = centred(aspect).sub(nudge), r = p.length().max(1e-4);
  const disc = rotate2(p, tilt.negate());
  // Lens equation: the lattice point seen at radius r sits at r − θE²/r in the source plane.
  const beta = r.sub(lens.div(r)), source = beta.abs().add(0.004);
  const angle = atan(p.y, p.x);
  // The lower hemisphere curls into a spiral, the upper one fans out with only a little twist.
  const lower = disc.y.smoothstep(0.05, -0.12);
  const a = angle.add(twist.mul(mix(float(0.35), float(1.6), lower)).div(source.add(0.03)));
  // Log-polar cells are conformal: dots stay round and grow with distance like an infinite tunnel.
  const rays = 72, cell = vec2(a.mul(rays / (Math.PI * 2)), log(source).sub(scroll).mul(rays / (Math.PI * 2)));
  const f = fract(cell).sub(0.5);
  // Across the equatorial band the dots stretch along the tangent into streaks.
  const band = exp(disc.y.div(radius.mul(0.55)).pow(2).negate()).mul(r.smoothstep(radius, radius.mul(1.4)));
  const stretched = vec2(f.x.div(band.mul(5).add(1)), f.y.mul(band.mul(0.4).add(1)));
  const d = stretched.length(), aa = fwidth(d).max(0.01);
  const dot = d.smoothstep(float(0.24).add(aa), float(0.24).sub(aa));
  // Where cells shrink below a pixel (beside the ring) fall back to the dots' average coverage instead of aliasing.
  const crowd = fwidth(cell.y).smoothstep(0.35, 0.9);
  const coverage = mix(dot, float(0.22), crowd);
  const hue = angle.div(Math.PI * 2).add(hueShift).add(r.mul(0.3));
  const lift = exp(r.sub(radius).div(0.12).negate()).mul(0.9).add(1);
  const lattice = palette(hue).pow(vec3(1.6)).mul(coverage).mul(lift).mul(pulse.mul(0.8).add(0.55)).mul(r.smoothstep(radius.mul(0.98), radius.mul(1.05)));
  // The orb: a hot white disc, a hairline pink rim and a wide soft pink-white bloom.
  const inside = r.smoothstep(radius, radius.mul(0.99));
  const out = r.sub(radius).max(0);
  const rim = rgb(0xff6fae).mul(exp(out.div(0.012).negate()).mul(1.4).add(exp(out.div(0.09).negate()).mul(0.35)));
  const colour = lattice.add(rim.mul(inside.oneMinus())).add(vec3(1, 0.97, 0.98).mul(inside));
  material.fragmentNode = vec4(colour.mul(gain), 1);

  const hits = createHits({ decay: 0.15, interval: 0.18 });
  let flow = 0, swirl = 0, kick = 0, turn = 0;
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect;
      const step = settleStep(frame), motion = frame.reducedMotion ? 0 : frame.delta, { bass, loudness, bounce } = frame.response;
      hits.update(frame, 0.1);
      if (hits.fired) kick = 1;
      kick *= Math.exp(-step / 0.25);
      // The lattice scrolls inward faster with loudness and lurches on every hit; the twist winds up on the bass.
      flow += motion * (0.12 + loudness * 0.5 + bounce * 0.6 + kick * 1.2);
      scroll.value = flow;
      swirl = approach(swirl, 0.012 + bass * 0.03 + kick * 0.02, step, 0.12);
      twist.value = swirl;
      lens.value = approach(lens.value, VORTEX_LENS * (1 + bass * 0.6 + kick * 0.25), step, 0.08);
      radius.value = approach(radius.value, VORTEX_ORB * (1 + bass * 0.08), step, 0.1);
      turn += motion * (0.05 + frame.audio.mid * 0.3);
      hueShift.value = turn;
      // A slow ±15° roll of the streak band; the orb itself moves at most a few pixels.
      tilt.value = Math.sin(frame.time * 0.35) * 0.26 * (frame.reducedMotion ? 0 : 1);
      nudge.value.set(Math.sin(frame.time * 1.3) * 0.004 * bounce, kick * 0.006);
      pulse.value = hits.flash * 0.6 + bass * 0.3;
      gain.value = 0.85 + hits.flash * 0.15;
    },
    dispose: () => disposeScene(scene),
  };
}

// ---------------------------------------------------------------- Cracked Globe

/** One globe cycle in beats, and when the ring runs (fractions of the cycle): spot, pass end, veins end. */
export const GLOBE_CYCLE = { beats: 4, spot: 0.09, pass: 0.6, veins: 0.75 } as const;

/** The scanner state at a point of the cycle (0–1): where the ring is (1 top, −1 bottom), cap fill, veining, lightning. */
export function globePhase(t: number) {
  const { spot, pass, veins } = GLOBE_CYCLE;
  const run = Math.min(1, Math.max(0, (t - spot) / (pass - spot)));
  const ease = run * run * (3 - 2 * run);
  return {
    ring: 1 - ease * 1.85,
    spot: Math.exp(-Math.abs(t - spot) / 0.04),
    fill: t < spot ? t / spot : Math.max(0, 1 - (t - spot) / (veins - spot)),
    veins: Math.min(1, Math.max(0, (t - (spot + pass) / 2) / (veins - (spot + pass) / 2))),
    jag: Math.min(1, Math.max(0, (t - pass * 0.8) / (veins - pass * 0.8))) * Math.max(0, 1 - (t - veins) / (1 - veins)),
    ringGlow: t < spot ? 0 : Math.max(0, 1 - Math.max(0, t - veins) / (1 - veins)),
  };
}

/**
 * Cracked Globe (wave 5, clip 8): a glass sphere made only of electric-blue fracture lines, a small halo
 * ring above. A kick lights the north pole; a scanner ring slides down the globe (one pass per two beats),
 * the cap behind it fills with white light that breaks into dripping veins, and the ring sags into a jagged
 * lightning loop at the south pole. Layered rock silhouettes catch the light below.
 */
export function createCrackedGlobeMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const aspect = uniform(1), time = uniform(0), spin = uniform(0), cracks = uniform(0.4), ringY = uniform(1.2), spot = uniform(0), fill = uniform(0);
  const veins = uniform(0), jag = uniform(0), ringGlow = uniform(0), halo = uniform(0.3), jitter = uniform(0), bob = uniform(0);
  const R = 0.3, centre = vec2(0, float(0.04).add(bob));
  const p = centred(aspect), q = p.sub(centre), qr = q.length();
  const inside = qr.smoothstep(R, R - 0.003);
  const z = float(R * R).sub(q.dot(q)).max(0).sqrt();
  // Front and back points of the transparent shell, as unit normals; the shell turns slowly about its axis.
  const turn = (n: V3) => vec3(n.x.mul(cos(spin)).add(n.z.mul(sin(spin))), n.y, n.z.mul(cos(spin)).sub(n.x.mul(sin(spin))));
  const front = vec3(q, z).div(R), back = vec3(q, z.negate()).div(R);
  const crackAt = (n: V3, width: F) => {
    const cell = mx_worley_noise_vec2(turn(n).mul(3.2).add(vec3(mx_noise_float(turn(n).mul(5)).mul(0.25))));
    const edge = cell.y.sub(cell.x);
    // Fine secondary cracks inside the big plates.
    const fine = mx_worley_noise_vec2(turn(n).mul(8.5));
    return edge.smoothstep(width, 0).add(fine.y.sub(fine.x).smoothstep(width.mul(0.5), 0).mul(0.35));
  };
  const shell = (n: V3, w: number) => {
    const c = crackAt(n, float(0.06));
    // Height along the globe's axis, seen from slightly above, so the ring reads as an ellipse with its near arc lower.
    const h = n.y.mul(Math.cos(0.3)).add(n.z.mul(Math.sin(0.3)));
    // The cap above the ring fills white, its lower edge dripping; the fill then breaks into veins that run downward.
    const drip = mx_fractal_noise_float(vec3(turn(n).x.mul(6), turn(n).z.mul(6), time.mul(0.4)), 3).mul(0.22);
    const streak = mx_fractal_noise_float(vec3(turn(n).x.mul(14), n.y.mul(3).add(time.mul(1.5)), turn(n).z.mul(14)), 3).abs();
    const capEdge = h.sub(ringY.add(drip.abs()).sub(0.05));
    const cap = capEdge.smoothstep(-0.05, 0.08);
    const veinMask = mix(float(1), streak.smoothstep(0.1, 0).add(c.mul(0.8)).clamp(0, 1), veins);
    const capLight = cap.mul(fill).mul(veinMask);
    // The ring: a bright band at the ring height, jagged into lightning near the south pole.
    const around = atan(turn(n).z, turn(n).x);
    const wobble = mx_noise_float(vec2(around.mul(9), time.mul(18))).mul(0.12).add(mx_noise_float(vec2(around.mul(31), time.mul(30))).mul(0.05)).mul(jag);
    const band = exp(h.sub(ringY.add(wobble)).abs().div(float(0.018).add(jag.mul(0.01))).negate()).mul(ringGlow);
    const sparks = mx_noise_float(vec3(around.mul(40), n.y.mul(40), time.mul(12))).smoothstep(0.35, 0.7).mul(jitter).mul(exp(h.sub(ringY).abs().div(0.08).negate())).mul(ringGlow);
    const blue = rgb(0x2f7bff), ice = rgb(0x9fd2ff);
    return blue.mul(c.mul(cracks)).add(ice.mul(c.mul(capLight).mul(1.5))).add(vec3(0.85, 0.93, 1).mul(capLight.mul(0.9)))
      .add(ice.mul(band.mul(2.2))).add(vec3(0.8, 0.9, 1).mul(sparks)).mul(w);
  };
  const fresnel = qr.div(R).pow(6).mul(inside);
  const pole = exp(q.sub(vec2(0, R * 0.96)).length().div(0.035).negate()).mul(spot);
  let globe: V3 = shell(back, 0.35).add(shell(front, 1)).mul(inside);
  globe = globe.add(rgb(0x3a7bff).mul(fresnel.mul(cracks.mul(0.6).add(0.15))))
    .add(vec3(1).mul(pole.mul(3))).add(rgb(0x8cc4ff).mul(exp(q.sub(vec2(0, R)).length().div(0.12).negate()).mul(spot.mul(0.8))));
  // Glow around the globe: the ring's light and the cracks' haze.
  const outside = qr.sub(R).max(0);
  globe = globe.add(rgb(0x2a5cff).mul(exp(outside.div(0.06).negate()).mul(cracks.mul(0.25).add(fill.mul(0.4)).add(ringGlow.mul(0.15)))).mul(inside.oneMinus()));
  // The halo: a thin tilted ring floating above the north pole.
  const h = q.sub(vec2(0, R + 0.075)), ringD = vec2(h.x, h.y.mul(4.2)).length().sub(0.075).abs();
  globe = globe.add(rgb(0x9fd2ff).mul(exp(ringD.div(0.0035).negate()).mul(halo.mul(1.2))).add(rgb(0x2f7bff).mul(exp(ringD.div(0.02).negate()).mul(halo.mul(0.35)))));
  // Rock strip: two layers of jagged silhouettes, their top edges rim-lit by the globe.
  const light = cracks.mul(0.3).add(fill.mul(0.8)).add(ringGlow.mul(0.4));
  let rocks: V3 = vec3(0), rockMask: F = float(0);
  for (const [base, scale, seed, shade] of [[-0.36, 2.2, 3, 0.012], [-0.43, 3.4, 9, 0.004]] as const) {
    const edge = mx_fractal_noise_float(vec2(p.x.mul(scale).add(seed), seed), 4).mul(0.06).add(float(base)).add(p.x.abs().mul(0.04));
    const below = p.y.smoothstep(edge, edge.sub(0.002));
    const rim = exp(edge.sub(p.y).max(0).div(0.006).negate()).mul(below).mul(exp(p.x.abs().div(0.5).negate()));
    rocks = mix(rocks, vec3(shade, shade * 1.1, shade * 1.6).add(rgb(0x6aa8ff).mul(rim.mul(light))), below);
    rockMask = rockMask.max(below);
  }
  const fog = rgb(0x0a1430).mul(exp(p.y.add(0.3).abs().div(0.12).negate()).mul(0.25));
  material.fragmentNode = vec4(mix(globe.add(fog), rocks, rockMask), 1);

  const hits = createHits({ decay: 0.2, interval: 0.25 });
  let phase = 1, beat = 0.55, lastHit = -Infinity, turned = 0;
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      const step = settleStep(frame), { loudness, bass } = frame.response;
      hits.update(frame, 0.1);
      // Tempo from the gaps between hits, so one pass of the ring takes two beats.
      if (hits.fired) {
        const gap = frame.time - lastHit;
        if (gap > 0.3 && gap < 1.2) beat = approach(beat, gap, gap, 2);
        lastHit = frame.time;
      }
      const cycle = beat * GLOBE_CYCLE.beats;
      // A kick starts a new cycle once the last one has mostly played out; loud music with no onsets keeps it cycling.
      if ((hits.fired && phase > 0.7) || (phase >= 1 && loudness > 0.35)) phase = 0;
      phase = Math.min(1, phase + step / cycle);
      const s = globePhase(phase), flashCap = frame.reducedFlash ? 0.4 : 1;
      ringY.value = phase >= 1 ? 1.3 : s.ring;
      spot.value = s.spot * flashCap;
      fill.value = s.fill * (frame.reducedFlash ? 0.6 : 1);
      veins.value = s.veins; jag.value = s.jag; ringGlow.value = s.ringGlow;
      jitter.value = approach(jitter.value, frame.audio.highs, step, 0.05);
      cracks.value = approach(cracks.value, 0.35 + loudness * 0.8 + hits.flash * 0.4, step, 0.08);
      halo.value = approach(halo.value, 0.3 + bass * 0.9, step, 0.06);
      turned += (frame.reducedMotion ? 0 : frame.delta) * (0.08 + frame.response.bounce * 0.3);
      spin.value = turned;
      bob.value = frame.reducedMotion ? 0 : Math.sin(frame.time * 0.9) * 0.006 + bass * 0.006;
    },
    dispose: () => disposeScene(scene),
  };
}
