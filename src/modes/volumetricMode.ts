import * as THREE from 'three/webgpu';
import { Fn, float, screenCoordinate, sin, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { RaymarchingBox } from 'three/addons/tsl/utils/Raymarching.js';
import { sceneDefaults, resizeCamera, disposeScene } from './shared';
import type { VisualMode } from './types';
import type { QualityBudget } from '../rendering/quality';

export function volumetricBudget(budget: QualityBudget) {
  switch (budget.preset) {
    case 'compatibility': return { samples: 0, scale: 1 };
    case 'balanced': return { samples: 24, scale: 0.5 };
    case 'high': return { samples: 40, scale: 0.65 };
    case 'ultra': return { samples: 64, scale: 0.75 };
  }
}

/** Single scattering integrated through a bounded fog volume; no shadow-map/occlusion claim. */
export function createVolumetricMode(budget: QualityBudget): VisualMode {
  const { samples, scale } = volumetricBudget(budget);
  const { scene, camera } = sceneDefaults(85);
  const time = uniform(0), energy = uniform(0), brightness = uniform(1);
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  material.fragmentNode = Fn(() => {
    const scattered = vec3(0).toVar();
    const transmission = float(1).toVar();
    // Stable per-pixel jitter and a soft volume boundary suppress low-sample marching bands.
    const jitter = sin(screenCoordinate.xy.dot(vec2(12.9898, 78.233))).mul(43758.5453).fract().sub(0.5);
    RaymarchingBox(Math.max(1, samples), ({ positionRay, stepSize }) => {
      const p = positionRay.add(vec3(0, 0, jitter.mul(stepSize)));
      const down = float(0.5).sub(p.y);
      const drift = sin(time.mul(0.22).add(p.y.mul(3))).mul(down).mul(0.12);
      const width = down.mul(0.13).add(0.016).mul(energy.mul(0.35).add(1));
      const illumination = vec3(0.015, 0.02, 0.035).toVar();
      for (let i = 0; i < 3; i++) {
        const centre = vec2((i - 1) * 0.27, (i % 2) * 0.18 - 0.09);
        const distance = p.xz.sub(centre).sub(vec2(drift, drift.mul((i - 1) * 0.7))).length();
        const beam = distance.div(width).pow(2).negate().exp().div(down.mul(1.2).add(0.35));
        const tint = i === 0 ? vec3(0.15, 0.65, 1) : i === 1 ? vec3(1, 0.65, 0.22) : vec3(0.7, 0.2, 1);
        illumination.addAssign(tint.mul(beam).mul(3.5));
      }
      const wisps = sin(p.x.mul(29).add(sin(p.y.mul(17).add(time.mul(0.15))))).mul(sin(p.z.mul(23).sub(p.y.mul(17)).add(time.mul(0.1))));
      const edge = p.abs();
      const feather = edge.x.max(edge.y).max(edge.z).smoothstep(0.36, 0.5).oneMinus();
      const density = wisps.mul(0.45).add(0.55).mul(feather);
      const opacity = density.mul(stepSize).mul(1.8).negate().exp().oneMinus();
      scattered.addAssign(illumination.mul(transmission).mul(opacity));
      transmission.mulAssign(opacity.oneMinus());
    });
    return vec4(scattered.mul(brightness), 1);
  })();
  const volume = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  volume.name = 'raymarched-light-shafts';
  volume.scale.set(145, 100, 90);
  volume.userData.samples = samples;
  volume.frustumCulled = false;
  scene.add(volume);
  let motionTime = 0;
  return {
    scene, camera, resolutionScale: scale,
    update(frame) {
      if (!frame.reducedMotion) motionTime = frame.time;
      time.value = motionTime;
      energy.value = frame.reducedMotion ? 0 : Math.min(1, frame.response.bass);
      brightness.value = frame.reducedFlash ? 1 : 1 + Math.min(1, frame.response.impact) * 0.3;
      resizeCamera(camera, frame.aspect);
    },
    dispose: () => disposeScene(scene),
  };
}
