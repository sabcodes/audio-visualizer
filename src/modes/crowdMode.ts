import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { attribute, cos, exp, instancedBufferAttribute, mix, sin, uniform, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, approach, beatGate, settleStep, createSpectrumTexture, spectrumAxisNode } from './shared';
import { BoneOverlay, ClipPlayer, TempoTracker, createParticles, instantiate, loadTexture, prop, setMorph, shaftMaterial, whenLoaded, type Figure } from './figures';
import { seededRandom } from '../rendering/diagnostics';
import { presetBudget, type QualityBudget } from '../rendering/quality';
import mascotUrl from '../assets/models/mascot_blob.glb?url';
import dancerUrl from '../assets/models/dancer.glb?url';
import dancerBUrl from '../assets/models/dancer_b.glb?url';
import dancerCUrl from '../assets/models/dancer_c.glb?url';
import propsUrl from '../assets/models/crowd_props.glb?url';
import sparkUrl from '../assets/fx/spark.png?url';

type V3 = Node<'vec3'>;
/** Part pivots per dancer variant (from each file's README): body, head, left/right shoulder, left/right hip. */
const PIVOTS = [
  { head: [0, 1.5], arm: [0.2, 1.4], leg: [0.1, 0.92] },
  { head: [0, 1.5], arm: [0.3, 1.4], leg: [0.14, 0.92] },
  { head: [0, 1.66], arm: [0.2, 1.52], leg: [0.1, 1.02] },
] as const;
const STAGE_RADIUS = 5.5, CROWD_INNER = 8.5, CROWD_OUTER = 26, RIPPLE_SPEED = 12;

/** Rotates `p` about the axis through `pivot` along X (pitch) or Z (roll). */
const pitch = (p: V3, pivot: V3, angle: Node<'float'>) => {
  const d = p.sub(pivot), c = cos(angle), s = sin(angle);
  return pivot.add(vec3(d.x, d.y.mul(c).sub(d.z.mul(s)), d.y.mul(s).add(d.z.mul(c))));
};
const roll = (p: V3, pivot: V3, angle: Node<'float'>) => {
  const d = p.sub(pivot), c = cos(angle), s = sin(angle);
  return pivot.add(vec3(d.x.mul(c).sub(d.y.mul(s)), d.x.mul(s).add(d.y.mul(c)), d.z));
};

/**
 * Crowd placement: dancers on rings round the stage, facing it, with a per-dancer phase and distance.
 * Returns [x, z, facing, phase, distance] per dancer.
 */
export function crowdLayout(count: number, random: () => number) {
  const out: [number, number, number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const r = CROWD_INNER + Math.sqrt(random()) * (CROWD_OUTER - CROWD_INNER), a = random() * Math.PI * 2;
    // Leave the front of the stage (toward the camera) a little emptier so the mascot stays in view.
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    out.push([x, z, Math.atan2(-x, -z), random(), r]);
  }
  return out;
}

export function createCrowdMode(budget: QualityBudget = presetBudget('balanced')): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).far = 600;
  scene.fog = new THREE.FogExp2(0x07040c, 0.012);
  const random = seededRandom(2025);
  const time = uniform(0), bounce = uniform(0), cheer = uniform(0), waveAge = uniform(99), waveHeight = uniform(0), beatPhase = uniform(0), hue = uniform(0);
  const spectrum = createSpectrumTexture(), logMapping = uniform(0), nyquist = uniform(24000);
  // Ground and stage: a dark field, a round stage with a glowing rim that pulses on the bass.
  const ground = new THREE.Mesh(new THREE.CircleGeometry(220, 64), new THREE.MeshStandardNodeMaterial({ color: 0x0a0910, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const stageMaterial = new THREE.MeshStandardNodeMaterial({ color: 0x15121c, roughness: 0.6 });
  const rimMaterial = new THREE.MeshBasicNodeMaterial();
  rimMaterial.colorNode = mix(vec3(1, 0.2, 0.8), vec3(0.2, 0.8, 1), sin(time.mul(0.5)).mul(0.5).add(0.5)).mul(bounce.mul(2.5).add(0.6));
  const stage = new THREE.Mesh(new THREE.CylinderGeometry(STAGE_RADIUS, STAGE_RADIUS + 0.2, 1, 48), stageMaterial); stage.position.y = 0.5;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(STAGE_RADIUS + 0.05, 0.08, 8, 96), rimMaterial); rim.rotation.x = Math.PI / 2; rim.position.y = 1.0;
  scene.add(stage, rim);
  const fill = new THREE.HemisphereLight(0x8a78c0, 0x0a0614, 1.6);
  const key = new THREE.SpotLight(0xffe0f0, 220, 60, 0.45, 0.6, 1.4); key.position.set(0, 18, 14); key.target.position.set(0, 2, 0);
  const wash = [new THREE.PointLight(0xff3ab0, 30, 40, 1.6), new THREE.PointLight(0x3ab8ff, 30, 40, 1.6)];
  wash[0].position.set(-8, 6, 4); wash[1].position.set(8, 6, 4);
  scene.add(fill, key, key.target, ...wash);

  // Stage beams: four soft light shafts from the truss tops, sweeping over the crowd.
  const beamGeometry = new THREE.CylinderGeometry(0.2, 3.5, 40, 16, 1, true); beamGeometry.translate(0, -20, 0);
  const towers = [[-9, -6], [9, -6], [-11, 7], [11, 7]] as const;
  const beams = towers.map(([x, z], i) => {
    const material = shaftMaterial(time); material.color.setHSL(i / 4, 1, 0.5);
    const beam = new THREE.Mesh(beamGeometry, material); beam.position.set(x, 8, z); scene.add(beam);
    return { beam, material };
  });

  // Crowd: one instanced mesh per dancer variant. The vertex colour's red channel names the body part,
  // so each part turns about its own joint in the vertex shader; alpha marks the glow stick.
  const total = Math.round(1100 * Math.min(2, budget.particleScale)), layout = crowdLayout(total, random);
  const crowd: THREE.InstancedMesh[] = [];
  const buildCrowd = (variant: number, geometry: THREE.BufferGeometry) => {
    // positionNode replaces the position after the instance transform (three 0.186), so instances keep identity
    // matrices and each dancer's placement is applied in the shader after its parts are posed in model space.
    const members = layout.filter((_, i) => i % 3 === variant), data = new Float32Array(members.length * 4), place = new Float32Array(members.length * 4);
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardNodeMaterial({ roughness: 0.8 }), members.length);
    members.forEach(([x, z, facing, phase, distance], i) => {
      data.set([phase, distance, random(), 0], i * 4); place.set([x, z, facing, 0.92 + phase * 0.2], i * 4);
    });
    const who = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(data, 4), 'vec4');
    const where = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(place, 4), 'vec4');
    const tag = attribute<'vec4'>('color', 'vec4'), part = tag.x.mul(5).round(), stick = tag.w;
    const { head, arm, leg } = PIVOTS[variant];
    const phase = who.x.mul(6.283), distance = who.y;
    // A beat's jump reaches each dancer when the ripple from the stage does.
    const reach = waveAge.mul(RIPPLE_SPEED).sub(distance.sub(CROWD_INNER)), jump = exp(reach.mul(reach).div(-6)).mul(waveHeight);
    const groove = sin(time.mul(7).add(phase)).mul(0.5).add(0.5).mul(bounce);
    const raise = cheer.mul(2.3).add(groove.mul(0.5)).add(sin(time.mul(3).add(phase)).mul(0.25));
    let p: V3 = attribute<'vec3'>('position', 'vec3');
    const is = (k: number) => part.equal(k);
    p = is(2).select(roll(p, vec3(arm[0], arm[1], 0), raise.add(0.15)), p);
    p = is(3).select(roll(p, vec3(-arm[0], arm[1], 0), raise.add(0.15).negate()), p);
    p = is(4).select(pitch(p, vec3(leg[0], leg[1], 0), sin(time.mul(7).add(phase)).mul(0.3).mul(bounce)), p);
    p = is(5).select(pitch(p, vec3(-leg[0], leg[1], 0), sin(time.mul(7).add(phase)).mul(-0.3).mul(bounce)), p);
    p = is(1).select(pitch(p, vec3(head[0], head[1], 0), sin(time.mul(7).add(phase).add(1)).mul(0.25).mul(bounce.add(0.2))), p);
    // The whole body bobs with the groove, sways, and leaves the ground when the ripple passes.
    p = roll(p, vec3(0, 0, 0), sin(time.mul(2.2).add(phase)).mul(0.08).mul(bounce.add(0.3)));
    const material = mesh.material as THREE.MeshStandardNodeMaterial;
    const posed = p.add(vec3(0, groove.mul(0.18).add(jump.mul(1.1)), 0)).mul(where.w), turn = where.z;
    material.positionNode = vec3(posed.x.mul(cos(turn)).add(posed.z.mul(sin(turn))).add(where.x), posed.y, posed.z.mul(cos(turn)).sub(posed.x.mul(sin(turn))).add(where.y));
    // Clothes take a dim per-dancer tint; glow sticks burn in their own colour, brighter where the
    // spectrum band that maps to this dancer's distance is loud.
    const shirt = vec3(cos(who.z.mul(6.283)), cos(who.z.mul(6.283).sub(2.1)), cos(who.z.mul(6.283).add(2.1))).mul(0.3).add(0.45);
    const band = spectrumAxisNode(spectrum.texture, distance.sub(CROWD_INNER).div(CROWD_OUTER - CROWD_INNER).clamp(0, 1), logMapping, nyquist);
    const stickHue = who.z.add(hue);
    const stickColour = vec3(cos(stickHue.mul(6.283)), cos(stickHue.mul(6.283).sub(2.1)), cos(stickHue.mul(6.283).add(2.1))).mul(0.5).add(0.5);
    material.colorNode = mix(shirt, vec3(0.02), stick);
    material.emissiveNode = stickColour.mul(stick).mul(band.mul(5).add(1.2).add(jump.mul(3)));
    mesh.frustumCulled = false;
    crowd.push(mesh); scene.add(mesh);
  };

  let mascot: Figure | undefined, player: ClipPlayer | undefined;
  const tempo = new TempoTracker(), overlay = new BoneOverlay();
  let squash: ReturnType<Figure['morphs']> = [], stretch: typeof squash = [], leanL: typeof squash = [], leanR: typeof squash = [], blink: typeof squash = [], mouth: typeof squash = [];
  let core: THREE.MeshStandardMaterial | undefined, cheeks: THREE.MeshStandardMaterial | undefined, body: THREE.Object3D | undefined;
  const cannons: THREE.Object3D[] = [];
  const confetti = createParticles(loadTexture(sparkUrl), 900, { gravity: 9, drag: 1.4, additive: false });
  scene.add(confetti.object);
  const models = whenLoaded([mascotUrl, dancerUrl, dancerBUrl, dancerCUrl, propsUrl], ([mascotModel, a, b, c, props]) => {
    [a, b, c].forEach((model, variant) => {
      let geometry: THREE.BufferGeometry | undefined;
      model.scene.traverse((object) => { if (!geometry && (object as THREE.Mesh).isMesh) geometry = (object as THREE.Mesh).geometry; });
      if (geometry) buildCrowd(variant, geometry);
    });
    mascot = instantiate(mascotModel);
    mascot.root.position.y = 1; scene.add(mascot.root);
    player = new ClipPlayer(mascot.root, mascot.clips);
    player.loop('bounce', 0);
    squash = mascot.morphs('squash'); stretch = mascot.morphs('stretch'); leanL = mascot.morphs('lean_L'); leanR = mascot.morphs('lean_R');
    blink = mascot.morphs('blink'); mouth = mascot.morphs('mouth_open');
    core = mascot.materials.get('emissive_core'); cheeks = mascot.materials.get('emissive_cheeks');
    body = overlay.track(mascot.node('body'));
    // The jelly is a little see-through so its glowing core shows.
    const jelly = mascot.materials.get('jelly');
    if (jelly) { jelly.transparent = true; jelly.opacity = 0.72; jelly.roughness = 0.15; jelly.emissive.setRGB(0.05, 0.25, 0.3); }
    // Barriers ring the stage; speakers flank it; truss towers carry the beams; cannons sit at the front.
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2, fence = prop(props, 'barrier_fence');
      fence.position.set(Math.cos(a) * 7.3, 0, Math.sin(a) * 7.3); fence.rotation.y = -a + Math.PI / 2; scene.add(fence);
    }
    for (const side of [-1, 1]) {
      const speakers = prop(props, 'speaker_stack'); speakers.position.set(side * 4, 1, -2.5); speakers.rotation.y = -side * 0.4; speakers.scale.setScalar(1.3); scene.add(speakers);
      const cannon = prop(props, 'confetti_cannon'); cannon.position.set(side * 3.6, 1, 3.4); cannon.rotation.y = side * 0.35; cannon.rotation.x = -0.9; scene.add(cannon);
      cannons.push(cannon);
    }
    for (const [x, z] of towers) { const truss = prop(props, 'truss_tower'); truss.position.set(x, 0, z); scene.add(truss); }
  });

  const jumpGate = beatGate(3.5), cheerGate = beatGate(8), confettiGate = beatGate(9), muzzle = new THREE.Vector3(), aim = new THREE.Vector3(), paper = new THREE.Color();
  let spring = 0, springVelocity = 0, loudHold = 0, blinkIn = 2, beats = 0, idle = 0;
  return {
    scene, camera,
    ready: models.ready,
    update(frame) {
      resizeCamera(camera as THREE.PerspectiveCamera, frame.aspect);
      const step = settleStep(frame), { bass, loudness, impact } = frame.response, motion = frame.reducedMotion ? 0 : 1;
      time.value = frame.time; hue.value = frame.hue;
      spectrum.update(frame.audio.spectrum); logMapping.value = frame.spectrumMapping === 'log' ? 1 : 0; nyquist.value = frame.sampleRate / 2;
      const scale = tempo.update(frame.time, frame.audio.onset, frame.delta);
      beatPhase.value = tempo.phase;
      bounce.value = approach(bounce.value, frame.response.bounce * motion, step, 0.06);
      cheer.value = approach(cheer.value, Math.max(0, loudness - 0.35) * 1.4 * motion, step, 0.5);
      idle = frame.audio.onset ? 0 : idle + frame.delta;
      // Each beat sends a jump rippling out from the stage through the crowd.
      if (frame.audio.onset && motion) { beats++; waveAge.value = 0; waveHeight.value = 0.25 + impact * 0.9; }
      waveAge.value += step;
      beams.forEach(({ beam, material }, i) => {
        beam.rotation.set(Math.sin(frame.time * 0.5 + i) * 0.5 + 0.35 * Math.sign(towers[i][1]), 0, Math.cos(frame.time * 0.4 + i * 1.7) * 0.6);
        material.color.setHSL((frame.hue + i / 4) % 1, 1, 0.5).multiplyScalar(0.05 + frame.response.bounce * 0.12 + (beats % 4 === i ? 0.06 : 0));
      });
      if (mascot && player && body) {
        // Clips: bounce while the music plays, a jump on a hard hit, cheer when it gets loud, a wave in silence.
        loudHold = loudness > 0.7 ? loudHold + frame.delta : 0;
        if (frame.audio.onset && impact > 0.75 && jumpGate(frame.time, true)) player.play('jump');
        else if (loudHold > 1 && cheerGate(frame.time, true)) player.play('cheer');
        else if (idle > 5 && !player.playingShot) { player.play(random() < 0.5 ? 'wave' : 'look_around'); idle = 1; }
        overlay.reset();
        player.update(frame.delta, scale);
        // Squash and stretch: a spring the bass strikes, so the jelly squashes on the kick and wobbles back.
        const dt = Math.min(frame.delta, 1 / 30);
        springVelocity += (-spring * 180 - springVelocity * 7) * dt + (frame.audio.onset ? -bass * 7 * motion : 0);
        spring += springVelocity * dt;
        setMorph(squash, Math.max(0, -spring)); setMorph(stretch, Math.max(0, spring) * 0.8);
        const side = tempo.beats % 2 ? 1 : -1, lean = Math.sin(tempo.phase * Math.PI) * frame.response.bounce * motion * 0.6;
        setMorph(leanL, side > 0 ? lean : 0); setMorph(leanR, side < 0 ? lean : 0);
        setMorph(mouth, Math.min(1, loudness * 1.2));
        blinkIn -= frame.delta;
        setMorph(blink, blinkIn < 0.12 && blinkIn > 0 ? 1 : 0);
        if (blinkIn < 0) blinkIn = 2 + random() * 3;
        overlay.turn(body, 0, Math.sin(frame.time * 0.6) * 0.15 * motion, 0);
        if (core) core.emissiveIntensity = 0.8 + bass * 4 + frame.response.bounce * 2;
        if (cheeks) cheeks.emissiveIntensity = 0.4 + loudness * 1.5;
        // Confetti on drops: both cannons fire a burst of colour over the front rows.
        if (frame.audio.onset && impact > 0.85 && loudness > 0.6 && confettiGate(frame.time, true)) {
          for (const cannon of cannons) {
            cannon.updateMatrixWorld(true); cannon.getWorldPosition(muzzle); muzzle.y += 1.2;
            aim.set(Math.sign(muzzle.x) * 0.25, 1, 0.6).normalize();
            for (let k = 0; k < 90; k++) {
              const speed = 12 + random() * 10, colour = paper.setHSL(random(), 0.9, 0.6);
              confetti.emit(muzzle.x, muzzle.y, muzzle.z, (aim.x + (random() - 0.5) * 0.6) * speed, aim.y * speed, (aim.z + (random() - 0.5) * 0.6) * speed,
                1.8 + random() * 1.2, 0.3, colour.r, colour.g, colour.b);
            }
          }
        }
      }
      confetti.update(step);
      key.intensity = 260 + frame.response.bounce * 300;
      wash[0].intensity = wash[1].intensity = 15 + frame.response.bounce * 50;
      const orbit = frame.time * 0.06;
      // Just outside the crowd and above it, looking in over the heads at the stage.
      camera.position.set(Math.sin(orbit) * 23, 11 + Math.sin(frame.time * 0.13) * 1.5, Math.cos(orbit) * 23);
      camera.lookAt(0, 1.5, 0);
    },
    dispose() { models.dispose(); player?.dispose(); spectrum.dispose(); disposeScene(scene); },
  };
}
