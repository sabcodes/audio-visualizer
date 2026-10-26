import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { Fn, If, Loop, float, fract, max, min, mix, texture, uniform, uniformArray, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import { disposeScene, approach, settleStep } from './shared';
import { fullscreen, hash2 } from './shaderModes';
import { createHits, variantSequence } from './hitPulse';
import { isSnare, sectionWatch } from './waveSixShared';
import { FONT, FONT_CHARS } from './slotHallMode';
import { seededRandom } from '../rendering/diagnostics';
import butterflyBlueUrl from '../assets/blob-track/butterfly-blue.jpg?url';
import butterflyOrangeUrl from '../assets/blob-track/butterfly-orange.jpg?url';
import blossomBranchUrl from '../assets/blob-track/blossom-branch.jpg?url';
import blossomBeeUrl from '../assets/blob-track/blossom-bee.jpg?url';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;

/** The bundled photos (Unsplash License, see src/assets/blob-track/LICENSE.md); blossoms get the dark bouquet treatment. */
export const BLOB_IMAGES = [
  { url: butterflyBlueUrl, cutout: false }, { url: blossomBranchUrl, cutout: true }, { url: butterflyOrangeUrl, cutout: false }, { url: blossomBeeUrl, cutout: true },
] as const;
/** Colour variants per image: hue turns applied to the saturated subject (0 = as shot). */
export const BLOB_VARIANTS = [0, 0.12, -0.18, 0.45] as const;
/** Box effects: invert, purple tint, offset copy, white fill, X-crossed outline, numbered label, scrap of the next picture. */
export const BOX_EFFECTS = 7;
export const MAX_BOXES = 40;
/** Transitions: boxes multiply and reveal the next image, a lines-only blackout then cut, a box-by-box wipe. */
export const BLOB_TRANSITIONS = ['boxes', 'lines', 'wipe'] as const;
const SAL_W = 96, SAL_H = 54;

/**
 * Where the detail is: a coarse map of edge strength plus colour, from an image or a video frame drawn small.
 * Boxes are then drawn from it in proportion to its square, so they land on the butterfly and the blossoms.
 */
export function saliencyMap(pixels: Uint8ClampedArray, width: number, height: number) {
  const map = new Float32Array(width * height), luma = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) luma[i] = (pixels[i * 4] * 0.3 + pixels[i * 4 + 1] * 0.59 + pixels[i * 4 + 2] * 0.11) / 255;
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x, gx = luma[i + 1] - luma[i - 1], gy = luma[i + width] - luma[i - width];
    const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2], saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    // Edges dominate, so soft bokeh highlights don't attract boxes.
    map[i] = Math.hypot(gx, gy) * 4 + saturation * 0.15;
  }
  return map;
}
/** Picks `count` box centres (x, y in 0–1, y up) weighted by the map's square. */
export function pickBoxes(map: Float32Array, width: number, height: number, count: number, random: () => number) {
  let total = 0; for (const v of map) total += v * v;
  const out: [number, number][] = [];
  for (let n = 0; n < count; n++) {
    let target = random() * total, i = 0;
    while (i < map.length - 1 && target > map[i] * map[i]) { target -= map[i] * map[i]; i++; }
    out.push([((i % width) + random()) / width, 1 - (Math.floor(i / width) + random()) / height]);
  }
  // Chain them nearest-neighbour first, so the joining lines stay short.
  for (let k = 1; k < out.length; k++) {
    let best = k, bestDistance = Infinity;
    for (let j = k; j < out.length; j++) { const d = Math.hypot(out[j][0] - out[k - 1][0], out[j][1] - out[k - 1][1]); if (d < bestDistance) { bestDistance = d; best = j; } }
    [out[k], out[best]] = [out[best], out[k]];
  }
  return out;
}

/**
 * Blob Track (wave 6, #13): "blob tracking" boxes over a photo, after the TouchDesigner trend. Tracked rectangles
 * sit on the most detailed spots, each with a number or an effect (inverted, tinted purple, an offset copy, a white
 * fill, crossed out, a scrap of another picture), joined by thin lines. Sources are the four bundled photos, each
 * also in recoloured variants, or the webcam when the "Webcam source" box is ticked (asked only then; frames stay
 * in the browser). Kicks lay a new set of boxes, snares flash a lines-only frame, hats jitter the boxes, bass grows
 * them, loudness adds more; a drop or the timer moves to the next picture or variant.
 */
export function createBlobTrackMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const random = seededRandom(1313);
  const aspect = uniform(16 / 9), time = uniform(0), imageAspect = uniform(1.5), nextAspect = uniform(1.5), hue = uniform(0), nextHue = uniform(0);
  const cutout = uniform(0), nextCutout = uniform(0), progress = uniform(0), style = uniform(0), linesOnly = uniform(0), mirror = uniform(0);
  const blank = new THREE.DataTexture(new Uint8Array([20, 20, 24, 255]), 1, 1); blank.needsUpdate = true;
  const current = texture(blank), next = texture(blank);
  const boxes = Array.from({ length: MAX_BOXES }, () => new THREE.Vector4(-9, -9, 0, 0)), extras = Array.from({ length: MAX_BOXES }, () => new THREE.Vector4());
  const boxData = uniformArray(boxes, 'vec4'), extraData = uniformArray(extras, 'vec4'), boxCount = uniform(0);
  // Number font for the labels.
  const font = new Uint8Array(FONT_CHARS.length * 5 * 7);
  FONT_CHARS.forEach((c, i) => { for (let k = 0; k < 35; k++) font[(6 - Math.floor(k / 5)) * FONT_CHARS.length * 5 + i * 5 + (k % 5)] = FONT[c][k] === '1' ? 255 : 0; });
  const fontMap = new THREE.DataTexture(font, FONT_CHARS.length * 5, 7, THREE.RedFormat, THREE.UnsignedByteType); fontMap.minFilter = fontMap.magFilter = THREE.NearestFilter; fontMap.needsUpdate = true;
  const zeroIndex = FONT_CHARS.indexOf('0');

  const p = uv(), s = p.sub(0.5).mul(vec2(aspect, 1));
  // Cover-fit a picture to the frame.
  const fit = (q: V2, ratio: F) => { const scale = max(aspect.div(ratio), float(1)); return q.sub(0.5).mul(vec2(aspect.div(ratio).div(scale), float(1).div(scale))).add(0.5); };
  const hueTurn = (c: V3, turn: F) => {
    // Rotate hue about the grey axis, only for saturated pixels outside the green background band.
    const k = vec3(0.57735), angle = turn.mul(Math.PI * 2), cosA = angle.cos(), sinA = angle.sin();
    const turned = c.mul(cosA).add(k.cross(c).mul(sinA)).add(k.mul(k.dot(c)).mul(cosA.oneMinus()));
    const top = max(c.r, max(c.g, c.b)), saturation = top.sub(min(c.r, min(c.g, c.b))).div(top.max(1e-3));
    const greenish = c.g.greaterThan(c.r.mul(1.1)).and(c.g.greaterThan(c.b.mul(1.1)));
    return mix(c, turned.max(vec3(0)), saturation.smoothstep(0.2, 0.45).mul(greenish.select(float(0), float(1))));
  };
  const picture = (tex: typeof current, q: V2, ratio: F, turn: F, cut: F) => {
    const at = fit(vec2(mix(q.x, q.x.oneMinus(), mirror), q.y), ratio);
    const raw = tex.sample(at).rgb, c = hueTurn(raw, turn);
    // Blossoms: the soft background falls away to near-black, so the bouquet reads as a cut-out.
    const luma = c.dot(vec3(0.3, 0.59, 0.11));
    return mix(c, c.mul(luma.smoothstep(0.2, 0.5)).mul(0.9).add(0.012), cut);
  };
  const a = picture(current, p, imageAspect, hue, cutout), b = picture(next, p, nextAspect, nextHue, nextCutout);
  // Transitions: "boxes" and "wipe" switch cells of a grid from A to B; "lines" blacks out to the outlines.
  const cell = p.mul(vec2(aspect.mul(9), 9)).floor(), order = style.equal(2).select(cell.x.add(cell.y.mul(0.3)).div(aspect.mul(9).add(3)), hash2(cell));
  let base: V3 = mix(a, b, order.lessThan(progress).select(float(1), float(0)));
  // The boxes, effects, numbers and the lines joining them.
  const overlay = Fn(() => {
    const colour = base.toVar(), ink = float(0).toVar(), line = float(0).toVar();
    Loop(MAX_BOXES, ({ i }) => {
      If(float(i).lessThan(boxCount), () => {
        const box = boxData.element(i) as unknown as Node<'vec4'>, extra = extraData.element(i) as unknown as Node<'vec4'>;
        const centre = box.xy.sub(0.5).mul(vec2(aspect, 1)), half = box.zw.mul(0.5);
        const d = s.sub(centre).abs().sub(half), inside = d.x.lessThan(0).and(d.y.lessThan(0));
        const border = d.x.max(d.y).abs().lessThan(0.0016);
        const local = s.sub(centre).div(box.zw).add(0.5);
        const effect = extra.x;
        If(inside, () => {
          const offsetCopy = picture(current, p.add(vec2(extra.z, extra.w).mul(0.08)), imageAspect, hue.add(0.5), cutout);
          const scrap = picture(next, local, nextAspect, nextHue, float(0));
          const effected = effect.equal(0).select(vec3(1).sub(colour), effect.equal(1).select(colour.mul(vec3(0.55, 0.25, 1.4)).add(vec3(0.12, 0.02, 0.3)),
            effect.equal(2).select(offsetCopy, effect.equal(3).select(vec3(0.7), effect.equal(4).select(colour, effect.equal(5).select(vec3(0.02, 0.03, 0.12), scrap))))));
          colour.assign(effected);
          // X-crossed boxes: both diagonals.
          If(effect.equal(4), () => { ink.assign(max(ink, local.x.sub(local.y).abs().min(local.x.add(local.y).sub(1).abs()).lessThan(0.025).select(float(1), float(0)))); });
          // Numbered boxes: the index in the middle.
          If(effect.equal(5).or(effect.equal(1)), () => {
            const glyph = local.sub(vec2(0.4, 0.3)).div(vec2(0.2, 0.4)).mul(vec2(5, 7)).floor();
            const code = float(zeroIndex).add(extra.y);
            const bit = texture(fontMap, vec2(code.mul(5).add(glyph.x.clamp(0, 4)).add(0.5).div(FONT_CHARS.length * 5), glyph.y.clamp(0, 6).add(0.5).div(7))).r;
            ink.assign(max(ink, bit.mul(glyph.x.greaterThanEqual(0).and(glyph.x.lessThan(5)).and(glyph.y.greaterThanEqual(0)).and(glyph.y.lessThan(7)).select(float(1), float(0)))));
          });
        });
        If(border, () => { ink.assign(1); });
        // A thin line to the next box in the chain.
        If(float(i).add(1).lessThan(boxCount), () => {
          const other = boxData.element(i.add(1)) as unknown as Node<'vec4'>;
          const pa = s.sub(centre), ba = other.xy.sub(0.5).mul(vec2(aspect, 1)).sub(centre);
          const h = pa.dot(ba).div(ba.dot(ba).max(1e-6)).clamp(0, 1);
          line.assign(max(line, pa.sub(ba.mul(h)).length().lessThan(0.0012).select(float(1), float(0))));
        });
      });
    });
    // Lines-only frames: everything goes black but the outlines and lines.
    const shown = mix(colour, vec3(0.012), linesOnly);
    return mix(shown, vec3(0.8), max(ink, line).mul(0.85));
  });
  material.fragmentNode = vec4(overlay(), 1);

  // Pictures: loaded in the browser (not under unit tests), each with its saliency map.
  const pictures: { texture: THREE.Texture; map: Float32Array; ratio: number; cutout: boolean }[] = [];
  const canvas = typeof document === 'undefined' ? undefined : document.createElement('canvas');
  const context = canvas?.getContext('2d', { willReadFrequently: true }) ?? undefined;
  if (canvas) { canvas.width = SAL_W; canvas.height = SAL_H; }
  const mapOf = (source: CanvasImageSource) => { if (!context) return new Float32Array(SAL_W * SAL_H).fill(1); context.drawImage(source, 0, 0, SAL_W, SAL_H); return saliencyMap(context.getImageData(0, 0, SAL_W, SAL_H).data, SAL_W, SAL_H); };
  const loader = new THREE.TextureLoader();
  const ready = typeof document === 'undefined' ? Promise.resolve() : Promise.all(BLOB_IMAGES.map((image) => loader.loadAsync(image.url).then((loaded) => {
    loaded.colorSpace = THREE.SRGBColorSpace;
    const element = loaded.image as HTMLImageElement;
    return { texture: loaded, map: mapOf(element), ratio: element.width / element.height, cutout: image.cutout };
  }))).then((loaded) => { pictures.push(...loaded); show(0, 0); }).catch(() => undefined);

  // Webcam: only when the box is ticked; the stream stops when it's unticked or the mode closes.
  const toggle = typeof document === 'undefined' ? null : document.getElementById('blob-webcam') as HTMLInputElement | null;
  const timerControl = typeof document === 'undefined' ? null : document.getElementById('blob-timer') as HTMLInputElement | null;
  let stream: MediaStream | undefined, video: HTMLVideoElement | undefined, camTexture: THREE.VideoTexture | undefined, camMap: Float32Array | undefined, camClock = 0;
  const stopCamera = () => {
    stream?.getTracks().forEach((track) => track.stop()); stream = undefined;
    camTexture?.dispose(); camTexture = undefined; video = undefined; camMap = undefined; mirror.value = 0;
    if (pictures.length) show(shown, variant);
  };
  const startCamera = async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
      video = document.createElement('video'); video.muted = true; video.playsInline = true; video.srcObject = stream; await video.play();
      camTexture = new THREE.VideoTexture(video); camTexture.colorSpace = THREE.SRGBColorSpace;
      current.value = next.value = camTexture; imageAspect.value = nextAspect.value = video.videoWidth / Math.max(1, video.videoHeight);
      hue.value = nextHue.value = 0; cutout.value = nextCutout.value = 0; mirror.value = 1; progress.value = 0;
    } catch { if (toggle) toggle.checked = false; stopCamera(); }
  };
  const onToggle = () => { if (toggle?.checked) void startCamera(); else stopCamera(); };
  toggle?.addEventListener('change', onToggle);
  if (toggle?.checked) void startCamera();

  // Picture and variant cycling: never the same look twice running.
  const looks = variantSequence(BLOB_IMAGES.length * BLOB_VARIANTS.length, 77), styles = variantSequence(BLOB_TRANSITIONS.length, 78), section = sectionWatch(600, 8);
  let shown = 0, variant = 0, pending = -1, transitionAge = -1, sinceChange = 0, labelBase = 0;
  const show = (image: number, look: number) => {
    const picture = pictures[image]; if (!picture || camTexture) return;
    shown = image; variant = look;
    current.value = picture.texture; imageAspect.value = picture.ratio; hue.value = BLOB_VARIANTS[look]; cutout.value = picture.cutout ? 1 : 0;
  };
  const begin = () => {
    if (!pictures.length || camTexture || transitionAge >= 0) return;
    const pick = looks.next(); pending = pick;
    const picture = pictures[Math.floor(pick / BLOB_VARIANTS.length)];
    next.value = picture.texture; nextAspect.value = picture.ratio; nextHue.value = BLOB_VARIANTS[pick % BLOB_VARIANTS.length]; nextCutout.value = picture.cutout ? 1 : 0;
    style.value = styles.next(); transitionAge = 0; sinceChange = 0;
  };
  const layBoxes = (count: number, size: number) => {
    const map = camMap ?? pictures[shown]?.map; if (!map) return;
    const ratio = camTexture ? imageAspect.value : pictures[shown].ratio;
    const centres = pickBoxes(map, SAL_W, SAL_H, count, random);
    labelBase = (labelBase + count) % 10;
    // Image space → frame UV through the same cover fit as the shader.
    const fitScale = Math.max(aspect.value / ratio, 1), sx = aspect.value / ratio / fitScale, sy = 1 / fitScale;
    centres.forEach(([x, y], k) => {
      const fx = camTexture ? 1 - x : x;
      const u = (fx - 0.5) / sx + 0.5, v = (y - 0.5) / sy + 0.5, w = (0.03 + random() * 0.07) * size, h = w * (0.6 + random() * 0.8);
      boxes[k].set(u, v, w, h);
      extras[k].set(Math.floor(random() * BOX_EFFECTS), (labelBase + k) % 10, random() - 0.5, random() - 0.5);
    });
    boxCount.value = count;
  };
  const hits = createHits({ decay: 0.1, interval: 0.2 });
  let lineFlash = 0, jitterClock = 0, size = 1;
  return {
    scene, camera, ready,
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      const step = settleStep(frame), { bass, loudness, impact } = frame.response;
      hits.update(frame, 0.1);
      size = approach(size, 0.8 + bass * 0.9, step, 0.15);
      // Webcam: refresh where the detail is every few frames so the boxes follow movement.
      if (video && camTexture) { camClock -= step; if (camClock <= 0 && video.readyState >= 2) { camMap = mapOf(video); camClock = 0.2; } }
      if (hits.fired) {
        if (isSnare(frame)) lineFlash = 1;
        else layBoxes(Math.min(MAX_BOXES, Math.round(6 + loudness * 14 + impact * 6)), size);
      }
      if (boxCount.value === 0 && (pictures.length || camMap)) layBoxes(10, size);
      lineFlash = Math.max(0, lineFlash - step / 0.1);
      linesOnly.value = Math.max(lineFlash > 0 ? 1 : 0, style.value === 1 && transitionAge >= 0 && transitionAge < 0.45 ? 1 : 0) * (frame.reducedFlash ? 0.85 : 1);
      // Hats: the boxes jitter a step.
      jitterClock -= step;
      if (frame.audio.highs > 0.45 && jitterClock <= 0) {
        for (let k = 0; k < boxCount.value; k++) { boxes[k].x += (random() - 0.5) * 0.012; boxes[k].y += (random() - 0.5) * 0.012; }
        jitterClock = 0.1;
      }
      // A drop or the timer (the slider, default 30 s) moves on to the next picture or colour variant.
      sinceChange += step;
      const timer = Number(timerControl?.value ?? 30);
      if (section(frame) || sinceChange > timer) begin();
      if (transitionAge >= 0) {
        transitionAge += step;
        progress.value = style.value === 1 ? (transitionAge > 0.45 ? 1 : 0) : Math.min(1, transitionAge / 0.9);
        if (style.value === 0 && hits.fired) layBoxes(MAX_BOXES, size * 1.4);
        if (transitionAge > 1) {
          show(Math.floor(pending / BLOB_VARIANTS.length), pending % BLOB_VARIANTS.length);
          progress.value = 0; transitionAge = -1;
        }
      }
    },
    dispose() {
      toggle?.removeEventListener('change', onToggle); stopCamera();
      disposeScene(scene); blank.dispose(); fontMap.dispose(); pictures.forEach((picture) => picture.texture.dispose());
    },
  };
}
