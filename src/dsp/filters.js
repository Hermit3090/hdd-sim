// Filters (spec 6.5): a high-pass and a low-pass per sound part, or one of
// each for all parts together. Every filter that is off is skipped entirely,
// so it leaves the signal bit for bit unchanged (R6.17).

export const SOUND_PARTS = ['head', 'motor', 'air', 'whine'];
const SPINDLE_PARTS = ['motor', 'air', 'whine'];

// Q of each second-order stage of a Butterworth filter. Resonance raises the
// Q of the last stage, which lifts the response at the cutoff by that amount.
const STAGE_Q = { 12: [Math.SQRT1_2], 24: [0.5411961, 1.3065630] };

const SETTLED = 1e-9;

class Biquad {
  constructor() {
    this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0;
    this.z1 = 0; this.z2 = 0;
  }

  // RBJ cookbook low-pass / high-pass.
  set(type, hz, q, sr) {
    const w = (2 * Math.PI * Math.min(Math.max(hz, 10), 0.45 * sr)) / sr;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    if (type === 'hp') {
      this.b0 = (1 + cos) / 2 / a0;
      this.b1 = -(1 + cos) / a0;
    } else {
      this.b0 = (1 - cos) / 2 / a0;
      this.b1 = (1 - cos) / a0;
    }
    this.b2 = this.b0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  // Transposed direct form II, in place.
  run(buf, n) {
    const { b0, b1, b2, a1, a2 } = this;
    let z1 = this.z1;
    let z2 = this.z2;
    for (let i = 0; i < n; i++) {
      const x = buf[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      buf[i] = y;
    }
    // Once the ringing is below -180 dB the filter is reset, so that silence
    // going in becomes exact silence coming out (R6.6) and no denormals remain.
    const quiet = Math.abs(z1) < SETTLED && Math.abs(z2) < SETTLED;
    this.z1 = quiet ? 0 : z1;
    this.z2 = quiet ? 0 : z2;
  }
}

/** One high-pass or low-pass (R6.15). */
export class Filter {
  /** @param {'hp'|'lp'} type */
  constructor(type, sampleRate) {
    this.type = type;
    this.sr = sampleRate;
    this.on = false;
    this.stages = [];
    this.key = '';
  }

  /** @param {{on: boolean, hz: number, resDb: number, slope: number}} f */
  setParams(f) {
    if (!f.on) {
      this.on = false;
      this.stages.length = 0; // forget the state; switching on starts clean
      this.key = '';
      return;
    }
    this.on = true;
    const key = `${f.hz}/${f.resDb}/${f.slope}`;
    if (key === this.key) return;
    this.key = key;
    const qs = STAGE_Q[f.slope] || STAGE_Q[12];
    while (this.stages.length < qs.length) this.stages.push(new Biquad());
    this.stages.length = qs.length;
    qs.forEach((q, i) => {
      const boost = i === qs.length - 1 ? Math.pow(10, f.resDb / 20) : 1;
      this.stages[i].set(this.type, f.hz, q * boost, this.sr);
    });
  }

  run(buf, n) {
    if (!this.on) return;
    for (const stage of this.stages) stage.run(buf, n);
  }
}

/**
 * All filters of one signal chain. `part` applies the filters that belong to
 * one sound part (separate mode), `layer` the filters shared by all parts
 * (combined mode). A combined filter is one setting; it runs once on the head
 * layer and once on the spindle layer, which is the same as running it on
 * their sum but keeps the layers apart for the mixer (R6.18, R6.12).
 */
export class FilterBank {
  constructor(sampleRate) {
    this.own = {};
    for (const name of SOUND_PARTS) {
      this.own[name] = { hp: new Filter('hp', sampleRate), lp: new Filter('lp', sampleRate) };
    }
    this.shared = {};
    for (const name of ['head', 'spindle']) {
      this.shared[name] = { hp: new Filter('hp', sampleRate), lp: new Filter('lp', sampleRate) };
    }
    this.headActive = false;
    this.spindleSplit = false;
  }

  setParams(filters) {
    const off = { on: false };
    for (const type of ['hp', 'lp']) {
      const separate = filters[`${type}Mode`] === 'separate';
      for (const name of SOUND_PARTS) this.own[name][type].setParams(separate ? filters[type][name] : off);
      for (const name of ['head', 'spindle']) this.shared[name][type].setParams(separate ? off : filters[type].all);
    }
    const any = (set) => set.hp.on || set.lp.on;
    this.headActive = any(this.own.head) || any(this.shared.head);
    this.spindleSplit = SPINDLE_PARTS.some((name) => any(this.own[name]));
    this.spindleActive = this.spindleSplit || any(this.shared.spindle);
  }

  /** Filters of one sound part, in place. */
  part(name, buf, n) {
    const set = this.own[name];
    set.hp.run(buf, n);
    set.lp.run(buf, n);
  }

  /** Filters shared by all parts, in place. @param {'head'|'spindle'} name */
  layer(name, buf, n) {
    const set = this.shared[name];
    set.hp.run(buf, n);
    set.lp.run(buf, n);
  }

  /** The whole head chain. */
  head(buf, n) {
    if (!this.headActive) return;
    this.part('head', buf, n);
    this.layer('head', buf, n);
  }
}
