import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { cameraPosition, cos, dot, exp, float, fract, max, mix, mx_noise_float, normalView, normalize, positionLocal, reflect, sin, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, wrap, bandEnergies, approach, beatGate } from './shared';
import { seededRandom } from '../rendering/diagnostics';
import { presetBudget, type QualityBudget } from '../rendering/quality';

type F = Node<'float'>;
type V2 = Node<'vec2'>;

// ---------------------------------------------------------------- Audio ocean

/** Gerstner-style wave set: direction (x, z), wavelength, relative amplitude. */
const WAVES = [[1, 0.3, 38, 1], [0.6, 0.8, 23, 0.6], [-0.4, 1, 14, 0.35], [0.9, -0.5, 9, 0.2]] as const;

export function createOceanMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  camera.position.set(0, 14, 70); camera.lookAt(0, 6, -60);
  const time = uniform(0), swell = uniform(1), steep = uniform(0.5), ring = uniform(-1), hue = uniform(0);
  const moon = vec3(0, 0.22, -1).normalize();
  // Height only (the vertical part of each Gerstner wave); the moving ring is an impact ripple from the centre.
  const height = (p: V2): F => {
    let h: F = float(0);
    for (const [dx, dz, length, amp] of WAVES) {
      const k = (Math.PI * 2) / length, dir = vec2(dx, dz).normalize(), speed = Math.sqrt(9.8 / k);
      const phase = dot(dir, p).mul(k).sub(time.mul(speed));
      // Sharper crests as steepness rises: lift the cosine toward a cusp.
      h = h.add(sin(phase).mul(0.5).add(0.5).pow(steep.mul(2.5).add(1)).mul(amp * length * 0.05).mul(swell));
    }
    const d = p.add(vec2(0, 40)).length(), ripple = sin(d.mul(0.6).sub(ring.mul(28))).mul(exp(d.sub(ring.mul(28)).abs().mul(-0.12))).mul(ring.greaterThanEqual(0).select(float(1.8), float(0)));
    return h.add(ripple);
  };
  const material = new THREE.MeshBasicNodeMaterial();
  const xz = positionLocal.xz;
  material.positionNode = vec3(positionLocal.x, height(xz), positionLocal.z);
  const e = 0.25, h0 = height(xz), normal = normalize(vec3(h0.sub(height(xz.add(vec2(e, 0)))).div(e), 1, h0.sub(height(xz.add(vec2(0, e)))).div(e)));
  const view = normalize(cameraPosition.sub(vec3(positionLocal.x, h0, positionLocal.z)));
  const r = reflect(view.negate(), normal);
  const fresnel = max(float(0), dot(view, normal)).oneMinus().pow(4).mul(0.9).add(0.05);
  const glitter = max(float(0), dot(r, moon)).pow(500).mul(18).add(max(float(0), dot(r, moon)).pow(80).mul(0.12));
  const skyTone = vec3(0.02, 0.05, 0.11).mul(r.y.smoothstep(-0.1, 0.6).oneMinus().mul(0.7).add(0.3));
  const deep = vec3(0.002, 0.012, 0.03);
  const foam = h0.smoothstep(swell.mul(5), swell.mul(7)).mul(steep.mul(0.15).add(0.05));
  const tint = vec3(hue, hue.add(2 / 3), hue.add(1 / 3)).fract().mul(6).sub(3).abs().sub(1).clamp(0, 1);
  material.colorNode = mix(deep, skyTone, fresnel).add(vec3(1, 0.95, 0.85).mul(glitter)).add(vec3(0.5, 0.6, 0.65).mul(foam)).add(tint.mul(0.02));
  const geometry = new THREE.PlaneGeometry(420, 420, 300, 300); geometry.rotateX(-Math.PI / 2); geometry.translate(0, 0, -150);
  const sea = new THREE.Mesh(geometry, material); sea.frustumCulled = false;

  const skyMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  const dir = normalize(positionLocal);
  const halo = max(float(0), dot(dir, moon)).pow(300).mul(0.25).add(max(float(0), dot(dir, moon)).pow(4000).mul(12));
  const stars = fract(sin(dot(dir.xy.mul(400).floor(), vec2(12.9898, 78.233))).mul(43758.5453)).step(0.996).mul(dir.y.smoothstep(0.05, 0.3)).mul(0.8);
  skyMaterial.colorNode = mix(vec3(0.03, 0.06, 0.12), vec3(0.002, 0.004, 0.015), dir.y.smoothstep(0, 0.5)).add(vec3(1, 0.96, 0.88).mul(halo)).add(vec3(stars));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), skyMaterial), sea);

  const impact = beatGate(0.8);
  let ringAge = -1;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time; hue.value = frame.hue;
      swell.value = approach(swell.value, 0.7 + frame.response.bounce * 1.4, frame.delta, 0.25);
      steep.value = approach(steep.value, 0.3 + frame.audio.mid * 1.2, frame.delta, 0.3);
      if (impact(frame.time, frame.audio.onset && frame.response.impact > 0.4)) ringAge = 0;
      if (ringAge >= 0) { ringAge += frame.delta; if (ringAge > 4) ringAge = -1; }
      ring.value = ringAge;
      camera.position.y = 14 + Math.sin(frame.time * 0.3) * 1.2;
      camera.rotation.z = Math.sin(frame.time * 0.25) * 0.015;
    },
    dispose: () => disposeScene(scene),
  };
}

// ---------------------------------------------------------------- Abyss (jellyfish choir)

export const JELLIES = 9;
const TENDRILS = 6, TENDRIL_POINTS = 24;

export function createAbyssMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const { scene, camera } = sceneDefaults(80);
  const random = seededRandom(13);
  // Water: dark gradient with slow caustic shimmer from above.
  const time = uniform(0);
  const waterMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  const dir = normalize(positionLocal);
  const caustic = mx_noise_float(vec3(dir.x.mul(8), dir.z.mul(8), time.mul(0.15))).abs().oneMinus().pow(6).mul(dir.y.smoothstep(0.3, 1)).mul(0.05);
  waterMaterial.colorNode = mix(vec3(0, 0.002, 0.008), vec3(0.0, 0.035, 0.06), dir.y.smoothstep(-0.4, 0.9)).add(vec3(0.1, 0.4, 0.5).mul(caustic));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), waterMaterial));

  const bellGeometry = new THREE.SphereGeometry(5, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.52);
  const jellies = Array.from({ length: JELLIES }, (_, i) => {
    const glow = uniform(new THREE.Color()), pulse = uniform(0);
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    // Rim-lit translucent bell with radial ribs and a brighter skirt.
    const rim = normalView.z.abs().oneMinus().pow(1.5);
    const ribs = cos(uv().x.mul(Math.PI * 2 * 8)).mul(0.5).add(0.5).pow(4).mul(0.4);
    const skirt = uv().y.smoothstep(0.62, 0.5).mul(0.6);
    material.colorNode = glow.mul(rim.add(ribs).add(skirt).mul(pulse.mul(1.6).add(0.5)));
    const bell = new THREE.Mesh(bellGeometry, material);
    const tendrilMaterial = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const positions = new Float32Array(TENDRILS * TENDRIL_POINTS * 2 * 3), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const tendrils = new THREE.LineSegments(geometry, tendrilMaterial); tendrils.frustumCulled = false;
    const group = new THREE.Group(); group.add(bell, tendrils);
    group.position.set((i - (JELLIES - 1) / 2) * 13 + (random() - 0.5) * 6, (random() - 0.5) * 50, (random() - 0.5) * 40);
    scene.add(group);
    return { group, bell, glow, pulse, tendrilMaterial, positions, geometry, phase: random() * Math.PI * 2, rise: 2 + random() * 2, size: 0.7 + random() * 0.6, energy: 0 };
  });

  // Marine snow, sized by the quality budget.
  const snowCount = Math.round(2500 * budget.particleScale), snow = new Float32Array(snowCount * 3);
  for (let i = 0; i < snowCount; i++) snow.set([(random() - 0.5) * 200, (random() - 0.5) * 140, (random() - 0.5) * 140], i * 3);
  const snowGeometry = new THREE.BufferGeometry(); snowGeometry.setAttribute('position', new THREE.BufferAttribute(snow, 3));
  scene.add(new THREE.Points(snowGeometry, new THREE.PointsNodeMaterial({ color: 0x88b8d0, transparent: true, opacity: 0.5, depthWrite: false })));

  const bands = new Float32Array(JELLIES), flashGate = beatGate(0.5);
  let flash = 0, current = 0, orbit = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time;
      if (flashGate(frame.time, frame.audio.onset)) flash = 1;
      flash = Math.max(0, flash - frame.delta * 1.8);
      current = approach(current, frame.response.bass * 10, frame.delta, 0.4);
      bandEnergies(frame, JELLIES, bands);
      jellies.forEach((jelly, i) => {
        jelly.energy = approach(jelly.energy, bands[i], frame.delta, 0.08);
        // Each contraction pushes the jelly upward; louder bands swim harder.
        jelly.phase += frame.delta * (1.4 + jelly.energy * 3);
        const squeeze = Math.max(0, Math.sin(jelly.phase)) ** 2;
        jelly.group.position.y += frame.delta * (jelly.rise * (0.4 + squeeze * 1.6) + jelly.energy * 4);
        jelly.group.position.x += frame.delta * current * 0.3;
        if (jelly.group.position.y > 45) jelly.group.position.y -= 95;
        if (jelly.group.position.x > 70) jelly.group.position.x -= 140;
        jelly.bell.scale.set(jelly.size * (1 - squeeze * 0.22), jelly.size * (1 + squeeze * 0.18), jelly.size * (1 - squeeze * 0.22));
        jelly.pulse.value = jelly.energy * 1.5 + squeeze * 0.3 + (frame.reducedFlash ? 0 : flash * 0.8);
        jelly.glow.value.setHSL(wrap(frame.hue + i / JELLIES * 0.4, 0, 1), 1, 0.55);
        jelly.tendrilMaterial.color.copy(jelly.glow.value).multiplyScalar(0.6 + jelly.energy * 1.5);
        let o = 0;
        for (let t = 0; t < TENDRILS; t++) {
          const a = t / TENDRILS * Math.PI * 2, rx = Math.cos(a) * 3.5 * jelly.size, rz = Math.sin(a) * 3.5 * jelly.size;
          let px = rx, py = 0.2, pz = rz;
          for (let k = 0; k < TENDRIL_POINTS; k++) {
            const sway = Math.sin(jelly.phase * 0.8 - k * 0.35 + t) * (0.15 + k * 0.03);
            const nx = rx * (1 - k / TENDRIL_POINTS * 0.5) + sway - current * k * 0.02, ny = -k * 1.1 * jelly.size * (1 + squeeze * 0.1), nz = rz * (1 - k / TENDRIL_POINTS * 0.5) + Math.cos(jelly.phase * 0.7 - k * 0.3 + t) * 0.15 * k * 0.1;
            jelly.positions.set([px, py, pz, nx, ny, nz], o); o += 6;
            px = nx; py = ny; pz = nz;
          }
        }
        jelly.geometry.attributes.position.needsUpdate = true;
      });
      for (let i = 0; i < snowCount; i++) {
        snow[i * 3 + 1] -= frame.delta * (0.8 + (i % 5) * 0.25);
        snow[i * 3] += frame.delta * current;
        if (snow[i * 3 + 1] < -70) snow[i * 3 + 1] += 140;
        if (snow[i * 3] > 100) snow[i * 3] -= 200;
      }
      snowGeometry.attributes.position.needsUpdate = true;
      orbit += frame.delta * 0.04;
      camera.position.set(Math.sin(orbit) * 80, Math.sin(frame.time * 0.1) * 6, Math.cos(orbit) * 80);
      camera.lookAt(0, 0, 0);
    },
    dispose: () => disposeScene(scene),
  };
}
