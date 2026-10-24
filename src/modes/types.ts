import type { Camera, Scene, TextureNode, Node } from 'three/webgpu';
import type { AudioFrame } from '../audio/AudioEngine';
import type { BackendName } from '../rendering/backendSelection';
import type { QualityBudget } from '../rendering/quality';

export interface VisualResponse {
  bass: number;
  loudness: number;
  impact: number;
  bounce: number;
}
export interface ModeFrame {
  time: number;
  delta: number;
  aspect: number;
  audio: Readonly<AudioFrame>;
  response: Readonly<VisualResponse>;
  hue: number;
  reducedMotion: boolean;
  reducedFlash: boolean;
}
export interface VisualMode {
  scene: Scene;
  camera: Camera;
  update(frame: ModeFrame): void;
  dispose(): void;
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
