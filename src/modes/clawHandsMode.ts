import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { atan, exp, float, max, mix, mx_noise_float, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { VisualMode } from './types';
import { disposeScene, approach, settleStep } from './shared';
import { fullscreen, hash2 } from './shaderModes';
import { createHits, variantSequence } from './hitPulse';
import { createHand, type HandPose } from './handModel';

type F = Node<'float'>;
type V3 = Node<'vec3'>;

/** The gesture library: open splay, claw curl, fist, pinch, wave, pointing and the fingertip "spider". */
export const CLAW_GESTURES: readonly HandPose[] = [
  { curl: [0.05, 0.02, 0.05, 0.1], thumb: 0.05, spread: 0.25, claw: 3.6 },
  { curl: [0.55, 0.6, 0.6, 0.55], thumb: 0.4, spread: 0.15, claw: 3.4 },
  { curl: [0.95, 1, 1, 0.95], thumb: 0.85, spread: 0, claw: 2.4 },
  { curl: [0.6, 0.25, 0.2, 0.2], thumb: 0.7, spread: 0.05, claw: 3.2 },
  { curl: [0.15, 0.1, 0.15, 0.2], thumb: 0.2, spread: 0.3, claw: 3.6 },
  { curl: [0, 0.9, 0.95, 0.95], thumb: 0.6, spread: 0, claw: 3.6 },
  { curl: [0.35, 0.35, 0.35, 0.35], thumb: 0.5, spread: 0.02, claw: 3.2 },
];

/** Two-hand arrangements: wrist position (x, y), roll, and whether the second hand is in frame. X-cross first. */
export const CLAW_LAYOUTS = [
  [[-0.11, -0.04, 0.45], [0.11, -0.04, -0.45]],
  [[-0.17, -0.06, 0.08], [0.17, -0.06, -0.08]],
  [[0.02, -0.07, 0.1], [9, 0, 0]],
  [[-0.08, 0.06, -1.2], [-0.02, -0.12, -1.35]],
] as const;

/**
 * Claw Hands (wave 5, clip 11): two pale forearms crossing up from the bottom of a red frame, with long black
 * claws. The hands never stop moving (fingers splay, curl and cross); each kick cuts to a new gesture and
 * arrangement and flips between a lit view (palms to the camera, skin, veins) and a silhouette (backs of the
 * hands, near black with a red rim). Rays behind them flicker with the hats; a red border glitches on cuts.
 */
export function createClawHandsMode(): VisualMode {
  const { scene, camera, material } = fullscreen();
  const aspect = uniform(1), time = uniform(0), lit = uniform(1), rays = uniform(0.4), border = uniform(0), borderSeed = uniform(0), keyGain = uniform(1);
  const hands = [createHand({ claws: true }), createHand({ claws: true })];
  const p = uv().sub(0.5).mul(vec2(aspect, 1));
  // Background: a red gradient brightest behind the hands, with radial rays fanning from below centre.
  const fromBase = p.sub(vec2(0, -0.25)), angle = atan(fromBase.x, fromBase.y);
  const fan = mx_noise_float(vec2(angle.mul(9), time.mul(0.4))).mul(0.5).add(0.5).pow(3).mul(exp(fromBase.length().div(0.6).negate()));
  let colour: V3 = mix(vec3(0.03, 0.002, 0.002), vec3(0.45, 0.02, 0.015), exp(p.sub(vec2(0, 0.05)).length().div(0.45).negate())).add(vec3(0.6, 0.03, 0.02).mul(fan.mul(rays)));
  // The hands are traced into a smaller offscreen target (the march is the expensive part; a Retina-size
  // fullscreen trace of two clawed hands can stall the GPU) and composited over the background here.
  const handTarget = new THREE.RenderTarget(960, 540, { type: THREE.HalfFloatType, depthBuffer: false });
  const handMaterial = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  const handPass = new THREE.QuadMesh(handMaterial);
  // Trace both hands and keep the nearer hit.
  const traced = hands.map((hand) => ({ hand, ...hand.trace(p) }));
  let hit: F = float(0), pos: V3 = vec3(0), normal: V3 = vec3(0, 0, 1), claw: F = float(0), closest: F = float(1e3), occlusion: F = float(1);
  for (const t of traced) {
    const nearer = t.hit.greaterThan(0.5).and(hit.lessThan(0.5).or(t.pos.z.greaterThan(pos.z)));
    pos = nearer.select(t.pos, pos); normal = nearer.select(t.normal, normal); occlusion = nearer.select(t.occlusion, occlusion);
    claw = nearer.select(t.claw, claw);
    hit = max(hit, t.hit); closest = closest.min(t.closest);
  }
  // Lit view: a red-white key from the front left with a soft wrap, pale skin with veins and fine creases.
  const key = vec3(-0.45, 0.5, 0.75).normalize(), back = vec3(0.2, 0.3, -1).normalize();
  const wrap = normal.dot(key).add(0.35).div(1.35).max(0);
  const creases = mx_noise_float(pos.mul(vec3(90, 260, 90))).mul(0.5).add(0.5);
  const veins = float(1).sub(mx_noise_float(pos.mul(vec3(14, 4, 14))).abs()).pow(30);
  const skin = mix(vec3(0.95, 0.42, 0.38), vec3(0.7, 0.16, 0.14), veins.mul(0.22)).mul(creases.mul(0.25).add(0.75));
  const rim = normal.z.abs().oneMinus().pow(3);
  const litSkin = skin.mul(wrap.mul(keyGain).mul(1.1).add(0.08)).mul(occlusion.mul(0.5).add(0.5)).add(vec3(1, 0.15, 0.1).mul(rim.mul(0.5)));
  // Silhouette view: backlit, nearly black with a hot red rim.
  const backRim = normal.dot(back).negate().max(0).pow(2).add(rim.mul(0.8));
  const silhouette = vec3(0.02, 0.003, 0.003).add(vec3(1, 0.08, 0.05).mul(backRim.mul(1.4)));
  // Claws: glossy black with a sharp highlight.
  const half = key.add(vec3(0, 0, 1)).normalize();
  const gloss = normal.dot(half).max(0).pow(60);
  const nail = vec3(0.008, 0.002, 0.002).add(vec3(1, 0.5, 0.45).mul(gloss.mul(mix(float(0.3), float(1.2), lit)))).add(vec3(0.8, 0.05, 0.03).mul(rim.mul(0.3)));
  const handColour = mix(mix(silhouette, litSkin, lit), nail, claw);
  // A soft red bloom just outside the silhouette, stronger in the backlit view.
  const halo = exp(closest.max(0).div(0.02).negate()).mul(hit.oneMinus()).mul(mix(float(0.5), float(0.12), lit));
  handMaterial.fragmentNode = vec4(mix(vec3(0.9, 0.05, 0.03).mul(halo), handColour, hit), hit);
  const hand = texture(handTarget.texture, uv());
  colour = colour.mul(hand.a.oneMinus()).add(hand.rgb);
  // The glitch border: a thick red frame flickering in on cuts, broken into blocks on random sides.
  const edge = vec2(p.x.abs().sub(aspect.mul(0.5)), p.y.abs().sub(0.5)).max(vec2(-1)).x.max(p.y.abs().sub(0.5));
  const blocks = hash2(vec2(p.x.mul(6).floor().add(p.y.mul(6).floor().mul(7)), borderSeed)).greaterThan(0.45);
  colour = mix(colour, vec3(0.9, 0.04, 0.02), edge.smoothstep(-0.05, -0.035).mul(blocks.select(float(1), float(0))).mul(border));
  material.fragmentNode = vec4(colour, 1);

  const hits = createHits({ decay: 0.15, interval: 0.25 }), gestures = [variantSequence(CLAW_GESTURES.length, 3), variantSequence(CLAW_GESTURES.length, 8)], layouts = variantSequence(CLAW_LAYOUTS.length, 6);
  const live = [{ ...CLAW_GESTURES[0], curl: [...CLAW_GESTURES[0].curl] }, { ...CLAW_GESTURES[1], curl: [...CLAW_GESTURES[1].curl] }] as { curl: number[]; thumb: number; spread: number; claw: number }[];
  const place = CLAW_LAYOUTS[0].map(([x, y, roll]): { x: number; y: number; roll: number } => ({ x, y, roll }));
  let layout = 0, litTarget = 1, wiggle = 0, push = 0;
  return {
    scene, camera,
    simulate(renderer) {
      const prior = renderer.getRenderTarget();
      renderer.setRenderTarget(handTarget); handPass.render(renderer); renderer.setRenderTarget(prior);
    },
    update(frame) {
      aspect.value = frame.aspect; time.value = frame.time;
      const height = 540, width = Math.round(height * frame.aspect);
      if (handTarget.width !== width) handTarget.setSize(width, height);
      const step = settleStep(frame), motion = frame.reducedMotion ? 0 : frame.delta, { bass, bounce } = frame.response;
      hits.update(frame, 0.1);
      if (hits.fired) {
        // A cut: new gestures, a new arrangement, and the lit/silhouette flip.
        gestures.forEach((g) => g.next());
        if (hits.count % 2 === 0) layout = layouts.next();
        litTarget = 1 - litTarget;
        border.value = frame.reducedFlash ? 0.4 : 1; borderSeed.value = Math.random() * 100;
      }
      border.value *= Math.exp(-step / 0.12);
      // Reduced flash softens the lit/silhouette cut into a quick fade.
      lit.value = frame.reducedFlash ? approach(lit.value, litTarget, step, 0.12) : litTarget;
      wiggle += motion * (2 + frame.audio.mid * 5);
      push = approach(push, bass, step, 0.15);
      const scale = 0.2 * (1 + push * 0.12);
      hands.forEach((hand, i) => {
        const goal = CLAW_GESTURES[gestures[i].current], pose = live[i];
        // Glide toward the gesture, with fingers wiggling on the mids so the hands never sit still.
        for (let f = 0; f < 4; f++) pose.curl[f] = approach(pose.curl[f], goal.curl[f], step, 0.12);
        pose.thumb = approach(pose.thumb, goal.thumb, step, 0.12); pose.spread = approach(pose.spread, goal.spread, step, 0.12); pose.claw = approach(pose.claw, goal.claw ?? 3.2, step, 0.2);
        const amount = 0.08 + frame.audio.mid * 0.25 + bounce * 0.1;
        const curl = pose.curl.map((c, f) => Math.min(1.05, Math.max(-0.1, c + Math.sin(wiggle + f * 0.9 + i * 2) * amount))) as [number, number, number, number];
        const target = CLAW_LAYOUTS[layout][i];
        place[i].x = approach(place[i].x, target[0], step, 0.1); place[i].y = approach(place[i].y, target[1], step, 0.1); place[i].roll = approach(place[i].roll, target[2], step, 0.1);
        const sway = Math.sin(frame.time * 0.9 + i * 1.7) * 0.012, turn = Math.sin(frame.time * 0.6 + i) * 0.08;
        // Lit view shows palms (the hand model's palm faces the camera); the silhouette view turns them round.
        const yaw = (1 - lit.value) * Math.PI;
        const matrix = new THREE.Matrix4().compose(new THREE.Vector3(place[i].x + sway, place[i].y + Math.cos(frame.time * 0.7 + i) * 0.01, 0),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, yaw, place[i].roll + turn, 'ZYX')), new THREE.Vector3(i ? -scale : scale, scale, scale));
        hand.pose({ curl, thumb: pose.thumb, spread: pose.spread, claw: pose.claw, wrist: Math.sin(frame.time * 0.8 + i) * 0.15 }, matrix);
      });
      rays.value = approach(rays.value, 0.25 + frame.audio.highs * 0.8 * (0.6 + Math.random() * 0.4), step, 0.04);
      keyGain.value = approach(keyGain.value, 0.85 + hits.flash * 0.3, step, 0.05);
    },
    dispose() { disposeScene(scene); handMaterial.dispose(); handTarget.dispose(); },
  };
}
