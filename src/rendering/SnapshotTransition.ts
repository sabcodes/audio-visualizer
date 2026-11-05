import * as THREE from 'three/webgpu';
import { texture, uniform, vec4 } from 'three/tsl';

export function snapshotSize(width: number, height: number) {
  const scale = Math.min(1, 1920 / Math.max(1, width), 1080 / Math.max(1, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Two bounded display-space snapshots, one live scene. Never read pixels back to JavaScript. */
export class SnapshotTransition {
  private targets?: [THREE.RenderTarget, THREE.RenderTarget];
  private current = 0;
  private started: number | null = null;
  private pending = false;
  private seconds = 0.35;
  private readonly opacity = uniform(0);
  private readonly sample = texture(new THREE.Texture());
  private readonly placeholder = this.sample.value;
  private readonly material = new THREE.NodeMaterial();
  private readonly quad: THREE.QuadMesh;

  constructor() {
    this.material.transparent = true; this.material.depthTest = false; this.material.depthWrite = false;
    this.material.fragmentNode = vec4(this.sample.rgb, this.opacity);
    this.quad = new THREE.QuadMesh(this.material);
    this.quad.geometry = this.quad.geometry.clone();
  }

  get active() { return this.pending || this.started !== null; }
  setDuration(seconds: number) {
    this.seconds = Number.isFinite(seconds) ? Math.max(0, Math.min(0.8, seconds)) : 0;
    if (!this.seconds) this.cancel();
  }

  async prepare(renderer: THREE.WebGPURenderer) {
    if (!this.targets) {
      const target = () => new THREE.RenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false });
      this.targets = [target(), target()];
      this.sample.value = this.targets[this.current].texture;
      await renderer.compileAsync(this.quad, this.quad.camera);
    }
  }

  capture(renderer: THREE.WebGPURenderer, width: number, height: number, render: () => void) {
    if (!this.seconds || !this.targets) return;
    const next = 1 - this.current;
    const target = this.targets[next];
    const size = snapshotSize(width, height);
    target.setSize(size.width, size.height);
    const previous = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(target);
      render();
      // Rapid switches capture the currently blended picture into the other target.
      this.render(renderer);
    } finally { renderer.setRenderTarget(previous); }
    this.current = next;
    this.sample.value = target.texture;
    // Start only after the incoming frame has submitted, so its first-use cost cannot eat the fade.
    this.pending = true;
    this.started = null;
  }

  render(renderer: THREE.WebGPURenderer) {
    if (this.pending) { this.started = performance.now(); this.pending = false; }
    if (this.started === null) return;
    const t = Math.min(1, (performance.now() - this.started) / (this.seconds * 1000));
    if (t >= 1) { this.cancel(); return; }
    this.opacity.value = 1 - t * t * (3 - 2 * t);
    const clear = renderer.autoClear, tone = renderer.toneMapping, space = renderer.outputColorSpace;
    try {
      // The snapshot already contains the display transform and AA.
      renderer.autoClear = false;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      this.quad.render(renderer);
    } finally {
      renderer.autoClear = clear;
      renderer.toneMapping = tone;
      renderer.outputColorSpace = space;
    }
  }

  cancel() { this.started = null; this.pending = false; }
  dispose() {
    this.cancel();
    this.targets?.forEach(target => target.dispose());
    this.targets = undefined;
    this.material.dispose(); this.quad.geometry.dispose(); this.placeholder.dispose();
  }
}
