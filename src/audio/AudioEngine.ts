import { calculateBandEnergy, calculateRMS, smoothEnergy } from './analysis';

export interface AudioState {
  status: 'empty' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error';
  trackName: string;
  currentTime: number;
  duration: number;
  error: string | null;
}
export interface AudioFrame {
  waveform: Float32Array;
  spectrum: Uint8Array;
  bass: number;
  mid: number;
  highs: number;
  rms: number;
  onset: boolean;
  time: number;
}
export interface AudioEngineDeps {
  media?: HTMLAudioElement;
  createContext?: () => AudioContext;
  createURL?: (file: Blob) => string;
  revokeURL?: (url: string) => void;
}
const finiteTime = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;

/** One media element and one lazy graph survive track changes and renderer restarts. */
export class AudioEngine {
  private readonly media: HTMLAudioElement;
  private readonly createContext: () => AudioContext;
  private readonly createURL: (file: Blob) => string;
  private readonly revokeURL: (url: string) => void;
  private context?: AudioContext;
  private source?: MediaElementAudioSourceNode;
  private analyser?: AnalyserNode;
  private url?: string;
  private disposed = false;
  private generation = 0;
  private desiredPlaying = false;
  private baseline = 0;
  private cooldown = 0;
  private previousBass = 0;
  private current: AudioState = { status: 'empty', trackName: '', currentTime: 0, duration: 0, error: null };
  private readonly listeners = new Set<(state: Readonly<AudioState>) => void>();
  private readonly mediaListeners: [string, EventListener][] = [];
  private readonly frame: AudioFrame = {
    waveform: new Float32Array(1024), spectrum: new Uint8Array(512),
    bass: 0, mid: 0, highs: 0, rms: 0, onset: false, time: 0,
  };

  constructor(deps: AudioEngineDeps = {}) {
    this.media = deps.media ?? new Audio();
    this.media.preload = 'metadata';
    this.createContext = deps.createContext ?? (() => new AudioContext());
    this.createURL = deps.createURL ?? ((file) => URL.createObjectURL(file));
    this.revokeURL = deps.revokeURL ?? ((url) => URL.revokeObjectURL(url));
    const on = (name: string, callback: () => void) => {
      this.media.addEventListener(name, callback);
      this.mediaListeners.push([name, callback]);
    };
    const time = () => this.publish({ currentTime: finiteTime(this.media.currentTime), duration: finiteTime(this.media.duration) });
    on('timeupdate', time);
    on('durationchange', time);
    on('loadedmetadata', () => {
      if (this.url && this.current.status === 'loading') this.publish({ status: 'ready', duration: finiteTime(this.media.duration) });
    });
    on('canplay', () => {
      if (this.url && this.current.status === 'loading') this.publish({ status: 'ready', duration: finiteTime(this.media.duration) });
    });
    on('play', () => {
      if (!this.desiredPlaying) { this.media.pause(); return; }
      this.publish({ status: 'playing', error: null });
    });
    on('pause', () => {
      this.resetAnalysis();
      if (this.current.status === 'playing') this.publish({ status: 'paused' });
    });
    on('ended', () => {
      this.desiredPlaying = false;
      this.resetAnalysis();
      this.publish({ status: 'ended', currentTime: finiteTime(this.media.currentTime) });
    });
    on('error', () => this.fail(this.media.error?.message || 'This file could not be decoded. Try a supported audio file.'));
  }

  get state(): Readonly<AudioState> { return { ...this.current }; }
  /** Analysis sample rate; silent frames assume 48 kHz until a context exists. */
  get sampleRate(): number { return this.context?.sampleRate ?? 48000; }
  subscribe(listener: (state: Readonly<AudioState>) => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  }

  load(file: File): void {
    if (this.disposed) return;
    ++this.generation;
    this.desiredPlaying = false;
    this.media.pause();
    this.resetAnalysis();
    if (this.url) this.revokeURL(this.url);
    this.url = undefined;
    try {
      this.url = this.createURL(file);
      this.publish({ status: 'loading', trackName: file.name, currentTime: 0, duration: 0, error: null });
      this.media.src = this.url;
      this.media.load();
    } catch (error) { this.fail(String(error)); }
  }

  async play(): Promise<void> {
    if (this.disposed || !this.url || this.current.status === 'loading') return;
    const generation = ++this.generation;
    this.desiredPlaying = true;
    try {
      if (!this.context) this.context = this.createContext();
      if (!this.source) this.source = this.context.createMediaElementSource(this.media);
      if (!this.analyser) {
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0;
        try {
          this.source.connect(analyser);
          analyser.connect(this.context.destination);
          this.analyser = analyser;
        } catch (error) {
          this.source.disconnect();
          analyser.disconnect();
          throw error;
        }
      }
      if (this.context.state === 'suspended') await this.context.resume();
      if (this.disposed || generation !== this.generation) return;
      if (this.current.status === 'ended') this.media.currentTime = 0;
      await this.media.play();
      if (this.disposed || generation !== this.generation) return;
      this.publish({ status: 'playing', error: null });
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.fail(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  pause(): void {
    if (this.disposed) return;
    ++this.generation;
    this.desiredPlaying = false;
    this.media.pause();
    this.resetAnalysis();
    if (this.current.status === 'playing') this.publish({ status: 'paused' });
  }
  seek(seconds: number): void {
    if (this.disposed || !this.url || this.current.status === 'loading') return;
    const time = Math.min(finiteTime(this.media.duration), finiteTime(seconds));
    try {
      this.media.currentTime = time;
      this.resetAnalysis();
      this.publish({ currentTime: time, ...(this.current.status === 'ended' ? { status: 'paused' as const } : {}) });
    } catch (error) { this.fail(String(error)); }
  }

  sample(deltaSeconds: number): AudioFrame {
    const frame = this.frame;
    frame.time = finiteTime(this.media.currentTime);
    if (this.disposed || !this.analyser || !this.context || this.current.status !== 'playing') {
      this.resetAnalysis();
      return frame;
    }
    try {
      this.analyser.getFloatTimeDomainData(frame.waveform as Float32Array<ArrayBuffer>);
      this.analyser.getByteFrequencyData(frame.spectrum as Uint8Array<ArrayBuffer>);
      const dt = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(1, deltaSeconds)) : 0;
      const bass = calculateBandEnergy(frame.spectrum, 20, 250, this.context.sampleRate);
      frame.bass = smoothEnergy(frame.bass, bass, dt);
      frame.mid = smoothEnergy(frame.mid, calculateBandEnergy(frame.spectrum, 250, 2000, this.context.sampleRate), dt);
      frame.highs = smoothEnergy(frame.highs, calculateBandEnergy(frame.spectrum, 2000, 12000, this.context.sampleRate), dt);
      frame.rms = calculateRMS(frame.waveform);
      this.cooldown = Math.max(0, this.cooldown - dt);
      frame.onset = dt > 0 && bass > 0.08 && bass > this.previousBass + 0.015 && bass > this.baseline * 1.3 && this.cooldown === 0;
      this.previousBass = bass;
      if (frame.onset) this.cooldown = 0.18;
      this.baseline = smoothEnergy(this.baseline, bass, dt, 0.3);
      return frame;
    } catch (error) {
      this.fail(`Audio analysis failed: ${String(error)}`);
      return frame;
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    this.desiredPlaying = false;
    for (const [name, callback] of this.mediaListeners) this.media.removeEventListener(name, callback);
    this.mediaListeners.length = 0;
    this.media.pause();
    this.media.removeAttribute('src');
    this.media.load();
    this.resetAnalysis();
    this.source?.disconnect();
    this.analyser?.disconnect();
    if (this.url) { this.revokeURL(this.url); this.url = undefined; }
    this.listeners.clear();
    await this.context?.close();
  }
  private resetAnalysis() {
    this.frame.waveform.fill(0);
    this.frame.spectrum.fill(0);
    this.frame.bass = this.frame.mid = this.frame.highs = this.frame.rms = 0;
    this.frame.onset = false;
    this.baseline = this.cooldown = this.previousBass = 0;
  }
  private fail(error: string) {
    ++this.generation;
    this.desiredPlaying = false;
    this.media.pause();
    this.resetAnalysis();
    this.publish({ status: 'error', error });
  }
  private publish(change: Partial<AudioState>) {
    if (this.disposed) return;
    this.current = { ...this.current, ...change };
    for (const listener of this.listeners) listener(this.state);
  }
}
