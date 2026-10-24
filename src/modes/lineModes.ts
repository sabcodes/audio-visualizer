import * as THREE from 'three/webgpu';
import type { ModeFrame, VisualMode } from './types';
import { sceneDefaults, resizeCamera, colorize, disposeScene, wrap } from './shared';
import { seededRandom } from '../rendering/diagnostics';

type LineMode = 'circle' | 'spiral' | 'star' | 'cube' | 'lissajous' | 'fftTunnel' | 'glitchRing';
export function createLineMode(id: LineMode): VisualMode {
  const { scene, camera } = sceneDefaults(id === 'star' ? 240 : 95);
  if (id === 'circle' || id === 'spiral') { camera.position.set(0, 45, 75); camera.lookAt(0, 0, 0); }
  const random = seededRandom(42);
  const count = id === 'star' ? 320 : id === 'lissajous' ? 1200 : id === 'fftTunnel' ? 129 : id === 'glitchRing' ? 513 : 512;
  const lineCount = id === 'lissajous' ? 3 : id === 'fftTunnel' ? 28 : 1;
  const lines: { positions: Float32Array; geometry: THREE.BufferGeometry; material: THREE.LineBasicNodeMaterial; object: THREE.Line; z: number }[] = [];
  for (let i = 0; i < lineCount; i++) {
    const positions = new Float32Array(count * 3), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicNodeMaterial({ color: 0x00ffff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    const object = id === 'star' ? new THREE.LineSegments(geometry, material) : new THREE.Line(geometry, material);
    object.frustumCulled = false; scene.add(object);
    lines.push({ positions, geometry, material, object, z: -i * 900 / 28 });
  }
  const directions = new Float32Array(160 * 3), baseLengths = new Float32Array(160), phases = new Float32Array(160), ema = new Float32Array(160);
  for (let i = 0; i < 160; i++) {
    const z = 1 - 2 * (i + 0.5) / 160, radius = Math.sqrt(1 - z * z), a = i * (Math.sqrt(5) - 1) * Math.PI;
    directions[i * 3] = Math.cos(a) * radius; directions[i * 3 + 1] = Math.sin(a) * radius; directions[i * 3 + 2] = z;
    baseLengths[i] = 10 + random() * 10; phases[i] = random() * Math.PI * 2;
  }
  const noise = Float32Array.from({ length: 512 }, () => random() * 2 - 1);
  function fill(frame: ModeFrame) {
    const { audio, response, time, delta } = frame;
    const pump = response.bounce;
    if (id !== 'fftTunnel') scene.rotation.y = time * 0.18;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex], pos = line.positions;
      colorize(line.material, frame, lineIndex * 0.08);
      line.material.color.multiplyScalar(2); // Scene-linear neon headroom for the shared bloom pass.
      line.material.opacity = id === 'lissajous' ? [0.95, 0.65, 0.55][lineIndex] : 0.9;
      if (id === 'fftTunnel') line.z = wrap(line.z + (220 + response.bass * 420) * delta, -900, 50);
      for (let i = 0; i < count; i++) {
        const p = i * 3, u = i / (count - 1), phase = u * Math.PI * 2;
        const wave = (audio.waveform[Math.floor(u * (audio.waveform.length - 1))] || 0) * 12.8;
        if (id === 'circle' || id === 'spiral') {
          const angle = phase * (id === 'spiral' ? 5 : 1);
          const radius = (id === 'circle' ? 20 : 5 + u * 20) * (1 + pump * 0.65) + wave;
          pos[p] = Math.cos(angle) * radius; pos[p + 1] = (id === 'spiral' ? (u - 0.5) * 20 : 0) + wave * (id === 'circle' ? 2 : 1); pos[p + 2] = Math.sin(angle) * radius;
        } else if (id === 'cube') {
          const x = (Math.floor(i / 64) / 7 - 0.5) * 30, y = (Math.floor(i / 8) % 8 / 7 - 0.5) * 30, z = (i % 8 / 7 - 0.5) * 30;
          const scale = 1 + pump * 0.8 + wave / Math.max(1, Math.hypot(x, y, z));
          pos[p] = x * scale; pos[p + 1] = y * scale; pos[p + 2] = z * scale;
        } else if (id === 'star') {
          const spike = Math.floor(i / 2), d = spike * 3;
          if (i % 2 === 0) { pos[p] = pos[p + 1] = pos[p + 2] = 0; continue; }
          const bin = Math.floor((spike / 159) ** 1.2 * (audio.spectrum.length - 1));
          let energy = 0;
          for (let k = -2; k <= 2; k++) energy += audio.spectrum[Math.max(0, Math.min(audio.spectrum.length - 1, bin + k))] || 0;
          ema[spike] += (energy / 1275 - ema[spike]) * (1 - Math.exp(-Math.max(0, delta) / 0.047));
          const length = baseLengths[spike] + ema[spike] * 120 + pump * 65;
          const wobble = (2 + ema[spike] * 12) * Math.sin(time * 7.5 + phases[spike]);
          pos[p] = directions[d] * length + wobble; pos[p + 1] = directions[d + 1] * length; pos[p + 2] = directions[d + 2] * length + wobble * 0.7;
        } else if (id === 'lissajous') {
          const ph = time * [1.5, 1.2, 1][lineIndex] + lineIndex * 0.8;
          pos[p] = Math.sin((3 + Math.round(audio.mid * 4)) * phase + ph) * (26 + pump * 20);
          pos[p + 1] = Math.sin((2 + Math.round(audio.highs * 5)) * phase) * (18 + pump * 16);
          pos[p + 2] = Math.sin(phase * 0.5 + ph) * audio.highs * 10 + (lineIndex - 1) * 6;
        } else if (id === 'fftTunnel') {
          const energy = (audio.spectrum[Math.min(audio.spectrum.length - 1, Math.floor(u * audio.spectrum.length))] || 0) / 255;
          const radius = (18 + lineIndex * 0.6) * (1 + energy * 0.6 + pump * 0.45);
          pos[p] = Math.cos(phase) * radius; pos[p + 1] = Math.sin(phase) * radius; pos[p + 2] = line.z;
        } else {
          const jitter = noise[i % 512] * audio.highs * 6 * Math.sin(time * 12 + i * 0.3);
          const radius = 22 * (1 + pump * 0.65 + 0.02 * Math.sin(i * 0.3 + time * 1.2));
          pos[p] = Math.cos(phase) * radius + jitter; pos[p + 1] = Math.sin(phase) * radius + jitter; pos[p + 2] = Math.sin(i * 0.08 + time * 0.6) * (0.5 + audio.highs * 6);
          line.object.rotation.z = time * 0.12;
        }
      }
      line.geometry.attributes.position.needsUpdate = true;
    }
  }
  return { scene, camera, update(frame) { resizeCamera(camera, frame.aspect); fill(frame); }, dispose: () => disposeScene(scene) };
}
