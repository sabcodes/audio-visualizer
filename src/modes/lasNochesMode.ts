import * as THREE from 'three/webgpu';
import { abs, attribute, cameraPosition, cos, float, fract, instancedBufferAttribute, mix, mx_noise_float, normalView, normalWorld, normalize, positionLocal, positionWorld, sin, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { ModeFrame, VisualMode } from './types';
import { approach, disposeScene, resizeCamera, sceneDefaults, settleStep } from './shared';
import { whenLoaded } from './figures';
import { drive } from './waveSixShared';
import { seededRandom } from '../rendering/diagnostics';
import { presetBudget, type QualityBudget } from '../rendering/quality';
import palaceUrl from '../assets/wave6/las_noches.glb?url';

// Asset coordinates are metres, +Y up, with the palace centred at (0, 93, -380).
// Keep the original scale: fitting the whole 12.6 km desert would dwarf the palace.
export const LAS_NOCHES_SHOTS = [
  { name: 'moonlit approach', eye: [180, 340, 3600], look: [0, 220, -200], move: [-70, -20, -220], fov: 34 },
  { name: 'dune level', eye: [-700, 140, 2450], look: [0, 240, -160], move: [180, 15, -160], fov: 49 },
  { name: 'east sweep', eye: [2400, 520, 1550], look: [0, 180, -250], move: [-180, 30, 180], fov: 43 },
  { name: 'above the dome', eye: [-1250, 1300, 1900], look: [0, 70, -300], move: [230, -80, -100], fov: 48 },
  { name: 'beneath the towers', eye: [100, 95, 720], look: [50, 300, -60], move: [-75, 18, -100], fov: 71 },
  { name: 'west colonnade', eye: [-1650, 260, 650], look: [0, 190, -310], move: [50, 80, -200], fov: 55 },
  { name: 'roof and crescent', eye: [50, 310, 1150], look: [0, 320, -500], move: [190, 50, -70], fov: 58 },
  { name: 'desert farewell', eye: [-900, 480, 3300], look: [0, 210, -150], move: [260, -40, -150], fov: 38 },
  { name: 'cylinder rim', eye: [520, 470, 650], look: [440, 410, 140], move: [-120, 45, -70], fov: 58 },
  { name: 'outer settlement', eye: [-2300, 150, 1400], look: [-2650, 100, 700], move: [-100, 5, -160], fov: 58 },
  { name: 'palace beyond the outposts', eye: [-2700, 230, 1400], look: [0, 190, -200], move: [180, 15, -100], fov: 47 },
  { name: 'quartz grove', eye: [2450, 150, 2900], look: [2400, 260, 2000], move: [20, 10, -180], fov: 64 },
  { name: 'moon through the branches', eye: [2450, 170, 2450], look: [1500, 700, -900], move: [-60, 40, -120], fov: 68 },
  { name: 'far side of the palace', eye: [1700, 620, -2400], look: [0, 170, -380], move: [-200, -40, 100], fov: 48 },
  { name: 'over the cylinder mouths', eye: [-300, 1100, 200], look: [0, 140, -300], move: [170, -90, -120], fov: 66 },
  { name: 'empty dune ridges', eye: [1200, 330, 3400], look: [700, 90, 1500], move: [-100, 10, -120], fov: 54 },
  { name: 'green vent skyline', eye: [-250, 390, 1250], look: [0, 460, -250], move: [160, 20, -110], fov: 57 },
  { name: 'eastern cylinder ascent', eye: [1120, 200, 440], look: [680, 430, -180], move: [-80, 75, -90], fov: 66 },
  { name: 'western tower silhouettes', eye: [-1350, 170, 800], look: [-550, 380, -200], move: [100, 30, -100], fov: 61 },
  { name: 'dome across the rain', eye: [1050, 560, 1450], look: [-100, 160, -380], move: [-160, -35, -100], fov: 43 },
  { name: 'palace from the northern dunes', eye: [-1700, 430, -2200], look: [0, 230, -380], move: [140, 20, 90], fov: 48 },
  { name: 'outpost alley', eye: [-2460, 125, 1230], look: [-2450, 140, 400], move: [0, 8, -130], fov: 65 },
  { name: 'grove beneath the green sky', eye: [2450, 200, 3100], look: [2300, 580, 1600], move: [-60, 35, -140], fov: 69 },
  { name: 'high crescent panorama', eye: [-550, 820, 2850], look: [0, 650, -1000], move: [200, -40, -120], fov: 58 },
] as const;

// Mouth centres and rim radii measured from the supplied GLB's topmost vertices, in metres.
export const LAS_NOCHES_VENTS = [
  [-390, 333.85, 180, 88], [440, 330.61, 140, 90], [-730, 244.51, -120, 66],
  [680, 260.44, -180, 68], [-180, 225.82, -620, 60], [-920, 272.46, 40, 56],
  [-620, 241.59, -220, 64], [-260, 234.64, -700, 58], [720, 296.9, -320, 62],
  [920, 272.71, -220, 58], [-1050, 201.08, -300, 50],
] as const;

/** A short gas introduction gives way to sustained green flame tendrils; rain is latched by the mode. */
export function lasNochesWeather(seconds: number, frame: Pick<ModeFrame, 'audio' | 'response'>) {
  const t = ((seconds % 72) + 72) % 72;
  const ramp = (a: number, b: number) => { const x = THREE.MathUtils.clamp((t - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
  const window = (a: number, b: number, c: number, d: number) => ramp(a, b) * (1 - ramp(c, d));
  const energy = THREE.MathUtils.clamp((frame.response.loudness - 0.04) / 0.6, 0, 1);
  return {
    smoke: window(4, 6, 10, 14) * energy * Math.min(1, 0.25 + frame.response.bass * 0.5 + frame.response.impact * 0.55),
    fire: window(10, 14, 49, 56) * energy * Math.min(0.6, 0.15 + frame.response.bass * 0.3 + frame.response.impact * 0.3),
    rain: energy * Math.min(1, frame.audio.highs * 1.7 + frame.response.loudness * 0.25),
  };
}

/** Las Noches: a quiet moonlit landscape punctuated by music-driven cylinder vents and weather. */
export function createLasNochesMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  camera.near = 2; camera.far = 30000;
  const random = seededRandom(8104);
  const time = uniform(0), ventStart = uniform(0), fire = uniform(0), smoke = uniform(0), cloudCharge = uniform(0), pulse = uniform(0), wet = uniform(0);
  const eye = uniform(new THREE.Vector3()), rainFall = uniform(0), rainAmount = uniform(0);
  scene.background = new THREE.Color(0x010504);
  scene.fog = new THREE.FogExp2(0x030a08, 0.000085);

  // Vented green light lingers across the sky once the rain has started.
  const skyMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, fog: false, depthWrite: false });
  const direction = normalize(positionLocal);
  const cloud = mx_noise_float(vec3(direction.x.mul(15).add(time.mul(0.006)), direction.y.mul(65), direction.z.mul(15)));
  const cloudMask = cloud.smoothstep(0.35, 0.7).mul(direction.y.smoothstep(0, 0.12)).mul(direction.y.smoothstep(0.65, 0.18));
  const skyGlow = direction.y.smoothstep(-0.08, 0.35).mul(cloudCharge);
  skyMaterial.colorNode = vec3(0.0015, 0.003, 0.0025).add(vec3(0.012, 0.018, 0.015).mul(cloudMask))
    .add(vec3(0.002, 0.028, 0.012).mul(skyGlow).mul(cloudMask.mul(0.7).add(0.3)));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(24000, 40, 24), skyMaterial));

  // The first green vapour starts a lasting rain cloud bank.
  const stormMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false });
  const stormPoint = positionWorld.xz.mul(0.001);
  const stormNoise = mx_noise_float(vec3(stormPoint.add(vec2(time.mul(0.008), 0)), time.mul(0.015))).mul(0.5).add(0.5);
  const stormDetail = mx_noise_float(vec3(stormPoint.mul(3), time.mul(0.025))).mul(0.2).add(0.8);
  const stormDensity = stormNoise.smoothstep(0.25, 0.72).mul(stormDetail);
  const stormEdge = positionWorld.xz.sub(vec2(0, -350)).length().smoothstep(5000, 2000);
  stormMaterial.colorNode = vec3(0.004, 0.055, 0.023).mul(stormDensity.mul(0.5).add(0.5));
  stormMaterial.opacityNode = stormDensity.mul(stormEdge).mul(cloudCharge).mul(0.85);
  const stormDeck = new THREE.Mesh(new THREE.PlaneGeometry(11000, 11000), stormMaterial);
  stormDeck.rotation.x = -Math.PI / 2; stormDeck.position.set(0, 1850, -350); stormDeck.name = 'green rain clouds'; scene.add(stormDeck);

  // A true crescent silhouette: the unlit surface stays black and the limb is cool white.
  const moonMaterial = new THREE.MeshBasicNodeMaterial({ fog: false });
  const moonNormal = normalize(positionLocal);
  const moonLight = moonNormal.dot(normalize(vec3(0.83, 0.12, -0.52))).smoothstep(-0.025, 0.04);
  const craters = mx_noise_float(moonNormal.mul(38)).mul(0.09).add(0.94);
  moonMaterial.colorNode = mix(vec3(0.001, 0.003, 0.002), vec3(1.8, 2, 1.85).mul(craters), moonLight);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(640, 64, 40), moonMaterial);
  moon.position.set(-850, 2300, -7600); scene.add(moon);

  // Soft aureole behind the crescent, rather than a luminous full disc.
  const haloMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
  haloMaterial.colorNode = vec3(0.12, 0.22, 0.17);
  haloMaterial.opacityNode = uv().sub(0.5).length().smoothstep(0.5, 0.12).pow(3).mul(0.14);
  const halo = new THREE.Sprite(haloMaterial); halo.geometry = halo.geometry.clone();
  halo.position.copy(moon.position).multiplyScalar(1.001); halo.scale.set(2600, 2600, 1); scene.add(halo);

  // Material replacement is local to this mode. Preserve the sand's authored trough vertex colours.
  const models = whenLoaded([palaceUrl], ([gltf]) => {
    const root = gltf.scene.clone(true), materials = new Map<THREE.Material, THREE.Material>();
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry = mesh.geometry.clone();
      const sand = mesh.name === 'White_dune_field' || mesh.name === 'White dune field';
      const replace = (old: THREE.Material) => {
        let material = materials.get(old);
        if (!material) {
          const source = old as THREE.MeshStandardMaterial;
          const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, vertexColors: source.vertexColors });
          const isSand = sand || old.name.startsWith('White sand');
          const isTree = old.name === 'Bare trees';
          const diffuse = normalWorld.dot(normalize(vec3(-0.65, 0.35, 0.7))).max(0);
          const band = diffuse.smoothstep(0.12, 0.2).mul(isSand ? 0.22 : 0.08).add(diffuse.smoothstep(0.58, 0.64).mul(isSand ? 0.32 : 0.18)).add(isSand ? 0.19 : 0.025);
          const rim = abs(normalView.z).oneMinus().max(0).pow(6);
          const stone = mx_noise_float(positionWorld.mul(isSand ? 0.025 : 0.07)).mul(0.05).add(0.97);
          const tint = isSand ? vec3(0.52, 0.61, 0.56) : vec3(source.color.r, source.color.g, source.color.b).mul(old.name.startsWith('Palace') ? 2.6 : 1);
          const groundGlow = positionWorld.y.div(240).oneMinus().clamp(0, 1).mul(fire).mul(0.08);
          m.colorNode = tint.mul(band).mul(stone).add(vec3(0.46, 0.65, 0.55).mul(rim).mul(isSand ? 0.035 : isTree ? 0.12 : 0.34))
            .add(vec3(0.01, 0.28, 0.17).mul(groundGlow)).add(vec3(0.08, 0.18, 0.13).mul(pulse).mul(rim).mul(0.18));
          materials.set(old, material = m);
        }
        return material;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(replace) : replace(mesh.material);
    });
    scene.add(root);
    addSurroundings(root, scene, budget);
    return root;
  });

  const addSprites = (material: THREE.SpriteNodeMaterial, count: number, name: string) => {
    const sprite = new THREE.Sprite(material); sprite.geometry = sprite.geometry.clone();
    sprite.count = count; sprite.frustumCulled = false; sprite.name = name; scene.add(sprite); return sprite;
  };

  // Hollow mouths sit exactly on the model's existing cylinder caps.
  const mouthMaterial = new THREE.MeshBasicNodeMaterial({ color: 0x010403 });
  for (const [x, y, z, radius] of LAS_NOCHES_VENTS) {
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.88, 48), mouthMaterial);
    mouth.rotation.x = -Math.PI / 2; mouth.position.set(x, y + 0.6, z); scene.add(mouth);
  }

  // Held black-green flame crests emerge from the mouths, never around the desert perimeter.
  const plumeCount = LAS_NOCHES_VENTS.length, plumeSeeds = new Float32Array(plumeCount * 4), plumeTops = new Float32Array(plumeCount * 2);
  for (let i = 0; i < plumeCount; i++) {
    const [x, y, z, radius] = LAS_NOCHES_VENTS[i];
    plumeSeeds.set([x, z, 180 + random() * 200, random() * 30], i * 4); plumeTops.set([y, radius], i * 2);
  }
  const ps = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(plumeSeeds, 4), 'vec4');
  const top = instancedBufferAttribute<'vec2'>(new THREE.InstancedBufferAttribute(plumeTops, 2), 'vec2');
  const flameMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
  const fuv = uv(), rise = fuv.y;
  const turbulence = mx_noise_float(vec3(fuv.x.mul(7).add(ps.w), rise.mul(8).sub(time.mul(1.4)), time.mul(0.25)));
  const bend = sin(rise.mul(9).sub(time.mul(1.7)).add(ps.w)).mul(rise).mul(0.14).add(turbulence.mul(0.12));
  const across = abs(fuv.x.sub(0.5).add(bend));
  const width = rise.oneMinus().max(0).pow(0.8).mul(0.38).add(0.015);
  const body = across.div(width);
  const edge = body.smoothstep(0.36, 0.72).mul(body.smoothstep(1, 0.76));
  flameMaterial.colorNode = vec3(0.001, 0.009, 0.006).add(vec3(0.015, 0.85, 0.48).mul(edge.add(turbulence.smoothstep(0.15, 0.5).mul(0.18))).mul(fire.mul(0.85).add(pulse.mul(0.35))));
  const flameDistance = vec2(ps.x, ps.y).sub(cameraPosition.xz).length().smoothstep(400, 900);
  flameMaterial.opacityNode = body.smoothstep(1.1, 0.72).mul(rise.smoothstep(0, 0.08)).mul(rise.smoothstep(1, 0.75)).mul(turbulence.mul(0.5).add(0.7)).mul(flameDistance).mul(fire).mul(0.8);
  const flameHeight = ps.z.mul(fire.mul(0.42).add(0.6));
  flameMaterial.positionNode = vec3(ps.x.add(sin(time.mul(0.4).add(ps.w)).mul(10)), top.x.add(flameHeight.mul(0.45)), ps.y);
  flameMaterial.scaleNode = vec2(top.y.mul(2), flameHeight);
  const flames = addSprites(flameMaterial, plumeCount, 'spiritual flames'); flames.visible = false;

  // Green gas rises from the mouths all the way into the cloud deck, with separate emission rhythms.
  const puffsPerVent = budget.particleScale < 1 ? 12 : 20, puffCount = plumeCount * puffsPerVent;
  const puffOrigins = new Float32Array(puffCount * 4), puffSeeds = new Float32Array(puffCount * 3);
  for (let i = 0; i < puffCount; i++) {
    const vent = Math.floor(i / puffsPerVent), origin = LAS_NOCHES_VENTS[vent];
    puffOrigins.set(origin, i * 4); puffSeeds.set([i % puffsPerVent / puffsPerVent, random() * Math.PI * 2, vent * 1.71], i * 3);
  }
  const po = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(puffOrigins, 4), 'vec4');
  const pp = instancedBufferAttribute<'vec3'>(new THREE.InstancedBufferAttribute(puffSeeds, 3), 'vec3');
  const gasMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
  const puffAge = fract(time.mul(0.07).add(pp.x)), drift = puffAge.pow(2).mul(220);
  gasMaterial.positionNode = vec3(po.x.add(sin(pp.y).mul(po.w).mul(0.35)).add(drift), po.y.add(20).add(puffAge.mul(1700)), po.z.add(cos(pp.y).mul(po.w).mul(0.35)).add(puffAge.mul(80)));
  gasMaterial.scaleNode = vec2(po.w.mul(puffAge.mul(5).add(0.8)), po.w.mul(puffAge.mul(5).add(1.4)).mul(2.6));
  const gasNoise = mx_noise_float(vec3(uv().mul(5).add(pp.y), time.mul(0.1))).mul(0.5).add(0.5);
  const puffShape = uv().sub(0.5).length().add(gasNoise.mul(0.12)).smoothstep(0.5, 0.12);
  const emission = sin(time.sub(puffAge.div(0.07)).mul(0.45).add(pp.z)).smoothstep(-0.2, 0.7).mul(0.5).add(0.5);
  const bornAfterVenting = time.sub(puffAge.div(0.07)).sub(ventStart).smoothstep(0, 0.3);
  gasMaterial.colorNode = mix(vec3(0.012, 0.3, 0.1), vec3(0.015, 0.42, 0.2), fire);
  gasMaterial.opacityNode = puffShape.mul(gasNoise).mul(puffAge.smoothstep(0, 0.05)).mul(puffAge.smoothstep(1, 0.88)).mul(emission).mul(bornAfterVenting).mul(smoke).mul(0.6);
  const gas = addSprites(gasMaterial, puffCount, 'cylinder gas'); gas.visible = false;

  // Ragged fragments lift off the fire and dissolve, like the torn green-black veil in the reference.
  const flecks = new Float32Array(90 * 4);
  for (let i = 0; i < 90; i++) { const [x, y, z] = LAS_NOCHES_VENTS[i % plumeCount]; flecks.set([x, z, y, random()], i * 4); }
  const fs = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(flecks, 4), 'vec4');
  const fragmentMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
  const age = fract(time.mul(0.075).add(fs.w));
  const torn = mx_noise_float(vec3(uv().mul(7).add(fs.w.mul(25)), time.mul(0.35)));
  const silhouette = uv().sub(0.5).mul(vec2(1.2, 1)).length().add(torn.mul(0.22));
  fragmentMaterial.positionNode = vec3(fs.x.add(sin(age.mul(8).add(fs.w.mul(20))).mul(75)), age.mul(500).add(fs.z), fs.y);
  fragmentMaterial.scaleNode = vec2(fs.w.mul(55).add(25), fs.w.mul(90).add(55)).mul(fire.mul(0.35).add(0.7));
  fragmentMaterial.colorNode = mix(vec3(0.001, 0.008, 0.004), vec3(0.008, 0.29, 0.16).mul(fire), torn.smoothstep(-0.1, 0.5));
  fragmentMaterial.opacityNode = silhouette.smoothstep(0.45, 0.18).mul(age.smoothstep(0, 0.1)).mul(age.smoothstep(1, 0.7)).mul(fire).mul(0.65);
  const fragments = addSprites(fragmentMaterial, 90, 'torn flame fragments'); fragments.visible = false;

  // Slow, low banks of mist tie the buildings into the dunes, with visible parallax.
  const mistSeeds = new Float32Array(18 * 4);
  for (let i = 0; i < 18; i++) mistSeeds.set([(random() - 0.5) * 4000, (random() - 0.5) * 2600, random() * 20, 600 + random() * 800], i * 4);
  const ms = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(mistSeeds, 4), 'vec4');
  const mistMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
  const mistShape = uv().sub(0.5).mul(vec2(1, 1.8)).length().smoothstep(0.5, 0.1);
  const mistNoise = mx_noise_float(vec3(uv().mul(vec2(7, 4)).add(ms.z), time.mul(0.04))).mul(0.4).add(0.5);
  mistMaterial.colorNode = vec3(0.035, 0.085, 0.06);
  mistMaterial.opacityNode = mistShape.mul(mistNoise).mul(0.17);
  mistMaterial.positionNode = vec3(ms.x.add(sin(time.mul(0.025).add(ms.z)).mul(160)), 28, ms.y);
  mistMaterial.scaleNode = vec2(ms.w, 140); addSprites(mistMaterial, 18, 'desert mist');

  // Reishi drifts upward while rain falls down: separate layers and separate audio bands.
  const motes = Math.round(1100 * Math.min(2, budget.particleScale)), seeds = new Float32Array(motes * 4);
  for (let i = 0; i < motes; i++) seeds.set([(random() - 0.5) * 3800, random() * 1000, (random() - 0.5) * 3000, random()], i * 4);
  const s = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(seeds, 4), 'vec4');
  const ashMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  ashMaterial.positionNode = vec3(s.x.add(sin(time.mul(0.18).add(s.w.mul(30))).mul(75)), fract(s.y.add(time.mul(12)).div(1000)).mul(1000), s.z.add(cos(time.mul(0.12).add(s.w.mul(20))).mul(50)));
  ashMaterial.scaleNode = vec2(s.w.mul(2.5).add(1.5));
  ashMaterial.colorNode = mix(vec3(0.18, 0.23, 0.2), vec3(0.04, 0.8, 0.46), s.w).mul(fire.mul(0.5).add(0.25));
  ashMaterial.opacityNode = uv().sub(0.5).length().smoothstep(0.5, 0.03).mul(sin(time.mul(0.5).add(s.w.mul(25))).mul(0.3).add(0.4));
  addSprites(ashMaterial, motes, 'rising reishi');

  const drops = Math.round(4500 * Math.min(2, budget.particleScale)), rain = new Float32Array(drops * 6), tails = new Float32Array(drops * 2);
  for (let i = 0; i < drops; i++) {
    const x = (random() - 0.5) * 2600, y = random() * 1700, z = (random() - 0.5) * 2600;
    rain.set([x, y, z, x, y, z], i * 6); tails[i * 2 + 1] = 1;
  }
  const rainGeometry = new THREE.BufferGeometry();
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(rain, 3));
  rainGeometry.setAttribute('tail', new THREE.BufferAttribute(tails, 1));
  const rainMaterial = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
  const tail = attribute<'float'>('tail'), fall = fract(positionLocal.y.sub(rainFall).div(1700)).mul(1700).sub(850);
  rainMaterial.positionNode = vec3(positionLocal.x.add(eye.x).add(fall.mul(0.025)), fall.add(eye.y).add(tail.mul(16)), positionLocal.z.add(eye.z));
  const shown = fract(positionLocal.x.mul(0.713)).lessThan(rainAmount).select(float(1), float(0));
  rainMaterial.colorNode = vec3(0.12, 0.28, 0.2).mul(shown).mul(wet.mul(0.65).add(0.18));
  rainMaterial.opacityNode = mix(float(0.12), float(0.55), tail).mul(wet);
  const rainLines = new THREE.LineSegments(rainGeometry, rainMaterial); rainLines.frustumCulled = false; rainLines.name = 'falling rain'; rainLines.visible = false; scene.add(rainLines);

  // Strong beats can cut after 2.8 s; softer beats hold 4.5 s. Silence still tours every 10 s.
  let shot = 0, shotAge = 0, atmosphereTime = 0, motionTime = 0, kick = 0, venting = false, rainStarted = false;
  const look = new THREE.Vector3();
  return {
    scene, camera, ready: models.ready,
    update(frame) {
      const dt = frame.reducedMotion ? 0 : Math.min(0.1, Math.max(0, frame.delta));
      const step = Math.min(0.1, Math.max(0, settleStep(frame))), pace = Math.min(2, Math.max(0, drive(frame)));
      motionTime += dt; shotAge += dt;
      if (frame.response.loudness > 0.04) atmosphereTime += dt;
      const playing = frame.response.loudness > 0.04;
      const beatHold = frame.response.impact > 0.7 ? 2.8 : 4.5;
      if (dt > 0 && (shotAge >= (playing ? 8 : 10) || (shotAge >= beatHold && frame.audio.onset && frame.response.impact > 0.3))) {
        shot = (shot + 1) % LAS_NOCHES_SHOTS.length; shotAge = 0;
      }
      const current = LAS_NOCHES_SHOTS[shot], u = shotAge / 10;
      camera.position.set(current.eye[0] + current.move[0] * u, current.eye[1] + current.move[1] * u, current.eye[2] + current.move[2] * u);
      look.set(current.look[0], current.look[1], current.look[2]); camera.lookAt(look);
      if (camera.fov !== current.fov) { camera.fov = current.fov; camera.updateProjectionMatrix(); }
      resizeCamera(camera, frame.aspect); eye.value.copy(camera.position);
      time.value = motionTime;
      const weather = lasNochesWeather(atmosphereTime, frame);
      if (weather.smoke > 0.001 && !venting) ventStart.value = motionTime;
      venting = weather.smoke > 0.001;
      if (venting) rainStarted = true;
      if (frame.audio.onset) kick = Math.max(kick, Math.min(1, frame.response.impact));
      kick = approach(kick, 0, step, frame.reducedFlash ? 0.9 : 0.45);
      pulse.value = kick * (frame.reducedFlash ? 0.12 : 0.7);
      smoke.value = approach(smoke.value, weather.smoke, step, 1.1);
      fire.value = approach(fire.value, weather.fire, step, 0.3);
      // Rain begins with the first vent and stays on across quiet passages and later weather cycles.
      cloudCharge.value = approach(cloudCharge.value, rainStarted ? 0.6 + smoke.value * 0.4 : 0, step, 1.5);
      wet.value = approach(wet.value, rainStarted ? 0.55 + weather.rain * 0.45 : 0, step, 0.35);
      gas.visible = smoke.value > 0.004; flames.visible = fragments.visible = fire.value > 0.004; rainLines.visible = wet.value > 0.004;
      rainAmount.value = wet.value;
      rainFall.value += dt * (460 + pace * 150 + Math.min(1, frame.audio.highs) * 160);
      scene.userData.shot = current.name;
      scene.userData.weather = { smoke: smoke.value, clouds: cloudCharge.value, fire: fire.value, rain: wet.value };
    },
    dispose() { models.dispose(); disposeScene(scene); },
  };
}

/** Adjacent exterior locations from the reference: sparse outposts and a pale, skeletal grove. */
function addSurroundings(root: THREE.Object3D, scene: THREE.Scene, budget: QualityBudget) {
  let sand: THREE.Mesh | undefined, tree: THREE.Mesh | undefined;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (/White.dune.field/.test(mesh.name)) sand = mesh;
    if (!tree && /Dead.tree/.test(mesh.name)) tree = mesh;
  });
  root.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  const floor = (x: number, z: number) => {
    ray.ray.origin.set(x, 2000, z);
    return sand ? ray.intersectObject(sand, false)[0]?.point.y ?? 0 : 0;
  };
  const random = seededRandom(1888), settlement = new THREE.Group(); settlement.name = 'outer settlement';
  const stone = new THREE.MeshBasicNodeMaterial();
  const light = normalWorld.dot(normalize(vec3(-0.65, 0.35, 0.7))).max(0);
  stone.colorNode = vec3(0.25, 0.31, 0.28).mul(light.mul(0.6).add(0.12));
  const doorway = new THREE.MeshBasicNodeMaterial({ color: 0x010403 }), box = new THREE.BoxGeometry(1, 1, 1), door = new THREE.PlaneGeometry(1, 1);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 5; col++) {
    const x = -2800 + col * 180, z = 350 + row * 160, y = floor(x, z);
    const width = 65 + random() * 40, depth = 65 + random() * 35, height = 55 + random() * 60;
    const house = new THREE.Mesh(box, stone); house.position.set(x, y + height / 2 - 4, z); house.scale.set(width, height, depth); settlement.add(house);
    const opening = new THREE.Mesh(door, doorway); opening.position.set(x, y + 15, z + depth / 2 + 0.3); opening.scale.set(13, 30, 1); settlement.add(opening);
  }
  scene.add(settlement);
  if (tree) {
    // Reuse the supplied branches, centred at their feet, rather than downloading a second tree asset.
    const source = tree as THREE.Mesh, geometry = source.geometry.clone(); geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!, centre = bounds.getCenter(new THREE.Vector3());
    geometry.translate(-centre.x, -bounds.min.y, -centre.z);
    const count = budget.particleScale < 1 ? 28 : 48, grove = new THREE.InstancedMesh(geometry, source.material, count);
    grove.name = 'quartz grove'; const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      let x = 2400 + (random() - 0.5) * 1200;
      if (Math.abs(x - 2450) < 125) x += x < 2450 ? -150 : 150;
      const z = 2300 + (random() - 0.5) * 1350;
      dummy.position.set(x, floor(x, z) - 1, z); dummy.rotation.y = random() * Math.PI * 2;
      const scale = 0.8 + random() * 1.8; dummy.scale.set(scale, scale * (1 + random() * 0.5), scale); dummy.updateMatrix(); grove.setMatrixAt(i, dummy.matrix);
    }
    scene.add(grove);
  }
}
