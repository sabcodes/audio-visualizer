import * as THREE from 'three/webgpu';
import { atan, cos, positionLocal, sin, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { ModeFrame, VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene } from './shared';
import { createLineMode } from './lineModes';

export function createKaleidoscopeMode(): VisualMode {
  const { scene, camera } = sceneDefaults(100);
  camera.position.set(0, 65, 90); camera.lookAt(0, 0, 0);
  const time = uniform(0), bass = uniform(0), mid = uniform(0), highs = uniform(0), angle = uniform(0), aspect = uniform(1);
  const color = uniform(new THREE.Color(0x00ffff));
  const p = positionLocal;
  const height = sin(p.x.mul(0.3).add(time.mul(1.2))).mul(bass.mul(3).add(0.6))
    .add(sin(p.z.mul(0.42).add(time)).mul(mid.mul(2.2).add(0.6)))
    .add(sin(p.x.add(p.z).mul(0.23).add(time.mul(0.8))).mul(highs.mul(1.8).add(0.4)))
    .add(cos(p.xz.length().mul(1.44).sub(time.mul(2))).mul(bass.mul(2.8).add(0.4))).mul(3.8);
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  material.positionNode = vec3(p.x, height, p.z);
  material.colorNode = color.mul(height.mul(0.025).add(0.6).clamp(0.2, 1.3));
  const geometry = new THREE.PlaneGeometry(90, 90, 120, 120);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; scene.add(mesh);
  return {
    scene, camera,
    update(frame) {
      time.value = frame.time; bass.value = frame.response.bounce;
      mid.value = frame.audio.mid; highs.value = frame.audio.highs;
      angle.value = frame.time * 0.55; aspect.value = frame.aspect;
      color.value.setHSL((frame.hue + 0.2) % 1, 1, 0.55);
      resizeCamera(camera, frame.aspect);
    },
    filter(input) {
      // Fold and sample the ACTUAL deformed scene pass, not a replacement pattern.
      const p = uv().sub(0.5).mul(vec2(aspect, 1));
      const radius = p.length();
      const a = atan(p.y, p.x).add(angle).mod(Math.PI / 4).sub(Math.PI / 8).abs();
      const sampleUV = vec2(cos(a), sin(a)).mul(radius).div(vec2(aspect, 1)).add(0.5).clamp(0, 1);
      return input.sample(sampleUV).mul(radius.smoothstep(0.2, 0.9).oneMinus().mul(0.55).add(0.7));
    },
    dispose: () => disposeScene(scene),
  };
}

// Legacy parity: RGBShiftShader stayed on at 0.0015 and GlitchPass fired bursts every
// ~2–4 s even in silence. Bursts are seeded by time so captures stay deterministic.
export function glitchAmounts(frame: Pick<ModeFrame, 'time' | 'audio' | 'response' | 'reducedFlash'>) {
  const shift = 0.0015 + frame.response.impact * 0.012 + frame.audio.highs * 0.004;
  const slot = Math.floor(frame.time / 3);
  const seed = Math.abs(Math.sin(slot * 12.9898) * 43758.5453) % 1;
  const scheduled = frame.time - slot * 3 - seed * 2 < 0.18 && frame.time - slot * 3 >= seed * 2;
  const burst = frame.reducedFlash ? 0 : Math.max(scheduled ? 0.02 : 0, frame.response.impact * 0.018);
  return { shift: frame.reducedFlash ? Math.min(shift, 0.003) : shift, burst };
}

export function createGlitchMode(): VisualMode {
  const ring = createLineMode('glitchRing');
  const time = uniform(0), amount = uniform(0.0015), burst = uniform(0);
  return {
    ...ring,
    update(frame) {
      ring.update(frame); time.value = frame.time;
      const next = glitchAmounts(frame);
      amount.value = next.shift; burst.value = next.burst;
    },
    filter(input) {
      const p = uv();
      const stripe = sin(p.y.mul(90).add(time.mul(12))).smoothstep(0.7, 1);
      const offset = burst.mul(stripe.add(0.3)).mul(sin(time.mul(17)));
      const base = p.add(vec2(offset, 0)).clamp(0, 1);
      return vec4(input.sample(base.add(vec2(amount, 0)).clamp(0, 1)).r, input.sample(base).g, input.sample(base.sub(vec2(amount, 0)).clamp(0, 1)).b, 1);
    },
  };
}
