import type { AudioFrame } from './AudioEngine';
import type { VisualResponse } from '../modes/types';

const clamp = (value: number, high = 1) => Math.max(0, Math.min(high, Number.isFinite(value) ? value : 0));
/** Scene-referred motion response, independent of exposure and playback volume. */
export class ResponseEnvelope {
  private bassMean = 0;
  private rmsMean = 0;
  private previousTime = 0;
  private cooldown = 0;
  private readonly value: VisualResponse = { bass: 0, loudness: 0, impact: 0, bounce: 0 };
  reset() {
    this.bassMean = this.rmsMean = this.cooldown = this.previousTime = 0;
    this.value.bass = this.value.loudness = this.value.impact = this.value.bounce = 0;
  }
  update(audio: Readonly<AudioFrame>, seconds: number, sensitivity = 1.8, reducedMotion = false): Readonly<VisualResponse> {
    const dt = clamp(seconds, 0.1);
    const gain = Math.max(0.25, clamp(sensitivity, 4));
    const bass = clamp(audio.bass), rms = clamp(audio.rms);
    if (audio.time < this.previousTime || audio.time - this.previousTime > 0.5) this.reset();
    this.previousTime = audio.time;
    if (bass === 0 && rms === 0) {
      this.reset();
      this.previousTime = audio.time;
      return this.value;
    }
    const bassRise = Math.max(0, bass - this.bassMean);
    const rmsRise = Math.max(0, rms - this.rmsMean);
    this.cooldown = Math.max(0, this.cooldown - dt);
    const impulse = clamp((bassRise * 2.5 + rmsRise * 3.5) * gain);
    const hit = this.cooldown === 0 && (audio.onset || impulse > 0.14);
    this.value.impact *= Math.exp(-dt / 0.13);
    if (hit) { this.value.impact = Math.max(this.value.impact, impulse, audio.onset ? 0.65 : 0); this.cooldown = 0.14; }
    const adapt = 1 - Math.exp(-dt / 0.14);
    this.bassMean += (bass - this.bassMean) * adapt;
    this.rmsMean += (rms - this.rmsMean) * adapt;
    // Remove the static bass floor from the swell; transient envelope supplies the kick.
    this.value.bass = clamp((bass * 0.35 + bassRise * 2.4) * gain);
    this.value.loudness = clamp(Math.sqrt(rms) * gain * 0.85);
    this.value.bounce = clamp((this.value.bass * 0.35 + this.value.loudness * 0.18 + this.value.impact * 0.85) * (reducedMotion ? 0.2 : 1), 1.4);
    return this.value;
  }
}
