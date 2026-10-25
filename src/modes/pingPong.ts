import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { texture } from 'three/tsl';

export type Sampler = (uv: Node<'vec2'>) => Node<'vec4'>;

/**
 * Two half-float targets that alternate as source and destination for simulation or feedback passes.
 * Every pass and view is built twice, once per source target, so no texture binding ever changes at runtime.
 */
export function createPingPong(width: number, height: number, filter: THREE.MagnificationTextureFilter = THREE.LinearFilter) {
  const targets = [0, 1].map(() => {
    const target = new THREE.RenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: false });
    target.texture.minFilter = target.texture.magFilter = filter;
    return target;
  });
  const disposables: THREE.Material[] = [];
  let latest = 0;
  const reader = (i: number): Sampler => (uv) => texture(targets[i].texture, uv) as unknown as Node<'vec4'>;
  const build = (fragment: (read: Sampler) => Node) => [0, 1].map((i) => {
    const material = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
    material.fragmentNode = fragment(reader(i));
    disposables.push(material);
    return material;
  });
  return {
    get width() { return width; },
    get height() { return height; },
    /** A pass that writes the next state from the latest one; `after` may draw more into the same target. */
    pass(fragment: (read: Sampler) => Node) {
      const quads = build(fragment).map((material) => new THREE.QuadMesh(material));
      return (renderer: THREE.WebGPURenderer, after?: (renderer: THREE.WebGPURenderer) => void) => {
        const prior = renderer.getRenderTarget(), autoClear = renderer.autoClear;
        renderer.setRenderTarget(targets[1 - latest]);
        quads[latest].render(renderer);
        if (after) { renderer.autoClear = false; after(renderer); renderer.autoClear = autoClear; }
        renderer.setRenderTarget(prior);
        latest = 1 - latest;
      };
    },
    /** Materials that display the state; `current()` is the one reading the latest target. */
    view(fragment: (read: Sampler) => Node) {
      const materials = build(fragment);
      return () => materials[latest];
    },
    dispose() { for (const target of targets) target.dispose(); for (const material of disposables) material.dispose(); },
  };
}
export type PingPong = ReturnType<typeof createPingPong>;
