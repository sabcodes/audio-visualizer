import { describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { calculateBandEnergy, calculateRMS, smoothEnergy } from '../../src/audio/analysis';

class Media extends EventTarget {
  src = ''; preload = ''; currentTime = 0; duration = 12; error: { message: string } | null = null;
  play = vi.fn(async () => { this.dispatchEvent(new Event('play')); });
  pause = vi.fn(() => { this.dispatchEvent(new Event('pause')); });
  load = vi.fn();
  removeAttribute = vi.fn(() => { this.src = ''; });
}
function setup() {
  const media = new Media();
  let level = 128;
  const analyser = { fftSize: 0, smoothingTimeConstant: 1, connect: vi.fn(), disconnect: vi.fn(),
    getFloatTimeDomainData: vi.fn((buffer: Float32Array) => buffer.fill(0.5)),
    getByteFrequencyData: vi.fn((buffer: Uint8Array) => buffer.fill(level)),
  };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const context = { state: 'running', sampleRate: 48000, destination: {}, resume: vi.fn(async () => {}), close: vi.fn(async () => {}),
    createMediaElementSource: vi.fn(() => source), createAnalyser: vi.fn(() => analyser),
  };
  let next = 0;
  const revokeURL = vi.fn();
  const createContext = vi.fn(() => context as unknown as AudioContext);
  const engine = new AudioEngine({ media: media as unknown as HTMLAudioElement, createContext, createURL: () => `blob:${++next}`, revokeURL });
  const load = (name = 'tone.wav') => { engine.load({ name } as File); media.dispatchEvent(new Event('loadedmetadata')); };
  return { engine, media, source, analyser, context, createContext, revokeURL, load, level: (value: number) => { level = value; } };
}
function deferred() {
  let resolve!: () => void; let reject!: (error: Error) => void;
  const promise = new Promise<void>((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
}
describe('audio state and ownership', () => {
  it('starts silent with stable arrays and never creates a context before Play', () => {
    const f = setup(); const a = f.engine.sample(1 / 60); const b = f.engine.sample(1 / 60);
    expect(a).toBe(b); expect(a.waveform.length).toBe(1024); expect(a.spectrum.length).toBe(512);
    expect(a.waveform.every((v) => v === 0)).toBe(true); expect(f.createContext).not.toHaveBeenCalled();
  });
  it('subscribes immediately and removes subscriptions', () => {
    const f = setup(); const listener = vi.fn(); const off = f.engine.subscribe(listener);
    expect(listener).toHaveBeenCalledOnce(); off(); f.load(); expect(listener).toHaveBeenCalledOnce();
  });
  it('creates one graph across repeated play, pause, and track changes', async () => {
    const f = setup(); f.load(); await f.engine.play(); f.engine.pause(); await f.engine.play(); f.load('two.wav'); await f.engine.play();
    expect(f.context.createMediaElementSource).toHaveBeenCalledOnce(); expect(f.source.connect).toHaveBeenCalledExactlyOnceWith(f.analyser);
    expect(f.analyser.connect).toHaveBeenCalledOnce(); expect(f.analyser.fftSize).toBe(1024); expect(f.analyser.smoothingTimeConstant).toBe(0);
  });
  it('revokes replaced URLs and disposes graph and listeners once', async () => {
    const f = setup(); f.load(); await f.engine.play(); f.load('two.wav');
    expect(f.revokeURL).toHaveBeenCalledExactlyOnceWith('blob:1');
    const listener = vi.fn(); f.engine.subscribe(listener); await f.engine.dispose(); await f.engine.dispose();
    listener.mockClear(); f.media.dispatchEvent(new Event('play'));
    expect(listener).not.toHaveBeenCalled(); expect(f.context.close).toHaveBeenCalledOnce(); expect(f.source.disconnect).toHaveBeenCalledOnce();
    expect(f.revokeURL.mock.calls).toEqual([['blob:1'], ['blob:2']]);
  });
  it('uses stable live buffers and zeros them after pause', async () => {
    const f = setup(); const before = f.engine.sample(0); f.load(); await f.engine.play();
    const live = f.engine.sample(1 / 60); expect(live).toBe(before); expect(live.bass).toBeGreaterThan(0); expect(live.rms).toBe(0.5);
    f.engine.pause(); expect(f.engine.sample(0)).toBe(live); expect(live.bass).toBe(0); expect(live.spectrum.every((v) => v === 0)).toBe(true);
  });
  it('can retry a failed graph connection without creating another media source', async () => {
    const f = setup(); f.load(); f.analyser.connect.mockImplementationOnce(() => { throw new Error('connection failed'); });
    await expect(f.engine.play()).rejects.toThrow('connection failed');
    await f.engine.play(); expect(f.engine.state.status).toBe('playing');
    expect(f.context.createMediaElementSource).toHaveBeenCalledOnce();
  });
  it('resumes the same context if it is suspended again', async () => {
    const f = setup(); f.load(); await f.engine.play(); f.engine.pause(); f.context.state = 'suspended';
    await f.engine.play(); expect(f.context.resume).toHaveBeenCalledOnce(); expect(f.createContext).toHaveBeenCalledOnce();
  });
  it('recovers from rejected playback and clears the error on retry', async () => {
    const f = setup(); f.load(); f.media.play.mockRejectedValueOnce(new Error('permission denied'));
    await expect(f.engine.play()).rejects.toThrow('permission denied'); expect(f.engine.state.status).toBe('error'); expect(f.engine.sample(1).rms).toBe(0);
    await f.engine.play(); expect(f.engine.state.status).toBe('playing'); expect(f.engine.state.error).toBeNull();
  });
  for (const action of ['pause', 'load', 'dispose'] as const) it(`invalidates pending resume on ${action}`, async () => {
    const f = setup(); f.load(); f.context.state = 'suspended'; const pending = deferred(); f.context.resume.mockReturnValue(pending.promise);
    const playing = f.engine.play();
    if (action === 'load') f.load('replacement.wav'); else await f.engine[action]();
    pending.resolve(); await playing; expect(f.media.play).not.toHaveBeenCalled();
  });
  it('ignores rejection from a replaced playback request', async () => {
    const f = setup(); f.load(); const pending = deferred(); f.media.play.mockReturnValueOnce(pending.promise);
    const playing = f.engine.play(); f.load('replacement.wav'); pending.reject(new Error('old error')); await playing;
    expect(f.engine.state.trackName).toBe('replacement.wav'); expect(f.engine.state.status).toBe('ready'); expect(f.engine.state.error).toBeNull();
  });
  it('clamps seek and duration, and resets onset', async () => {
    const f = setup(); f.load(); await f.engine.play(); f.engine.sample(1 / 60);
    f.engine.seek(999); expect(f.media.currentTime).toBe(12);
    f.engine.seek(NaN); expect(f.media.currentTime).toBe(0); f.engine.seek(-1); expect(f.media.currentTime).toBe(0);
    f.media.duration = Infinity; f.media.dispatchEvent(new Event('durationchange')); expect(f.engine.state.duration).toBe(0);
  });
  it('handles ended and invalid media as silent states', async () => {
    const f = setup(); f.load(); await f.engine.play(); f.media.currentTime = 12; f.media.dispatchEvent(new Event('ended'));
    expect(f.engine.state.status).toBe('ended'); expect(f.engine.sample(1).bass).toBe(0);
    await f.engine.play(); expect(f.media.currentTime).toBe(0);
    f.media.error = { message: 'decode failed' }; f.media.dispatchEvent(new Event('error'));
    expect(f.engine.state.status).toBe('error'); expect(f.engine.sample(1).rms).toBe(0);
  });
  it('detects an onset once for a sustained energy step, not a tempo', async () => {
    const f = setup(); f.load(); await f.engine.play();
    expect(f.engine.sample(1 / 60).onset).toBe(true);
    let repeats = 0; for (let i = 0; i < 120; i++) if (f.engine.sample(1 / 60).onset) repeats++;
    expect(repeats).toBe(0);
  });
});
describe('audio analysis', () => {
  it('normalizes bands and excludes DC with Nyquist-aware bounds', () => {
    const spectrum = new Uint8Array(512); spectrum[0] = 255;
    expect(calculateBandEnergy(spectrum, 20, 250, 48000)).toBe(0);
    spectrum.fill(255); expect(calculateBandEnergy(spectrum, 20, 250, 48000)).toBe(1);
    expect(calculateBandEnergy(spectrum, 30000, 40000, 48000)).toBe(0);
    expect(calculateBandEnergy(new Uint8Array(), 0, 10, 0)).toBe(0);
  });
  it('returns finite RMS for silent, empty, and invalid samples', () => {
    expect(calculateRMS(new Float32Array())).toBe(0);
    expect(calculateRMS(new Float32Array([NaN, Infinity]))).toBe(0);
    expect(calculateRMS(new Float32Array([0.5, -0.5]))).toBe(0.5);
  });
  it('has equal smoothing at 30, 60, and 120 Hz', () => {
    const values = [30, 60, 120].map((hz) => { let value = 0; for (let i = 0; i < hz; i++) value = smoothEnergy(value, 1, 1 / hz); return value; });
    expect(values[0]).toBeCloseTo(values[1], 12); expect(values[1]).toBeCloseTo(values[2], 12);
    expect(smoothEnergy(0.5, 1, NaN)).toBe(0.5);
  });
});
