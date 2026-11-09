// Simulated disk activity (spec R9.1): a stream of operations with a mean
// rate, grouped into bursts.

export class ActivityGenerator {
  /**
   * @param {object} sim simulation parameters
   * @param {() => number} rng
   */
  constructor(sim, rng) {
    this.sim = sim;
    this.rng = rng;
    this.wait = 0; // seconds until the next operation
    this.left = 0; // operations left in the current burst
  }

  setParams(sim) {
    const old = this.sim;
    this.sim = sim;
    // A pause drawn for a slower setting must not delay a faster one.
    if (sim.opsPerSec !== old.opsPerSec || sim.burstiness !== old.burstiness || sim.burstLen !== old.burstLen) {
      this.left = 0;
      if (sim.opsPerSec > 0) this.wait = Math.min(this.wait, 1 / sim.opsPerSec);
    }
  }

  /**
   * @param {number} dt seconds
   * @param {(bytes: number, isWrite: boolean) => void} emit
   */
  advance(dt, emit) {
    const sim = this.sim;
    if (sim.opsPerSec <= 0) {
      this.wait = 0;
      this.left = 0;
      return;
    }
    this.wait -= dt;
    let guard = 0;
    while (this.wait <= 0 && guard++ < 10000) {
      const bytes = sim.opSizeKB * 1024 * (0.5 + this.rng());
      emit(bytes, this.rng() >= sim.readMix);
      this.wait += this.nextInterval();
    }
  }

  nextInterval() {
    const sim = this.sim;
    const rate = sim.opsPerSec;
    const b = sim.burstiness;
    if (b <= 0.001) return 1 / rate;
    // The drive is fed during a fraction `duty` of the time, at a rate raised
    // to keep the mean rate; the rest is pauses between bursts.
    const duty = 1 - 0.97 * b;
    const inBurst = duty / rate;
    if (this.left > 0) {
      this.left--;
      return inBurst * (1 + b * (this.rng() - 0.5));
    }
    const exp = () => -Math.log(1 - this.rng());
    this.left = Math.max(1, Math.round(exp() * sim.burstLen)) - 1;
    return inBurst + exp() * (sim.burstLen / rate) * (1 - duty);
  }
}
