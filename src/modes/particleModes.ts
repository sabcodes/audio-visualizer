import * as THREE from 'three/webgpu';
import { cos, instancedBufferAttribute, sin, uniform, uv, vec2, vec3, texture as sampleTexture } from 'three/tsl';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, colorize, disposeScene, wrap } from './shared';
import { seededRandom } from '../rendering/diagnostics';
import { FlockSimulation } from '../simulations/flock';

export function createParticleMode(id: 'particles' | 'boids' | 'starTunnel'): VisualMode {
  if (id === 'particles') return swirl();
  if (id === 'boids') return flock();
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
function swirl(): VisualMode {
  const { scene, camera } = sceneDefaults(115);
  const time = uniform(0), bounce = uniform(0), impact = uniform(0);
  const random = seededRandom(42), seeds = new Float32Array(8000 * 3);
  for (let i = 0; i < seeds.length; i += 3) { seeds[i] = random() * Math.PI * 2; seeds[i + 1] = 16 + random() * 22; seeds[i + 2] = (random() - 0.5) * 18; }
  const seed = instancedBufferAttribute<'vec3'>(new THREE.InstancedBufferAttribute(seeds, 3), 'vec3');
  const angle = seed.x.add(time.mul(0.6).mul(seed.y.div(40).add(0.2)));
  const radius = seed.y.mul(bounce.mul(1.2).add(1));
  const material = spriteMaterial();
  material.positionNode = vec3(cos(angle).mul(radius), seed.z.mul(bounce.mul(0.5).add(1)), sin(angle).mul(radius));
  material.scaleNode = vec2(impact.mul(0.35).add(0.55));
  sprite(material, 8000, scene);
  const ringMaterial = new THREE.MeshBasicNodeMaterial({ color: 0x333333 });
  scene.add(new THREE.Mesh(new THREE.TorusGeometry(26, 0.12, 8, 128), ringMaterial));
  return {
    scene, camera,
    update(frame) {
      time.value = frame.time; bounce.value = frame.response.bounce; impact.value = frame.response.impact;
      resizeCamera(camera, frame.aspect); colorize(material, frame, 0.28);
    }, dispose: () => disposeScene(scene),
  };
}
function flock(): VisualMode {
  const { scene, camera } = sceneDefaults();
  const simulation = new FlockSimulation();
  const positions = new Float32Array(220 * 3), attribute = new THREE.InstancedBufferAttribute(positions, 3);
  const size = uniform(0.7), material = spriteMaterial();
  material.positionNode = instancedBufferAttribute<'vec3'>(attribute, 'vec3');
  material.scaleNode = vec2(size); sprite(material, 220, scene);
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
  const count = 40 * 44, depth = 1400, spacing = depth / 40;
  const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3);
  const offsets = new Float32Array(count), velocities = new Float32Array(count);
  const z = Float32Array.from({ length: 40 }, (_, i) => -i * spacing);
  const rotation = new Float32Array(40), color = new THREE.Color();
  const positionAttribute = new THREE.InstancedBufferAttribute(positions, 3);
  const colorAttribute = new THREE.InstancedBufferAttribute(colors, 3);
  const texture = starTexture(), material = new THREE.SpriteNodeMaterial({ map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const size = uniform(2.4);
  material.positionNode = instancedBufferAttribute<'vec3'>(positionAttribute, 'vec3');
  material.colorNode = instancedBufferAttribute<'vec3'>(colorAttribute, 'vec3');
  material.opacityNode = sampleTexture(texture, uv()).a;
  material.scaleNode = vec2(size); sprite(material, count, scene);
  const pulses: { z: number; amplitude: number }[] = [];
  let accumulator = 0, lastOnsetTime = -Infinity;
  return {
    scene, camera,
    update(frame) {
      const dt = Math.max(0, Math.min(0.05, frame.delta));
      if (frame.audio.onset && dt > 0 && frame.time - lastOnsetTime > 0.18) {
        lastOnsetTime = frame.time;
        pulses.push({ z: -depth + 80, amplitude: 1 }); if (pulses.length > 8) pulses.shift();
        for (let i = 0; i < count; i += 7) velocities[i] += 40 + frame.response.impact * 60;
      }
      const forward = (200 + 700 * frame.response.bass) * dt;
      for (const pulse of pulses) { pulse.z += forward * 1.7; pulse.amplitude *= Math.exp(-dt * 0.5); }
      for (let i = pulses.length - 1; i >= 0; i--) if (pulses[i].z > 80 || pulses[i].amplitude < 0.05) pulses.splice(i, 1);
      accumulator += dt;
      while (accumulator + 1e-10 >= 1 / 120) {
        for (let i = 0; i < count; i++) {
          velocities[i] += -offsets[i] * 65 / 120; velocities[i] *= Math.exp(-5 / 120);
          offsets[i] = Math.max(-18, Math.min(40, offsets[i] + velocities[i] / 120));
        }
        accumulator = Math.max(0, accumulator - 1 / 120);
      }
      for (let ring = 0; ring < 40; ring++) {
        z[ring] = wrap(z[ring] + forward, -depth, 40);
        rotation[ring] += dt * (0.15 + frame.audio.mid * 2);
        let pulse = 0;
        for (const wave of pulses) pulse += wave.amplitude * Math.exp(-(((z[ring] - wave.z) / 110) ** 2) / 2);
        color.setHSL(wrap(frame.hue + ring * 0.01, 0, 1), 1, 0.5);
        for (let s = 0; s < 44; s++) {
          const i = ring * 44 + s, a = s * (Math.sqrt(5) - 1) * Math.PI + ring * 0.15 + rotation[ring];
          const base = 24 + 10 * Math.sin(ring / 39 * Math.PI);
          const radius = Math.max(2, Math.min(120, base * (1 + frame.response.bounce * 0.55 + pulse * 0.2) + offsets[i]));
          positions[i * 3] = Math.cos(a) * radius; positions[i * 3 + 1] = Math.sin(a) * radius; positions[i * 3 + 2] = z[ring];
          colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
        }
      }
      size.value = 2.4 + frame.audio.highs * 2 + frame.response.impact;
      positionAttribute.needsUpdate = colorAttribute.needsUpdate = true;
      resizeCamera(camera, frame.aspect);
    }, dispose() { disposeScene(scene); texture.dispose(); },
  };
}
function starTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('2D canvas unavailable for star texture');
  ctx.fillStyle = '#fff'; ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? 12 : 28; const x = 32 + Math.cos(a) * r, y = 32 + Math.sin(a) * r; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
  ctx.closePath(); ctx.fill(); return new THREE.CanvasTexture(canvas);
}
