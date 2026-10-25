import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { VisualMode } from './types';
import { sceneDefaults, resizeCamera, disposeScene } from './shared';
import { instantiate, shaftMaterial, whenLoaded } from './figures';
import { createCinematic } from './cinematic';
import { createHits, linearRgb } from './hitPulse';
import kitAUrl from '../assets/wave4/kitA.glb?url';

/** Piece lookup for a modular kit: per-mode copies of the materials, so emissive tints never leak between modes. */
export function kitPieces(gltf: GLTF) {
  const kit = instantiate(gltf);
  return {
    materials: kit.materials,
    piece(name: string) { return kit.node(name).clone(); },
    /** Every mesh of a piece as instanced copies, `count` of each, for pieces repeated many times. */
    instanced(name: string, count: number) {
      const meshes: THREE.Mesh[] = [];
      kit.node(name).traverse((object) => { if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh); });
      return meshes.map((mesh) => { const copy = new THREE.InstancedMesh(mesh.geometry, mesh.material, count); copy.frustumCulled = false; return copy; });
    },
  };
}
export type KitPieces = ReturnType<typeof kitPieces>;

/** Lets a mode turn on the renderer's shadow maps while it is active and restore the setting afterwards. */
export function shadowSwitch() {
  let renderer: THREE.WebGPURenderer | undefined, previous = false;
  return {
    simulate(next: THREE.WebGPURenderer) {
      if (renderer) return;
      renderer = next; previous = next.shadowMap.enabled;
      next.shadowMap.enabled = true;
    },
    dispose() { if (renderer) renderer.shadowMap.enabled = previous; renderer = undefined; },
  };
}

const place = (object: THREE.Object3D, x: number, y: number, z: number, turn = 0) => { object.position.set(x, y, z); object.rotation.y = turn; return object; };

// ---------------------------------------------------------------- Warehouse Hall

/** Warehouse colour cycle, one step per hit: amber, red, cold white. */
export const WAREHOUSE_GRADES = [0xff8a30, 0xe0140c, 0xc8d0d8] as const;
const BAY = 4, BAYS = 16;

export function createWarehouseHallMode(): VisualMode {
  const { scene, camera } = sceneDefaults(0);
  (camera as THREE.PerspectiveCamera).fov = 52;
  const time = uniform(0), finish = createCinematic({ grain: 0.07, halation: 0.35, vignette: 0.65, soften: 0.15, shadows: [0.006, 0.004, 0.003] });
  scene.background = new THREE.Color(0x020101);
  scene.fog = new THREE.FogExp2(0x050302, 0.028);
  const corridor = new THREE.Group(); scene.add(corridor);
  // The far room: a warm-lit box at the end of the corridor that never quite goes out.
  const farGlow = new THREE.Mesh(new THREE.PlaneGeometry(8, 4.4), new THREE.MeshBasicNodeMaterial({ color: 0xff8a30 }));
  farGlow.position.set(0, 2.2, -BAY * BAYS + 1);
  const farLight = new THREE.PointLight(0xff8a30, 60, 30, 1.6); farLight.position.set(0, 2.5, -BAY * BAYS + 4);
  const fill = new THREE.HemisphereLight(0x302820, 0x050302, 0.08);
  // A cold work lamp on the right wall, casting the pillars' shadows across the floor.
  const lamp = new THREE.SpotLight(0xd8e0ff, 120, 30, 0.75, 0.6, 1.4);
  lamp.position.set(3.9, 3.4, -9); lamp.target.position.set(-1, 0, -12); lamp.castShadow = true;
  lamp.shadow.mapSize.set(1024, 1024); lamp.shadow.bias = -0.0005;
  // Red wall panels on the left, lit by one moving red light near the camera.
  const panelLight = new THREE.PointLight(0xe0140c, 0, 14, 1.5); panelLight.position.set(-3.2, 1.8, -4);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 3.4, 11, 24, 1, true).translate(0, -5.5, 0), shaftMaterial(time));
  beam.position.copy(lamp.position); beam.lookAt(lamp.target.position); beam.rotateX(-Math.PI / 2);
  scene.add(farGlow, farLight, fill, lamp, lamp.target, panelLight, beam);
  const panels: THREE.MeshStandardMaterial[] = [], tubes: THREE.MeshStandardMaterial[] = [];
  const model = whenLoaded([kitAUrl], ([gltf]) => {
    const kit = kitPieces(gltf);
    for (let b = 0; b < BAYS; b++) {
      const z = -b * BAY;
      for (const x of [-2, 2]) corridor.add(place(kit.piece('floor_slab'), x, -0.2, z - 2, Math.PI / 2));
      for (const x of [-2, 2]) corridor.add(place(kit.piece('ceiling_slab'), x, 4.44, z - 2));
      for (const x of [-4.3, 4.3]) corridor.add(place(kit.piece('pillar_square'), x, 0, z));
      corridor.add(place(kit.piece('girder_straight'), -2, 4, z), place(kit.piece('girder_straight'), 2, 4, z));
      for (const side of [-1, 1]) corridor.add(place(kit.piece(b % 3 === 1 ? 'wall_pipes' : 'wall_plain'), side * 4.9, 0, z - 2, -side * Math.PI / 2));
      if (b % 2 === 0) corridor.add(place(kit.piece('panel_red'), -4.72, 1.2, z - 2, Math.PI / 2));
      if (b % 2 === 1) corridor.add(place(kit.piece('light_tube'), 4.72, 3.2, z - 2, -Math.PI / 2));
      corridor.add(place(kit.piece('rail_track'), 0, -0.05, z - 2, Math.PI / 2));
    }
    corridor.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = mesh.receiveShadow = true;
    });
    const panel = kit.materials.get('emissive_panel'), tube = kit.materials.get('emissive_tube');
    if (panel) { panel.emissive.setRGB(...linearRgb(0xe0140c)); panels.push(panel); }
    if (tube) { tube.emissive.setRGB(...linearRgb(0xc8d0d8)); tubes.push(tube); }
  });

  const shadows = shadowSwitch();
  const hits = createHits({ decay: 0.22, interval: 0.4, variants: WAREHOUSE_GRADES.length, seed: 14 });
  const grade = new THREE.Color();
  let travel = 0;
  return {
    scene, camera,
    ready: model.ready,
    simulate: shadows.simulate,
    update(frame) {
      resizeCamera(camera, frame.aspect);
      time.value = frame.time; finish.update(frame);
      hits.update(frame, 0.03);
      grade.setRGB(...linearRgb(WAREHOUSE_GRADES[hits.variant]));
      const gain = hits.gain, bass = frame.response.bass;
      // Light follows the bass and steps colour on each hit; between hits the hall drops to near-black.
      farLight.color.copy(grade); farLight.intensity = 60 + gain * 200 + bass * 60;
      (farGlow.material as THREE.MeshBasicNodeMaterial).color.copy(grade).multiplyScalar(0.6 + gain * 2.5);
      lamp.color.copy(grade).lerp(new THREE.Color(0xd8e0ff), 0.6); lamp.intensity = gain * 260 + bass * 60;
      (beam.material as THREE.MeshBasicNodeMaterial).color.copy(lamp.color).multiplyScalar(gain * 0.12);
      panelLight.intensity = hits.flash * 40;
      for (const panel of panels) panel.emissiveIntensity = 0.15 + hits.flash * 6;
      for (const tube of tubes) tube.emissiveIntensity = gain * 3;
      (scene.fog as THREE.FogExp2).color.copy(grade).multiplyScalar(0.012 + gain * 0.03);
      // A slow push down the hall, faster when the music is loud; the bays repeat, so it never ends.
      if (!frame.reducedMotion) travel = (travel + frame.delta * (0.15 + frame.response.loudness * 0.6)) % (BAY * 2);
      corridor.position.z = travel;
      camera.position.set(0, 1.7, 3);
      camera.lookAt(0, 1.6, -40);
    },
    filter: (input) => finish.filter(input),
    dispose() { model.dispose(); shadows.dispose(); disposeScene(scene); },
  };
}
