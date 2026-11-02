import * as THREE from 'three/webgpu';
import { abs, float, fract, instancedBufferAttribute, mix, normalLocal, normalWorld, positionLocal, positionWorld, sin, uniform, uv, vec2, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { seededRandom } from '../rendering/diagnostics';
import type { QualityBudget } from '../rendering/quality';

export const AKIRA_DISTRICTS = {
  'jade megacity': { sky: 0x020811, haze: 0x0b242d, primary: 0x45ffd1, accent: 0xc4ed48, lift: 0 },
  'amber downtown': { sky: 0x19050e, haze: 0x421322, primary: 0xffa94b, accent: 0xff3366, lift: 0 },
  'violet arcade': { sky: 0x09031e, haze: 0x221333, primary: 0x9671ff, accent: 0xff4edb, lift: 0 },
  'cyan skyway': { sky: 0x020c21, haze: 0x123043, primary: 0x4ae8ff, accent: 0x577bff, lift: -22 },
  'red reactor': { sky: 0x22050a, haze: 0x4c121a, primary: 0xff6041, accent: 0xffbe55, lift: 0 },
  'harbor lights': { sky: 0x020918, haze: 0x0c233b, primary: 0x55afff, accent: 0x64ffd0, lift: -5 },
} as const;
export type AkiraDistrict = keyof typeof AKIRA_DISTRICTS;

/** Scrolling geometry and facade detail share one travel coordinate, including rooftop furniture. */
export function createAkiraCity(scene: THREE.Scene, budget: QualityBudget) {
  const random = seededRandom(61101), travel = uniform(0), clock = uniform(0), energy = uniform(0.3);
  const primary = uniform(new THREE.Color()), accent = uniform(new THREE.Color());
  const skyLow = uniform(new THREE.Color()), skyHigh = uniform(new THREE.Color());
  const fog = new THREE.FogExp2(0x0b242d, 0.0045); scene.fog = fog;
  const city = new THREE.Group(); city.name = 'Neo Tokyo / layered megacity'; scene.add(city);
  const box = new THREE.BoxGeometry(1, 1, 1), dummy = new THREE.Object3D();
  const polygon = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  const count = budget.preset === 'compatibility' ? 150 : 230;
  const blocks = Array.from({ length: count }, (_, i) => {
    const lane = i < 50 ? 0 : i < 100 ? 1 : 2;
    const height = lane === 0 ? 13 + random() * 48 : 35 + random() ** 0.7 * 135;
    return { x: (i % 2 ? -1 : 1) * (12 + lane * 26 + random() * (lane ? 45 : 10)),
      z: -190 + random() * 380, h: height, w: 5 + random() * (lane ? 17 : 7), d: 5 + random() * 12,
      tint: random(), phase: random() * 6.28, round: i % 4 === 0 };
  });
  const facade = (rounded: boolean) => {
    const items = blocks.filter(b => b.round === rounded);
    const data = new Float32Array(items.length * 4);
    items.forEach((b, i) => data.set([b.z, b.d, b.tint, b.phase], i * 4));
    const seed = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(data, 4), 'vec4');
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionLocal.add(vec3(0, 0, fract(seed.x.add(travel).add(200).div(400)).mul(400).sub(200).sub(seed.x).div(seed.y)));
    const p = vec2(abs(normalLocal.x).greaterThan(0.5).select(positionWorld.z.sub(travel), positionWorld.x), positionWorld.y);
    const grid = vec2(p.x.mul(2.2), p.y.mul(3.0)), cell = grid.floor(), pane = fract(grid);
    const hash = fract(sin(cell.x.mul(127.1).add(cell.y.mul(311.7)).add(seed.w)).mul(43758.5453));
    const panes = pane.x.smoothstep(0.13, 0.21).mul(pane.x.smoothstep(0.9, 0.8))
      .mul(pane.y.smoothstep(0.16, 0.24)).mul(pane.y.smoothstep(0.77, 0.65))
      .mul(hash.greaterThan(0.48).select(float(1), float(0.04)));
    const strips = pane.y.smoothstep(0.56, 0.65).mul(pane.y.smoothstep(0.94, 0.85))
      .mul(hash.greaterThan(0.18).select(float(1), float(0.15)));
    const columns = pane.x.smoothstep(0.18, 0.27).mul(pane.x.smoothstep(0.53, 0.43))
      .mul(pane.y.smoothstep(0.06, 0.12)).mul(pane.y.smoothstep(0.93, 0.85));
    const style = fract(seed.w);
    const windows = style.lessThan(0.38).select(strips, style.greaterThan(0.78).select(columns, panes));
    const bands = fract(p.y.mul(0.23).add(seed.z)).smoothstep(0.93, 0.98);
    const ribs = fract(p.x.mul(0.21)).smoothstep(0.96, 0.99).mul(0.09);
    const color = mix(mix(primary, accent, seed.z), vec3(1, 0.72, 0.38), seed.z.smoothstep(0.8, 1).mul(0.6));
    const shimmer = sin(clock.mul(0.6).add(seed.w)).mul(0.055).add(0.92).add(energy.mul(0.16));
    material.colorNode = vec3(0.014, 0.026, 0.048).mul(normalWorld.y.mul(0.35).add(0.8))
      .add(color.mul(windows.mul(seed.z.mul(0.65).add(0.35)).add(bands.mul(1.6)).add(ribs)).mul(shimmer));
    const towers = new THREE.InstancedMesh(rounded ? polygon : box, material, items.length);
    towers.name = rounded ? 'octagonal neon towers' : 'tiered neon towers'; towers.frustumCulled = false;
    items.forEach((b, i) => {
      dummy.position.set(b.x, b.h / 2, b.z); dummy.scale.set(b.w, b.h, b.d); dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix(); towers.setMatrixAt(i, dummy.matrix);
    });
    city.add(towers);
    // Smaller crowns make the silhouette stepped, rather than a field of plain boxes.
    const crown = new THREE.InstancedMesh(rounded ? polygon : box, material, items.length);
    crown.name = 'recessed illuminated crowns'; crown.frustumCulled = false;
    items.forEach((b, i) => {
      dummy.position.set(b.x, b.h + b.h * 0.1, b.z); dummy.scale.set(b.w * 0.7, b.h * 0.2, b.d);
      dummy.updateMatrix(); crown.setMatrixAt(i, dummy.matrix);
    }); city.add(crown);
  };
  facade(false); facade(true);

  const sky = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, fog: false, depthWrite: false });
  sky.colorNode = mix(skyLow, skyHigh, positionLocal.y.div(460).max(0).smoothstep(0, 0.6));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(460, 32, 20), sky));
  const dark = new THREE.MeshBasicNodeMaterial({ color: 0x101b2d });
  const glow = new THREE.MeshBasicNodeMaterial(); glow.colorNode = primary.mul(1.3).mul(energy.mul(0.15).add(0.85));
  const hot = new THREE.MeshBasicNodeMaterial(); hot.colorNode = accent.mul(1.5);
  const addBox = (group: THREE.Group, mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) => {
    const mesh = new THREE.Mesh(box, mat); mesh.position.set(x, y, z); mesh.scale.set(w, h, d); group.add(mesh);
  };
  const street = new THREE.Group(); street.name = 'moving street furniture'; scene.add(street);
  const arcade = new THREE.Group(); arcade.name = 'arcade / overhead neon galleries'; scene.add(arcade);
  const reactor = new THREE.Group(); reactor.name = 'reactor / industrial gantries'; scene.add(reactor);
  const skyway = new THREE.Group(); skyway.name = 'skyway / open skyline railings'; scene.add(skyway);
  const harbor = new THREE.Group(); harbor.name = 'harbor / luminous docks'; scene.add(harbor);
  for (let i = 0; i < 22; i++) {
    const z = -132 + i * 12;
    for (const side of [-1, 1]) {
      addBox(street, dark, side * 7.8, 2.3, z, 0.12, 4.6, 0.16);
      addBox(street, glow, side * 7.35, 4.6, z, 1.1, 0.07, 0.16);
      addBox(street, hot, side * 7.8, 0.5, z, 0.25, 0.15, 0.5);
      // Tall, irregular sign stacks at eye level and up the building canyon.
      addBox(street, dark, side * 10, 7 + i % 4 * 4, z + 3, 0.32, 4.2, 1.8);
      for (let k = 0; k < 5; k++) {
        addBox(street, i % 2 ? glow : hot, side * 9.8, 5.5 + i % 4 * 4 + k * 0.65, z + 3, 0.04, 0.12, 1.2);
        addBox(street, i % 2 ? glow : hot, side * 9.77, 5.65 + i % 4 * 4 + k * 0.65, z + 3 + (k % 2 ? 0.35 : -0.35), 0.05, 0.36, 0.12);
      }
      addBox(skyway, dark, side * 7.2, 0.48, z, 0.22, 0.95, 12);
      addBox(skyway, glow, side * 7.2, 1.02, z, 0.08, 0.06, 12);
      addBox(harbor, dark, side * 14, -1.5, z, 6, 3, 9);
      addBox(harbor, glow, side * 14, 0.03, z, 6, 0.07, 0.16);
    }
    if (i % 2 === 0) {
      addBox(arcade, dark, 0, 7, z, 24, 0.35, 1.5);
      addBox(arcade, hot, 0, 6.78, z - 0.8, 22, 0.12, 0.08);
      for (const x of [-10, 10]) { addBox(arcade, dark, x, 3.5, z, 0.4, 7, 0.5); addBox(arcade, glow, x, 3.5, z - 0.3, 0.09, 6.5, 0.08); }
      addBox(reactor, dark, 0, 11, z, 27, 0.9, 2);
      for (const x of [-11, 11]) { addBox(reactor, dark, x, 5.5, z, 1, 11, 1); addBox(reactor, hot, x * 0.96, 5.5, z - 0.6, 0.1, 10, 0.1); }
      for (let k = -3; k <= 3; k++) addBox(reactor, hot, k * 3, 10.5, z - 1.1, 1.2, 0.2, 0.1);
    }
  }
  // Merge architecture by material so the city doesn't cost hundreds of draw calls.
  for (const group of [street, arcade, reactor, skyway, harbor]) {
    const batches = new Map<THREE.Material, THREE.BufferGeometry[]>(); group.updateMatrixWorld(true);
    for (const child of [...group.children]) {
      const mesh = child as THREE.Mesh, material = mesh.material as THREE.Material;
      const parts = batches.get(material) ?? []; batches.set(material, parts);
      parts.push(mesh.geometry.clone().applyMatrix4(mesh.matrix)); group.remove(mesh);
    }
    for (const [material, parts] of batches) { group.add(new THREE.Mesh(mergeGeometries(parts)!, material)); parts.forEach(g => g.dispose()); }
  }

  const roadMaterial = new THREE.MeshBasicNodeMaterial();
  const p = positionWorld.xz, z = p.y.sub(travel), grain = fract(sin(p.x.mul(163).add(z.mul(47))).mul(43758));
  const lane = abs(abs(p.x).sub(2.5)).smoothstep(0.065, 0.025).mul(fract(z.div(6)).lessThan(0.45).select(float(1), float(0)));
  const verge = abs(abs(p.x).sub(6.9)).smoothstep(0.09, 0.025);
  const ripple = sin(z.mul(4).add(sin(p.x.mul(21)))).mul(0.16).add(0.84);
  const pools = fract(p.x.mul(0.46).add(sin(p.x.mul(2)).mul(0.15))).smoothstep(0.45, 0.8).mul(0.075).mul(abs(p.x).smoothstep(0, 6));
  roadMaterial.colorNode = vec3(0.009, 0.016, 0.027).mul(grain.mul(0.4).add(0.8))
    .add(vec3(0.45, 0.7, 0.75).mul(lane.mul(0.4)))
    .add(mix(primary, accent, sin(p.x.mul(0.8)).mul(0.5).add(0.5)).mul(pools.mul(ripple).add(verge.mul(0.6))));
  const road = new THREE.Mesh(new THREE.PlaneGeometry(16, 430), roadMaterial); road.rotation.x = -Math.PI / 2; road.position.y = -0.013; scene.add(road);
  const waterMaterial = new THREE.MeshBasicNodeMaterial();
  waterMaterial.colorNode = mix(primary, accent, sin(p.x.mul(0.4)).mul(0.5).add(0.5)).mul(sin(p.y.mul(13).add(clock)).mul(0.5).add(0.5)).mul(0.065);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(370, 420), waterMaterial); water.rotation.x = -Math.PI / 2; water.position.y = -2; scene.add(water);

  // Soft rooftop searchlights, rotating independently through the haze.
  const beamMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  beamMaterial.colorNode = mix(primary, vec3(1, 0.86, 0.65), 0.6).mul(1.8);
  beamMaterial.opacityNode = uv().y.pow(1.8).mul(0.08);
  const beamGeometry = new THREE.ConeGeometry(11, 115, 20, 1, true); beamGeometry.translate(0, -57.5, 0); beamGeometry.rotateZ(Math.PI);
  const beams: THREE.Mesh[] = [];
  for (let i = 0; i < 10; i++) {
    const roof = blocks[i * 3 + 1];
    const beam = new THREE.Mesh(beamGeometry, beamMaterial); beam.position.set(roof.x, roof.h * 1.2 + 0.05, roof.z);
    city.add(beam); beams.push(beam);
  }
  let district: AkiraDistrict = 'jade megacity';
  const setDistrict = (name: AkiraDistrict) => {
    district = name; const palette = AKIRA_DISTRICTS[name];
    primary.value.setHex(palette.primary); accent.value.setHex(palette.accent);
    skyLow.value.setHex(palette.haze); skyHigh.value.setHex(palette.sky); fog.color.setHex(palette.haze);
    city.position.y = palette.lift; fog.density = name === 'red reactor' ? 0.0055 : 0.0045;
    arcade.visible = name === 'violet arcade'; reactor.visible = name === 'red reactor';
    skyway.visible = name === 'cyan skyway' || name === 'harbor lights'; harbor.visible = water.visible = name === 'harbor lights';
  };
  setDistrict(district);
  return { primary, accent, energy, clock, travel, setDistrict,
    update(dt: number, velocity: number) {
      clock.value += dt; travel.value -= dt * velocity;
      // Keep this unwrapped: repeating it at a non-shared period would visibly jump road and buildings.
      street.position.z = ((travel.value % 12) + 12) % 12;
      arcade.position.z = reactor.position.z = ((travel.value % 24) + 24) % 24;
      skyway.position.z = harbor.position.z = street.position.z;
      beams.forEach((beam, i) => {
        beam.position.z = THREE.MathUtils.euclideanModulo(blocks[i * 3 + 1].z + travel.value + 200, 400) - 200;
        beam.rotation.set(Math.sin(clock.value * 0.12 + i) * 0.35, 0, Math.sin(clock.value * 0.17 + i * 1.8) * 0.5);
      });
    },
  };
}
