import * as THREE from 'three/webgpu';
import { abs, atan, cos, float, fract, max, min, mix, mx_noise_float, positionLocal, positionWorld, sin, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, wrap, bandEnergies, approach, beatGate, settleStep, createSpectrumTexture, spectrumAxisNode } from './shared';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- Turntable

const RECORD = 15, LABEL = 5, PLATTER = 16.2, RPM = 33.333, RING_BARS = 72;
/** Tonearm yaw (radians about the pivot) that puts the stylus at `radius` on a record centred at the origin. */
export function tonearmYaw(pivot: readonly [number, number], length: number, radius: number) {
  // Law of cosines in the pivot–centre–stylus triangle; the arm swings from the pivot toward the spindle.
  const d = Math.hypot(pivot[0], pivot[1]), toCentre = Math.atan2(-pivot[1], -pivot[0]);
  const cosA = Math.max(-1, Math.min(1, (length * length + d * d - radius * radius) / (2 * length * d)));
  return toCentre + Math.acos(cosA);
}

export function createTurntableMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  const spectrum = createSpectrumTexture();
  const logMapping = uniform(0), nyquist = uniform(24000), hue = uniform(0), sheen = uniform(1);
  scene.add(new THREE.AmbientLight(0x404858, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(-30, 60, 20); scene.add(key);
  const rim = new THREE.PointLight(0x88aaff, 600, 200); rim.position.set(30, 25, -40); scene.add(rim);
  // Plinth and platter.
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(66, 4, 48), new THREE.MeshStandardNodeMaterial({ color: 0x0c0c0f, roughness: 0.6, metalness: 0.2 }));
  plinth.position.set(4, -2.6, 0);
  const platter = new THREE.Mesh(new THREE.CylinderGeometry(PLATTER, PLATTER, 1.4, 96), new THREE.MeshStandardNodeMaterial({ color: 0x9a9ca4, roughness: 0.25, metalness: 0.9 }));
  platter.position.y = -0.2;
  scene.add(plinth, platter);
  // Strobe dots round the platter edge, glowing with the hue.
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicNodeMaterial({ color: 0xffffff }), 90);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 90; i++) { const a = i / 90 * TAU; dummy.position.set(Math.cos(a) * (PLATTER + 0.05), -0.2, Math.sin(a) * (PLATTER + 0.05)); dummy.updateMatrix(); dots.setMatrixAt(i, dummy.matrix); }
  const spinner = new THREE.Group(); spinner.add(dots); scene.add(spinner);
  // The record: grooves shaded by the spectrum at each radius, with the classic two-wedge sheen fixed to the light.
  const recordMaterial = new THREE.MeshBasicNodeMaterial();
  const local = positionLocal.xy, r = local.length();
  const toLight = atan(positionWorld.z, positionWorld.x).sub(-2.4);
  const wedge = abs(cos(toLight)).pow(30).mul(0.55).add(abs(cos(toLight)).pow(4).mul(0.08));
  const u = r.sub(LABEL + 0.5).div(RECORD - LABEL - 1).clamp(0, 1);
  const energy = spectrumAxisNode(spectrum.texture, u.oneMinus(), logMapping, nyquist);
  const grooves = sin(r.mul(140)).mul(0.5).add(0.5).mul(0.35).add(0.65);
  const gaps = fract(u.mul(5)).smoothstep(0, 0.02).mul(fract(u.mul(5)).smoothstep(1, 0.98)).mul(0.6).add(0.4);
  const glow = vec3(fract(hue).mul(TAU).cos(), fract(hue.add(0.33)).mul(TAU).cos(), fract(hue.add(0.67)).mul(TAU).cos()).mul(0.5).add(0.5);
  recordMaterial.colorNode = vec3(0.012, 0.012, 0.016).add(vec3(wedge.mul(sheen)).mul(grooves).mul(gaps)).add(glow.mul(energy.pow(1.5).mul(0.45)).mul(grooves));
  const record = new THREE.Mesh(new THREE.RingGeometry(LABEL, RECORD, 128, 1), recordMaterial);
  record.rotation.x = -Math.PI / 2; record.position.y = 0.62;
  const labelMaterial = new THREE.MeshBasicNodeMaterial();
  const lr = positionLocal.xy.length().div(LABEL), mark = abs(positionLocal.x).lessThan(0.25).select(float(1), float(0)).mul(positionLocal.y.greaterThan(1.2).select(float(1), float(0)));
  labelMaterial.colorNode = mix(glow.mul(0.7), vec3(0.95, 0.92, 0.85), mark.add(lr.sub(0.72).abs().lessThan(0.03).select(float(0.8), float(0))).min(1)).mul(lr.smoothstep(1, 0.97).mul(0.4).add(0.6));
  const label = new THREE.Mesh(new THREE.CircleGeometry(LABEL, 64), labelMaterial);
  label.rotation.x = -Math.PI / 2; label.position.y = 0.64;
  const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.6, 16), new THREE.MeshStandardNodeMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.2 }));
  spindle.position.y = 1.2;
  const disc = new THREE.Group(); disc.add(record, label, spindle); scene.add(disc);
  // Tonearm: pivot, tube, headshell and counterweight, yawed about the pivot.
  const pivot: [number, number] = [22, -14], ARM = 25;
  const chrome = new THREE.MeshStandardNodeMaterial({ color: 0xcfd2d8, metalness: 1, roughness: 0.18 });
  const arm = new THREE.Group(); arm.position.set(pivot[0], 1.9, pivot[1]);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 3, 32), new THREE.MeshStandardNodeMaterial({ color: 0x2a2b30, metalness: 0.6, roughness: 0.4 }));
  base.position.set(pivot[0], -0.6, pivot[1]);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, ARM, 12), chrome); tube.rotation.z = Math.PI / 2; tube.position.x = ARM / 2;
  const shell = new THREE.Mesh(new THREE.BoxGeometry(3, 0.5, 1.8), new THREE.MeshStandardNodeMaterial({ color: 0x111111, metalness: 0.4, roughness: 0.5 })); shell.position.set(ARM + 0.8, -0.6, 0);
  const weight = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2.4, 24), chrome); weight.rotation.z = Math.PI / 2; weight.position.x = -3.2;
  arm.add(tube, shell, weight); scene.add(base, arm);
  // A ring of spectrum bars on the plinth round the platter.
  const barMaterial = new THREE.MeshBasicNodeMaterial();
  const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 1, 0.7), barMaterial, RING_BARS);
  bars.position.y = -0.55; scene.add(bars);
  const levels = new Float32Array(RING_BARS), bands = new Float32Array(RING_BARS / 2), colour = new THREE.Color();
  // Room: a dim floor glow under the deck.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(160, 48), new THREE.MeshBasicNodeMaterial({ color: 0x050508 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -4.7; scene.add(floor);
  const scratchGate = beatGate(1.2);
  let angle = 0, scratch = 0, orbit = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      spectrum.update(frame.audio.spectrum);
      logMapping.value = frame.spectrumMapping === 'log' ? 1 : 0; nyquist.value = frame.sampleRate / 2;
      hue.value = frame.hue;
      sheen.value = approach(sheen.value, 0.8 + frame.response.loudness * 0.6, settleStep(frame), 0.2);
      // Hard hits scratch: a short back-and-forth on top of 33⅓ rpm.
      if (scratchGate(frame.time, frame.audio.onset && frame.response.impact > 0.6)) scratch = 1;
      scratch = Math.max(0, scratch - settleStep(frame) * 2.5);
      const rate = RPM / 60 * TAU * (1 - scratch * 1.6 * Math.sin(frame.time * 40));
      angle += rate * frame.delta;
      disc.rotation.y = -angle; spinner.rotation.y = -angle;
      // A warped-record wobble that only ever lifts the disc, so it never sinks into the platter.
      disc.position.y = (Math.sin(angle) * 0.5 + 0.5) * 0.06 * (1 + frame.response.bass * 3);
      // The stylus walks inward over four minutes, then lifts back to the lead-in.
      const progress = (frame.time / 240) % 1, radius = RECORD - 0.8 - progress * (RECORD - LABEL - 1.6);
      arm.rotation.y = -tonearmYaw(pivot, ARM + 1.6, radius);
      (dots.material as THREE.MeshBasicNodeMaterial).color.setHSL(wrap(frame.hue + 0.1, 0, 1), 1, 0.6).multiplyScalar(1.5 + frame.response.bounce);
      bandEnergies(frame, bands.length, bands);
      for (let i = 0; i < RING_BARS; i++) {
        // Mirrored left/right so lows sit at the back and highs at the front of the ring.
        const band = bands[Math.min(bands.length - 1, i < RING_BARS / 2 ? i : RING_BARS - 1 - i)];
        levels[i] = approach(levels[i], band, settleStep(frame), band > levels[i] ? 0.04 : 0.2);
        const a = i / RING_BARS * TAU - Math.PI / 2, height = 0.2 + levels[i] * 5;
        dummy.position.set(Math.cos(a) * (PLATTER + 2.4), height / 2, Math.sin(a) * (PLATTER + 2.4));
        dummy.rotation.set(0, -a, 0); dummy.scale.set(1, height, 1); dummy.updateMatrix();
        bars.setMatrixAt(i, dummy.matrix);
        bars.setColorAt(i, colour.setHSL(wrap(frame.hue + i / RING_BARS * 0.3, 0, 1), 1, 0.55).multiplyScalar(0.6 + levels[i] * 2));
      }
      bars.instanceMatrix.needsUpdate = true; bars.instanceColor!.needsUpdate = true;
      orbit += frame.delta * 0.06;
      camera.position.set(Math.sin(orbit) * 12 - 4, 29 + Math.sin(frame.time * 0.13) * 1.5, 33);
      camera.lookAt(3, -1, -1);
    },
    dispose() { disposeScene(scene); spectrum.dispose(); },
  };
}

// ---------------------------------------------------------------- ASCII / halftone terminal

/** 5×7 glyphs from empty to dense; `#` marks a lit pixel. */
export const GLYPHS: readonly (readonly string[])[] = [
  ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
  ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  ['.....', '#.#.#', '.###.', '#####', '.###.', '#.#.#', '.....'],
  ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  ['##..#', '##.#.', '...#.', '..#..', '.#...', '.#.##', '#..##'],
  ['.###.', '#...#', '#.###', '#.#.#', '#.###', '#....', '.###.'],
];
/** Packs the glyphs into one 50×7 luminance texture, row 0 at the top. */
export function glyphAtlas() {
  const width = GLYPHS.length * 5, data = new Uint8Array(width * 7);
  GLYPHS.forEach((glyph, g) => glyph.forEach((row, y) => { for (let x = 0; x < 5; x++) data[(6 - y) * width + g * 5 + x] = row[x] === '#' ? 255 : 0; }));
  const atlas = new THREE.DataTexture(data, width, 7, THREE.RedFormat, THREE.UnsignedByteType);
  atlas.minFilter = atlas.magFilter = THREE.NearestFilter; atlas.needsUpdate = true;
  return atlas;
}
const COLUMNS = 128;
/** Phosphor colours the terminal cycles through: green, amber, cyan. */
const PHOSPHORS = [[0.25, 1, 0.4], [1, 0.62, 0.12], [0.3, 0.85, 1]] as const;

export function createAsciiMode(): VisualMode {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2); camera.position.z = 1;
  const material = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  const atlas = glyphAtlas(), spectrum = createSpectrumTexture();
  const waveData = new Uint8Array(256), wave = new THREE.DataTexture(waveData, 256, 1, THREE.RedFormat, THREE.UnsignedByteType);
  wave.minFilter = wave.magFilter = THREE.LinearFilter; wave.needsUpdate = true;
  const aspect = uniform(16 / 9), time = uniform(0), style = uniform(0), phosphor = uniform(new THREE.Color(...PHOSPHORS[0])), bass = uniform(0);
  const logMapping = uniform(0), nyquist = uniform(24000);
  // Mild CRT barrel, then a character grid whose cells are 1.4× taller than wide.
  const centred = uv().sub(0.5), bent = centred.mul(centred.dot(centred).mul(0.12).add(1)).add(0.5);
  const rows = aspect.reciprocal().mul(COLUMNS / 1.4).floor();
  const grid = bent.mul(vec2(COLUMNS, rows)), cell = grid.floor(), inCell = fract(grid);
  const centre = cell.add(0.5).div(vec2(COLUMNS, rows));
  // The base field at each cell centre: spectrum bars, a waveform trace, and a slow plasma backdrop.
  const level = spectrumAxisNode(spectrum.texture, centre.x, logMapping, nyquist);
  const bar = centre.y.lessThan(level.mul(0.75)).select(float(0.55).add(centre.y.div(max(level, float(0.01))).mul(0.45)), float(0));
  const trace = texture(wave, vec2(centre.x, 0.5)).x.sub(0.5).mul(0.5).add(0.72);
  const line = centre.y.sub(trace).abs().smoothstep(0.035, 0.005);
  const plasma = mx_noise_float(vec3(centre.mul(vec2(3, 2)), time.mul(0.15))).mul(0.5).add(0.5).mul(0.2).mul(bass.mul(0.6).add(0.6));
  const intensity = max(max(bar, line), plasma).clamp(0, 0.999);
  // Glyph style: pick the glyph whose density matches, and read its pixel in the atlas.
  const glyph = intensity.mul(GLYPHS.length).floor();
  const pixel = inCell.mul(vec2(6, 8)).floor();
  const insideGlyph = pixel.x.lessThan(5).and(pixel.y.lessThan(7)).select(float(1), float(0));
  const lit = texture(atlas, vec2(glyph.mul(5).add(min(pixel.x, float(4))).add(0.5).div(GLYPHS.length * 5), min(pixel.y, float(6)).add(0.5).div(7))).x.mul(insideGlyph);
  // Halftone style: a dot per cell, its radius from the same intensity.
  const dot = inCell.sub(0.5).mul(vec2(1, 1.4)).length().lessThan(intensity.sqrt().mul(0.55)).select(float(1), float(0));
  const ink = mix(lit, dot, style);
  const scan = sin(uv().y.mul(rows.mul(8 * Math.PI))).mul(0.12).add(0.88);
  const vignette = centred.length().mul(1.5).smoothstep(1, 0.35);
  const outside = bent.x.lessThan(0).or(bent.x.greaterThan(1)).or(bent.y.lessThan(0)).or(bent.y.greaterThan(1)).select(float(0), float(1));
  const colour = phosphor.mul(ink.mul(intensity.mul(0.8).add(0.5)).mul(1.6)).add(phosphor.mul(0.012));
  material.fragmentNode = vec4(colour.mul(scan).mul(vignette).mul(outside), 1);
  const styleGate = beatGate(0.25);
  let beats = 0, styleTarget = 0, which = 0;
  return {
    scene, camera,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      spectrum.update(frame.audio.spectrum);
      logMapping.value = frame.spectrumMapping === 'log' ? 1 : 0; nyquist.value = frame.sampleRate / 2;
      const samples = frame.audio.waveform, stride = Math.max(1, Math.floor(samples.length / 256));
      // Reduced motion flattens the trace to the calmed level so it doesn't jitter.
      for (let i = 0; i < 256; i++) waveData[i] = frame.reducedMotion ? 128 : Math.max(0, Math.min(255, ((samples[i * stride] || 0) * 0.5 + 0.5) * 255));
      wave.needsUpdate = true;
      bass.value = approach(bass.value, frame.response.bounce, settleStep(frame), 0.15);
      if (styleGate(frame.time, frame.audio.onset)) {
        beats++;
        // Every 16 beats swap between glyphs and halftone; every 32 change phosphor.
        if (beats % 16 === 0) styleTarget = 1 - styleTarget;
        if (beats % 32 === 0) which = (which + 1) % PHOSPHORS.length;
      }
      style.value = approach(style.value, styleTarget, settleStep(frame), 0.4);
      const [r, g, b] = PHOSPHORS[which];
      phosphor.value.setRGB(r, g, b).lerp(new THREE.Color().setHSL(wrap(frame.hue, 0, 1), 0.8, 0.55), 0.15);
    },
    dispose() { disposeScene(scene); atlas.dispose(); spectrum.dispose(); wave.dispose(); },
  };
}

// ---------------------------------------------------------------- LED segment bar analyzer

export const LED_BARS = 32, LED_SEGMENTS = 24;
/** Segment colour band: green to 60%, amber to 85%, red above. */
export const ledZone = (segment: number) => segment < LED_SEGMENTS * 0.6 ? 0 : segment < LED_SEGMENTS * 0.85 ? 1 : 2;
const LED_COLOURS = [[0.15, 1, 0.3], [1, 0.7, 0.05], [1, 0.12, 0.08]] as const;

export function createLedAnalyzerMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  const count = LED_BARS * LED_SEGMENTS, width = 2, height = 0.62, left = -(LED_BARS - 1) * width / 2;
  const segment = new THREE.BoxGeometry(1.7, 0.46, 0.25);
  const leds = new THREE.InstancedMesh(segment, new THREE.MeshBasicNodeMaterial({ color: 0xffffff }), count);
  // The reflection: the same LEDs mirrored below the shelf, dimmed toward the viewer.
  const reflection = new THREE.InstancedMesh(segment, new THREE.MeshBasicNodeMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 }), count);
  const dummy = new THREE.Object3D();
  for (let b = 0; b < LED_BARS; b++) for (let s = 0; s < LED_SEGMENTS; s++) {
    const i = b * LED_SEGMENTS + s;
    dummy.position.set(left + b * width, 0.5 + s * height, 0); dummy.updateMatrix(); leds.setMatrixAt(i, dummy.matrix);
    dummy.position.set(left + b * width, -0.5 - s * height, 0); dummy.updateMatrix(); reflection.setMatrixAt(i, dummy.matrix);
  }
  // Brushed panel behind and a glossy shelf the reflection sits in.
  const panelMaterial = new THREE.MeshBasicNodeMaterial();
  panelMaterial.colorNode = vec3(0.012, 0.012, 0.016).add(mx_noise_float(vec3(positionLocal.x.mul(0.05), positionLocal.y.mul(6), 0)).mul(0.004));
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(260, 140), panelMaterial); panel.position.set(0, 6, -1.2);
  const shelfMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, opacity: 0.85 });
  shelfMaterial.colorNode = mix(vec3(0.01, 0.01, 0.014), vec3(0.002, 0.002, 0.004), uv().y);
  const shelf = new THREE.Mesh(new THREE.PlaneGeometry(260, 60), shelfMaterial); shelf.position.set(0, -30, 0.3);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(LED_BARS * width + 2, 0.12, 0.4), new THREE.MeshBasicNodeMaterial({ color: 0x4a4d58 })); trim.position.y = 0;
  scene.add(panel, reflection, shelf, leds, trim);
  const levels = new Float32Array(LED_BARS), peaks = new Float32Array(LED_BARS), holds = new Float32Array(LED_BARS), bands = new Float32Array(LED_BARS), colour = new THREE.Color();
  let drift = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      bandEnergies(frame, LED_BARS, bands);
      const step = settleStep(frame);
      for (let b = 0; b < LED_BARS; b++) {
        const target = Math.min(1, bands[b] + frame.response.bounce * 0.05);
        // Fast attack, slower release; the peak marker holds, then falls.
        levels[b] = approach(levels[b], target, step, target > levels[b] ? 0.02 : 0.18);
        if (levels[b] >= peaks[b]) { peaks[b] = levels[b]; holds[b] = 0.6; }
        else if ((holds[b] -= step) < 0) peaks[b] = Math.max(levels[b], peaks[b] - step * 0.35);
        const lit = levels[b] * LED_SEGMENTS, peak = Math.min(LED_SEGMENTS - 1, Math.floor(peaks[b] * LED_SEGMENTS - 0.001));
        for (let s = 0; s < LED_SEGMENTS; s++) {
          const [r, g, bl] = LED_COLOURS[ledZone(s)], on = s < lit ? 1 : 0, isPeak = s === peak && peaks[b] > 0.04;
          const glow = on ? 1.8 : isPeak ? 2.4 : 0.05;
          colour.setRGB(r * glow, g * glow, bl * glow);
          leds.setColorAt(b * LED_SEGMENTS + s, colour);
          reflection.setColorAt(b * LED_SEGMENTS + s, colour.multiplyScalar(Math.max(0, 1 - s / 10)));
        }
      }
      leds.instanceColor!.needsUpdate = true; reflection.instanceColor!.needsUpdate = true;
      drift += frame.delta * 0.08;
      camera.position.set(Math.sin(drift) * 6, 5 + Math.sin(drift * 0.7) * 1.2, 36);
      camera.lookAt(0, 5, 0);
    },
    dispose: () => disposeScene(scene),
  };
}

