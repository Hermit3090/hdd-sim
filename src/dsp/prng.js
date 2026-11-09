// Seeded random numbers (spec R4.4). One seed drives everything; each consumer
// takes its own numbered stream so that one layer never disturbs another.

/**
 * @param {number} seed
 * @param {number} [stream]
 * @returns {() => number} uniform values in [0, 1)
 */
export function makeRng(seed, stream = 0) {
  let a = ((seed >>> 0) ^ Math.imul((stream + 1) >>> 0, 0x9e3779b9)) >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
