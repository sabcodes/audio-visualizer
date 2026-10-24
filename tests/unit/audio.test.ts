import { describe, expect, it, vi } from 'vitest';
import { AudioEngine, displayCaptureOptions, type DisplayCaptureOptions } from '../../src/audio/AudioEngine';
import { calculateBandEnergy, calculateRMS, logBin, smoothEnergy } from '../../src/audio/analysis';

class Media extends EventTarget {
  src = ''; preload = ''; currentTime = 0; duration = 12; error: { message: string } | null = null;
  play = vi.fn(async () => { this.dispatchEvent(new Event('play')); });
  pause = vi.fn(() => { this.dispatchEvent(new Event('pause')); });
  load = vi.fn();
  removeAttribute = vi.fn(() => { this.src = ''; });
}
class Track extends EventTarget {
  readyState: 'live' | 'ended' = 'live';
  constructor(readonly kind: 'audio' | 'video') { super(); }
  stop = vi.fn(() => { this.readyState = 'ended'; });
  /** What the browser does when the user clicks "Stop sharing". */
  end() { this.readyState = 'ended'; this.dispatchEvent(new Event('ended')); }
}
function fakeStream(kinds: ('audio' | 'video')[] = ['video', 'audio']) {
  const tracks = kinds.map((kind) => new Track(kind));
  return {
    tracks, getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((track) => track.kind === 'audio'),
    getVideoTracks: () => tracks.filter((track) => track.kind === 'video'),
  };
}
function setup(display: ((options: DisplayCaptureOptions) => Promise<MediaStream>) | null = null) {
  const media = new Media();
  let level = 128;
  const analyser = { fftSize: 0, smoothingTimeConstant: 1, connect: vi.fn(), disconnect: vi.fn(),
    getFloatTimeDomainData: vi.fn((buffer: Float32Array) => buffer.fill(0.5)),
    getByteFrequencyData: vi.fn((buffer: Uint8Array) => buffer.fill(level)),
  };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const liveNodes: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
  const context = { state: 'running', sampleRate: 48000, destination: {}, resume: vi.fn(async () => {}), close: vi.fn(async () => {}),
    createMediaElementSource: vi.fn(() => source), createAnalyser: vi.fn(() => analyser),
    createMediaStreamSource: vi.fn(() => { const node = { connect: vi.fn(), disconnect: vi.fn() }; liveNodes.push(node); return node; }),
  };
  let next = 0;
  const revokeURL = vi.fn();
  const createContext = vi.fn(() => context as unknown as AudioContext);
  const getDisplayMedia = display ? vi.fn(display) : null;
  const engine = new AudioEngine({ media: media as unknown as HTMLAudioElement, createContext, createURL: () => `blob:${++next}`, revokeURL, getDisplayMedia });
  const load = (name = 'tone.wav') => { engine.load({ name } as File); media.dispatchEvent(new Event('loadedmetadata')); };
  return { engine, media, source, analyser, context, createContext, revokeURL, load, getDisplayMedia, liveNodes, level: (value: number) => { level = value; } };
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
    expect(f.context.createMediaElementSource).toHaveBeenCalledOnce();
    expect(f.source.connect.mock.calls).toEqual([[f.analyser], [f.context.destination]]);
    expect(f.analyser.connect).not.toHaveBeenCalled(); expect(f.analyser.fftSize).toBe(1024); expect(f.analyser.smoothingTimeConstant).toBe(0);
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
    const f = setup(); f.load(); f.source.connect.mockImplementationOnce(() => { throw new Error('connection failed'); });
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
describe('system audio source', () => {
  const live = (kinds?: ('audio' | 'video')[]) => {
    const streams: ReturnType<typeof fakeStream>[] = [];
    const f = setup(async () => { const stream = fakeStream(kinds); streams.push(stream); return stream as unknown as MediaStream; });
    return { ...f, streams };
  };
  it('requests display capture with system audio and unprocessed audio', async () => {
    const f = live(); await f.engine.listen();
    expect(f.getDisplayMedia).toHaveBeenCalledExactlyOnceWith(displayCaptureOptions);
    expect(displayCaptureOptions).toMatchObject({ video: true, systemAudio: 'include', windowAudio: 'system', selfBrowserSurface: 'exclude',
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  });
  it('drops video, feeds the shared analyser once, and never reaches the speakers', async () => {
    const f = live(); await f.engine.listen();
    const [video, audio] = f.streams[0].tracks;
    expect(video.stop).toHaveBeenCalledOnce(); expect(audio.stop).not.toHaveBeenCalled();
    expect(f.liveNodes).toHaveLength(1); expect(f.liveNodes[0].connect).toHaveBeenCalledExactlyOnceWith(f.analyser);
    expect(f.analyser.connect).not.toHaveBeenCalled(); expect(f.analyser.fftSize).toBe(1024);
    expect(f.engine.state).toMatchObject({ status: 'playing', source: 'system', notice: null });
    expect(f.engine.sample(1 / 60).bass).toBeGreaterThan(0);
  });
  it('releases tracks and nodes on stop, with no duplicate graph after repeated starts', async () => {
    const f = live();
    for (let i = 0; i < 3; i++) { await f.engine.listen(); await f.engine.listen(); f.engine.stopListening(); }
    expect(f.createContext).toHaveBeenCalledOnce(); expect(f.context.createAnalyser).toHaveBeenCalledOnce();
    expect(f.liveNodes).toHaveLength(6);
    for (const node of f.liveNodes) { expect(node.connect).toHaveBeenCalledOnce(); expect(node.disconnect).toHaveBeenCalledOnce(); }
    for (const stream of f.streams) for (const track of stream.tracks) expect(track.readyState).toBe('ended');
    expect(f.engine.state).toMatchObject({ status: 'empty', source: 'file' }); expect(f.engine.sample(1 / 60).rms).toBe(0);
  });
  it('explains a share without audio and leaves the file player alone', async () => {
    const f = live(['video']); f.load(); await f.engine.listen();
    expect(f.streams[0].tracks[0].stop).toHaveBeenCalled(); expect(f.context.createMediaStreamSource).not.toHaveBeenCalled();
    expect(f.engine.state).toMatchObject({ status: 'ready', source: 'file', trackName: 'tone.wav' });
    expect(f.engine.state.notice).toMatch(/Also share system audio/);
  });
  it('returns to the paused file when the user clicks Stop sharing', async () => {
    const f = live(); f.load(); await f.engine.play(); f.media.currentTime = 4; await f.engine.listen();
    expect(f.media.pause).toHaveBeenCalled(); f.engine.seek(1); f.engine.pause(); expect(f.media.currentTime).toBe(4);
    f.streams[0].tracks[1].end();
    expect(f.liveNodes[0].disconnect).toHaveBeenCalledOnce();
    expect(f.engine.state).toMatchObject({ status: 'paused', source: 'file', trackName: 'tone.wav', currentTime: 4 });
    expect(f.engine.state.notice).toMatch(/Stopped listening/);
    await f.engine.play(); expect(f.engine.state.status).toBe('playing'); expect(f.engine.state.notice).toBeNull();
  });
  it('maps denied, cancelled, and unsupported capture to guidance', async () => {
    const denied = setup(async () => { throw new DOMException('Permission denied by system', 'NotAllowedError'); });
    await denied.engine.listen(); expect(denied.engine.state.notice).toMatch(/Screen & System Audio Recording/);
    const cancelled = setup(async () => { throw new DOMException('Permission denied', 'NotAllowedError'); });
    await cancelled.engine.listen(); expect(cancelled.engine.state.notice).toMatch(/cancelled/);
    expect(cancelled.engine.state).toMatchObject({ status: 'empty', source: 'file', error: null });
    const background = setup(async () => { throw new DOMException('Invalid state', 'InvalidStateError'); });
    await background.engine.listen(); expect(background.engine.state.notice).toMatch(/focused tab/);
    const missing = setup(null); expect(missing.engine.systemAudioSupported).toBe(false);
    await missing.engine.listen(); expect(missing.engine.state.notice).toMatch(/can't capture/);
  });
  it('stops a stream that arrives after a file was loaded', async () => {
    const stream = fakeStream(); let grant!: (value: MediaStream) => void;
    const f = setup(() => new Promise((ok) => { grant = ok; }));
    const listening = f.engine.listen(); f.load(); grant(stream as unknown as MediaStream); await listening;
    expect(stream.tracks.every((track) => track.readyState === 'ended')).toBe(true);
    expect(f.context.createMediaStreamSource).not.toHaveBeenCalled(); expect(f.engine.state.source).toBe('file');
  });
  it('loading a file or disposing releases the live source', async () => {
    const f = live(); await f.engine.listen(); f.load();
    expect(f.liveNodes[0].disconnect).toHaveBeenCalledOnce(); expect(f.engine.state).toMatchObject({ source: 'file', status: 'ready' });
    await f.engine.listen(); await f.engine.dispose();
    expect(f.liveNodes[1].disconnect).toHaveBeenCalledOnce(); expect(f.streams[1].tracks[1].readyState).toBe('ended');
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

describe('logBin', () => {
  it('maps the ends of the range to 30 Hz and 16 kHz bins', () => {
    expect(logBin(0, 512, 48000)).toBe(Math.floor(30 / 24000 * 512));
    expect(logBin(1, 512, 48000)).toBe(341);
  });
  it('is monotonic non-decreasing', () => {
    const bins = Array.from({ length: 100 }, (_, i) => logBin(i / 99, 512, 48000));
    expect(bins.every((bin, i) => i === 0 || bin >= bins[i - 1])).toBe(true);
  });
  it('returns bin 0 for a non-finite sample rate', () => {
    expect(logBin(0.5, 512, Number.NaN)).toBe(0);
  });
});
