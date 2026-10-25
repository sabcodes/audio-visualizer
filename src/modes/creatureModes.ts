import * as THREE from 'three/webgpu';
import { mix, normalView, uv, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, wrap, bandEnergies, approach, beatGate, settleStep } from './shared';
import { seededRandom } from '../rendering/diagnostics';

export const KRAKEN_ARMS = 8, KRAKEN_SEGMENTS = 14;
const SEGMENT_LENGTH = 3.2, TAPER = 0.9;

/** Bend (radians) at one joint: the arm's band curls it, a travelling wave ripples it, a beat whip flings it outward. */
export function tentacleBend(segment: number, curl: number, whip: number, phase: number) {
  const t = segment / (KRAKEN_SEGMENTS - 1);
  return (0.08 + curl * 0.32) * t - whip * 0.35 * (1 - t) + Math.sin(phase - segment * 0.55) * (0.1 + 0.12 * t);
}

export function createKrakenMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  const random = seededRandom(8);
  // Body: dark crimson skin with a fresnel rim; suckers and eyes glow through bloom.
  const skin = new THREE.MeshBasicNodeMaterial();
  const rim = normalView.z.abs().oneMinus().pow(2.2);
  skin.colorNode = mix(vec3(0.18, 0.02, 0.06), vec3(0.9, 0.2, 0.5), rim);
  const mantle = new THREE.Mesh(new THREE.SphereGeometry(6, 40, 28), skin);
  mantle.scale.set(1, 1.35, 1); mantle.position.y = 9;
  const glow = new THREE.MeshBasicNodeMaterial();
  const eyes = [-1, 1].map((side) => { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), glow); eye.position.set(side * 3.4, 6.5, 4.3); scene.add(eye); return eye; });
  scene.add(mantle);

  const count = KRAKEN_ARMS * KRAKEN_SEGMENTS;
  const segmentGeometry = new THREE.CylinderGeometry(0.85, 1, SEGMENT_LENGTH, 12, 1); segmentGeometry.translate(0, -SEGMENT_LENGTH / 2, 0);
  const segments = new THREE.InstancedMesh(segmentGeometry, skin, count); segments.frustumCulled = false;
  const suckerMaterial = new THREE.MeshBasicNodeMaterial();
  const suckers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.32, 10, 8), suckerMaterial, count); suckers.frustumCulled = false;
  suckers.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  scene.add(segments, suckers);

  // Marine snow drifting through the water column.
  const snowCount = 1200, snow = new Float32Array(snowCount * 3);
  for (let i = 0; i < snowCount; i++) snow.set([(random() - 0.5) * 160, (random() - 0.5) * 120, (random() - 0.5) * 120], i * 3);
  const snowGeometry = new THREE.BufferGeometry(); snowGeometry.setAttribute('position', new THREE.BufferAttribute(snow, 3));
  const snowMaterial = new THREE.PointsNodeMaterial({ color: 0x6fa8c8, transparent: true, opacity: 0.55, depthWrite: false });
  scene.add(new THREE.Points(snowGeometry, snowMaterial));
  const water = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  water.colorNode = mix(vec3(0.0, 0.004, 0.012), vec3(0.0, 0.05, 0.08), uv().y.smoothstep(0.35, 0.9));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), water));

  const bands = new Float32Array(KRAKEN_ARMS), curl = new Float32Array(KRAKEN_ARMS), phases = Float32Array.from({ length: KRAKEN_ARMS }, () => random() * Math.PI * 2);
  const whipGate = beatGate(0.35), matrix = new THREE.Matrix4(), step = new THREE.Matrix4(), bend = new THREE.Matrix4(), twist = new THREE.Matrix4();
  const scale = new THREE.Matrix4(), sucker = new THREE.Matrix4(), temp = new THREE.Matrix4(), colour = new THREE.Color();
  let whip = 0, orbit = 0, swim = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      if (whipGate(frame.time, frame.audio.onset)) whip = 1;
      whip = Math.max(0, whip - settleStep(frame) * 2.2);
      bandEnergies(frame, KRAKEN_ARMS, bands);
      const pulse = frame.response.bounce;
      mantle.scale.set(1 + pulse * 0.12, 1.35 - pulse * 0.1, 1 + pulse * 0.12);
      swim += frame.delta;
      const bob = Math.sin(swim * 0.8) * 1.5;
      for (const eye of eyes) eye.position.y = 6.5 + bob;
      mantle.position.y = 9 + bob;
      for (let a = 0; a < KRAKEN_ARMS; a++) {
        curl[a] = approach(curl[a], bands[a] * 2.4 + pulse * 0.6, frame.delta, 0.12);
        phases[a] += frame.delta * (1.6 + bands[a] * 2.5);
        const angle = a / KRAKEN_ARMS * Math.PI * 2;
        // Root on the mantle rim, pointing down and outward; local x is the curl axis.
        matrix.makeTranslation(Math.cos(angle) * 4.2, 3 + bob, Math.sin(angle) * 4.2)
          .multiply(temp.makeRotationY(-angle + Math.PI / 2))
          .multiply(temp.makeRotationX(-0.5));
        let size = 1;
        for (let s = 0; s < KRAKEN_SEGMENTS; s++) {
          bend.makeRotationX(-tentacleBend(s, curl[a], whip, phases[a]));
          twist.makeRotationZ(Math.sin(phases[a] * 0.7 - s * 0.4) * 0.06);
          matrix.multiply(bend).multiply(twist);
          scale.makeScale(size, 1, size);
          const index = a * KRAKEN_SEGMENTS + s;
          segments.setMatrixAt(index, step.copy(matrix).multiply(scale));
          // Sucker on the inner face, halfway down the segment.
          sucker.copy(matrix).multiply(temp.makeTranslation(0, -SEGMENT_LENGTH / 2, -0.95 * size)).multiply(temp.makeScale(size, size, size));
          suckers.setMatrixAt(index, sucker);
          const lit = 0.6 + bands[a] * 2.4 + Math.max(0, Math.sin(phases[a] * 2 - s * 0.9)) * 0.8;
          suckers.setColorAt(index, colour.setHSL(wrap(frame.hue + 0.5 + a * 0.02, 0, 1), 1, 0.55).multiplyScalar(lit));
          matrix.multiply(step.makeTranslation(0, -SEGMENT_LENGTH * size, 0));
          size *= TAPER;
        }
      }
      segments.instanceMatrix.needsUpdate = true; suckers.instanceMatrix.needsUpdate = true; suckers.instanceColor!.needsUpdate = true;
      glow.color.setHSL(wrap(frame.hue + 0.15, 0, 1), 1, 0.55).multiplyScalar(2 + (frame.reducedFlash ? 0 : whip * 3) + pulse);
      suckerMaterial.color.setRGB(1, 1, 1);
      for (let i = 0; i < snowCount; i++) {
        snow[i * 3 + 1] -= frame.delta * (1.2 + (i % 7) * 0.2);
        snow[i * 3] += frame.delta * frame.response.bass * 6;
        if (snow[i * 3 + 1] < -60) snow[i * 3 + 1] += 120;
        if (snow[i * 3] > 80) snow[i * 3] -= 160;
      }
      snowGeometry.attributes.position.needsUpdate = true;
      orbit += frame.delta * 0.09;
      camera.position.set(Math.sin(orbit) * 46, 4 + Math.sin(orbit * 0.7) * 8, Math.cos(orbit) * 46);
      camera.lookAt(0, -6, 0);
    },
    dispose: () => disposeScene(scene),
  };
}
