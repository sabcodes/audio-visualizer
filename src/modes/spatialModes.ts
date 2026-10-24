import * as THREE from 'three/webgpu';
import type { VisualMode, ModeFrame } from './types';
import { sceneDefaults, resizeCamera, colorize, disposeScene, wrap } from './shared';
import { seededRandom } from '../rendering/diagnostics';

const CITY_GRID = 28;
const TUNNEL_DEPTH = 900;
const BLOOM_RINGS = 26;
const GODRAY_CONES = 14;

export function createSpatialMode(id: 'city' | 'bloomTunnel' | 'godrays'): VisualMode {
  const { scene, camera } = sceneDefaults(85);

  if (id === 'city') {
    const geom = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
    });
    const cityCount = CITY_GRID * CITY_GRID;
    const cityMesh = new THREE.InstancedMesh(geom, material, cityCount);
    cityMesh.name = 'vis-city';
    cityMesh.frustumCulled = false; // CPU instance heights change after static bounds are computed.

    const spacing = 2.4;
    const dummyObject3D = new THREE.Object3D();
    for (let x = 0; x < CITY_GRID; x++) {
      for (let z = 0; z < CITY_GRID; z++) {
        dummyObject3D.position.set(
          (x - CITY_GRID / 2) * spacing,
          0,
          (z - CITY_GRID / 2) * spacing
        );
        dummyObject3D.scale.set(1, 1, 1);
        dummyObject3D.updateMatrix();
        cityMesh.setMatrixAt(x * CITY_GRID + z, dummyObject3D.matrix);
      }
    }
    cityMesh.instanceMatrix!.needsUpdate = true;
    scene.add(cityMesh);

    let cityOrbit = 0;

    return {
      scene,
      camera,
      update: (frame: ModeFrame) => {
        if (!(camera instanceof THREE.PerspectiveCamera)) return;
        const orbitSpeed = 0.15 + frame.audio.bass * 0.35;
        cityOrbit += orbitSpeed * frame.delta;
        const orbitR = 75;
        camera.position.set(
          Math.cos(cityOrbit) * orbitR,
          24 + frame.audio.bass * 16,
          Math.sin(cityOrbit) * orbitR
        );
        camera.lookAt(0, 0, 0);

        let i = 0;
        for (let x = 0; x < CITY_GRID; x++) {
          for (let z = 0; z < CITY_GRID; z++) {
            const nx = x / CITY_GRID;
            const nz = z / CITY_GRID;
            const bin = Math.min(
              frame.audio.spectrum.length - 1,
              Math.floor((nx * 0.6 + nz * 0.4) * frame.audio.spectrum.length)
            );
            const e = (frame.audio.spectrum[bin] || 0) / 255;
            const h = 0.5 + e * 18 + frame.response.bounce * 18;
            dummyObject3D.position.set(
              (x - CITY_GRID / 2) * spacing,
              h / 2,
              (z - CITY_GRID / 2) * spacing
            );
            dummyObject3D.scale.set(1.05, h, 1.05);
            dummyObject3D.updateMatrix();
            cityMesh.setMatrixAt(i++, dummyObject3D.matrix);
          }
        }
        cityMesh.instanceMatrix!.needsUpdate = true;
        material.opacity = frame.reducedFlash ? 0.9 : 0.78 + 0.22 * frame.response.impact;
        colorize(material, frame);
        resizeCamera(camera, frame.aspect);
      },
      dispose: () => disposeScene(scene),
    };
  }

  if (id === 'bloomTunnel') {
    const bloomGroup = new THREE.Group();
    bloomGroup.name = 'vis-bloom-tunnel';

    for (let i = 0; i < BLOOM_RINGS; i++) {
      const R = 18 + i * 0.8;
      const torus = new THREE.Mesh(
        new THREE.TorusGeometry(R, 0.45, 8, 96),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.85,
        })
      );
      torus.position.z = -i * (TUNNEL_DEPTH / BLOOM_RINGS);
      bloomGroup.add(torus);
    }
    scene.add(bloomGroup);

    return {
      scene,
      camera,
      update: (frame: ModeFrame) => {
        resizeCamera(camera, frame.aspect);
        bloomGroup.children.forEach((torus, i) => {
          const torusMesh = torus as THREE.Mesh;
          const scale =
            1.0 +
            (frame.audio.spectrum[(i * 7) % frame.audio.spectrum.length] || 0) / 255 * 0.25 +
            frame.response.bounce * 0.65;
          torusMesh.scale.setScalar(scale);
          torusMesh.rotation.z += (0.6 + frame.audio.mid * 3) * frame.delta;
          torusMesh.position.z += (260 + frame.response.bass * 520) / BLOOM_RINGS * frame.delta;
          if (torusMesh.position.z > 40) {
            torusMesh.position.z = -TUNNEL_DEPTH;
          }
          const L =
            0.6 + 0.4 * Math.sin(i * 0.3 + frame.time * 0.004 + frame.audio.highs * 2.0);
          const mat = torusMesh.material as THREE.MeshBasicMaterial;
          mat.color.setHSL(wrap(frame.hue + i * 0.01, 0, 1), 1, L);
          mat.opacity = frame.reducedFlash ? 0.8 : 0.7 + 0.3 * frame.response.impact;
        });
      },
      dispose: () => disposeScene(scene),
    };
  }

  if (id === 'godrays') {
    const godGroup = new THREE.Group();
    godGroup.name = 'vis-godrays';

    for (let i = 0; i < GODRAY_CONES; i++) {
      const coneGeom = new THREE.ConeGeometry(12, 120, 32, 1, true);
      const coneMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(coneGeom, coneMat);
      mesh.position.set(0, -10, 0);
      mesh.rotation.y = (i / GODRAY_CONES) * Math.PI * 2;
      godGroup.add(mesh);
    }
    scene.add(godGroup);

    return {
      scene,
      camera,
      update: (frame: ModeFrame) => {
        resizeCamera(camera, frame.aspect);
        godGroup.rotation.y += (0.12 + 0.6 * frame.audio.mid) * frame.delta;
        godGroup.children.forEach((cone, i) => {
          const coneMesh = cone as THREE.Mesh;
          const swell = 1.0 + frame.response.bounce * 0.85 + 0.15 * Math.sin(frame.time * 3 + i);
          coneMesh.scale.set(1, swell, 1);
          const mat = coneMesh.material as THREE.MeshBasicMaterial;
          mat.opacity =
            frame.reducedFlash ? 0.18 : 0.12 + 0.18 * (frame.audio.bass + frame.audio.highs * 0.5 + frame.response.impact * 0.8);
          mat.color.setHSL(wrap(frame.hue + i * 0.02, 0, 1), 1, 0.55);
        });
      },
      dispose: () => disposeScene(scene),
    };
  }

  return {
    scene,
    camera,
    update: () => {},
    dispose: () => disposeScene(scene),
  };
}
