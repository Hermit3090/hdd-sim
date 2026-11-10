// Idle baseline for live mode (spec R8.6-R8.8): a threshold in manual mode,
// an activity level that ramps up and cools down in adaptive mode.

const RATE_WINDOW_S = 1;

export class Baseline {
  /** @param {object} live live-mode parameters */
  constructor(live) {
    this.p = live;
    this.reset();
  }

  setParams(live) {
    this.p = live;
  }

  reset() {
    this.recent = []; // {ops, dt} of the last second
    this.baseline = 0;
    this.rate = 0;
    this.background = false;
    this.level = 0; // adaptive mode: activity level 0..1 (R8.8)
  }

  /**
   * Takes one statistics sample and rates it.
   * @param {number} ops operations in the sample
   * @param {number} dt seconds the sample covers
   * @returns {boolean} true if the sample's operations get the background
   *   treatment of R8.9 (in adaptive mode: always, scaled by the level)
   */
  sample(ops, dt) {
    // R8.6: operations in the last second, this sample included.
    const recent = this.recent;
    recent.push({ ops, dt });
    let span = 0;
    let sum = 0;
    let first = recent.length;
    // The newest sample always counts; older ones while they fit in the window.
    while (first > 0 && (first === recent.length || span + recent[first - 1].dt <= RATE_WINDOW_S + 1e-9)) {
      first--;
      span += recent[first].dt;
      sum += recent[first].ops;
    }
    recent.splice(0, first);
    this.rate = sum;

    const p = this.p;
    if (p.baselineMode === 'adaptive') {
      // R8.8: up while there is activity, down while there is none.
      const step = ops > 0 ? dt / p.rampUpS : -dt / p.cooldownS;
      this.level = Math.min(1, Math.max(0, this.level + step));
      this.baseline = 0;
      this.background = true;
    } else if (p.baselineMode === 'manual') {
      this.level = 0;
      this.baseline = p.baselineOps;
      this.background = sum <= this.baseline;
    } else {
      this.level = 0;
      this.baseline = 0;
      this.background = false;
    }
    return this.background;
  }
}
