import * as THREE from 'three/webgpu';
import { cos, mix, mx_noise_float, normalLocal, positionLocal, positionWorld, sin, uniform, vec3 } from 'three/tsl';
import type { QualityBudget } from '../rendering/quality';

/** Water uniforms are shared by the supplied canals, fountain sheets and the open ocean. */
export function createWater7Water(scene: THREE.Scene, budget: QualityBudget) {
  const clock = uniform(0), bass = uniform(0), mids = uniform(0), highs = uniform(0), pulse = uniform(0), daylight = uniform(1);
  const p = positionLocal, radius = p.xz.length(), shore = radius.smoothstep(51, 65);
  const a = p.x.mul(0.075).add(p.z.mul(0.045)).sub(clock.mul(1.25));
  const b = p.z.mul(0.14).sub(p.x.mul(0.055)).add(clock.mul(1.7));
  const height = sin(a).mul(bass.mul(1.1).add(0.8)).add(sin(b).mul(0.42)).mul(shore);
  const oceanMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  oceanMaterial.positionNode = vec3(p.x, height.sub(0.18), p.z);
  const ripple = sin(positionWorld.x.mul(1.2).add(clock)).mul(cos(positionWorld.z.mul(1.8).sub(clock.mul(1.9))));
  const crest = sin(a).mul(0.65).add(sin(b).mul(0.35));
  const texture = mx_noise_float(positionWorld.mul(0.2).add(vec3(clock.mul(0.08), 0, 0))).mul(0.5).add(0.5);
  const foam = crest.smoothstep(0.94, 1).mul(texture.pow(3)).mul(bass.mul(0.12).add(0.025));
  const glint = ripple.smoothstep(0.96, 1).mul(texture).mul(highs.mul(0.06).add(0.015));
  const sea = mix(vec3(0.012, 0.14, 0.25), vec3(0.035, 0.46, 0.57), crest.mul(0.17).add(texture.mul(0.17)).add(0.42));
  oceanMaterial.colorNode = mix(sea, vec3(0.68, 0.94, 1), foam.add(glint).clamp()).mul(daylight.mul(0.72).add(0.28));
  const grid = budget.preset === 'compatibility' ? 160 : 240;
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400, grid, grid).rotateX(-Math.PI / 2), oceanMaterial);
  ocean.name = 'Water 7 / open ocean'; ocean.frustumCulled = false; scene.add(ocean);

  const canalMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const w = positionWorld, radial = w.xz.length();
  const current = sin(radial.mul(3).sub(clock.mul(mids.mul(1.5).add(3.5)))).mul(0.5).add(0.5);
  const caustic = sin(w.x.mul(4).add(clock)).mul(sin(w.z.mul(3).sub(clock.mul(1.4)))).abs().pow(12);
  canalMaterial.colorNode = mix(vec3(0.025, 0.31, 0.42), vec3(0.15, 0.69, 0.77), current.mul(0.4).add(0.25))
    .add(vec3(0.35, 0.55, 0.5).mul(caustic.mul(0.28).add(highs.mul(0.04))))
    .mul(daylight.mul(0.65).add(0.35));
  // Authored canal meshes are intentionally kept in place: only their surface light flows downhill.
  canalMaterial.positionNode = p.add(vec3(0, sin(p.x.mul(4).add(p.z.mul(3)).sub(clock.mul(2))).mul(0.018), 0));
  const fallingMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const streak = sin(w.y.mul(9).add(clock.mul(15)).add(w.x.mul(2))).mul(0.5).add(0.5);
  fallingMaterial.colorNode = mix(vec3(0.08, 0.49, 0.68), vec3(0.72, 0.96, 1), streak.pow(4).mul(0.8).add(0.1))
    .mul(daylight.mul(0.7).add(0.3)).add(vec3(0.02, 0.05, 0.06).mul(pulse));
  fallingMaterial.positionNode = p.add(normalLocal.mul(sin(p.y.mul(4).add(clock.mul(8))).mul(mids.mul(0.025).add(0.015))));
  const fountainMaterial = canalMaterial.clone();
  fountainMaterial.colorNode = canalMaterial.colorNode!.mul(mids.mul(0.28).add(1));

  // Traveling, curling wave fronts approach the seawall, then throw a fan of foam above it.
  const segments = 90, cross = 14, waveCount = 3, dummy = new THREE.Object3D();
  const waves = Array.from({ length: waveCount }, (_, k) => {
    const positions = new Float32Array((segments + 1) * (cross + 1) * 3), colors = new Float32Array(positions.length), indices: number[] = [];
    for (let i = 0; i < segments; i++) for (let j = 0; j < cross; j++) {
      const n = i * (cross + 1) + j; indices.push(n, n + cross + 1, n + 1, n + 1, n + cross + 1, n + cross + 2);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, vertexColors: true, transparent: true, opacity: 0.86, depthWrite: false });
    const impactLevel = uniform(0), washMaterial = new THREE.MeshBasicNodeMaterial({ color: 0xc2f2f6, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const washRadius = positionLocal.xy.length();
    washMaterial.opacityNode = washRadius.smoothstep(52, 54).mul(washRadius.smoothstep(61, 56))
      .mul(mx_noise_float(positionWorld.mul(2).add(vec3(clock, 0, 0))).mul(0.35).add(0.5)).mul(impactLevel);
    const wash = new THREE.Mesh(new THREE.RingGeometry(52, 61, 96, 4, Math.PI / 2 - k * 2.1 - 0.64, 1.28), washMaterial);
    wash.rotation.x = -Math.PI / 2; wash.position.y = 0.12; wash.name = `Water 7 / seawall foam ${k + 1}`; scene.add(wash);
    const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; mesh.name = `Water 7 / breaking wave ${k + 1}`; scene.add(mesh);
    return { mesh, positions, colors, impactLevel };
  });
  const sprayCount = budget.preset === 'compatibility' ? 180 : 360;
  const sprayMaterial = new THREE.MeshBasicNodeMaterial({ color: 0xd4f8ff, transparent: true, opacity: 0.75, depthWrite: false });
  const spray = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 4, 3), sprayMaterial, sprayCount);
  spray.name = 'Water 7 / seawall spray'; spray.frustumCulled = false; spray.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(spray);
  const mist = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 4, 3), sprayMaterial, 160);
  mist.name = 'Water 7 / fountain droplets'; mist.frustumCulled = false; mist.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(mist);
  const jets = new THREE.Group(); jets.name = 'Water 7 / fountain jets'; scene.add(jets);
  const jetMaterial = new THREE.MeshBasicNodeMaterial({ color: 0x9ae9f5 });
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4, points = Array.from({ length: 20 }, (_, j) => {
      const u = j / 19, r = 3.5 + u * 5;
      return new THREE.Vector3(Math.cos(angle) * r, 33.4 + Math.sin(u * Math.PI) * 5 - u * 1.5, Math.sin(angle) * r);
    });
    jets.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, 0.07, 4, false), jetMaterial));
  }
  // Scale the streams around the basin waterline so the mids lift the arcs without moving their origins.
  jets.position.y = 33.4;
  jets.children.forEach(jet => (jet as THREE.Mesh).geometry.translate(0, -33.4, 0));
  let maxHeight = 0, activeSpray = 0;
  const update = (dt: number) => {
    clock.value += dt; maxHeight = 0; activeSpray = 0;
    const t = clock.value; jets.scale.y = 1 + mids.value * 0.3 + pulse.value * 0.07;
    jetMaterial.color.setRGB(0.22 + daylight.value * 0.25, 0.65 + daylight.value * 0.15, 0.86 + daylight.value * 0.08);
    for (let k = 0; k < waveCount; k++) {
      const { mesh, positions, colors, impactLevel } = waves[k];
      const phase = ((t + k * 2.5) % 7.5) / 7.5, impact = Math.max(0, 1 - Math.abs(phase - 0.78) / 0.18);
      impactLevel.value = impact * (0.6 + bass.value * 0.3);
      const r = phase < 0.75 ? 98 - phase / 0.75 * 43 : 55 - (phase - 0.75) * 8;
      const amplitude = (3.2 + bass.value * 5.5 + pulse.value * 2.5) * Math.sin(Math.PI * Math.min(1, phase / 0.9));
      for (let i = 0; i <= segments; i++) for (let j = 0; j <= cross; j++) {
        const s = i / segments, u = j / cross, theta = -Math.PI / 2 + k * 2.1 + (s - 0.5) * 1.28;
        const edge = Math.sin(s * Math.PI) ** 0.5, curl = u * Math.PI;
        const distance = r + (u - 0.5) * 7 - Math.sin(curl) * impact * 2;
        const y = Math.sin(curl) * amplitude * edge * (1 + impact * 0.6) - 0.16;
        const n = (i * (cross + 1) + j) * 3;
        positions.set([Math.cos(theta) * distance, y, Math.sin(theta) * distance], n);
        const white = Math.exp(-((u - 0.5) ** 2) * 95) * (0.6 + Math.sin(s * 140 + t * 4) * 0.15 + impact * 0.2);
        const light = daylight.value * 0.65 + 0.35;
        colors.set([(0.04 + white * 0.8) * light, (0.44 + white * 0.5) * light, (0.55 + white * 0.45) * light], n);
        maxHeight = Math.max(maxHeight, y);
      }
      mesh.material.opacity = phase > 0.9 ? (1 - phase) * 8.6 : 0.86;
      mesh.geometry.attributes.position.needsUpdate = mesh.geometry.attributes.color.needsUpdate = true;
      for (let i = k; i < sprayCount; i += waveCount) {
        const seed = i * 1.618, angle = -Math.PI / 2 + k * 2.1 + (Math.sin(seed) * 0.55);
        const age = ((t * 1.7 + seed) % 1), life = Math.sin(age * Math.PI), height = impact * (3 + bass.value * 9 + pulse.value * 3);
        dummy.position.set(Math.cos(angle) * (53 + age * 6), life * height, Math.sin(angle) * (53 + age * 6));
        dummy.scale.setScalar(impact > 0.05 ? (0.45 + life) * impact : 0); dummy.updateMatrix(); spray.setMatrixAt(i, dummy.matrix);
        if (impact > 0.05) activeSpray++;
      }
    }
    spray.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < 160; i++) {
      const angle = i * 2.39996, cycle = (t * (0.36 + mids.value * 0.12) + i * 0.037) % 1;
      const r = 3.2 + cycle * (5.5 + mids.value * 1.5), height = Math.sin(cycle * Math.PI) * (5 + mids.value * 3);
      dummy.position.set(Math.cos(angle) * r, 33.4 + height - cycle * 2, Math.sin(angle) * r);
      dummy.scale.setScalar(Math.sin(cycle * Math.PI) * 0.9); dummy.updateMatrix(); mist.setMatrixAt(i, dummy.matrix);
    }
    mist.instanceMatrix.needsUpdate = true;
  };
  return { clock, bass, mids, highs, pulse, daylight, ocean, waves, spray, canalMaterial, fallingMaterial, fountainMaterial, update,
    stats: () => ({ waveHeight: maxHeight, spray: activeSpray }),
    // These may be unreferenced if an asset fails to load; owned independently of the model cache.
    dispose() { canalMaterial.dispose(); fallingMaterial.dispose(); fountainMaterial.dispose(); },
  };
}
