import * as THREE from 'three/webgpu';
import { cos, instancedBufferAttribute, sin, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { seededRandom } from '../rendering/diagnostics';

export type SpikeMode = 'scene' | 'rings' | 'particles';
export interface SpikeScene {
  scene: THREE.Scene;
  camera: THREE.Camera;
  update(time: number, bass: number, aspect: number): void;
  dispose(): void;
}

// Only the selected scene is allocated. Seed + explicit time make images repeatable.
export function createSpikeScene(mode: SpikeMode): SpikeScene {
  const scene = new THREE.Scene();
  const camera = mode === 'rings'
    ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2)
    : new THREE.PerspectiveCamera(65, 1, 0.1, 1000);
  camera.position.z = mode === 'rings' ? 1 : 85;
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const t = uniform(0);
  const energy = uniform(0);
  const aspect = uniform(1);
  let animated: THREE.Object3D | undefined;

  if (mode === 'rings') {
    const material = new THREE.MeshBasicNodeMaterial();
    // Ascending smoothsteps only; aspect-correct circular silhouettes.
    const p = uv().sub(0.5).mul(vec2(aspect, 1)).mul(2);
    const r = p.length();
    const wave = cos(r.sub(energy.mul(0.25)).mul(48).sub(t.mul(1.8)));
    const bands = wave.smoothstep(0.88, 1);
    const fade = r.smoothstep(0.15, 1.4).oneMinus();
    const color = vec3(
      sin(r.mul(4).add(t.mul(0.2))).mul(0.5).add(0.5),
      sin(r.mul(4).add(2.1)).mul(0.5).add(0.5),
      sin(r.mul(4).add(4.2)).mul(0.5).add(0.5),
    );
    material.fragmentNode = vec4(color.mul(bands).mul(fade).mul(2), 1);
    material.depthTest = false;
    material.depthWrite = false;
    const geometry = new THREE.PlaneGeometry(2, 2);
    scene.add(new THREE.Mesh(geometry, material));
    materials.push(material);
    geometries.push(geometry);
  } else if (mode === 'particles') {
    const random = seededRandom(42);
    const seeds = new Float32Array(8000 * 3);
    for (let i = 0; i < seeds.length; i += 3) {
      seeds[i] = random() * Math.PI * 2;
      seeds[i + 1] = 16 + random() * 22;
      seeds[i + 2] = (random() - 0.5) * 18;
    }
    const seed = instancedBufferAttribute<'vec3'>(new THREE.InstancedBufferAttribute(seeds, 3), 'vec3');
    const angle = seed.x.add(t.mul(0.4).mul(seed.y.div(40).add(0.2)));
    const radius = seed.y.mul(energy.mul(0.6).add(1));
    const material = new THREE.SpriteNodeMaterial({
      color: 0x50bfff, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    material.positionNode = vec3(cos(angle).mul(radius), seed.z, sin(angle).mul(radius));
    material.scaleNode = vec2(0.45);
    material.opacityNode = uv().sub(0.5).length().smoothstep(0.08, 0.5).oneMinus().mul(0.7);
    const sprites = new THREE.Sprite(material);
    sprites.count = 8000;
    // Analytic positions don't match the shared sprite's static geometry bounds.
    sprites.frustumCulled = false;
    scene.add(sprites);
    materials.push(material);
    // This is an analytic vertex animation, not a compute/storage claim.
  } else {
    const geometry = new THREE.TorusKnotGeometry(16, 0.6, 192, 8);
    const material = new THREE.MeshBasicNodeMaterial({ color: 0x40dfff });
    material.colorNode = vec3(0.1, 0.8, 1).mul(energy.add(1.2));
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    animated = mesh;
    geometries.push(geometry);
    materials.push(material);
  }

  return {
    scene, camera,
    update(time, bass, ratio) {
      t.value = time;
      energy.value = bass;
      aspect.value = ratio;
      if (camera instanceof THREE.PerspectiveCamera && camera.aspect !== ratio) {
        camera.aspect = ratio;
        camera.updateProjectionMatrix();
      }
      if (animated) {
        animated.rotation.set(time * 0.17, time * 0.3, 0);
        animated.scale.setScalar(1 + bass * 0.15);
      }
    },
    dispose() {
      scene.clear();
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
    },
  };
}
