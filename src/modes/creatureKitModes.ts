import * as THREE from 'three/webgpu';
import { float, instanceIndex, mix, mx_fractal_noise_float, mx_noise_float, positionLocal, positionWorld, sin, uniform, uv, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import type { QualityBudget } from '../rendering/quality';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { ClipPlayer, TempoTracker, createGlowPoints, instantiate, loadTexture, setMorph, shaftMaterial, whenLoaded, type Figure } from './figures';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shadowSwitch } from './kitModes';
import { createCinematic } from './cinematic';
import { createHits, linearRgb } from './hitPulse';
import { seededRandom } from '../rendering/diagnostics';
import kitCUrl from '../assets/wave4/kitC.glb?url';
import kitGUrl from '../assets/wave4/kitG.glb?url';
import emberUrl from '../assets/fx/ember.png?url';

/** Averages normals across split vertices that share a position, so a faceted low-poly mesh shades smooth. */
export function smoothNormals(geometry: THREE.BufferGeometry) {
  geometry.computeVertexNormals();
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  const sums = new Map<string, THREE.Vector3>(), key = (i: number) => `${position.getX(i).toFixed(3)},${position.getY(i).toFixed(3)},${position.getZ(i).toFixed(3)}`;
  for (let i = 0; i < position.count; i++) {
    const k = key(i), sum = sums.get(k) ?? sums.set(k, new THREE.Vector3()).get(k)!;
    sum.x += normal.getX(i); sum.y += normal.getY(i); sum.z += normal.getZ(i);
  }
  for (let i = 0; i < position.count; i++) { const sum = sums.get(key(i))!.clone().normalize(); normal.setXYZ(i, sum.x, sum.y, sum.z); }
  normal.needsUpdate = true;
}

const tier = (budget: QualityBudget, high: number, balanced: number, low: number) => budget.particleScale >= 2 ? high : budget.particleScale >= 1 ? balanced : low;

/** A rough rock surface for caves and floors: dark stone with ridged noise in the colour and roughness. */
function rockMaterial(base: THREE.ColorRepresentation, side: THREE.Side = THREE.FrontSide) {
  const material = new THREE.MeshStandardNodeMaterial({ side, roughness: 0.95 });
  const ridge = float(1).sub(mx_noise_float(positionWorld.mul(0.6)).abs()).pow(3);
  const grit = mx_fractal_noise_float(positionWorld.mul(3), 3, 2, 0.5).mul(0.5).add(0.5);
  const tone = new THREE.Color(base);
  material.colorNode = vec3(tone.r, tone.g, tone.b).mul(ridge.mul(0.6).add(grit.mul(0.5)).add(0.2));
  material.positionNode = positionLocal.add(positionLocal.normalize().mul(ridge.mul(0.6)));
  return material;
}

// ---------------------------------------------------------------- Lava Golem

export function createLavaGolemMode(budget: QualityBudget): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).fov = 45;
  const emberCount = tier(budget, 6000, 3500, 1400);
  const time = uniform(0), finish = createCinematic({ grain: 0.07, halation: 0.5, vignette: 0.65, soften: 0.2, shadows: [0.008, 0.003, 0.002] });
  scene.background = new THREE.Color(0x0a0508);
  scene.fog = new THREE.FogExp2(0x140608, 0.06);
  // The cave behind, with a fire glow deep in it.
  const cave = new THREE.Mesh(new THREE.SphereGeometry(18, 96, 64), rockMaterial(0x2a1410, THREE.BackSide));
  const fire = new THREE.PointLight(0xff5a1a, 60, 25, 1.4); fire.position.set(-3, 2, -10);
  const spot = new THREE.SpotLight(0xffe0c8, 300, 20, 0.42, 0.55, 1.2);
  spot.position.set(0.3, 10, -0.8); spot.target.position.set(0, 0.8, 0); spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0005;
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 3.8, 9, 32, 1, true).translate(0, -4.5, 0), shaftMaterial(time));
  cone.position.copy(spot.position); cone.lookAt(spot.target.position); cone.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), rockMaterial(0x1a0c0a)); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  const glowUnder = new THREE.PointLight(0xff4a1a, 6, 6, 1.8); glowUnder.position.set(0, 0.3, 0.5);
  scene.add(cave, fire, spot, spot.target, cone, floor, glowUnder, new THREE.HemisphereLight(0x401810, 0x080202, 0.2));
  // The ember field: thousands of glowing coals across the floor that jump when a foot or fist lands.
  const embers = createGlowPoints(loadTexture(emberUrl), emberCount);
  const random = seededRandom(51);
  const coals = Array.from({ length: emberCount }, () => { const r = Math.sqrt(random()) * 3.6, a = random() * Math.PI * 2; return { x: Math.cos(a) * r, z: Math.sin(a) * r * 0.8 + 0.5, phase: random() * 10, jump: random(), size: 0.025 + random() * 0.035 }; });
  scene.add(embers.object);
  let golem: Figure | undefined, player: ClipPlayer | undefined;
  const cracks: THREE.MeshStandardMaterial[] = [];
  const model = whenLoaded([kitGUrl], ([gltf]) => {
    golem = instantiate(gltf);
    golem.root.scale.setScalar(1.25);
    golem.root.traverse((object) => { const mesh = object as THREE.Mesh; if (mesh.isMesh) { mesh.castShadow = mesh.receiveShadow = true; mesh.geometry = mesh.geometry.clone(); smoothNormals(mesh.geometry); } });
    scene.add(golem.root);
    player = new ClipPlayer(golem.root, golem.clips);
    player.loop('idle', 0);
    const crack = golem.materials.get('emissive_cracks');
    if (crack) { crack.emissive.setRGB(...linearRgb(0xff2a1a)); cracks.push(crack); }
    const stone = golem.materials.get('kitG_atlas');
    if (stone) stone.roughness = 0.85;
  });
  const shadows = shadowSwitch(), tempo = new TempoTracker();
  const hits = createHits({ decay: 0.15, interval: 0.8 });
  let landAt = -1, jump = 0, glow = 0, next = 0, turnHold = 0;
  return {
    scene, camera,
    ready: model.ready,
    simulate: shadows.simulate,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time; finish.update(frame);
      const step = settleStep(frame), bass = frame.response.bass;
      const scale = tempo.update(frame.time, frame.audio.onset, frame.delta);
      hits.update(frame, 0.2);
      if (player) {
        // Stomp and slam alternate on hits; the impact lands at the clip's hit frame (10 and 14 of 24 fps).
        if (hits.fired && player.play(next ? 'slam' : 'stomp')) { landAt = (next ? 14 : 10) / 24; next = 1 - next; }
        turnHold = frame.audio.mid > 0.55 ? turnHold + step : 0;
        if (turnHold > 1.5 && !player.playingShot) { player.play('turn'); turnHold = 0; }
        player.update(frame.delta, Math.max(0.8, scale));
      }
      if (landAt >= 0) { landAt -= frame.delta * Math.max(0.8, scale); if (landAt < 0) { jump = 1; glow = 1; } }
      jump = Math.max(0, jump - step * 2.2);
      glow = Math.max(0, glow - step / 0.15);
      // Cracks breathe with the bass and flare to full on each landing.
      for (const crack of cracks) crack.emissiveIntensity = 1 + bass * 4 + glow * 8;
      glowUnder.intensity = 3 + bass * 8 + glow * 30;
      fire.intensity = 40 + Math.sin(frame.time * 7) * 8 + frame.response.loudness * 40;
      (cone.material as THREE.MeshBasicNodeMaterial).color.setRGB(0.9, 0.7, 0.6).multiplyScalar(0.12 + bass * 0.08);
      const heat = 0.4 + frame.response.loudness * 0.8;
      coals.forEach((coal, i) => {
        const near = Math.exp(-Math.hypot(coal.x, coal.z - 0.5) * 0.35);
        const hop = frame.reducedMotion ? 0 : Math.sin(Math.min(1, 1 - jump) * Math.PI) * jump * 0.3 * coal.jump * near * 1.6;
        const flicker = (0.6 + 0.4 * Math.sin(frame.time * (2 + coal.jump * 3) + coal.phase)) * heat * (1 + glow * near);
        embers.set(i, coal.x, 0.03 + hop, coal.z, coal.size, 1.6 * flicker, 0.55 * flicker, 0.18 * flicker, 1);
      });
      embers.commit();
      camera.position.set(Math.sin(frame.time * 0.06) * 1.2, 1.6, 6.5);
      camera.lookAt(0, 1.4, 0);
    },
    filter: (input) => finish.filter(input),
    dispose() { model.dispose(); player?.dispose(); shadows.dispose(); disposeScene(scene); },
  };
}

// ---------------------------------------------------------------- Light Painting Forest

/** The wireframe sculptures, shown one at a time: Kit C node, where it floats, and its scale. */
export const SCULPTURES = [
  ['chair', [0, 0, 0.3], 1.4], ['moon_crescent', [-0.3, 1.2, 0], 2.4], ['hoop', [0, 0.25, 0], 1.3], ['door_frame', [0, 0, -0.4], 1],
] as const;

/** Birds are drawn in code instead of the kit's low-poly nodes: smooth, densely segmented light strokes. */
export const LIGHT_BIRDS = [
  { at: [0.2, 1.2, 0], scale: 1.5, span: 0.5, beak: 0.3, tail: 0.22, fork: 0.05 },
  { at: [0.3, 1.0, 0], scale: 1.15, span: 1.05, beak: 0.06, tail: 0.42, fork: 0.16 },
  { at: [-0.2, 1.05, 0.2], scale: 1.3, span: 0.8, beak: 0.09, tail: 0.3, fork: 0.08 },
] as const;

/**
 * One light-painted bird as a 3D wire sculpture: an egg-shaped body cage (meridians and rings), a wire head and
 * beak, two cambered wings layered from coverts to secondaries to long primaries, and a fanned tail. Strokes are
 * merged per part so the bird is a few draw calls; the wings pivot at the shoulders.
 */
export function lightBird(spec: (typeof LIGHT_BIRDS)[number], material: THREE.Material) {
  const group = new THREE.Group(), v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const tube = (points: THREE.Vector3[], radius: number, closed = false, segments = 64) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, closed), segments, radius, 6, closed);
  const part = (pieces: THREE.BufferGeometry[]) => { const mesh = new THREE.Mesh(mergeGeometries(pieces), material); pieces.forEach((piece) => piece.dispose()); return mesh; };
  // Body: an egg along x (head end +x), 8 meridians and 5 rings.
  const egg = (u: number, a: number) => { const r = Math.sin(Math.PI * u) * (0.13 + 0.03 * (1 - u)); return v(-0.36 + u * 0.66, 0.02 + Math.cos(a) * r * 0.9, Math.sin(a) * r); };
  const body: THREE.BufferGeometry[] = [];
  for (let m = 0; m < 8; m++) body.push(tube(Array.from({ length: 13 }, (_, k) => egg(k / 12, (m / 8) * Math.PI * 2)), 0.006));
  for (const u of [0.2, 0.4, 0.6, 0.8]) body.push(tube(Array.from({ length: 16 }, (_, k) => egg(u, (k / 16) * Math.PI * 2)), 0.005, true));
  // Head: three wire rings round a small sphere, an eye, and a beak of four converging strokes.
  const head = v(0.38, 0.13, 0), tip = v(0.42 + spec.beak, 0.1, 0);
  for (const axis of [v(1, 0, 0), v(0, 1, 0), v(0, 0, 1)]) {
    const basis = new THREE.Quaternion().setFromUnitVectors(v(0, 0, 1), axis);
    body.push(tube(Array.from({ length: 16 }, (_, k) => v(Math.cos(k / 16 * Math.PI * 2) * 0.07, Math.sin(k / 16 * Math.PI * 2) * 0.07, 0).applyQuaternion(basis).add(head)), 0.005, true, 32));
  }
  for (const [dy, dz] of [[0.03, 0], [-0.02, 0], [0, 0.025], [0, -0.025]]) body.push(tube([v(head.x + 0.05, head.y + dy, dz), v((head.x + tip.x) / 2 + 0.02, (head.y + tip.y) / 2 + dy * 0.4, dz * 0.4), tip], 0.004, false, 16));
  body.push(tube([v(-0.02, 0.1, 0), v(0.2, 0.15, 0), head], 0.006, false, 24));
  const eye = new THREE.TorusGeometry(0.015, 0.004, 6, 24); eye.translate(head.x + 0.03, head.y + 0.02, 0.06); body.push(eye);
  // Tail: seven feathers fanned in 3D, the outer ones longer for a fork.
  for (let f = 0; f < 7; f++) {
    const fan = (f / 6 - 0.5) * 1.1, length = spec.tail * (1 + Math.abs(fan) * spec.fork * 6);
    const end = v(-0.36 - Math.cos(fan) * length, 0.02 - length * 0.15, Math.sin(fan) * length);
    body.push(tube([v(-0.32, 0.02, 0), v((-0.32 + end.x) / 2, 0.02 - length * 0.05, end.z * 0.5), end], 0.004, false, 24));
  }
  group.add(part(body));
  // Wings: rows of feathers fanning from the arm, cambered (bowed toward +y) so they read in depth.
  const wings = [1, -1].map((side) => {
    const wing = new THREE.Group(); wing.position.set(0.06, 0.1, side * 0.1);
    const span = spec.span, strokes: THREE.BufferGeometry[] = [];
    const arm = (t: number) => v(-0.04 * t, span * 0.12 * Math.sin(Math.PI * t), side * span * t);
    strokes.push(tube(Array.from({ length: 9 }, (_, k) => arm(k / 8)), 0.007));
    const rows = [{ count: 9, from: 0.55, reach: 0.95, back: 0.45 }, { count: 8, from: 0.1, reach: 0.55, back: 0.32 }, { count: 7, from: 0.05, reach: 0.6, back: 0.16 }];
    rows.forEach((row, r) => {
      for (let f = 0; f < row.count; f++) {
        const t = row.from + (row.reach - row.from) * (f / Math.max(1, row.count - 1)), root = arm(t);
        // Primaries sweep back and out; inner rows are shorter. Each feather bows upward along its length.
        const sweep = r === 0 ? 0.35 + f * 0.06 : 0.1, length = row.back * span * (r === 0 ? 1 - f * 0.03 : 1);
        const end = v(root.x - Math.cos(sweep) * length, root.y + 0.01, root.z + side * Math.sin(sweep) * length);
        const mid = root.clone().lerp(end, 0.5).add(v(0, 0.04 * span * (1 - r * 0.3), 0));
        strokes.push(tube([root, mid, end], 0.0045 - r * 0.001, false, 24));
      }
    });
    wing.add(part(strokes));
    group.add(wing);
    return wing;
  });
  return { object: group, wings };
}

export function createLightForestMode(budget: QualityBudget): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).fov = 50;
  const leafCount = tier(budget, 24000, 14000, 6000), bladeCount = tier(budget, 30000, 18000, 8000);
  const time = uniform(0), sway = uniform(0), finish = createCinematic({ grain: 0.09, halation: 0.3, vignette: 0.7, soften: 0.35, shadows: [0.002, 0.005, 0.004] });
  scene.background = new THREE.Color(0x010201);
  scene.fog = new THREE.FogExp2(0x050806, 0.12);
  const random = seededRandom(71);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardNodeMaterial({ color: 0x0a120a, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  // Foliage: instanced leaf cards (cut to a leaf shape in the shader), lit only by the sculpture and the moonlight.
  const leafMaterial = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.7, alphaTest: 0.5 });
  const leafUv = uv().sub(0.5), leafShape = leafUv.x.mul(2).abs().add(leafUv.y.mul(leafUv.y).mul(3.2));
  leafMaterial.opacityNode = leafShape.lessThan(0.55).select(float(1), float(0));
  const hue = sin(instanceIndex.toFloat().mul(12.9898)).mul(0.5).add(0.5);
  const vein = leafUv.x.abs().smoothstep(0.0, 0.02).mul(0.3).add(0.7);
  leafMaterial.colorNode = mix(vec3(0.012, 0.05, 0.012), vec3(0.04, 0.12, 0.025), hue).mul(leafUv.x.abs().mul(-0.8).add(1)).mul(vein);
  leafMaterial.positionNode = positionLocal.add(vec3(mx_noise_float(vec3(instanceIndex.toFloat().mul(0.37), time.mul(0.6), 0)).mul(sway).mul(0.04), 0, 0));
  const leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.1, 0.17), leafMaterial, leafCount);
  const bladeMaterial = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.8 });
  bladeMaterial.colorNode = mix(vec3(0.02, 0.07, 0.02), vec3(0.1, 0.25, 0.06), uv().y).mul(hue.mul(0.5).add(0.6));
  bladeMaterial.positionNode = positionLocal.add(vec3(sin(time.mul(1.3).add(instanceIndex.toFloat())).mul(sway).mul(uv().y).mul(0.04), 0, 0));
  const blades = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.03, 0.35, 1, 3).translate(0, 0.175, 0), bladeMaterial, bladeCount);
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), at = new THREE.Vector3(), size = new THREE.Vector3();
  // Bushes in a loose ring around the clearing and trunks behind them.
  const bushes = Array.from({ length: 60 }, () => { const a = Math.PI + random() * Math.PI, r = 1.6 + random() * 7; return [Math.cos(a) * r, 0.15 + random() * 1.4, Math.min(1.5, Math.sin(a) * r + 0.5), 0.35 + random() * 0.9] as const; });
  for (let i = 0; i < leafCount; i++) {
    const [bx, by, bz, br] = bushes[i % bushes.length], dir = new THREE.Vector3(random() - 0.5, random() - 0.3, random() - 0.5).normalize();
    at.set(bx, by, bz).addScaledVector(dir, br * Math.cbrt(random()));
    leaves.setMatrixAt(i, matrix.compose(at, q.setFromEuler(e.set(random() * Math.PI, random() * Math.PI, random() * Math.PI)), size.setScalar(0.6 + random() * 0.9)));
  }
  for (let i = 0; i < bladeCount; i++) {
    const r = Math.sqrt(random()) * 9, a = random() * Math.PI * 2;
    blades.setMatrixAt(i, matrix.compose(at.set(Math.cos(a) * r, 0, Math.sin(a) * r - 1), q.setFromEuler(e.set((random() - 0.5) * 0.5, random() * Math.PI, (random() - 0.5) * 0.5)), size.set(1, 0.5 + random(), 1)));
  }
  const bark = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
  bark.colorNode = vec3(0.03, 0.025, 0.02).mul(mx_noise_float(positionLocal.mul(vec3(8, 0.6, 8))).mul(0.4).add(0.8));
  for (let t = 0; t < 14; t++) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1 + random() * 0.12, 0.2 + random() * 0.15, 14, 12), bark);
    const a = random() * Math.PI - Math.PI, r = 4 + random() * 9; trunk.position.set(Math.cos(a) * r, 7, Math.sin(a) * r - 2); scene.add(trunk);
  }
  // Moonlight slanting through as god rays; the sculpture carries its own light, which picks out the leaves around it.
  const moon = new THREE.DirectionalLight(0x8fb8a0, 0.25); moon.position.set(5, 10, -4);
  const rays = [0, 1, 2].map((i) => { const ray = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.9, 16, 16, 1, true).translate(0, -8, 0), shaftMaterial(time)); ray.position.set(3 + i * 1.6, 10, -5 - i); ray.rotation.z = 0.5; return ray; });
  const sculptLight = new THREE.PointLight(0xf0fff4, 0, 5, 2); sculptLight.position.set(0, 1.3, 0);
  scene.add(leaves, blades, moon, ...rays, sculptLight, new THREE.HemisphereLight(0x10201a, 0x000000, 0.08));
  // Blue bokeh far back in the trees.
  const bokeh = createGlowPoints(loadTexture(emberUrl), 30);
  const lights = Array.from({ length: 30 }, () => [(random() - 0.5) * 20, random() * 3, -8 - random() * 8] as const);
  scene.add(bokeh.object);
  const sculptures: { object: THREE.Object3D; morphs: { mesh: THREE.Mesh; index: number }[]; wings?: THREE.Group[] }[] = [];
  const birdLine = new THREE.MeshBasicNodeMaterial({ color: 0xffffff });
  let line: THREE.MeshStandardMaterial | undefined;
  const model = whenLoaded([kitCUrl], ([gltf]) => {
    const kit: Figure = instantiate(gltf);
    line = kit.materials.get('emissive_line');
    for (const [name, [x, y, z], s] of SCULPTURES) {
      const object = kit.node(name).clone(); object.position.set(x, y, z); object.scale.setScalar(s); object.visible = false;
      const morphs: { mesh: THREE.Mesh; index: number }[] = [];
      object.traverse((child) => { const mesh = child as THREE.Mesh; const index = mesh.morphTargetDictionary?.wings_down; if (mesh.isMesh && index !== undefined) morphs.push({ mesh, index }); });
      scene.add(object); sculptures.push({ object, morphs });
    }
    // Interleave the code-built birds between the kit sculptures.
    LIGHT_BIRDS.forEach((spec, i) => {
      const bird = lightBird(spec, birdLine); bird.object.position.set(spec.at[0], spec.at[1], spec.at[2]); bird.object.scale.setScalar(spec.scale); bird.object.visible = false;
      bird.object.rotation.set(0.35, i % 2 ? 0.9 : -0.9, 0.1);
      scene.add(bird.object); sculptures.splice(i * 2, 0, { object: bird.object, morphs: [], wings: bird.wings });
    });
  });
  // One sculpture at a time: a ghost draws in, flashes to full white for a few frames, then fades over 400 ms.
  const hits = createHits({ decay: 0.4, interval: 0.6, variants: SCULPTURES.length + LIGHT_BIRDS.length, seed: 21 });
  let flap = 0;
  return {
    scene, camera,
    ready: model.ready,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time; finish.update(frame);
      const step = settleStep(frame);
      hits.update(frame, 0.02);
      sculptures.forEach(({ object }, i) => { object.visible = i === hits.variant && hits.count > 0; });
      const life = hits.age, ghost = Math.min(1, life / 0.05) * 0.4, full = life < 0.1 ? 1 : Math.exp(-(life - 0.1) / 0.4);
      const level = Math.max(ghost * Math.exp(-life / 1.5), full) * (frame.reducedFlash ? 0.5 : 1);
      if (line) { line.emissive.setRGB(1, 1, 1); line.emissiveIntensity = level * 6; }
      birdLine.color.setRGB(1, 1, 1).multiplyScalar(0.02 + level * 6);
      const current = sculptures[hits.variant];
      if (current) sculptLight.position.copy(current.object.position).add(new THREE.Vector3(0, 0.3, 0.3));
      sculptLight.intensity = level * 14 * (1 + frame.response.bass * 0.5);
      // Birds flap their wings with the music.
      flap += frame.reducedMotion ? 0 : frame.delta * (6 + frame.response.bass * 10);
      if (current) setMorph(current.morphs, 0.5 + Math.sin(flap) * 0.5);
      current?.wings?.forEach((wing, side) => { wing.rotation.x = (side ? -1 : 1) * (0.15 + Math.sin(flap) * 0.75); });
      // The wire birds turn slowly while they show, so their depth reads.
      if (current?.wings && !frame.reducedMotion) current.object.rotation.y = (hits.variant % 2 ? 0.9 : -0.9) + Math.sin(frame.time * 0.5) * 0.6;
      sway.value = approach(sway.value, 0.5 + frame.response.bass * 2, step, 0.3);
      for (const ray of rays) (ray.material as THREE.MeshBasicNodeMaterial).color.setRGB(0.56, 0.72, 0.63).multiplyScalar(0.012 + frame.response.loudness * 0.025);
      (scene.fog as THREE.FogExp2).color.setRGB(0.02, 0.03, 0.025).multiplyScalar(0.5 + frame.response.loudness);
      lights.forEach(([x, y, z], i) => bokeh.set(i, x, y, z, 0.35, 0.25, 0.45, 1, 0.5 + 0.3 * Math.sin(frame.time + i)));
      bokeh.commit();
      camera.position.set(Math.sin(frame.time * 0.05) * 0.6, 1.1, 5);
      camera.lookAt(0, 1, 0);
    },
    filter: (input) => finish.filter(input),
    dispose() { model.dispose(); disposeScene(scene); },
  };
}
