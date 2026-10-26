import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { float, hash, instanceIndex, instancedBufferAttribute, mx_noise_vec3, uniform, vec3 } from 'three/tsl';

type F = Node<'float'>;
type V3 = Node<'vec3'>;
type V4 = Node<'vec4'>;

/**
 * The point-cloud engine LIDAR Trail and Scan Sprout share. Shapes are sampled into a flat set of points on the
 * CPU once; each point carries a normal (the way it scatters) and an anchor (x, y, z, birth): the point it grows
 * out from and the growth level at which it appears. Everything per frame happens in the vertex shader.
 */
export class PointSet {
  readonly position: Float32Array;
  readonly normal: Float32Array;
  readonly anchor: Float32Array;
  count = 0;
  constructor(readonly capacity: number) {
    this.position = new Float32Array(capacity * 3); this.normal = new Float32Array(capacity * 3); this.anchor = new Float32Array(capacity * 4);
  }
  get full() { return this.count >= this.capacity; }
  /** Adds one point; without an anchor it grows from itself and is there from the start. */
  add(x: number, y: number, z: number, nx: number, ny: number, nz: number, anchor?: readonly [number, number, number], birth = 0) {
    if (this.full) return;
    const i = this.count++;
    this.position.set([x, y, z], i * 3); this.normal.set([nx, ny, nz], i * 3);
    this.anchor.set([anchor ? anchor[0] : x, anchor ? anchor[1] : y, anchor ? anchor[2] : z, birth], i * 4);
  }
  /** `n` points on a vertical cylinder (a trunk or a stem), normals pointing out. */
  cylinder(n: number, x: number, z: number, radius: number, y0: number, y1: number, random: () => number, taper = 0.6) {
    for (let k = 0; k < n; k++) {
      const a = random() * Math.PI * 2, t = random(), r = radius * (1 - t * (1 - taper)) * (0.92 + random() * 0.16);
      this.add(x + Math.cos(a) * r, y0 + (y1 - y0) * t, z + Math.sin(a) * r, Math.cos(a), 0, Math.sin(a));
    }
  }
  /** `n` points in a lumpy blob (a tree crown or a bush), denser toward its skin so it reads as foliage. */
  blob(n: number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, random: () => number) {
    for (let k = 0; k < n; k++) {
      const u = random() * 2 - 1, a = random() * Math.PI * 2, s = Math.sqrt(1 - u * u), shell = Math.pow(random(), 0.25);
      const lump = 0.8 + 0.25 * Math.sin(a * 5 + u * 7) * Math.sin(a * 3 - u * 4);
      const nx = s * Math.cos(a), ny = u, nz = s * Math.sin(a);
      this.add(cx + nx * rx * shell * lump, cy + ny * ry * shell * lump, cz + nz * rz * shell * lump, nx, ny, nz);
    }
  }
}

/** Grows a point out of its anchor: hidden before its birth, then sliding out from the anchor over `span` of growth. */
export function unfold(position: V3, anchor: V4, growth: F, span = 0.06) {
  const amount = growth.sub(anchor.w).div(span).clamp(0, 1);
  const eased = amount.mul(amount).mul(amount.mul(-2).add(3));
  return { position: anchor.xyz.add(position.sub(anchor.xyz).mul(eased)), shown: growth.greaterThanEqual(anchor.w).select(float(1), float(0)), amount: eased };
}

export interface PointCloudOptions {
  /** Moves each point before the scatter (for example to wrap an endless walk); defaults to no change. */
  place?: (position: V3) => V3;
  /** Growth span for `unfold`. */
  span?: number;
}

/**
 * The set as instanced point sprites (WebGPU points are otherwise a fixed pixel), with the shared per-frame motion:
 * growth, a scatter along each point's normal that kicks drive, a fine noise jitter for hats, and size.
 */
export function createPointCloud(set: PointSet, options: PointCloudOptions = {}) {
  const uniforms = { time: uniform(0), growth: uniform(1), scatter: uniform(0), jitter: uniform(0), size: uniform(1.5) };
  const base = instancedBufferAttribute<'vec3'>(new THREE.InstancedBufferAttribute(set.position, 3), 'vec3');
  const normal = instancedBufferAttribute<'vec3'>(new THREE.InstancedBufferAttribute(set.normal, 3), 'vec3');
  const anchor = instancedBufferAttribute<'vec4'>(new THREE.InstancedBufferAttribute(set.anchor, 4), 'vec4');
  const seed = hash(instanceIndex);
  const grown = unfold(base, anchor, uniforms.growth, options.span);
  const placed = options.place ? options.place(grown.position) : grown.position;
  // Each point flies out along its normal by its own share of the scatter, plus a little noise so it isn't a pure explosion.
  const wobble = mx_noise_vec3(placed.mul(0.7).add(vec3(0, uniforms.time.mul(0.5), 0)));
  const scattered = placed.add(normal.add(wobble.mul(0.6)).mul(uniforms.scatter.mul(seed.mul(0.8).add(0.2))));
  // Hat jitter: a fast, fine noise shake.
  const jittered = scattered.add(mx_noise_vec3(placed.mul(37).add(vec3(uniforms.time.mul(23), 0, 0))).mul(uniforms.jitter));
  const material = new THREE.PointsNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false });
  material.positionNode = jittered;
  material.sizeNode = uniforms.size;
  const sprite = new THREE.Sprite(material);
  sprite.geometry = sprite.geometry.clone(); sprite.count = set.count; sprite.frustumCulled = false;
  return { sprite, material, uniforms, nodes: { base, normal, anchor, seed, position: jittered, placed, shown: grown.shown, amount: grown.amount } };
}
export type PointCloud = ReturnType<typeof createPointCloud>;

/**
 * Plexus lines: up to `lines` pairs of points from the set that sit within `reach` of each other, as line
 * segments with each end's anchor, so the lines grow with the points they join. A per-line seed rides in `seed`.
 */
export function plexusGeometry(set: PointSet, lines: number, reach: number, random: () => number, tries = 40) {
  const position = new Float32Array(lines * 6), anchor = new Float32Array(lines * 8), seeds = new Float32Array(lines * 2);
  let written = 0;
  for (let l = 0; l < lines * tries && written < lines; l++) {
    const a = Math.floor(random() * set.count), b = Math.floor(random() * set.count);
    const dx = set.position[a * 3] - set.position[b * 3], dy = set.position[a * 3 + 1] - set.position[b * 3 + 1], dz = set.position[a * 3 + 2] - set.position[b * 3 + 2];
    const d = Math.hypot(dx, dy, dz);
    if (a === b || d > reach || d < reach * 0.15) continue;
    const birth = Math.max(set.anchor[a * 4 + 3], set.anchor[b * 4 + 3]), s = random();
    for (const [end, i] of [[0, a], [1, b]] as const) {
      position.set(set.position.subarray(i * 3, i * 3 + 3), written * 6 + end * 3);
      anchor.set([set.anchor[i * 4], set.anchor[i * 4 + 1], set.anchor[i * 4 + 2], birth], written * 8 + end * 4);
      seeds[written * 2 + end] = s;
    }
    written++;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('anchor', new THREE.BufferAttribute(anchor, 4));
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
  geometry.setDrawRange(0, written * 2);
  return { geometry, count: written };
}
