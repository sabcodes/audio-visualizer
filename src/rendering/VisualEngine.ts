import * as THREE from 'three/webgpu';
import { initializeBackend, type BackendPreference } from './backendSelection';
import { ModeRegistry, modeDefinitions, type ModeFrame, type VisualMode } from '../modes/registry';
import { createOutputPipeline } from './OutputPipeline';
import { basePixelRatio, presetBudget, type QualityBudget } from './quality';
import { defaultOutput, toneMappingConstant, type OutputSettings } from './outputSettings';
import { SnapshotTransition } from './SnapshotTransition';

/** Completion is an upper bound including submission/callback overhead, not GPU execution time. */
export interface FrameBreakdown { cpuUpdateMs: number; gpuMs: number | null; gpuPassMs: number | null; gpuSample: number }

export class VisualEngine {
  readonly lastFrame: FrameBreakdown = { cpuUpdateMs: 0, gpuMs: null, gpuPassMs: null, gpuSample: 0 };
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
  private selection: Promise<unknown> = Promise.resolve();
  private readonly transition = new SnapshotTransition();
  private transitionSeconds = 0.35;
  private lastBloom = 0.6;
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
      (forceWebGL) => {
        const renderer = new THREE.WebGPURenderer({ antialias: false, forceWebGL, trackTimestamp: true });
        const dispose = renderer.dispose.bind(renderer);
        renderer.dispose = async () => {
          if (renderer.initialized) { await dispose(); return; }
          // r186 dispose() calls setAnimationLoop() without awaiting it. After failed init
          // that re-enters the rejected initialization and leaks an unhandled rejection.
          // No renderer managers exist yet; release only a partially acquired backend.
          const partial = renderer.backend as unknown as { device?: { destroy(): void }; gl?: WebGL2RenderingContext };
          partial.device?.destroy();
          partial.gl?.getExtension('WEBGL_lose_context')?.loseContext();
          renderer.domElement.remove();
        };
        return renderer;
      },
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
    // The r186 runtime supplies an error object; its declaration still says string.
    engine.renderer.onError = (info: unknown) => {
      const message = info && typeof info === 'object' && 'message' in info ? info.message : info;
      if (!engine.disposed) onLoss(`Graphics validation failed: ${String(message)}`);
    };
    engine.renderer.debug.onShaderError = () => {
      if (!engine.disposed) onLoss('Shader compilation failed. Inspect the browser console, then retry another backend.');
    };
    // r186 geometry disposal sees only its first render object's node attributes.
    // Output/shadow contexts create additional wrappers (notably instance matrices).
    // Keep their lifetime tied to the owning material, including AA rebuilds.
    engine.renderer.debug.onNodeBuilderCreated = (builder, object) => {
      const material = (object as { material?: THREE.Material }).material;
      if (!material) return; // Compute kernels have their own disposal path.
      const release = () => {
        material.removeEventListener('dispose', release);
        const attributes = (engine.renderer as unknown as { _attributes: { delete(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): void } })._attributes;
        const built = builder as unknown as { getAttributesArray(): { node?: { attribute?: THREE.BufferAttribute | THREE.InterleavedBufferAttribute } }[] };
        for (const entry of built.getAttributesArray()) {
          if (entry.node?.attribute) attributes.delete(entry.node.attribute);
        }
      };
      material.addEventListener('dispose', release);
    };
    engine.renderer.domElement.setAttribute('aria-label', 'Music visualizer');
    return engine;
  }

  get activeMode() { return this.activeId; }
  /** The active mode's scene, for the DEV debug hook. */
  get activeScene() { return this.active?.scene; }
  get output() { return { ...this.outputSettings }; }
  /** AA the active pipeline was actually built with (can lag `output` while a select is pending). */
  get pipelineAa() { return this.pipelineSettings?.aa; }
  get transitioning() { return this.transition.active; }
  setTransition(seconds: number, reducedMotion = false) {
    this.transitionSeconds = reducedMotion ? 0 : seconds;
    this.transition.setDuration(this.transitionSeconds);
  }

  /** Tone mapping applies immediately; changing AA rebuilds only the active output pipeline. */
  setOutput(settings: OutputSettings) {
    const rebuild = settings.aa !== this.outputSettings.aa;
    this.outputSettings = { ...settings };
    this.renderer.toneMapping = toneMappingConstant(settings.toneMapping);
    if (rebuild && this.active) {
      this.pipeline?.dispose();
      this.pipeline = createOutputPipeline(this.renderer, this.active.scene, this.active.camera, this.active.filter, { aa: settings.aa, resolutionScale: this.active.resolutionScale });
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
    // At most one candidate may own assets/compile work; queued stale requests allocate nothing.
    const previous = this.selection;
    const task = (async () => {
      await previous.catch(() => {});
      if (generation !== this.selectGeneration || this.disposed) return false;
      return this.prepareSelection(mode, generation);
    })();
    this.selection = task;
    return task;
  }

  private async prepareSelection(mode: string, generation: number): Promise<boolean> {
    let candidate: VisualMode | undefined;
    let output: ReturnType<typeof createOutputPipeline> | undefined;
    const candidateSettings = { ...this.outputSettings };
    try {
      candidate = this.modes.create(mode, this.backend, this.budget);
      // Models load before compiling, so a figure never pops in after the swap.
      await candidate.ready;
      if (generation !== this.selectGeneration || this.disposed) { candidate.dispose(); return false; }
      output = createOutputPipeline(this.renderer, candidate.scene, candidate.camera, candidate.filter, { aa: candidateSettings.aa, resolutionScale: candidate.resolutionScale });
      // Native compilation yields while the old scene renders. WebGL's per-object
      // async polling can take minutes on large instanced models; the complete
      // offscreen pipeline warmup below compiles its actual render path directly.
      if (this.backend === 'webgpu') await this.renderer.compileAsync(candidate.scene, candidate.camera);
      output.prepare(this.lastBloom);
      // Register geometry/storage ownership before compiling kernels, even for superseded candidates.
      // Simulation hooks run only after activation: legacy hooks can change shared renderer state.
      await candidate.prepare?.(this.renderer);
      await this.gpuQueue?.onSubmittedWorkDone();
      if (this.transitionSeconds > 0 && this.active) await this.transition.prepare(this.renderer);
      if (this.compileDelayMs > 0) await new Promise((done) => setTimeout(done, this.compileDelayMs));
    } catch (error) {
      output?.dispose(); candidate?.dispose();
      if (generation !== this.selectGeneration || this.disposed) return false;
      throw error;
    }
    if (generation !== this.selectGeneration || this.disposed) { output.dispose(); candidate.dispose(); return false; }
    try {
      if (candidateSettings.aa !== this.outputSettings.aa) {
        // AA changed while compiling; rebuild so the swapped-in pipeline matches the current setting.
        output.dispose();
        Object.assign(candidateSettings, this.outputSettings);
        output = createOutputPipeline(this.renderer, candidate.scene, candidate.camera, candidate.filter, { aa: candidateSettings.aa, resolutionScale: candidate.resolutionScale });
        output.prepare(this.lastBloom);
      }
      const isCanvas = (id?: string) => modeDefinitions.find(definition => definition.id === id)?.output !== 'dom';
      if (this.pipeline && this.transitionSeconds > 0 && isCanvas(this.activeId) && isCanvas(mode)) {
        this.transition.capture(this.renderer, this.dimensions.x, this.dimensions.y, () => this.pipeline!.render(this.lastBloom));
      } else this.transition.cancel();
    } catch (error) { output.dispose(); candidate.dispose(); throw error; }
    this.clearMode();
    this.active = candidate;
    this.pipeline = output;
    this.pipelineSettings = candidateSettings;
    this.activeId = mode;
    this.lastFrame.gpuMs = this.lastFrame.gpuPassMs = null;
    return true;
  }

  /** Re-creates the active mode only when its simulation budget changed; otherwise only re-sizes. */
  async setQuality(budget: QualityBudget): Promise<void> {
    const rebuild = budget.preset !== this.budget.preset;
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
    this.lastBloom = bloom;
    if (frame.reducedMotion) this.transition.cancel();
    this.transition.render(this.renderer);
    this.lastFrame.cpuUpdateMs = performance.now() - start;
    this.resolveGpuTime(start);
  }

  get gpuTimingAvailable() {
    return Boolean(this.gpuQueue);
  }

  private get gpuQueue() {
    // The pinned backend exposes its initialized device; @types/three omits that member.
    return this.backend === 'webgpu' ? (this.renderer.backend as unknown as { device: { queue: { onSubmittedWorkDone(): Promise<void> } } }).device.queue : undefined;
  }

  // Never use summed pass timestamps as elapsed frame time: pass intervals can overlap on Metal.
  // Queue completion also includes compute and exposes backlog without summing overlapping work.
  private resolveGpuTime(now: number) {
    if (!this.gpuTimingAvailable || this.resolving || now < this.nextResolve) return;
    this.nextResolve = now + 500;
    this.resolving = true;
    const generation = this.selectGeneration;
    this.gpuQueue!.onSubmittedWorkDone()
      .then(() => {
        if (this.disposed || generation !== this.selectGeneration) return;
        this.lastFrame.gpuMs = performance.now() - now;
        this.lastFrame.gpuSample++;
      })
      .catch(() => { this.lastFrame.gpuMs = null; })
      .finally(() => { this.resolving = false; });
    if (this.renderer.hasFeature('timestamp-query')) {
      void Promise.all([this.renderer.resolveTimestampsAsync('render'), this.renderer.resolveTimestampsAsync('compute')])
        .then(values => {
          if (generation === this.selectGeneration && !this.disposed) this.lastFrame.gpuPassMs = values.reduce<number>((sum, value) => sum + (typeof value === 'number' ? value : 0), 0);
        }).catch(() => { this.lastFrame.gpuPassMs = null; });
    }
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
    await this.selection.catch(() => {});
    this.clearMode();
    this.transition.dispose();
    this.renderer.domElement.remove();
    await this.renderer.dispose();
  }
}
