export function calculateRMS(waveform: Float32Array): number {
  if (!waveform.length) return 0;
  let sum = 0;
  for (const value of waveform) sum += Number.isFinite(value) ? value * value : 0;
  return Math.sqrt(sum / waveform.length);
}

export function calculateBandEnergy(spectrum: Uint8Array, low: number, high: number, sampleRate: number): number {
  if (!spectrum.length || !Number.isFinite(sampleRate) || sampleRate <= 0 || high <= low) return 0;
  const nyquist = sampleRate / 2;
  const start = Math.max(0, Math.ceil(Math.max(0, low) / nyquist * spectrum.length));
  const end = Math.min(spectrum.length, Math.ceil(Math.min(high, nyquist) / nyquist * spectrum.length));
  if (end <= start) return 0;
  let total = 0;
  for (let i = start; i < end; ++i) total += spectrum[i];
  return total / ((end - start) * 255);
}

/** Exponential smoothing has the same response at 30, 60, and 120 updates/sec. */
export function smoothEnergy(previous: number, target: number, delta: number, tau = 0.047): number {
  const dt = Number.isFinite(delta) ? Math.max(0, Math.min(delta, 1)) : 0;
  return previous + (target - previous) * (1 - Math.exp(-dt / tau));
}
