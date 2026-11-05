import * as THREE from 'three/webgpu';
import { float, mix, pow, texture as sampleTexture, vec2 } from 'three/tsl';
import type { ModeFrame } from './types';

type F = THREE.Node<'float'>;
import { logBin } from '../audio/analysis';

export function sceneDefaults(z = 85) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 2200);
  camera.position.z = z;
  return { scene, camera };
}
export function resizeCamera(camera: THREE.PerspectiveCamera, aspect: number) {
  if (camera.aspect !== aspect) { camera.aspect = aspect; camera.updateProjectionMatrix(); }
}
export const wrap = (value: number, low: number, high: number) => low + ((value - low) % (high - low) + high - low) % (high - low);
export function colorize(material: THREE.Material & { color: THREE.Color }, frame: ModeFrame, offset = 0) {
  material.color.setHSL(wrap(frame.hue + offset, 0, 1), 1, 0.52 + (frame.reducedFlash ? 0 : frame.response.impact * 0.12));
}
/** Bin for position u along a mode's frequency axis: the mode's own linear bin, or a 30 Hz–16 kHz log bin. */
export function spectrumBin(frame: Pick<ModeFrame, 'spectrumMapping' | 'sampleRate' | 'audio'>, u: number, linearBin: number) {
  return frame.spectrumMapping === 'log' ? logBin(u, frame.audio.spectrum.length, frame.sampleRate) : linearBin;
}
/** Dispose shared geometry/material/texture resources once, never through a global cache. */
export function disposeScene(scene: THREE.Scene) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const skeletons = new Set<THREE.Skeleton>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
    // Object disposal also releases renderer-owned shadow passes and per-object buffers.
    object.dispose();
  });
  // TSL backgrounds own a renderer-created sky mesh outside scene.children.
  scene.backgroundNode?.dispose();
  skeletons.forEach(skeleton => skeleton.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  scene.clear();
}
/** Spectrum bytes as a bins×1 red texture so vertex nodes can sample it without per-instance CPU writes. */
export function createSpectrumTexture(bins = 512) {
  const data = new Uint8Array(bins);
  const texture = new THREE.DataTexture(data, bins, 1, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return {
    texture,
    update(spectrum: Uint8Array) {
      data.fill(0);
      data.set(spectrum.length > bins ? spectrum.subarray(0, bins) : spectrum);
      texture.needsUpdate = true;
    },
    dispose: () => texture.dispose(),
  };
}
/** Mean energy (0–1) of `count` equal slices of the mode's frequency axis, honouring the log/linear setting. */
export function bandEnergies(frame: Pick<ModeFrame, 'spectrumMapping' | 'sampleRate' | 'audio'>, count: number, out = new Float32Array(count)) {
  const spectrum = frame.audio.spectrum, bins = spectrum.length;
  for (let band = 0; band < count; band++) {
    const start = spectrumBin(frame, band / count, Math.floor(band / count * bins));
    const end = Math.max(start + 1, spectrumBin(frame, (band + 1) / count, Math.floor((band + 1) / count * bins)));
    let total = 0;
    for (let i = start; i < end; i++) total += spectrum[i] || 0;
    out[band] = total / ((end - start) * 255);
  }
  return out;
}
/** Exponential approach toward target with the same response at any frame rate. */
export const approach = (current: number, target: number, delta: number, tau: number) => current + (target - current) * (1 - Math.exp(-Math.max(0, delta) / tau));
/**
 * Seconds for transients and audio-following levels to advance by. Reduced motion freezes the clock (delta 0),
 * but a flash or morph caught mid-flight must still finish, and levels should keep following the calmed audio.
 */
export const settleStep = (frame: Pick<ModeFrame, 'delta' | 'reducedMotion'>) => frame.reducedMotion ? 1 / 60 : frame.delta;
/** Fires at most once per `interval` seconds of mode time, on onsets or when the caller forces it. */
export function beatGate(interval: number) {
  let last = -Infinity;
  return (time: number, onset: boolean) => {
    if (time < last) last = -Infinity; // Clock reset (track change or seek): re-arm.
    if (!onset || time - last < interval) return false;
    last = time; return true;
  };
}
/** Spectrum energy node for u ∈ [0, 1] along the same 30 Hz–16 kHz log axis as logBin(); `log` is a 0/1 uniform. */
export function spectrumAxisNode(spectrum: THREE.DataTexture, u: F, log: F, nyquist: F, bins = 512) {
  const logHz = pow(float(16000 / 30), u).mul(30).min(nyquist);
  const bin = mix(u.mul(bins), logHz.div(nyquist).mul(bins), log).floor().clamp(0, bins - 1);
  return sampleTexture(spectrum, vec2(bin.add(0.5).div(bins), 0.5)).r;
}
