import * as THREE from 'three/webgpu';
import { exp, float, fract, max, min, mix, mx_noise_float, screenCoordinate, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { hash2 } from './shaderModes';
import { instantiate, whenLoaded, type Figure } from './figures';
import { createHits, linearRgb } from './hitPulse';
import coupeUrl from '../assets/wave4/coupe.glb?url';

/**
 * Light Leak Film: a dark coupe under heavy film grain, cutting on the beat between a low rear shot (smeared
 * orange taillights, scratchy orange light along the top) and a high front shot (two small headlights and a
 * blown-out warm cloud of light below). The grain, scratches, leaks and teal wash are a filter over the scene.
 */
export function createLightLeakFilmMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  const time = uniform(0), shot = uniform(0), leak = uniform(0.6), scratches = uniform(0.4), weave = uniform(new THREE.Vector2()), flash = uniform(0), aspect = uniform(1);
  scene.background = new THREE.Color(0x020304);
  // The road: dark asphalt with anime speed lines streaking past.
  const roadMaterial = new THREE.MeshBasicNodeMaterial();
  const roadUv = uv().mul(vec2(160, 400));
  const speed = hash2(vec2(roadUv.x.floor(), 3)).greaterThan(0.6).select(float(1), float(0))
    .mul(fract(roadUv.y.mul(0.02).add(time.mul(1.5)).add(hash2(vec2(roadUv.x.floor(), 9)))).smoothstep(0.2, 0.9));
  roadMaterial.colorNode = mix(vec3(0.004, 0.012, 0.016), vec3(0.06, 0.2, 0.26), speed.mul(0.3));
  const road = new THREE.Mesh(new THREE.PlaneGeometry(40, 400), roadMaterial);
  road.rotation.x = -Math.PI / 2; road.rotation.z = 0.35;
  scene.add(road);
  const key = new THREE.DirectionalLight(0x9fd8e8, 0.9); key.position.set(-4, 8, 3);
  const tail = new THREE.PointLight(0xff8a2b, 6, 8, 1.6); tail.position.set(0, 0.8, -3);
  scene.add(key, tail, new THREE.HemisphereLight(0x204048, 0x020202, 0.4));
  let car: Figure | undefined;
  const lamps: THREE.MeshStandardMaterial[] = [];
  const model = whenLoaded([coupeUrl], ([gltf]) => {
    car = instantiate(gltf);
    for (const [name, hex] of [['emissive_headlight', 0xffe9b8], ['emissive_taillight', 0xff8a2b]] as const) {
      const material = car.materials.get(name);
      if (material) { material.emissive.setRGB(...linearRgb(hex)); lamps.push(material); }
    }
    scene.add(car.root);
  });

  const hits = createHits({ decay: 0.25, interval: 0.6, variants: 2, seed: 2 });
  let shotLevel = 0;
  return {
    scene, camera,
    ready: model.ready,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time; aspect.value = frame.aspect;
      const step = settleStep(frame);
      hits.update(frame, 0.4);
      // Hard cut between the two shots on hits.
      if (hits.fired) shotLevel = hits.variant;
      shot.value = shotLevel;
      if (shotLevel === 0) { camera.position.set(0.6, 1.1, -7.5); camera.lookAt(0, 0.6, 0); }
      else { camera.position.set(-2.6, 5.5, 5.5); camera.lookAt(0, 0, 0.5); }
      leak.value = approach(leak.value, 0.35 + frame.response.bass * 0.5, step, 0.12);
      scratches.value = 0.3 + frame.response.loudness * 0.9;
      flash.value = hits.flash;
      for (const lamp of lamps) lamp.emissiveIntensity = 2 + frame.response.bass * 3 + hits.flash * 3;
      tail.intensity = 4 + frame.response.bass * 8;
      // Gate weave: the frame jitters by a pixel or two, every frame.
      const jitter = frame.reducedMotion ? 0 : 0.0015;
      weave.value.set((Math.sin(frame.time * 91.7) * 0.5) * jitter, (Math.sin(frame.time * 73.3 + 1) * 0.5) * jitter);
    },
    filter(input) {
      const p = uv().add(weave);
      const sample = (offset: number) => input.sample(p.add(vec2(offset, 0)).clamp(0, 1)).rgb;
      // Horizontal smear of the brights (the taillight trail).
      const smear = sample(0).add(sample(-0.01).mul(0.6)).add(sample(-0.02).mul(0.4)).add(sample(0.01).mul(0.3)).div(2.3);
      const base = mix(sample(0), smear, 0.6);
      const c = p.sub(0.5).mul(vec2(aspect, 1));
      // Shot B: a blown-out warm cloud (heart-ish) of light along the bottom (the filter's v runs top to bottom).
      const blob = min(min(c.sub(vec2(-0.13, 0.42)).length().sub(0.15), c.sub(vec2(0.13, 0.43)).length().sub(0.16)), c.sub(vec2(0, 0.56)).length().sub(0.2));
      const cloud = exp(blob.max(0).mul(-18)).mul(blob.lessThan(0).select(float(1.2), float(0.6))).mul(leak).mul(shot);
      // Shot A: scratchy orange light along the top.
      const topLight = exp(p.y.mul(-9)).mul(leak).mul(shot.oneMinus()).mul(mx_noise_float(vec3(c.x.mul(14), time.mul(2), 0)).mul(0.5).add(0.7));
      // Vertical scratches, 1–3 px wide, flickering per frame.
      const column = screenCoordinate.x.div(2).floor(), frameSeed = time.mul(24).floor();
      const scratch = hash2(vec2(column, frameSeed)).greaterThan(float(0.997).sub(scratches.mul(0.004))).select(float(1), float(0));
      const leakColour = mix(vec3(1, 0.25, 0.02), vec3(1, 0.82, 0.48), cloud.min(1));
      let lit = base.add(leakColour.mul(cloud.add(topLight.mul(0.9)))).add(vec3(1, 0.75, 0.45).mul(scratch.mul(cloud.add(topLight).add(0.08)).mul(0.6)));
      // Dark teal wash in the shadows, grain over everything, and a vignette.
      const luma = lit.dot(vec3(0.2126, 0.7152, 0.0722));
      lit = mix(vec3(0.014, 0.055, 0.065).add(lit.mul(0.8)), lit, luma.smoothstep(0.05, 0.5));
      const grain = hash2(screenCoordinate.xy.add(fract(time.mul(13.1)).mul(173))).sub(0.5).mul(0.1);
      const vignette = c.length().smoothstep(0.85, 0.35).mul(0.65).add(0.35);
      return vec4(max(lit.add(grain), vec3(0)).mul(vignette).add(vec3(flash.mul(0.04))), 1);
    },
    dispose() { model.dispose(); disposeScene(scene); },
  };
}
