import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { Fn, cameraProjectionMatrix, float, floor, fract, mix, modelViewMatrix, positionLocal, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { createHits, variantSequence } from './hitPulse';
import { isSnare, sectionWatch } from './waveSixShared';
import { seededRandom } from '../rendering/diagnostics';

type V2 = Node<'vec2'>;

export const MACHINES = 7;
/** Rows in the retro frame (about a 320×240 console, scaled to the aspect). */
export const RETRO_ROWS = 240;
/** Kick light patterns for the machine tops: all, odd, even, a chase left to right. */
export const TOP_PATTERNS = 4;

/** A 5×7 dot font for the jackpot sign. */
export const FONT: Record<string, string> = {
  ' ': '00000000000000000000000000000000000', '0': '01110100011001110101110011000101110', '1': '00100011000010000100001000010001110',
  '2': '01110100010000100010001000100011111', '3': '11110000010000101110000010000111110', '4': '00010001100101010010111110001000010',
  '5': '11111100001111000001000011000101110', '6': '00110010001000011110100011000101110', '7': '11111000010001000100010000100001000',
  '8': '01110100011000101110100011000101110', '9': '01110100011000101111000010001001100', '$': '00100011111010001110001011111000100',
  '.': '00000000000000000000000000110001100', 'J': '00111000100001000010100101001001100', 'A': '01110100011000111111100011000110001',
  'C': '01110100011000010000100001000101110', 'K': '10001100101010011000101001001010001', 'P': '11110100011000111110100001000010000',
  'O': '01110100011000110001100011000101110', 'T': '11111001000010000100001000010000100',
};
export const FONT_CHARS = Object.keys(FONT);

/** An RGBA texture drawn pixel by pixel in sRGB and sampled nearest, so its texels show like an old console's. */
function pixelTexture(width: number, height: number, paint: (x: number, y: number) => readonly [number, number, number]) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const [r, g, b] = paint(x, y); data.set([r, g, b, 255], (y * width + x) * 4); }
  const map = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  map.minFilter = map.magFilter = THREE.NearestFilter; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.colorSpace = THREE.SRGBColorSpace; map.needsUpdate = true;
  return map;
}
const hashInt = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
/** Reel symbols top to bottom: seven, bar, cherry, bell (32×32 each). */
function reelTexture() {
  return pixelTexture(32, 128, (x, y) => {
    const symbol = Math.floor(y / 32), lx = x - 16, ly = (y % 32) - 16;
    if (symbol === 0) { const seven = (ly > 7 && ly < 11 && Math.abs(lx) < 8) || (Math.abs(lx - ly * 0.55 - 2) < 2.2 && ly < 9 && ly > -11); return seven ? [220, 20, 20] : [245, 240, 230]; }
    if (symbol === 1) return Math.abs(ly) < 5 && Math.abs(lx) < 12 ? (Math.abs(ly) < 2 && Math.abs(lx) < 8 ? [245, 240, 230] : [20, 20, 30]) : [245, 240, 230];
    if (symbol === 2) { const a = Math.hypot(lx + 5, ly + 5) < 5, b = Math.hypot(lx - 5, ly + 4) < 5, stem = Math.abs(lx - ly * 0.4) < 1.3 && ly > 0 && ly < 11; return a || b ? [200, 10, 30] : stem ? [40, 160, 40] : [245, 240, 230]; }
    const bell = ly > -9 && ly < 9 && Math.abs(lx) < 4 + (ly + 9) * 0.4; return bell ? (ly > 6 ? [180, 120, 20] : [240, 190, 40]) : [245, 240, 230];
  });
}

/**
 * Snaps a mesh's vertices to a coarse screen grid, like a 1990s console's integer vertex maths: edges crawl a
 * little as the camera moves.
 */
function ps1(material: THREE.NodeMaterial, grid: V2) {
  material.vertexNode = Fn(() => {
    const clip = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(positionLocal, 1));
    const snapped = clip.xy.div(clip.w).mul(grid).round().div(grid).mul(clip.w);
    return vec4(snapped, clip.z, clip.w);
  })();
  return material;
}

/**
 * Slot Hall (wave 6, #2): a small late-90s casino room in PS1-era 3D: low-poly machines, chunky nearest-sampled
 * textures, vertex jitter, a 240-row frame with dithered 15-bit colour. Seven slot machines along the back wall
 * under a dot-matrix JACKPOT sign, red velvet rope on brass posts, a marquee of bulbs round the cornice and a
 * starfield ceiling. Kicks flash the machine tops in a pattern, snares step the marquee chase, every few kicks a
 * machine spins its reels (strong hits can land three of a kind and roll the jackpot up), bass washes the walls
 * red, hats twinkle the stars, loudness lights the sign.
 */
export function createSlotHallMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  const perspective = camera as THREE.PerspectiveCamera;
  perspective.fov = 62; perspective.near = 0.1; perspective.far = 60;
  scene.background = new THREE.Color(0x000000);
  const random = seededRandom(222);
  const grid = uniform(new THREE.Vector2(160, 120)), time = uniform(0), redWash = uniform(0), twinkle = uniform(0), marquee = uniform(0), signLevel = uniform(0.6);
  const lambert = (colour: number) => ps1(new THREE.MeshLambertNodeMaterial({ color: colour }), grid);
  const box = (w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  };
  const W = 8, D = 6, H = 4.6;

  // Room: carpet, wallpaper above a gold dado rail and dark panelling, a black starfield ceiling.
  const carpet = pixelTexture(32, 32, (x, y) => {
    const lx = (x % 16) - 8, ly = (y % 16) - 8, r = Math.hypot(lx, ly), a = Math.atan2(ly, lx);
    if (r < 2) return [250, 200, 60];
    if (r < 6 && Math.abs(Math.cos(a * 4)) > 0.8) return [220, 30, 40];
    if (Math.abs(r - 7) < 0.8) return [230, 170, 50];
    return hashInt(x, y) < 0.06 ? [60, 200, 220] : (x + y) % 16 < 8 ? [36, 20, 70] : [24, 18, 60];
  });
  const floorMaterial = new THREE.MeshLambertNodeMaterial();
  floorMaterial.colorNode = texture(carpet, uv().mul(vec2(8, 6))).rgb.mul(redWash.mul(vec3(0.6, 0.1, 0.15)).add(1));
  ps1(floorMaterial, grid);
  const carpetFloor = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, D * 2, 8, 6), floorMaterial); carpetFloor.rotation.x = -Math.PI / 2; scene.add(carpetFloor);
  const paper = pixelTexture(16, 16, (x, y) => {
    const dx = Math.abs(x - 8), dy = Math.abs(y - 8);
    if (dx + dy === 6) return [200, 150, 50];
    if ((dx === 0 && dy < 2) || (dy === 0 && dx < 2)) return [210, 160, 60];
    return [110 + hashInt(x, y) * 12, 16, 18];
  });
  // Four wall planes (not a box: its floor and lid would cover the carpet and the stars), the paper tiled per metre.
  for (const [w, x, z, ry] of [[W * 2, 0, -D, 0], [D * 2, -W, 0, Math.PI / 2], [D * 2, W, 0, -Math.PI / 2], [W * 2, 0, D, Math.PI]] as const) {
    const material = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
    material.colorNode = texture(paper, uv().mul(vec2(w / 0.75, H / 0.75))).rgb.mul(redWash.mul(vec3(0.9, 0.05, 0.05)).add(1));
    material.emissiveNode = vec3(0.12, 0.005, 0.005).mul(redWash);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, H, 8, 3), ps1(material, grid)); wall.position.set(x, H / 2, z); wall.rotation.y = ry; scene.add(wall);
  }
  const panel = lambert(0x4a2018), gold = lambert(0xc89a3a);
  for (const [w, d, x, z] of [[W * 2, 0.1, 0, -D + 0.05], [0.1, D * 2, -W + 0.05, 0], [0.1, D * 2, W - 0.05, 0]] as const) {
    box(w, 1.1, d, panel, x, 0.55, z);
    box(w + (d < 1 ? 0 : 0.1), 0.08, d + (d < 1 ? 0.08 : 0), gold, x, 1.12, z);
    box(w + (d < 1 ? 0 : 0.2), 0.3, d + (d < 1 ? 0.2 : 0), gold, x, H - 0.4, z);
  }
  const ceilingMaterial = new THREE.MeshBasicNodeMaterial();
  const starCell = uv().mul(vec2(64, 48)).floor(), star = fract(starCell.x.mul(0.1373).add(starCell.y.mul(0.7154)).mul(starCell.x.add(3.1)).sin().mul(43758.5));
  const sparkle = fract(star.mul(91).add(time.mul(twinkle.mul(4).add(0.3)))).smoothstep(0.6, 1);
  ceilingMaterial.colorNode = vec3(0.012, 0.012, 0.03).add(vec3(0.9, 0.85, 0.7).mul(star.greaterThan(0.965).select(sparkle.mul(0.7).add(0.3), float(0))));
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, D * 2), ps1(ceilingMaterial, grid)); ceiling.rotation.x = Math.PI / 2; ceiling.position.y = H; scene.add(ceiling);
  // The marquee: a band of bulbs round the cornice, chasing one step per snare.
  const bulbMaterial = new THREE.MeshBasicNodeMaterial();
  const bulbIndex = uv().x.mul(90).floor(), bulb = fract(uv().x.mul(90)).sub(0.5).mul(vec2(1, 0.45)).length();
  const chase = bulbIndex.add(marquee.floor()).mod(3).equal(0).select(float(1), float(0.15));
  bulbMaterial.colorNode = mix(vec3(0.02, 0.015, 0.01), vec3(2.4, 1.7, 0.6).mul(chase), bulb.lessThan(0.28).select(float(1), float(0)));
  ps1(bulbMaterial, grid);
  for (const [w, x, z, ry] of [[W * 2, 0, -D + 0.12, 0], [D * 2, -W + 0.12, 0, Math.PI / 2], [D * 2, W - 0.12, 0, -Math.PI / 2]] as const) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.22), bulbMaterial); strip.position.set(x, H - 0.75, z); strip.rotation.y = ry; scene.add(strip);
  }
  // A red door with a porthole on the right wall.
  const door = box(0.12, 2.6, 1.4, lambert(0x7a0c10), W - 0.1, 1.3, 2.4);
  const port = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 6, 12), gold); port.position.set(-0.08, 0.6, 0); port.rotation.y = Math.PI / 2; door.add(port);

  // The machines.
  const reels = reelTexture(), emblem = pixelTexture(32, 32, (x, y) => {
    const lx = x - 16, ly = y - 16, r = Math.hypot(lx, ly);
    if (Math.abs(r - 11) < 1.6) return [245, 235, 220];
    if (r < 10 && ((ly > 4 && ly < 7 && Math.abs(lx) < 6) || (Math.abs(lx - ly * 0.5 - 2) < 1.8 && ly < 6 && ly > -8))) return [250, 240, 230];
    return [170, 14, 18];
  });
  const black = lambert(0x0c0c10), chrome = new THREE.MeshPhongNodeMaterial({ color: 0xc8ccd4, shininess: 60 }); ps1(chrome, grid);
  const machines = Array.from({ length: MACHINES }, (_, m) => {
    const group = new THREE.Group(); group.position.set(-5.4 + m * 1.32, 0, -D + 0.75); scene.add(group);
    box(1.15, 1.25, 0.9, black, 0, 0.62, 0, group);
    box(1.18, 0.06, 0.95, chrome, 0, 1.27, 0, group);
    box(1.15, 0.65, 0.7, lambert(0xd8d8dc), 0, 1.62, -0.08, group);
    const glow = uniform(0), cabinet = uniform(0);
    const topMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 });
    topMaterial.colorNode = texture(emblem, uv()).rgb;
    topMaterial.emissiveNode = texture(emblem, uv()).rgb.mul(glow.mul(1.6).add(0.08));
    box(1.15, 0.8, 0.6, ps1(topMaterial, grid), 0, 2.38, -0.12, group);
    box(1.18, 0.05, 0.65, chrome, 0, 2.8, -0.12, group);
    // Three reels behind the window, each scrolling its own strip.
    const offsets = [uniform(random()), uniform(random()), uniform(random())];
    offsets.forEach((offset, r) => {
      const material = new THREE.MeshBasicNodeMaterial();
      material.colorNode = texture(reels, vec2(uv().x, fract(uv().y.mul(0.5).add(offset)))).rgb.mul(cabinet.mul(1.4).add(0.75));
      const reel = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.36), ps1(material, grid)); reel.position.set((r - 1) * 0.31, 1.65, 0.28); group.add(reel);
    });
    // The pull lever on the right side.
    const lever = new THREE.Group(); lever.position.set(0.62, 1.5, 0); group.add(lever);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6), chrome); arm.position.y = 0.35; lever.add(arm);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), lambert(0xd01818)); knob.position.y = 0.72; lever.add(knob);
    const light = new THREE.PointLight(0xff3020, 0, 3.5, 1.5); light.position.set(0, 2.3, 0.8); group.add(light);
    return { glow, cabinet, offsets, lever, light, spin: [0, 0, 0], stopAt: [0, 0, 0], spinning: -1, flash: 0, top: 0 };
  });
  // Stools, the rope and its brass posts.
  const seat = lambert(0xb01820);
  for (const x of [-3.2, 1.1]) {
    const stool = new THREE.Group(); stool.position.set(x, 0, -D + 2.1); scene.add(stool);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.75, 6), chrome); pole.position.y = 0.38; stool.add(pole);
    const cushion = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.26, 0.14, 8), seat); cushion.position.y = 0.8; stool.add(cushion);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.02, 4, 10), chrome); ring.rotation.x = Math.PI / 2; ring.position.y = 0.3; stool.add(ring);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.04, 8), chrome); foot.position.y = 0.02; stool.add(foot);
  }
  const brass = new THREE.MeshPhongNodeMaterial({ color: 0xc8962a, shininess: 40 }); ps1(brass, grid);
  const posts = [[-1.4, -0.4], [0.6, -0.9], [2.6, -0.5]];
  for (const [x, z] of posts) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.05, 6), brass); post.position.set(x, 0.52, z); scene.add(post);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), brass); cap.position.set(x, 1.08, z); scene.add(cap);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.05, 8), brass); base.position.set(x, 0.03, z); scene.add(base);
  }
  const velvet = lambert(0x9a0c18);
  for (let k = 0; k < posts.length - 1; k++) {
    const [a, b] = [posts[k], posts[k + 1]], points = [];
    for (let s = 0; s <= 8; s++) { const t = s / 8; points.push(new THREE.Vector3(a[0] + (b[0] - a[0]) * t, 0.98 - Math.sin(t * Math.PI) * 0.32, a[1] + (b[1] - a[1]) * t)); }
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 10, 0.035, 5), velvet));
  }

  // The JACKPOT sign: a dot-matrix board reading two lines of text from a tiny character texture.
  const font = new Uint8Array(FONT_CHARS.length * 5 * 7);
  FONT_CHARS.forEach((c, i) => { for (let k = 0; k < 35; k++) font[(6 - Math.floor(k / 5)) * FONT_CHARS.length * 5 + i * 5 + (k % 5)] = FONT[c][k] === '1' ? 255 : 0; });
  const fontMap = new THREE.DataTexture(font, FONT_CHARS.length * 5, 7, THREE.RedFormat, THREE.UnsignedByteType); fontMap.minFilter = fontMap.magFilter = THREE.NearestFilter; fontMap.needsUpdate = true;
  const textData = new Uint8Array(13 * 2), textMap = new THREE.DataTexture(textData, 13, 2, THREE.RedFormat, THREE.UnsignedByteType);
  textMap.minFilter = textMap.magFilter = THREE.NearestFilter;
  const writeText = (line: number, text: string) => { for (let i = 0; i < 13; i++) textData[(1 - line) * 13 + i] = Math.max(0, FONT_CHARS.indexOf(text[i] ?? ' ')); textMap.needsUpdate = true; };
  writeText(0, '   JACKPOT   ');
  const signMaterial = new THREE.MeshBasicNodeMaterial();
  const dots = uv().mul(vec2(13 * 6, 2 * 9)), dotCell = dots.floor(), charCell = vec2(dotCell.x.div(6).floor(), dotCell.y.div(9).floor());
  const inChar = vec2(dotCell.x.mod(6), dotCell.y.mod(9).sub(1));
  const code = texture(textMap, charCell.add(0.5).div(vec2(13, 2))).r.mul(255).round();
  const fontBit = texture(fontMap, vec2(code.mul(5).add(inChar.x.min(4)).add(0.5).div(FONT_CHARS.length * 5), inChar.y.clamp(0, 6).add(0.5).div(7))).r;
  const inside = inChar.x.lessThan(5).and(inChar.y.greaterThanEqual(0)).and(inChar.y.lessThan(7)).select(float(1), float(0));
  const dotShape = fract(dots).sub(0.5).length().lessThan(0.38).select(float(1), float(0));
  signMaterial.colorNode = mix(vec3(0.06, 0.008, 0.004), vec3(2.2, 0.75, 0.12).mul(signLevel), fontBit.mul(inside)).mul(dotShape);
  const signGroup = new THREE.Group(); signGroup.position.set(-1.4, H - 1.25, -D + 0.6); scene.add(signGroup);
  box(4.6, 1.3, 0.12, lambert(0x0a0a0a), 0, 0, -0.07, signGroup);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.15), ps1(signMaterial, grid)); signGroup.add(sign);
  for (const x of [-1.6, 1.6]) box(0.03, 0.9, 0.03, chrome, x, 1.0, -0.05, signGroup);

  scene.add(new THREE.AmbientLight(0xffe0d0, 0.35));
  const key = new THREE.PointLight(0xffd0a0, 18, 18, 1.4); key.position.set(0, H - 0.6, 1); scene.add(key);

  // The retro frame: low resolution, nearest upscale, 15-bit colour with an ordered dither.
  const aspect = uniform(4 / 3), rows = uniform(RETRO_ROWS);
  const filter = (input: THREE.TextureNode) => {
    const res = vec2(rows.mul(aspect), rows), cell = uv().mul(res).floor();
    const colour = input.sample(cell.add(0.5).div(res)).rgb;
    const bayer2 = (q: Node<'vec2'>) => q.x.mul(2).add(q.y.mul(3)).mod(4);
    const q = cell.mod(4);
    const threshold = bayer2(q.mod(2)).mul(4).add(bayer2(floor(q.div(2)).mod(2))).add(0.5).div(16);
    // Quantise in display-ish space so the steps fall where a console's would.
    const display = colour.max(vec3(0)).pow(vec3(1 / 2.2));
    const stepped = floor(display.mul(31).add(threshold.sub(0.5).mul(1.2)).add(0.5)).div(31).clamp(0, 1.4);
    return vec4(stepped.pow(vec3(2.2)), 1);
  };

  const hits = createHits({ decay: 0.22, interval: 0.15 }), patterns = variantSequence(TOP_PATTERNS, 31), section = sectionWatch(60);
  let jackpot = 1204377.5, displayed = jackpot, kicks = 0, chaseStep = 0, chasePhase = 0, dolly = 0, dollyAge = -1, sway = 0, pattern = 0, chaseFrom = 0;
  const money = (value: number) => `$${value.toFixed(2).padStart(11, ' ')}`.slice(0, 13).padEnd(13, ' ');
  writeText(1, money(displayed));
  const spinMachine = (m: number, win: boolean) => {
    const machine = machines[m];
    if (machine.spinning >= 0) return;
    machine.spinning = 0; const symbol = Math.floor(random() * 4);
    // Each reel lands on a symbol centre (a strip holds four, shown two at a time: offsets in quarter steps).
    machine.stopAt = [0, 1, 2].map((r) => (win ? symbol : Math.floor(random() * 4)) / 4 + 0.125 + Math.floor(machine.spin[r]) + 2 + r) as [number, number, number];
    machine.top = win ? 1 : 0;
  };
  return {
    scene, camera, filter,
    update(frame) {
      resizeCamera(perspective, frame.aspect);
      aspect.value = frame.aspect; time.value = frame.time;
      grid.value.set(RETRO_ROWS * frame.aspect / 2, RETRO_ROWS / 2);
      const step = settleStep(frame), motion = frame.reducedMotion ? 0 : frame.delta, { bass, loudness, impact } = frame.response, gentle = frame.reducedFlash ? 0.4 : 1;
      hits.update(frame, 0.1);
      if (section(frame)) dollyAge = 0;
      if (hits.fired) {
        if (isSnare(frame)) chaseStep++;
        else {
          kicks++; pattern = patterns.next(); chaseFrom = frame.time;
          machines.forEach((machine, m) => {
            const lit = pattern === 0 || (pattern === 1 && m % 2 === 0) || (pattern === 2 && m % 2 === 1);
            if (lit) machine.flash = 1;
          });
          // Every fourth kick one machine spins; a strong hit can land three of a kind.
          if (kicks % 4 === 0) {
            const m = Math.floor(random() * MACHINES), win = impact > 0.85 && random() < 0.5;
            spinMachine(m, win);
            if (win) jackpot += 2500 + random() * 12000;
          }
        }
      }
      // The chase pattern lights the tops one after another from the kick.
      if (pattern === 3) { const at = Math.floor((frame.time - chaseFrom) / 0.06); if (at < MACHINES) machines[at].flash = 1; }
      // At high energy the marquee runs on its own as well as stepping on snares.
      chasePhase += motion * (loudness > 0.6 ? 8 : 0.8);
      marquee.value = chaseStep + chasePhase;
      jackpot += step * loudness * 3.7;
      displayed = displayed < jackpot ? Math.min(jackpot, displayed + Math.max(step * 17, (jackpot - displayed) * step * 3)) : jackpot;
      writeText(1, money(displayed));
      machines.forEach((machine) => {
        machine.flash = Math.max(0, machine.flash - step * 4.5);
        machine.glow.value = 0.1 + machine.flash * gentle + machine.top * 0.6 * gentle;
        machine.top = Math.max(0, machine.top - step * 0.5);
        machine.cabinet.value = machine.top * gentle;
        machine.light.intensity = (machine.flash * 4 + machine.top * 6) * gentle;
        if (machine.spinning >= 0) {
          machine.spinning += step;
          for (let r = 0; r < 3; r++) {
            const stopping = machine.spinning > 0.8 + r * 0.35;
            machine.spin[r] = stopping ? approach(machine.spin[r], machine.stopAt[r], step, 0.06) : machine.spin[r] + step * 6;
            machine.offsets[r].value = machine.spin[r] % 1;
          }
          machine.lever.rotation.x = machine.spinning < 0.3 ? machine.spinning * 2.5 : Math.max(0, 0.75 - (machine.spinning - 0.3) * 3);
          if (machine.spinning > 2) machine.spinning = -1;
        }
      });
      redWash.value = approach(redWash.value, bass * 0.9, step, 0.12);
      twinkle.value = approach(twinkle.value, frame.audio.highs, step, 0.1);
      signLevel.value = approach(signLevel.value, 0.45 + loudness * 0.8, step, 0.2);
      // Standing by the rope: a slow sway, and a short dolly along the rope on a section change.
      sway += motion * 0.25;
      if (dollyAge >= 0) { dollyAge += step; dolly = Math.sin(Math.min(1, dollyAge / 4) * Math.PI) * 1.4; if (dollyAge > 4) dollyAge = -1; }
      const yaw = Math.sin(sway) * 0.05;
      perspective.position.set(2.6 - dolly, 1.62, 1.6);
      perspective.lookAt(-1.6 - dolly + Math.sin(yaw) * 4, 1.35, -5.2);
    },
    dispose() { disposeScene(scene); [carpet, paper, reels, emblem, fontMap, textMap].forEach((t) => t.dispose()); },
  };
}
