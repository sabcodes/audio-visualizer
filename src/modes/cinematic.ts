import * as THREE from 'three/webgpu';
import type { Node, TextureNode } from 'three/webgpu';
import { float, fract, mix, screenCoordinate, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { ModeFrame, VisualMode } from './types';
import { hash2 } from './shaderModes';

export interface CinematicOptions {
  /** Film grain amplitude (0.04 subtle – 0.12 heavy). */
  grain?: number;
  /** Radial chromatic fringe at the frame edge, in UV units. */
  aberration?: number;
  /** Vignette strength, 0–1. */
  vignette?: number;
  /** Red-orange halo around bright areas, like film halation. */
  halation?: number;
  /** Soft-focus mix, 0 sharp – 1 fully diffused. */
  soften?: number;
  /** Shadow tint the blacks are lifted toward (linear RGB). */
  shadows?: readonly [number, number, number];
}

/**
 * A camera-like finish for modes that should read as footage rather than clean CG: lens fringe at the
 * edges, a halation glow, soft focus, lifted tinted blacks, animated grain and a vignette. Use the
 * returned `filter` as the mode's filter (or wrap it) and call `update` each frame.
 */
export function createCinematic(options: CinematicOptions = {}) {
  const time = uniform(0), aspect = uniform(1);
  const grain = uniform(options.grain ?? 0.06), aberration = uniform(options.aberration ?? 0.003), vignette = uniform(options.vignette ?? 0.5);
  const halation = uniform(options.halation ?? 0.25), soften = uniform(options.soften ?? 0.2), shadows = uniform(new THREE.Vector3(...(options.shadows ?? [0.004, 0.005, 0.006])));
  return {
    grain, aberration, vignette, halation, soften, shadows,
    update(frame: Pick<ModeFrame, 'time' | 'aspect'>) { time.value = frame.time; aspect.value = frame.aspect; },
    /** The finished frame; `p` lets a mode shake or weave the sampling position. */
    filter(input: TextureNode, p: Node<'vec2'> = uv()): Node<'vec4'> {
      const c = p.sub(0.5), edge = c.mul(vec2(aspect, 1)).length();
      const shift = c.mul(aberration.mul(edge).mul(2));
      const at = (q: Node<'vec2'>) => input.sample(q.clamp(0, 1)).rgb;
      const sharp = vec3(at(p.add(shift)).r, at(p).g, at(p.sub(shift)).b);
      // Eight taps on a ring: a cheap wide blur for soft focus and for the halation glow.
      let wide: Node<'vec3'> = vec3(0);
      for (let i = 0; i < 8; i++) {
        const angle = i / 8 * Math.PI * 2;
        wide = wide.add(at(p.add(vec2(float(Math.cos(angle) * 0.01).div(aspect), Math.sin(angle) * 0.01))));
      }
      wide = wide.div(8);
      const soft = mix(sharp, wide, soften);
      const bright = wide.dot(vec3(0.2126, 0.7152, 0.0722)).sub(0.35).max(0);
      const halo = vec3(1, 0.32, 0.12).mul(bright.mul(halation));
      // Lift the blacks toward the shadow tint, then grain (strongest in the mid-tones) and vignette.
      const graded = soft.add(halo).add(shadows.mul(soft.dot(vec3(0.33)).oneMinus().clamp(0, 1)));
      const luma = graded.dot(vec3(0.2126, 0.7152, 0.0722));
      const noise = hash2(screenCoordinate.xy.add(fract(time.mul(23.17)).mul(419))).sub(0.5);
      const grained = graded.add(vec3(noise.mul(grain).mul(luma.sqrt().mul(0.8).add(0.2))));
      const shade = edge.smoothstep(0.85, 0.3).mul(vignette).add(vignette.oneMinus());
      return vec4(grained.max(vec3(0)).mul(shade), 1);
    },
  };
}
export type Cinematic = ReturnType<typeof createCinematic>;

/** Gives a mode without its own filter the camera finish, so procedural scenes read as footage rather than clean CG. */
export function withCinematic(mode: VisualMode, options: CinematicOptions = {}): VisualMode {
  if (mode.filter) return mode;
  const finish = createCinematic(options);
  return { ...mode, update(frame) { mode.update(frame); finish.update(frame); }, filter: (input) => finish.filter(input) };
}
