import * as THREE from 'three/webgpu';
import { float, fract, instancedBufferAttribute, mix, mx_noise_float, normalView, positionLocal, sin, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, bandEnergies, approach, beatGate, settleStep } from './shared';
import { seededRandom } from '../rendering/diagnostics';
import { presetBudget, type QualityBudget } from '../rendering/quality';

export const PANELS = 6;
const BEAMS_PER_PANEL = 6, LASERS_PER_PANEL = 6, STAGE_Z = -90;
const PANEL = { w: 24, h: 9, d: 6 };

/** Six panels hang in fixed spots, [x, y, z, tilt]; in the dark room an unlit one is all but invisible. */
export const PANEL_HOMES: readonly (readonly [number, number, number, number])[] = [
  [-40, 54, 0, 0], [0, 34, 6, 0], [40, 54, 0, 0],
  [-58, 33, 8, 0], [0, 57, -2, 0], [58, 33, 8, 0],
];
/** Lighting looks: one trio, the other trio, and every few phrases all six together. */
export const LOOKS: readonly (readonly number[])[] = [[0, 1, 2], [3, 4, 5], [0, 1, 2], [3, 4, 5], [0, 1, 2, 3, 4, 5]];
/** 1 for panels lit in a look, 0 for the dark ones. */
export function lookTargets(look: number, out: Float32Array) {
  const lit = LOOKS[look % LOOKS.length];
  for (let p = 0; p < PANELS; p++) out[p] = lit.includes(p) ? 1 : 0;
  return out;
}
/** Moving-head programs: fan, ripple wave, scissor cross and a ballyhoo sweep. */
export const BEAM_PROGRAMS = 4;
/** Deepest tilt toward the crowd (radians from straight down); beams never rise past it. */
export const MAX_TILT = 0.75;
/**
 * Where a moving head points under a program at motion clock `m`, as [tilt, pan] in radians:
 * tilt leans the beam out toward the crowd, pan swings it sideways. Every program is smooth in `m`.
 */
export function beamAim(program: number, m: number, panel: number, beam: number, out: [number, number] = [0, 0]) {
  const u = (beam / (BEAMS_PER_PANEL - 1)) * 2 - 1, wave = (x: number) => 0.5 + 0.5 * Math.sin(x);
  switch (program % BEAM_PROGRAMS) {
    case 0: out[0] = 0.1 + 0.4 * wave(m * 0.7 + panel); out[1] = u * (0.18 + 0.22 * wave(m)); break;
    case 1: out[0] = 0.08 + 0.6 * wave(m * 1.2 - beam * 0.9 + panel * 0.5); out[1] = u * 0.12; break;
    case 2: out[0] = 0.12 + 0.45 * wave(m * 0.6 + panel); out[1] = (beam % 2 ? 1 : -1) * 0.38 * Math.sin(m * 0.8 + panel * 0.4); break;
    default: out[0] = 0.15 + 0.5 * wave(m * 1.1 + panel * 1.3 + beam * 0.3); out[1] = 0.32 * Math.sin(m * 0.8 + beam * 0.5 + panel); break;
  }
  out[0] = Math.min(MAX_TILT, out[0]);
  return out;
}
/** Deep red stage palettes in scene-linear: blood red, hot red, crimson, scarlet. Green stays low so tone mapping never drifts to orange. */
const PALETTES = [[1.6, 0.06, 0.012], [1.8, 0.13, 0.03], [1.5, 0.025, 0.045], [1.7, 0.09, 0.02]] as const;

export function createArenaMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).far = 1200;
  const random = seededRandom(1999);
  const time = uniform(0), haze = uniform(new THREE.Color(0.3, 0.06, 0.01));

  // Panels: LED boxes whose front and underside glow; colour and brightness ride on instanceColor.
  const panelMaterial = new THREE.MeshBasicNodeMaterial();
  const cells = fract(uv().mul(vec2(36, 14))), grid = cells.x.smoothstep(0.02, 0.12).mul(cells.y.smoothstep(0.03, 0.2)).mul(0.35).add(0.65);
  panelMaterial.colorNode = vec3(grid);
  const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(PANEL.w, PANEL.h, PANEL.d), panelMaterial, PANELS);
  panels.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PANELS * 3), 3); panels.frustumCulled = false;
  const frames = new THREE.InstancedMesh(new THREE.BoxGeometry(PANEL.w + 0.8, PANEL.h + 0.8, PANEL.d - 0.4), new THREE.MeshBasicNodeMaterial({ color: 0x050505 }), PANELS);
  frames.frustumCulled = false;

  // Beams: wide soft cones out of each moving head, brightest at the lens, fading into the haze and at their edges.
  const shaftGeometry = new THREE.CylinderGeometry(1.0, 6.5, 1, 20, 1, true); shaftGeometry.translate(0, -0.5, 0);
  const shaftMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const drift = mx_noise_float(vec3(positionLocal.x.mul(0.6), uv().y.mul(3).add(time.mul(0.4)), time.mul(0.2))).mul(0.3).add(0.7);
  const core = normalView.z.abs().pow(1.4);
  shaftMaterial.colorNode = vec3(uv().y.pow(1.6).mul(0.4).mul(drift).mul(core));
  const shaftCount = PANELS * BEAMS_PER_PANEL;
  const shafts = new THREE.InstancedMesh(shaftGeometry, shaftMaterial, shaftCount);
  shafts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(shaftCount * 3), 3); shafts.frustumCulled = false;

  // Fixtures: a row of six moving heads under each panel; the yoke stays put and the head tilts with its beam.
  const lampMaterial = new THREE.MeshBasicNodeMaterial();
  const lens = uv().sub(0.5).length();
  lampMaterial.colorNode = vec3(lens.smoothstep(0.5, 0.15).mul(0.7).add(0.3));
  const lampCount = PANELS * BEAMS_PER_PANEL;
  const lampGeometry = new THREE.CylinderGeometry(1.2, 1.0, 1.4, 16); lampGeometry.translate(0, -0.7, 0);
  const lamps = new THREE.InstancedMesh(lampGeometry, lampMaterial, lampCount);
  lamps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(lampCount * 3), 3); lamps.frustumCulled = false;
  const housings = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.5, 1.5, 1.2, 16).translate(0, -0.3, 0), new THREE.MeshBasicNodeMaterial({ color: 0x080808 }), lampCount);
  housings.frustumCulled = false;

  // Lasers: thin hot lines fanning out of each panel's underside and sweeping.
  const laserGeometry = new THREE.CylinderGeometry(0.1, 0.28, 1, 6, 1, true); laserGeometry.translate(0, -0.5, 0);
  const laserMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  laserMaterial.colorNode = vec3(uv().y.pow(0.6).mul(1.4));
  const laserCount = PANELS * LASERS_PER_PANEL;
  const lasers = new THREE.InstancedMesh(laserGeometry, laserMaterial, laserCount);
  lasers.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(laserCount * 3), 3); lasers.frustumCulled = false;

  // Floor pools where the shafts land, and a blinder on the stage lip.
  const poolMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  poolMaterial.colorNode = vec3(uv().sub(0.5).length().smoothstep(0.5, 0.0).pow(2).mul(0.6));
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), poolMaterial, PANELS);
  pools.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PANELS * 3), 3); pools.frustumCulled = false;
  const blinderMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const blinderLevel = uniform(0);
  blinderMaterial.colorNode = vec3(3, 2.8, 2.5).mul(blinderLevel);
  blinderMaterial.opacityNode = uv().sub(0.5).length().smoothstep(0.5, 0.0).pow(3);
  const blinder = new THREE.Sprite(blinderMaterial); blinder.geometry = blinder.geometry.clone(); blinder.position.set(0, 6, STAGE_Z + 14); blinder.scale.setScalar(40);
  scene.add(frames, panels, housings, lamps, shafts, lasers, pools, blinder);

  // Room: black floor and back wall with a faint truss, and a warm haze that takes the panels' colour.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(600, 400), new THREE.MeshBasicNodeMaterial({ color: 0x030303 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -40);
  const stageDeck = new THREE.Mesh(new THREE.BoxGeometry(140, 5, 40), new THREE.MeshBasicNodeMaterial({ color: 0x060606 })); stageDeck.position.set(0, 2.5, STAGE_Z);
  const wallMaterial = new THREE.MeshBasicNodeMaterial();
  const truss = fract(uv().mul(vec2(60, 20))).sub(0.5).abs();
  wallMaterial.colorNode = vec3(0.004).add(haze.mul(truss.x.min(truss.y).smoothstep(0.03, 0).mul(0.02)));
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(500, 220), wallMaterial); wall.position.set(0, 100, STAGE_Z - 30);
  const hazeMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const fog = mx_noise_float(vec3(uv().x.mul(5).add(time.mul(0.03)), uv().y.mul(2), time.mul(0.05))).mul(0.5).add(0.5);
  hazeMaterial.colorNode = haze.mul(fog).mul(uv().y.smoothstep(0, 0.35).mul(uv().y.smoothstep(1, 0.5))).mul(0.06);
  for (const z of [STAGE_Z + 25, STAGE_Z - 5]) { const layer = new THREE.Mesh(new THREE.PlaneGeometry(420, 140), hazeMaterial); layer.position.set(0, 50, z); scene.add(layer); }
  scene.add(floor, stageDeck, wall);

  // Crowd: dark head-and-shoulder silhouettes that bob to the bass, some holding phone lights up.
  const crowdCount = Math.round(1800 * Math.min(2, budget.particleScale)), people = new Float32Array(crowdCount * 4);
  for (let i = 0; i < crowdCount; i++) {
    const z = 30 - Math.pow(random(), 0.8) * 100;
    people.set([(random() - 0.5) * (120 + (30 - z) * 0.9), 4.6 + random() * 0.8, z, random()], i * 4);
  }
  const person = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(people, 4), 'vec4');
  const bounce = uniform(0), jump = uniform(0);
  const hop = sin(time.mul(7).add(person.w.mul(30))).max(0).mul(bounce.mul(0.9)).add(jump.mul(person.w.greaterThan(0.4).select(float(1.2), float(0))));
  const crowdMaterial = new THREE.SpriteNodeMaterial({ alphaTest: 0.5 });
  crowdMaterial.positionNode = vec3(person.x, person.y.add(hop), person.z);
  const s = uv(), head = s.sub(vec2(0.5, 0.74)).length().lessThan(0.17), shoulders = s.sub(vec2(0.5, 0.18)).mul(vec2(1, 1.5)).length().lessThan(0.44);
  crowdMaterial.colorNode = mix(vec3(0.004), haze.mul(0.06), s.y.smoothstep(0.6, 1));
  crowdMaterial.opacityNode = head.or(shoulders).select(float(1), float(0));
  crowdMaterial.scaleNode = vec2(2.6, 3.6);
  const crowd = new THREE.Sprite(crowdMaterial); crowd.geometry = crowd.geometry.clone(); crowd.count = crowdCount; crowd.frustumCulled = false;
  const phoneCount = Math.round(crowdCount * 0.06), phones = new Float32Array(phoneCount * 4);
  for (let i = 0; i < phoneCount; i++) { const k = Math.floor(random() * crowdCount) * 4; phones.set([people[k] + 0.9, people[k + 1] + 3.4, people[k + 2] + 0.2, random()], i * 4); }
  const phone = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(phones, 4), 'vec4');
  const phoneMaterial = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  phoneMaterial.positionNode = vec3(phone.x, phone.y.add(sin(time.mul(1.3).add(phone.w.mul(20))).mul(0.4)), phone.z);
  phoneMaterial.colorNode = vec3(0.9, 0.95, 1.1).mul(sin(time.mul(2).add(phone.w.mul(40))).mul(0.3).add(0.7));
  phoneMaterial.opacityNode = uv().sub(0.5).length().smoothstep(0.5, 0.05);
  phoneMaterial.scaleNode = vec2(0.5);
  const phoneSprites = new THREE.Sprite(phoneMaterial); phoneSprites.geometry = phoneSprites.geometry.clone(); phoneSprites.count = phoneCount; phoneSprites.frustumCulled = false;
  scene.add(crowd, phoneSprites);

  // Panels stay put; looks cross-fade by lighting one set up as the other goes dark.
  const light = new Float32Array(PANELS), lightTargets = lookTargets(0, new Float32Array(PANELS));
  light.set(lightTargets);
  const bands = new Float32Array(PANELS), level = new Float32Array(PANELS), beat = beatGate(0.3), dummy = new THREE.Object3D(), colour = new THREE.Color(), white = new THREE.Color(3, 3, 3);
  // Every head keeps its own phase and pace, so no two panels, and no two beams, sweep in lockstep.
  const heads = PANELS * BEAMS_PER_PANEL, tilts = new Float32Array(heads), pans = new Float32Array(heads), aim: [number, number] = [0, 0];
  const phases = Float32Array.from({ length: heads }, () => random() * Math.PI * 2), paces = Float32Array.from({ length: heads }, () => 0.7 + random() * 0.6);
  const headAim = (index: number) => { const p = Math.floor(index / BEAMS_PER_PANEL); return beamAim(look + p, motion * paces[index] + phases[index], p, index % BEAMS_PER_PANEL, aim); };
  let look = 0, palette = 0, beats = 0, idle = 0, flash = 0, chase = 0, sweep = 0, motion = 0, kick = 0, jumpLevel = 0;
  for (let i = 0; i < heads; i++) { headAim(i); [tilts[i], pans[i]] = aim; }
  return {
    scene, camera,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time; idle += frame.delta;
      if (beat(frame.time, frame.audio.onset)) {
        beats++; kick = 1; jumpLevel = 1;
        if (frame.response.impact > 0.7) flash = 1;
      }
      // A new look every 8 beats, or every 10 s in silence; the palette moves on with it.
      if (beats >= 8 || idle > 10) { beats = 0; idle = 0; look = (look + 1) % LOOKS.length; palette = (palette + 1) % PALETTES.length; lookTargets(look, lightTargets); }
      flash = Math.max(0, flash - settleStep(frame) * 3); kick = Math.max(0, kick - settleStep(frame) * 2.5); jumpLevel = Math.max(0, jumpLevel - settleStep(frame) * 4);
      const flashLevel = frame.reducedFlash ? flash * 0.15 : flash;
      bandEnergies(frame, PANELS, bands);
      sweep += frame.delta * (0.6 + frame.audio.mid * 1.8);
      // The heads' motion clock speeds up with the music; the dimmer chase glides along the row instead of stepping.
      motion += frame.delta * (0.5 + frame.audio.mid * 0.9 + kick * 1.5);
      chase = (chase + frame.delta * (1.2 + kick * 6)) % BEAMS_PER_PANEL;
      const [pr, pg, pb] = PALETTES[palette];
      haze.value.setRGB(pr, pg, pb).multiplyScalar(0.12 + frame.response.bounce * 0.12);
      for (let p = 0; p < PANELS; p++) {
        level[p] = approach(level[p], bands[p], settleStep(frame), 0.08);
        // Lights come up faster than they die away, like a lamp's warm-up versus its afterglow.
        light[p] = approach(light[p], lightTargets[p], settleStep(frame), lightTargets[p] > light[p] ? 0.25 : 0.5);
        const [x, y, homeZ, tilt] = PANEL_HOMES[p], z = STAGE_Z + homeZ;
        dummy.position.set(x, y, z); dummy.rotation.set(0, 0, tilt); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
        panels.setMatrixAt(p, dummy.matrix); frames.setMatrixAt(p, dummy.matrix);
        // Kept below the tone mapper's shoulder so the LEDs stay red instead of washing out to orange.
        const visible = light[p], glow = (0.22 + level[p] * 0.5 + frame.response.bounce * 0.2) * visible;
        colour.setRGB(pr, pg, pb).multiplyScalar(glow).lerp(white, flashLevel * 0.8 * visible);
        panels.setColorAt(p, colour.addScalar(0.0015));
        // Moving heads: each panel runs its own program, and each head eases toward its aim like a real fixture's motors, so beams swing up and down.
        for (let b = 0; b < BEAMS_PER_PANEL; b++) {
          const index = p * BEAMS_PER_PANEL + b, offset = (b - (BEAMS_PER_PANEL - 1) / 2) * (PANEL.w / BEAMS_PER_PANEL);
          const fx = x + Math.cos(tilt) * offset, fy = y - PANEL.h / 2 + Math.sin(tilt) * offset;
          headAim(index);
          tilts[index] = approach(tilts[index], aim[0], settleStep(frame), 0.35); pans[index] = approach(pans[index], aim[1], settleStep(frame), 0.35);
          dummy.position.set(fx, fy, z + 1); dummy.rotation.set(0, 0, tilt); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
          housings.setMatrixAt(index, dummy.matrix);
          dummy.rotation.set(-tilts[index], 0, tilt + pans[index]); dummy.updateMatrix();
          lamps.setMatrixAt(index, dummy.matrix);
          // The cone reaches the floor wherever it points, capped so a shallow beam fades out in the haze.
          const reach = Math.min(150, (fy - 1.4) / Math.max(0.2, Math.cos(tilts[index]) * Math.cos(pans[index])));
          const zoom = 0.85 + level[p] * 0.5;
          dummy.position.set(fx, fy, z + 1); dummy.translateY(-1.4); dummy.scale.set(zoom, reach, zoom); dummy.updateMatrix();
          shafts.setMatrixAt(index, dummy.matrix);
          // Dimmer: a soft bump gliding along the row plus a slow breath, never a hard on/off.
          const gap = Math.abs(b - chase), bump = Math.exp(-Math.pow(Math.min(gap, BEAMS_PER_PANEL - gap), 2) / 1.2);
          const breath = 0.6 + 0.4 * Math.sin(motion * 0.9 * paces[index] + phases[index] * 2);
          const lit = (0.25 + level[p] * 1.5 + frame.response.bounce * 0.4 + bump * 0.6) * breath * visible;
          shafts.setColorAt(index, colour.setRGB(pr, pg, pb).multiplyScalar(lit));
          // The lamp lens burns hotter than its beam so it reads as the light source.
          lamps.setColorAt(index, colour.setRGB(pr, pg, pb).multiplyScalar(0.4 * visible + lit * 2.2).lerp(white, Math.min(1, lit * 0.25)));
        }
        // Laser fan: alternate panels scissor in opposite directions; length reaches the crowd.
        for (let l = 0; l < LASERS_PER_PANEL; l++) {
          const index = p * LASERS_PER_PANEL + l, spread = (l / (LASERS_PER_PANEL - 1) - 0.5) * 1.6;
          const swing = Math.sin(sweep * (p % 2 ? -1 : 1) + p * 0.7) * 0.6;
          dummy.position.set(x + spread * 4, y - PANEL.h / 2, z + 2);
          dummy.rotation.set(-0.55 - Math.abs(swing) * 0.3, 0, spread + swing);
          const on = (level[p] > 0.18 || frame.response.bounce > 0.35 ? 1 : 0.15) * visible;
          dummy.scale.set(1, 160 * (on > 0.5 ? 1 : 0.6) * Math.min(1, visible * 1.5), 1); dummy.updateMatrix();
          lasers.setMatrixAt(index, dummy.matrix);
          lasers.setColorAt(index, colour.setRGB(pr, pg * 0.8, pb).multiplyScalar((1.4 + level[p] * 3) * on));
        }
        dummy.position.set(x, 0.05, z + 2); dummy.rotation.set(-Math.PI / 2, 0, 0); dummy.scale.set(34, 20, 1); dummy.updateMatrix();
        pools.setMatrixAt(p, dummy.matrix);
        pools.setColorAt(p, colour.setRGB(pr, pg, pb).multiplyScalar((0.3 + level[p] + frame.response.bounce * 0.4) * visible));
      }
      for (const mesh of [panels, frames, housings, lamps, shafts, lasers, pools]) mesh.instanceMatrix.needsUpdate = true;
      for (const mesh of [panels, lamps, shafts, lasers, pools]) mesh.instanceColor!.needsUpdate = true;
      bounce.value = frame.response.bounce; jump.value = frame.reducedMotion ? 0 : jumpLevel;
      blinderLevel.value = flashLevel * 1.5 + frame.response.bounce * 0.08;
      camera.position.set(Math.sin(frame.time * 0.05) * 10, 10 + Math.sin(frame.time * 0.2) * 0.6, 22);
      camera.lookAt(0, 32, STAGE_Z);
    },
    dispose: () => disposeScene(scene),
  };
}
