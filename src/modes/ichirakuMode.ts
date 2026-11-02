import * as THREE from 'three/webgpu';
import { mix, mx_noise_float, positionWorld, sin, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { instantiate, whenLoaded } from './figures';
import { createHits } from './hitPulse';
import { approach, disposeScene, resizeCamera, sceneDefaults } from './shared';
import { presetBudget, type QualityBudget } from '../rendering/quality';
import type { ModeFrame, VisualMode } from './types';
import shopUrl from '../../Model assets/Wave6 assets /ichiraku_ramen.glb?url';

type Point = readonly [number, number, number];
interface RamenShot { name: string; seconds: number; eye: Point; end: Point; look: Point; fov: number }
export const ICHIRAKU_SHOTS: readonly RamenShot[] = [
  { name: 'Ichiraku / after dark', seconds: 7, eye: [9, 4.6, 12], end: [7.8, 4, 10.5], look: [0, 2.5, 0], fov: 43 },
  { name: 'night counter / street view', seconds: 6, eye: [-0.3, 1.1, 11], end: [0.3, 1.4, 9], look: [0, 2, 1], fov: 47 },
  { name: 'paper lantern / kick glow', seconds: 5, eye: [-4.6, 2.25, 4.5], end: [-4.1, 2, 3.6], look: [-2.8, 1.99, 1.9], fov: 40 },
  { name: 'Ichiraku / noren lettering', seconds: 6, eye: [0, 1.9, 6.5], end: [0.6, 1.8, 5.4], look: [0, 1.75, 1.85], fov: 49 },
  { name: 'six seats / counter tracking', seconds: 6, eye: [3.7, 0.75, 5.5], end: [2.5, 0.85, 4.9], look: [0, 0.85, 2], fov: 51 },
  { name: 'side street / neon window', seconds: 6, eye: [6, 2.4, 4.4], end: [6, 2.7, 1], look: [2, 2.6, 0.3], fov: 60 },
  { name: 'little lantern / snare accent', seconds: 5, eye: [4.6, 2.2, 2.6], end: [4.8, 2, 1.5], look: [2.9, 2, 1.5], fov: 44 },
  { name: 'upstairs / electric windows', seconds: 6, eye: [4.3, 4.5, 6], end: [3.5, 4.7, 5], look: [0, 4, 0.7], fov: 47 },
  { name: 'rooftops / crane rise', seconds: 7, eye: [7, 8, 8], end: [4, 9, 7], look: [0, 2, 0], fov: 48 },
  { name: 'midnight / overhead', seconds: 6, eye: [0, 11.5, 4], end: [3, 10.5, 4.5], look: [0, 1.8, 0], fov: 54 },
  { name: 'left alley / lantern spill', seconds: 6, eye: [-7, 3.5, 2.2], end: [-6, 3.2, 5], look: [-1, 2.4, 0], fov: 54 },
  { name: 'back corner / moonlit tiles', seconds: 5, eye: [-7, 5, -6], end: [-6, 5, -5], look: [0, 2.8, 0], fov: 48 },
  { name: 'shopfront / neon sweep', seconds: 8, eye: [-8, 4.5, 10], end: [8, 4.5, 10], look: [0, 2.5, 0], fov: 48 },
  { name: 'pavement / colored reflections', seconds: 6, eye: [5.5, 0.25, 7.6], end: [3.7, 0.32, 6.2], look: [0, 1.1, 1.8], fov: 59 },
  { name: 'late bowl / rising steam', seconds: 5, eye: [1.6, 1.65, 3.5], end: [0.8, 1.6, 2.95], look: [0, 1.18, 1.97], fov: 56 },
  { name: 'empty stools / low dolly', seconds: 5, eye: [-3.5, 0.55, 4.6], end: [-2.5, 0.6, 4], look: [0, 0.6, 2.55], fov: 58 },
  { name: 'chimney / midnight steam', seconds: 6, eye: [-3, 6.8, 6], end: [-2.2, 7.3, 5], look: [0.35, 6.2, -0.15], fov: 52 },
  { name: 'last light / street farewell', seconds: 8, eye: [-9, 4.5, 12], end: [-11, 5.5, 15], look: [0, 2.4, 0], fov: 45 },
];
export const ICHIRAKU_PALETTES = [
  { name: 'sakura / electric cyan', colors: [0xff238b, 0x26f4ff, 0xffa538] },
  { name: 'acid lime / ultraviolet', colors: [0xb6ff32, 0x9b4dff, 0x35ffd5] },
  { name: 'tangerine / cobalt', colors: [0xff7431, 0x4285ff, 0xff43bd] },
  { name: 'lagoon / hot rose', colors: [0x23ffcf, 0xff377e, 0xffcc4a] },
  { name: 'violet / neon lemon', colors: [0xaa63ff, 0xf4ff48, 0x40cfff] },
  { name: 'ruby / ice blue', colors: [0xff354f, 0x47dfff, 0xdb74ff] },
] as const;

export function createIchirakuMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const { scene, camera } = sceneDefaults(); camera.near = 0.035; camera.far = 160;
  scene.background = new THREE.Color(0x020511); scene.fog = new THREE.FogExp2(0x050817, 0.022);
  const clock = uniform(0), main = uniform(0.75), side = uniform(0.65), interior = uniform(0.65), trim = uniform(0.4);
  const primary = uniform(new THREE.Color(ICHIRAKU_PALETTES[0].colors[0]));
  const accent = uniform(new THREE.Color(ICHIRAKU_PALETTES[0].colors[1]));
  const warm = uniform(new THREE.Color(ICHIRAKU_PALETTES[0].colors[2]));
  const neon = (color: typeof primary, level: typeof main) => {
    const material = new THREE.MeshBasicNodeMaterial(); material.colorNode = color.mul(level); return material;
  };
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, at: Point) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...at); scene.add(mesh); return mesh;
  };
  scene.add(new THREE.HemisphereLight(0x577ab9, 0x12111d, 0.9));
  const moon = new THREE.DirectionalLight(0x9baeff, 1.5); moon.position.set(-4, 10, -6); scene.add(moon);
  const light = (name: string, at: Point) => {
    const lamp = new THREE.PointLight(0xffffff, 10, 14, 1.7); lamp.name = name; lamp.position.set(...at); scene.add(lamp); return lamp;
  };
  const leftLight = light('Ichiraku / main lantern light', [-2.8, 2.05, 2.05]);
  const rightLight = light('Ichiraku / side lantern light', [2.9, 2.05, 1.65]);
  const counterLight = light('Ichiraku / counter light', [0, 2.1, 3.6]);
  const loftLight = light('Ichiraku / loft light', [0, 4.15, 2]);

  const ground = new THREE.MeshStandardNodeMaterial({ color: 0x070a16, roughness: 0.36, metalness: 0.35 });
  const p = positionWorld, noise = mx_noise_float(p.mul(5)).mul(0.5).add(0.5);
  const smear = sin(p.z.mul(70).add(p.x.mul(9))).mul(0.08).add(noise.mul(0.35)).add(0.42);
  const pool = (x: number, z: number, width: number, depth: number) =>
    p.x.sub(x).div(width).abs().pow(2).add(p.z.sub(z).div(depth).abs().pow(2)).negate().exp().mul(smear);
  ground.emissiveNode = primary.mul(main).mul(pool(-2.8, 3.3, 0.9, 3.8)).mul(0.6)
    .add(accent.mul(side).mul(pool(2.9, 2.8, 0.7, 3)).mul(0.55))
    .add(warm.mul(interior).mul(pool(0, 3.8, 1.7, 3.5)).mul(0.28));
  ground.roughnessNode = noise.mul(0.3).add(0.2);
  add(new THREE.PlaneGeometry(180, 180).rotateX(-Math.PI / 2), ground, [0, -0.012, 0]).name = 'Ichiraku / wet street';
  const curbMaterial = new THREE.MeshStandardNodeMaterial({ color: 0x252733, roughness: 0.9 });
  add(new THREE.BoxGeometry(9, 0.1, 0.15), curbMaterial, [0, 0.035, -3.8]);
  // Dark neighboring facades put the small shop on a street without competing with its lights.
  const buildings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardNodeMaterial({ color: 0x101627, roughness: 1 }), 16);
  buildings.name = 'Ichiraku / sleeping neighborhood'; const dummy = new THREE.Object3D();
  for (let i = 0; i < 16; i++) {
    const height = 5 + (i * 7 % 9); dummy.position.set((i % 2 ? -1 : 1) * (10 + i % 3 * 4), height / 2, -18 + Math.floor(i / 2) * 6);
    dummy.scale.set(5, height, 4.5); dummy.updateMatrix(); buildings.setMatrixAt(i, dummy.matrix);
  } scene.add(buildings);

  const rim = neon(accent, trim), frontRim = neon(primary, trim);
  add(new THREE.BoxGeometry(5.65, 0.018, 0.018), rim, [0, 2.61, 2.145]);
  add(new THREE.BoxGeometry(0.018, 0.018, 4.25), rim, [-2.84, 2.61, 0]);
  add(new THREE.BoxGeometry(0.018, 0.018, 4.25), rim, [2.84, 2.61, 0]);
  add(new THREE.BoxGeometry(4.65, 0.014, 0.014), frontRim, [0, 0.927, 2.14]);

  const models = whenLoaded([shopUrl], ([gltf]) => {
    const shop = instantiate(gltf), materials = new Map<THREE.Material, THREE.Material>(); shop.root.name = 'Ichiraku / supplied ramen shop';
    shop.root.traverse(object => {
      const mesh = object as THREE.Mesh; if (!mesh.isMesh) return;
      mesh.geometry = mesh.geometry.clone();
      const shade = (source: THREE.Material) => {
        if (materials.has(source)) return materials.get(source)!;
        const old = source as THREE.MeshStandardMaterial;
        const material = new THREE.MeshStandardNodeMaterial({ color: old.color.clone().convertSRGBToLinear(), map: old.map,
          roughness: old.roughness, metalness: old.metalness, side: old.side }); material.name = old.name;
        if (old.name === 'emissive_lantern_main') { material.color.setScalar(0.03); material.emissiveNode = primary.mul(main).mul(1.4); }
        if (old.name === 'emissive_lantern_side') { material.color.setScalar(0.03); material.emissiveNode = accent.mul(side).mul(1.4); }
        if (old.name === 'emissive_window_glow') { material.color.setScalar(0.02); material.emissiveNode = warm.mul(interior).mul(1.2); }
        if (old.name === 'mat_glass_teal') material.emissiveNode = accent.mul(interior).mul(0.55);
        materials.set(source, material); return material;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(shade) : shade(mesh.material);
    });
    shop.materials.forEach(material => material.dispose()); scene.add(shop.root);
    const hinge = (names: string[], at: Point) => {
      const pivot = new THREE.Group(); pivot.position.set(...at); shop.root.add(pivot);
      for (const name of names) { const node = shop.node(name); pivot.add(node); node.position.sub(pivot.position); }
      return pivot;
    };
    const lanterns = [hinge(['lantern_main', 'lantern_main_trim'], [-2.8, 2.45, 1.9]), hinge(['lantern_side', 'lantern_side_trim'], [2.9, 2.45, 1.5])];
    const curtains = Array.from({ length: 5 }, (_, i) => hinge([`noren_panel_0${i + 1}`], [(i - 2) * 0.92, 2.3, 1.86]));
    scene.userData.assetsLoaded = true; return { shop, lanterns, curtains };
  });

  const bowlMaterial = new THREE.MeshStandardNodeMaterial({ color: 0xf5d9b4, roughness: 0.35 });
  const soupMaterial = new THREE.MeshStandardNodeMaterial({ color: 0xb75d23, roughness: 0.22 });
  const noodleMaterial = new THREE.MeshStandardNodeMaterial({ color: 0xf3d19b, roughness: 0.7 });
  const bowlGeometry = new THREE.LatheGeometry([new THREE.Vector2(0.065, 0), new THREE.Vector2(0.11, 0.035), new THREE.Vector2(0.155, 0.12)], 24);
  for (const x of [-1.35, 0, 1.35]) {
    add(bowlGeometry, bowlMaterial, [x, 1.08, 1.97]);
    add(new THREE.CircleGeometry(0.143, 24).rotateX(-Math.PI / 2), soupMaterial, [x, 1.186, 1.97]);
    for (let i = 0; i < 3; i++) add(new THREE.TorusGeometry(0.04 + i * 0.025, 0.006, 4, 24).rotateX(-Math.PI / 2), noodleMaterial, [x, 1.192, 1.97]);
  }
  const steamMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  steamMaterial.colorNode = mix(vec3(0.23, 0.28, 0.36), primary.mul(0.25).add(vec3(0.2)), 0.3);
  steamMaterial.opacityNode = uv().sub(0.5).length().smoothstep(0.5, 0.05).pow(2).mul(0.075);
  const steamCount = budget.preset === 'compatibility' ? 30 : 48;
  const steam = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), steamMaterial, steamCount); steam.name = 'Ichiraku / rising steam';
  steam.frustumCulled = false; steam.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(steam);
  const hits = createHits({ decay: 0.32, interval: 0.18 });
  const targetColors = ICHIRAKU_PALETTES.map(palette => palette.colors.map(hex => new THREE.Color(hex)));
  let shotIndex = 0, elapsed = 0, paletteIndex = 0, sincePalette = 0, lastOnset = false, bass = 0, loudness = 0, treble = 0, snare = false;
  const eye = new THREE.Vector3(), end = new THREE.Vector3(), look = new THREE.Vector3();
  scene.userData.assetsLoaded = false;
  const update = (frame: ModeFrame) => {
    resizeCamera(camera, frame.aspect);
    const dt = frame.reducedMotion ? 0 : THREE.MathUtils.clamp(frame.delta, 0, 0.1);
    const onset = frame.audio.onset && !lastOnset; lastOnset = frame.audio.onset;
    clock.value += dt; elapsed += dt; sincePalette += dt;
    if (dt > 0) {
      hits.update({ ...frame, time: clock.value, delta: dt, audio: { ...frame.audio, onset } });
      if (hits.fired) snare = frame.audio.highs > frame.audio.bass + 0.15;
      if (sincePalette >= 16 || (hits.fired && hits.count % 8 === 0 && sincePalette > 3)) { paletteIndex = (paletteIndex + 1) % ICHIRAKU_PALETTES.length; sincePalette = 0; }
      bass = approach(bass, frame.response.bass, dt, 0.16); loudness = approach(loudness, frame.response.loudness, dt, 0.4); treble = approach(treble, frame.audio.highs, dt, 0.12);
      main.value = 0.65 + bass * 0.75 + hits.flash * (snare ? 0.35 : 1.4);
      side.value = 0.55 + treble * 0.35 + hits.flash * (snare ? 1.5 : 0.45);
      interior.value = 0.5 + loudness * 0.55 + hits.flash * 0.35;
      trim.value = 0.3 + bass * 0.45 + hits.flash * 0.65;
      [primary, accent, warm].forEach((color, i) => color.value.lerp(targetColors[paletteIndex][i], 1 - Math.exp(-dt / 0.9)));
    }
    let shot = ICHIRAKU_SHOTS[shotIndex];
    if (dt > 0 && (elapsed >= shot.seconds || (elapsed > shot.seconds * 0.9 && hits.fired))) { elapsed = 0; shotIndex = (shotIndex + 1) % ICHIRAKU_SHOTS.length; shot = ICHIRAKU_SHOTS[shotIndex]; }
    const phase = Math.min(1, elapsed / shot.seconds), ease = phase * phase * (3 - 2 * phase);
    eye.set(...shot.eye).lerp(end.set(...shot.end), ease); look.set(...shot.look);
    camera.position.copy(eye); camera.lookAt(look);
    // Widen the vertical lens for portrait instead of backing the camera into neighboring buildings.
    const fov = frame.aspect < 1 ? 2 * Math.atan(Math.tan(shot.fov * Math.PI / 360) * (4 / 3) / frame.aspect) * 180 / Math.PI : shot.fov;
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    leftLight.color.copy(primary.value); rightLight.color.copy(accent.value); counterLight.color.copy(warm.value); loftLight.color.copy(accent.value);
    leftLight.intensity = main.value * 9; rightLight.intensity = side.value * 7; counterLight.intensity = interior.value * 10; loftLight.intensity = interior.value * 4;
    const built = models.value;
    if (built) {
      built.lanterns.forEach((lantern, i) => { lantern.rotation.z = Math.sin(clock.value * 1.2 + i * 1.8) * (0.025 + bass * 0.015); });
      built.curtains.forEach((curtain, i) => { curtain.rotation.x = Math.sin(clock.value * 1.4 + i * 0.8) * 0.035 - bass * 0.035; });
    }
    for (let i = 0; i < steamCount; i++) {
      const chimney = i >= steamCount * 0.6, age = (clock.value * (chimney ? 0.18 : 0.35) + i * 0.137) % 1;
      const x = chimney ? 0.35 : [-1.35, 0, 1.35][i % 3], y = chimney ? 6.43 : 1.21, z = chimney ? -0.15 : 1.97;
      dummy.position.set(x + Math.sin(age * 5 + i) * age * (chimney ? 0.4 : 0.12), y + age * (chimney ? 3 : 0.8), z + Math.sin(age * 3 + i) * age * 0.12);
      dummy.quaternion.copy(camera.quaternion); dummy.scale.setScalar(Math.sin(age * Math.PI) * (chimney ? 0.6 + age : 0.14 + age * 0.16));
      dummy.updateMatrix(); steam.setMatrixAt(i, dummy.matrix);
    } steam.instanceMatrix.needsUpdate = true;
    Object.assign(scene.userData, { shot: shot.name, shotIndex, elapsed, clock: clock.value, palette: ICHIRAKU_PALETTES[paletteIndex].name, paletteIndex,
      colors: [primary.value.toArray(), accent.value.toArray(), warm.value.toArray()], beats: hits.count, flash: hits.flash,
      main: main.value, side: side.value, interior: interior.value, steamTime: clock.value });
  };
  return { scene, camera, ready: models.ready, update,
    filter(input) { const edge = uv().sub(0.5).mul(vec2(1, 0.7)).length(); return vec4(input.sample(uv()).rgb.mul(edge.smoothstep(0.75, 0.15).mul(0.16).add(0.84)), 1); },
    dispose() { models.dispose(); disposeScene(scene); },
  };
}
