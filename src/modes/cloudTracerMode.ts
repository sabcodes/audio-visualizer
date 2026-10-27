import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { exp, float, fract, max, mix, mx_fractal_noise_float, mx_worley_noise_float, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import { disposeScene, approach, settleStep } from './shared';
import { fullscreen, hash2 } from './shaderModes';
import { createHits, linearRgb, variantSequence } from './hitPulse';
import { drive, sectionWatch } from './waveSixShared';
import { seededRandom } from '../rendering/diagnostics';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

/** Tracer gradients, head end first: cyan into magenta, lime into cyan, amber into pink, and the classic ice white. */
export const TRACER_PALETTES: readonly (readonly [number, number])[] = [[0x3af4ff, 0xff3ad8], [0xa8ff3a, 0x3ae0ff], [0xffb03a, 0xff4a9a], [0xdff4ff, 0x8ac8ff]];
/** Headings in frame units (x across, y up): the clip's diagonal, vertical, horizontal, then the other diagonal. */
export const TRACER_HEADINGS: readonly (readonly [number, number])[] = [[0.62, 0.78], [0.05, 1], [1, 0.04], [-0.6, 0.8]];
const TRACERS = 3;

/**
 * Cloud Tracer (wave 6, #4): a deep navy night sky packed with billowing cloud, drifting slowly downward as the
 * camera rises. Big hits fire a tracer: a dotted line of light with a white-hot head and a neon gradient tail
 * that cuts straight across the frame, lighting the cloud it passes through from inside in its own colour. Each
 * new tracer takes a new heading; up to three fly at once when the music is loud.
 */
export function createCloudTracerMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const aspect = uniform(16 / 9), time = uniform(0), rise = uniform(0), spread = uniform(0.1), shimmer = uniform(0), hueShift = uniform(0), moon = uniform(1);
  // Clouds go into a half-size target: fractal noise on every pixel is the expensive part.
  const cloudTarget = new THREE.RenderTarget(960, 540, { type: THREE.HalfFloatType, depthBuffer: false });
  const cloudMaterial = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  const cloudPass = new THREE.QuadMesh(cloudMaterial);
  const tracers = Array.from({ length: TRACERS }, () => ({
    from: uniform(new THREE.Vector2()), dir: uniform(new THREE.Vector2(1, 0)), head: uniform(0), length: uniform(0.6), level: uniform(0),
    flash: uniform(0), front: uniform(new THREE.Color()), back: uniform(new THREE.Color()),
  }));

  const p = uv().sub(0.5).mul(vec2(aspect, 1));
  // Billowing cumulus: domain-warped fractal noise, sampled twice more toward the moon above for a lit top edge.
  const field = (q: V2) => {
    const at = q.add(vec2(0, rise));
    const warp = vec2(mx_fractal_noise_float(vec3(at.mul(0.9), time.mul(0.02)), 2, 2, 0.5), mx_fractal_noise_float(vec3(at.mul(0.9).add(5.2), time.mul(0.02)), 2, 2, 0.5)).mul(0.25);
    const base = mx_fractal_noise_float(vec3(at.mul(1.3).add(warp), time.mul(0.012)), 4, 2, 0.5).mul(0.5).add(0.5);
    // Cauliflower puffs: inverted cellular noise at two sizes heaps round bumps onto the cloud edges.
    const puffs = mx_worley_noise_float(vec3(at.mul(5).add(warp.mul(2)), time.mul(0.03))).oneMinus().mul(0.55).add(mx_worley_noise_float(vec3(at.mul(11).add(warp.mul(3)), time.mul(0.05))).oneMinus().mul(0.3));
    return base.add(puffs.sub(0.45).mul(0.45)).smoothstep(0.36, 0.62);
  };
  const density = field(p).toVar();
  const above = field(p.add(vec2(0.012, 0.035)));
  const topLight = density.sub(above).max(0).mul(3).add(density.mul(0.12));
  // Distance from each tracer's line and head: the glow inside the cloud around where it passes.
  const segment = (t: typeof tracers[number], q: V2) => {
    const along = q.sub(t.from).dot(t.dir), tail = t.head.sub(t.length);
    const clamped = along.clamp(tail.max(0), t.head);
    const offset = q.sub(t.from.add(t.dir.mul(clamped))).length();
    return { along, tail, offset, toHead: q.sub(t.from.add(t.dir.mul(t.head))).length() };
  };
  let inner: V3 = vec3(0);
  for (const t of tracers) {
    const s = segment(t, p);
    const colour = mix(vec3(0.6, 0.8, 1), mix(t.back, t.front, 0.35), 0.75);
    const reach = exp(s.offset.div(spread).negate()).mul(t.level).add(exp(s.toHead.div(spread.mul(1.6)).negate()).mul(t.flash.mul(2)));
    inner = inner.add(colour.mul(reach));
  }
  const sky = mix(vec3(0.003, 0.006, 0.022), vec3(0.001, 0.002, 0.008), uv().y);
  const cloudBody = vec3(0.006, 0.012, 0.04).add(vec3(0.03, 0.06, 0.16).mul(topLight).mul(moon));
  const cloudColour = mix(sky, cloudBody, density).add(inner.mul(density.pow(1.5)).mul(0.8)).add(inner.mul(0.03));
  cloudMaterial.fragmentNode = vec4(cloudColour, density);

  // The tracers themselves, at full resolution: beads every few pixels along the line, hot at the head.
  const clouds = texture(cloudTarget.texture, uv());
  let colour: V3 = clouds.rgb;
  for (const t of tracers) {
    const s = segment(t, p);
    const within = s.along.greaterThan(s.tail).and(s.along.lessThan(t.head)).select(float(1), float(0));
    const u = s.along.sub(s.tail).div(t.length).clamp(0, 1); // 0 at the tail end, 1 at the head
    const gap = 0.0065, bead = fract(s.along.div(gap)).sub(0.5).abs().mul(gap);
    const dot = vec2(bead, s.offset).length();
    const index = s.along.div(gap).floor();
    const twinkle = hash2(vec2(index, time.mul(30).floor())).mul(shimmer).oneMinus();
    const beads = dot.smoothstep(0.0024, 0.0008).mul(twinkle).add(exp(s.offset.div(0.004).negate()).mul(0.25));
    const gradient = mix(t.back, t.front, fract(u.add(hueShift)).mul(1.4).min(1));
    const hot = mix(gradient, vec3(1), u.smoothstep(0.85, 1));
    const fade = u.pow(1.6).mul(within).mul(t.level);
    // A tracer reads through cloud but a little veiled by it.
    colour = colour.add(hot.mul(beads).mul(fade).mul(3.2).mul(clouds.a.mul(0.45).oneMinus()));
    // The white-hot head and a small flare where it is.
    colour = colour.add(vec3(1, 1, 1).mul(exp(s.toHead.div(0.006).negate()).mul(t.level).mul(2.5)));
  }
  material.fragmentNode = vec4(max(colour, vec3(0)), 1);

  const random = seededRandom(123), headings = variantSequence(TRACER_HEADINGS.length, 5), section = sectionWatch(45);
  const hits = createHits({ decay: 0.3, interval: 0.7 });
  const state = tracers.map(() => ({ alive: false, head: 0, length: 0.6, speed: 0.3, span: 2, flash: 0 }));
  let palette = 0, nextSlot = 0, idle = 0, pace = 0;
  const spawn = (strength: number, slow = false) => {
    const k = nextSlot; nextSlot = (nextSlot + 1) % TRACERS;
    const t = tracers[k], s = state[k], [hx, hy] = TRACER_HEADINGS[headings.next()];
    const dir = new THREE.Vector2(hx, hy).normalize(), half = new THREE.Vector2(aspect.value / 2, 0.5);
    // Start just off frame behind the heading, through a random point near the middle.
    const through = new THREE.Vector2((random() - 0.5) * half.x, (random() - 0.5) * 0.6);
    const reach = Math.abs(dir.x) * half.x + Math.abs(dir.y) * half.y + 0.1;
    t.from.value.copy(through).addScaledVector(dir, -reach); t.dir.value.copy(dir);
    s.alive = true; s.head = 0; s.span = reach * 2 + 0.8; s.length = 0.35 + strength * 0.5; s.speed = slow ? 0.18 : 0.45 + strength * 0.5; s.flash = slow ? 0.2 : strength;
    const [front, back] = TRACER_PALETTES[(palette + k) % TRACER_PALETTES.length];
    t.front.value.setRGB(...linearRgb(front)); t.back.value.setRGB(...linearRgb(back));
  };
  spawn(0.4, true);
  return {
    scene, camera,
    simulate(renderer) {
      const prior = renderer.getRenderTarget();
      renderer.setRenderTarget(cloudTarget); cloudPass.render(renderer); renderer.setRenderTarget(prior);
    },
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      const height = 540, width = Math.round(height * frame.aspect);
      if (cloudTarget.width !== width) cloudTarget.setSize(width, height);
      const step = settleStep(frame), motion = frame.reducedMotion ? 0 : frame.delta, { bass, loudness, impact } = frame.response;
      hits.update(frame, 0.1);
      if (section(frame)) palette = (palette + 1) % TRACER_PALETTES.length;
      pace = approach(pace, drive(frame), step, 0.4);
      const live = state.filter((s) => s.alive).length, allowed = loudness > 0.55 ? 3 : loudness > 0.3 ? 2 : 1;
      // Big hits fire a new tracer on a new heading.
      if (hits.fired && impact > 0.4 && live < allowed) { spawn(Math.min(1, 0.5 + impact * 0.5)); idle = 0; }
      idle += step;
      if (live === 0 && idle > 1.5) { spawn(0.3, true); idle = 0; }
      state.forEach((s, k) => {
        const t = tracers[k];
        if (!s.alive) { t.level.value = approach(t.level.value, 0, step, 0.2); t.flash.value = 0; return; }
        // Loudness and the bounce slider set the speed; it never stops, even in silence.
        s.head += motion * s.speed * (0.6 + loudness * 0.8 + pace * 0.6);
        t.head.value = s.head; t.length.value = s.length;
        s.flash = Math.max(0, s.flash - step * 1.5);
        t.flash.value = s.flash * (frame.reducedFlash ? 0.4 : 1);
        t.level.value = approach(t.level.value, 0.7 + loudness * 0.5, step, 0.08);
        if (s.head - s.length > s.span) s.alive = false;
      });
      spread.value = approach(spread.value, 0.07 + bass * 0.12, step, 0.15);
      shimmer.value = approach(shimmer.value, frame.audio.highs * 0.8, step, 0.05);
      hueShift.value = (hueShift.value + motion * frame.audio.mid * 0.15) % 1;
      moon.value = approach(moon.value, 0.8 + loudness * 0.4, step, 1);
      // The camera rises slowly through the cloud field.
      rise.value += motion * (0.012 + pace * 0.02);
    },
    dispose() { disposeScene(scene); cloudMaterial.dispose(); cloudTarget.dispose(); },
  };
}
