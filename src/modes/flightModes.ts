import * as THREE from 'three/webgpu';
import { dot, mix, mx_fractal_noise_float, normalize, positionLocal, positionWorld, uniform, vec2, vec3 } from 'three/tsl';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { ModeFrame, VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, approach, beatGate, settleStep, bandEnergies } from './shared';
import { BoneOverlay, ClipPlayer, TempoTracker, createParticles, instantiate, loadTexture, prop, setMorph, whenLoaded, type Figure } from './figures';
import { createHits } from './hitPulse';
import { seededRandom } from '../rendering/diagnostics';
import dragonUrl from '../assets/models/dragon.glb?url';
import phoenixUrl from '../assets/models/phoenix_fenghuang.glb?url';
import spiresUrl from '../assets/models/sky_spires.glb?url';
import emberUrl from '../assets/fx/ember.png?url';
import smokeUrl from '../assets/fx/smoke.png?url';
import sparkUrl from '../assets/fx/spark.png?url';

const SCROLL_SPAN = 320;
export const ISLANDS = ['island_01', 'island_02', 'island_03', 'island_04', 'island_05', 'spire_01', 'spire_02', 'spire_03'] as const;

/**
 * Wing beat shape over one flap: a quick lift, a hard downstroke that bottoms out at 0.3 of the stroke,
 * then recovery. Returns the wing angle (positive is up) for a stroke `t` in 0–1.
 */
export function wingStroke(t: number) {
  if (t <= 0 || t >= 1) return 0;
  if (t < 0.15) return 0.55 * (t / 0.15);
  if (t < 0.35) return 0.55 - 1.45 * ((t - 0.15) / 0.2);
  return -0.9 * (1 - (t - 0.35) / 0.65) ** 2;
}

interface SkyLook { zenith: THREE.Color; horizon: THREE.Color; sun: THREE.Vector3; sunColour: THREE.Color; clouds: THREE.Color; fog: number }

/**
 * Shared flight scene: a sky dome, a sea of cloud far below that streams backward, and floating islands
 * and spires that drift past, so a flyer holding station near the origin reads as flying forward (+Z).
 */
function flightScene(look: SkyLook) {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).far = 1500;
  scene.fog = new THREE.Fog(look.fog, 160, 600);
  const time = uniform(0), travel = uniform(0), glow = uniform(0);
  const skyMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  const dir = normalize(positionLocal), sun = dot(dir, normalize(vec3(look.sun.x, look.sun.y, look.sun.z))).max(0);
  skyMaterial.colorNode = mix(vec3(look.horizon.r, look.horizon.g, look.horizon.b), vec3(look.zenith.r, look.zenith.g, look.zenith.b), dir.y.add(0.1).smoothstep(0, 0.6))
    .add(vec3(look.sunColour.r, look.sunColour.g, look.sunColour.b).mul(sun.pow(200).mul(2).add(sun.pow(8).mul(0.18)).mul(glow.mul(0.4).add(1))))
    // Below the horizon the dome falls to near black, so the gaps in the cloud sea read as depth, not glow.
    .mul(dir.y.smoothstep(-0.3, 0.02).mul(0.85).add(0.15));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), skyMaterial));
  // Cloud sea: fractal noise scrolled by the distance flown, lit from the sun side.
  const cloudMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const p = positionWorld.xz.add(vec2(0, travel));
  const puff = mx_fractal_noise_float(vec3(p.mul(0.012), time.mul(0.02)), 4, 2, 0.5).mul(0.5).add(0.5);
  const cover = puff.smoothstep(0.35, 0.75);
  cloudMaterial.colorNode = vec3(look.clouds.r, look.clouds.g, look.clouds.b).mul(cover.mul(0.8).add(0.2)).mul(glow.mul(0.5).add(1));
  cloudMaterial.opacityNode = cover.mul(0.9);
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), cloudMaterial);
  clouds.rotation.x = -Math.PI / 2; clouds.position.y = -60;
  scene.add(clouds);
  const islands: THREE.Object3D[] = [], random = seededRandom(808);
  const placeIslands = (spires: GLTF) => {
    for (let k = 0; k < 14; k++) {
      const name = ISLANDS[k % ISLANDS.length], piece = prop(spires, name), side = k % 2 ? 1 : -1, spire = name.startsWith('spire');
      piece.position.set(side * (45 + random() * 80), spire ? -60 : -25 + random() * 45, (k / 14) * SCROLL_SPAN - SCROLL_SPAN / 2);
      piece.rotation.y = random() * Math.PI * 2; piece.scale.setScalar(spire ? 2.2 : 1.2 + random() * 1.2);
      islands.push(piece); scene.add(piece);
    }
  };
  return {
    scene, camera, time, glow, placeIslands,
    /** Moves the world past the flyer by `distance` metres this frame. */
    fly(distance: number) {
      travel.value += distance;
      for (const island of islands) {
        island.position.z -= distance;
        if (island.position.z < -SCROLL_SPAN / 2) island.position.z += SCROLL_SPAN;
      }
    },
  };
}

/** The chase camera: in front of the flyer and off to one side, swinging slowly so its face and wings both read. */
function chase(camera: THREE.PerspectiveCamera, frame: ModeFrame, target: THREE.Vector3, distance: number, height: number) {
  // Above the flyer, so the wings read from above instead of edge-on.
  const swing = Math.sin(frame.time * 0.07) * 0.8 + 0.3;
  camera.position.set(target.x + Math.sin(swing) * distance, target.y + height + Math.sin(frame.time * 0.11) * 1.2, target.z + Math.cos(swing) * distance * 0.9);
  camera.lookAt(target.x, target.y + 0.5, target.z);
}

// ---------------------------------------------------------------- Dragon

export function createDragonMode(): VisualMode {
  const sky = flightScene({ zenith: new THREE.Color(0.012, 0.01, 0.035), horizon: new THREE.Color(0.16, 0.035, 0.03), sun: new THREE.Vector3(-0.6, 0.06, -1),
    sunColour: new THREE.Color(0.9, 0.3, 0.1), clouds: new THREE.Color(0.055, 0.03, 0.04), fog: 0x0a0507 });
  const { scene, camera } = sky;
  const sunLight = new THREE.DirectionalLight(0xffa070, 2.2); sunLight.position.set(-30, 12, -40);
  const fill = new THREE.HemisphereLight(0x6070a0, 0x200808, 0.7);
  const front = new THREE.DirectionalLight(0xc0c8ff, 0.9); front.position.set(10, 8, 30);
  // The fire lights the dragon's own head and chest from inside the flame.
  const fireLight = new THREE.PointLight(0xff7020, 0, 30, 1.5);
  scene.add(sunLight, fill, front, fireLight);
  const fire = createParticles(loadTexture(emberUrl), 700, { drag: 1.2, gravity: -2 });
  const smoke = createParticles(loadTexture(smokeUrl), 240, { drag: 0.8, gravity: -1.5, additive: false });
  scene.add(fire.object, smoke.object);

  let dragon: Figure | undefined, player: ClipPlayer | undefined;
  const overlay = new BoneOverlay(), tempo = new TempoTracker(), bands = new Float32Array(10);
  let wingL: THREE.Object3D[] = [], wingR: THREE.Object3D[] = [], neck: THREE.Object3D[] = [], tail: THREE.Object3D[] = [];
  let head: THREE.Object3D | undefined, jaw: THREE.Object3D | undefined, vents: THREE.MeshStandardMaterial[] = [];
  const models = whenLoaded([dragonUrl, spiresUrl], ([dragonModel, spires]) => {
    dragon = instantiate(dragonModel);
    scene.add(dragon.root);
    player = new ClipPlayer(dragon.root, dragon.clips);
    player.loop('glide', 0);
    // Bone axes (probed from the model): +X raises either wing and lifts neck and tail; +Z swings neck left, tail right.
    wingL = ['wing_L_upper', 'wing_L_fore'].map((n) => overlay.track(dragon!.node(n)));
    wingR = ['wing_R_upper', 'wing_R_fore'].map((n) => overlay.track(dragon!.node(n)));
    neck = [1, 2, 3, 4, 5, 6].map((i) => overlay.track(dragon!.node(`neck_0${i}`)));
    tail = Array.from({ length: 10 }, (_, i) => overlay.track(dragon!.node(`tail_${String(i + 1).padStart(2, '0')}`)));
    head = overlay.track(dragon.node('head')); jaw = dragon.node('jaw');
    vents = ['emissive_vents', 'emissive_mouth'].map((n) => dragon!.materials.get(n)).filter((m): m is THREE.MeshStandardMaterial => !!m);
    sky.placeIslands(spires);
  });

  const roarGate = beatGate(10), breathGate = beatGate(9), bankGate = beatGate(8);
  const mouth = new THREE.Vector3(), throat = new THREE.Vector3(), aim = new THREE.Vector3(), centre = new THREE.Vector3();
  const random = seededRandom(5);
  let stroke = 1, loudHold = 0, breathing = -1, beats = 0, swell = 0, wave = 0, heat = 0;
  return {
    scene, camera,
    ready: models.ready,
    update(frame) {
      resizeCamera(camera as THREE.PerspectiveCamera, frame.aspect);
      sky.time.value = frame.time;
      const step = settleStep(frame), { bounce, bass, loudness, impact } = frame.response, motion = frame.reducedMotion ? 0 : 1;
      const scale = tempo.update(frame.time, frame.audio.onset, frame.delta);
      bandEnergies(frame, bands.length, bands);
      sky.fly(frame.delta * (14 + bounce * 26));
      sky.glow.value = approach(sky.glow.value, loudness, step, 0.3);
      swell = approach(swell, bass, step, 0.08);
      if (frame.audio.onset) { beats++; if (stroke >= 1 || stroke > 0.6) stroke = 0; }
      stroke = Math.min(1, stroke + frame.delta * 1.6 * Math.max(1, scale));
      if (dragon && player && head && jaw) {
        // Accents: fire when the music stays loud, a roar on a hard hit every so often, banks between phrases.
        loudHold = loudness > 0.75 ? loudHold + frame.delta : 0;
        if (loudHold > 0.8 && breathGate(frame.time, true) && player.play('breath_fire')) breathing = 0;
        else if (frame.audio.onset && impact > 0.8 && beats % 8 === 0 && roarGate(frame.time, true)) player.play('roar');
        else if (frame.audio.onset && beats % 32 === 16 && bankGate(frame.time, true)) player.play(beats % 64 === 16 ? 'bank_L' : 'bank_R', 0.4);
        overlay.reset();
        player.update(frame.delta, scale);
        // Wings beat on the beat; the forearm lags the upper arm so the stroke whips.
        const lift = wingStroke(stroke) * motion * (0.6 + bounce * 0.6), lag = wingStroke(Math.max(0, stroke - 0.08)) * motion * (0.6 + bounce * 0.6);
        overlay.turn(wingL[0], lift); overlay.turn(wingR[0], lift);
        overlay.turn(wingL[1], lag * 0.5); overlay.turn(wingR[1], lag * 0.5);
        // The neck carries an S-wave on the bass and the head bobs; the tail waves with the spectrum.
        wave += frame.delta * (2.5 + bounce * 3) * motion;
        neck.forEach((bone, i) => overlay.turn(bone, Math.sin(wave * 1.6 - i * 0.7) * swell * 0.07 * motion, 0, Math.sin(wave * 0.8 - i * 0.5) * 0.03 * motion));
        overlay.turn(head, -swell * 0.12 * motion);
        tail.forEach((bone, i) => overlay.turn(bone, Math.sin(wave * 0.9 - i * 0.45) * 0.03 * motion, 0, Math.sin(wave * 1.2 - i * 0.55) * (0.03 + bands[i] * 0.09) * motion));
        // The body rises on each downstroke and drifts in slow figure-eights.
        dragon.root.position.set(Math.sin(frame.time * 0.31) * 2 * motion, Math.sin(frame.time * 0.5) * 1.2 * motion - lift * 0.8, 0);
        dragon.root.rotation.set(-lift * 0.08, 0, Math.sin(frame.time * 0.31) * 0.12 * motion);
        // Fire: from 0.7 s into breath_fire until the jaw closes, a jet leaves the mouth along the neck's line.
        if (breathing >= 0) {
          breathing += frame.delta * scale;
          const jet = breathing > 0.7 && breathing < 2.05;
          if (jet) {
            dragon.root.updateMatrixWorld(true);
            jaw.getWorldPosition(mouth); neck[5].getWorldPosition(throat);
            aim.subVectors(mouth, throat).normalize();
            for (let k = 0; k < 14; k++) {
              const speed = 26 + random() * 14, spread = 0.18;
              const hot = random();
              fire.emit(mouth.x, mouth.y, mouth.z, (aim.x + (random() - 0.5) * spread) * speed, (aim.y + (random() - 0.5) * spread) * speed, (aim.z + (random() - 0.5) * spread) * speed,
                0.6 + random() * 0.5, 1.4 + random() * 1.6, 2.2, 0.8 + hot * 0.9, 0.2 + hot * 0.4);
            }
            if (random() < 0.5) smoke.emit(mouth.x + aim.x * 12, mouth.y + aim.y * 12, mouth.z + aim.z * 12, aim.x * 6, aim.y * 6 + 2, aim.z * 6, 2.2, 5 + random() * 4, 0.12, 0.1, 0.1);
          }
          heat = approach(heat, jet ? 1 : 0, step, 0.12);
          if (breathing > 2.6) breathing = -1;
        } else heat = approach(heat, 0, step, 0.3);
        fireLight.position.copy(dragon.root.position).add(centre.set(0, 1, 5));
        fireLight.intensity = heat * 60;
        for (const material of vents) material.emissiveIntensity = 0.4 + loudness * 2.2 + heat * 3;
      }
      fire.update(step); smoke.update(step);
      chase(camera as THREE.PerspectiveCamera, frame, centre.set(0, dragon?.root.position.y ?? 0, -1), 19, 8);
    },
    dispose() { models.dispose(); player?.dispose(); disposeScene(scene); },
  };
}

// ---------------------------------------------------------------- Eastern Phoenix (Fenghuang)

const FEATHERS = 6, STREAMERS = ['A', 'B', 'C', 'D', 'E'] as const;
/** Where each wingtip sits relative to its hand bone's world position at rest (the Fenghuang build has no sockets). */
const WINGTIP_REACH = 1.55;

export function createPhoenixMode(): VisualMode {
  const sky = flightScene({ zenith: new THREE.Color(0.005, 0.008, 0.03), horizon: new THREE.Color(0.08, 0.03, 0.12), sun: new THREE.Vector3(0.4, 0.25, -1),
    sunColour: new THREE.Color(0.6, 0.65, 1), clouds: new THREE.Color(0.06, 0.05, 0.12), fog: 0x08060f });
  const { scene, camera } = sky;
  const moonLight = new THREE.DirectionalLight(0x8090ff, 0.8); moonLight.position.set(20, 20, -30);
  // Light from below too (the glowing cloud sea), so the undersides of the sheet-like wings are never black.
  const fill = new THREE.HemisphereLight(0x403060, 0x5a3048, 1.1);
  // The bird is its own light source: a warm point light at its heart that swells with the music.
  const heart = new THREE.PointLight(0xff6a1a, 3, 20, 1.8);
  // The Fenghuang's colours are mostly lit, not glowing (emerald scallops, indigo-to-gold primaries, orange
  // tail), so it gets a warm key from the front and a cool rim from behind to read against the night sky.
  const key = new THREE.DirectionalLight(0xffd0a0, 1.8); key.position.set(4, 12, 14);
  const rim = new THREE.DirectionalLight(0x7a90ff, 1.4); rim.position.set(-3, 6, -16);
  scene.add(moonLight, fill, heart, key, rim);
  const embers = createParticles(loadTexture(emberUrl), 1400, { drag: 0.6, gravity: 1.2 });
  const sparks = createParticles(loadTexture(sparkUrl), 300, { drag: 1.5 });
  scene.add(embers.object, sparks.object);

  let phoenix: Figure | undefined, player: ClipPlayer | undefined;
  const overlay = new BoneOverlay(), tempo = new TempoTracker();
  let wings: { upper: THREE.Object3D; fore: THREE.Object3D; feathers: THREE.Object3D[] }[] = [], tails: THREE.Object3D[][] = [], crest: THREE.Object3D[] = [];
  let tips: THREE.Object3D[] = [], chest: THREE.Object3D | undefined, glowing: { material: THREE.MeshStandardMaterial; base: number }[] = [];
  let neck: THREE.Object3D[] = [], squash: { mesh: THREE.Mesh; index: number }[] = [], stretch: { mesh: THREE.Mesh; index: number }[] = [];
  const models = whenLoaded([phoenixUrl, spiresUrl], ([phoenixModel, spires]) => {
    phoenix = instantiate(phoenixModel);
    scene.add(phoenix.root);
    player = new ClipPlayer(phoenix.root, phoenix.clips);
    player.loop('glide', 0);
    // Bone axes (probed): +X raises either wing and lifts a tail streamer; +Z swings a streamer toward −X.
    wings = (['L', 'R'] as const).map((side) => ({
      upper: overlay.track(phoenix!.node(`wing_${side}_upper`)),
      fore: overlay.track(phoenix!.node(`wing_${side}_fore`)),
      feathers: Array.from({ length: FEATHERS }, (_, k) => overlay.track(phoenix!.node(`wing_${side}_feather_0${k + 1}`))),
    }));
    tails = STREAMERS.map((s) => [1, 2, 3, 4].map((j) => overlay.track(phoenix!.node(`tail_${s}_0${j}`))));
    // Each crest plume has two bones; the base one swings the whole plume (`crest_0k` alone names the mesh).
    crest = [1, 2, 3].map((k) => overlay.track(phoenix!.node(`crest_0${k}_01`)));
    chest = phoenix.node('chest');
    neck = [overlay.track(phoenix.node('neck_01')), overlay.track(phoenix.node('neck_02'))];
    // The torso's own pulse shapes: squash on a kick, stretch on the rebound.
    squash = phoenix.morphs('pulse_squash'); stretch = phoenix.morphs('pulse_stretch');
    // No sockets in this build: hang a marker off each hand bone out at the wingtip, so it follows the flap.
    phoenix.root.updateMatrixWorld(true);
    tips = (['L', 'R'] as const).map((side, i) => {
      const hand = phoenix!.node(`wing_${side}_hand`), marker = new THREE.Object3D();
      hand.add(marker);
      marker.position.copy(hand.worldToLocal(hand.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(i ? -WINGTIP_REACH : WINGTIP_REACH, 0.05, -0.3))));
      return marker;
    });
    // Every glowing slot (plumage rims, cyan ocelli and tufts, crest beads, eyes) keeps its own strength from
    // the file; the music scales them together rather than flattening them to one value.
    glowing = [...phoenix.materials].filter(([n]) => n.startsWith('emissive_')).map(([, material]) => ({ material, base: material.emissiveIntensity }));
    sky.placeIslands(spires);
  });

  const dropGate = beatGate(6), random = seededRandom(9), at = new THREE.Vector3(), centre = new THREE.Vector3();
  const hits = createHits({ decay: 0.35, interval: 0.22 });
  let stroke = 1, strokePower = 0, spread = 0, spreadFor = 0, fan = 0, flare = 0, wave = 0, kick = 0, rebound = 0, bank = 0, bankTarget = 0, push = 0;
  return {
    scene, camera,
    ready: models.ready,
    update(frame) {
      resizeCamera(camera as THREE.PerspectiveCamera, frame.aspect);
      sky.time.value = frame.time;
      const step = settleStep(frame), { bounce, bass, loudness, impact } = frame.response, motion = frame.reducedMotion ? 0 : 1;
      const scale = tempo.update(frame.time, frame.audio.onset, frame.delta);
      hits.update(frame, 0.2);
      // Everything below scales with the sensitivity-scaled response (the bounce slider): silence glides,
      // quiet music beats gently, and loud music with the slider up beats hard and fast.
      sky.fly(frame.delta * (8 + bounce * 34));
      sky.glow.value = approach(sky.glow.value, loudness, step, 0.3);
      // A hit starts a wing beat whose depth comes from how hard it hit; while the music keeps going the bird
      // keeps beating at the tempo on its own, so it never stalls between detected beats.
      if (hits.fired) { stroke = 0; strokePower = Math.min(1, 0.35 + impact * 0.5 + bounce * 0.4); kick = 1; bankTarget = (random() - 0.5) * 0.5 * bounce; }
      else if (stroke >= 1 && bounce > 0.12) { stroke = 0; strokePower = Math.min(1, bounce * 0.8); }
      stroke = Math.min(1, stroke + frame.delta * (1.3 + bounce * 1.6) * Math.max(1, scale));
      // A drop (a hard hit while loud) throws the wings wide and holds them there for a moment, bursting sparks.
      if (hits.fired && impact > 0.7 && loudness > 0.5 && dropGate(frame.time, true)) {
        spreadFor = 1.4; flare = 1;
        if (chest) {
          chest.getWorldPosition(at);
          // Small and fast, so the burst rings the bird instead of hiding it.
          for (let k = 0; k < 80; k++) {
            const a = random() * Math.PI * 2, b = random() * Math.PI - Math.PI / 2, speed = 14 + random() * 14;
            sparks.emit(at.x, at.y, at.z, Math.cos(a) * Math.cos(b) * speed, Math.sin(b) * speed, Math.sin(a) * Math.cos(b) * speed, 0.5 + random() * 0.5, 0.15 + random() * 0.25, 2.5, 1.6, 0.6);
          }
        }
      }
      spreadFor = Math.max(0, spreadFor - frame.delta);
      spread = approach(spread, spreadFor > 0 ? 1 : 0, step, 0.15) * motion;
      flare = Math.max(0, flare - step * 1.5);
      fan = approach(fan, bass, step, 0.08);
      // Kick then rebound: the body squashes on the hit and stretches as it recovers.
      kick *= Math.exp(-step / 0.12); rebound = approach(rebound, kick > 0.3 ? 0 : (1 - kick) * kick * 4, step, 0.08);
      bankTarget *= Math.exp(-step / 1.2); bank = approach(bank, bankTarget, step, 0.25);
      push = approach(push, hits.level * 1.6 + bass * 0.8, step, 0.12);
      if (phoenix && player && chest) {
        overlay.reset();
        player.update(frame.delta, scale);
        // Wing beat depth: a little from the beat itself, mostly from the response, so the slider shows.
        const power = Math.min(1.35, 0.12 + bounce * 0.75 + strokePower * 0.55) * motion * (1 - spread * 0.7);
        // Primaries fan open in the wing plane as the music gets louder.
        const open = (loudness * 0.08 + spread * 0.06) * motion;
        wings.forEach((wing, side) => {
          overlay.turn(wing.upper, wingStroke(stroke) * power + spread * 0.35);
          overlay.turn(wing.fore, wingStroke(Math.max(0, stroke - 0.06)) * power * 0.6);
          wing.feathers.forEach((feather, k) => overlay.turn(feather, wingStroke(Math.max(0, stroke - 0.1 - k * 0.025)) * power * 0.4, (k - 2.5) * open * (side ? -1 : 1), 0));
        });
        // The long neck nods into each hit and the head comes back up; the crest flicks after it.
        const nod = (kick * 0.22 - rebound * 0.08) * motion;
        neck.forEach((bone, k) => overlay.turn(bone, nod * (k ? 0.6 : 1)));
        crest.forEach((bone, k) => overlay.turn(bone, (-wingStroke(Math.max(0, stroke - 0.05 * k)) * 0.25 - kick * 0.3) * motion));
        // Tail streamers fan out on the bass and lash on hits, the lash running down each streamer.
        wave += frame.delta * (1.5 + bounce * 4) * motion;
        const lash = 0.04 + loudness * 0.05 + hits.level * 0.12;
        tails.forEach((chain, s) => chain.forEach((bone, j) => overlay.turn(bone, Math.sin(wave * 1.3 - j * 0.8 - s * 0.4) * lash * motion, 0,
          j === 0 ? (s - 2) * (fan * 0.28 + spread * 0.15) * motion : Math.sin(wave - j * 0.7 + s) * lash * 0.6 * motion)));
        setMorph(squash, Math.min(1, kick * (0.4 + bass * 0.8)) * motion);
        setMorph(stretch, Math.min(1, rebound * (0.5 + bounce * 0.6)) * motion);
        const sway = Math.sin(frame.time * 0.27) * motion;
        phoenix.root.position.set(sway * 1.5, (Math.sin(frame.time * 0.6) * 0.8 - wingStroke(stroke) * power * 0.7 - kick * 0.25 * bounce + spread * 0.8) * motion, 0);
        phoenix.root.rotation.set((-spread * 0.25 + kick * 0.08) * motion, 0, (sway * 0.1 + bank + Math.sin(wave * 0.5) * bass * 0.12) * motion);
        // Glow follows the music: every slot brightens with loudness and flashes on hits; the heart light swells.
        const burn = 0.2 + loudness * 0.6 + bounce * 0.5 + hits.flash * 0.9 + flare * 1.2;
        for (const { material, base } of glowing) material.emissiveIntensity = base * (0.3 + burn * 0.7);
        chest.getWorldPosition(at); heart.position.copy(at); heart.intensity = 1 + burn * 6;
        // Ember trails from the wingtips: denser when loud, and a puff thrown off on every hit.
        const count = Math.round((0.5 + loudness * 2 + bounce * 2 + flare * 6 + (hits.fired ? 10 : 0)) * (frame.delta > 0 ? 1 : 0));
        for (const tip of tips) {
          tip.getWorldPosition(at);
          for (let k = 0; k < count; k++) {
            const hot = random(), burst = hits.fired ? 3 : 1;
            embers.emit(at.x + (random() - 0.5) * 0.4, at.y + (random() - 0.5) * 0.4, at.z, (random() - 0.5) * 1.5 * burst, random() * 1.5 * burst, -6 - random() * 6,
              0.6 + random() * 0.9, 0.08 + random() * 0.14, 1.6, 0.6 + hot * 0.6, 0.12 + hot * 0.2);
          }
        }
      }
      embers.update(step); sparks.update(step);
      // The camera pushes in on hits and the bass, and settles back out.
      chase(camera as THREE.PerspectiveCamera, frame, centre.set(0, phoenix?.root.position.y ?? 0, -0.5), 9.5 - push * motion, 6 - push * 0.4 * motion);
    },
    dispose() { models.dispose(); player?.dispose(); disposeScene(scene); },
  };
}
