import * as THREE from 'three/webgpu';
import { attribute, float, mix, mx_noise_float, normalGeometry, normalLocal, normalView, normalWorld, positionGeometry, positionLocal, positionView, sin, uniform, vec2, vec3, vertexColor } from 'three/tsl';
import { BoneOverlay, type Figure } from './figures';

/** A periodic stroke with rounded reversals and a faster power stroke. */
export function dragonStroke(phase: number) {
  const angle = phase * Math.PI * 2;
  return Math.sin(angle + Math.sin(angle) * 0.28);
}

/** Rest-space detail follows the skin rather than swimming over it as it bends. */
export function detailDragon(figure: Figure) {
  const time = uniform(0), pressure = uniform(0);
  const materials = new Map<THREE.Material, THREE.MeshStandardNodeMaterial>();
  figure.root.updateMatrixWorld(true);
  figure.root.traverse(object => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    mesh.geometry = mesh.geometry.clone();
    const source = mesh.material as THREE.MeshStandardMaterial;
    source.vertexColors = false;
    if (source.name === 'mat_body' || source.name === 'mat_belly') {
      const torso = mesh.morphTargetDictionary?.pulse_expand !== undefined;
      const face = mesh.name === 'head' || mesh.name === 'jaw' || /^(brow|cheek|lower_eyelid)_/.test(mesh.name);
      const ventral = torso || mesh.name === 'head' || mesh.name === 'jaw' ? 1 : 0.12;
      mesh.geometry.setAttribute('dragonVentral', new THREE.BufferAttribute(new Float32Array(mesh.geometry.attributes.position.count).fill(ventral), 1));
      mesh.geometry.setAttribute('dragonScaleDensity', new THREE.BufferAttribute(new Float32Array(mesh.geometry.attributes.position.count).fill(torso ? 1 : face ? 2 : 1.6), 1));
    }
    if (!['mat_body', 'mat_belly', 'mat_membrane', 'mat_horn'].includes(source.name)) return;
    let material = materials.get(source);
    if (!material) {
      material = new THREE.MeshStandardNodeMaterial().copy(source);
      material.vertexColors = false;
      const contact = mesh.geometry.hasAttribute('color') ? vertexColor().r : float(1);
      material.aoNode = contact;
      if (source.name === 'mat_body' || source.name === 'mat_belly') {
        // Staggered shield-shaped scales have a directional structure. Their
        // relief is in the normal only, so skin detail cannot inflate the neck.
        const warp = mx_noise_float(positionGeometry.mul(18)).mul(0.12);
        const density = attribute('dragonScaleDensity', 'float');
        // Blend complete planar samples, not their coordinates: mixing the
        // coordinates stretches scales into stripes around elbows and cheeks.
        const samples = [positionGeometry.zy, positionGeometry.zx, positionGeometry.xy].map(plane => {
          const projection = plane.mul(vec2(24, 30)).mul(density).add(vec2(warp, warp.mul(0.6)));
          const grid = vec2(projection.x.add(projection.y.floor().mod(2).mul(0.5)), projection.y).fract().sub(0.5);
          const shield = vec2(grid.x.mul(1.45), grid.y.add(grid.x.abs().mul(0.3))).length();
          return float(1).sub(shield.div(0.58).pow(3)).clamp(0, 1);
        });
        const weights = normalGeometry.abs().pow(6);
        const scale = samples[0].mul(weights.x).add(samples[1].mul(weights.y)).add(samples[2].mul(weights.z)).div(weights.x.add(weights.y).add(weights.z));
        const mottling = mx_noise_float(positionGeometry.mul(7)).mul(0.14).add(0.9);
        const blue = figure.materials.get('mat_body')!.color, belly = figure.materials.get('mat_belly')!.color;
        const underside = normalGeometry.y.negate().smoothstep(-0.08, 0.65).mul(attribute('dragonVentral', 'float'));
        const plates = sin(positionGeometry.z.mul(47).add(positionGeometry.x.abs().mul(3))).mul(0.5).add(0.5).pow(14).mul(underside);
        const dorsal = normalGeometry.y.smoothstep(0.05, 0.8).mul(-0.16).add(1);
        material.colorNode = mix(vec3(blue.r, blue.g, blue.b), vec3(belly.r, belly.g, belly.b), underside)
          .mul(mix(float(0.65), float(1.15), scale)).mul(mottling).mul(dorsal).mul(contact.pow(0.6)).mul(plates.mul(-0.18).add(1));
        material.roughnessNode = mix(float(0.82), float(0.52), scale);
        const height = scale.mul(0.0011).div(density).sub(plates.mul(0.0008)), dx = positionView.dFdx(), dy = positionView.dFdy();
        const r1 = dy.cross(normalView), r2 = normalView.cross(dx), det = dx.dot(r1);
        material.normalNode = normalView.mul(det.abs().max(1e-8)).sub(r1.mul(height.dFdx()).add(r2.mul(height.dFdy())).mul(det.sign())).normalize();
      }
      if (source.name === 'mat_horn') {
        const grain = mx_noise_float(positionGeometry.mul(vec3(90, 12, 90))).mul(0.12).add(0.86);
        material.colorNode = vec3(source.color.r, source.color.g, source.color.b).mul(grain).mul(contact);
        material.roughness = 0.7;
      }
      if (source.name === 'mat_membrane') {
        const grain = mx_noise_float(positionGeometry.mul(32)).mul(0.12).add(0.88);
        const fibres = sin(positionGeometry.x.mul(140).add(positionGeometry.z.mul(80))).mul(0.025).add(0.975);
        material.colorNode = vec3(source.color.r, source.color.g, source.color.b).mul(grain).mul(fibres).mul(contact);
        material.roughness = 0.78;
        // A thin membrane transmits sky light through its back face. The
        // scattering follows the posed normal instead of glowing uniformly.
        const through = normalWorld.dot(vec3(-0.45, 0.7, -0.55).normalize()).negate().max(0);
        material.emissiveNode = vec3(0.025, 0.065, 0.085).mul(through.mul(0.8).add(0.2));
        const ripple = sin(positionGeometry.z.mul(3.6).sub(time.mul(7))).mul(0.7)
          .add(sin(positionGeometry.x.mul(5).add(time.mul(9))).mul(0.3));
        material.positionNode = positionLocal.add(normalLocal.mul(attribute('dragonFlex', 'float').mul(ripple).mul(pressure)));
      }
      materials.set(source, material);
    }
    mesh.material = material;
    if (source.name !== 'mat_membrane') return;
    // Keep the membrane attached along the spars. Only the cloth between them
    // billows; calculate its distance from the rest-pose skeleton once on load.
    const bones = mesh.skeleton.bones;
    const supports = bones.flatMap((bone, i) => {
      if (!/Wing|Chest/.test(bone.name)) return [];
      const a = new THREE.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[i].clone().invert());
      return bone.children.filter(child => bones.includes(child as THREE.Bone)).map(child => {
        const j = bones.indexOf(child as THREE.Bone);
        const b = new THREE.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[j].clone().invert());
        return new THREE.Line3(a, b);
      });
    });
    const positions = mesh.geometry.attributes.position, flex = new Float32Array(positions.count);
    const p = new THREE.Vector3(), closest = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      p.fromBufferAttribute(positions, i).applyMatrix4(mesh.bindMatrix);
      let distance = Infinity;
      for (const support of supports) distance = Math.min(distance, p.distanceTo(support.closestPointToPoint(p, true, closest)));
      flex[i] = THREE.MathUtils.smoothstep(distance, 0.035, 0.3) * 0.13;
    }
    mesh.geometry.setAttribute('dragonFlex', new THREE.BufferAttribute(flex, 1));
  });
  return { update(clock: number, depth: number) { time.value = clock; pressure.value = depth; } };
}

/** All five finger chains flex after the wrist, instead of moving as a rigid fan. */
export function dragonWings(figure: Figure, overlay: BoneOverlay) {
  const wings = (['Left', 'Right'] as const).map((side, index) => ({
    sign: index === 0 ? 1 : -1,
    root: overlay.track(figure.node(`${side}WingRoot`)),
    elbow: overlay.track(figure.node(`${side}WingElbow`)),
    hand: overlay.track(figure.node(`${side}WingHand`)),
    fingers: Array.from({ length: 5 }, (_, i) => [0, 1].map(j => overlay.track(figure.node(`${side}WingFinger${i + 1}_${j}`)))),
  }));
  return (phase: number, depth: number, clock: number) => {
    const lift = dragonStroke(phase) * depth;
    for (const wing of wings) {
      const elbow = dragonStroke(phase - 0.09), wrist = dragonStroke(phase - 0.17);
      overlay.turn(wing.root, lift * 0.72);
      overlay.turn(wing.elbow, elbow * depth * 0.28, 0, (1 - elbow) * depth * wing.sign * 0.045);
      overlay.turn(wing.hand, wrist * depth * 0.22, wrist * depth * 0.08);
      wing.fingers.forEach(([base, tip], i) => {
        const follow = dragonStroke(phase - 0.2 - i * 0.018);
        overlay.turn(base, follow * depth * 0.055, 0, (1 - wrist) * (4 - i) * depth * wing.sign * 0.018);
        overlay.turn(tip, (follow * 0.1 + Math.sin(clock * 6 - i * 0.6) * 0.018) * depth);
      });
    }
    return lift;
  };
}
