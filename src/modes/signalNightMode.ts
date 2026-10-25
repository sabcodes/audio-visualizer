import * as THREE from 'three/webgpu';
import { float, mx_fractal_noise_float, positionWorld, uniform, uv, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep } from './shared';
import { createGlowPoints, loadTexture, shaftMaterial } from './figures';
import { createCinematic } from './cinematic';
import { createHits, linearRgb } from './hitPulse';
import { seededRandom } from '../rendering/diagnostics';
import emberUrl from '../assets/fx/ember.png?url';

/** Signal Night hit variants: one colour per moving head, the street grade, and how hard the grade flips. */
export const SIGNAL_VARIANTS = [
  { beams: [0x7cff4a, 0xffe0f0, 0x7cff4a, 0x7cff4a, 0xffe0f0], grade: 0x0f2630, red: 0 },
  { beams: [0xffb02e, 0xff3a2a, 0xffb02e, 0xff3a2a, 0xffb02e], grade: 0x0f2630, red: 0 },
  { beams: [0xfff0dc, 0xffd8e8, 0xfff0dc, 0xffd8e8, 0xfff0dc], grade: 0x12262c, red: 0 },
  { beams: [0xff3a2a, 0xff3a2a, 0xffb02e, 0xff3a2a, 0xff3a2a], grade: 0x2a0606, red: 1 },
  { beams: [0x7cff4a, 0xffb02e, 0x7cff4a, 0xff7ab0, 0x7cff4a], grade: 0x0a1c2c, red: 0 },
] as const;

/** Moving heads at the frame edges: position and the direction they sweep around. */
export const MOVING_HEADS = [
  { at: [-6.2, 8.6, -2], aim: [6, 10, -12] },
  { at: [-1.8, 9.4, -3], aim: [9, 8, -10] },
  { at: [-6.6, 4.4, -2], aim: [8, 6, -12] },
  { at: [5.6, 1.6, -2], aim: [-8, 6.5, -11] },
  { at: [6.4, 6.6, -3], aim: [-9, 4.5, -12] },
] as const;
const SIGNALS = 26, STREAKS = 8;

/**
 * Signal Night: a dim teal street corner crowded with hanging traffic signals, cables and street signs in soft
 * focus. On hits, stage moving heads at the frame edges rake coloured beams across it, red streaks smear past,
 * and some hits flip the whole grade to red.
 */
export function createSignalNightMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).fov = 58;
  const time = uniform(0), finish = createCinematic({ grain: 0.06, halation: 0.45, vignette: 0.6, soften: 0.32, aberration: 0.003, shadows: [0.004, 0.012, 0.014] });
  const grade = new THREE.Color(0x0f2630);
  scene.background = grade.clone();
  scene.fog = new THREE.FogExp2(0x0f2630, 0.03);
  const random = seededRandom(77);
  // Street metal: dark painted steel with grime, picked out by the teal night and the beams.
  const metal = new THREE.MeshStandardNodeMaterial({ roughness: 0.75, metalness: 0.25 });
  metal.colorNode = vec3(0.022, 0.024, 0.018).mul(mx_fractal_noise_float(positionWorld.mul(2.5), 3, 2, 0.5).mul(0.4).add(0.8));
  const lamp = (hex: number) => new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(hex) });
  const lenses = { red: lamp(0x5a1812), amber: lamp(0x4a3010), green: lamp(0x0f3a1a) };
  const unlit = lamp(0x0a0c0c);
  const headGeometry = new THREE.BoxGeometry(0.42, 1.2, 0.34), plateGeometry = new THREE.BoxGeometry(0.72, 1.5, 0.03);
  const lensGeometry = new THREE.CircleGeometry(0.12, 24), visorGeometry = new THREE.CylinderGeometry(0.155, 0.155, 0.24, 20, 1, true, -Math.PI / 2, Math.PI);
  visorGeometry.rotateX(Math.PI / 2);
  const signals: THREE.Group[] = [];
  for (let s = 0; s < SIGNALS; s++) {
    const head = new THREE.Group();
    head.add(new THREE.Mesh(headGeometry, metal));
    if (random() < 0.6) { const plate = new THREE.Mesh(plateGeometry, metal); plate.position.z = -0.19; head.add(plate); }
    // Mostly the red or amber lamp is on; the others sit dark.
    const lit = random() < 0.55 ? 0 : random() < 0.6 ? 1 : 2;
    [lenses.red, lenses.amber, lenses.green].forEach((material, l) => {
      const lens = new THREE.Mesh(lensGeometry, l === lit ? material : unlit); lens.position.set(0, 0.38 - l * 0.38, 0.175); head.add(lens);
      const visor = new THREE.Mesh(visorGeometry, metal); visor.position.set(0, 0.38 - l * 0.38 + 0.02, 0.29); head.add(visor);
    });
    const x = (random() - 0.5) * 17, y = 2.5 + random() * 6.5, z = -2 - random() * 13;
    head.position.set(x, y, z); head.rotation.y = (random() - 0.5) * 1.2; head.rotation.z = (random() - 0.5) * 0.08;
    // Mast arm from the side of the street, or a short hanger from a span wire.
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 12, 8), metal);
    arm.rotation.z = Math.PI / 2; arm.position.set(x + (x > 0 ? 6 : -6), y + 0.75, z); scene.add(arm);
    scene.add(head); signals.push(head);
  }
  // Span wires and cables sagging between the signals and off the frame.
  const wire = new THREE.MeshStandardNodeMaterial({ color: 0x0a0d0e, roughness: 0.6, metalness: 0.4 });
  for (let c = 0; c < 22; c++) {
    const a = signals[Math.floor(random() * SIGNALS)].position, start = new THREE.Vector3(a.x, a.y + 0.7, a.z);
    const end = new THREE.Vector3(start.x + (random() < 0.5 ? -1 : 1) * (8 + random() * 14), start.y + (random() - 0.3) * 4, start.z + (random() - 0.5) * 6);
    const mid = start.clone().lerp(end, 0.5); mid.y -= 0.6 + random() * 1.6;
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(start, mid, end), 40, 0.018, 5), wire));
  }
  // Street signs: blue and green plates with a pale border.
  for (let k = 0; k < 7; k++) {
    const sign = new THREE.MeshStandardNodeMaterial({ roughness: 0.4, metalness: 0.2 });
    const border = uv().sub(0.5).abs().mul(2).max(float(0)), edge = border.x.max(border.y).smoothstep(0.86, 0.9);
    const stripes = uv().y.mul(3).fract().smoothstep(0.35, 0.4).sub(uv().y.mul(3).fract().smoothstep(0.6, 0.65)).mul(uv().x.smoothstep(0.15, 0.2)).mul(uv().x.smoothstep(0.8, 0.75)).mul(0.6);
    sign.colorNode = vec3(...linearRgb(k % 2 ? 0x1a4a8a : 0x15603a)).mul(0.5).add(vec3(0.12).mul(edge.add(stripes)));
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.8 + random(), 0.45 + random() * 0.2), sign);
    const near = signals[Math.floor(random() * SIGNALS)].position;
    plate.position.set(near.x + (random() - 0.5) * 2, near.y - 1.2 - random(), near.z + 0.4); plate.rotation.y = (random() - 0.5) * 0.6;
    scene.add(plate);
  }
  const ambient = new THREE.HemisphereLight(0x3a7080, 0x050a0c, 0.9);
  const street = new THREE.SpotLight(0x8ab0c0, 120, 60, 0.7, 0.8, 1.2); street.position.set(-10, 18, 6); street.target.position.set(2, 4, -14);
  scene.add(ambient, street, street.target);
  // Moving heads: a fixture body, a hot lens, a hard cone of light, and a coloured spill light partway along it.
  const lensGlow = createGlowPoints(loadTexture(emberUrl), MOVING_HEADS.length);
  const heads = MOVING_HEADS.map(({ at, aim }, i) => {
    const rig = new THREE.Group(); rig.position.set(at[0], at[1], at[2]);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.6, 20).rotateX(Math.PI / 2).translate(0, 0, -0.2), metal);
    const material = shaftMaterial(time);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 1.5, 15, 32, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 7.5), material);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24), new THREE.MeshBasicNodeMaterial({ color: 0xffffff }));
    const spill = new THREE.PointLight(0xffffff, 0, 16, 1.4); spill.position.set(0, 0, 5);
    rig.add(body, cone, glow, spill); scene.add(rig);
    return { rig, material, glow, spill, aim: new THREE.Vector3(aim[0], aim[1], aim[2]), phase: i * 1.7 + random() };
  });
  scene.add(lensGlow.object);
  // Horizontal light streaks smearing across on hits.
  const streakMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  streakMaterial.colorNode = vec3(1).mul(uv().x.mul(Math.PI).sin().pow(2)).mul(uv().y.sub(0.5).abs().mul(2).oneMinus().pow(3));
  const streaks = Array.from({ length: STREAKS }, () => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(9, 0.07), streakMaterial.clone()); mesh.visible = false; scene.add(mesh);
    return { mesh, speed: 0, life: 0 };
  });

  const hits = createHits({ decay: 0.22, interval: 0.3, variants: SIGNAL_VARIANTS.length, seed: 41 });
  const colour = new THREE.Color(), target = new THREE.Vector3(), teal = new THREE.Color(0x3a7080), red = new THREE.Color(0xa02018);
  let shake = 0, sweep = 0, redness = 0, nextStreak = 0;
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time; finish.update(frame);
      const step = settleStep(frame), still = frame.reducedMotion, bass = frame.response.bass;
      hits.update(frame, 0.05);
      const look = SIGNAL_VARIANTS[hits.variant];
      // Grade: a hard cut to the variant's street colour on each hit; the red flip lights every signal red.
      if (hits.fired || frame.time < 0.1) {
        grade.set(look.grade); (scene.background as THREE.Color).copy(grade); (scene.fog as THREE.FogExp2).color.copy(grade);
        if (hits.fired) for (let k = 0, n = 1 + (look.red ? 2 : Math.floor(random() * 2)); k < n; k++) {
          const s = streaks[nextStreak]; nextStreak = (nextStreak + 1) % STREAKS;
          s.mesh.position.set((random() - 0.5) * 6, 1.5 + random() * 6, -3 - random() * 6);
          (s.mesh.material as THREE.MeshBasicNodeMaterial).color.setRGB(...linearRgb(random() < 0.7 ? 0xff3a2a : 0x7cff4a));
          s.speed = (random() < 0.5 ? -1 : 1) * (14 + random() * 10); s.life = 0.25; s.mesh.visible = !frame.reducedFlash || k === 0;
        }
      }
      redness = approach(redness, look.red * hits.gain, step, 0.05);
      ambient.color.copy(teal).lerp(red, redness); ambient.intensity = 0.7 + redness * 0.8;
      lenses.red.color.setRGB(...linearRgb(0x5a1812)).multiplyScalar(1 + redness * 4 + bass * 0.8);
      lenses.amber.color.setRGB(...linearRgb(0x4a3010)).multiplyScalar(1 + bass * 0.5);
      // The heads sweep across the street; each draws its beam only while the music hits, falling dark between.
      if (!still) sweep += frame.delta * (0.7 + bass * 1.4 + hits.flash * 2.5);
      const beamLevel = hits.flash * (look.red ? 0.35 : 1) + bass * 0.08;
      heads.forEach((head, i) => {
        const pan = Math.sin(sweep + head.phase) * 0.45, tilt = Math.cos(sweep * 0.7 + head.phase) * 0.18;
        target.copy(head.aim).add(new THREE.Vector3(pan * 10, tilt * 8, 0));
        head.rig.lookAt(target);
        colour.setRGB(...linearRgb(look.beams[i]));
        head.material.color.copy(colour).multiplyScalar(beamLevel * 1.4);
        (head.glow.material as THREE.MeshBasicNodeMaterial).color.copy(colour).multiplyScalar(0.3 + beamLevel * 6);
        head.spill.color.copy(colour); head.spill.intensity = beamLevel * 35;
        const p = head.rig.position;
        lensGlow.set(i, p.x, p.y, p.z, 0.25 + beamLevel * 0.6, 0.6 + colour.r, 0.6 + colour.g, 0.6 + colour.b, Math.min(1, beamLevel));
      });
      lensGlow.commit();
      for (const s of streaks) {
        if (!s.mesh.visible) continue;
        s.life -= step; s.mesh.position.x += s.speed * step;
        s.mesh.visible = s.life > 0;
        s.mesh.scale.y = 1 + (0.25 - s.life) * 4;
      }
      // Handheld: a small 8 Hz shake, harder with the bass.
      shake = approach(shake, still ? 0 : 0.015 + bass * 0.05, step, 0.1);
      camera.position.set(Math.sin(frame.time * 51) * shake, 4.5 + Math.sin(frame.time * 47 + 1) * shake, 5);
      camera.lookAt(0.5, 5.6, -10);
    },
    filter: (input) => finish.filter(input),
    dispose: () => disposeScene(scene),
  };
}
