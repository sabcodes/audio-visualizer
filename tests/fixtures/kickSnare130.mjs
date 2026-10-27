// Writes a 130 BPM kick/snare/hat loop (60 s, 48 kHz mono WAV) for headed mode captures:
//   node tests/fixtures/kickSnare130.mjs [out.wav]
// Kick on every beat, snare on 2 and 4, closed hats on the eighths; a quieter 8-bar intro then a louder drop,
// so section changes fire too. WAV files stay local (.gitignore), so the fixture is generated, not committed.
import { writeFileSync } from 'node:fs';

const rate = 48000, seconds = 60, bpm = 130, beat = 60 / bpm, samples = new Float32Array(rate * seconds);
let seed = 7;
const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 31 - 1; };
const add = (start, length, voice) => { for (let i = 0; i < length && start + i < samples.length; i++) samples[start + i] += voice(i / rate); };
for (let t = 0, n = 0; t < seconds; t += beat / 2, n++) {
  const at = Math.round(t * rate), drop = t > beat * 32 ? 1 : 0.55;
  if (n % 2 === 0) add(at, rate * 0.35, (s) => Math.sin(2 * Math.PI * (45 * s + 90 * (1 - Math.exp(-s * 30)) / 30)) * Math.exp(-s * 9) * 0.9 * drop);
  if (n % 4 === 2) add(at, rate * 0.25, (s) => (noise() * 0.7 + Math.sin(2 * Math.PI * 190 * s) * 0.3) * Math.exp(-s * 16) * 0.7 * drop);
  add(at, rate * 0.05, (s) => noise() * Math.exp(-s * 90) * 0.18 * drop);
  // A bass note under each bar after the drop.
  if (drop === 1 && n % 8 === 0) add(at, Math.round(beat * 4 * rate), (s) => Math.sin(2 * Math.PI * 55 * s) * 0.25 * Math.min(1, s * 40));
}
const pcm = Buffer.alloc(44 + samples.length * 2);
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + samples.length * 2, 4); pcm.write('WAVEfmt ', 8);
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(rate, 24); pcm.writeUInt32LE(rate * 2, 28);
pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(samples.length * 2, 40);
samples.forEach((v, i) => pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
writeFileSync(process.argv[2] ?? 'kick-snare-130.wav', pcm);
