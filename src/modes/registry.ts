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
import { createInkMarbleMode, createVoronoiMode } from './shaderModes';
import { createOuterSpaceMode } from './spaceMode';
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
import { createGiantMode } from './giantMode';
import { createDragonMode, createHighPolyDragonMode, createPhoenixMode } from './flightModes';
import { createCrowdMode } from './crowdMode';
import { createBandMode } from './bandMode';
import { createFirePhoenixMode } from './firePhoenixMode';
import { createJellyMode } from './jellyMode';
import { createBlockBowtieMode, createPrismBowtieMode } from './bilateralModes';
import { createAnamorphicFlareMode, createEmberSmokeMode, createGrainSmokeMode, createHairVortexMode, createMirrorPlasmaMode } from './plasmaModes';
import { createBlackMazeMode } from './natureModes';
import { createStarfallCanopyMode } from './canopyMode';
import { createWindfieldMode } from './windfieldMode';
import { createBeaconRingsMode, createChromeStreaksMode, createSilkThreadsMode } from './nightSceneModes';
import { createSignalNightMode } from './signalNightMode';
import { createLightLeakFilmMode } from './filmMode';
import { withCinematic, type CinematicOptions } from './cinematic';
import { createWarehouseHallMode } from './kitModes';
import { createEndlessStairsMode, createRedStairwellMode, createTempleDescentMode, createUndergroundMode } from './interiorModes';
import { createCandyOrbMode, createLiquidChromeMode, createPongOrbsMode } from './lensModes';
import { createMoonPondMode } from './moonPondMode';
import { createRedCrystalHallMode } from './crystalHallMode';
import { createPoleSparksMode } from './illustratedModes';
import { createBloomTouchMode } from './bloomTouchMode';
import { createLavaGolemMode, createLightForestMode } from './creatureKitModes';
import { createCrtSpillMode, createTvWallMode } from './crtModes';
import { createInkDiscsMode } from './inkDiscsMode';
import { createCrackedGlobeMode, createDotVortexMode } from './orbModes';
import { createSkyShardsMode } from './skyShardsMode';
import { createSparkPlumeMode } from './sparkPlumeMode';
import { createClawHandsMode } from './clawHandsMode';
import { createRelicGlowMode } from './relicGlowMode';
import { createLanternTreeMode } from './lanternTreeMode';
import { createMetroCarMode } from './metroCarMode';
import { createDreamAlleyMode, createNeonPortalMode, createSlitDancerMode } from './figureShaderModes';
import { createWindowGridMode } from './windowGridMode';
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
  definition('eventHorizon', 'Outer Space', (budget) => createOuterSpaceMode(budget)),
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
/** Figure modes built from the supplied glTF models (Model assets/wave3_assets, spec in docs/3d-asset-spec.md), labelled experimental in the menu. */
export const figureModeDefinitions: readonly ModeDefinition[] = [
  definition('swampGiant', '<EXPERIMENTAL> Swamp Giant', createGiantMode),
  definition('dragon', '<EXPERIMENTAL> Low-Poly Dragon', createDragonMode),
  definition('highPolyDragon', '<experimental wave 4.5> High Polygon Dragon', createHighPolyDragonMode),
  definition('phoenix', '<experimental wave 4.5> Eastern Phoenix', () => createPhoenixMode('eastern')),
  definition('lowPolyWesternPhoenix', '<experimental wave 4.5> Low Poly Western Phoenix', () => createPhoenixMode('western')),
  definition('westernPhoenix', '<experimental wave 4.5> Western Phoenix', (budget) => createFirePhoenixMode(budget)),
  definition('crowdMascot', '<EXPERIMENTAL> Crowd + Mascot', (budget) => createCrowdMode(budget)),
  definition('skeletonBand', '<experimental wave 4.5> Skeleton Band', createBandMode),
  definition('jellyBlob', '<EXPERIMENTAL> Jelly Blob', createJellyMode),
];
/** Wave 4 entries are labelled `<experimental-wave4> …` in the menu, at the user's request. */
const waveFour = (id: string, label: string, create: (budget: QualityBudget) => VisualMode, output: ModeDefinition['output'] = 'scene', finish?: CinematicOptions) =>
  definition(id, `<experimental-wave4> ${label}`, finish ? (budget) => withCinematic(create(budget), finish) : create, output);
/** Camera finishes for the procedural modes whose references are footage or photographic renders. */
const FILM = { grain: 0.05, halation: 0.3, vignette: 0.45, soften: 0.15 }, CLEAN = { grain: 0.03, halation: 0.2, vignette: 0.35, soften: 0.05 };
/** Wave 4 (docs/superpowers/specs/2026-10-24-wave-four-modes-design.md): beat-gated modes from reference clips; 4b ones use the supplied kits. */
export const waveFourModeDefinitions: readonly ModeDefinition[] = [
  waveFour('prismBowtie', 'Prism Bowtie (FS)', createPrismBowtieMode, 'fullscreen', CLEAN),
  waveFour('blockBowtie', 'Block Bowtie (FS)', createBlockBowtieMode, 'fullscreen', CLEAN),
  waveFour('pongOrbs', 'Pong Orbs (FS)', createPongOrbsMode, 'fullscreen', CLEAN),
  waveFour('candyOrb', 'Candy Orb (FS)', createCandyOrbMode, 'fullscreen', FILM),
  waveFour('moonPond', 'Moon Pond (FS)', (budget) => createMoonPondMode(budget), 'fullscreen'),
  waveFour('liquidChrome', 'Liquid Chrome (FS)', createLiquidChromeMode, 'fullscreen', CLEAN),
  waveFour('mirrorPlasma', 'Mirror Plasma (FS)', createMirrorPlasmaMode, 'fullscreen'),
  waveFour('grainSmoke', 'Grain Smoke (FS)', createGrainSmokeMode, 'fullscreen'),
  waveFour('anamorphicFlare', 'Anamorphic Flare (FS)', createAnamorphicFlareMode, 'fullscreen', CLEAN),
  waveFour('hairVortex', 'Hair Vortex (FS)', createHairVortexMode, 'fullscreen', CLEAN),
  waveFour('windfield', 'Windfield', (budget) => createWindfieldMode(budget), 'scene', FILM),
  waveFour('blackMaze', 'Black Maze (FS)', createBlackMazeMode, 'fullscreen', FILM),
  waveFour('starfallCanopy', 'Starfall Canopy', (budget) => createStarfallCanopyMode(budget), 'scene', FILM),
  waveFour('silkThreads', 'Silk Threads', (budget) => createSilkThreadsMode(budget), 'scene', CLEAN),
  waveFour('chromeStreaks', 'Chrome Streaks', (budget) => createChromeStreaksMode(budget), 'scene', FILM),
  waveFour('signalNight', 'Signal Night', createSignalNightMode),
  waveFour('beaconRings', 'Beacon Rings', (budget) => createBeaconRingsMode(budget), 'scene', FILM),
  waveFour('lightLeakFilm', 'Light Leak Film', createLightLeakFilmMode),
  waveFour('warehouseHall', 'Warehouse Hall', createWarehouseHallMode),
  waveFour('redStairwell', 'Red Stairwell', createRedStairwellMode),
  waveFour('underground', 'Underground', (budget) => createUndergroundMode(budget)),
  waveFour('endlessStairs', 'Endless Stairs', (budget) => createEndlessStairsMode(budget)),
  waveFour('templeDescent', 'Temple Descent', (budget) => createTempleDescentMode(budget)),
  waveFour('lavaGolem', 'Lava Golem', (budget) => createLavaGolemMode(budget)),
  waveFour('lightForest', 'Light Painting Forest', (budget) => createLightForestMode(budget)),
  waveFour('redCrystalHall', 'Red Crystal Hall', (budget) => createRedCrystalHallMode(budget)),
  waveFour('poleSparks', 'Pole Sparks', createPoleSparksMode),
  waveFour('bloomTouch', 'Bloom Touch', (budget) => createBloomTouchMode(budget)),
  waveFour('emberSmoke', 'Ember Smoke (FS)', (budget) => createEmberSmokeMode(budget), 'fullscreen', CLEAN),
];
/** Wave 5 entries are labelled `<experimental-wave5> …` in the menu, at the user's request. */
const waveFive = (id: string, label: string, create: (budget: QualityBudget) => VisualMode, output: ModeDefinition['output'] = 'scene', finish?: CinematicOptions) =>
  definition(id, `<experimental-wave5> ${label}`, finish ? (budget) => withCinematic(create(budget), finish) : create, output);
/** Paper stays cream: no halation tinting its bright areas orange. */
/** A wave 5 mode that needs compute passes, so it is offered on native WebGPU only. */
const waveFiveGpu = (...args: Parameters<typeof waveFive>): ModeDefinition => ({ ...waveFive(...args), backends: ['webgpu'] });
const PAPER = { grain: 0.025, halation: 0, vignette: 0.15, soften: 0.03 };
/**
 * Wave 5 (docs/superpowers/specs/2026-10-25-wave-five-modes-design.md): the code-only modes. The figure, hand,
 * tree and model-dependent clips (3, 4, 5, 7, 9, 11, 12, 13) and the Warehouse Hall change (14) are not built yet.
 */
export const waveFiveModeDefinitions: readonly ModeDefinition[] = [
  waveFive('crtSpill', 'CRT Spill', (budget) => createCrtSpillMode(budget)),
  waveFive('tvWall', 'TV Wall', createTvWallMode),
  waveFive('inkDiscs', 'Ink Discs (FS)', createInkDiscsMode, 'fullscreen', PAPER),
  waveFive('crackedGlobe', 'Cracked Globe (FS)', createCrackedGlobeMode, 'fullscreen', CLEAN),
  waveFive('dotVortex', 'Dot Vortex (FS)', createDotVortexMode, 'fullscreen', CLEAN),
  waveFive('skyShards', 'Sky Shards (FS)', createSkyShardsMode, 'fullscreen', FILM),
  waveFive('neonPortal', 'Neon Portal (FS)', createNeonPortalMode, 'fullscreen', FILM),
  waveFiveGpu('sparkPlume', 'Spark Plume', (budget) => createSparkPlumeMode(budget), 'scene', FILM),
  waveFive('dreamAlley', 'Dream Alley (FS)', createDreamAlleyMode, 'fullscreen', FILM),
  waveFive('clawHands', 'Claw Hands (FS)', createClawHandsMode, 'fullscreen', FILM),
  waveFive('relicGlow', 'Relic Glow', createRelicGlowMode),
  waveFive('lanternTree', 'Lantern Tree', (budget) => createLanternTreeMode(budget)),
  waveFive('metroCar', 'Metro Car', createMetroCarMode),
  waveFive('slitDancer', 'Slit Dancer (FS)', createSlitDancerMode, 'fullscreen', CLEAN),
];
/** Wave 6 entries are labelled `<experimental-wave6> …` in the menu; `bloom` sets the slider for modes with their own glow rules. */
const waveSix = (id: string, label: string, create: (budget: QualityBudget) => VisualMode, output: ModeDefinition['output'] = 'scene', finish?: CinematicOptions, bloom?: number): ModeDefinition =>
  ({ ...definition(id, `<experimental-wave6> ${label}`, finish ? (budget) => withCinematic(create(budget), finish) : create, output), ...(bloom === undefined ? {} : { bloom }) });
/** Soft focus for the facade: the clip is a long-lens phone shot. */
const SOFT = { grain: 0.05, halation: 0, vignette: 0.4, soften: 0.28 };
/**
 * Wave 6 (docs/superpowers/specs/2026-10-26-wave-six-modes-design.md): code-only modes. Night Rider (#7) waits on
 * supplied assets and Blob Track (#13) is a separate task.
 */
export const waveSixModeDefinitions: readonly ModeDefinition[] = [
  waveSix('windowGrid', 'Window Grid', createWindowGridMode, 'fullscreen', SOFT),
];
// Preserve deep links to the capability probes without confusing them with legacy parity.
const probes = (['scene', 'rings'] as const).map((id) => definition(id, id === 'scene' ? 'Probe · basic neon scene' : 'Probe · fullscreen rings', () => {
  const probe = createSpikeScene(id);
  return { ...probe, update: (frame) => probe.update(frame.time, frame.response.bounce, frame.aspect) };
}, id === 'rings' ? 'fullscreen' : 'scene'));
export const modeDefinitions: readonly ModeDefinition[] = [...legacyModeDefinitions, ...waveOneModeDefinitions, ...waveTwoModeDefinitions, ...waveThreeModeDefinitions, ...figureModeDefinitions, ...waveFourModeDefinitions, ...waveFiveModeDefinitions, ...waveSixModeDefinitions, ...probes];

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
