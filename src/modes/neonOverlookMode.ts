import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { abs, attribute, float, fract, instancedBufferAttribute, max, mix, mx_noise_float, normalLocal, positionLocal, positionView, positionWorld, sin, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, createSpectrumTexture, spectrumAxisNode, approach, settleStep } from './shared';
import { hash2 } from './shaderModes';
import { createHits } from './hitPulse';
import { HAZE, SIGN_COLOURS } from './neonCityMode';
import { drive, isSnare } from './waveSixShared';
import { seededRandom } from '../rendering/diagnostics';
import { presetBudget, type QualityBudget } from '../rendering/quality';


/** City layout: lots on a grid either side of streets, in world units (a window is about 1.3 wide). */
export const OVERLOOK = { lots: 16, lot: 34, street: 12 };
interface Tower { x: number; z: number; w: number; d: number; h: number }

/** Towers on a street grid, tallest toward the middle; a lot holds one tower or a cluster of up to four. */
export function overlookTowers(count: number, random: () => number) {
  const towers: Tower[] = [], pitch = OVERLOOK.lot + OVERLOOK.street, half = (OVERLOOK.lots * pitch) / 2;
  for (let i = 0; i < OVERLOOK.lots; i++) for (let j = 0; j < OVERLOOK.lots; j++) {
    const cx = -half + (i + 0.5) * pitch, cz = -half + (j + 0.5) * pitch, centre = Math.hypot(cx, cz) / half;
    const split = random() < 0.45 ? 2 : 1;
    for (let a = 0; a < split; a++) for (let b = 0; b < split; b++) {
      const size = OVERLOOK.lot / split, w = size * (0.6 + random() * 0.3), d = size * (0.6 + random() * 0.3);
      const tall = Math.max(0.15, 1.2 - centre) * (0.4 + Math.pow(random(), 2.2) * 1.6);
      towers.push({ x: cx + (a - (split - 1) / 2) * size, z: cz + (b - (split - 1) / 2) * size, w, d, h: 18 + tall * 200 / split ** 0.5 });
    }
  }
  // Keep the tallest, then thin the rest at random down to the budget.
  towers.sort((a, b) => b.h - a.h);
  const keep = towers.slice(0, 40), rest = towers.slice(40).filter(() => random() < Math.max(0, count - 40) / Math.max(1, towers.length - 40));
  return [...keep, ...rest];
}

/**
 * Neon Overlook (wave 6, #9): Neon Megacity seen from high above, looking down at the streets. Blue-cyan towers
 * with lit window bands, big billboards in pink, red, green and cyan on their faces, holographic rings floating
 * over the tallest roofs, and red and white light trails running along curving elevated roads, all through layers
 * of haze and fine rain. Kicks pulse and expand the rings and flash the billboards, snares change what a sign
 * shows, bass speeds the traffic and stretches its trails, hats bring the rain and window sparkle.
 */
export function createNeonOverlookMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  const perspective = camera as THREE.PerspectiveCamera;
  perspective.fov = 48; perspective.far = 3000;
  const scale = Math.min(1.5, budget.particleScale);
  const spectrum = createSpectrumTexture();
  const time = uniform(0), bass = uniform(0), logMapping = uniform(0), nyquist = uniform(24000), sparkle = uniform(0), signGain = uniform(1);
  const beatSeed = uniform(0), beatLevel = uniform(0), content = uniform(0), traffic = uniform(0), trailLength = uniform(0.3);
  const random = seededRandom(9077);
  scene.background = new THREE.Color(0x01040a);
  // Haze grows with distance from the camera and toward street level.
  const haze = (strength = 1) => positionView.z.negate().smoothstep(450, 1700).mul(0.75).add(positionWorld.y.smoothstep(50, 0).mul(0.25)).min(1).mul(strength);

  // Ground: dark streets with lines of streetlights between the lots.
  const pitch = OVERLOOK.lot + OVERLOOK.street, extent = OVERLOOK.lots * pitch;
  const groundMaterial = new THREE.MeshBasicNodeMaterial();
  const g = positionWorld.xz.add(extent / 2).div(pitch), street = fract(g).mul(pitch);
  const inStreet = max(street.x.sub(OVERLOOK.lot).step(0), street.y.sub(OVERLOOK.lot).step(0)).oneMinus();
  const lamps = fract(positionWorld.xz.div(9)).sub(0.5).length().smoothstep(0.12, 0.02).mul(inStreet);
  groundMaterial.colorNode = mix(vec3(0.003, 0.005, 0.009).add(vec3(0.006, 0.012, 0.02).mul(inStreet)).add(vec3(0.4, 0.5, 0.6).mul(lamps)), HAZE.mul(0.6), haze());
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(extent * 2.4, extent * 2.4), groundMaterial);
  ground.rotation.x = -Math.PI / 2; scene.add(ground);

  // Towers: Neon Megacity's window grid, plus corner light strips and roofs that matter from above.
  const towers = overlookTowers(Math.round(480 * scale), random);
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  const towerData = new Float32Array(towers.length * 4);
  towers.forEach((tower, i) => towerData.set([random(), random(), tower.h, random()], i * 4));
  const data = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(towerData, 4), 'vec4');
  const towerMaterial = new THREE.MeshBasicNodeMaterial();
  const side = abs(normalLocal.x).greaterThan(0.5), top = abs(normalLocal.y).greaterThan(0.5);
  const wx = side.select(positionWorld.z, positionWorld.x);
  // Windows are larger than Neon Megacity's (the view is further away), and the grid fades to its average with
  // distance so far facades read as lit bands rather than shimmering specks.
  const grid = vec2(wx.div(2.6), positionWorld.y.div(3.4)), cell = grid.floor(), f = fract(grid);
  const far = positionView.z.negate().smoothstep(350, 800);
  const pane = mix(f.x.smoothstep(0.1, 0.18).mul(f.x.smoothstep(0.9, 0.82)).mul(f.y.smoothstep(0.16, 0.24)).mul(f.y.smoothstep(0.8, 0.72)), float(0.45), far);
  const energy = spectrumAxisNode(spectrum.texture, data.y, logMapping, nyquist);
  const roll = hash2(cell.add(data.x.mul(91.7))), tint = hash2(cell.add(data.w.mul(37.1)).add(4.2));
  const lit = roll.lessThan(energy.mul(0.18).add(0.07)).select(float(1), float(0));
  const twinkle = hash2(cell.add(fract(time.mul(7)).floor().add(sparkle.mul(13.1)))).lessThan(sparkle.mul(0.04)).select(float(1.5), float(0));
  const lamp = mix(vec3(0.45, 1.2, 1.7), vec3(1.5, 0.95, 0.5), tint.smoothstep(0.75, 0.85));
  const windowGlow = lamp.mul(pane).mul(lit.add(twinkle).min(1.6)).mul(energy.mul(0.6).add(0.5).add(bass.mul(0.2)));
  // Corner strips: some towers trace their edges in cyan or magenta.
  const edgeU = uv().x.sub(0.5).abs().mul(2);
  const strip = data.w.lessThan(0.3).select(edgeU.smoothstep(0.93, 0.99), float(0)).mul(positionWorld.y.div(data.z).smoothstep(0.05, 0.3));
  const stripColour = mix(vec3(0.2, 1.6, 2.4), vec3(2.2, 0.3, 1.8), data.x.step(0.5));
  const wall = vec3(0.006, 0.014, 0.03).add(vec3(0.01, 0.03, 0.05).mul(positionWorld.y.div(data.z).pow(2)));
  // Roofs: plant and vents from noise, a helipad ring on some, an aviation light blinking on all of them.
  const roofUv = uv().sub(0.5), roofR = roofUv.length();
  const plant = mx_noise_float(vec3(uv().mul(6), data.x.mul(40))).mul(0.5).add(0.5).smoothstep(0.55, 0.7);
  const pad = data.x.lessThan(0.15).select(roofR.sub(0.3).abs().smoothstep(0.03, 0.01), float(0));
  const blink = sin(time.mul(3).add(data.w.mul(30))).step(0.6);
  const beacon = roofR.smoothstep(0.06, 0.0).mul(blink);
  const roof = vec3(0.01, 0.016, 0.026).add(vec3(0.02, 0.03, 0.04).mul(plant)).add(vec3(0.3, 1.2, 1.6).mul(pad)).add(vec3(3, 0.2, 0.15).mul(beacon))
    .add(vec3(0.2, 0.8, 1.2).mul(roofUv.abs().max(vec2(0)).x.max(roofUv.abs().y).smoothstep(0.46, 0.5)).mul(data.w.lessThan(0.5).select(float(1), float(0))));
  const facade = top.select(roof, wall.add(windowGlow).add(stripColour.mul(strip)));
  towerMaterial.colorNode = mix(facade, HAZE.mul(0.7), haze());
  const towerMesh = new THREE.InstancedMesh(box, towerMaterial, towers.length);
  const dummy = new THREE.Object3D();
  towers.forEach((tower, i) => { dummy.position.set(tower.x, 0, tower.z); dummy.scale.set(tower.w, tower.h, tower.d); dummy.updateMatrix(); towerMesh.setMatrixAt(i, dummy.matrix); });
  scene.add(towerMesh);

  // Antennas with red tips on the tallest towers.
  const tall = towers.slice(0, 40);
  const mastMaterial = new THREE.MeshBasicNodeMaterial({ color: 0x0a1018 });
  const masts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.8, 1, 6).translate(0, 0.5, 0), mastMaterial, tall.length);
  const tipData = new Float32Array(tall.length * 3);
  tall.forEach((tower, i) => {
    const height = 20 + random() * 50;
    dummy.position.set(tower.x, tower.h, tower.z); dummy.scale.set(1, height, 1); dummy.updateMatrix(); masts.setMatrixAt(i, dummy.matrix);
    tipData.set([tower.x, tower.h + height, tower.z], i * 3);
  });
  scene.add(masts);
  const tipGeometry = new THREE.BufferGeometry(); tipGeometry.setAttribute('position', new THREE.BufferAttribute(tipData, 3));
  const tipMaterial = new THREE.PointsNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false });
  tipMaterial.colorNode = vec3(3, 0.15, 0.1).mul(sin(time.mul(2.4).add(positionLocal.x)).step(0).mul(0.8).add(0.2));
  tipMaterial.size = 3;
  scene.add(new THREE.Points(tipGeometry, tipMaterial));

  // Billboards on tower faces: vertical banners, wide boards and video screens.
  const signCount = Math.round(260 * scale);
  const signData = new Float32Array(signCount * 4), signMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicNodeMaterial(), signCount);
  const signTowers = towers.filter((tower) => tower.h > 70 && tower.w > 18);
  for (let i = 0; i < signCount; i++) {
    const tower = signTowers[Math.floor(random() * signTowers.length)], face = Math.floor(random() * 4), kind = random() < 0.15 ? 2 : random() < 0.55 ? 1 : 0;
    const [w, h] = kind === 1 ? [9 + random() * 7, 34 + random() * 40] : kind === 0 ? [22 + random() * 16, 12 + random() * 10] : [26 + random() * 12, 16 + random() * 10];
    const across = face % 2 === 0 ? tower.w : tower.d, out = (face % 2 === 0 ? tower.d : tower.w) / 2 + 0.5;
    const along = (random() - 0.5) * Math.max(0, across - w), y = h / 2 + 6 + random() * Math.max(0, tower.h - h - 12);
    const angle = face * Math.PI / 2;
    dummy.position.set(tower.x + Math.sin(angle) * out + Math.cos(angle) * along, y, tower.z + Math.cos(angle) * out - Math.sin(angle) * along);
    dummy.rotation.set(0, angle, 0); dummy.scale.set(w, h, 1); dummy.updateMatrix(); signMesh.setMatrixAt(i, dummy.matrix);
    signData.set([random(), random(), kind, Math.floor(random() * SIGN_COLOURS.length)], i * 4);
  }
  dummy.rotation.set(0, 0, 0);
  const sign = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(signData, 4), 'vec4');
  const signMaterial = signMesh.material as THREE.MeshBasicNodeMaterial;
  const s = uv(), edge = s.sub(0.5).abs(), border = max(edge.x, edge.y);
  const frame = border.smoothstep(0.42, 0.47).mul(border.smoothstep(0.5, 0.48));
  // Snares change what a third of the signs show; the rest keep their logo.
  const changes = fract(sign.x.mul(7.7)).lessThan(0.35).select(content, float(0));
  const glyphGrid = sign.z.equal(1).select(vec2(2, 10), vec2(10, 3));
  const glyphCell = s.mul(0.8).add(0.1).mul(glyphGrid).floor();
  const glyph = hash2(glyphCell.add(sign.x.mul(53).add(changes.mul(17.3)))).lessThan(0.5).select(float(1), float(0)).mul(edge.x.lessThan(0.38).select(float(1), float(0))).mul(edge.y.lessThan(0.38).select(float(1), float(0)));
  // Video screens: a face-sized gradient picture with scanlines.
  const picture = mx_noise_float(vec3(s.mul(vec2(3, 2)), time.mul(0.3).add(sign.x.mul(9)).add(changes))).mul(0.5).add(0.5);
  const screen = picture.mul(sin(s.y.mul(140)).mul(0.15).add(0.85)).add(frame);
  const shape = sign.z.equal(2).select(screen, frame.add(glyph.mul(0.85)).add(0.12));
  let colour: Node<'vec3'> = vec3(...SIGN_COLOURS[0] as [number, number, number]);
  SIGN_COLOURS.forEach((rgb, k) => { if (k) colour = sign.w.equal(k).select(vec3(rgb[0], rgb[1], rgb[2]), colour); });
  const screenColour = mix(colour, vec3(2.2, 2.4, 2.6), picture.smoothstep(0.6, 0.9));
  const hit = fract(sign.x.mul(13.7).add(beatSeed)).lessThan(0.35).select(beatLevel.mul(1.8), float(0));
  const signEnergy = spectrumAxisNode(spectrum.texture, sign.y, logMapping, nyquist);
  signMaterial.colorNode = mix(sign.z.equal(2).select(screenColour, colour).mul(shape).mul(signEnergy.mul(1.2).add(0.5).add(hit).mul(signGain)), HAZE.mul(3), haze(0.8));
  signMaterial.side = THREE.DoubleSide;
  scene.add(signMesh);

  // Holographic rings over the tallest roofs: dashed bands of light, single or stacked, turning slowly.
  const ringMaterials = [vec3(0.2, 1.8, 2.6), vec3(2.4, 0.4, 2.0)].map((tone) => {
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const around = uv().x, dashes = fract(around.mul(36)).smoothstep(0.1, 0.25).mul(fract(around.mul(36)).smoothstep(0.9, 0.75));
    const band = uv().y.sub(0.5).abs().smoothstep(0.5, 0.1);
    material.colorNode = tone.mul(dashes.mul(0.7).add(0.3)).mul(band).mul(beatLevel.mul(1.2).add(1.2));
    return material;
  });
  const ringGeometry = new THREE.CylinderGeometry(1, 1, 1, 96, 1, true);
  const rings = tall.slice(0, Math.round(10 * Math.max(0.5, Math.min(1, scale)))).flatMap((tower, i) => {
    const stack = i % 3 === 0 ? 3 : i % 3 === 1 ? 1 : 2;
    return Array.from({ length: stack }, (_, k) => {
      const ring = new THREE.Mesh(ringGeometry, ringMaterials[(i + k) % 2]);
      const radius = Math.max(tower.w, tower.d) * (1.8 + k * 0.6);
      ring.position.set(tower.x, tower.h + 22 + k * 12, tower.z); ring.scale.set(radius, 2.4, radius);
      ring.rotation.set((random() - 0.5) * 0.25, 0, (random() - 0.5) * 0.25);
      ring.userData = { radius, spin: (random() - 0.5) * 0.6 };
      scene.add(ring); return ring;
    });
  });

  // Elevated roads: curves across the city carrying red tail lights one way and white headlights the other.
  const roadMaterials = ([[vec3(3, 0.12, 0.1), 1], [vec3(2.2, 2.2, 2.6), -1]] as const).map(([tone, direction]) => {
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const along = uv().x.mul(attribute<'float'>('roadLength').div(30));
    const head = fract(along.add(traffic.mul(direction)).add(hash2(vec2(along.floor(), 3.1))));
    const streak = head.smoothstep(float(1).sub(trailLength), float(1));
    material.colorNode = tone.mul(streak.mul(1.3).add(0.12)).mul(haze(0.7).oneMinus());
    return material;
  });
  for (let r = 0; r < 7; r++) {
    const points = [], start = new THREE.Vector3((random() - 0.5) * extent, 0, -extent * 0.7), end = new THREE.Vector3((random() - 0.5) * extent, 0, extent * 0.7);
    if (r % 2) { start.set(-extent * 0.7, 0, (random() - 0.5) * extent); end.set(extent * 0.7, 0, (random() - 0.5) * extent); }
    const height = 8 + random() * 30;
    for (let k = 0; k <= 6; k++) {
      const t = k / 6, p = start.clone().lerp(end, t);
      p.x += (random() - 0.5) * 140; p.z += (random() - 0.5) * 140; p.y = height + Math.sin(t * Math.PI) * 20;
      points.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(points), length = curve.getLength();
    roadMaterials.forEach((material, lane) => {
      const geometry = new THREE.TubeGeometry(curve, 240, 0.9, 4, false);
      geometry.setAttribute('roadLength', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(length), 1));
      const road = new THREE.Mesh(geometry, material); road.position.x = lane * 2.4; scene.add(road);
    });
  }

  // Haze layers between height bands, and fine rain.
  for (const [y, strength] of [[30, 0.5], [95, 0.35], [170, 0.25]] as const) {
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const n = mx_noise_float(vec3(uv().mul(5).add(time.mul(0.004)), y)).mul(0.5).add(0.5);
    material.colorNode = vec3(0.02, 0.06, 0.1).mul(n.smoothstep(0.35, 0.9)).mul(strength).mul(bass.mul(0.4).add(1));
    const slab = new THREE.Mesh(new THREE.PlaneGeometry(extent * 2, extent * 2), material); slab.rotation.x = -Math.PI / 2; slab.position.y = y;
    scene.add(slab);
  }
  const drops = Math.round(3000 * scale), rain = new Float32Array(drops * 6), tails = new Float32Array(drops * 2);
  for (let i = 0; i < drops; i++) {
    const x = (random() - 0.5) * 500, y = random() * 400, z = (random() - 0.5) * 500;
    rain.set([x, y, z, x, y, z], i * 6); tails[i * 2 + 1] = 1;
  }
  const rainGeometry = new THREE.BufferGeometry();
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(rain, 3)); rainGeometry.setAttribute('tail', new THREE.BufferAttribute(tails, 1));
  const rainMaterial = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const fall = uniform(0), rainAmount = uniform(0.3), focus = uniform(new THREE.Vector3());
  const dropY = positionLocal.y.sub(fall).mod(400);
  rainMaterial.positionNode = vec3(positionLocal.x.add(focus.x), dropY.add(attribute<'float'>('tail').mul(3)), positionLocal.z.add(focus.z));
  rainMaterial.colorNode = vec3(0.25, 0.35, 0.45).mul(fract(positionLocal.x.mul(0.37)).lessThan(rainAmount).select(float(1), float(0)));
  const rainLines = new THREE.LineSegments(rainGeometry, rainMaterial); rainLines.frustumCulled = false; scene.add(rainLines);

  const hits = createHits({ decay: 0.35, interval: 0.2 });
  let orbit = 0, wander = 0, pulse = 0, flow = 0, rainPhase = 0, pace = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(perspective, frame.aspect);
      spectrum.update(frame.audio.spectrum);
      logMapping.value = frame.spectrumMapping === 'log' ? 1 : 0; nyquist.value = frame.sampleRate / 2;
      time.value = frame.time;
      const step = settleStep(frame), motion = frame.reducedMotion ? 0 : frame.delta, { loudness } = frame.response;
      bass.value = approach(bass.value, frame.response.bass, step, 0.1);
      pace = approach(pace, drive(frame), step, 0.3);
      hits.update(frame, 0.1);
      if (hits.fired) {
        if (isSnare(frame)) content.value += 1;
        else { beatSeed.value = (beatSeed.value + 0.618) % 1; pulse = 1; }
      }
      beatLevel.value = hits.flash;
      // Kicks push the rings outward and they ease back.
      pulse = Math.max(0, pulse - step * 2.5);
      for (const ring of rings) {
        const grow = ring.userData.radius * (1 + pulse * 0.25 * (frame.reducedFlash ? 0.6 : 1) + pace * 0.05);
        ring.scale.set(grow, 2.4, grow); ring.rotation.y += motion * ring.userData.spin * (1 + pace * 2);
      }
      // Bass speeds the traffic and lengthens its trails.
      flow += motion * (0.25 + bass.value * 0.9 + pace * 0.3); traffic.value = flow;
      trailLength.value = approach(trailLength.value, 0.25 + bass.value * 0.5, step, 0.2);
      sparkle.value = approach(sparkle.value, frame.audio.highs, step, 0.1);
      signGain.value = approach(signGain.value, 0.6 + loudness * 0.8, step, 0.2);
      rainAmount.value = approach(rainAmount.value, 0.15 + frame.audio.highs * 0.6, step, 0.3);
      rainPhase += motion * (120 + pace * 80); fall.value = rainPhase;
      // High above, looking down at about 55°: a very slow orbit and a slow wander between districts.
      orbit += motion * (0.012 + pace * 0.01); wander += motion * 0.01;
      const target = new THREE.Vector3(Math.sin(wander * 1.3) * 120, 0, Math.cos(wander) * 100);
      const distance = 430, elevation = 0.7;
      perspective.position.set(target.x + Math.sin(orbit) * Math.cos(elevation) * distance, Math.sin(elevation) * distance, target.z + Math.cos(orbit) * Math.cos(elevation) * distance);
      perspective.lookAt(target);
      focus.value.set(perspective.position.x * 0.6 + target.x * 0.4, 0, perspective.position.z * 0.6 + target.z * 0.4);
    },
    dispose() { disposeScene(scene); spectrum.dispose(); },
  };
}
