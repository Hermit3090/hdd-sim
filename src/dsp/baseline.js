// Idle baseline for live mode (spec R8.6-R8.8): rates each statistics sample
// as background or normal activity.

const RATE_WINDOW_S = 1;
const HISTORY_S = 120;
const WARMUP_S = 20;
const PERCENTILE = 0.9;
const FACTOR = 1.5;
const MAX_SAMPLES = 8192; // bounds memory if samples arrive faster than expected

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
    this.history = []; // {rate, dt}: operations-per-second values of the last two minutes
    this.historyS = 0;
    this.baseline = 0;
    this.rate = 0;
    this.background = false;
  }

  /**
   * Takes one statistics sample and rates it.
   * @param {number} ops operations in the sample
   * @param {number} dt seconds the sample covers
   * @returns {boolean} true if the sample is background activity
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

    const history = this.history;
    history.push({ rate: sum, dt });
    this.historyS += dt;
    while (history.length > 1 && (this.historyS - history[0].dt >= HISTORY_S || history.length > MAX_SAMPLES)) {
      this.historyS -= history.shift().dt;
    }

    const p = this.p;
    if (p.baselineMode === 'off') {
      this.baseline = 0;
      this.background = false;
    } else {
      this.baseline = p.baselineMode === 'adaptive' && this.historyS >= WARMUP_S
        ? Math.min(p.adaptiveCeiling, FACTOR * this.percentile())
        : p.baselineOps;
      this.background = sum <= this.baseline;
    }
    return this.background;
  }

  // Nearest-rank percentile of the stored operations-per-second values.
  percentile() {
    const values = Float64Array.from(this.history, (h) => h.rate).sort();
    return values[Math.max(0, Math.ceil(PERCENTILE * values.length) - 1)];
  }
}
