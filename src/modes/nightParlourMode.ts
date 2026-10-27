import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { abs, atan, attribute, float, fract, mix, mx_noise_float, normalize, positionLocal, positionWorld, sin, uniform, uv, vec2, vec3 } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { hash2 } from './shaderModes';
import { createHits, variantSequence } from './hitPulse';
import { isSnare } from './waveSixShared';
import { seededRandom } from '../rendering/diagnostics';
import { presetBudget, type QualityBudget } from '../rendering/quality';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/** Snare lamp patterns: both lamps, the fabric lamp alone, the stained-glass lamp alone. */
export const LAMP_PATTERNS = ['both', 'left', 'right'] as const;
/** Colour groups of the stained-glass shade, lit one at a time on snares: amber, green, teal, rose. */
export const GLASS_GROUPS: readonly (readonly [number, number, number])[] = [[1.0, 0.55, 0.12], [0.35, 0.8, 0.25], [0.15, 0.65, 0.7], [0.95, 0.3, 0.35]];
/** The room: x across (−W…W), z from the back wall (−D) toward the camera, y up. */
export const PARLOUR = { W: 4, D: 3, H: 3, window: { left: -1.7, right: 1.7, bottom: 0.85, top: 2.55, recess: 0.7 } } as const;

const rgb = (r: number, g: number, b: number) => vec3(r, g, b);
const fabric = (colour: V3, roughness = 0.85) => { const m = new THREE.MeshStandardNodeMaterial({ roughness }); m.colorNode = colour; return m; };
const plain = (hex: number, roughness = 0.7, metalness = 0) => new THREE.MeshStandardNodeMaterial({ color: hex, roughness, metalness });
const soft = (w: number, h: number, d: number, r = 0.06) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2) * 0.99);

/** A gramophone horn: a flaring lathe whose rim ripples into petals. */
export function hornGeometry() {
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24; profile.push(new THREE.Vector2(0.025 + Math.pow(t, 3.2) * 0.32, t * 0.62)); }
  const geometry = new THREE.LatheGeometry(profile, 64), p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), t = y / 0.62, a = Math.atan2(z, x);
    const petal = 1 + 0.12 * Math.pow(t, 3) * Math.cos(a * 8);
    p.setXYZ(i, x * petal, y - 0.04 * Math.pow(t, 3) * (1 - Math.abs(Math.cos(a * 8))), z * petal);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Night Parlour (wave 6, #1): a warm, cluttered old-fashioned living room at night, seen face-on from a low seat.
 * A big three-pane bay window shows a deep blue sky, stars and rooftops; cold moonlight falls through it in long
 * pane-shaped patches across a braided rug and two armchairs (a leather club chair with a knitted throw, a tall
 * floral wingback with its footstool). The rest is lit only by a fabric-shaded lamp, a stained-glass lamp and the
 * embers in the fireplace beside a petal-horned gramophone. Kicks flash the window (a soft lightning), snares pulse
 * the lamps in turn, bass stokes the fire, hats sparkle the dust in the beam, loudness lifts the warm side.
 */
export function createNightParlourMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  const perspective = camera as THREE.PerspectiveCamera;
  perspective.fov = 54; perspective.near = 0.05; perspective.far = 60;
  scene.background = new THREE.Color(0x000000);
  const random = seededRandom(1001);
  const { W, D, H } = PARLOUR, win = PARLOUR.window;
  const time = uniform(0), skyFlash = uniform(0), fire = uniform(0.5), lampLeft = uniform(0.6), lampRight = uniform(0.6), glassGroup = uniform(-1), glassPulse = uniform(0), dust = uniform(0.3);
  const add = <T extends THREE.Object3D>(object: T, x = 0, y = 0, z = 0, parent: THREE.Object3D = scene) => { object.position.set(x, y, z); parent.add(object); return object; };
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = scene) => {
    const m = new THREE.Mesh(geometry, material); m.castShadow = m.receiveShadow = true; return add(m, x, y, z, parent);
  };

  // --- The room shell: plank floor, damask wallpaper over a wainscot, a dark ceiling.
  const floorMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.55 });
  const plank = positionWorld.z.mul(6.5).floor(), plankHash = hash2(vec2(plank, 3.3));
  const grain = mx_noise_float(vec3(positionWorld.x.mul(0.6).add(plankHash.mul(30)), plank, positionWorld.z.mul(30))).mul(0.5).add(0.5);
  const seam = fract(positionWorld.z.mul(6.5)).smoothstep(0, 0.04).mul(fract(positionWorld.x.mul(0.8).add(plankHash.mul(5))).smoothstep(0, 0.01));
  floorMaterial.colorNode = rgb(0.2, 0.09, 0.04).mul(plankHash.mul(0.35).add(0.8)).mul(grain.mul(0.35).add(0.75)).mul(seam.mul(0.6).add(0.4));
  const floorMesh = mesh(new THREE.PlaneGeometry(W * 2, D * 2 + 2), floorMaterial, 0, 0, 1); floorMesh.rotation.x = -Math.PI / 2;
  const wallpaper = () => {
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
    const q = vec2(positionWorld.x.add(positionWorld.z), positionWorld.y).mul(3.2), cell = fract(q).sub(0.5);
    const petals = abs(sin(atan(cell.y, cell.x).mul(3))).mul(0.18).add(0.1);
    const motif = cell.length().smoothstep(petals.add(0.03), petals).add(abs(cell.x).add(abs(cell.y)).sub(0.48).abs().smoothstep(0.03, 0).mul(0.6));
    const fade = mx_noise_float(vec3(q.mul(0.3), 1)).mul(0.5).add(0.5);
    const base = mix(rgb(0.36, 0.27, 0.16), rgb(0.27, 0.18, 0.1), motif.mul(0.7)).mul(fade.mul(0.25).add(0.8));
    m.colorNode = positionWorld.y.lessThan(0.9).select(rgb(0.16, 0.08, 0.04).mul(fract(positionWorld.x.add(positionWorld.z).mul(1.2)).smoothstep(0, 0.03).mul(0.4).add(0.6)), base);
    return m;
  };
  const wallMaterial = wallpaper();
  const panel = (w: number, h: number, x: number, y: number, z: number, ry = 0) => { const m = mesh(new THREE.PlaneGeometry(w, h), wallMaterial, x, y, z); m.rotation.y = ry; return m; };
  // Back wall round the window opening.
  panel(W + win.left, H, (-W + win.left) / 2, H / 2, -D); panel(W - win.right, H, (W + win.right) / 2, H / 2, -D);
  panel(win.right - win.left, win.bottom, 0, win.bottom / 2, -D); panel(win.right - win.left, H - win.top, 0, (H + win.top) / 2, -D);
  panel(D * 2 + 2, H, -W, H / 2, 1, Math.PI / 2); panel(D * 2 + 2, H, W, H / 2, 1, -Math.PI / 2);
  const ceiling = mesh(new THREE.PlaneGeometry(W * 2, D * 2 + 2), plain(0x1a140e, 0.95), 0, H, 1); ceiling.rotation.x = Math.PI / 2;
  const trim = plain(0xd8d0c0, 0.6);
  mesh(new THREE.BoxGeometry(W * 2, 0.06, 0.04), plain(0x3a2010, 0.5), 0, 0.9, -D + 0.02);
  mesh(new THREE.BoxGeometry(W * 2, 0.12, 0.03), plain(0x2a160c, 0.6), 0, 0.06, -D + 0.015);

  // --- The bay window: a recess with three sashes (the side ones angled), sills, and the night outside.
  const recess = win.recess, sill = plain(0xcfc6b4, 0.55);
  mesh(new THREE.BoxGeometry(win.right - win.left + 0.2, 0.08, recess + 0.15), sill, 0, win.bottom, -D - recess / 2 + 0.07);
  mesh(new THREE.BoxGeometry(win.right - win.left, 0.06, recess), trim, 0, win.top, -D - recess / 2);
  for (const side of [-1, 1]) mesh(new THREE.BoxGeometry(0.06, win.top - win.bottom, recess), trim, side * (win.right - 0.03), (win.top + win.bottom) / 2, -D - recess / 2);
  const sash = (width: number, x: number, z: number, ry: number) => {
    const g = add(new THREE.Group(), x, (win.top + win.bottom) / 2, z); g.rotation.y = ry;
    const h = win.top - win.bottom;
    for (const sx of [-1, 0, 1]) mesh(new THREE.BoxGeometry(sx ? 0.07 : 0.04, h, 0.06), trim, sx * width / 2, 0, 0, g);
    for (const sy of [-1, -0.08, 0.5, 1]) mesh(new THREE.BoxGeometry(width, sy === -0.08 ? 0.07 : 0.035, 0.06), trim, 0, sy * h / 2, 0, g);
  };
  sash(2.05, 0, -D - recess, 0); sash(0.9, -1.38, -D - recess / 2, Math.PI / 4.2); sash(0.9, 1.38, -D - recess / 2, -Math.PI / 4.2);
  // Outside: deep blue sky with stars, a moon glow off to the upper right, rooftops in silhouette; it brightens on kicks.
  const skyMaterial = new THREE.MeshBasicNodeMaterial({ fog: false });
  const s = uv();
  const stars = hash2(s.mul(vec2(420, 200)).floor()).greaterThan(0.993).select(hash2(s.mul(vec2(420, 200)).floor().add(1)).mul(0.5).add(0.2), float(0));
  const moonGlow = s.sub(vec2(0.78, 0.95)).mul(vec2(2, 1)).length().smoothstep(0.7, 0).pow(2);
  const roofs = s.y.lessThan(mx_noise_float(vec3(s.x.mul(14).floor(), 2, 0)).mul(0.08).add(0.24).add(fract(s.x.mul(14)).sub(0.5).abs().mul(-0.1)));
  const skyBase = mix(rgb(0.02, 0.05, 0.16), rgb(0.004, 0.01, 0.045), s.y.smoothstep(0.2, 1)).add(rgb(0.12, 0.16, 0.28).mul(moonGlow)).add(vec3(stars));
  skyMaterial.colorNode = roofs.select(rgb(0.003, 0.004, 0.01), skyBase.mul(skyFlash.mul(3).add(1)).add(rgb(0.25, 0.3, 0.5).mul(skyFlash)));
  add(new THREE.Mesh(new THREE.PlaneGeometry(14, 7), skyMaterial), 0, 2.2, -D - 4);

  // --- Furniture.
  // Club chair: squat leather with a knitted throw over the back and a striped cushion.
  const leather = new THREE.MeshStandardNodeMaterial({ roughness: 0.45 });
  const wear = mx_noise_float(positionWorld.mul(9)).mul(0.5).add(0.5);
  leather.colorNode = mix(rgb(0.3, 0.07, 0.07), rgb(0.42, 0.17, 0.15), wear.smoothstep(0.55, 0.9));
  const club = add(new THREE.Group(), -0.45, 0, -1.55); club.rotation.y = 0.12;
  mesh(soft(1.0, 0.36, 0.9, 0.08), leather, 0, 0.3, 0.02, club);
  mesh(soft(1.02, 0.75, 0.24, 0.1), leather, 0, 0.75, -0.36, club);
  for (const side of [-1, 1]) mesh(soft(0.2, 0.55, 0.92, 0.08), leather, side * 0.5, 0.42, 0, club);
  for (const [x, z] of [[-0.42, 0.35], [0.42, 0.35], [-0.42, -0.38], [0.42, -0.38]]) mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.12, 8), plain(0x2a1408, 0.5), x, 0.06, z, club);
  const knit = fabric(mix(rgb(0.08, 0.1, 0.06), rgb(0.15, 0.16, 0.09), fract(uv().x.mul(9)).step(0.5).mul(fract(uv().y.mul(7)).step(0.5)).add(sin(uv().y.mul(260)).mul(0.1))), 0.95);
  mesh(soft(0.7, 0.5, 0.06, 0.02), knit, 0, 0.98, -0.22, club).rotation.x = -0.15;
  const stripes = fabric(mix(rgb(0.04, 0.2, 0.24), rgb(0.3, 0.45, 0.42), fract(uv().y.mul(18)).step(0.5)), 0.9);
  mesh(soft(0.62, 0.3, 0.16, 0.07), stripes, 0, 0.6, -0.16, club).rotation.x = -0.25;
  // Wingback: tall, with wings, in faded floral needlepoint; a round footstool.
  const needlepoint = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
  const flower = mx_noise_float(positionWorld.mul(5).add(4)).mul(0.5).add(0.5), leaf = mx_noise_float(positionWorld.mul(7).add(9)).mul(0.5).add(0.5);
  const stitch = sin(positionWorld.x.add(positionWorld.z).mul(420)).mul(sin(positionWorld.y.mul(420))).mul(0.06).add(0.94);
  needlepoint.colorNode = mix(mix(rgb(0.5, 0.42, 0.26), rgb(0.42, 0.15, 0.08), flower.smoothstep(0.62, 0.7)), rgb(0.22, 0.26, 0.12), leaf.smoothstep(0.7, 0.76)).mul(stitch);
  const wing = add(new THREE.Group(), 1.35, 0, -1.7); wing.rotation.y = -0.35;
  mesh(soft(0.85, 0.3, 0.8, 0.07), needlepoint, 0, 0.42, 0.04, wing);
  mesh(soft(0.85, 1.25, 0.2, 0.1), needlepoint, 0, 1.0, -0.36, wing);
  for (const side of [-1, 1]) {
    const w = mesh(soft(0.14, 0.62, 0.42, 0.06), needlepoint, side * 0.43, 1.2, -0.18, wing); w.rotation.y = side * 0.4;
    mesh(soft(0.14, 0.32, 0.72, 0.06), needlepoint, side * 0.42, 0.55, 0.02, wing);
  }
  mesh(new THREE.SphereGeometry(0.2, 16, 12), needlepoint, 0.05, 0.7, -0.15, wing).scale.set(1.1, 0.9, 0.5);
  for (const [x, z] of [[-0.35, 0.3], [0.35, 0.3]]) mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.27, 8), plain(0x2a1408, 0.5), x, 0.13, z, wing);
  const stool = add(new THREE.Group(), 0.95, 0, -0.55);
  mesh(new THREE.CylinderGeometry(0.3, 0.29, 0.18, 32), needlepoint, 0, 0.33, 0, stool);
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.6; mesh(new THREE.CylinderGeometry(0.03, 0.022, 0.25, 8), plain(0x2a1408, 0.5), Math.cos(a) * 0.2, 0.12, Math.sin(a) * 0.2, stool); }
  // Braided rug: concentric rings in blue-greens and browns; a small woven mat.
  const rugMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.95 });
  const rugR = positionLocal.xy.length(), ring = rugR.mul(15).floor(), ringHash = hash2(vec2(ring, 1.7));
  const braid = sin(atan(positionLocal.y, positionLocal.x).mul(rugR.mul(220).add(30)).add(ring.mul(2))).mul(0.5).add(0.5);
  const ringColour = mix(mix(rgb(0.06, 0.16, 0.16), rgb(0.12, 0.2, 0.14), ringHash), rgb(0.2, 0.12, 0.08), ringHash.greaterThan(0.75).select(float(1), float(0)));
  rugMaterial.colorNode = ringColour.mul(braid.mul(0.35).add(0.7)).mul(fract(rugR.mul(15)).sub(0.5).abs().smoothstep(0.5, 0.35).mul(0.3).add(0.7));
  const rug = mesh(new THREE.CircleGeometry(2.1, 96), rugMaterial, 0.2, 0.008, -0.6); rug.rotation.x = -Math.PI / 2;
  const mat = mesh(new THREE.PlaneGeometry(1.0, 0.5), fabric(mix(rgb(0.25, 0.28, 0.06), rgb(0.35, 0.36, 0.1), sin(uv().x.mul(120).add(sin(uv().y.mul(60)))).mul(0.5).add(0.5))), -0.4, 0.014, 0.35); mat.rotation.x = -Math.PI / 2;
  // Fireplace with a pale mantel on the back wall, left; embers glow in the firebox; tools beside it.
  const stone = plain(0xb8b0a0, 0.7);
  const hearth = add(new THREE.Group(), -3.0, 0, -D);
  mesh(new THREE.BoxGeometry(1.5, 0.1, 0.32), stone, 0, 1.15, 0.16, hearth);
  for (const side of [-1, 1]) mesh(new THREE.BoxGeometry(0.22, 1.1, 0.24), stone, side * 0.6, 0.55, 0.12, hearth);
  mesh(new THREE.BoxGeometry(1.42, 0.24, 0.24), stone, 0, 0.98, 0.12, hearth);
  mesh(new THREE.BoxGeometry(1.7, 0.04, 0.6), plain(0x2c2a28, 0.8), 0, 0.02, 0.3, hearth);
  const embers = new THREE.MeshBasicNodeMaterial();
  const glowNoise = mx_noise_float(vec3(uv().mul(vec2(8, 4)), time.mul(0.8))).mul(0.5).add(0.5);
  embers.colorNode = mix(rgb(0.01, 0.004, 0.002), rgb(1.6, 0.45, 0.08), glowNoise.mul(uv().y.oneMinus()).smoothstep(0.2, 0.7).mul(fire));
  mesh(new THREE.PlaneGeometry(0.98, 0.86), embers, 0, 0.43, 0.02, hearth);
  for (let k = 0; k < 3; k++) { const tool = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.72, 6), plain(0x202020, 0.4, 0.8), 0.85 + k * 0.05, 0.38, 0.4, hearth); tool.rotation.z = (k - 1) * 0.05; }
  const fireLight = add(new THREE.PointLight(0xff6a20, 0, 4, 1.6), -3.0, 0.4, -D + 0.45);
  // Pictures above the mantel and beside the window.
  for (const [w, h, x, y] of [[0.6, 0.75, -3.0, 1.9], [0.38, 0.48, -2.1, 1.75], [0.5, 0.4, 2.3, 2.3]] as const) {
    const frame = mesh(new THREE.BoxGeometry(w, h, 0.04), plain(0x3a2410, 0.5), x, y, -D + 0.02);
    const art = fabric(mix(rgb(0.4, 0.38, 0.28), rgb(0.2, 0.25, 0.18), mx_noise_float(vec3(uv().mul(3), x)).mul(0.5).add(0.5)), 0.8);
    mesh(new THREE.PlaneGeometry(w * 0.78, h * 0.78), art, 0, 0, 0.022, frame);
  }
  // Gramophone on a small cabinet; its record turns with the tempo.
  const wood = plain(0x4a2410, 0.45);
  const cabinet = add(new THREE.Group(), -1.95, 0, -2.35);
  mesh(new THREE.BoxGeometry(0.5, 0.6, 0.45), wood, 0, 0.3, 0, cabinet);
  mesh(new THREE.BoxGeometry(0.42, 0.14, 0.38), wood, 0, 0.67, 0, cabinet);
  const record = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.01, 40), fabric(mix(rgb(0.02, 0.02, 0.02), rgb(0.5, 0.1, 0.06), positionLocal.xz.length().lessThan(0.05).select(float(1), float(0))), 0.3), 0, 0.75, 0, cabinet);
  const horn = mesh(hornGeometry(), plain(0x8a5a2a, 0.3, 0.85), 0.08, 0.78, -0.02, cabinet); horn.rotation.set(0, 0, -0.95);
  // Side table with a fabric-shaded lamp and a few bottles.
  const table = add(new THREE.Group(), -1.3, 0, -1.95);
  mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 24), wood, 0, 0.62, 0, table);
  for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3; mesh(new THREE.CylinderGeometry(0.02, 0.015, 0.62, 6), wood, Math.cos(a) * 0.2, 0.31, Math.sin(a) * 0.2, table); }
  for (let k = 0; k < 3; k++) mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.08, 10), plain(0xd06a20, 0.3), -0.15 + k * 0.06, 0.68, 0.12, table);
  mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.32, 16), plain(0x6a3a1a, 0.4), 0.05, 0.8, -0.05, table);
  const shadeMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, side: THREE.DoubleSide, color: 0xd8c8a0 });
  shadeMaterial.emissiveNode = rgb(1.0, 0.62, 0.3).mul(lampLeft.mul(0.7));
  mesh(new THREE.CylinderGeometry(0.16, 0.27, 0.32, 32, 1, true), shadeMaterial, 0.05, 1.1, -0.05, table);
  const leftLight = add(new THREE.PointLight(0xffb070, 0, 7, 1.7), -1.25, 1.05, -2.0);
  // Pedestal table with a stained-glass lamp: leaded panels in colour groups.
  const pedestal = add(new THREE.Group(), 2.65, 0, -1.4);
  mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 32), wood, 0, 0.72, 0, pedestal);
  mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.7, 12), wood, 0, 0.36, 0, pedestal);
  mesh(new THREE.CylinderGeometry(0.25, 0.28, 0.04, 24), wood, 0, 0.02, 0, pedestal);
  mesh(new THREE.CylinderGeometry(0.03, 0.09, 0.4, 16), plain(0x2a1a10, 0.3, 0.6), 0, 0.94, 0, pedestal);
  const glass = new THREE.MeshStandardNodeMaterial({ roughness: 0.3, side: THREE.DoubleSide });
  const segment = uv().x.mul(14).floor(), tier = uv().y.mul(5).floor(), group = hash2(vec2(segment, tier)).mul(4).floor();
  const leading = fract(uv().x.mul(14)).sub(0.5).abs().greaterThan(0.45).or(fract(uv().y.mul(5)).sub(0.5).abs().greaterThan(0.44));
  let pane: V3 = vec3(...GLASS_GROUPS[0]);
  GLASS_GROUPS.forEach((c, k) => { if (k) pane = group.equal(k).select(vec3(...c), pane); });
  const groupLit = group.equal(glassGroup).select(glassPulse, float(0));
  glass.colorNode = leading.select(rgb(0.02, 0.02, 0.02), pane.mul(0.4));
  glass.emissiveNode = leading.select(vec3(0), pane.mul(lampRight.mul(0.9).add(groupLit.mul(1.6))));
  mesh(new THREE.SphereGeometry(0.34, 48, 16, 0, Math.PI * 2, 0, Math.PI * 0.45), glass, 0, 1.08, 0, pedestal);
  const rightLight = add(new THREE.PointLight(0xffc080, 0, 6, 1.7), 2.65, 1.02, -1.4);
  // Shelves of knick-knacks on the back wall, right.
  const shelfWood = plain(0x5a3418, 0.5);
  for (let k = 0; k < 4; k++) {
    mesh(new THREE.BoxGeometry(1.2, 0.03, 0.25), shelfWood, 3.15, 1.3 + k * 0.42, -D + 0.13);
    for (let n = 0; n < 4; n++) {
      const kind = Math.floor(random() * 3), x = 2.65 + n * 0.3 + random() * 0.05, tint = new THREE.Color().setHSL(random(), 0.3, 0.35 + random() * 0.2);
      const geometry = kind === 0 ? new THREE.CylinderGeometry(0.04, 0.05, 0.12 + random() * 0.1, 12) : kind === 1 ? new THREE.SphereGeometry(0.06, 12, 10) : new THREE.ConeGeometry(0.05, 0.18, 10);
      const item = mesh(geometry, new THREE.MeshStandardNodeMaterial({ color: tint, roughness: 0.4 }), x, 1.39 + k * 0.42, -D + 0.12); item.position.y += kind === 1 ? -0.03 : 0;
    }
  }
  for (const side of [-1, 1]) mesh(new THREE.BoxGeometry(0.03, 1.7, 0.25), shelfWood, 3.15 + side * 0.6, 2.0, -D + 0.13);

  // --- Light: cold moonlight through the panes (its shadow draws the window on the rug), a faint blue ambient.
  const moon = new THREE.SpotLight(0x8aa8ff, 0, 18, 0.55, 0.5, 1);
  moon.position.set(1.2, 4.6, -D - 4.5); moon.target.position.set(0.1, 0, -0.6); scene.add(moon, moon.target);
  moon.castShadow = budget.particleScale >= 1; moon.shadow.mapSize.set(1024, 1024); moon.shadow.bias = -0.0005;
  scene.add(new THREE.AmbientLight(0x1a2240, 0.18));
  const warmFill = add(new THREE.PointLight(0xff9050, 0, 9, 1.5), -0.5, 2.2, 1.5);
  // The beam: a soft volume from the window down to the floor, with dust motes drifting in it.
  const beamGeometry = new THREE.BufferGeometry(), beamDir = new THREE.Vector3(-0.1, -0.85, 0.75).normalize();
  const corners = [[win.left + 0.3, win.bottom], [win.right - 0.3, win.bottom], [win.right - 0.3, win.top], [win.left + 0.3, win.top]].map(([x, y]) => new THREE.Vector3(x, y, -D - 0.1));
  const ends = corners.map((c) => c.clone().addScaledVector(beamDir, c.y / -beamDir.y));
  const verts: number[] = [], fades: number[] = [];
  for (let k = 0; k < 4; k++) { const a = corners[k], b = corners[(k + 1) % 4], c = ends[(k + 1) % 4], d = ends[k]; verts.push(...a.toArray(), ...b.toArray(), ...c.toArray(), ...a.toArray(), ...c.toArray(), ...d.toArray()); fades.push(0, 0, 1, 0, 1, 1); }
  beamGeometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); beamGeometry.setAttribute('along', new THREE.Float32BufferAttribute(fades, 1));
  const beamMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const haze = mx_noise_float(positionWorld.mul(1.5).add(vec3(0, time.mul(0.05), 0))).mul(0.5).add(0.5);
  beamMaterial.colorNode = rgb(0.018, 0.025, 0.05).mul(haze).mul(attribute<'float'>('along').oneMinus().mul(0.7).add(0.3)).mul(skyFlash.mul(2).add(1));
  scene.add(new THREE.Mesh(beamGeometry, beamMaterial));
  const moteCount = Math.round(500 * Math.min(1.5, budget.particleScale)), motes = new Float32Array(moteCount * 3);
  for (let i = 0; i < moteCount; i++) { const t = random(), c = corners[0].clone().lerp(corners[2], random()); c.x = win.left + 0.4 + random() * (win.right - win.left - 0.8); motes.set(c.addScaledVector(beamDir, t * c.y / -beamDir.y).toArray(), i * 3); }
  const moteGeometry = new THREE.BufferGeometry(); moteGeometry.setAttribute('position', new THREE.BufferAttribute(motes, 3));
  const moteMaterial = new THREE.PointsNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  moteMaterial.positionNode = positionLocal.add(vec3(sin(time.mul(0.3).add(positionLocal.y.mul(7))).mul(0.05), sin(time.mul(0.2).add(positionLocal.x.mul(5))).mul(0.04), 0));
  const twinkle = fract(hash2(positionLocal.xz.mul(97)).add(time.mul(0.7))).smoothstep(0.7, 1);
  moteMaterial.colorNode = rgb(0.7, 0.8, 1).mul(twinkle.mul(dust).mul(1.5).add(0.15));
  scene.add(new THREE.Points(moteGeometry, moteMaterial));

  const hits = createHits({ decay: 0.4, interval: 0.25 }), lamps = variantSequence(LAMP_PATTERNS.length, 41);
  let flash = 0, leftPulse = 0, rightPulse = 0, nextGroup = 0, groupLevel = 0, push = 0, spin = 0, beatRate = 2, lastBeat = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(perspective, frame.aspect);
      time.value = frame.time;
      const step = settleStep(frame), motion = frame.reducedMotion ? 0 : frame.delta, { bass, loudness, impact } = frame.response, gentle = frame.reducedFlash ? 0.4 : 1;
      hits.update(frame, 0.1);
      if (hits.fired) {
        if (frame.time > lastBeat) { beatRate = approach(beatRate, Math.min(4, 1 / Math.max(0.2, frame.time - lastBeat)), 1, 2); lastBeat = frame.time; }
        if (isSnare(frame)) {
          const pattern = LAMP_PATTERNS[lamps.next()];
          if (pattern !== 'right') leftPulse = 1;
          if (pattern !== 'left') rightPulse = 1;
          glassGroup.value = nextGroup; nextGroup = (nextGroup + 1) % GLASS_GROUPS.length; groupLevel = 1;
        } else { flash = Math.max(flash, 0.6 + impact * 0.4); if (impact > 0.8) push = 1; }
      }
      // The window: a soft lightning pop that fades in about 0.4 s.
      flash = Math.max(0, flash - step * 2.5);
      skyFlash.value = flash * gentle;
      moon.intensity = (2.4 + flash * 9 * gentle) * 12;
      leftPulse = Math.max(0, leftPulse - step * 3); rightPulse = Math.max(0, rightPulse - step * 3); groupLevel = Math.max(0, groupLevel - step * 1.5);
      // Lamps: low but always on; loudness lifts the warm side, snares pulse them.
      const warm = 0.45 + loudness * 0.5;
      lampLeft.value = warm + leftPulse * 0.8 * gentle; lampRight.value = warm + rightPulse * 0.8 * gentle; glassPulse.value = groupLevel * gentle;
      leftLight.intensity = lampLeft.value * 3.2; rightLight.intensity = lampRight.value * 2.6;
      fire.value = approach(fire.value, 0.45 + bass * 0.9, step, 0.15) * (0.92 + 0.08 * Math.sin(frame.time * 11) * Math.sin(frame.time * 7.3));
      fireLight.intensity = fire.value * 2.2;
      warmFill.intensity = 0.5 + loudness * 0.7 + bass * 0.3;
      dust.value = approach(dust.value, 0.3 + frame.audio.highs, step, 0.1);
      // The record turns at a speed tied to the tempo.
      spin += motion * beatRate * 1.6; record.rotation.y = spin;
      // Locked, wide, at a seated eye height; a tiny drift and a slow push-in on strong hits.
      push = Math.max(0, push - step * 0.8);
      const drift = frame.reducedMotion ? 0 : 1;
      perspective.position.set(0.15 + Math.sin(frame.time * 0.11) * 0.03 * drift, 1.05 + Math.sin(frame.time * 0.07) * 0.015 * drift, 1.55 - Math.sin(push * Math.PI) * 0.07);
      perspective.lookAt(0.05, 1.12, -D);
    },
    dispose: () => disposeScene(scene),
  };
}
