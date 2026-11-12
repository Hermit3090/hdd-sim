// Drive model (spec section 5): a queue of operations served one at a time by
// an emulated mechanism. Produces seeks and a busy signal.

export class DriveModel {
  /**
   * @param {object} p drive parameters
   * @param {() => number} rng
   */
  constructor(p, rng) {
    this.p = p;
    this.rng = rng;
    this.queue = [];
    this.remaining = 0; // seconds left of the operation being served
    this.serving = false;
    this.servingBg = false;
    this.bgBusy = 0; // seconds of the last advance spent on background operations
    this.bgLevelBusy = 0; // the same seconds, each weighted by its operation's level
    this.servingLevel = 0;
    this.levelAt = () => 0; // R8.9: the activity level, read when service starts
    this.ready = true; // false while the spindle is not at speed
    this.idleS = 0;
    this.recalIn = -1;
  }

  setParams(p) {
    this.p = p;
    // R5.5: a smaller maximum applies to work already queued. The excess is
    // merged into the newest operation, which keeps its type (R6.21).
    const q = this.queue;
    const max = Math.max(1, p.queueMax);
    if (q.length > max) {
      const newest = q[q.length - 1];
      for (let i = max - 1; i < q.length - 1; i++) newest.bytes += q[i].bytes;
      q.splice(max - 1, q.length - max);
    }
  }

  get busy() {
    return this.serving;
  }

  /** Drops all work, e.g. when the drive spins down. */
  reset() {
    this.queue.length = 0;
    this.serving = false;
    this.remaining = 0;
    this.idleS = 0;
    this.recalIn = -1;
  }

  /**
   * Queues one operation (R5.1). When the queue is full the operation is
   * merged into the newest queued one (R5.5).
   * @param {number} bytes
   * @param {number} dist seek distance 0..1; 0 means sequential, no seek
   * @param {boolean} [write] a write operation (R6.21)
   * @param {boolean} [bg] background activity (R8.9)
   */
  addOp(bytes, dist, write = false, bg = false) {
    if (!this.ready) return;
    this.idleS = 0;
    this.recalIn = -1;
    const q = this.queue;
    if (q.length >= this.p.queueMax) {
      q[q.length - 1].bytes += bytes; // keeps the type of the operation it joins
      return;
    }
    q.push({ bytes, dist, write, bg });
  }

  seekTimeS(dist) {
    if (dist <= 0) return 0;
    const p = this.p;
    return (p.settleMs + (p.fullStrokeMs - p.settleMs) * Math.sqrt(Math.min(1, dist))) / 1000;
  }

  /**
   * Advances time by dt seconds.
   * @param {number} dt
   * @param {(offsetS: number, dist: number, seekS: number, op: object) => void} onSeek
   *   called for each seek that starts, with its start offset inside dt
   * @returns {number} seconds of dt during which the drive was busy
   */
  advance(dt, onSeek) {
    const p = this.p;
    let t = 0;
    let busy = 0;
    this.bgBusy = 0;
    this.bgLevelBusy = 0;
    while (t < dt) {
      if (this.serving) {
        const run = Math.min(this.remaining, dt - t);
        this.remaining -= run;
        busy += run;
        if (this.servingBg) {
          this.bgBusy += run;
          this.bgLevelBusy += run * this.servingLevel;
        }
        t += run;
        if (this.remaining <= 1e-12) this.serving = false;
        else break;
        continue;
      }
      if (this.ready && this.queue.length > 0) {
        this.start(this.queue.shift(), t, onSeek);
        continue;
      }
      // Idle for the rest of dt, unless a recalibration seek is due (R5.7).
      const rest = dt - t;
      if (!this.ready || !p.idleRecal) {
        this.idleS = 0;
        this.recalIn = -1;
        break;
      }
      if (this.recalIn < 0) {
        this.idleS += rest;
        if (this.idleS < p.idleAfterS) break;
        this.recalIn = p.recalMinS + this.rng() * (p.recalMaxS - p.recalMinS);
        break;
      }
      if (this.recalIn > rest) {
        this.recalIn -= rest;
        break;
      }
      t += this.recalIn;
      this.recalIn = p.recalMinS + this.rng() * (p.recalMaxS - p.recalMinS);
      this.start({ bytes: 0, dist: 0.2 + 0.6 * this.rng(), write: false, bg: false }, t, onSeek);
    }
    return busy;
  }

  start(op, offsetS, onSeek) {
    const p = this.p;
    const seekS = this.seekTimeS(op.dist);
    const rotationS = this.rng() * (60 / p.rpm); // R5.4 rotational wait
    // R5.4: one transfer is capped so that merged operations cannot keep the
    // drive busy long after the load has ended.
    const transferS = Math.min(op.bytes / (p.transferMBps * 1e6), p.maxTransferMs / 1000);
    this.remaining = seekS + rotationS + transferS;
    this.serving = true;
    this.servingBg = !!op.bg;
    this.servingLevel = op.bg ? this.levelAt() : 0;
    if (op.dist > 0) onSeek(offsetS, op.dist, seekS, op);
  }
}
