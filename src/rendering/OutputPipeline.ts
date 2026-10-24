import { RenderPipeline, type Camera, type Scene, type WebGPURenderer } from 'three/webgpu';
import type { VisualMode } from '../modes/types';
import { pass, renderOutput, rtt } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';

export function createOutputPipeline(renderer: WebGPURenderer, scene: Scene, camera: Camera, filter?: VisualMode['filter']) {
  const scenePass = pass(scene, camera, { samples: 0 });
  const input = scenePass.getTextureNode('output');
  const filtered = filter ? rtt(filter(input)) : undefined;
  const sceneColor = filtered ?? input;
  const glow = bloom(sceneColor, 0.6, 0.4, 0.8);
  // Bloom in linear scene space, a single display transform, then display-referred FXAA.
  const displayTarget = rtt(renderOutput(sceneColor.add(glow)));
  const aa = fxaa(displayTarget);
  const pipeline = new RenderPipeline(renderer, aa);
  pipeline.outputColorTransform = false;
  return {
    render(strength: number) {
      glow.strength.value = strength;
      pipeline.render();
    },
    dispose() {
      pipeline.dispose();
      aa.dispose();
      displayTarget.dispose();
      glow.dispose();
      filtered?.dispose();
      scenePass.dispose();
    },
  };
}
