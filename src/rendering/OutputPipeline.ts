import { RenderPipeline, RenderTarget, type Camera, type Scene, type WebGPURenderer } from 'three/webgpu';
import type { VisualMode } from '../modes/types';
import { pass, renderOutput, rtt } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import type { AntialiasingName } from './outputSettings';

export function createOutputPipeline(renderer: WebGPURenderer, scene: Scene, camera: Camera, filter?: VisualMode['filter'], options: { aa: AntialiasingName; resolutionScale?: number } = { aa: 'fxaa' }) {
  const scenePass = pass(scene, camera, { samples: 0 });
  scenePass.setResolutionScale(options.resolutionScale ?? 1);
  const input = scenePass.getTextureNode('output');
  const filtered = filter ? rtt(filter(input)) : undefined;
  const sceneColor = filtered ?? input;
  const glow = bloom(sceneColor, 0.6, 0.4, 0.8);
  // Bloom in linear scene space, a single display transform, then display-referred AA.
  const display = renderOutput(sceneColor.add(glow));
  const displayTarget = options.aa === 'none' ? undefined : rtt(display);
  const aa = displayTarget ? (options.aa === 'smaa' ? smaa(displayTarget) : fxaa(displayTarget)) : undefined;
  const pipeline = new RenderPipeline(renderer, aa ?? display);
  pipeline.outputColorTransform = false;
  return {
    prepare(strength: number) {
      // Execute the entire effect graph before swapping scenes, including bloom/AA shaders.
      const target = new RenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false });
      const previous = renderer.getRenderTarget();
      try { renderer.setRenderTarget(target); glow.strength.value = strength; pipeline.render(); }
      finally { renderer.setRenderTarget(previous); target.dispose(); }
    },
    render(strength: number) {
      glow.strength.value = strength;
      pipeline.render();
    },
    dispose() {
      pipeline.dispose();
      aa?.dispose();
      displayTarget?.dispose();
      glow.dispose();
      filtered?.dispose();
      scenePass.dispose();
    },
  };
}
