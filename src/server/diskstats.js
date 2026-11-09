// Reading Linux disk statistics for live mode (spec R8.2).

import { readFileSync, readdirSync } from 'node:fs';

const SECTOR_BYTES = 512; // /proc/diskstats always counts 512-byte sectors
// Virtual and stacked devices; counting them would double the physical disks.
const SKIP = /^(loop|ram|zram|dm-|md|sr|fd|nbd)/;

/**
 * Parses /proc/diskstats.
 * @param {string} text
 * @returns {Map<string, {reads: number, writes: number, bytesRead: number, bytesWritten: number}>}
 */
export function parseDiskstats(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f.length < 10) continue;
    map.set(f[2], {
      reads: Number(f[3]),
      bytesRead: Number(f[5]) * SECTOR_BYTES,
      writes: Number(f[7]),
      bytesWritten: Number(f[9]) * SECTOR_BYTES,
    });
  }
  return map;
}

/** Keeps whole physical disks only: names listed in /sys/block, minus virtual ones. */
export function wholeDisks(names) {
  return names.filter((n) => !SKIP.test(n)).sort();
}

/** Change between two samples as [reads, writes, bytesRead, bytesWritten]. */
export function delta(prev, cur) {
  const d = (a, b) => Math.max(0, b - a); // counters can wrap or reset
  return [
    d(prev.reads, cur.reads),
    d(prev.writes, cur.writes),
    d(prev.bytesRead, cur.bytesRead),
    d(prev.bytesWritten, cur.bytesWritten),
  ];
}

/**
 * Samples the system. Each call returns the change since the previous call
 * per whole disk, or null when statistics cannot be read (not Linux).
 */
export function createSampler({ statsPath = '/proc/diskstats', blockDir = '/sys/block' } = {}) {
  let prev = null;
  let disks = null;
  return function sample() {
    let stats;
    try {
      if (!disks) disks = wholeDisks(readdirSync(blockDir));
      stats = parseDiskstats(readFileSync(statsPath, 'utf8'));
    } catch {
      return null;
    }
    const devices = {};
    for (const name of disks) {
      const cur = stats.get(name);
      if (!cur) continue;
      const before = prev && prev.get(name);
      devices[name] = before ? delta(before, cur) : [0, 0, 0, 0];
    }
    prev = stats;
    return devices;
  };
}
