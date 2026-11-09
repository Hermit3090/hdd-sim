// WAV encoding and decoding: mono, 16-bit PCM (spec R10.1).

/**
 * @param {Float32Array} samples values in [-1, 1]
 * @param {number} sampleRate
 * @returns {Uint8Array}
 */
export function encodeWav(samples, sampleRate) {
  const dataBytes = samples.length * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const v = new DataView(bytes.buffer);
  const tag = (pos, s) => { for (let i = 0; i < 4; i++) bytes[pos + i] = s.charCodeAt(i); };
  tag(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, 'data');
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, Math.round(x * 32767), true);
  }
  return bytes;
}

/** Reads a file written by encodeWav. */
export function decodeWav(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (pos) => String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
  if (text(0) !== 'RIFF' || text(8) !== 'WAVE' || text(36) !== 'data') throw new Error('not a hdd-sim WAV file');
  const count = v.getUint32(40, true) / 2;
  const samples = new Int16Array(count);
  for (let i = 0; i < count; i++) samples[i] = v.getInt16(44 + i * 2, true);
  return {
    format: v.getUint16(20, true),
    channels: v.getUint16(22, true),
    sampleRate: v.getUint32(24, true),
    bitsPerSample: v.getUint16(34, true),
    samples,
  };
}
