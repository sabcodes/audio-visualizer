import * as THREE from 'three/webgpu';
import { float, mix, normalView, normalize, positionLocal, positionWorld, sin, uniform, vec3 } from 'three/tsl';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene, approach, settleStep, bandEnergies } from './shared';
import { TempoTracker, createGlowPoints, loadTexture, setMorph, whenLoaded } from './figures';
import { seededRandom } from '../rendering/diagnostics';
import jellyUrl from '../assets/models/jelly_blob.glb?url';
import smokeUrl from '../assets/fx/smoke.png?url';

const SECTORS = 12, BUBBLES = 70;

/**
 * Soft body over a mesh's vertices: seam duplicates are welded into shared particles, each pulled back to its rest
 * position by a spring and toward its neighbours' average (so dents spread as waves), with the base pinned.
 */
export function createSoftBody(positions: THREE.BufferAttribute, index: THREE.BufferAttribute | null) {
  const key = (i: number) => `${positions.getX(i).toFixed(4)},${positions.getY(i).toFixed(4)},${positions.getZ(i).toFixed(4)}`;
  const welded = new Map<string, number>(), particleOf = new Int32Array(positions.count), rest: number[] = [];
  for (let i = 0; i < positions.count; i++) {
    const k = key(i);
    let p = welded.get(k);
    if (p === undefined) { p = rest.length / 3; welded.set(k, p); rest.push(positions.getX(i), positions.getY(i), positions.getZ(i)); }
    particleOf[i] = p;
  }
  const count = rest.length / 3, home = Float32Array.from(rest), offset = new Float32Array(count * 3), velocity = new Float32Array(count * 3);
  const links = Array.from({ length: count }, () => new Set<number>());
  const corner = (k: number) => particleOf[index ? index.getX(k) : k];
  for (let t = 0, n = index ? index.count : positions.count; t < n; t += 3) {
    const a = corner(t), b = corner(t + 1), c = corner(t + 2);
    links[a].add(b).add(c); links[b].add(a).add(c); links[c].add(a).add(b);
  }
  const neighbours = links.map((set) => Int32Array.from(set));
  let height = 0;
  for (let p = 0; p < count; p++) height = Math.max(height, home[p * 3 + 1]);
  const pinned = Float32Array.from({ length: count }, (_, p) => Math.min(1, home[p * 3 + 1] / (height * 0.12)));
  const average = new Float32Array(3);
  return {
    count, home, offset, height,
    /** Pushes particle `p` by a velocity, scaled down near the pinned base. */
    kick(p: number, x: number, y: number, z: number) { const w = pinned[p]; velocity[p * 3] += x * w; velocity[p * 3 + 1] += y * w; velocity[p * 3 + 2] += z * w; },
    step(dt: number, stiffness = 140, coupling = 60, damping = 4.5) {
      for (let p = 0; p < count; p++) {
        const ns = neighbours[p];
        average.fill(0);
        for (const q of ns) { average[0] += offset[q * 3]; average[1] += offset[q * 3 + 1]; average[2] += offset[q * 3 + 2]; }
        for (let a = 0; a < 3; a++) {
          const o = offset[p * 3 + a], mean = ns.length ? average[a] / ns.length : 0;
          velocity[p * 3 + a] += (-o * stiffness + (mean - o) * coupling - velocity[p * 3 + a] * damping) * dt;
        }
      }
      for (let i = 0; i < offset.length; i++) offset[i] = (offset[i] + velocity[i] * dt) * (pinned[Math.floor(i / 3)] > 0 ? 1 : 0);
    },
    /** Writes the deformed shape into the mesh's position attribute. */
    write(target: THREE.BufferAttribute) {
      for (let i = 0; i < target.count; i++) {
        const p = particleOf[i];
        target.setXYZ(i, home[p * 3] + offset[p * 3], home[p * 3 + 1] + offset[p * 3 + 1], home[p * 3 + 2] + offset[p * 3 + 2]);
      }
      target.needsUpdate = true;
    },
  };
}
export type SoftBody = ReturnType<typeof createSoftBody>;

export function createJellyMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).far = 200;
  const time = uniform(0), hue = uniform(0), ringAge = uniform(9), ringStrength = uniform(0), glow = uniform(0);
  // A dark studio: glossy floor with a ring that pulses out from under the blob on each beat.
  const floorMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
  const r = positionWorld.xz.length(), ring = r.sub(ringAge.mul(6).add(1)).abs().smoothstep(0.35, 0).mul(ringStrength).mul(float(1).sub(ringAge.div(1.4)).max(0));
  const tint = vec3(sin(hue.mul(6.283)), sin(hue.mul(6.283).add(2.1)), sin(hue.mul(6.283).add(4.2))).mul(0.5).add(0.5);
  floorMaterial.colorNode = vec3(0.02, 0.018, 0.03);
  floorMaterial.emissiveNode = tint.mul(ring.mul(1.5).add(r.smoothstep(3, 0).mul(glow.mul(0.25))));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(150, 64), floorMaterial); floor.rotation.x = -Math.PI / 2;
  const backdropMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  backdropMaterial.colorNode = mix(vec3(0.004, 0.003, 0.01), tint.mul(0.05), normalize(positionLocal).y.mul(-1).add(0.3).clamp(0, 1));
  scene.add(floor, new THREE.Mesh(new THREE.SphereGeometry(190, 32, 16), backdropMaterial));
  const key = new THREE.DirectionalLight(0xe8dcff, 0.9); key.position.set(4, 8, 6);
  const rim = new THREE.DirectionalLight(0x9a7cff, 1.4); rim.position.set(-5, 4, -6);
  const fill = new THREE.HemisphereLight(0x6050a0, 0x050208, 0.5);
  scene.add(key, rim, fill);
  const bubbles = createGlowPoints(loadTexture(smokeUrl), BUBBLES), random = seededRandom(77);
  const drift = Array.from({ length: BUBBLES }, () => ({ x: (random() - 0.5) * 16, y: random() * 8, z: -4 - random() * 8, speed: 0.3 + random() * 0.6, size: 0.1 + random() * 0.25 }));
  scene.add(bubbles.object);

  let body: SoftBody | undefined, mesh: THREE.Mesh | undefined, face: THREE.Object3D | undefined, faceHome = new THREE.Vector3(), faceParticle = 0;
  let squash: { mesh: THREE.Mesh; index: number }[] = [], stretch: typeof squash = [];
  const models = whenLoaded([jellyUrl], ([jellyModel]) => {
    const root = jellyModel.scene.clone(true);
    root.traverse((object) => {
      const found = object as THREE.Mesh;
      if (!found.isMesh) return;
      found.frustumCulled = false;
      if (object.name === 'jelly') {
        // Own copy of the geometry, since the simulation rewrites its positions every frame.
        found.geometry = found.geometry.clone(); mesh = found;
        const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.12, metalness: 0, transparent: true });
        const fresnel = float(1).sub(normalView.z.abs()).pow(2.2);
        material.colorNode = mix(vec3(0.3, 0.1, 0.75), tint.mul(0.6), 0.25);
        material.emissiveNode = mix(vec3(0.45, 0.15, 1), tint, 0.4).mul(fresnel.mul(0.7).add(glow.mul(0.25)).add(0.08));
        material.opacityNode = fresnel.mul(0.35).add(0.62);
        found.material = material;
        squash = (found.morphTargetDictionary?.squash ?? -1) >= 0 ? [{ mesh: found, index: found.morphTargetDictionary!.squash }] : [];
        stretch = (found.morphTargetDictionary?.stretch ?? -1) >= 0 ? [{ mesh: found, index: found.morphTargetDictionary!.stretch }] : [];
      }
    });
    face = root.getObjectByName('jelly_face');
    if (!mesh) return;
    body = createSoftBody(mesh.geometry.attributes.position as THREE.BufferAttribute, mesh.geometry.index);
    // The face rides on the front of the surface: follow the particle nearest its centre.
    if (face) {
      faceHome.copy(face.position);
      const centre = new THREE.Box3().setFromObject(face).getCenter(new THREE.Vector3());
      let best = Infinity;
      for (let p = 0; p < body.count; p++) {
        const d = (body.home[p * 3] - centre.x) ** 2 + (body.home[p * 3 + 1] - centre.y) ** 2 + (body.home[p * 3 + 2] - centre.z) ** 2;
        if (d < best) { best = d; faceParticle = p; }
      }
    }
    root.scale.setScalar(1.4);
    scene.add(root);
  });

  const tempo = new TempoTracker(), bands = new Float32Array(SECTORS);
  let spring = 0, springVelocity = 0, lastImpact = 0;
  return {
    scene, camera,
    ready: models.ready,
    update(frame) {
      resizeCamera(camera as THREE.PerspectiveCamera, frame.aspect);
      time.value = frame.time; hue.value = frame.hue;
      const step = settleStep(frame), { bounce, bass, loudness, impact } = frame.response, motion = frame.reducedMotion ? 0 : 1;
      tempo.update(frame.time, frame.audio.onset, frame.delta);
      bandEnergies(frame, SECTORS, bands);
      glow.value = approach(glow.value, loudness, step, 0.2);
      if ((frame.audio.onset || impact > 0.6) && motion && ringAge.value > 0.3) { ringAge.value = 0; ringStrength.value = 0.5 + impact * 0.8; }
      ringAge.value += step;
      const dt = Math.min(frame.delta, 1 / 30);
      // Whole-body squash and stretch on a spring: it sinks with the bass and is struck by beats and hard hits.
      const hit = (frame.audio.onset || (impact > 0.45 && lastImpact <= 0.45)) && motion > 0;
      lastImpact = impact;
      springVelocity += ((-bass * 0.55 * motion - spring) * 160 - springVelocity * 6) * dt + (hit ? -(0.5 + bass) * 7 : 0);
      spring += springVelocity * dt;
      setMorph(squash, Math.max(0, -spring)); setMorph(stretch, Math.max(0, spring) * 0.7);
      if (body && mesh && dt > 0) {
        // Beats slap the body down and out; each spectrum band pushes its own slice outward, so the surface ripples
        // with the music; a slow wobble keeps it alive between beats.
        for (let p = 0; p < body.count; p++) {
          const x = body.home[p * 3], y = body.home[p * 3 + 1], z = body.home[p * 3 + 2], h = y / body.height;
          const sector = Math.floor(((Math.atan2(z, x) / (Math.PI * 2)) + 1) % 1 * SECTORS);
          const length = Math.hypot(x, z) || 1, push = (bands[sector] * 4 * h + Math.sin(frame.time * 3 + h * 6 + sector) * 0.8 * bounce) * motion;
          body.kick(p, (x / length) * push * dt * 8, Math.sin(frame.time * 4 + sector) * bounce * h * dt * 6 * motion, (z / length) * push * dt * 8);
          if (hit) body.kick(p, (x / length) * impact * 1.2, -h * (0.6 + bass) * 1.6, (z / length) * impact * 1.2);
        }
        body.step(dt);
        body.write(mesh.geometry.attributes.position as THREE.BufferAttribute);
        mesh.geometry.computeVertexNormals();
        if (face) face.position.set(faceHome.x + body.offset[faceParticle * 3], faceHome.y + body.offset[faceParticle * 3 + 1] - Math.max(0, -spring) * 0.3, faceHome.z + body.offset[faceParticle * 3 + 2]);
      }
      for (let i = 0; i < BUBBLES; i++) {
        const b = drift[i];
        if (motion) { b.y += b.speed * frame.delta * (1 + bounce * 2); if (b.y > 9) b.y = 0; }
        bubbles.set(i, b.x + Math.sin(frame.time * 0.5 + i) * 0.4, b.y, b.z, b.size * 2 * (1 + bounce), 0.35, 0.2, 0.9, 0.5);
      }
      bubbles.commit();
      const orbit = Math.sin(frame.time * 0.1) * 0.7;
      camera.position.set(Math.sin(orbit) * 5.6, 2.1 + Math.sin(frame.time * 0.15) * 0.25, Math.cos(orbit) * 5.6);
      camera.lookAt(0, 1.25, 0);
    },
    dispose() { models.dispose(); disposeScene(scene); },
  };
}
