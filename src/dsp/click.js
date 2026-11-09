// Head click (spec 6.1): a short windowed noise burst rings a bank of damped
// two-pole resonators plus one low body resonator.

import { dbToGain } from './params.js';
import { makeRng } from './prng.js';

/** Longest click buffer in seconds. Keeps every click inside the 60 ms of R6.5. */
export const CLICK_MAX_S = 0.058;
const FADE_S = 0.004;
const PEAK_AT_0DB = 0.5;
const TILT_REF_HZ = 1500;

export class ClickSynth {
  constructor(clickParams, sampleRate) {
    this.sr = sampleRate;
    this.p = clickParams;
    this.maxLen = Math.floor(CLICK_MAX_S * sampleRate);
    this.exc = new Float64Array(this.maxLen);
    this.acc = new Float64Array(this.maxLen);
  }

  setParams(clickParams) {
    this.p = clickParams;
  }

  /**
   * One click as a new buffer. Starts at the first sample of the burst and
   * ends in exact silence.
   * @param {number} dist seek distance 0..1; sets level and brightness (R6.4)
   * @param {() => number} rng
   * @param {number} [extraDb] level offset
   * @param {boolean} [normalize] true: peak is exactly 1, level rules are skipped
   */
  render(dist, rng, extraDb = 0, normalize = false) {
    const p = this.p;
    const sr = this.sr;
    const d = Math.min(1, Math.max(0, dist));
    const vary = (range) => (rng() * 2 - 1) * range;

    const burstLen = Math.max(2, Math.round((p.burstMs / 1000) * sr));
    const voices = [];
    let longest = 0;
    const addVoice = (freq, decayMs, gain) => {
      if (gain <= 0) return;
      const f = Math.min(freq * (1 + vary(p.varFreqPct / 100)), 0.45 * sr);
      const decaySamples = Math.max(1, (decayMs * (1 + vary(p.varDecayPct / 100)) / 1000) * sr);
      const r = Math.exp(-Math.LN10 / decaySamples); // amplitude falls 20 dB per decay time
      const w = (2 * Math.PI * f) / sr;
      // sin(w) makes the ringing amplitude independent of frequency.
      voices.push({ a1: 2 * r * Math.cos(w), a2: -r * r, g: gain * Math.sin(w) });
      if (decaySamples > longest) longest = decaySamples;
    };
    for (const res of p.resonators) {
      const tiltDb = p.brightnessDb * (d - 0.5) * Math.log2(res.freq / TILT_REF_HZ);
      addVoice(res.freq, res.decayMs, dbToGain(res.gainDb) * Math.pow(10, tiltDb / 20));
    }
    addVoice(p.body.freq, p.body.decayMs, dbToGain(p.body.gainDb));

    // Long enough to ring down 60 dB, never longer than the hard limit.
    const n = Math.min(this.maxLen, burstLen + Math.ceil(3 * longest) + 1);
    const exc = this.exc;
    for (let i = 0; i < burstLen && i < n; i++) {
      const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / burstLen);
      exc[i] = (rng() * 2 - 1) * win;
    }
    const acc = this.acc;
    acc.fill(0, 0, n);
    for (const v of voices) {
      let y1 = 0;
      let y2 = 0;
      for (let i = 0; i < n; i++) {
        const y = (i < burstLen ? exc[i] : 0) + v.a1 * y1 + v.a2 * y2;
        y2 = y1;
        y1 = y;
        acc[i] += v.g * y;
      }
    }

    const fade = Math.min(n - 1, Math.round(FADE_S * sr));
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const left = n - 1 - i;
      if (left < fade) acc[i] *= 0.5 - 0.5 * Math.cos((Math.PI * left) / fade);
      const a = Math.abs(acc[i]);
      if (a > peak) peak = a;
    }

    const out = new Float32Array(n);
    if (peak === 0) return out;
    let level = 1;
    if (!normalize) {
      const levelDb = p.levelDb + (d - 1) * p.distLevelDb + vary(p.varLevelDb) + extraDb;
      level = PEAK_AT_0DB * Math.pow(10, levelDb / 20);
    }
    const scale = level / peak;
    for (let i = 0; i < n; i++) out[i] = acc[i] * scale;
    out[n - 1] = 0;
    return out;
  }
}

/** A click with no random variation, for auditioning and tests. */
export function renderPlainClick(clickParams, sampleRate, dist) {
  const plain = { ...clickParams, varFreqPct: 0, varLevelDb: 0, varDecayPct: 0 };
  return new ClickSynth(plain, sampleRate).render(dist, makeRng(12345, 99));
}
