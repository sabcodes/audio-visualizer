import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { atan, attribute, exp, float, mix, mx_fractal_noise_float, mx_noise_float, positionLocal, positionWorld, sin, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import type { QualityBudget } from '../rendering/quality';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { createHits } from './hitPulse';
import { seededRandom } from '../rendering/diagnostics';

type F = Node<'float'>;
type V2 = Node<'vec2'>;

/** Meadow radius around the camera covered by real blades, in metres; beyond it a textured ground takes over. */
export const MEADOW_RADIUS = 34;

/** A single tapered blade: five rows of quads narrowing to a point, 1 m tall, its base at the origin. */
export function bladeGeometry(rows = 5) {
  const positions: number[] = [], uvs: number[] = [], index: number[] = [];
  for (let r = 0; r <= rows; r++) {
    const t = r / rows, half = 0.5 * Math.pow(1 - t, 0.7);
    positions.push(-half, t, 0, half, t, 0); uvs.push(0, t, 1, t);
    if (r < rows) { const i = r * 2; index.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  return geometry;
}

/** Clumped blade placement: clump centres scattered round the camera, blades jittered inside each clump. Returns x, z, height, width, turn, tone. */
export function meadowLayout(count: number, seed = 11) {
  const random = seededRandom(seed), out = new Float32Array(count * 6);
  const patch = (x: number, z: number) => 0.5 + 0.5 * Math.sin(x * 0.23 + Math.sin(z * 0.17) * 2) * Math.cos(z * 0.19 - x * 0.07);
  for (let i = 0, clump = 0, cx = 0, cz = 0, size = 0; i < count; i++) {
    if (clump <= 0) {
      // Denser near the camera, thinning out with distance.
      const r = MEADOW_RADIUS * Math.pow(random(), 0.75), a = random() * Math.PI * 2;
      cx = Math.cos(a) * r; cz = Math.sin(a) * r; clump = 6 + Math.floor(random() * 18); size = 0.12 + random() * 0.35;
    }
    clump--;
    const x = cx + (random() - 0.5) * size, z = cz + (random() - 0.5) * size, lush = patch(x, z);
    // Patches: tall lush grass in some places, short and sparse in others.
    const height = (0.25 + lush * 0.75) * (0.6 + random() * 0.6);
    out.set([x, z, height, 0.012 + random() * 0.018, random() * Math.PI * 2, lush * 0.7 + random() * 0.3], i * 6);
  }
  return out;
}

/** Sky colour toward a direction: gradient, sun glow, and time-lapse cumulus banks above the horizon. */
function skyColour(direction: Node<'vec3'>, cloudTime: F, growth: F) {
  const elevation = direction.y, azimuth = atan(direction.x, direction.z.negate());
  const cx = azimuth.mul(1.6).add(cloudTime.mul(0.01)), above = elevation;
  const tops = mx_fractal_noise_float(vec3(cx.mul(1.6), 0, cloudTime.mul(0.02)), 3, 2, 0.5).mul(0.5).add(0.5).mul(0.42).add(0.1).mul(growth);
  const billow = mx_fractal_noise_float(vec3(cx.mul(5), above.mul(6), cloudTime.mul(0.05)), 5, 2, 0.55);
  const cloud = tops.sub(above).add(billow.mul(0.13)).smoothstep(0, 0.03).mul(above.smoothstep(-0.01, 0.015));
  const towardSun = mx_fractal_noise_float(vec3(cx.mul(5).sub(0.12), above.mul(6).add(0.1), cloudTime.mul(0.05)), 5, 2, 0.55);
  const shade = billow.sub(towardSun).mul(-3).add(0.6).clamp(0, 1).mul(0.7).add(above.div(tops.max(0.05)).clamp(0, 1).mul(0.3));
  const cloudLight = mix(vec3(0.5, 0.55, 0.62), vec3(0.92, 0.93, 0.95), shade);
  const sky = mix(vec3(0.2, 0.45, 0.7), vec3(0.03, 0.22, 0.52), above.mul(2.5).clamp(0, 1));
  return mix(sky, cloudLight, cloud);
}

export function createWindfieldMode(budget: QualityBudget): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).fov = 50; (camera as THREE.PerspectiveCamera).near = 0.05; (camera as THREE.PerspectiveCamera).far = 1200;
  const count = budget.particleScale >= 2 ? 300000 : budget.particleScale >= 1 ? 160000 : 60000;
  const time = uniform(0), gust = uniform(0.4), gustFront = uniform(-40), lean = uniform(0.3), shimmer = uniform(0), cloudTime = uniform(0), growth = uniform(0.8);
  const windDir = vec2(0.85, 0.53);
  // Sky dome.
  const skyMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  const direction = positionLocal.normalize();
  skyMaterial.colorNode = direction.y.greaterThan(0).select(skyColour(direction, cloudTime, growth), vec3(0.16, 0.36, 0.14));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), skyMaterial));
  // The wind: broad gust waves rolling across the field plus fine flutter, sampled per blade in world space.
  const windAt = (p: V2) => {
    const roll = mx_fractal_noise_float(vec3(p.mul(0.06).sub(windDir.mul(time.mul(0.35))), time.mul(0.05)), 3, 2, 0.5).mul(0.5).add(0.5);
    const front = exp(p.dot(windDir).sub(gustFront).abs().mul(-0.15)).mul(gust);
    return { roll, front, sway: roll.mul(0.6).add(front).add(lean) };
  };
  // Cloud shadows drifting over the meadow.
  const shadowAt = (p: V2) => mx_fractal_noise_float(vec3(p.mul(0.012).sub(vec2(time.mul(0.02), 0)), 7), 3, 2, 0.5).smoothstep(0.05, 0.35).mul(0.45).add(0.55);
  // Blades: bend downwind, more toward the tip; bent grass catches the light and looks paler, which shows the gusts.
  const bladeMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const base = positionLocal.xz, t = uv().y, wind = windAt(base);
  const flutter = sin(time.mul(6).add(base.x.mul(3.1)).add(base.y.mul(2.3))).mul(0.06).add(mx_noise_float(vec3(base.mul(1.7), time.mul(1.2))).mul(0.08));
  const bend = wind.sway.add(flutter).mul(t.mul(t));
  bladeMaterial.positionNode = positionLocal.add(vec3(windDir.x.mul(bend).mul(0.45), bend.mul(bend).mul(-0.12), windDir.y.mul(bend).mul(0.45)));
  const tone = attribute<'float'>('tone');
  const root = mix(vec3(0.02, 0.07, 0.01), vec3(0.04, 0.1, 0.015), tone);
  const tipColour = mix(vec3(0.12, 0.34, 0.04), vec3(0.32, 0.5, 0.09), tone);
  const sheen = wind.sway.mul(0.35).add(wind.front.mul(0.5)).clamp(0, 1);
  const glint = shimmer.mul(t.pow(6)).mul(0.25);
  bladeMaterial.colorNode = mix(root, tipColour, t.pow(0.7)).mul(sheen.mul(0.8).add(0.7)).mul(shadowAt(base)).add(vec3(0.3, 0.35, 0.2).mul(glint));
  const blades = new THREE.InstancedMesh(bladeGeometry(), bladeMaterial, count);
  const layout = meadowLayout(count), tones = new Float32Array(count);
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), at = new THREE.Vector3(), size = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    const [x, z, h, w, turn, lush] = layout.subarray(i * 6, i * 6 + 6);
    blades.setMatrixAt(i, matrix.compose(at.set(x, 0, z), q.setFromAxisAngle(up, turn), size.set(w, h, 1)));
    tones[i] = lush;
  }
  blades.geometry.setAttribute('tone', new THREE.InstancedBufferAttribute(tones, 1));
  blades.frustumCulled = false;
  // The far meadow: a ground plane with streaked grass shading, the same gusts and cloud shadows, fading into haze.
  const groundMaterial = new THREE.MeshBasicNodeMaterial();
  const g = positionWorld.xz, far = windAt(g);
  const streaks = mx_noise_float(vec3(g.x.mul(9), g.y.mul(1.5), 2)).mul(0.5).add(0.5);
  const distance = g.length();
  const groundColour = mix(vec3(0.05, 0.16, 0.02), vec3(0.2, 0.45, 0.07), far.sway.mul(0.4).add(far.front.mul(0.4)).add(streaks.mul(0.3)).clamp(0, 1)).mul(shadowAt(g));
  groundMaterial.colorNode = mix(groundColour, vec3(0.42, 0.58, 0.62), distance.div(900).clamp(0, 1).pow(0.6).mul(0.7));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(950, 64), groundMaterial); ground.rotation.x = -Math.PI / 2;
  scene.add(ground, blades);

  const hits = createHits({ decay: 0.8, interval: 2 });
  let frontAt = -40, clock = 0, yaw = 0, height = 1, push = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time;
      const step = settleStep(frame), still = frame.reducedMotion;
      hits.update(frame, 1);
      // A hit sends a gust front rolling across the field.
      if (hits.fired && !still) frontAt = -30;
      frontAt += step * 9; gustFront.value = frontAt;
      gust.value = approach(gust.value, frontAt < 60 ? 0.7 + frame.response.bass : frame.response.bass * 0.5, step, 0.4);
      lean.value = approach(lean.value, still ? 0.15 : 0.15 + frame.response.loudness * 0.6, step, 0.5);
      shimmer.value = frame.audio.highs;
      clock += still ? 0 : frame.delta;
      cloudTime.value = clock * 6;
      growth.value = 0.7 + 0.3 * Math.abs(Math.sin(clock * 0.02));
      // The camera pivots slowly to show the field from different angles, dips toward the grass and pushes in on the bass.
      yaw = Math.sin(clock * 0.045) * 0.9 + Math.sin(clock * 0.017) * 0.5;
      height = 0.75 + Math.sin(clock * 0.06) * 0.35;
      push = approach(push, still ? 0 : frame.response.bass * 1.5, step, 0.8);
      const forward = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
      camera.position.set(forward.x * push, height, forward.z * push);
      camera.lookAt(camera.position.x + forward.x * 10, height + 0.6 + Math.sin(clock * 0.03) * 0.5, camera.position.z + forward.z * 10);
    },
    dispose: () => disposeScene(scene),
  };
}
