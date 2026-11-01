import * as THREE from 'three/webgpu';
import { abs, mix, normalView, normalWorld, uv, vec3 } from 'three/tsl';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const FACE = { x: 0.098, y: 1.505, ry: 0.125, z: 0.045, rz: 0.108 };
const jawWidth = (y: number) => 1 - 0.25 * THREE.MathUtils.clamp((-0.15 - y) / 0.85, 0, 1);
/** The same cheek surface is used for the skull and every facial drawing, avoiding floating eyeballs. */
export function nightRiderFaceZ(x: number, y: number) {
  const ny = (y - FACE.y) / FACE.ry, nx = x / (FACE.x * jawWidth(ny));
  return FACE.z + FACE.rz * Math.pow(Math.max(0, 1 - nx * nx - ny * ny), 0.225);
}

/** Runtime-only appearance pass. Original GLBs and their authored animation tracks remain unchanged. */
export function polishNightRider(rider: THREE.Object3D) {
  const skull = rider.getObjectByName('head_skull') as THREE.SkinnedMesh;
  const headJoint = skull.skeleton.bones.findIndex((bone) => bone.name === 'Head');
  const softSkin = new THREE.MeshBasicNodeMaterial(); softSkin.name = 'anime warm skin';
  const light = normalWorld.dot(vec3(-0.45, 0.65, 0.6).normalize()).mul(0.5).add(0.5);
  const shade = light.smoothstep(0.25, 0.75).mul(0.45).add(0.45);
  const rim = abs(normalView.z).oneMinus().pow(5);
  const skinTone = new THREE.Color(0xffc9b2);
  softSkin.colorNode = vec3(skinTone.r, skinTone.g, skinTone.b).mul(shade).add(vec3(0.12, 0.025, 0.05).mul(rim));

  const headGeometry = new THREE.SphereGeometry(1, 48, 40);
  const points = headGeometry.getAttribute('position');
  for (let i = 0; i < points.count; i++) {
    const nx = points.getX(i), ny = points.getY(i), nz = points.getZ(i);
    points.setXYZ(i, nx * FACE.x * jawWidth(ny), FACE.y + ny * FACE.ry,
      FACE.z + (nz > 0 ? Math.pow(nz, 0.45) : nz) * FACE.rz);
  }
  headGeometry.computeVertexNormals();
  // All new facial vertices use the supplied Head joint and its existing inverse bind matrix.
  const bindFace = (geometry: THREE.BufferGeometry, material: THREE.Material, name: string) => {
    const count = geometry.getAttribute('position').count, joints = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) { joints[i * 4] = headJoint; weights[i * 4] = 1; }
    geometry.setAttribute('skinIndex', new THREE.BufferAttribute(joints, 4));
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4));
    const mesh = new THREE.SkinnedMesh(geometry, material); mesh.name = name; mesh.frustumCulled = false;
    mesh.bind(skull.skeleton, skull.bindMatrix); skull.parent!.add(mesh); return mesh;
  };
  skull.visible = false;
  bindFace(headGeometry, softSkin, 'anime face / sculpted cheeks and jaw');
  for (const name of ['head_eye_Left', 'head_eye_Right', 'head_iris_Left', 'head_iris_Right',
    'head_highlight_Left', 'head_highlight_Right', 'head_brow_Left', 'head_brow_Right', 'head_nose', 'head_mouth']) {
    rider.getObjectByName(name)!.visible = false;
  }
  for (const name of ['head_ear_Left', 'head_ear_Right']) (rider.getObjectByName(name) as THREE.Mesh).material = softSkin;

  const ink = new THREE.MeshBasicNodeMaterial({ color: 0x141327 });
  const white = new THREE.MeshBasicNodeMaterial({ color: 0xf4eeee });
  const shine = new THREE.MeshBasicNodeMaterial({ color: 0xffffff });
  const iris = new THREE.MeshBasicNodeMaterial(); iris.name = 'anime teal iris';
  iris.colorNode = mix(vec3(0.015, 0.06, 0.08), vec3(0.08, 0.65, 0.55), uv().y.oneMinus().smoothstep(0.1, 0.9));
  const lips = new THREE.MeshBasicNodeMaterial({ color: 0x9c4d60 });
  const blush = new THREE.MeshBasicNodeMaterial({ color: 0xf0879b, transparent: true, opacity: 0.16, depthWrite: false });

  const surface = (geometry: THREE.BufferGeometry, x: number, y: number, lift: number, material: THREE.Material, name: string) => {
    const p = geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i) + x, py = p.getY(i) + y;
      p.setXYZ(i, px, py, nightRiderFaceZ(px, py) + lift);
    }
    geometry.computeVertexNormals(); return bindFace(geometry, material, name);
  };
  const ellipse = (rx: number, ry: number) => new THREE.CircleGeometry(1, 40).scale(rx, ry, 1);
  const eyeShape = (w: number, h: number) => {
    const shape = new THREE.Shape(); shape.moveTo(-w, -0.001);
    shape.bezierCurveTo(-w * 0.55, h * 1.15, w * 0.48, h * 1.18, w, h * 0.13);
    shape.bezierCurveTo(w * 0.4, -h * 0.9, -w * 0.55, -h * 0.72, -w, -0.001);
    return new THREE.ShapeGeometry(shape, 24);
  };
  for (const side of [-1, 1]) {
    const x = side * 0.046, y = 1.516;
    surface(eyeShape(0.027, 0.014), x, y, 0.0011, ink, `anime eye outline ${side}`);
    surface(eyeShape(0.024, 0.0115), x, y - 0.0005, 0.0017, white, `anime almond eye ${side}`);
    surface(ellipse(0.0095, 0.0115), x - side * 0.0015, y, 0.0024, iris, `anime iris ${side}`);
    surface(ellipse(0.004, 0.008), x - side * 0.0015, y + 0.001, 0.0031, ink, `anime pupil ${side}`);
    surface(ellipse(0.0035, 0.004), x - 0.003, y + 0.005, 0.0038, shine, `anime catchlight ${side}`);
    surface(ellipse(0.0015, 0.0016), x + 0.0035, y - 0.005, 0.0038, shine, `anime lower catchlight ${side}`);
    const brow = new THREE.Shape(); brow.moveTo(-0.021, 0); brow.quadraticCurveTo(0, 0.009, 0.02, 0.002);
    brow.quadraticCurveTo(0, 0.004, -0.021, -0.002);
    surface(new THREE.ShapeGeometry(brow, 16), x, 1.543, 0.0015, ink, `anime tapered brow ${side}`);
    surface(ellipse(0.017, 0.007), side * 0.058, 1.478, 0.001, blush, `anime cheek tint ${side}`);
  }
  const nose = new THREE.SphereGeometry(1, 20, 16).scale(0.0045, 0.008, 0.0055);
  nose.translate(0, 1.479, nightRiderFaceZ(0, 1.479) + 0.001);
  bindFace(nose, softSkin, 'anime subtle nose');
  const mouth = new THREE.Shape(); mouth.moveTo(-0.012, 0.001);
  mouth.quadraticCurveTo(0, -0.004, 0.012, 0.001); mouth.quadraticCurveTo(0, -0.006, -0.012, 0.001);
  surface(new THREE.ShapeGeometry(mouth, 16), 0, 1.443, 0.0015, lips, 'anime soft mouth');

  const hair = new THREE.MeshBasicNodeMaterial(); hair.name = 'anime midnight hair';
  hair.colorNode = vec3(0.009, 0.015, 0.035).mul(light.mul(0.5).add(0.5))
    .add(vec3(0.055, 0.08, 0.14).mul(light.smoothstep(0.68, 0.8)).mul(0.5))
    .add(vec3(0.025, 0.1, 0.12).mul(rim).mul(0.25));
  // Shorter pointed fringe exposes the eyes. The long side/back hair still follows the authored rig.
  rider.traverse((object) => {
    const mesh = object as THREE.Mesh; if (!mesh.isMesh || !mesh.name.startsWith('hair_')) return;
    if (!mesh.name.startsWith('hair_streak')) mesh.material = hair;
    if (!mesh.name.startsWith('hair_lock_')) return;
    const geometry = mesh.geometry, p = geometry.getAttribute('position'); geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!, cx = (bounds.min.x + bounds.max.x) / 2;
    const bottom = Math.abs(cx) > 0.05 ? 1.542 : Math.abs(cx) > 0.02 ? 1.528 : 1.503;
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) - bounds.min.y) / (bounds.max.y - bounds.min.y);
      p.setXYZ(i, cx + (p.getX(i) - cx) * (0.6 + t * 0.4), bottom + t * (bounds.max.y - bottom), p.getZ(i));
    }
    p.needsUpdate = true; geometry.computeVertexNormals();
  });

  const shellMaterial = new THREE.MeshBasicNodeMaterial(); shellMaterial.name = 'rounded lacquer helmet';
  const helmetLight = normalWorld.dot(vec3(-0.4, 0.8, 0.5).normalize()).max(0);
  const ribbon = abs(normalView.y.add(normalView.x.mul(0.35)).sub(0.35)).smoothstep(0.16, 0.05);
  shellMaterial.colorNode = vec3(0.012, 0.018, 0.035).mul(helmetLight.mul(0.8).add(0.6))
    .add(vec3(0.16, 0.24, 0.32).mul(ribbon).mul(0.45))
    .add(vec3(0.02, 0.14, 0.17).mul(abs(normalView.z).oneMinus().pow(4)));
  const visorMaterial = new THREE.MeshBasicNodeMaterial(); visorMaterial.name = 'glossy smoked iridium visor';
  visorMaterial.colorNode = mix(vec3(0.025, 0.014, 0.065), vec3(0.08, 0.19, 0.22), normalView.y.mul(0.5).add(0.5))
    .add(vec3(0.35, 0.65, 0.75).mul(ribbon).mul(0.55))
    .add(vec3(0.28, 0.06, 0.35).mul(abs(normalView.z).oneMinus().pow(3)));
  for (const prefix of ['', 'held_']) {
    const center = new THREE.Vector3(prefix ? 0.384913 : 0, prefix ? 0.881283 : 1.535872, prefix ? 0.049881 : 0.050057);
    for (const part of ['shell', 'visor', 'rim']) {
      const mesh = rider.getObjectByName(`${prefix}helmet_${part}`) as THREE.Mesh;
      const geometry = mesh.geometry, p = geometry.getAttribute('position');
      const q = new THREE.Vector3(), rounded = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        q.fromBufferAttribute(p, i).sub(center).divide(new THREE.Vector3(0.13, 0.144, 0.147));
        rounded.copy(q).normalize(); q.lerp(rounded, 0.55).multiply(new THREE.Vector3(0.13 * 0.94, 0.144 * 0.96, 0.147 * 0.94)).add(center);
        p.setXYZ(i, q.x, q.y, q.z);
      }
      geometry.deleteAttribute('normal');
      mesh.geometry = mergeVertices(geometry, 0.00001); mesh.geometry.computeVertexNormals(); geometry.dispose();
      if (part !== 'rim') mesh.material = part === 'shell' ? shellMaterial : visorMaterial;
    }
  }
  rider.userData.animeFace = true;
}
