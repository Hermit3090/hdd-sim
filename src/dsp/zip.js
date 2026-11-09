// A minimal ZIP writer (stored, no compression) so the page can offer a set
// of WAV files as one download without any dependency.

let crcTable = null;

function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * @param {{name: string, data: Uint8Array}[]} files names must be ASCII
 * @returns {Uint8Array}
 */
export function makeZip(files) {
  const DOS_DATE = (2000 - 1980) << 9 | 1 << 5 | 1; // fixed, keeps output reproducible
  let size = 22;
  for (const f of files) size += 30 + 46 + 2 * f.name.length + f.data.length;
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  const central = [];
  let pos = 0;
  const name = (s) => { for (let i = 0; i < s.length; i++) out[pos++] = s.charCodeAt(i) & 0x7f; };

  for (const f of files) {
    const crc = crc32(f.data);
    central.push({ f, crc, offset: pos });
    v.setUint32(pos, 0x04034b50, true);
    v.setUint16(pos + 4, 20, true);
    v.setUint16(pos + 12, DOS_DATE, true);
    v.setUint32(pos + 14, crc, true);
    v.setUint32(pos + 18, f.data.length, true);
    v.setUint32(pos + 22, f.data.length, true);
    v.setUint16(pos + 26, f.name.length, true);
    pos += 30;
    name(f.name);
    out.set(f.data, pos);
    pos += f.data.length;
  }
  const centralStart = pos;
  for (const { f, crc, offset } of central) {
    v.setUint32(pos, 0x02014b50, true);
    v.setUint16(pos + 4, 20, true);
    v.setUint16(pos + 6, 20, true);
    v.setUint16(pos + 14, DOS_DATE, true);
    v.setUint32(pos + 16, crc, true);
    v.setUint32(pos + 20, f.data.length, true);
    v.setUint32(pos + 24, f.data.length, true);
    v.setUint16(pos + 28, f.name.length, true);
    v.setUint32(pos + 42, offset, true);
    pos += 46;
    name(f.name);
  }
  v.setUint32(pos, 0x06054b50, true);
  v.setUint16(pos + 8, files.length, true);
  v.setUint16(pos + 10, files.length, true);
  v.setUint32(pos + 12, pos - centralStart, true);
  v.setUint32(pos + 16, centralStart, true);
  return out;
}
