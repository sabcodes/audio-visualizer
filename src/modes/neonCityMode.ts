import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { abs, dot, float, fract, instancedBufferAttribute, max, mix, mx_noise_float, normalLocal, positionView, positionWorld, sin, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, createSpectrumTexture, spectrumAxisNode, beatGate, approach } from './shared';
import { seededRandom } from '../rendering/diagnostics';
import { presetBudget, type QualityBudget } from '../rendering/quality';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
const hash = (p: V2) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
const HAZE = vec3(0.02, 0.07, 0.12);
// Sign palette in scene-linear: magenta, cyan, acid green, amber, violet, red.
const SIGN_COLOURS = [[2.6, 0.25, 1.4], [0.2, 2.2, 2.6], [0.6, 2.6, 0.5], [2.8, 1.2, 0.2], [1.3, 0.4, 2.8], [2.8, 0.2, 0.25]];
const LAYERS = [
  { count: 22, near: 90, far: 190, spread: 340, width: [16, 32], height: [90, 240] },
  { count: 70, near: 220, far: 420, spread: 640, width: [12, 28], height: [60, 300] },
  { count: 170, near: 450, far: 900, spread: 1300, width: [10, 34], height: [40, 380] },
];

interface Tower { x: number; z: number; w: number; d: number; h: number; layer: number }

export function createNeonCityMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).far = 2400;
  const spectrum = createSpectrumTexture();
  const time = uniform(0), bass = uniform(0), logMapping = uniform(0), nyquist = uniform(24000);
  const beatSeed = uniform(0), beatLevel = uniform(0), sweep = uniform(-1);
  const random = seededRandom(2077);
  const fog = positionView.z.negate().smoothstep(120, 1300);

  // Sky: deep blue with a glow over the city's base, like light pollution.
  const sky = new THREE.MeshBasicNodeMaterial({ depthWrite: false });
  sky.colorNode = mix(vec3(0.03, 0.11, 0.17), vec3(0.002, 0.006, 0.02), uv().y.smoothstep(0.05, 0.75));
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(3200, 1400), sky); backdrop.position.set(0, 250, -1100); backdrop.renderOrder = -2;
  scene.add(backdrop);

  // Towers: one instanced box per building, windows generated per fragment from world position.
  const towers: Tower[] = [];
  LAYERS.forEach((layer, l) => {
    for (let i = 0; i < layer.count; i++) {
      const w = layer.width[0] + random() * (layer.width[1] - layer.width[0]);
      // Keep a central avenue open in the near layer so the view runs deep into the city.
      let x = (random() - 0.5) * layer.spread;
      if (l === 0 && Math.abs(x) < 70) x = Math.sign(x || 1) * (70 + random() * 40);
      towers.push({ x, z: -(layer.near + random() * (layer.far - layer.near)), w, d: w * (0.7 + random() * 0.6), h: layer.height[0] + Math.pow(random(), 1.5) * (layer.height[1] - layer.height[0]), layer: l });
    }
  });
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1); boxGeometry.translate(0, 0.5, 0);
  const towerData = new Float32Array(towers.length * 4);
  towers.forEach((tower, i) => towerData.set([random(), random(), tower.layer, random()], i * 4));
  const data = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(towerData, 4), 'vec4');
  const towerMaterial = new THREE.MeshBasicNodeMaterial();
  const side = abs(normalLocal.x).greaterThan(0.5), top = abs(normalLocal.y).greaterThan(0.5);
  const wx = side.select(positionWorld.z, positionWorld.x);
  const grid = vec2(wx.div(1.3), positionWorld.y.div(1.9)), cell = grid.floor(), f = fract(grid);
  const pane = f.x.smoothstep(0.12, 0.2).mul(f.x.smoothstep(0.88, 0.8)).mul(f.y.smoothstep(0.18, 0.26)).mul(f.y.smoothstep(0.78, 0.7));
  const energy = spectrumAxisNode(spectrum.texture, data.y, logMapping, nyquist);
  const roll = hash(cell.add(data.x.mul(91.7)) as V2), tint = hash(cell.add(data.w.mul(37.1)).add(4.2) as V2);
  // More windows light up as this building's band gets louder; a beat sweep rolls up the towers.
  const sweepBand = positionWorld.y.div(320).sub(sweep).abs().smoothstep(0.08, 0).mul(sweep.greaterThanEqual(0).select(float(1), float(0)));
  const lit = roll.lessThan(energy.mul(0.4).add(0.12).add(sweepBand.mul(0.4))).select(float(1), float(0));
  const flicker = sin(time.mul(roll.mul(9).add(3)).add(roll.mul(40))).mul(0.5).add(0.5).mul(roll.lessThan(0.04).select(float(1), float(0)));
  const warm = vec3(1.5, 0.95, 0.45), cool = vec3(0.45, 1.1, 1.6), lamp = mix(warm, cool, tint.smoothstep(0.55, 0.75));
  const windowGlow = lamp.mul(pane).mul(lit.add(flicker).min(1)).mul(energy.mul(1.6).add(0.55).add(bass.mul(0.6)));
  const wall = vec3(0.003, 0.006, 0.012).add(vec3(0, 0.02, 0.035).mul(positionWorld.y.div(220).oneMinus().clamp(0, 1).pow(4)));
  const facade = top.select(vec3(0.004, 0.008, 0.016), wall.add(windowGlow.mul(data.z.equal(2).select(float(0.6), float(1)))));
  towerMaterial.colorNode = mix(facade, HAZE, fog.mul(0.75));
  const towerMesh = new THREE.InstancedMesh(boxGeometry, towerMaterial, towers.length);
  const dummy = new THREE.Object3D();
  towers.forEach((tower, i) => { dummy.position.set(tower.x, -40, tower.z); dummy.scale.set(tower.w, tower.h + 40, tower.d); dummy.updateMatrix(); towerMesh.setMatrixAt(i, dummy.matrix); });
  scene.add(towerMesh);

  // Neon signs: billboards, vertical strips and rings on the near and mid facades.
  const signTowers = towers.filter((tower) => tower.layer < 2);
  const signCount = Math.round(220 * Math.min(1.5, budget.particleScale));
  const signData = new Float32Array(signCount * 4), signMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicNodeMaterial(), signCount);
  for (let i = 0; i < signCount; i++) {
    const tower = signTowers[Math.floor(random() * signTowers.length)], kind = random() < 0.07 ? 3 : Math.floor(random() * 3);
    const [w, h] = kind === 3 ? [26 + random() * 18, 15 + random() * 8] : kind === 0 ? [12 + random() * 16, 6 + random() * 6] : kind === 1 ? [4 + random() * 3, 18 + random() * 24] : [9 + random() * 8, 0];
    const height = 12 + random() * (tower.h - 20);
    dummy.position.set(tower.x + (random() - 0.5) * (tower.w - w * 0.5), height, tower.z + tower.d / 2 + 0.6 + random() * 2);
    dummy.scale.set(w, kind === 2 ? w : h, 1); dummy.updateMatrix(); signMesh.setMatrixAt(i, dummy.matrix);
    signData.set([random(), random(), kind, Math.floor(random() * SIGN_COLOURS.length)], i * 4);
  }
  const sign = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(signData, 4), 'vec4');
  const signMaterial = signMesh.material as THREE.MeshBasicNodeMaterial;
  signMaterial.transparent = true; signMaterial.depthWrite = false; signMaterial.blending = THREE.AdditiveBlending; signMaterial.side = THREE.DoubleSide;
  const s = uv(), edge = s.sub(0.5).abs(), border = max(edge.x, edge.y);
  const frame = border.smoothstep(0.43, 0.47).mul(border.smoothstep(0.5, 0.48));
  // Glyphs: blocky characters from a hashed grid, 7 across a billboard or 6 down a strip.
  const glyphGrid = sign.z.equal(1).select(vec2(2, 12), vec2(14, 4));
  const glyphCell = s.mul(0.8).add(0.1).mul(glyphGrid).floor();
  const glyph = hash(glyphCell.add(sign.x.mul(53)) as V2).lessThan(0.55).select(float(1), float(0)).mul(edge.x.lessThan(0.38).select(float(1), float(0))).mul(edge.y.lessThan(0.38).select(float(1), float(0)));
  const ringR = s.sub(0.5).length();
  const ring = ringR.sub(0.42).abs().smoothstep(0.05, 0.01).add(ringR.sub(0.22).abs().smoothstep(0.04, 0.0).mul(0.7));
  const signEnergy = spectrumAxisNode(spectrum.texture, sign.y, logMapping, nyquist);
  // Video walls: a live 20-bar EQ with scanlines inside a bright bezel.
  const bar = s.x.mul(20).floor(), barLevel = spectrumAxisNode(spectrum.texture, bar.add(0.5).div(20), logMapping, nyquist);
  const bars = s.y.lessThan(barLevel.mul(0.85).add(0.04)).select(float(1), float(0)).mul(fract(s.x.mul(20)).smoothstep(0.08, 0.2).mul(fract(s.x.mul(20)).smoothstep(0.92, 0.8)));
  const scan = sin(s.y.mul(180)).mul(0.15).add(0.85);
  const screen = frame.add(bars.mul(scan)).add(0.08);
  const shape = sign.z.equal(3).select(screen, sign.z.equal(2).select(ring, frame.add(glyph.mul(0.8))));
  const colourIndex = sign.w;
  let colour: Node<'vec3'> = vec3(...SIGN_COLOURS[0] as [number, number, number]);
  SIGN_COLOURS.forEach((rgb, k) => { if (k) colour = colourIndex.equal(k).select(vec3(rgb[0], rgb[1], rgb[2]), colour); });
  const hit = fract(sign.x.mul(13.7).add(beatSeed)).lessThan(0.3).select(beatLevel.mul(2.2), float(0));
  // Some signs buzz like failing tubes; all of them pump with their band and the bass.
  const buzz = fract(sign.x.mul(7.1)).lessThan(0.12).select(sin(time.mul(23).add(sign.x.mul(50))).step(-0.6).oneMinus().mul(0.7).add(0.3), float(1));
  const brightness = signEnergy.mul(2.4).add(0.5).add(bass.mul(0.7)).add(hit).mul(buzz);
  signMaterial.colorNode = mix(colour.mul(brightness), HAZE.mul(4), fog.mul(0.7));
  signMaterial.opacityNode = shape.clamp(0, 1).mul(fog.mul(0.6).oneMinus());
  scene.add(signMesh);

  // Flying traffic: tail lights one way, headlights the other, on a few height lanes.
  const carCount = Math.round(160 * Math.min(2, budget.particleScale));
  const cars = new Float32Array(carCount * 4);
  for (let i = 0; i < carCount; i++) cars.set([random(), 50 + Math.floor(random() * 6) * 26 + random() * 4, -(200 + random() * 600), random() < 0.5 ? 1 : -1], i * 4);
  const car = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(cars, 4), 'vec4');
  const carMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const travel = fract(car.x.add(time.mul(0.012).add(bass.mul(0.002)).mul(car.w))).sub(0.5).mul(900);
  carMaterial.positionNode = vec3(travel, car.y, car.z);
  carMaterial.colorNode = car.w.greaterThan(0).select(vec3(3, 0.2, 0.15), vec3(2.4, 2.4, 2.8)).mul(fog.mul(0.6).oneMinus());
  carMaterial.opacityNode = uv().sub(0.5).mul(vec2(1, 3)).length().smoothstep(0.5, 0.0);
  carMaterial.scaleNode = vec2(7, 1.6);
  const carSprite = new THREE.Sprite(carMaterial); carSprite.geometry = carSprite.geometry.clone(); carSprite.count = carCount; carSprite.frustumCulled = false;
  scene.add(carSprite);

  // Haze slabs between the layers give depth and catch the neon glow.
  for (const [z, strength] of [[-200, 0.3], [-430, 0.45], [-950, 0.6]] as const) {
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const n = mx_noise_float(vec3(uv().x.mul(6).add(time.mul(0.01)), uv().y.mul(2), z)).mul(0.5).add(0.5);
    material.colorNode = vec3(0.03, 0.12, 0.17).mul(n.mul(0.6).add(0.4)).mul(uv().y.smoothstep(0.7, 0.0)).mul(strength).mul(bass.mul(0.5).add(1));
    const slab = new THREE.Mesh(new THREE.PlaneGeometry(2400, 500), material); slab.position.set(0, 120, z);
    scene.add(slab);
  }

  // Foreground balcony: a dark rail and posts with a chain-link panel catching rim light.
  const railMaterial = new THREE.MeshBasicNodeMaterial({ color: 0x020305 });
  const rail = new THREE.Mesh(new THREE.BoxGeometry(400, 0.35, 0.35), railMaterial); rail.position.set(0, 97, 28);
  const lowerRail = rail.clone(); lowerRail.position.y = 93;
  scene.add(rail, lowerRail);
  for (let x = -120; x <= 120; x += 30) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 10, 0.4), railMaterial); post.position.set(x, 92, 28); scene.add(post); }
  const meshMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const diamond = vec2(s.x.add(s.y), s.x.sub(s.y)).mul(vec2(220, 220)).fract().sub(0.5).abs();
  const wire = diamond.x.min(diamond.y).smoothstep(0.06, 0.0);
  meshMaterial.colorNode = vec3(0.05, 0.25, 0.3).mul(bass.mul(0.6).add(0.4));
  meshMaterial.opacityNode = wire.mul(0.55);
  const chain = new THREE.Mesh(new THREE.PlaneGeometry(400, 3.6), meshMaterial); chain.position.set(0, 95, 28.2);
  scene.add(chain);

  const beat = beatGate(0.25);
  let level = 0, sweepAge = -1, drift = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      spectrum.update(frame.audio.spectrum);
      logMapping.value = frame.spectrumMapping === 'log' ? 1 : 0; nyquist.value = frame.sampleRate / 2;
      time.value = frame.time; bass.value = approach(bass.value, frame.response.bounce, frame.delta, 0.05);
      if (beat(frame.time, frame.audio.onset)) { level = 1; beatSeed.value = (beatSeed.value + 0.618) % 1; if (sweepAge < 0) sweepAge = 0; }
      level = Math.max(0, level - frame.delta * 2.5);
      beatLevel.value = frame.reducedFlash ? level * 0.2 : level;
      if (sweepAge >= 0) { sweepAge += frame.delta; if (sweepAge > 1.4) sweepAge = -1; }
      sweep.value = sweepAge < 0 || frame.reducedFlash ? -1 : sweepAge / 1.2;
      drift += frame.delta * 0.02;
      camera.position.set(Math.sin(drift) * 24, 108 + Math.sin(frame.time * 0.13) * 1.2, 52);
      camera.lookAt(Math.sin(drift) * 18, 92, -300);
    },
    dispose() { disposeScene(scene); spectrum.dispose(); },
  };
}
