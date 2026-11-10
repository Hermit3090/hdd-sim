// The synth engine: activity -> drive model -> clicks + spindle -> mixer.
// Runs unchanged in the browser audio worklet and in Node (spec R4.2).

import { ActivityGenerator } from './activity.js';
import { Baseline } from './baseline.js';
import { ClickSynth } from './click.js';
import { DriveModel } from './drive-model.js';
import { FilterBank } from './filters.js';
import { SILENCE_DB, dbToGain } from './params.js';
import { makeRng } from './prng.js';
import { Spindle } from './spindle.js';

const CHUNK = 128;
const LIMIT_KNEE = 0.7;

/** Soft limiter (R6.13): linear below the knee, never beyond full scale. */
export function softLimit(x) {
  const a = Math.abs(x);
  if (a <= LIMIT_KNEE) return x;
  const y = LIMIT_KNEE + (1 - LIMIT_KNEE) * Math.tanh((a - LIMIT_KNEE) / (1 - LIMIT_KNEE));
  return x < 0 ? -y : y;
}

export class Engine {
  /**
   * @param {object} params a complete parameter object (see params.js)
   * @param {number} sampleRate
   */
  constructor(params, sampleRate) {
    this.sr = sampleRate;
    const seed = params.seed;
    this.rngModel = makeRng(seed, 1);
    this.rngClick = makeRng(seed, 2);
    this.rngActivity = makeRng(seed, 4);
    this.model = new DriveModel(params.drive, this.rngModel);
    this.model.ready = false;
    this.activity = new ActivityGenerator(params.sim, this.rngActivity);
    this.clicks = new ClickSynth(params.click, sampleRate);
    this.spindle = new Spindle(params.spindle, params.drive.rpm, sampleRate, makeRng(seed, 3));
    this.filters = new FilterBank(sampleRate);
    this.baseline = new Baseline(params.live);

    // Clicks are added into a ring that is read out as the head layer.
    let ringLen = 1024;
    while (ringLen < sampleRate) ringLen *= 2;
    this.ring = new Float32Array(ringLen);
    this.mask = ringLen - 1;
    this.ringPos = 0;

    this.pos = 0; // samples produced so far
    this.simEnabled = false;
    this.feeds = [];
    this.heldWrites = []; // sizes of simulated writes waiting for the next flush (R9.7)
    this.flushIn = 0;
    this.light = 0;
    this.lightSum = 0;
    this.lightCount = 0;
    this.head = new Float32Array(CHUNK);
    this.sp = new Float32Array(CHUNK);
    this.onSeek = (offsetS, dist, seekS, op) => this.scheduleSeek(offsetS, dist, seekS, op.write, op.bg);
    this.setParams(params);
  }

  setParams(params) {
    this.p = params;
    this.model.setParams(params.drive);
    this.activity.setParams(params.sim);
    this.clicks.setParams(params.click);
    this.spindle.setParams(params.spindle, params.drive.rpm);
    this.filters.setParams(params.filters);
    this.baseline.setParams(params.live);
    this.headGain = dbToGain(params.mix.headDb);
    this.spindleGain = dbToGain(params.mix.spindleDb);
    this.masterGain = dbToGain(params.mix.masterDb);
  }

  /** Simulated activity on or off (off in live mode). */
  setSimEnabled(on) {
    this.simEnabled = !!on;
    if (!on) this.activity.wait = 0;
    else this.baseline.reset(); // live history means nothing after a pause
  }

  /** Starts the spindle. With immediate = true it is at speed at once. */
  spinUp(immediate = false) {
    this.spindle.start(immediate);
    if (immediate) this.model.ready = true;
  }

  /** Parks the head and stops the spindle. */
  spinDown(immediate = false) {
    const wasSpinning = this.spindle.state !== 'stopped';
    this.model.ready = false;
    this.model.reset();
    this.feeds.length = 0;
    this.heldWrites.length = 0;
    this.spindle.stop(immediate);
    if (wasSpinning && !immediate) this.scheduleClick(0, 1, 0);
  }

  /** One seek on demand, for auditioning (R9.3). */
  triggerSeek(dist, write = false) {
    const d = Math.min(1, Math.max(0.001, dist));
    this.scheduleSeek(0, d, this.model.seekTimeS(d), write);
  }

  /**
   * Real activity for the coming interval (live mode, R8.4): `ops` operations
   * totalling `bytes`, spread evenly over `intervalS` seconds. `writes` of
   * them are write operations (R6.21). Every statistics sample must be fed,
   * also those without operations: the idle baseline is built from them (R8.6).
   */
  feed(ops, bytes, intervalS, writes = 0) {
    if (!(intervalS > 0)) return;
    const count = ops > 0 ? ops : 0;
    const bg = this.baseline.sample(count, intervalS);
    if (count === 0) return;
    this.feeds.push({
      left: count, size: Math.max(0, bytes) / count, rate: count / intervalS, acc: 0,
      writeShare: Math.min(1, Math.max(0, writes / count)), writeAcc: 0, bg,
    });
  }

  /** Mean light brightness (0..1) since the previous call. */
  takeLight() {
    const v = this.lightCount > 0 ? this.lightSum / this.lightCount : this.light;
    this.lightSum = 0;
    this.lightCount = 0;
    return v;
  }

  // R9.6: with the read/write pattern on, each type has its own spread and
  // writes stay within the write seek reach.
  drawDist(write = false) {
    const pattern = this.p.pattern;
    let spread = this.p.sim.seekSpread;
    let reach = 1;
    if (pattern.on) {
      spread = write ? pattern.writeSpread : pattern.readSpread;
      if (write) reach = pattern.writeReach;
    }
    if (this.rngModel() >= spread) return 0;
    return Math.max(0.005, Math.abs(this.rngModel() - this.rngModel()) * reach);
  }

  // R8.9: how far background treatment is lifted towards normal (0..1).
  bgLift() {
    return this.p.live.baselineMode === 'adaptive' ? this.baseline.level : 0;
  }

  scheduleClick(offsetSamples, dist, extraDb, pitch = 1) {
    const buf = this.clicks.render(dist, this.rngClick, extraDb, false, pitch);
    const room = this.ring.length - CHUNK - buf.length;
    const start = this.ringPos + Math.max(0, Math.min(Math.round(offsetSamples), room));
    const ring = this.ring;
    const mask = this.mask;
    for (let i = 0; i < buf.length; i++) ring[(start + i) & mask] += buf[i];
  }

  // R6.4: one click for a short seek; start and end clicks for a long one.
  // R6.20: in separate mode a write differs in pitch and level.
  // R8.9: background activity clicks at the background click level.
  scheduleSeek(offsetS, dist, seekS, write = false, bg = false) {
    const p = this.p;
    let db = 0;
    let pitch = 1;
    if (write && p.rw.mode === 'separate') {
      db += p.rw.writeLevelDb;
      pitch = 1 + p.rw.writePitchPct / 100;
    }
    if (bg) {
      const lift = this.bgLift();
      if (p.live.bgClickDb <= SILENCE_DB && lift <= 0) return;
      db += p.live.bgClickDb * (1 - lift);
    }
    const at = offsetS * this.sr;
    this.scheduleClick(at, dist, db, pitch);
    if (dist > p.click.pairThreshold) this.scheduleClick(at + seekS * this.sr, dist, db - 2, pitch);
  }

  // R6.10: the head leaves its parking position once the drive is at speed.
  scheduleUnlock() {
    this.scheduleClick(0, 1, 0);
    this.scheduleSeek(0.09, 0.5, this.model.seekTimeS(0.5));
    this.scheduleSeek(0.17, 0.15, this.model.seekTimeS(0.15));
    this.scheduleSeek(0.24, 0.8, this.model.seekTimeS(0.8));
  }

  /**
   * Renders the mix into out[offset .. offset + n).
   * The result does not depend on how calls are split.
   */
  process(out, offset = 0, n = out.length - offset) {
    let done = 0;
    while (done < n) {
      const c = Math.min(n - done, CHUNK - (this.pos % CHUNK));
      this.chunk(out, offset + done, c);
      done += c;
    }
  }

  /** Like process, but writes the two layers separately, before mix and limiter. */
  processLayers(head, spindle, n = head.length) {
    let done = 0;
    while (done < n) {
      const c = Math.min(n - done, CHUNK - (this.pos % CHUNK));
      this.chunk(null, 0, c);
      head.set(this.head.subarray(0, c), done);
      spindle.set(this.sp.subarray(0, c), done);
      done += c;
    }
  }

  chunk(out, offset, c) {
    const dt = c / this.sr;
    const model = this.model;

    if (this.simEnabled) {
      const hold = this.p.pattern.on;
      this.activity.advance(dt, (bytes, isWrite) => {
        if (hold && isWrite) this.heldWrites.push(bytes);
        else model.addOp(bytes, this.drawDist(isWrite), isWrite);
      });
      // R9.7: collected writes go to the drive together at every flush interval.
      this.flushIn = Math.min(this.flushIn, this.p.pattern.flushS) - dt;
      if (!hold || this.flushIn <= 0) {
        for (const bytes of this.heldWrites) model.addOp(bytes, this.drawDist(true), true);
        this.heldWrites.length = 0;
        if (this.flushIn <= 0) this.flushIn += this.p.pattern.flushS;
      }
    }
    for (let i = 0; i < this.feeds.length; i++) {
      const f = this.feeds[i];
      f.acc += f.rate * dt;
      let count = Math.min(f.left, Math.floor(f.acc));
      f.acc -= count;
      f.left -= count;
      while (count-- > 0) {
        f.writeAcc += f.writeShare;
        const isWrite = f.writeAcc >= 1 - 1e-9;
        if (isWrite) f.writeAcc -= 1;
        model.addOp(f.size, this.drawDist(isWrite), isWrite, f.bg);
      }
    }
    if (this.feeds.length > 0 && this.feeds[0].left <= 0) {
      this.feeds = this.feeds.filter((f) => f.left > 0);
    }

    const busyS = model.advance(dt, this.onSeek);

    const lp = this.p.light;
    let light = this.light;
    const bgS = model.bgBusy;
    const normalS = busyS - bgS;
    if (normalS > 0) light = 1 - (1 - light) * Math.exp(-normalS / (lp.onMs / 1000));
    if (bgS > 0) {
      // R8.9: background activity lifts the light to the background brightness only.
      const low = this.p.live.bgLightPct / 100;
      const target = low + (1 - low) * this.bgLift();
      if (light < target) light = target - (target - light) * Math.exp(-bgS / (lp.onMs / 1000));
      else light = Math.max(target, light * Math.exp(-bgS / (lp.offMs / 1000)));
    }
    if (dt - busyS > 0) light *= Math.exp(-(dt - busyS) / (lp.offMs / 1000));
    this.light = light;
    this.lightSum += light * c;
    this.lightCount += c;

    const head = this.head;
    const ring = this.ring;
    const mask = this.mask;
    let rp = this.ringPos;
    for (let i = 0; i < c; i++) {
      head[i] = ring[rp];
      ring[rp] = 0;
      rp = (rp + 1) & mask;
    }
    this.ringPos = rp;

    // R6.18: filters come before the mixer gains and the limiter.
    const filters = this.filters;
    filters.head(head, c);
    const sp = this.sp;
    const spindle = this.spindle;
    if (filters.spindleActive) {
      spindle.processParts(c);
      const { motor, air, whine } = spindle.parts;
      if (filters.spindleSplit) {
        filters.part('motor', motor, c);
        filters.part('air', air, c);
        filters.part('whine', whine, c);
      }
      for (let i = 0; i < c; i++) sp[i] = motor[i] + (air[i] + whine[i]);
      filters.layer('spindle', sp, c);
    } else {
      spindle.process(sp, c);
    }
    if (this.spindle.justReady) {
      model.ready = true;
      if (this.p.spindle.unlockClicks) this.scheduleUnlock();
    }

    if (out) {
      const hg = this.headGain;
      const sg = this.spindleGain;
      const mg = this.masterGain;
      for (let i = 0; i < c; i++) {
        out[offset + i] = softLimit(mg * (hg * head[i] + sg * sp[i]));
      }
    }
    this.pos += c;
  }
}
