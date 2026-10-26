import type { Camera, Scene, TextureNode, Node, WebGPURenderer } from 'three/webgpu';
import type { AudioFrame } from '../audio/AudioEngine';
import type { BackendName } from '../rendering/backendSelection';
import type { QualityBudget } from '../rendering/quality';

export interface VisualResponse {
  bass: number;
  loudness: number;
  impact: number;
  bounce: number;
}
export type SpectrumMapping = 'linear' | 'log';
export interface ModeFrame {
  time: number;
  delta: number;
  aspect: number;
  audio: Readonly<AudioFrame>;
  response: Readonly<VisualResponse>;
  hue: number;
  reducedMotion: boolean;
  reducedFlash: boolean;
  /** How modes that read the spectrum as a frequency axis pick bins. */
  spectrumMapping: SpectrumMapping;
  sampleRate: number;
  /** The bounce-sensitivity slider (0.25–4, default 1.8), for modes whose motion should scale with it directly. */
  sensitivity?: number;
}
export interface VisualMode {
  scene: Scene;
  camera: Camera;
  update(frame: ModeFrame): void;
  dispose(): void;
  /** Resolves once assets the mode loads asynchronously (models, textures) are in its scene; it never rejects. */
  ready?: Promise<void>;
  /** Off-screen passes (simulation steps, feedback buffers) run after update and before the scene renders. */
  simulate?(renderer: WebGPURenderer): void;
  // Samples the scene's real intermediate pass before linear bloom/output.
  filter?: (input: TextureNode) => Node;
}
export interface ModeDefinition {
  id: string;
  label: string;
  output: 'scene' | 'fullscreen' | 'dom';
  backends: readonly BackendName[];
  /** Bloom strength the slider moves to when this mode is selected; absent keeps the current value. */
  bloom?: number;
  create(budget: QualityBudget): VisualMode;
}
