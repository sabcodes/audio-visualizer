import type { AudioFrame } from './AudioEngine';

const SPECTRUM_TAU = 0.6, LEVEL_TAU = 0.45;
/**
 * Reduced motion: modes see audio with no onsets and with spectrum and levels smoothed over about half a second,
 * so beat-triggered events never fire and nothing flickers frame to frame. The waveform passes through unchanged.
 */
export class CalmAudio {
  private spectrum = new Float32Array(0);
  private primed = false;
  private readonly value: AudioFrame = { waveform: new Float32Array(0), spectrum: new Uint8Array(0), bass: 0, mid: 0, highs: 0, rms: 0, onset: false, time: 0 };
  reset() { this.primed = false; }
  update(audio: Readonly<AudioFrame>, seconds: number): Readonly<AudioFrame> {
    const out = this.value;
    if (this.spectrum.length !== audio.spectrum.length) { this.spectrum = new Float32Array(audio.spectrum.length); out.spectrum = new Uint8Array(audio.spectrum.length); this.primed = false; }
    const dt = Math.max(0, Math.min(Number.isFinite(seconds) ? seconds : 0, 0.1));
    // The first frame snaps to the input so turning reduced motion on does not fade in from silence.
    const spectrumK = this.primed ? 1 - Math.exp(-dt / SPECTRUM_TAU) : 1, levelK = this.primed ? 1 - Math.exp(-dt / LEVEL_TAU) : 1;
    for (let i = 0; i < audio.spectrum.length; i++) {
      this.spectrum[i] += (audio.spectrum[i] - this.spectrum[i]) * spectrumK;
      out.spectrum[i] = Math.round(this.spectrum[i]);
    }
    out.bass += (audio.bass - out.bass) * levelK;
    out.mid += (audio.mid - out.mid) * levelK;
    out.highs += (audio.highs - out.highs) * levelK;
    out.rms += (audio.rms - out.rms) * levelK;
    out.waveform = audio.waveform; out.time = audio.time; out.onset = false;
    this.primed = true;
    return out;
  }
}
