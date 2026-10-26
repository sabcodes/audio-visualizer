import * as THREE from 'three/webgpu';
import { attribute, float, mix, mx_fractal_noise_float, normalize, positionLocal, positionWorld, uniform, uv, vec2, vec3, vec4, dot } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { seededRandom } from '../rendering/diagnostics';
import { createParticles, loadTexture } from './figures';
import { sceneDefaults } from './shared';
import emberUrl from '../assets/fx/ember.png?url';
import smokeUrl from '../assets/fx/smoke.png?url';

const SPAN = 440;
const hash = (x: number, y: number, z: number) => { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); };
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Value noise in 0–1. */
function noise(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = smooth(x - ix), fy = smooth(y - iy), fz = smooth(z - iz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const corner = (dx: number, dy: number, dz: number) => hash(ix + dx, iy + dy, iz + dz);
  return lerp(lerp(lerp(corner(0, 0, 0), corner(1, 0, 0), fx), lerp(corner(0, 1, 0), corner(1, 1, 0), fx), fy),
    lerp(lerp(corner(0, 0, 1), corner(1, 0, 1), fx), lerp(corner(0, 1, 1), corner(1, 1, 1), fx), fy), fz);
}
const fbm = (x: number, y: number, z: number) => noise(x, y, z) * 0.6 + noise(x * 2.1, y * 2.1, z * 2.1) * 0.3 + noise(x * 4.3, y * 4.3, z * 4.3) * 0.1;

const ROCK = [new THREE.Color(0x4a3628), new THREE.Color(0x6e5440), new THREE.Color(0x9a7a5c)];
const MOSS = [new THREE.Color(0x2d4a14), new THREE.Color(0x4f6b1c), new THREE.Color(0x7a8a24)];
const BARK = new THREE.Color(0x3a2a1c);

/**
 * Faceted, flat-shaded copy of a geometry with a colour per face and a lava mask per vertex:
 * `paint` returns the face colour and how much lava glows through it.
 */
function facet(source: THREE.BufferGeometry, paint: (normal: THREE.Vector3, centre: THREE.Vector3) => { colour: THREE.Color; lava: number }) {
  const geometry = source.toNonIndexed();
  geometry.deleteAttribute('uv');
  geometry.computeVertexNormals();
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  const colours = new Float32Array(position.count * 3), lava = new Float32Array(position.count);
  const n = new THREE.Vector3(), c = new THREE.Vector3(), tmp = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 3) {
    n.fromBufferAttribute(normal, i);
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.add(tmp.fromBufferAttribute(position, i + k));
    c.multiplyScalar(1 / 3);
    const { colour, lava: mask } = paint(n, c);
    for (let k = 0; k < 3; k++) { colours.set([colour.r, colour.g, colour.b], (i + k) * 3); lava[i + k] = mask; }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.setAttribute('lava', new THREE.BufferAttribute(lava, 1));
  return geometry;
}

const mixed = (palette: THREE.Color[], t: number) => { const s = Math.min(0.999, Math.max(0, t)) * (palette.length - 1), k = Math.floor(s); return palette[k].clone().lerp(palette[k + 1], s - k); };

/** A chunk of rock: an island (flat mossy top, tapering underside) or a cliff block (tall, rough, mossy ledges). */
function rockChunk(seed: number, rx: number, ry: number, rz: number, island: boolean, detail = 3) {
  const base = new THREE.IcosahedronGeometry(1, detail), position = base.getAttribute('position'), v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).normalize();
    const rough = (fbm(v.x * 2 + seed, v.y * 2, v.z * 2) - 0.5) * (island ? 0.55 : 0.8);
    let { x, y, z } = v;
    if (island) {
      if (y > 0) y *= 0.14;
      else { const s = 0.2 + 0.8 * (1 + y) ** 1.4; x *= s; z *= s; y *= 1.15; }
    }
    const k = 1 + rough;
    position.setXYZ(i, x * rx * k, y * ry * (island && y > 0 ? 1 : k), z * rz * k);
  }
  return facet(base, (normal, centre) => {
    const grain = fbm(centre.x * 0.15 + seed, centre.y * 0.15, centre.z * 0.15);
    const mossy = normal.y > (island ? 0.3 : 0.5) && grain > 0.28;
    if (mossy) return { colour: mixed(MOSS, grain * 1.6 - 0.3), lava: 0 };
    return { colour: mixed(ROCK, grain * 1.4 - 0.2), lava: island ? Math.min(1, Math.max(0.15, 0.6 - normal.y)) : centre.y < 0 ? 0.35 : 0 };
  });
}

function tree(seed: number, scale: number) {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.22 * scale, 0.45 * scale, 4.2 * scale, 6, 1).translate(0, 2.1 * scale, 0);
  parts.push(facet(trunk, () => ({ colour: BARK, lava: 0 })));
  for (let k = 0; k < 4; k++) {
    const blob = new THREE.IcosahedronGeometry(1, 1), p = blob.getAttribute('position'), v = new THREE.Vector3();
    const ox = (hash(seed, k, 1) - 0.5) * 3.2 * scale, oz = (hash(seed, k, 2) - 0.5) * 3.2 * scale, oy = (4 + hash(seed, k, 3) * 1.4) * scale;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const j = 1 + (hash(v.x * 9 + seed, v.y * 9, v.z * 9 + k) - 0.5) * 0.45;
      p.setXYZ(i, v.x * 2.4 * scale * j + ox, v.y * 1.5 * scale * j + oy, v.z * 2.4 * scale * j + oz);
    }
    parts.push(facet(blob, (normal) => ({ colour: mixed(MOSS, 0.2 + normal.y * 0.6 + hash(seed, k, 5) * 0.3), lava: 0 })));
  }
  return mergeGeometries(parts)!;
}

function vine(length: number) {
  return facet(new THREE.CylinderGeometry(0.09, 0.02, length, 4, 1).translate(0, -length / 2, 0), () => ({ colour: MOSS[0], lava: 0 }));
}

/**
 * The stormy canyon of floating islands: a smoke-and-sun sky, cliff walls either side, glowing-vein rock islands
 * with mossy tops, trees, vines and waterfalls drifting past, rock debris, embers and smoke plumes.
 * Everything is built in code, so there are no model files. The world streams toward -Z so a flyer facing +Z flies down it.
 */
export function createStormCanyon() {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).far = 1500;
  scene.fog = new THREE.Fog(0x3d3733, 30, 280);
  const time = uniform(0), travel = uniform(0), glow = uniform(0);

  // Sky: a bright gap near the sun, smoke thickening toward the zenith.
  const sky = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  const dir = normalize(positionLocal), sunDir = normalize(vec3(0.25, 0.28, -1));
  const smoke = mx_fractal_noise_float(vec3(dir.x.mul(2.4), dir.y.mul(3.2), dir.z.mul(2.4).add(time.mul(0.012))), 4, 2, 0.5).mul(0.5).add(0.5);
  const sun = dot(dir, sunDir).max(0);
  const bright = vec3(0.86, 0.74, 0.55).mul(sun.pow(3).mul(1.1).add(0.3)).add(vec3(1, 0.8, 0.5).mul(sun.pow(60)));
  const dark = vec3(0.045, 0.045, 0.05);
  sky.colorNode = mix(bright, dark, smoke.add(dir.y.mul(0.6)).smoothstep(0.3, 0.7)).mul(dir.y.smoothstep(-0.25, 0.05).mul(0.7).add(0.3)).mul(glow.mul(0.25).add(1));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(900, 40, 20), sky));

  // The abyss: a murky smoke floor with embers glowing through it.
  const floorMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const fp = positionWorld.xz.add(vec2(0, travel));
  const puff = mx_fractal_noise_float(vec3(fp.mul(0.02), time.mul(0.03)), 4, 2, 0.5).mul(0.5).add(0.5);
  const embers = mx_fractal_noise_float(vec3(fp.mul(0.05), time.mul(0.05)), 3, 2, 0.5).abs().oneMinus().pow(12);
  floorMaterial.colorNode = vec3(0.035, 0.032, 0.032).add(vec3(1, 0.32, 0.06).mul(embers).mul(glow.mul(0.6).add(0.5)).mul(0.5));
  floorMaterial.opacityNode = puff.smoothstep(0.3, 0.7).mul(0.4).add(0.4);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800), floorMaterial);
  floor.rotation.x = -Math.PI / 2; floor.position.y = -75;
  scene.add(floor);

  // Rock: vertex colours for moss and stone; emissive veins of lava that pulse with the music.
  const rockMaterial = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const vein = mx_fractal_noise_float(positionLocal.mul(0.3), 3, 2, 0.5).abs().mul(16).oneMinus().max(0).pow(3);
  rockMaterial.emissiveNode = vec3(1, 0.3, 0.05).mul(attribute('lava', 'float')).mul(vein).mul(glow.mul(2.2).add(0.7)).mul(1.3);
  const fallMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const streak = mx_fractal_noise_float(vec3(uv().x.mul(5), uv().y.mul(14).add(time.mul(-1.6)), 0), 3, 2, 0.5).mul(0.5).add(0.5);
  fallMaterial.colorNode = vec3(0.85, 0.92, 0.95);
  fallMaterial.opacityNode = streak.smoothstep(0.35, 0.8).mul(uv().x.sub(0.5).abs().mul(2).oneMinus().smoothstep(0, 0.5)).mul(uv().y.smoothstep(0, 0.12)).mul(0.65);

  const moving: THREE.Object3D[] = [], random = seededRandom(31);
  const add = (object: THREE.Object3D, x: number, y: number, z: number) => { object.position.set(x, y, z); moving.push(object); scene.add(object); return object; };

  // Cliff walls either side of the flight line, with tall mossy blocks and far, hazier ridges behind them.
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < 11; k++) {
      const far = k % 3 === 2, height = 90 + random() * 80, width = 14 + random() * 14;
      const mesh = new THREE.Mesh(rockChunk(k * 7 + side * 3, width, height, 22 + random() * 18, false, 3), rockMaterial);
      mesh.rotation.y = random() * Math.PI;
      add(mesh, side * ((far ? 150 : 82) + random() * 26), -30 + random() * 40, (k / 11) * SPAN - SPAN / 2 + random() * 20);
    }
  }

  // Floating islands, kept clear of the flight line.
  const falls = new THREE.PlaneGeometry(2.2, 32, 1, 1).translate(0, -16, 0);
  for (let k = 0; k < 13; k++) {
    const radius = 5 + random() * 6, group = new THREE.Group();
    const parts: THREE.BufferGeometry[] = [rockChunk(k * 13 + 1, radius * 1.25, radius * 1.5, radius * 1.25, true, 3)];
    for (let t = 0, trees = 1 + Math.floor(random() * 3); t < trees; t++) {
      const a = random() * Math.PI * 2, d = random() * radius * 0.7, shape = tree(k * 5 + t, 0.8 + random() * 1.1);
      shape.translate(Math.cos(a) * d, radius * 0.08, Math.sin(a) * d); parts.push(shape);
    }
    for (let t = 0; t < 7; t++) {
      const a = random() * Math.PI * 2, shape = vine(3 + random() * 9);
      shape.translate(Math.cos(a) * radius * 1.1, 0, Math.sin(a) * radius * 1.1); parts.push(shape);
    }
    group.add(new THREE.Mesh(mergeGeometries(parts)!, rockMaterial));
    if (k % 3 === 0) { const fall = new THREE.Mesh(falls, fallMaterial); fall.position.set(radius * 0.8, 0, radius * 0.3); group.add(fall); }
    const side = k % 2 ? 1 : -1;
    group.rotation.y = random() * Math.PI * 2;
    add(group, side * (28 + random() * 36), -45 + random() * 55, (k / 13) * SPAN - SPAN / 2);
  }
  // Loose debris tumbling between them.
  const debris = [0, 1, 2, 3].map((k) => rockChunk(k + 90, 1, 1.2, 0.9, false, 1));
  for (let k = 0; k < 46; k++) {
    const piece = new THREE.Mesh(debris[k % 4], rockMaterial), s = 0.5 + random() * 2.2;
    piece.scale.setScalar(s); piece.rotation.set(random() * 6, random() * 6, random() * 6);
    const side = random() < 0.5 ? -1 : 1;
    add(piece, side * (16 + random() * 46), -25 + random() * 65, random() * SPAN - SPAN / 2);
  }

  // Light: a low warm sun through the gap behind the flyer, cool bounce from the smoke, a faint ember glow from below.
  const sunLight = new THREE.DirectionalLight(0xffcf99, 2.6); sunLight.position.set(25, 28, -100);
  const sky2 = new THREE.HemisphereLight(0xa8b0bb, 0x5a2e16, 1.7);
  const front = new THREE.DirectionalLight(0xaab0c0, 0.9); front.position.set(0, 8, 40);
  scene.add(sunLight, sky2, front);

  const sparks = createParticles(loadTexture(emberUrl), 700, { drag: 0.2, gravity: -1.2 });
  const plumes = createParticles(loadTexture(smokeUrl), 90, { drag: 0, gravity: 0, additive: false });
  scene.add(sparks.object, plumes.object);
  let sparkDebt = 0, plumeDebt = 0;

  return {
    scene, camera, time, glow,
    /** Moves the world past the flyer by `distance` metres this frame. */
    fly(distance: number) {
      travel.value += distance;
      for (const object of moving) {
        object.position.z -= distance;
        if (object.position.z < -SPAN / 2) object.position.z += SPAN;
      }
    },
    /** Embers drifting up the canyon and smoke plumes streaming by; `speed` is the world's speed in m/s. */
    update(delta: number, speed: number, loudness: number, flash: number, random: () => number) {
      sparkDebt += delta * (30 + loudness * 90 + flash * 160); plumeDebt += delta * 0.7;
      for (; sparkDebt >= 1; sparkDebt--) {
        const hot = random();
        sparks.emit((random() - 0.5) * 90, -30 + random() * 60, -30 + random() * 90, (random() - 0.5) * 2, 1 + random() * 3, -speed * (0.7 + random() * 0.3),
          2 + random() * 3, 0.12 + random() * 0.22, 1.8, 0.5 + hot * 0.5, 0.08 + hot * 0.1);
      }
      for (; plumeDebt >= 1; plumeDebt--) plumes.emit((random() - 0.5) * 120, 5 + random() * 60, 260, 0, 0.4, -speed, 16, 45 + random() * 40, 0.09, 0.085, 0.08);
      sparks.update(delta); plumes.update(delta);
    },
  };
}
