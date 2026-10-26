import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { abs, float, fract, instancedBufferAttribute, mix, mx_noise_float, normalLocal, normalView, normalWorld, positionLocal, positionWorld, step, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { hash2 } from './shaderModes';
import { createHits } from './hitPulse';
import { drive } from './waveSixShared';
import { seededRandom } from '../rendering/diagnostics';
import { presetBudget, type QualityBudget } from '../rendering/quality';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/** Fire to smoke, hottest first: yellow, orange, red, maroon, dark smoke (sRGB-ish, used as scene-linear). */
export const BLAZE_RAMP: readonly (readonly [number, number, number])[] = [[1, 0.86, 0.25], [1, 0.45, 0.05], [0.8, 0.09, 0.03], [0.32, 0.035, 0.035], [0.09, 0.02, 0.025]];
const ramp = (heat: F): V3 => {
  // Hard steps between the stops: cel fire has no gradients inside a band.
  const t = heat.oneMinus().mul(BLAZE_RAMP.length - 1).clamp(0, BLAZE_RAMP.length - 1.001).floor();
  let colour: V3 = vec3(...BLAZE_RAMP[0]);
  BLAZE_RAMP.forEach((c, k) => { if (k) colour = t.equal(k).select(vec3(...c), colour); });
  return colour;
};
/** Light bands for the toon shade: three hard levels. */
const bands = (light: F) => step(0.62, light).mul(0.45).add(step(0.32, light).mul(0.35)).add(0.2);

/**
 * Toon Blaze (wave 6, #8): a car burning in a city street at night, drawn as cel-shaded 3D: a towering column of
 * round, puffy fire and smoke with hard-edged bands (yellow core, orange, red, then maroon smoke) and black
 * outlines, flame tongues licking off the wreck, a skyline of lit windows against a red-black sky. Kicks burst new
 * puffs out of the car, bass raises the flames, mids sway the column, hats throw sparks, loudness sizes the fire.
 */
export function createToonBlazeMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  const perspective = camera as THREE.PerspectiveCamera;
  perspective.fov = 42;
  const random = seededRandom(808);
  const time = uniform(0), fireLight = uniform(1), flameHeight = uniform(1);
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

  // The car: a boxy sedan, dark, rim-lit in bands by the fire above it.
  const fireDir = vec3(0, 1, 0.25).normalize();
  const carMaterial = new THREE.MeshBasicNodeMaterial();
  carMaterial.colorNode = mix(vec3(0.03, 0.02, 0.025), vec3(1, 0.45, 0.08), bands(normalWorld.dot(fireDir).mul(fireLight)).sub(0.2).mul(0.9));
  const car = new THREE.Group(); car.position.set(0, 0, 2); car.rotation.y = -0.35; scene.add(car);
  const part = (w: number, h: number, d: number, x: number, y: number, z: number) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), carMaterial); m.position.set(x, y, z); car.add(m); return m; };
  part(4.6, 0.75, 1.9, 0, 0.75, 0); part(2.5, 0.65, 1.7, -0.2, 1.45, 0);
  for (const [x, z] of [[-1.5, 0.95], [1.5, 0.95], [-1.5, -0.95], [1.5, -0.95]]) { const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12), carMaterial); wheel.rotation.x = Math.PI / 2; wheel.position.set(x, 0.42, z); car.add(wheel); }
  const outlineMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, color: 0x000000 });
  car.children.slice().forEach((m) => { const hull = (m as THREE.Mesh).clone(); hull.material = outlineMaterial; hull.scale.multiplyScalar(1.04); car.add(hull); });

  // Puffs: the fire and smoke column, instanced spheres with a heat each, toon-shaded and outlined.
  const puffCount = Math.round(320 * Math.min(1.5, budget.particleScale));
  const heats = new Float32Array(puffCount), heatAttribute = new THREE.InstancedBufferAttribute(heats, 1);
  const heat = instancedBufferAttribute<'float'>(heatAttribute, 'float');
  const puffMaterial = new THREE.MeshBasicNodeMaterial();
  // Lit from the fire below and in front: the undersides glow, the tops fall into shadow bands.
  const light = normalView.dot(vec3(0.35, -0.6, 0.7).normalize()).mul(0.5).add(0.5).add(heat.mul(0.12));
  const level = bands(light);
  puffMaterial.colorNode = mix(ramp(heat.sub(0.28).max(0)).mul(0.7), ramp(heat), level.sub(0.2).div(0.8));
  const sphere = new THREE.IcosahedronGeometry(1, 3);
  const puffs = new THREE.InstancedMesh(sphere, puffMaterial, puffCount); puffs.frustumCulled = false; scene.add(puffs);
  const hulls = new THREE.InstancedMesh(sphere, outlineMaterial, puffCount); hulls.frustumCulled = false; scene.add(hulls);
  const state = Array.from({ length: puffCount }, () => ({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, r: 0, grow: 0, heat: 0, cool: 0 }));

  // Flame tongues: noise-cut cones on the wreck in banded colour.
  const flameMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide });
  const up = positionLocal.y.add(0.5);
  const lick = mx_noise_float(vec3(positionLocal.x.mul(3), up.mul(2).sub(time.mul(3.5)), positionLocal.z.mul(3))).mul(0.5).add(0.5);
  const flameHeat = lick.sub(up.mul(0.75)).add(0.45);
  flameMaterial.colorNode = ramp(flameHeat.clamp(0, 1).mul(1.25));
  flameMaterial.opacityNode = step(0.2, flameHeat);
  const flames = Array.from({ length: 7 }, (_, k) => {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.7 + random() * 0.5, 3, 10, 6, true), flameMaterial);
    cone.position.set(-1.6 + k * 0.55, 2.2, (random() - 0.5) * 1.1); car.add(cone); return cone;
  });

  // Sparks: small bright sprites thrown up on hats.
  const sparkMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
  sparkMaterial.colorNode = vec3(1.2, 0.8, 0.2);
  sparkMaterial.opacityNode = uv().sub(0.5).length().lessThan(0.4).select(float(1), float(0));
  const sparks = Array.from({ length: 40 }, () => { const s = new THREE.Sprite(sparkMaterial); s.geometry = s.geometry.clone(); s.scale.setScalar(0.12); s.visible = false; scene.add(s); return { sprite: s, vx: 0, vy: 0, life: 0 }; });

  const hits = createHits({ decay: 0.25, interval: 0.2 });
  let spawnClock = 0, sway = 0, push = 0;
  const emit = (strength: number) => {
    const s = state.find((p) => !p.alive); if (!s) return;
    s.alive = true; s.x = (random() - 0.5) * 4.5; s.y = 1.8 + random(); s.z = 2 + (random() - 0.5) * 1.2;
    s.vx = -0.5 + (random() - 0.6) * 2.2; s.vy = 3 + strength * 4 + random() * 2; s.r = 0.5 + strength * 0.5 + random() * 0.4; s.grow = 0.5 + random() * 0.4;
    s.heat = 0.75 + strength * 0.25; s.cool = 0.22 + random() * 0.12;
  };
  return {
    scene, camera,
    update(frame) {
      resizeCamera(perspective, frame.aspect);
      time.value = frame.time;
      const step = settleStep(frame), motion = frame.reducedMotion ? 0 : frame.delta, { bass, loudness, impact } = frame.response;
      hits.update(frame, 0.1);
      const size = 0.35 + loudness * 0.9 + drive(frame) * 0.2;
      // Kicks: a burst of new puffs from the car, bigger with the hit.
      if (hits.fired) for (let k = 0; k < 6 + Math.round(impact * 10); k++) emit(Math.min(1, 0.4 + impact * 0.6));
      // A steady smoulder that grows with loudness; the column never dies.
      spawnClock += motion * (3 + size * 14);
      while (spawnClock > 1) { spawnClock--; emit(size * 0.5); }
      sway += motion * (0.4 + frame.audio.mid * 1.5);
      const lean = Math.sin(sway) * 0.6;
      state.forEach((s, i) => {
        if (s.alive) {
          // Buoyant: each puff eases toward a steady climb, billowing out as it rises (but never past a cap).
          s.y += s.vy * motion; s.x += (s.vx + lean * (s.y / 20)) * motion; s.vy = approach(s.vy, 2.6, motion, 1.2);
          s.r = Math.min(4.6, s.r + s.grow * motion * 0.45); s.heat = Math.max(0, s.heat - s.cool * motion);
          if (s.y > 45 || (s.heat <= 0 && s.y > 30)) s.alive = false;
        }
        dummy.position.set(s.x, s.y, s.z); dummy.scale.setScalar(s.alive ? s.r : 0); dummy.updateMatrix(); puffs.setMatrixAt(i, dummy.matrix);
        dummy.scale.setScalar(s.alive ? s.r * 1.07 : 0); dummy.updateMatrix(); hulls.setMatrixAt(i, dummy.matrix);
        heats[i] = s.heat;
      });
      puffs.instanceMatrix.needsUpdate = hulls.instanceMatrix.needsUpdate = true; heatAttribute.needsUpdate = true;
      flameHeight.value = approach(flameHeight.value, 0.7 + bass * 1.1 + hits.flash * 0.3, step, 0.08);
      flames.forEach((flame, k) => { flame.scale.set(1, flameHeight.value * (0.8 + 0.3 * Math.sin(frame.time * 5 + k)), 1); flame.position.y = 1.5 + flame.scale.y * 1.5 * 0.5; });
      fireLight.value = approach(fireLight.value, 0.7 + loudness * 0.4 + hits.flash * 0.25 * (frame.reducedFlash ? 0.4 : 1), step, 0.1);
      // Hats: sparks thrown up from the fire.
      if (frame.audio.highs > 0.45) for (const spark of sparks) if (spark.life <= 0 && random() < 0.15) { spark.life = 1; spark.sprite.position.set((random() - 0.5) * 3, 2.5, 2); spark.vx = (random() - 0.5) * 6; spark.vy = 5 + random() * 6; }
      for (const spark of sparks) {
        spark.life = Math.max(0, spark.life - step * 0.8); spark.sprite.visible = spark.life > 0;
        spark.vy -= motion * 4; spark.sprite.position.x += spark.vx * motion; spark.sprite.position.y += spark.vy * motion;
      }
      // Locked medium-wide, with a slight push-in on loud passages.
      push = approach(push, loudness, step, 2);
      perspective.position.set(3, 2.4, 22 - push * 2.5); perspective.lookAt(-2, 8, 0);
    },
    dispose: () => disposeScene(scene),
  };
}
