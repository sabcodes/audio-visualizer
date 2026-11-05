import * as THREE from 'three/webgpu';
import { cos, float, instanceIndex, instancedBufferAttribute, mix, sin, uniform, uv, vec2, vec3, texture as sampleTexture } from 'three/tsl';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, colorize, disposeScene } from './shared';
import { seededRandom } from '../rendering/diagnostics';
import { FlockSimulation } from '../simulations/flock';
import { StarTunnelSimulation, STAR_RINGS, STARS_PER_RING } from '../simulations/starTunnel';
import { presetBudget, type QualityBudget } from '../rendering/quality';

export function createParticleMode(id: 'particles' | 'boids' | 'starTunnel', budget: QualityBudget = presetBudget('balanced')): VisualMode {
  if (id === 'particles') return swirl(Math.round(8000 * budget.particleScale));
  if (id === 'boids') return flock(Math.round(220 * budget.particleScale));
  return stars();
}
function sprite(material: THREE.SpriteNodeMaterial, count: number, scene: THREE.Scene) {
  const object = new THREE.Sprite(material);
  // Sprite's default geometry is shared by Three.js. Clone so this mode owns it.
  object.geometry = object.geometry.clone();
  object.count = count; object.frustumCulled = false; scene.add(object);
  return object;
}
function spriteMaterial() {
  const material = new THREE.SpriteNodeMaterial({ color: 0x50bfff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  material.opacityNode = uv().sub(0.5).length().smoothstep(0.08, 0.5).oneMinus().mul(0.8);
  return material;
}
function swirl(count: number): VisualMode {
  const { scene, camera } = sceneDefaults(100);
  camera.position.y = 38; camera.lookAt(0, 0, 0);
  const time = uniform(0), bounce = uniform(0), impact = uniform(0), flash = uniform(0);
  const tint = uniform(new THREE.Color());
  const random = seededRandom(42), seeds = new Float32Array(count * 3);
  for (let i = 0; i < seeds.length; i += 3) { seeds[i] = random() * Math.PI * 2; seeds[i + 1] = 16 + random() * 22; seeds[i + 2] = (random() - 0.5) * 18; }
  const seed = instancedBufferAttribute<'vec3'>(new THREE.InstancedBufferAttribute(seeds, 3), 'vec3');
  const angle = seed.x.add(time.mul(0.6).mul(seed.y.div(40).add(0.2)));
  const curl = sin(angle.mul(3).add(seed.z.mul(0.16)).sub(time.mul(0.4)));
  const radius = seed.y.mul(bounce.mul(0.75).add(1)).add(curl.mul(2.5));
  const material = spriteMaterial();
  const lift = sin(angle.mul(2).add(seed.y.mul(0.25))).mul(4).add(curl.mul(bounce.mul(2).add(1)));
  material.positionNode = vec3(cos(angle).mul(radius), seed.z.mul(bounce.mul(0.35).add(1)).add(lift), sin(angle).mul(radius));
  // Colour varies through the volume; every seed stays resident on the GPU.
  const depth = sin(angle).mul(0.5).add(0.5);
  material.colorNode = mix(tint, vec3(0.3, 0.65, 1), seed.y.sub(16).div(22).mul(0.65)).mul(depth.mul(0.45).add(0.55));
  material.opacityNode = uv().sub(0.5).length().smoothstep(0.05, 0.5).oneMinus().mul(flash.mul(0.15).add(0.65));
  material.scaleNode = vec2(impact.mul(0.3).add(0.65).mul(seed.y.div(38).mul(0.45).add(0.55)));
  sprite(material, count, scene);
  const ringMaterial = new THREE.MeshBasicNodeMaterial({ color: 0x333333 });
  scene.add(new THREE.Mesh(new THREE.TorusGeometry(26, 0.12, 8, 128), ringMaterial));
  return {
    scene, camera,
    update(frame) {
      if (!frame.reducedMotion) time.value = frame.time;
      bounce.value = frame.reducedMotion ? 0 : frame.response.bounce;
      impact.value = frame.reducedMotion ? 0 : frame.response.impact;
      flash.value = frame.reducedFlash ? 0 : frame.response.impact;
      tint.value.setHSL((frame.hue + 0.28) % 1, 0.85, 0.5);
      resizeCamera(camera, frame.aspect);
    }, dispose: () => disposeScene(scene),
  };
}
function flock(count: number): VisualMode {
  const { scene, camera } = sceneDefaults();
  const simulation = new FlockSimulation(count);
  const positions = new Float32Array(count * 3), attribute = new THREE.InstancedBufferAttribute(positions, 3);
  const size = uniform(0.7), material = spriteMaterial();
  material.positionNode = instancedBufferAttribute<'vec3'>(attribute, 'vec3');
  material.scaleNode = vec2(size); sprite(material, count, scene);
  return {
    scene, camera,
    update(frame) {
      simulation.advance(frame.delta, frame.response.impact);
      simulation.boids.forEach((boid, i) => { positions[i * 3] = boid.px; positions[i * 3 + 1] = boid.py; positions[i * 3 + 2] = boid.pz; });
      attribute.needsUpdate = true; size.value = 0.7 + frame.response.bounce * 1.3;
      resizeCamera(camera, frame.aspect); colorize(material, frame, 0.36);
    }, dispose: () => disposeScene(scene),
  };
}
function stars(): VisualMode {
  const { scene, camera } = sceneDefaults(70);
  const simulation = new StarTunnelSimulation(), rings = STAR_RINGS, perRing = STARS_PER_RING;
  // Per-ring (z, rotation, pulse, hue): 160 floats per frame instead of 10,560 position/colour floats.
  const ringTexture = new THREE.DataTexture(simulation.ringState, rings, 1, THREE.RGBAFormat, THREE.FloatType);
  ringTexture.minFilter = ringTexture.magFilter = THREE.NearestFilter;
  const offsetAttribute = new THREE.InstancedBufferAttribute(simulation.offsets, 1);
  const texture = starTexture(), material = new THREE.SpriteNodeMaterial({ map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const size = uniform(2.4), bounce = uniform(0);
  const index = float(instanceIndex), ring = index.div(perRing).floor(), slot = index.mod(perRing);
  const state = sampleTexture(ringTexture, vec2(ring.add(0.5).div(rings), 0.5));
  const angle = slot.mul((Math.sqrt(5) - 1) * Math.PI).add(ring.mul(0.15)).add(state.y);
  const base = sin(ring.div(rings - 1).mul(Math.PI)).mul(10).add(24);
  const radius = base.mul(bounce.mul(0.55).add(state.z.mul(0.2)).add(1)).add(instancedBufferAttribute<'float'>(offsetAttribute, 'float')).clamp(2, 120);
  material.positionNode = vec3(cos(angle).mul(radius), sin(angle).mul(radius), state.x);
  // HSL(h, 1, 0.5) in the working space, matching THREE.Color.setHSL.
  material.colorNode = vec3(state.w, state.w.add(2 / 3), state.w.add(1 / 3)).fract().mul(6).sub(3).abs().sub(1).clamp(0, 1);
  material.opacityNode = sampleTexture(texture, uv()).a;
  material.scaleNode = vec2(size); sprite(material, simulation.count, scene);
  return {
    scene, camera,
    update(frame) {
      simulation.advance(frame);
      bounce.value = frame.response.bounce;
      size.value = 2.4 + frame.audio.highs * 2 + frame.response.impact;
      ringTexture.needsUpdate = offsetAttribute.needsUpdate = true;
      resizeCamera(camera, frame.aspect);
    }, dispose() { disposeScene(scene); texture.dispose(); ringTexture.dispose(); },
  };
}
function starTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('2D canvas unavailable for star texture');
  ctx.fillStyle = '#fff'; ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? 12 : 28; const x = 32 + Math.cos(a) * r, y = 32 + Math.sin(a) * r; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
  ctx.closePath(); ctx.fill(); return new THREE.CanvasTexture(canvas);
}
