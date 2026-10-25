import * as THREE from 'three/webgpu';
import { exp, float, fract, max, min, mix, mx_noise_float, screenCoordinate, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { hash2 } from './shaderModes';
import { instantiate, whenLoaded, type Figure } from './figures';
import { createHits, linearRgb, variantSequence } from './hitPulse';
import coupeUrl from '../assets/wave4/coupe.glb?url';

/** Neon gradient pairs for the light above the car; a hit switches to the next pair. */
export const NEON_GRADIENTS = [[0xff2bd6, 0x2ef2ff], [0xff8a2b, 0xff2b6a], [0x7a3cff, 0x2bffb0], [0x2b6bff, 0xff4fd8], [0xffd02b, 0xff3a2a]] as const;
/** Camera angles on the coupe (forward is +Z): position, then look-at. */
export const FILM_SHOTS = [
  [[0.5, 1.0, -5.6], [0, 0.6, 0]], [[-2.2, 4.4, 4.6], [0, 0, 0.5]], [[4.6, 1.0, 0.3], [0, 0.6, 0]], [[0.5, 8.5, 1], [0, 0, 0]],
  [[0.6, 0.75, 5.6], [0, 0.6, 0]], [[3.4, 2.8, -4.6], [0, 0.5, 0]], [[-4.4, 0.8, -1.2], [0, 0.7, 0.4]],
] as const;
/** The point just ahead of the coupe's nose (Blender −Y forward comes out as +Z in glTF), where the flash blooms. */
const NOSE = new THREE.Vector3(0, 0, 4.2);

/**
 * Light Leak Film: a dark coupe under heavy film grain, cutting on the beat between a low rear shot (smeared
 * orange taillights, scratchy orange light along the top) and a high front shot (two small headlights and a
 * blown-out warm cloud of light below). The grain, scratches, leaks and teal wash are a filter over the scene.
 */
export function createLightLeakFilmMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  const time = uniform(0), shot = uniform(0), leak = uniform(0.6), scratches = uniform(0.4), weave = uniform(new THREE.Vector2()), flash = uniform(0), aspect = uniform(1);
  const front = uniform(new THREE.Vector2(0, 0.3)), burst = uniform(0.2);
  const neonA = uniform(new THREE.Vector3(...linearRgb(NEON_GRADIENTS[0][0]))), neonB = uniform(new THREE.Vector3(...linearRgb(NEON_GRADIENTS[0][1])));
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
  // A strong key and a hard rim, so the dark coupe's outline reads from every angle in black and white.
  const key = new THREE.DirectionalLight(0xe8f0f0, 2.4); key.position.set(-4, 8, 3);
  const rim = new THREE.DirectionalLight(0xffffff, 2); rim.position.set(5, 6, -8);
  const tail = new THREE.PointLight(0xff8a2b, 6, 8, 1.6); tail.position.set(0, 0.8, -3);
  // A soft fill from just above the camera, so whichever side of the car a shot sees is lit.
  const fill = new THREE.DirectionalLight(0xffffff, 1.6);
  scene.add(key, rim, fill, fill.target, tail, new THREE.HemisphereLight(0x404448, 0x050505, 0.7));
  let car: Figure | undefined;
  const lamps: THREE.MeshStandardMaterial[] = [];
  const model = whenLoaded([coupeUrl], ([gltf]) => {
    car = instantiate(gltf);
    // The paint is fully metallic in the file; with nothing to reflect it renders black, so let the lights show it.
    const paint = car.materials.get('coupe_atlas');
    if (paint) { paint.metalness = 0.3; paint.roughness = 0.55; }
    for (const [name, hex] of [['emissive_headlight', 0xffe9b8], ['emissive_taillight', 0xff8a2b]] as const) {
      const material = car.materials.get(name);
      if (material) { material.emissive.setRGB(...linearRgb(hex)); lamps.push(material); }
    }
    scene.add(car.root);
  });

  const hits = createHits({ decay: 0.25, interval: 0.6 });
  const gradients = { a: new THREE.Vector3(...linearRgb(NEON_GRADIENTS[0][0])), b: new THREE.Vector3(...linearRgb(NEON_GRADIENTS[0][1])) }, nose = new THREE.Vector3();
  const shots = variantSequence(FILM_SHOTS.length, 4);
  let shotLevel = 0, gradient = 0, shotAge = 0;
  return {
    scene, camera,
    ready: model.ready,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time; aspect.value = frame.aspect;
      const step = settleStep(frame);
      hits.update(frame, 0.4);
      // Hard cut between the two shots on hits.
      // Cut to the next angle on a beat once a shot has held for 5 s; within a shot the camera drifts slowly.
      shotAge += step;
      if (hits.fired && shotAge > 5) { shotLevel = shots.next(); shotAge = 0; }
      shot.value = shotLevel;
      const [from, to] = FILM_SHOTS[shotLevel], creep = frame.reducedMotion ? 0 : Math.min(shotAge, 12) * 0.025;
      camera.position.set(from[0] * (1 - creep * 0.3), from[1], from[2] * (1 - creep * 0.3)).add(new THREE.Vector3(creep * 0.6, 0, 0));
      camera.lookAt(to[0], to[1], to[2]);
      fill.position.copy(camera.position).add(new THREE.Vector3(0, 3, 0)); fill.target.position.set(to[0], to[1], to[2]);
      if (hits.fired) {
        gradient = (gradient + 1) % NEON_GRADIENTS.length;
        gradients.a.set(...linearRgb(NEON_GRADIENTS[gradient][0])); gradients.b.set(...linearRgb(NEON_GRADIENTS[gradient][1]));
      }
      neonA.value.lerp(gradients.a, 1 - Math.exp(-step / 0.15)); neonB.value.lerp(gradients.b, 1 - Math.exp(-step / 0.15));
      // The flash sits in front of the car on screen and pumps with the beat and the bounce.
      camera.updateMatrixWorld(); nose.copy(NOSE).project(camera);
      front.value.set(nose.x * 0.5 * frame.aspect, -nose.y * 0.5);
      leak.value = approach(leak.value, 0.04 + frame.response.bass * 0.3 + hits.level * (frame.reducedFlash ? 0.5 : 1.2), step, 0.05);
      burst.value = approach(burst.value, 0.28 + frame.response.bounce * 0.22 + hits.level * 0.22, step, 0.06);
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
      // Nearly black and white: only the neon from the top and the flash keep their colour.
      const filmBase = mix(sample(0), smear, 0.6);
      const base = mix(filmBase, vec3(filmBase.dot(vec3(0.2126, 0.7152, 0.0722))), 0.85);
      const c = p.sub(0.5).mul(vec2(aspect, 1));
      // The flash: a blown-out warm cloud (heart-ish) just ahead of the car's nose, swelling on the beat.
      const f = c.sub(front).div(burst.max(0.05));
      const blob = min(min(f.sub(vec2(-0.13, -0.04)).length().sub(0.15), f.sub(vec2(0.13, -0.03)).length().sub(0.16)), f.sub(vec2(0, 0.1)).length().sub(0.2));
      const cloud = exp(blob.max(0).mul(-18)).mul(blob.lessThan(0).select(float(0.5), float(0.3))).mul(leak);
      // Scratchy neon light along the top, a gradient across the frame that switches colours on hits.
      // Neon along the top: a faint wash and scattered flecks of light that flicker, not a solid beam.
      const wash = exp(p.y.mul(-14)).mul(leak.mul(0.3).add(0.15)).mul(mx_noise_float(vec3(c.x.mul(14), time.mul(2), 0)).mul(0.5).add(0.6));
      const fleckCell = vec2(c.x.mul(70), p.y.mul(46)).floor(), fleckHash = hash2(fleckCell.add(time.mul(3).floor()));
      const flecks = fleckHash.greaterThan(0.965).select(float(1), float(0)).mul(exp(p.y.mul(-6))).mul(fract(vec2(c.x.mul(70), p.y.mul(46))).sub(0.5).length().smoothstep(0.45, 0.1)).mul(leak.add(0.4));
      const topLight = wash.add(flecks.mul(1.2));
      const neon = mix(neonA, neonB, p.x.add(mx_noise_float(vec3(c.x.mul(2), time.mul(0.3), 4)).mul(0.25)).clamp(0, 1));
      // Vertical scratches, 1–3 px wide, flickering per frame.
      const column = screenCoordinate.x.div(2).floor(), frameSeed = time.mul(24).floor();
      const scratch = hash2(vec2(column, frameSeed)).greaterThan(float(0.997).sub(scratches.mul(0.004))).select(float(1), float(0));
      const leakColour = mix(vec3(1, 0.25, 0.02), vec3(1, 0.82, 0.48), cloud.min(1));
      let lit = base.add(leakColour.mul(cloud)).add(neon.mul(topLight.mul(1.1))).add(vec3(1, 0.75, 0.45).mul(scratch.mul(cloud.add(topLight).add(0.08)).mul(0.6)));
      // Lifted grey shadows like old film stock, grain over everything, and a vignette.
      const luma = lit.dot(vec3(0.2126, 0.7152, 0.0722));
      lit = mix(vec3(0.03, 0.032, 0.034).add(lit.mul(0.85)), lit, luma.smoothstep(0.05, 0.5));
      const grain = hash2(screenCoordinate.xy.add(fract(time.mul(13.1)).mul(173))).sub(0.5).mul(0.13);
      const vignette = c.length().smoothstep(0.85, 0.35).mul(0.65).add(0.35);
      return vec4(max(lit.add(grain), vec3(0)).mul(vignette).add(vec3(flash.mul(0.04))), 1);
    },
    dispose() { model.dispose(); disposeScene(scene); },
  };
}
