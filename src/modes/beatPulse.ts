import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { exp, uniform, vec2 } from 'three/tsl';
import type { ModeFrame } from './types';
import { approach, settleStep } from './shared';

const WAVE_LIFE = 1.2, WAVE_SPEED = 0.9;

/**
 * Music-driven motion for fullscreen simulations whose own patterns evolve too slowly to show the beat:
 * the view breathes in with the bounce, and each beat sends a ripple out from a point that pushes the
 * image aside and lights it as it passes. Reduced motion holds the view still.
 */
export function createBeatPulse() {
  const breathe = uniform(0), surge = uniform(0), waveAt = uniform(new THREE.Vector2(0.5, 0.5)), waveRadius = uniform(-1), waveStrength = uniform(0);
  let age = -1, strength = 0;
  return {
    /** Bounce level, eased: use it to lift brightness. */
    surge,
    /** Current ripple strength, 0 when no ripple is travelling. */
    get ripple() { return waveStrength.value; },
    /** Warp a 0–1 UV by the breathing zoom and the ripple; `ring` is how strongly the ripple covers this pixel. */
    warp(p: Node<'vec2'>, aspect: number) {
      const zoomed = p.sub(0.5).mul(breathe.mul(-0.06).add(1)).add(0.5);
      const d = zoomed.sub(waveAt).mul(vec2(aspect, 1)), r = d.length();
      const band = r.sub(waveRadius).div(0.05), ring = exp(band.mul(band).negate()).mul(waveStrength);
      const push = d.div(r.max(1e-4)).mul(ring.mul(0.02)).div(vec2(aspect, 1));
      return { uv: zoomed.sub(push), ring };
    },
    /** Call once per frame; pass `beat` when the mode's beat gate fires, with an optional ripple centre in UV. */
    update(frame: ModeFrame, beat: boolean, at?: readonly [number, number]) {
      const step = settleStep(frame), still = frame.reducedMotion;
      breathe.value = approach(breathe.value, still ? 0 : frame.response.bounce, step, 0.06);
      // Fast attack, slower release, so hits read as flashes of energy rather than a flat level.
      surge.value = Math.max(frame.response.bounce, approach(surge.value, frame.response.bounce, step, 0.25));
      if (beat && !still) { age = 0; strength = 0.6 + frame.response.impact * 0.6; waveAt.value.set(...(at ?? [0.5, 0.5])); }
      if (age >= 0) {
        age += step;
        waveRadius.value = age * WAVE_SPEED; waveStrength.value = strength * Math.max(0, 1 - age / WAVE_LIFE);
        if (age > WAVE_LIFE) { age = -1; waveRadius.value = -1; waveStrength.value = 0; }
      }
    },
  };
}
