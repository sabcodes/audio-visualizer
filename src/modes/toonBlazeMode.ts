import * as THREE from 'three/webgpu';
import { abs, float, fract, instancedBufferAttribute, mix, mx_noise_float, normalLocal, normalView, normalWorld, positionWorld, sin, step, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { hash2 } from './shaderModes';
import { createHits } from './hitPulse';
import { drive } from './waveSixShared';
import { seededRandom } from '../rendering/diagnostics';
import { presetBudget, type QualityBudget } from '../rendering/quality';
import { whenLoaded } from './figures';
import carUrl from '../assets/wave6/lowpoly_car.glb?url';

/**
 * Toon Blaze: the supplied low-poly sedan burning beneath the original city skyline.
 * Staggered parcels of hot gas rise as ragged flames, cool into soot, then expand and disperse.
 * Bass lifts the fire, onsets swell it and hats throw embers through the smoke.
 */
export function createToonBlazeMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  const perspective = camera as THREE.PerspectiveCamera;
  perspective.fov = 42;
  const random = seededRandom(808);
  const time = uniform(0), fireLight = uniform(1), flameHeight = uniform(1), fireEnergy = uniform(0.7);
  // Sky: a flat red-to-black gradient.
  const skyMaterial = new THREE.MeshBasicNodeMaterial({ depthWrite: false });
  skyMaterial.colorNode = mix(vec3(0.32, 0.03, 0.02), vec3(0.015, 0.002, 0.004), uv().y.smoothstep(0.1, 0.85)).mul(fireLight.mul(0.3).add(0.75));
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(400, 160), skyMaterial); sky.position.set(0, 50, -120); scene.add(sky);

  // Skyline: silhouetted towers with grids of warm windows, a few lit.
  const towers = 46, towerMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshBasicNodeMaterial(), towers);
  const towerSeeds = new Float32Array(towers);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < towers; i++) {
    const x = -95 + (i / towers) * 190 + (random() - 0.5) * 4, h = 14 + Math.pow(random(), 1.6) * 52, w = 5 + random() * 7;
    dummy.position.set(x, -0.5, -55 - random() * 30); dummy.scale.set(w, h, 6); dummy.updateMatrix(); towerMesh.setMatrixAt(i, dummy.matrix); towerSeeds[i] = random();
  }
  const towerSeed = instancedBufferAttribute<'float'>(new THREE.InstancedBufferAttribute(towerSeeds, 1), 'float');
  const side = abs(normalLocal.x).greaterThan(0.5);
  const wgrid = vec2(side.select(positionWorld.z, positionWorld.x).div(1.2), positionWorld.y.div(1.6)), wcell = wgrid.floor(), wf = fract(wgrid);
  const pane = wf.x.greaterThan(0.25).and(wf.x.lessThan(0.75)).and(wf.y.greaterThan(0.3)).and(wf.y.lessThan(0.75)).select(float(1), float(0));
  const lit = hash2(wcell.add(towerSeed.mul(77))).lessThan(0.2).select(float(1), float(0));
  (towerMesh.material as THREE.MeshBasicNodeMaterial).colorNode = mix(vec3(0.03, 0.008, 0.012), vec3(1, 0.62, 0.22).mul(0.9), pane.mul(lit));
  scene.add(towerMesh);

  // Street: dark asphalt catching the fire in a hard-edged pool.
  const streetMaterial = new THREE.MeshBasicNodeMaterial();
  const pool = positionWorld.xz.sub(vec2(0, 2)).mul(vec2(0.07, 0.12)).length();
  streetMaterial.colorNode = mix(vec3(0.02, 0.008, 0.01), vec3(0.6, 0.2, 0.04), step(pool, fireLight.mul(0.6)).mul(0.6).add(step(pool, fireLight.mul(0.9)).mul(0.25)));
  const street = new THREE.Mesh(new THREE.PlaneGeometry(400, 200), streetMaterial); street.rotation.x = -Math.PI / 2; scene.add(street);

  // Preserve the asset's paint, glass, tyres, chrome and lamps, with a warm animated fire reflection.
  const car = new THREE.Group(); car.position.set(0, 0, 2); car.rotation.y = -0.35; scene.add(car);
  car.name = 'low-poly burning car';
  const model = whenLoaded([carUrl], ([gltf]) => {
    const root = gltf.scene.clone(true), materials = new Map<THREE.Material, THREE.Material>();
    root.rotation.y = Math.PI / 2;
    root.scale.setScalar(1.18);
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root), centre = bounds.getCenter(new THREE.Vector3());
    root.position.set(-centre.x, -bounds.min.y + 0.025, -centre.z);
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry = mesh.geometry.clone();
      const replace = (old: THREE.Material) => {
        let material = materials.get(old);
        if (!material) {
          const source = old as THREE.MeshStandardMaterial;
          const m = new THREE.MeshBasicNodeMaterial({ side: source.side }); m.name = source.name;
          const diffuse = normalWorld.dot(vec3(-0.25, 0.8, 0.6).normalize()).max(0);
          const rim = abs(normalView.z).oneMinus().pow(4);
          const reflection = diffuse.mul(0.3).add(rim.mul(0.23)).mul(fireLight);
          m.colorNode = vec3(source.color.r, source.color.g, source.color.b).mul(diffuse.mul(0.55).add(0.32))
            .add(vec3(1, 0.25, 0.035).mul(reflection))
            .add(vec3(source.emissive.r, source.emissive.g, source.emissive.b));
          materials.set(old, material = m);
        }
        return material;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(replace) : replace(mesh.material);
    });
    car.add(root);
  });

  const addSprites = (material: THREE.SpriteNodeMaterial, count: number, name: string) => {
    const sprites = new THREE.Sprite(material); sprites.geometry = sprites.geometry.clone();
    sprites.count = count; sprites.frustumCulled = false; sprites.name = name; scene.add(sprites); return sprites;
  };
  // Each parcel has one birth point and trajectory for both stages: fire first, smoke as it cools.
  // Staggered lifetimes pre-fill the column, so there is a fire even before music starts.
  const count = Math.round(300 * Math.min(1.5, budget.particleScale));
  const particleOpacity = Math.min(1, 150 / count);
  const origins = new Float32Array(count * 4), seeds = new Float32Array(count * 3);
  car.updateMatrixWorld(true);
  const origin = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const x = (random() - 0.5) * 4.3;
    origin.set(x, Math.abs(x) < 1.1 ? 1.58 : 1.03, (random() - 0.5) * 1.25).applyMatrix4(car.matrixWorld);
    origins.set([origin.x, origin.y, origin.z, i / count], i * 4);
    seeds.set([6.5 + random() * 3, 1.5 + random() * 0.8, random() * 40], i * 3);
  }
  const birth = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(origins, 4), 'vec4');
  const seed = instancedBufferAttribute<'vec3'>(new THREE.InstancedBufferAttribute(seeds, 3), 'vec3');
  const age = fract(time.div(seed.x).add(birth.w)).mul(seed.x);
  const lift = age.mul(seed.y).add(age.pow(2).mul(0.045));
  const drift = age.pow(2).mul(-0.055).add(sin(age.mul(1.5).add(seed.z)).mul(age).mul(0.18));
  const gasPosition = vec3(birth.x.add(drift), birth.y.add(lift.mul(flameHeight)), birth.z.add(sin(age.add(seed.z)).mul(age).mul(0.1)));

  const flameMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  flameMaterial.positionNode = gasPosition;
  const hotLife = age.smoothstep(2.1, 1.05);
  const parcelSize = sin(seed.z).mul(0.22).add(1);
  flameMaterial.scaleNode = vec2(parcelSize.mul(hotLife.mul(0.6).add(0.45)), parcelSize.mul(2.5).mul(flameHeight));
  const fuv = uv(), rise = fuv.y;
  const turbulence = mx_noise_float(vec3(fuv.x.mul(5).add(seed.z), rise.mul(7).sub(time.mul(3.2)), seed.z));
  const detail = mx_noise_float(vec3(fuv.mul(vec2(14, 19)).add(seed.z), time.mul(1.3)));
  const bend = sin(rise.mul(7).sub(time.mul(4)).add(seed.z)).mul(rise).mul(0.13).add(turbulence.mul(0.12));
  const width = rise.oneMinus().max(0).pow(0.7).mul(0.43).add(0.018);
  const edge = abs(fuv.x.sub(0.5).add(bend)).div(width).add(detail.mul(0.22));
  const shape = edge.smoothstep(1.1, 0.5).mul(rise.smoothstep(0, 0.09)).mul(rise.smoothstep(1, 0.7));
  const heat = rise.oneMinus().mul(0.55).add(age.div(2.1).oneMinus().mul(0.45)).add(turbulence.mul(0.15)).clamp(0, 1);
  const fireColour = mix(vec3(0.85, 0.045, 0.003), vec3(1.5, 0.42, 0.025), heat.smoothstep(0.1, 0.55));
  flameMaterial.colorNode = mix(fireColour, vec3(2.8, 1.9, 0.7), heat.smoothstep(0.55, 0.95)).mul(fireEnergy);
  flameMaterial.opacityNode = shape.mul(turbulence.mul(0.45).add(0.55)).mul(hotLife).mul(age.smoothstep(0, 0.12)).mul(0.75 * particleOpacity);

  const smokeMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
  smokeMaterial.positionNode = gasPosition;
  smokeMaterial.scaleNode = vec2(age.mul(0.64).add(0.9), age.mul(0.7).add(1.25)).mul(parcelSize);
  smokeMaterial.rotationNode = seed.z.add(age.mul(0.12));
  const smokeUv = uv().sub(0.5);
  const billow = mx_noise_float(vec3(uv().mul(4).add(seed.z), time.mul(0.22))).mul(0.5).add(0.5);
  const wisps = mx_noise_float(vec3(uv().mul(11).add(seed.z), time.mul(0.35))).mul(0.5).add(0.5);
  const smokeShape = smokeUv.length().add(billow.mul(0.14)).smoothstep(0.53, 0.15);
  const cooling = age.smoothstep(1.1, 3.5);
  const soot = mix(vec3(0.055, 0.045, 0.047), vec3(0.15, 0.135, 0.13), billow.mul(0.6).add(fuv.y.mul(0.4)));
  smokeMaterial.colorNode = soot.add(vec3(0.32, 0.075, 0.012).mul(cooling.oneMinus()).mul(fuv.y.oneMinus()).mul(fireLight));
  smokeMaterial.opacityNode = smokeShape.mul(billow.mul(0.65).add(wisps.mul(0.35)))
    .mul(age.smoothstep(0.9, 1.9)).mul(age.div(seed.x).smoothstep(1, 0.65)).mul(0.48 * particleOpacity);
  // Normal-blended soot renders before the luminous flame layer; both respect the car's depth.
  addSprites(smokeMaterial, count, 'rising smoke').renderOrder = 1;
  addSprites(flameMaterial, count, 'turbulent flames').renderOrder = 2;

  const sparkCount = Math.round(90 * Math.min(1.5, budget.particleScale));
  const sparkSeeds = new Float32Array(sparkCount * 4);
  for (let i = 0; i < sparkCount; i++) sparkSeeds.set([random(), random(), random(), random()], i * 4);
  const ember = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(sparkSeeds, 4), 'vec4');
  const emberAge = fract(time.mul(ember.y.mul(0.3).add(0.25)).add(ember.x));
  const sparkMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  sparkMaterial.positionNode = vec3(ember.x.sub(0.5).mul(4).sub(emberAge.pow(2).mul(3)).add(sin(emberAge.mul(8).add(ember.z.mul(20))).mul(0.3)),
    emberAge.mul(8).add(1.7), ember.z.sub(0.5).mul(1.8).add(2));
  sparkMaterial.scaleNode = vec2(0.018, ember.y.mul(0.09).add(0.035));
  sparkMaterial.colorNode = mix(vec3(2, 0.18, 0.01), vec3(3, 1.8, 0.4), emberAge.oneMinus());
  sparkMaterial.opacityNode = uv().sub(0.5).length().smoothstep(0.5, 0.1).mul(emberAge.smoothstep(0, 0.05)).mul(emberAge.smoothstep(1, 0.6)).mul(fireEnergy);
  addSprites(sparkMaterial, sparkCount, 'rising embers').renderOrder = 3;

  const hits = createHits({ decay: 0.25, interval: 0.2 });
  let push = 0;
  return {
    scene, camera,
    ready: model.ready,
    update(frame) {
      resizeCamera(perspective, frame.aspect);
      const step = Math.min(settleStep(frame), 0.1), motion = frame.reducedMotion ? 0 : Math.min(Math.max(frame.delta, 0), 0.1), { bass, loudness } = frame.response;
      time.value += motion;
      hits.update(frame, 0.1);
      flameHeight.value = approach(flameHeight.value, 0.85 + bass * 0.45 + hits.flash * 0.12, motion, 0.3);
      fireEnergy.value = approach(fireEnergy.value, 0.65 + loudness * 0.35 + drive(frame) * 0.15 + frame.audio.highs * 0.12 + hits.flash * 0.12, step, 0.18);
      fireLight.value = approach(fireLight.value, 0.7 + loudness * 0.4 + hits.flash * 0.25, step, 0.1);
      // Locked medium-wide, with a slight push-in on loud passages.
      push = approach(push, loudness, motion, 2);
      perspective.position.set(3, 3.2, 22 - push * 2.5); perspective.lookAt(-2, 6.2, 0);
    },
    dispose() { model.dispose(); disposeScene(scene); },
  };
}
