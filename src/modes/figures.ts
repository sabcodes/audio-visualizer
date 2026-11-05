import * as THREE from 'three/webgpu';
import { float, instancedBufferAttribute, materialColor, mx_noise_float, normalView, positionLocal, texture as sampleTexture, uv, vec2, vec3 } from 'three/tsl';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// ---------------------------------------------------------------- Loading

const gltfCache = new Map<string, Promise<GLTF>>();
/** Loads a glTF once per URL; later callers share the parsed result and clone from it. */
export function loadGltf(url: string) {
  let pending = gltfCache.get(url);
  if (!pending) {
    pending = new GLTFLoader().loadAsync(url);
    pending.catch(() => gltfCache.delete(url));
    gltfCache.set(url, pending);
  }
  return pending;
}

const textureCache = new Map<string, THREE.Texture>();
/** A texture that fills in once its image arrives; shared per URL. */
export function loadTexture(url: string) {
  let map = textureCache.get(url);
  if (!map) {
    // Outside a browser (unit tests) there is no image decoder; a blank texture keeps modes constructible.
    map = typeof document === 'undefined' ? new THREE.Texture() : new THREE.TextureLoader().load(url);
    map.colorSpace = THREE.SRGBColorSpace;
    textureCache.set(url, map);
  }
  return map;
}

export type FigureMaterial = THREE.MeshStandardMaterial;
/** One instance of a loaded model, with its parts looked up by the names the asset spec fixes. */
export interface Figure {
  root: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
  /** Materials by name, cloned for this instance so glow can be driven per figure. */
  materials: Map<string, FigureMaterial>;
  node(name: string): THREE.Object3D;
  /** Meshes that carry a named morph target. */
  morphs(name: string): { mesh: THREE.Mesh; index: number }[];
}

/** Clones a loaded glTF (skeletons included) into an independent figure. */
export function instantiate(gltf: GLTF): Figure {
  const root = cloneSkinned(gltf.scene);
  const materials = new Map<string, FigureMaterial>(), byName = new Map<string, THREE.Object3D>();
  const geometries = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  root.traverse((object) => {
    if (!byName.has(object.name)) byName.set(object.name, object);
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    // Rebaking or disposing one visit must not mutate the cached glTF or a prepared sibling.
    let geometry = geometries.get(mesh.geometry);
    if (!geometry) { geometry = mesh.geometry.clone(); geometries.set(mesh.geometry, geometry); }
    mesh.geometry = geometry;
    const own = (material: THREE.Material) => {
      let copy = materials.get(material.name);
      if (!copy) { copy = (material as FigureMaterial).clone(); materials.set(material.name, copy); }
      return copy;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
  });
  return {
    root,
    clips: new Map(gltf.animations.map((clip) => [clip.name, clip])),
    materials,
    node(name) {
      const found = byName.get(name);
      if (!found) throw new Error(`Model has no node named ${name}`);
      return found;
    },
    morphs(name) {
      const found: { mesh: THREE.Mesh; index: number }[] = [];
      root.traverse((object) => {
        const mesh = object as THREE.Mesh, index = mesh.morphTargetDictionary?.[name];
        if (mesh.isMesh && index !== undefined) found.push({ mesh, index });
      });
      return found;
    },
  };
}

/** Sets a morph target's weight on every mesh that has it. */
export function setMorph(targets: readonly { mesh: THREE.Mesh; index: number }[], weight: number) {
  for (const { mesh, index } of targets) if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = weight;
}

/**
 * Builds a mode's figures once their files load. The mode stays usable (and disposable) before then;
 * `ready` resolves either way, so a missing file leaves an empty stage instead of a broken mode.
 */
export function whenLoaded<T>(urls: readonly string[], build: (models: GLTF[]) => T) {
  let disposed = false, built: T | undefined;
  const ready = Promise.all(urls.map(loadGltf)).then((models) => { if (!disposed) built = build(models); })
    .catch((error) => { if (!disposed) console.warn('Model load failed:', error); });
  return {
    ready,
    get value() { return built; },
    dispose() { disposed = true; },
  };
}

// ---------------------------------------------------------------- Clips

/**
 * Plays a figure's clips: one looping base clip at a time, crossfaded, plus one-shot accents that fade
 * back to the base when they end. Clips are authored at 120 BPM, so `tempo` scales them to the music.
 */
export class ClipPlayer {
  readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private base?: THREE.AnimationAction;
  private shot?: THREE.AnimationAction;
  constructor(root: THREE.Object3D, clips: Map<string, THREE.AnimationClip>) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const [name, clip] of clips) this.actions.set(name, this.mixer.clipAction(clip));
    this.mixer.addEventListener('finished', (event) => {
      if (event.action !== this.shot) return;
      this.shot = undefined;
      if (this.base) { this.base.enabled = true; this.base.setEffectiveWeight(1); event.action.crossFadeTo(this.base, 0.25, false); }
    });
  }
  has(name: string) { return this.actions.has(name); }
  get playingShot() { return this.shot ? this.shot.getClip().name : undefined; }
  /** Crossfades to a looping clip; a running one-shot keeps playing and returns to this one. */
  loop(name: string, fade = 0.35) {
    const next = this.actions.get(name);
    if (!next || next === this.base) return;
    next.reset().setLoop(THREE.LoopRepeat, Infinity).play();
    if (this.shot) next.setEffectiveWeight(0);
    else if (this.base) this.base.crossFadeTo(next, fade, false);
    else next.fadeIn(fade);
    if (this.shot && this.base) this.base.fadeOut(fade);
    this.base = next;
  }
  /** Plays a clip once over the base loop; ignored while another one-shot is still running unless `force`. */
  play(name: string, fade = 0.12, force = false) {
    const next = this.actions.get(name);
    if (!next || (this.shot && !force)) return false;
    if (this.shot) this.shot.fadeOut(fade);
    next.reset().setLoop(THREE.LoopOnce, 1).play();
    next.clampWhenFinished = true;
    if (this.base) this.base.crossFadeTo(next, fade, false); else next.fadeIn(fade);
    this.shot = next;
    return true;
  }
  update(delta: number, tempo = 1) {
    this.mixer.timeScale = tempo;
    this.mixer.update(delta);
  }
  dispose() { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.mixer.getRoot()); }
}

/**
 * Audio-driven bone offsets layered on top of clips. Each frame: `reset()` restores the rest pose of every
 * bone it drives (so offsets never accumulate on bones a clip does not key), the mixer poses the figure,
 * then `turn()` adds rotations about the bone's own axes.
 */
export class BoneOverlay {
  private readonly rest = new Map<THREE.Object3D, THREE.Quaternion>();
  private readonly scratch = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  track(bone: THREE.Object3D) { if (!this.rest.has(bone)) this.rest.set(bone, bone.quaternion.clone()); return bone; }
  reset() { for (const [bone, quaternion] of this.rest) bone.quaternion.copy(quaternion); }
  turn(bone: THREE.Object3D, x: number, y = 0, z = 0) {
    this.track(bone);
    bone.quaternion.multiply(this.scratch.setFromEuler(this.euler.set(x, y, z)));
  }
}

/**
 * Tempo from onset spacing: the median of recent beat intervals, folded into 80–160 BPM. Returns the
 * clip time scale (1 at 120 BPM), easing toward new tempos so clips never jump speed.
 */
export class TempoTracker {
  private readonly intervals: number[] = [];
  private last = -1;
  private scale = 1;
  private beatPhase = 0;
  private count = 0;
  update(time: number, onset: boolean, delta: number) {
    // Beat phase runs at the tracked tempo and snaps to 0 on each onset, so motion stays locked to the music.
    this.beatPhase = onset ? 0 : Math.min(this.beatPhase + Math.max(0, delta) * this.scale * 2, 0.999);
    if (onset) this.count++;
    if (onset) {
      if (this.last >= 0) {
        const gap = time - this.last;
        if (gap > 0.25 && gap < 2) { this.intervals.push(gap); if (this.intervals.length > 12) this.intervals.shift(); }
      }
      this.last = time;
    }
    if (this.intervals.length >= 4) {
      let bpm = 60 / [...this.intervals].sort((a, b) => a - b)[this.intervals.length >> 1];
      while (bpm < 80) bpm *= 2;
      while (bpm > 160) bpm /= 2;
      this.scale += (bpm / 120 - this.scale) * (1 - Math.exp(-Math.max(0, delta) / 1.5));
    }
    return this.scale;
  }
  get timeScale() { return this.scale; }
  /** 0 at each beat, rising to 1 by the next (at the tracked tempo). */
  get phase() { return this.beatPhase; }
  /** Beats counted so far; odd and even beats let motion alternate sides. */
  get beats() { return this.count; }
}

// ---------------------------------------------------------------- Particles

/**
 * Additive sprite particles (fire, embers, confetti) simulated on the CPU: `emit` spawns one with a velocity,
 * life, size and colour; `update` moves them under gravity and drag and fades them out over their life.
 */
export function createParticles(map: THREE.Texture, capacity: number, options: { gravity?: number; drag?: number; additive?: boolean } = {}) {
  const { gravity = 0, drag = 0, additive = true } = options;
  const position = new Float32Array(capacity * 4), tint = new Float32Array(capacity * 4);
  const velocity = new Float32Array(capacity * 3), age = new Float32Array(capacity), life = new Float32Array(capacity).fill(1), size = new Float32Array(capacity);
  const colour = new Float32Array(capacity * 3);
  const positionAttribute = new THREE.InstancedBufferAttribute(position, 4), tintAttribute = new THREE.InstancedBufferAttribute(tint, 4);
  positionAttribute.setUsage(THREE.DynamicDrawUsage); tintAttribute.setUsage(THREE.DynamicDrawUsage);
  const at = instancedBufferAttribute<'vec4'>(positionAttribute, 'vec4'), hue = instancedBufferAttribute<'vec4'>(tintAttribute, 'vec4');
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  material.positionNode = at.xyz;
  material.scaleNode = vec2(at.w);
  const sample = sampleTexture(map, uv());
  material.colorNode = vec3(hue.xyz).mul(sample.rgb);
  material.opacityNode = sample.a.mul(hue.w).mul(float(1));
  const sprites = new THREE.Sprite(material);
  sprites.geometry = sprites.geometry.clone(); sprites.count = capacity; sprites.frustumCulled = false;
  let next = 0;
  for (let i = 0; i < capacity; i++) age[i] = 1, life[i] = 1;
  return {
    object: sprites,
    emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, seconds: number, scale: number, r: number, g: number, b: number) {
      const i = next; next = (next + 1) % capacity;
      position.set([x, y, z, scale], i * 4); velocity.set([vx, vy, vz], i * 3); colour.set([r, g, b], i * 3);
      age[i] = 0; life[i] = seconds; size[i] = scale;
    },
    update(delta: number) {
      const keep = Math.exp(-drag * delta);
      for (let i = 0; i < capacity; i++) {
        if (age[i] >= life[i]) { tint[i * 4 + 3] = 0; position[i * 4 + 3] = 0; continue; }
        age[i] += delta;
        const t = Math.min(1, age[i] / life[i]);
        velocity[i * 3] *= keep; velocity[i * 3 + 1] = velocity[i * 3 + 1] * keep - gravity * delta; velocity[i * 3 + 2] *= keep;
        position[i * 4] += velocity[i * 3] * delta; position[i * 4 + 1] += velocity[i * 3 + 1] * delta; position[i * 4 + 2] += velocity[i * 3 + 2] * delta;
        // Grows a little as it fades, like hot gas spreading.
        position[i * 4 + 3] = size[i] * (1 + t * 0.6);
        tint.set([colour[i * 3], colour[i * 3 + 1], colour[i * 3 + 2], (1 - t) * Math.min(1, t * 12)], i * 4);
      }
      positionAttribute.needsUpdate = true; tintAttribute.needsUpdate = true;
    },
  };
}
export type Particles = ReturnType<typeof createParticles>;

/** Every `emissive_*` material of a figure, for driving glow from the music. */
export function glowMaterials(figure: Figure) {
  return [...figure.materials].filter(([name]) => name.startsWith('emissive_')).map(([, material]) => material);
}

/**
 * A copy of one named prop from a props file, re-centred so its pivot sits at the middle of its footprint on
 * the ground (the props files lay their pieces out side by side in the geometry itself).
 */
export function prop(gltf: GLTF, name: string) {
  const source = gltf.scene.getObjectByName(name);
  if (!source) throw new Error(`Props file has no node named ${name}`);
  const copy = source.clone(), pivot = new THREE.Group();
  copy.position.set(0, 0, 0); copy.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(copy), centre = box.getCenter(new THREE.Vector3());
  copy.position.set(-centre.x, -box.min.y, -centre.z);
  pivot.add(copy);
  return pivot;
}

/** Glowing sprites placed directly each frame (fireflies, stage dots), as opposed to emitted particles. */
export function createGlowPoints(map: THREE.Texture, count: number) {
  const position = new Float32Array(count * 4), tint = new Float32Array(count * 4);
  const positionAttribute = new THREE.InstancedBufferAttribute(position, 4), tintAttribute = new THREE.InstancedBufferAttribute(tint, 4);
  positionAttribute.setUsage(THREE.DynamicDrawUsage); tintAttribute.setUsage(THREE.DynamicDrawUsage);
  const at = instancedBufferAttribute<'vec4'>(positionAttribute, 'vec4'), hue = instancedBufferAttribute<'vec4'>(tintAttribute, 'vec4');
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  material.positionNode = at.xyz; material.scaleNode = vec2(at.w);
  const sample = sampleTexture(map, uv());
  material.colorNode = vec3(hue.xyz).mul(sample.rgb); material.opacityNode = sample.a.mul(hue.w);
  const sprites = new THREE.Sprite(material);
  sprites.geometry = sprites.geometry.clone(); sprites.count = count; sprites.frustumCulled = false;
  return {
    object: sprites,
    set(i: number, x: number, y: number, z: number, size: number, r: number, g: number, b: number, a = 1) {
      position.set([x, y, z, size], i * 4); tint.set([r, g, b, a], i * 4);
    },
    commit() { positionAttribute.needsUpdate = true; tintAttribute.needsUpdate = true; },
  };
}

/**
 * A soft stage-light shaft material: brightest at the lamp (the top of a cylinder translated to hang below its
 * origin), fading along its length and at its side-on edges, grainy with haze. Its colour is `material.color`.
 */
export function shaftMaterial(time: THREE.Node<'float'>) {
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const haze = mx_noise_float(vec3(positionLocal.x.mul(0.3), positionLocal.y.mul(0.08).add(time.mul(0.3)), positionLocal.z.mul(0.3))).mul(0.3).add(0.75);
  material.colorNode = materialColor.mul(uv().y.pow(1.6)).mul(normalView.z.abs().pow(1.6)).mul(haze);
  return material;
}

/** Re-parents a node under a pivot at the centre of its own bounds, so it can wobble or pulse in place. */
export function repivot(node: THREE.Object3D) {
  const parent = node.parent!;
  parent.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(node), centre = parent.worldToLocal(box.getCenter(new THREE.Vector3()));
  const pivot = new THREE.Group();
  pivot.position.copy(centre);
  parent.add(pivot);
  node.position.sub(centre);
  pivot.add(node);
  return pivot;
}
