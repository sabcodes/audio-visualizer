import type { BackendName } from '../rendering/backendSelection';
import type { ModeDefinition, VisualMode } from './types';
import { createSpikeScene } from './spikeScenes';
import { createLineMode } from './lineModes';
import { createParticleMode } from './particleModes';
import { createSpatialMode } from './spatialModes';
import { createErrorMode } from './errorMode';
import { createFullscreenMode } from './fullscreenModes';
import { createGlitchMode, createKaleidoscopeMode } from './filterModes';
export type { ModeFrame, ModeDefinition, VisualMode } from './types';

const definition = (id: string, label: string, create: () => VisualMode, output: ModeDefinition['output'] = 'scene'): ModeDefinition => ({ id, label, create, output, backends: ['webgpu', 'webgl2'] });
export const legacyModeDefinitions: readonly ModeDefinition[] = [
  definition('circle', 'Circle Waveform', () => createLineMode('circle')),
  definition('spiral', 'Spiral', () => createLineMode('spiral')),
  definition('star', 'Star Burst 3D', () => createLineMode('star')),
  definition('cube', 'Cubic Field', () => createLineMode('cube')),
  definition('particles', 'Neon Swirl Particles', () => createParticleMode('particles')),
  definition('errors', 'Vintage Errors (Win95)', createErrorMode, 'dom'),
  definition('lissajous', 'Laser Lissajous', () => createLineMode('lissajous')),
  definition('boids', 'Boids + Beat Bursts', () => createParticleMode('boids')),
  definition('fftTunnel', 'FFT Tunnel (Lines)', () => createLineMode('fftTunnel')),
  definition('kaleidoPlane', 'Kaleidoscope Plane', createKaleidoscopeMode),
  definition('city', 'Instanced Cityscape', () => createSpatialMode('city')),
  definition('glitchRing', 'Glitch Ring', () => createLineMode('glitchRing')),
  definition('vjRings', 'VJ Smooth Rings (FS)', () => createFullscreenMode('vjRings'), 'fullscreen'),
  definition('neonKaleido', 'Neon Kaleido Blink (FS)', () => createFullscreenMode('neonKaleido'), 'fullscreen'),
  definition('starTunnel', 'Stars Tunnel', () => createParticleMode('starTunnel')),
  definition('bloomTunnel', 'Bloom Tunnel (Neon)', () => createSpatialMode('bloomTunnel')),
  definition('glitchFX', 'Glitch FX (RGB Split)', createGlitchMode),
  definition('godrays', 'God Rays (Stylized Cones)', () => createSpatialMode('godrays')),
];
// Preserve deep links to the capability probes without confusing them with legacy parity.
const probes = (['scene', 'rings'] as const).map((id) => definition(id, id === 'scene' ? 'Probe · basic neon scene' : 'Probe · fullscreen rings', () => {
  const probe = createSpikeScene(id);
  return { ...probe, update: (frame) => probe.update(frame.time, frame.response.bounce, frame.aspect) };
}, id === 'rings' ? 'fullscreen' : 'scene'));
export const modeDefinitions: readonly ModeDefinition[] = [...legacyModeDefinitions, ...probes];

export class ModeRegistry {
  private readonly definitions = new Map<string, ModeDefinition>();
  private active?: VisualMode;
  constructor(definitions: readonly ModeDefinition[] = modeDefinitions) {
    for (const definition of definitions) {
      if (this.definitions.has(definition.id)) throw new Error(`Duplicate visual mode: ${definition.id}`);
      this.definitions.set(definition.id, definition);
    }
  }
  select(id: string, backend: BackendName): VisualMode {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error(`Unknown visual mode: ${id}`);
    if (!definition.backends.includes(backend)) throw new Error(`${definition.label} is unavailable on ${backend}`);
    this.clear();
    this.active = definition.create();
    return this.active;
  }
  clear() { const previous = this.active; this.active = undefined; previous?.dispose(); }
}
