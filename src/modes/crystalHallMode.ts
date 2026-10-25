import * as THREE from 'three/webgpu';
import { exp, float, mx_fractal_noise_float, mx_worley_noise_vec2, normalView, positionLocal, positionWorld, uniform, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import type { QualityBudget } from '../rendering/quality';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { createGlowPoints, loadTexture, whenLoaded } from './figures';
import { kitPieces, shadowSwitch } from './kitModes';
import { createCinematic } from './cinematic';
import { createHits } from './hitPulse';
import { seededRandom } from '../rendering/diagnostics';
import kitAUrl from '../assets/wave4/kitA.glb?url';
import smokeUrl from '../assets/fx/smoke.png?url';

const tier = (budget: QualityBudget, high: number, balanced: number, low: number) => budget.particleScale >= 2 ? high : budget.particleScale >= 1 ? balanced : low;

/** The crystal's outline from bottom tip to top, revolved with seven facets. */
export const CRYSTAL_PROFILE = [[0, -6.5], [0.55, -4.6], [1.15, -1.5], [1.25, 2.5], [1.0, 5.2], [0.35, 6.4], [0, 6.6]] as const;

/**
 * Red Crystal Hall: a colossal red crystal hangs in a vast dim hall, pulsing from inside with glowing
 * cracks; cables sag around it and three hooded figures kneel below in red mist. The camera never moves.
 */
export function createRedCrystalHallMode(budget: QualityBudget): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).fov = 50;
  const mistCount = tier(budget, 40, 20, 10);
  const time = uniform(0), glow = uniform(0.6), cracks = uniform(0.6), ring = uniform(-1), ringStrength = uniform(0);
  const finish = createCinematic({ grain: 0.06, halation: 0.55, vignette: 0.6, soften: 0.25, shadows: [0.012, 0.004, 0.004] });
  scene.background = new THREE.Color(0x070405);
  scene.fog = new THREE.FogExp2(0x1a0808, 0.022);
  const random = seededRandom(88);
  // The crystal: faceted, with an inner glow that is brightest at the core and veined with cracks.
  const crystalMaterial = new THREE.MeshStandardNodeMaterial({ flatShading: true, roughness: 0.25, metalness: 0 });
  const cell = mx_worley_noise_vec2(positionLocal.mul(vec3(1.4, 0.6, 1.4)));
  const vein = cell.y.sub(cell.x).smoothstep(0.08, 0).mul(mx_fractal_noise_float(positionLocal.mul(2), 2, 2, 0.5).mul(0.5).add(0.6));
  const core = exp(positionLocal.xz.length().mul(-1.8)).mul(positionLocal.y.add(6.5).div(13).oneMinus().mul(0.6).add(0.4));
  const rim = normalView.z.oneMinus().pow(2);
  crystalMaterial.colorNode = vec3(0.25, 0.01, 0.005);
  crystalMaterial.emissiveNode = vec3(0.88, 0.03, 0.01).mul(core.mul(glow).mul(2.5).add(rim.mul(0.6)))
    .add(vec3(1, 0.35, 0.12).mul(vein.mul(cracks).mul(3)));
  const crystal = new THREE.Mesh(new THREE.LatheGeometry(CRYSTAL_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), 7), crystalMaterial);
  crystal.position.set(0, 11, 0); crystal.scale.set(1.6, 1.25, 1.6);
  const inner = new THREE.PointLight(0xff2a10, 300, 60, 1.4); inner.position.set(0, 9, 0);
  const tip = new THREE.PointLight(0xff3a1a, 80, 14, 1.6); tip.position.set(0, 2.2, 0); tip.castShadow = true; tip.shadow.mapSize.set(512, 512);
  const skylight = new THREE.SpotLight(0x8a7a80, 60, 70, 0.5, 0.8, 1.2); skylight.position.set(0, 40, -6); skylight.target.position.set(0, 0, 0);
  scene.add(crystal, inner, tip, skylight, skylight.target, new THREE.HemisphereLight(0x3a3034, 0x050203, 0.35));
  // Cables sag from the ceiling around the crystal.
  const cableMaterial = new THREE.MeshStandardNodeMaterial({ color: 0x0b0909, roughness: 0.6, metalness: 0.4 });
  for (let i = 0; i < 16; i++) {
    const a = random() * Math.PI * 2, b = a + (random() - 0.5) * 2, r1 = 6 + random() * 10, r2 = 6 + random() * 10, top = 24 + random() * 4;
    const start = new THREE.Vector3(Math.cos(a) * r1, top, Math.sin(a) * r1 - 4), end = new THREE.Vector3(Math.cos(b) * r2, top, Math.sin(b) * r2 - 4);
    const mid = start.clone().lerp(end, 0.5); mid.y -= 6 + random() * 8;
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(start, mid, end), 48, 0.06 + random() * 0.05, 6), cableMaterial));
  }
  // Three hooded figures kneeling under the crystal's point.
  const robe = new THREE.MeshStandardNodeMaterial({ color: 0x120a0b, roughness: 0.9 });
  for (const x of [-1.4, 0, 1.4]) {
    const figure = new THREE.Group();
    const body = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.42, 0.02], [0.36, 0.35], [0.22, 0.75], [0.2, 0.95], [0.12, 1.05], [0, 1.08]].map(([r, y]) => new THREE.Vector2(r, y)), 16), robe);
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), robe); hood.position.set(0, 1.08, 0.06); hood.scale.set(1, 1.15, 1.1);
    figure.add(body, hood); figure.position.set(x, 0, 1.4 + Math.abs(x) * 0.3); figure.rotation.x = -0.15; figure.lookAt(0, 0.5, 0);
    figure.traverse((object) => { (object as THREE.Mesh).castShadow = true; });
    scene.add(figure);
  }
  // Floor: dark worn stone with a shock ring that runs out from under the crystal on hits.
  const floorMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0.1 });
  const fp = positionWorld.xz, grime = mx_fractal_noise_float(vec3(fp.mul(0.4), 1), 4, 2, 0.5).mul(0.5).add(0.5);
  floorMaterial.colorNode = vec3(0.05, 0.035, 0.035).mul(grime.mul(0.7).add(0.5));
  const shock = fp.length().sub(ring).abs().smoothstep(0.6, 0).mul(ringStrength).mul(ring.greaterThan(0).select(float(1), float(0)));
  floorMaterial.emissiveNode = vec3(1, 0.1, 0.04).mul(shock.mul(1.5).add(exp(fp.length().mul(-0.5)).mul(glow).mul(0.15)));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), floorMaterial); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  scene.add(floor);
  // Red mist low over the floor.
  const mist = createGlowPoints(loadTexture(smokeUrl), mistCount);
  const puffs = Array.from({ length: mistCount }, () => ({ x: (random() - 0.5) * 30, z: (random() - 0.5) * 16 - 2, size: 4 + random() * 6, phase: random() * 10 }));
  scene.add(mist.object);
  const hall = new THREE.Group(); scene.add(hall);
  const model = whenLoaded([kitAUrl], ([gltf]) => {
    const kit = kitPieces(gltf);
    // The hall from the industrial kit, scaled up: tall ribs in a horseshoe round the crystal, balconies between them.
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * (0.05 + i / 8 * 0.9), x = Math.cos(a) * 16, z = -Math.sin(a) * 12 - 2;
      const rib = kit.piece('pillar_square'); rib.position.set(x, 0, z); rib.scale.set(2, 7, 2); hall.add(rib);
      for (const y of [8, 16]) { const deck = kit.piece('catwalk_grate'); deck.position.set(x * 0.92, y, z * 0.92); deck.rotation.y = Math.PI / 2 - a; deck.scale.set(1.4, 1, 1.4); hall.add(deck); }
      const wall = kit.piece(i % 3 === 1 ? 'wall_window' : 'wall_plain'); wall.position.set(x * 1.12, 0, z * 1.12); wall.rotation.y = Math.PI / 2 - a; wall.scale.set(2.4, 7.5, 1); hall.add(wall);
      const girder = kit.piece('girder_straight'); girder.position.set(x * 0.7, 26, z * 0.7); girder.rotation.y = -a; girder.scale.set(3.5, 2, 2); hall.add(girder);
    }
    hall.traverse((object) => { const mesh = object as THREE.Mesh; if (mesh.isMesh) mesh.receiveShadow = true; });
  });
  const shadows = shadowSwitch();
  const hits = createHits({ decay: 0.4, interval: 0.6 });
  let ringAge = -1;
  return {
    scene, camera,
    ready: model.ready,
    simulate: shadows.simulate,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time; finish.update(frame);
      const step = settleStep(frame), bass = frame.response.bass;
      hits.update(frame, 0.6);
      // Bass brightens the crystal (60–100%) and its cracks; a hit sends a shock ring across the floor and a flare.
      glow.value = approach(glow.value, 0.6 + bass * 0.4 + hits.flash * 0.3, step, 0.08);
      cracks.value = approach(cracks.value, 0.4 + bass * 0.9 + hits.flash * 0.8, step, 0.06);
      inner.intensity = 90 + glow.value * 140; tip.intensity = 50 + glow.value * 80 + hits.flash * 120;
      if (hits.fired) ringAge = 0;
      if (ringAge >= 0) { ringAge += step; if (ringAge > 2.5) ringAge = -1; }
      ring.value = ringAge < 0 ? -1 : ringAge * 9; ringStrength.value = ringAge < 0 ? 0 : Math.max(0, 1 - ringAge / 2.5) * (frame.reducedFlash ? 0.4 : 1);
      const height = 0.6 + frame.response.loudness * 2.2;
      puffs.forEach((puff, i) => {
        const drift = frame.reducedMotion ? 0 : Math.sin(frame.time * 0.1 + puff.phase) * 1.5;
        mist.set(i, puff.x + drift, height * (0.5 + 0.5 * Math.sin(puff.phase)), puff.z, puff.size, 0.5 * glow.value, 0.04, 0.02, 0.35);
      });
      mist.commit();
      // Locked off: the camera never moves.
      camera.position.set(0, 2.2, 24);
      camera.lookAt(0, 9.5, 0);
    },
    filter: (input) => finish.filter(input),
    dispose() { model.dispose(); shadows.dispose(); disposeScene(scene); },
  };
}

