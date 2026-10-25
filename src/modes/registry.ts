import type { BackendName } from '../rendering/backendSelection';
import { presetBudget, type QualityBudget } from '../rendering/quality';
import type { ModeDefinition, VisualMode } from './types';
import { createSpikeScene } from './spikeScenes';
import { createLineMode } from './lineModes';
import { createParticleMode } from './particleModes';
import { createSpatialMode } from './spatialModes';
import { createErrorMode } from './errorMode';
import { createFullscreenMode } from './fullscreenModes';
import { createGlitchMode, createKaleidoscopeMode } from './filterModes';
import { createChladniMode, createEpicycleMode, createPendulumMode, createPolyhedraMode, createTorusKnotMode } from './geometricModes';
import { createEventHorizonMode, createInkMarbleMode, createVoronoiMode } from './shaderModes';
import { createAuroraMode, createGalaxyMode, createRidgelineMode, createSynthwaveMode } from './landscapeModes';
import { createRobotMode } from './robotMode';
import { createNeonCityMode } from './neonCityMode';
import { createKrakenMode } from './creatureModes';
import { createFerrofluidMode, createMetaballMode } from './physicsModes';
import { createAbyssMode, createOceanMode } from './seaModes';
import { createDiscoMode, createFireworksMode } from './nightModes';
import { createArenaMode } from './arenaMode';
import { createCurlFlowMode, createFeedbackMode, createReactionDiffusionMode } from './feedbackModes';
import { createAttractorMode, createPhysarumMode, createSnowflakeMode } from './generativeModes';
import { createAsciiMode, createLedAnalyzerMode, createTurntableMode } from './retroModes';
import { createStormMode } from './stormMode';
export type { ModeFrame, ModeDefinition, VisualMode } from './types';

const definition = (id: string, label: string, create: (budget: QualityBudget) => VisualMode, output: ModeDefinition['output'] = 'scene'): ModeDefinition => ({ id, label, create, output, backends: ['webgpu', 'webgl2'] });
export const legacyModeDefinitions: readonly ModeDefinition[] = [
  definition('circle', 'Circle Waveform', () => createLineMode('circle')),
  definition('spiral', 'Spiral', () => createLineMode('spiral')),
  definition('star', 'Star Burst 3D', () => createLineMode('star')),
  definition('cube', 'Cubic Field', () => createLineMode('cube')),
  definition('particles', 'Neon Swirl Particles', (budget) => createParticleMode('particles', budget)),
  definition('errors', 'Vintage Errors (Win95)', createErrorMode, 'dom'),
  definition('lissajous', 'Laser Lissajous', () => createLineMode('lissajous')),
  definition('boids', 'Boids + Beat Bursts', (budget) => createParticleMode('boids', budget)),
  definition('fftTunnel', 'FFT Tunnel (Lines)', () => createLineMode('fftTunnel')),
  definition('kaleidoPlane', 'Kaleidoscope Plane', createKaleidoscopeMode),
  definition('city', 'Instanced Cityscape', () => createSpatialMode('city')),
  definition('glitchRing', 'Glitch Ring', () => createLineMode('glitchRing')),
  definition('vjRings', 'VJ Smooth Rings (FS)', () => createFullscreenMode('vjRings'), 'fullscreen'),
  definition('neonKaleido', 'Neon Kaleido Blink (FS)', () => createFullscreenMode('neonKaleido'), 'fullscreen'),
  definition('starTunnel', 'Stars Tunnel', (budget) => createParticleMode('starTunnel', budget)),
  definition('bloomTunnel', 'Bloom Tunnel (Neon)', () => createSpatialMode('bloomTunnel')),
  definition('glitchFX', 'Glitch FX (RGB Split)', createGlitchMode),
  definition('godrays', 'God Rays (Stylized Cones)', () => createSpatialMode('godrays')),
];
// First wave of the 32 candidates in docs/research/2026-10-24-new-visualization-modes.md.
export const waveOneModeDefinitions: readonly ModeDefinition[] = [
  definition('epicycles', 'Fourier Epicycles', createEpicycleMode),
  definition('polyhedra', 'Polyhedra Morph', createPolyhedraMode),
  definition('pendulumWave', 'Pendulum Wave', createPendulumMode),
  definition('voronoi', 'Voronoi Crystal Mosaic (FS)', createVoronoiMode, 'fullscreen'),
  definition('inkMarble', 'Ink Marble / Oil Slick (FS)', createInkMarbleMode, 'fullscreen'),
  definition('aurora', 'Aurora Curtains', createAuroraMode),
  definition('ridgeline', 'Pulsar Ridgeline', createRidgelineMode),
  definition('synthwave', 'Synthwave Sunset Grid', createSynthwaveMode),
  definition('galaxy', 'FFT Galaxy', (budget) => createGalaxyMode(budget)),
  definition('robot', 'Robot Dancer', createRobotMode),
  definition('neonCity', 'Neon Megacity', (budget) => createNeonCityMode(budget)),
];
export const waveTwoModeDefinitions: readonly ModeDefinition[] = [
  definition('kraken', 'Kraken', createKrakenMode),
  definition('torusKnot', 'Torus Knot Morph', createTorusKnotMode),
  definition('chladni', 'Chladni Plate', (budget) => createChladniMode(budget)),
  definition('metaballs', 'Liquid Metaballs', (budget) => createMetaballMode(budget)),
  definition('ocean', 'Audio Ocean', createOceanMode),
  definition('eventHorizon', 'Event Horizon (FS)', createEventHorizonMode, 'fullscreen'),
  definition('fireworks', 'Beat Fireworks Night', (budget) => createFireworksMode(budget)),
  definition('abyss', 'Abyss (Jellyfish)', (budget) => createAbyssMode(budget)),
  definition('disco', 'Mirror-Ball Disco', createDiscoMode),
  definition('ferrofluid', 'Ferrofluid Spike Pool', createFerrofluidMode),
  definition('arena', 'Arena Light Panels', (budget) => createArenaMode(budget)),
];
export const waveThreeModeDefinitions: readonly ModeDefinition[] = [
  definition('reactionDiffusion', 'Reaction-Diffusion Organism (FS)', (budget) => createReactionDiffusionMode(budget), 'fullscreen'),
  definition('feedback', 'Feedback Warp (FS)', (budget) => createFeedbackMode(budget), 'fullscreen'),
  definition('curlFlow', 'Curl-Noise Flow (FS)', (budget) => createCurlFlowMode(budget), 'fullscreen'),
  definition('attractor', 'Strange Attractor Garden', (budget) => createAttractorMode(budget)),
  definition('physarum', 'Physarum Slime Veins (FS)', (budget) => createPhysarumMode(budget), 'fullscreen'),
  definition('snowflake', 'Snowflake Crystal Bloom (FS)', (budget) => createSnowflakeMode(budget), 'fullscreen'),
  definition('turntable', 'Turntable Deck', createTurntableMode),
  definition('ascii', 'ASCII / Halftone Terminal (FS)', createAsciiMode, 'fullscreen'),
  definition('ledAnalyzer', 'LED Bar Analyzer', createLedAnalyzerMode),
  definition('storm', 'Thunderstorm Sky', (budget) => createStormMode(budget)),
];
// Preserve deep links to the capability probes without confusing them with legacy parity.
const probes = (['scene', 'rings'] as const).map((id) => definition(id, id === 'scene' ? 'Probe · basic neon scene' : 'Probe · fullscreen rings', () => {
  const probe = createSpikeScene(id);
  return { ...probe, update: (frame) => probe.update(frame.time, frame.response.bounce, frame.aspect) };
}, id === 'rings' ? 'fullscreen' : 'scene'));
export const modeDefinitions: readonly ModeDefinition[] = [...legacyModeDefinitions, ...waveOneModeDefinitions, ...waveTwoModeDefinitions, ...waveThreeModeDefinitions, ...probes];

export class ModeRegistry {
  private readonly definitions = new Map<string, ModeDefinition>();
  private active?: VisualMode;
  constructor(definitions: readonly ModeDefinition[] = modeDefinitions) {
    for (const definition of definitions) {
      if (this.definitions.has(definition.id)) throw new Error(`Duplicate visual mode: ${definition.id}`);
      this.definitions.set(definition.id, definition);
    }
  }
  /** Builds an unowned instance without touching the active mode; the caller disposes it. */
  create(id: string, backend: BackendName, budget: QualityBudget = presetBudget('balanced')): VisualMode {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error(`Unknown visual mode: ${id}`);
    if (!definition.backends.includes(backend)) throw new Error(`${definition.label} is unavailable on ${backend}`);
    return definition.create(budget);
  }
  select(id: string, backend: BackendName, budget: QualityBudget = presetBudget('balanced')): VisualMode {
    const next = this.create(id, backend, budget);
    this.clear();
    this.active = next;
    return this.active;
  }
  clear() { const previous = this.active; this.active = undefined; previous?.dispose(); }
}
