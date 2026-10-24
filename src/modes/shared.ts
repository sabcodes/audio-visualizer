import * as THREE from 'three/webgpu';
import type { ModeFrame } from './types';

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
/** Dispose shared geometry/material/texture resources once, never through a global cache. */
export function disposeScene(scene: THREE.Scene) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
    if (object instanceof THREE.InstancedMesh) object.dispose();
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  scene.clear();
}
