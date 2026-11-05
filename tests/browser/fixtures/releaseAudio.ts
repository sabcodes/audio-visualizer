// 30 seconds of PCM is enough for replacement/seek/replay without retaining media files.
export function tone(name = 'release.wav') {
  const rate = 8000, samples = rate * 30, buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(4000 * Math.sin(i * Math.PI * 220 / rate)), 44 + i * 2);
  return { name, mimeType: 'audio/wav', buffer };
}
