import * as THREE from 'three/webgpu';
import { attribute, exp, float, mix, mx_fractal_noise_float, normalize, positionLocal, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, approach, beatGate, settleStep } from './shared';
import { seededRandom } from '../rendering/diagnostics';
import { presetBudget, type QualityBudget } from '../rendering/quality';

const CLOUD_BASE = 110, BOLTS = 3, BOLT_SEGMENTS = 160;

/**
 * A jagged lightning path from `top` to `bottom` by midpoint displacement, plus forks off the main channel.
 * Returns line-segment endpoints (x, y, z pairs) and how many segments were written.
 */
export function lightningPath(top: THREE.Vector3, bottom: THREE.Vector3, random: () => number, out: Float32Array, depth = 6) {
  let points = [top.clone(), bottom.clone()];
  let spread = top.distanceTo(bottom) * 0.22;
  for (let level = 0; level < depth; level++) {
    const next: THREE.Vector3[] = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const mid = points[i - 1].clone().lerp(points[i], 0.5);
      mid.x += (random() - 0.5) * spread; mid.z += (random() - 0.5) * spread * 0.6;
      next.push(mid, points[i]);
    }
    points = next; spread *= 0.55;
  }
  let written = 0;
  const push = (a: THREE.Vector3, b: THREE.Vector3) => { if (written < out.length / 6) { out.set([a.x, a.y, a.z, b.x, b.y, b.z], written * 6); written++; } };
  for (let i = 1; i < points.length; i++) push(points[i - 1], points[i]);
  // Forks: short jagged branches leaving the channel partway down.
  for (let f = 0; f < 3; f++) {
    let at = points[Math.floor((0.15 + random() * 0.5) * points.length)].clone();
    const heading = new THREE.Vector3((random() - 0.5) * 2, -1, (random() - 0.5)).normalize();
    for (let k = 0; k < 10; k++) {
      const next = at.clone().addScaledVector(heading, 3 + random() * 3);
      next.x += (random() - 0.5) * 3;
      push(at, next); at = next;
    }
  }
  return written;
}

export function createStormMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  camera.position.set(0, 8, 70); camera.lookAt(0, 40, -100);
  const random = seededRandom(17);
  const time = uniform(0), churn = uniform(0), drift = uniform(new THREE.Vector2()), flash = uniform(0), flashAt = uniform(new THREE.Vector2(0, -120)), ambient = uniform(1);
  // Sky: near-black with a faint glow at the horizon, lifted by lightning.
  const skyMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  const dir = normalize(positionLocal);
  skyMaterial.colorNode = mix(vec3(0.02, 0.025, 0.04), vec3(0.003, 0.004, 0.008), dir.y.smoothstep(0, 0.4)).mul(ambient).add(vec3(0.3, 0.35, 0.5).mul(flash.mul(0.08)));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMaterial));
  // Cloud deck seen from below: fractal noise that rolls past on the wind and churns, lit locally around the strike.
  const cloudMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false });
  // Rotated to face down, the plane's local y runs along world z.
  const p = positionLocal.xy;
  // Two decks at different heights move at different speeds, so the sky has depth as it passes overhead.
  const high = mx_fractal_noise_float(vec3(p.add(drift.mul(0.55)).mul(0.004), churn.mul(0.6)), 4, 2, 0.5);
  const low = mx_fractal_noise_float(vec3(p.add(drift).mul(0.006), time.mul(0.03).add(churn)), 5, 2, 0.55);
  const density = low.mul(0.7).add(high.mul(0.4)).mul(0.5).add(0.5).smoothstep(0.25, 0.85);
  const lit = exp(p.sub(flashAt).length().div(140).pow(2).negate()).mul(flash);
  const cloudColour = vec3(0.025, 0.028, 0.04).mul(ambient).add(vec3(0.55, 0.6, 0.85).mul(lit.mul(density).mul(2.2)));
  cloudMaterial.colorNode = cloudColour.mul(density.mul(0.8).add(0.2));
  cloudMaterial.opacityNode = density.mul(0.9).add(0.1).mul(p.length().div(700).smoothstep(1, 0.6));
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), cloudMaterial);
  clouds.rotation.x = Math.PI / 2; clouds.position.y = CLOUD_BASE;
  scene.add(clouds);
  // Bolts: a small pool of line paths, each with its own fading brightness.
  const bolts = Array.from({ length: BOLTS }, () => {
    const positions = new Float32Array(BOLT_SEGMENTS * 6), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setDrawRange(0, 0);
    const material = new THREE.LineBasicNodeMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    // Two copies a hair apart give the channel a 2 px core.
    const line = new THREE.LineSegments(geometry, material); line.frustumCulled = false; line.visible = false; scene.add(line);
    const twin = new THREE.LineSegments(geometry, material); twin.frustumCulled = false; twin.position.x = 0.35; line.add(twin);
    // A soft column of light round the channel: the air glowing, since a 1 px line alone reads too thin.
    const haloMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const haloColour = uniform(new THREE.Color());
    haloMaterial.colorNode = haloColour.mul(uv().sub(0.5).mul(vec2(2, 1)).length().smoothstep(0.5, 0).pow(2));
    const halo = new THREE.Sprite(haloMaterial); halo.geometry = halo.geometry.clone(); halo.visible = false; scene.add(halo);
    return { positions, geometry, material, line, halo, haloColour, life: 0, strobe: 0 };
  });
  // Rain: streaks whose fall is computed on the GPU from a per-streak seed; `density` hides a share of them.
  const drops = Math.round(4000 * budget.particleScale), rain = new Float32Array(drops * 6), ends = new Float32Array(drops * 2);
  for (let i = 0; i < drops; i++) {
    const x = (random() - 0.5) * 220, y = random() * 90, z = 60 - random() * 160;
    rain.set([x, y, z, x, y, z], i * 6); ends[i * 2] = 0; ends[i * 2 + 1] = 1;
  }
  const rainGeometry = new THREE.BufferGeometry();
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(rain, 3)); rainGeometry.setAttribute('tail', new THREE.BufferAttribute(ends, 1));
  const rainMaterial = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const fall = uniform(0), rainAmount = uniform(0.5), wind = uniform(0.3);
  const seed = positionLocal.y.div(90), shown = seed.fract().lessThan(rainAmount).select(float(1), float(0));
  const y = positionLocal.y.sub(fall).mod(90).sub(4);
  rainMaterial.positionNode = vec3(positionLocal.x.add(y.mul(wind)), y.add(attribute<'float'>('tail').mul(2.4)), positionLocal.z);
  rainMaterial.colorNode = vec3(0.35, 0.4, 0.55).mul(ambient.mul(0.12).add(flash.mul(0.6))).mul(shown);
  const rainLines = new THREE.LineSegments(rainGeometry, rainMaterial); rainLines.frustumCulled = false; scene.add(rainLines);
  // Ground: layered hill silhouettes with a scatter of distant windows.
  const hills = (z: number, height: number, shade: number) => {
    const shape = new THREE.Shape(); shape.moveTo(-900, -20);
    for (let x = -900; x <= 900; x += 20) shape.lineTo(x, height * (0.5 + 0.5 * Math.sin(x * 0.006 + z) * Math.sin(x * 0.017 + z * 2)) + random() * 2);
    shape.lineTo(900, -20);
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(shade, shade, shade * 1.4) }));
    mesh.position.z = z; scene.add(mesh);
  };
  hills(-420, 40, 0.008); hills(-260, 26, 0.004); hills(-140, 14, 0.0015);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 1000), new THREE.MeshBasicNodeMaterial({ color: 0x010102 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, 0, -100); scene.add(ground);
  const lightCount = 220, windows = new Float32Array(lightCount * 3);
  for (let i = 0; i < lightCount; i++) windows.set([(random() - 0.5) * 500, 1 + random() * 6, -250 - random() * 20], i * 3);
  const windowGeometry = new THREE.BufferGeometry(); windowGeometry.setAttribute('position', new THREE.BufferAttribute(windows, 3));
  scene.add(new THREE.Points(windowGeometry, new THREE.PointsNodeMaterial({ color: new THREE.Color(1.2, 0.8, 0.35) })));
  const strikeGate = beatGate(0.45), top = new THREE.Vector3(), bottom = new THREE.Vector3();
  let next = 0, idle = 0, flashLevel = 0, shake = 0, rainPhase = 0, gust = 0, pace = 0;
  const strike = (strength: number) => {
    const bolt = bolts[next]; next = (next + 1) % BOLTS;
    const x = (random() - 0.5) * 260, z = -70 - random() * 140;
    top.set(x, CLOUD_BASE - 2, z); bottom.set(x + (random() - 0.5) * 60, 0, z + (random() - 0.5) * 30);
    const written = lightningPath(top, bottom, random, bolt.positions);
    bolt.geometry.setDrawRange(0, written * 2); bolt.geometry.attributes.position.needsUpdate = true;
    bolt.life = strength; bolt.strobe = 0;
    bolt.halo.position.set((top.x + bottom.x) / 2, CLOUD_BASE / 2, (top.z + bottom.z) / 2); bolt.halo.scale.set(70, CLOUD_BASE * 1.2, 1);
    flashAt.value.set(x, z); flashLevel = Math.max(flashLevel, strength);
  };
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time; idle += frame.delta;
      // Bounce drives the storm's pace: louder, punchier music blows the clouds faster and drives the rain harder.
      pace = approach(pace, frame.response.bounce, settleStep(frame), 0.6);
      gust = approach(gust, frame.response.bass, settleStep(frame), 0.35);
      churn.value += frame.delta * (0.02 + frame.audio.mid * 0.08 + pace * 0.12);
      // The deck rolls left to right and toward the viewer (local y is world z after the plane's rotation).
      const windSpeed = 6 + pace * 30 + gust * 14;
      drift.value.x -= frame.delta * windSpeed; drift.value.y -= frame.delta * windSpeed * 0.35;
      if (strikeGate(frame.time, frame.audio.onset && frame.response.impact > 0.35)) { strike(0.7 + frame.response.impact * 0.6); idle = 0; }
      else if (idle > 3.5) { strike(0.35); idle = 0; }
      const step = settleStep(frame), gentle = frame.reducedFlash ? 0.15 : 1;
      for (const bolt of bolts) {
        // Real strokes re-strike: a few quick flickers before fading.
        bolt.strobe += step;
        const flicker = bolt.strobe < 0.25 ? 0.6 + 0.4 * Math.sign(Math.sin(bolt.strobe * 70)) : 1;
        bolt.life = Math.max(0, bolt.life - step * 1.6);
        bolt.line.visible = bolt.halo.visible = bolt.life > 0;
        bolt.haloColour.value.setRGB(0.5, 0.55, 0.8).multiplyScalar(bolt.life * flicker * 0.9 * gentle);
        bolt.material.color.setRGB(3.5, 3.8, 5).multiplyScalar(bolt.life * flicker * (frame.reducedFlash ? 0.5 : 1));
      }
      flashLevel = Math.max(0, flashLevel - step * 3);
      flash.value = flashLevel * gentle;
      ambient.value = approach(ambient.value, 1 + frame.response.loudness * 0.6, step, 0.4);
      rainAmount.value = approach(rainAmount.value, 0.3 + frame.audio.highs * 0.4 + pace * 0.4, step, 0.5);
      rainPhase += frame.delta * (50 + pace * 60 + frame.response.loudness * 20); fall.value = rainPhase;
      wind.value = 0.2 + gust * 0.45;
      // Thunder: kicks and bass rumble the camera (never with reduced motion, where delta is zero).
      shake = approach(shake, Math.max(frame.response.bass * 0.6, frame.response.impact), frame.delta, 0.1);
      const jitter = frame.reducedMotion ? 0 : shake * 0.45;
      camera.position.set(Math.sin(frame.time * 31) * jitter, 8 + Math.sin(frame.time * 27) * jitter, 70);
      camera.lookAt(0, 40, -100);
    },
    dispose: () => disposeScene(scene),
  };
}
