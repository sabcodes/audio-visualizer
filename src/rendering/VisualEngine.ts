import * as THREE from 'three/webgpu';
import { initializeBackend, type BackendPreference } from './backendSelection';
import { ModeRegistry, type ModeFrame, type VisualMode } from '../modes/registry';
import { createOutputPipeline } from './OutputPipeline';
import { basePixelRatio, presetBudget, type QualityBudget } from './quality';
import { defaultOutput, toneMappingConstant, type OutputSettings } from './outputSettings';

/** CPU submit cost per frame plus the latest resolved GPU time; GPU is null when unmeasurable. */
export interface FrameBreakdown { cpuUpdateMs: number; gpuMs: number | null }

export class VisualEngine {
  readonly lastFrame: FrameBreakdown = { cpuUpdateMs: 0, gpuMs: null };
  private nextResolve = 0;
  private resolving = false;
  private active?: VisualMode;
  private readonly modes = new ModeRegistry();
  private pipeline?: ReturnType<typeof createOutputPipeline>;
  private disposed = false;
  readonly dimensions = new THREE.Vector2();
  private readonly logicalSize = new THREE.Vector2();
  private budget: QualityBudget = presetBudget('balanced');
  private activeId?: string;
  /** Latest requested mode, which can differ from activeId while a select is compiling. */
  private requestedId?: string;
  private selectGeneration = 0;
  private outputSettings: OutputSettings = { ...defaultOutput };
  private pipelineSettings?: OutputSettings;
  /** Test seam (DEV debug hook only): stretches the compile window so lifecycle races are reproducible. */
  compileDelayMs = 0;
  private readonly lastSize = { width: 1, height: 1, scale: 1 };

  private constructor(
    readonly renderer: THREE.WebGPURenderer,
    readonly backend: 'webgpu' | 'webgl2',
    readonly startupFailures: string[],
  ) {}

  static async create(preference: BackendPreference, onLoss: (message: string) => void) {
    const result = await initializeBackend(
      preference,
      (forceWebGL) => new THREE.WebGPURenderer({ antialias: false, forceWebGL, trackTimestamp: true }),
      async (renderer) => {
        await renderer.init();
        return 'isWebGPUBackend' in renderer.backend && renderer.backend.isWebGPUBackend
          ? 'webgpu' : 'webgl2';
      },
    );
    const engine = new VisualEngine(result.renderer, result.backend, result.failures);
    engine.renderer.toneMapping = toneMappingConstant(defaultOutput.toneMapping);
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

  get activeMode() { return this.activeId; }
  /** The active mode's scene, for the DEV debug hook. */
  get activeScene() { return this.active?.scene; }
  get output() { return { ...this.outputSettings }; }
  /** AA the active pipeline was actually built with (can lag `output` while a select is pending). */
  get pipelineAa() { return this.pipelineSettings?.aa; }

  /** Tone mapping applies immediately; changing AA rebuilds only the active output pipeline. */
  setOutput(settings: OutputSettings) {
    const rebuild = settings.aa !== this.outputSettings.aa;
    this.outputSettings = { ...settings };
    this.renderer.toneMapping = toneMappingConstant(settings.toneMapping);
    if (rebuild && this.active) {
      this.pipeline?.dispose();
      this.pipeline = createOutputPipeline(this.renderer, this.active.scene, this.active.camera, this.active.filter, { aa: settings.aa });
      this.pipelineSettings = { ...settings };
    }
  }

  /**
   * Compiles the requested mode off-screen, then swaps it in. The previous mode keeps rendering
   * meanwhile. Resolves false when a newer request superseded this one; only the selected mode is compiled.
   */
  async select(mode: string): Promise<boolean> {
    const generation = ++this.selectGeneration;
    this.requestedId = mode;
    let candidate: VisualMode | undefined;
    let output: ReturnType<typeof createOutputPipeline> | undefined;
    const candidateSettings = { ...this.outputSettings };
    try {
      candidate = this.modes.create(mode, this.backend, this.budget);
      // Models load before compiling, so a figure never pops in after the swap.
      await candidate.ready;
      output = createOutputPipeline(this.renderer, candidate.scene, candidate.camera, candidate.filter, { aa: candidateSettings.aa });
      await this.renderer.compileAsync(candidate.scene, candidate.camera);
      if (this.compileDelayMs > 0) await new Promise((done) => setTimeout(done, this.compileDelayMs));
    } catch (error) {
      output?.dispose(); candidate?.dispose();
      if (generation !== this.selectGeneration || this.disposed) return false;
      throw error;
    }
    if (generation !== this.selectGeneration || this.disposed) { output.dispose(); candidate.dispose(); return false; }
    if (candidateSettings.aa !== this.outputSettings.aa) {
      // AA changed while compiling; rebuild so the swapped-in pipeline matches the current setting.
      output.dispose();
      Object.assign(candidateSettings, this.outputSettings);
      output = createOutputPipeline(this.renderer, candidate.scene, candidate.camera, candidate.filter, { aa: candidateSettings.aa });
    }
    this.clearMode();
    this.active = candidate;
    this.pipeline = output;
    this.pipelineSettings = candidateSettings;
    this.activeId = mode;
    return true;
  }

  /** Re-creates the active mode only when its simulation budget changed; otherwise only re-sizes. */
  async setQuality(budget: QualityBudget): Promise<void> {
    const rebuild = budget.particleScale !== this.budget.particleScale;
    this.budget = budget;
    this.resize(this.lastSize.width, this.lastSize.height, this.lastSize.scale);
    const target = this.requestedId ?? this.activeId;
    if (rebuild && target) await this.select(target);
  }

  resize(width: number, height: number, scale: number) {
    Object.assign(this.lastSize, { width, height, scale });
    this.renderer.setPixelRatio(basePixelRatio(this.budget, Math.max(1, height), window.devicePixelRatio || 1) * scale);
    this.renderer.setSize(Math.max(1, width), Math.max(1, height));
    this.renderer.getDrawingBufferSize(this.dimensions);
  }

  render(frame: Omit<ModeFrame, 'aspect'>, exposure: number, bloom: number) {
    if (this.disposed) return;
    this.renderer.toneMappingExposure = exposure;
    const size = this.renderer.getSize(this.logicalSize);
    const start = performance.now();
    this.active?.update({ ...frame, aspect: size.x / size.y });
    this.active?.simulate?.(this.renderer);
    this.pipeline?.render(bloom);
    this.lastFrame.cpuUpdateMs = performance.now() - start;
    this.resolveGpuTime(start);
  }

  get gpuTimingAvailable() {
    return this.backend === 'webgpu' && this.renderer.hasFeature('timestamp-query');
  }

  // Resolves at most every 500 ms off the frame path; r186 reports the most recent frame's summed pass durations.
  private resolveGpuTime(now: number) {
    if (!this.gpuTimingAvailable || this.resolving || now < this.nextResolve) return;
    this.nextResolve = now + 500;
    this.resolving = true;
    this.renderer.resolveTimestampsAsync('render')
      .then((total) => { if (typeof total === 'number') this.lastFrame.gpuMs = total; })
      .catch(() => { this.lastFrame.gpuMs = null; })
      .finally(() => { this.resolving = false; });
  }

  private clearMode() {
    this.pipeline?.dispose();
    this.pipeline = undefined;
    this.active?.dispose();
    this.active = undefined;
    this.activeId = undefined;
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.selectGeneration++;
    this.clearMode();
    this.renderer.domElement.remove();
    await this.renderer.dispose();
  }
}
