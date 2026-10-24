import * as THREE from 'three/webgpu';
import { initializeBackend, type BackendPreference } from './backendSelection';
import { ModeRegistry, type ModeFrame, type VisualMode } from '../modes/registry';
import { createOutputPipeline } from './OutputPipeline';

export class VisualEngine {
  private active?: VisualMode;
  private readonly modes = new ModeRegistry();
  private output?: ReturnType<typeof createOutputPipeline>;
  private disposed = false;
  readonly dimensions = new THREE.Vector2();
  private readonly logicalSize = new THREE.Vector2();

  private constructor(
    readonly renderer: THREE.WebGPURenderer,
    readonly backend: 'webgpu' | 'webgl2',
    readonly startupFailures: string[],
  ) {}

  static async create(preference: BackendPreference, onLoss: (message: string) => void) {
    const result = await initializeBackend(
      preference,
      (forceWebGL) => new THREE.WebGPURenderer({ antialias: false, forceWebGL }),
      async (renderer) => {
        await renderer.init();
        return 'isWebGPUBackend' in renderer.backend && renderer.backend.isWebGPUBackend
          ? 'webgpu' : 'webgl2';
      },
    );
    const engine = new VisualEngine(result.renderer, result.backend, result.failures);
    engine.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    engine.renderer.outputColorSpace = THREE.SRGBColorSpace;
    engine.renderer.setClearColor(0x03040a);
    engine.renderer.onDeviceLost = (info) => {
      if (!engine.disposed) onLoss(`Graphics device lost: ${info.message}. Restart in WebGL2 or retry the renderer.`);
    };
    engine.renderer.onError = (message) => { if (!engine.disposed) onLoss(`Graphics validation failed: ${message}`); };
    engine.renderer.debug.onShaderError = () => {
      if (!engine.disposed) onLoss('Shader compilation failed. Inspect the browser console, then retry another backend.');
    };
    engine.renderer.domElement.setAttribute('aria-label', 'Rendered capability probe');
    return engine;
  }

  select(mode: string) {
    this.clearMode();
    try {
      this.active = this.modes.select(mode, this.backend);
      this.output = createOutputPipeline(this.renderer, this.active.scene, this.active.camera, this.active.filter);
    } catch (error) {
      this.clearMode();
      throw error;
    }
  }

  resize(width: number, height: number, scale: number) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * scale);
    this.renderer.setSize(Math.max(1, width), Math.max(1, height));
    this.renderer.getDrawingBufferSize(this.dimensions);
  }

  render(frame: Omit<ModeFrame, 'aspect'>, exposure: number, bloom: number) {
    if (this.disposed) return;
    this.renderer.toneMappingExposure = exposure;
    const size = this.renderer.getSize(this.logicalSize);
    this.active?.update({ ...frame, aspect: size.x / size.y });
    this.output?.render(bloom);
  }

  private clearMode() {
    this.output?.dispose();
    this.output = undefined;
    this.modes.clear();
    this.active = undefined;
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clearMode();
    this.renderer.domElement.remove();
    await this.renderer.dispose();
  }
}
