import * as THREE from 'three/webgpu';
import { atan, cos, sin, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import { disposeScene } from './shared';

export function createFullscreenMode(id: 'vjRings' | 'neonKaleido'): VisualMode {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  camera.position.z = 1;
  const time = uniform(0), bass = uniform(0), mid = uniform(0), highs = uniform(0);
  const punch = uniform(0), aspect = uniform(1), hue = uniform(0), flash = uniform(0);
  const p = uv().sub(0.5).mul(2).mul(vec2(aspect, 1)).div(bass.mul(0.32).add(1));
  const r = p.length();
  const angle = atan(p.y, p.x).add(time.mul(0.25).add(mid.mul(0.3)));
  const sector = Math.PI * 2 / 8;
  const folded = angle.mod(sector).sub(sector / 2).abs();
  const foldedP = vec2(cos(folded), sin(folded)).mul(r);
  const fade = r.smoothstep(0.15, 1.35).oneMinus();
  let intensity;
  if (id === 'vjRings') {
    const d = r.sub(bass.mul(0.28).add(0.36));
    const k = mid.mul(6).add(6).mul(Math.PI * 2);
    const wt = time.mul(0.6).add(mid.mul(2));
    const width = bass.mul(0.25).add(0.07);
    const band = cos(d.mul(k).sub(wt)).smoothstep(width.oneMinus(), 1).mul(cos(folded.mul(2)).mul(0.4).add(0.6));
    const second = cos(d.mul(1.8).mul(k).sub(wt.mul(1.7))).smoothstep(width.mul(0.55).oneMinus(), 1).mul(0.5);
    intensity = band.add(second).mul(fade);
  } else {
    const spokes = [0, 1, 2, 3].map((i) => {
      const direction = time.mul(0.8).add(i * 0.6);
      const distance = foldedP.x.mul(sin(direction).negate()).add(foldedP.y.mul(cos(direction))).abs();
      return distance.div(highs.mul(0.035).add(0.012)).smoothstep(0, 1).oneMinus();
    });
    const s = sin(r.mul(mid.mul(12).add(6)).sub(time.mul(1.6)));
    const width = bass.mul(0.25).add(0.08);
    const rings = s.smoothstep(width.negate(), width).sub(s.smoothstep(width, width.mul(2)));
    // Optional continuous modulation, never the legacy full-black hard gate.
    const gate = sin(time.mul(10).add(highs.mul(20))).mul(flash).add(1).sub(flash);
    intensity = spokes[0].add(spokes[1]).add(spokes[2]).add(spokes[3]).mul(0.6).add(rings).mul(gate).mul(fade);
  }
  const palette = vec3(cos(hue.mul(Math.PI * 2)), cos(hue.mul(Math.PI * 2).sub(2.094)), cos(hue.mul(Math.PI * 2).add(2.094))).mul(0.5).add(0.5);
  const material = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  material.fragmentNode = vec4(palette.mul(intensity).mul(punch.mul(0.25).add(1.3)), 1);
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  return {
    scene, camera,
    update(frame) {
      time.value = frame.time; aspect.value = frame.aspect;
      bass.value = frame.response.bounce;
      mid.value = frame.audio.mid; highs.value = frame.audio.highs;
      hue.value = frame.hue; punch.value = frame.reducedFlash ? 0 : frame.response.impact;
      flash.value = frame.reducedFlash ? 0 : 0.18;
    },
    dispose: () => disposeScene(scene),
  };
}
