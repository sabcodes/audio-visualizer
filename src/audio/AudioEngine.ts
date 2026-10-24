import { calculateBandEnergy, calculateRMS, smoothEnergy } from './analysis';

export interface AudioState {
  status: 'empty' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error';
  /** 'system' is live capture of audio playing on this computer; seek and pause don't apply. */
  source: 'file' | 'system';
  trackName: string;
  currentTime: number;
  duration: number;
  error: string | null;
  /** Non-fatal guidance, e.g. why system-audio capture didn't start. Never blocks the file player. */
  notice: string | null;
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
  getDisplayMedia?: ((options: DisplayCaptureOptions) => Promise<MediaStream>) | null;
}
/** Chrome 141+ screen-share options that aren't in TypeScript's DOM lib yet. */
export type DisplayCaptureOptions = DisplayMediaStreamOptions & {
  systemAudio?: 'include' | 'exclude';
  windowAudio?: 'exclude' | 'window' | 'system';
  selfBrowserSurface?: 'include' | 'exclude';
};
export const displayCaptureOptions: DisplayCaptureOptions = {
  video: true, // Required: audio-only display capture is rejected.
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  systemAudio: 'include',
  windowAudio: 'system',
  selfBrowserSurface: 'exclude',
};
export const SYSTEM_AUDIO_NAME = 'System audio';
const NO_AUDIO_TRACK = 'No audio was shared. Choose Entire Screen and turn on "Also share system audio", or pick a tab with "Also share tab audio" on. If that toggle is missing (macOS before 14.2 or Chrome before 141), share a Chrome tab or load a file.';
const UNSUPPORTED = 'This browser can\'t capture audio playing on this computer. Use current Chrome, or load a file.';
const STOPPED = 'Stopped listening to system audio. Listen again or load a file.';
function captureFailure(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'NotAllowedError' && /system/i.test(message)) return 'macOS blocked the capture. Allow Chrome in System Settings › Privacy & Security › Screen & System Audio Recording, restart Chrome, then try again.';
  if (name === 'NotAllowedError' || name === 'AbortError') return 'Sharing was cancelled or blocked. Try again, or load a file.';
  if (name === 'InvalidStateError') return 'Chrome only opens the share picker for the focused tab. Click this page first, then try again.';
  if (name === 'NotSupportedError' || name === 'TypeError') return UNSUPPORTED;
  return `System audio couldn't start: ${message} Try again, or load a file.`;
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
  private sourceConnected = false;
  private analyser?: AnalyserNode;
  private readonly getDisplayMedia: ((options: DisplayCaptureOptions) => Promise<MediaStream>) | null;
  private live?: { stream: MediaStream; node: MediaStreamAudioSourceNode; track: MediaStreamTrack; ended: () => void };
  private fileName = '';
  private url?: string;
  private disposed = false;
  private generation = 0;
  private desiredPlaying = false;
  private baseline = 0;
  private cooldown = 0;
  private previousBass = 0;
  private current: AudioState = { status: 'empty', source: 'file', trackName: '', currentTime: 0, duration: 0, error: null, notice: null };
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
    const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    this.getDisplayMedia = deps.getDisplayMedia !== undefined ? deps.getDisplayMedia
      : devices?.getDisplayMedia ? (options) => devices.getDisplayMedia(options) : null;
    const on = (name: string, callback: () => void) => {
      this.media.addEventListener(name, callback);
      this.mediaListeners.push([name, callback]);
    };
    const time = () => { if (!this.live) this.publish({ currentTime: finiteTime(this.media.currentTime), duration: finiteTime(this.media.duration) }); };
    on('timeupdate', time);
    on('durationchange', time);
    on('loadedmetadata', () => {
      if (this.url && this.current.status === 'loading') this.publish({ status: 'ready', duration: finiteTime(this.media.duration) });
    });
    on('canplay', () => {
      if (this.url && this.current.status === 'loading') this.publish({ status: 'ready', duration: finiteTime(this.media.duration) });
    });
    on('play', () => {
      if (!this.desiredPlaying || this.live) { this.media.pause(); return; }
      this.publish({ status: 'playing', error: null });
    });
    on('pause', () => {
      if (this.live) return;
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
  /** False when the browser has no getDisplayMedia; the toggle for system audio may still be absent. */
  get systemAudioSupported(): boolean { return this.getDisplayMedia !== null; }
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
    this.releaseLive();
    this.resetAnalysis();
    if (this.url) this.revokeURL(this.url);
    this.url = undefined;
    try {
      this.url = this.createURL(file);
      this.fileName = file.name;
      this.publish({ status: 'loading', source: 'file', trackName: file.name, currentTime: 0, duration: 0, error: null, notice: null });
      this.media.src = this.url;
      this.media.load();
    } catch (error) { this.fail(String(error)); }
  }

  async play(): Promise<void> {
    if (this.disposed || !this.url || this.current.status === 'loading' || this.live) return;
    const generation = ++this.generation;
    this.desiredPlaying = true;
    try {
      const { context, analyser } = this.graph();
      if (!this.source) this.source = context.createMediaElementSource(this.media);
      if (!this.sourceConnected) {
        // The analyser is a side branch so a live source can share it without reaching the speakers.
        try {
          this.source.connect(analyser);
          this.source.connect(context.destination);
          this.sourceConnected = true;
        } catch (error) {
          this.source.disconnect();
          throw error;
        }
      }
      if (context.state === 'suspended') await context.resume();
      if (this.disposed || generation !== this.generation) return;
      if (this.current.status === 'ended') this.media.currentTime = 0;
      await this.media.play();
      if (this.disposed || generation !== this.generation) return;
      this.publish({ status: 'playing', error: null, notice: null });
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.fail(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Starts analyzing audio playing on this computer. Call from a click handler: the picker needs
   * transient activation. Failures leave the file player as it was and explain themselves in `notice`.
   */
  async listen(): Promise<void> {
    if (this.disposed) return;
    if (!this.getDisplayMedia) { this.publish({ notice: UNSUPPORTED }); return; }
    const generation = ++this.generation;
    let request: Promise<MediaStream>;
    try { request = this.getDisplayMedia(displayCaptureOptions); } catch (error) { request = Promise.reject(error); }
    try {
      // Created while the click's activation is still live, so the context isn't left suspended.
      const { context } = this.graph();
      const resumed = context.state === 'suspended' ? context.resume() : Promise.resolve();
      const stream = await request;
      const stop = () => stream.getTracks().forEach((track) => track.stop());
      if (this.disposed || generation !== this.generation) { stop(); return; }
      stream.getVideoTracks().forEach((track) => track.stop());
      const track = stream.getAudioTracks()[0];
      if (!track || track.readyState === 'ended') { stop(); this.publish({ notice: NO_AUDIO_TRACK }); return; }
      await resumed;
      if (this.disposed || generation !== this.generation) { stop(); return; }
      this.desiredPlaying = false;
      this.media.pause();
      this.releaseLive();
      this.resetAnalysis();
      const node = context.createMediaStreamSource(stream);
      // Never connected to the destination: the player is already audible, so this would play twice.
      node.connect(this.analyser!);
      const ended = () => { if (this.live?.track === track) this.stopListening(); };
      track.addEventListener('ended', ended);
      this.live = { stream, node, track, ended };
      this.publish({ status: 'playing', source: 'system', trackName: SYSTEM_AUDIO_NAME, currentTime: 0, duration: 0, error: null, notice: null });
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.publish({ notice: captureFailure(error) });
    }
  }
  /** Stops capture and returns to the loaded file (paused), or to the silent empty state. */
  stopListening(notice: string | null = STOPPED): void {
    if (this.disposed) return;
    // Also cancels a picker that is still open, so its stream is stopped when it arrives.
    ++this.generation;
    if (!this.live) return;
    this.releaseLive();
    this.resetAnalysis();
    const currentTime = finiteTime(this.media.currentTime);
    this.publish({
      status: this.url ? (currentTime > 0 ? 'paused' : 'ready') : 'empty', source: 'file', trackName: this.url ? this.fileName : '',
      currentTime, duration: this.url ? finiteTime(this.media.duration) : 0, error: null, notice,
    });
  }

  pause(): void {
    if (this.disposed || this.live) return;
    ++this.generation;
    this.desiredPlaying = false;
    this.media.pause();
    this.resetAnalysis();
    if (this.current.status === 'playing') this.publish({ status: 'paused' });
  }
  seek(seconds: number): void {
    if (this.disposed || !this.url || this.current.status === 'loading' || this.live) return;
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
    this.releaseLive();
    this.resetAnalysis();
    this.source?.disconnect();
    this.analyser?.disconnect();
    if (this.url) { this.revokeURL(this.url); this.url = undefined; }
    this.listeners.clear();
    await this.context?.close();
  }
  private graph(): { context: AudioContext; analyser: AnalyserNode } {
    if (!this.context) this.context = this.createContext();
    if (!this.analyser) {
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0;
      this.analyser = analyser;
    }
    return { context: this.context, analyser: this.analyser };
  }
  private releaseLive() {
    const live = this.live;
    if (!live) return;
    this.live = undefined;
    live.track.removeEventListener('ended', live.ended);
    live.node.disconnect();
    live.stream.getTracks().forEach((track) => track.stop());
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
    const wasLive = Boolean(this.live);
    this.releaseLive();
    this.resetAnalysis();
    this.publish({ status: 'error', error, ...(wasLive ? { source: 'file' as const, trackName: this.url ? this.fileName : '' } : {}) });
  }
  private publish(change: Partial<AudioState>) {
    if (this.disposed) return;
    this.current = { ...this.current, ...change };
    for (const listener of this.listeners) listener(this.state);
  }
}
