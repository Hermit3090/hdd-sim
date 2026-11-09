// Spindle sound (spec 6.2): motor harmonics of the rotation frequency, a
// narrow bearing whine, and band-limited airflow noise. Pitch and level
// follow the rotation speed during spin-up and spin-down.

import { dbToGain } from './params.js';

const UNIFORM_VARIANCE = 1 / 3; // of white noise in [-1, 1)
const WHINE_Q = 60;

class BandNoise {
  constructor() {
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
    this.b0 = 0; this.a1 = 0; this.a2 = 0; this.norm = 0;
    this.key = -1;
  }

  // Band-pass with 0 dB peak gain, plus a factor that brings white noise
  // through it to unit RMS whatever the sample rate.
  tune(freq, q, sr) {
    const f = Math.min(Math.max(freq, 20), 0.45 * sr);
    const key = f * 1000 + q;
    if (key === this.key) return;
    this.key = key;
    const w = (2 * Math.PI * f) / sr;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - alpha) / a0;
    const noiseBandwidth = ((Math.PI / 2) * f) / q;
    this.norm = 1 / Math.sqrt((UNIFORM_VARIANCE * noiseBandwidth) / (sr / 2));
  }

  step(x) {
    const y = this.b0 * (x - this.x2) - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y * this.norm;
  }
}

export class Spindle {
  /**
   * @param {object} p spindle parameters
   * @param {number} rpm target speed
   * @param {number} sampleRate
   * @param {() => number} noise uniform values in [0, 1)
   */
  constructor(p, rpm, sampleRate, noise) {
    this.sr = sampleRate;
    this.noise = noise;
    this.state = 'stopped'; // stopped | up | ready | down
    this.speed = 0; // fraction of target speed
    this.ramp = 0; // seconds into the current ramp
    this.rampFrom = 0;
    this.phase = 0;
    this.air = new BandNoise();
    this.whine = new BandNoise();
    this.justReady = false;
    this.setParams(p, rpm);
  }

  setParams(p, rpm) {
    this.p = p;
    this.f0 = rpm / 60;
    this.motor = dbToGain(p.motorDb);
    this.whineGain = dbToGain(p.whineDb);
    this.noiseGain = dbToGain(p.noiseDb);
    this.harm = p.harmonics.map((h) => ({ n: h.n, g: dbToGain(h.db) }));
  }

  start(immediate = false) {
    if (immediate) {
      this.state = 'ready';
      this.speed = 1;
      return;
    }
    if (this.state === 'ready' || this.state === 'up') return;
    this.state = 'up';
    // Continue from the current speed if the drive was still spinning down.
    this.ramp = (1 - Math.sqrt(1 - this.speed)) * this.p.spinUpS;
  }

  stop(immediate = false) {
    if (immediate) {
      this.state = 'stopped';
      this.speed = 0;
      return;
    }
    if (this.state === 'stopped' || this.state === 'down') return;
    this.state = 'down';
    this.ramp = (1 - Math.sqrt(this.speed)) * this.p.spinDownS;
  }

  /** Writes n samples to out. Sets justReady when spin-up completes in this call. */
  process(out, n) {
    this.justReady = false;
    const sr = this.sr;
    const dt = n / sr;
    if (this.state === 'up') {
      this.ramp += dt;
      const x = Math.min(1, this.ramp / this.p.spinUpS);
      this.speed = 1 - (1 - x) * (1 - x);
      if (x >= 1) {
        this.state = 'ready';
        this.speed = 1;
        this.justReady = true;
      }
    } else if (this.state === 'down') {
      this.ramp += dt;
      const x = Math.min(1, this.ramp / this.p.spinDownS);
      this.speed = (1 - x) * (1 - x);
      if (x >= 1) {
        this.state = 'stopped';
        this.speed = 0;
      }
    }
    const speed = this.speed;
    if (this.state === 'stopped') {
      out.fill(0, 0, n);
      return;
    }

    const amp = Math.pow(speed, 1.5);
    const step = (2 * Math.PI * this.f0 * speed) / sr;
    const motor = this.motor * amp;
    const airGain = this.noiseGain * amp;
    const whineGain = this.whineGain * amp;
    const wobble = this.p.wobble;
    this.air.tune(this.p.noiseHz * speed, this.p.noiseQ, sr);
    this.whine.tune(this.p.whineHz * speed, WHINE_Q, sr);
    const harm = this.harm;
    const noise = this.noise;
    let phase = this.phase;
    for (let i = 0; i < n; i++) {
      phase += step;
      let s = 0;
      for (let h = 0; h < harm.length; h++) s += harm[h].g * Math.sin(harm[h].n * phase);
      s *= motor;
      // Both noise values are always drawn so the stream stays in step.
      const air = this.air.step(noise() * 2 - 1);
      const whine = this.whine.step(noise() * 2 - 1);
      s += airGain * (1 + wobble * Math.sin(phase)) * air + whineGain * whine;
      out[i] = s;
    }
    if (phase > 1e6) phase %= 2 * Math.PI;
    this.phase = phase;
  }
}

/**
 * A spindle recording that repeats without a seam (spec R10.3). The rotation
 * frequency is moved to the nearest value with a whole number of turns in the
 * loop, and the noise is made periodic by running one fixed noise sequence
 * through the filters twice and keeping the second pass.
 */
export function renderSpindleLoop(p, rpm, sampleRate, seconds, rng) {
  const n = Math.max(1, Math.round(seconds * sampleRate));
  const loopS = n / sampleRate;
  const f0 = Math.max(1, Math.round((rpm / 60) * loopS)) / loopS;
  const cycle = new Float64Array(2 * n);
  for (let i = 0; i < cycle.length; i++) cycle[i] = rng();
  let k = 0;
  const cyclic = () => {
    const v = cycle[k];
    k = k + 1 === cycle.length ? 0 : k + 1;
    return v;
  };
  const spindle = new Spindle(p, f0 * 60, sampleRate, cyclic);
  spindle.start(true);
  const out = new Float32Array(n);
  spindle.process(out, n);
  spindle.phase = 0; // n samples are a whole number of turns; drop rounding drift
  spindle.process(out, n);
  return out;
}
