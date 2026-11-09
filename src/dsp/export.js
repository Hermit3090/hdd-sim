// Export (spec section 10). The page and the command line both call these
// functions, so identical parameters give identical files (R10.5).

import { ClickSynth } from './click.js';
import { Engine, softLimit } from './engine.js';
import { dbToGain, sanitizeParams, scenarioParams } from './params.js';
import { makeRng } from './prng.js';
import { renderSpindleLoop } from './spindle.js';
import { encodeWav } from './wav.js';

export const ONE_SHOT_MAX_S = 0.06;
export const ONE_SHOT_PEAK = Math.pow(10, -1 / 20); // -1 dBFS
const ONSET_RATIO = 0.01; // the onset is the first sample within 40 dB of the peak
const PRE_ROLL_S = 0.0002;
const TAIL_ZEROS = 16;

export const SEQUENCE_NAMES = ['burst', 'spinup', 'spindown', 'spindle_loop', 'idle'];

/**
 * One-shot clicks (R10.2): head layer only, trimmed to the onset, peak at
 * -1 dBFS, ending in digital silence, at most 60 ms.
 * @returns {{name: string, samples: Float32Array}[]}
 */
export function renderClickSet(input) {
  const p = sanitizeParams(input);
  const sr = p.export.sampleRate;
  const synth = new ClickSynth(p.click, sr);
  const rng = makeRng(p.seed, 10);
  const count = p.export.clickCount;
  const maxLen = Math.floor(ONE_SHOT_MAX_S * sr);
  const files = [];
  for (let i = 0; i < count; i++) {
    const frac = count === 1 ? 1 : i / (count - 1);
    const dist = p.export.distMin + (p.export.distMax - p.export.distMin) * frac;
    const raw = synth.render(dist, rng, 0, true);
    let onset = 0;
    while (onset < raw.length && Math.abs(raw[onset]) < ONSET_RATIO) onset++;
    const start = Math.max(0, onset - Math.round(PRE_ROLL_S * sr));
    const len = Math.min(maxLen, raw.length - start + TAIL_ZEROS);
    const samples = new Float32Array(len);
    const copy = Math.min(len - TAIL_ZEROS, raw.length - start);
    for (let k = 0; k < copy; k++) samples[k] = raw[start + k] * ONE_SHOT_PEAK;
    files.push({ name: `click_${String(i + 1).padStart(2, '0')}.wav`, samples });
  }
  return files;
}

/**
 * One sequence (R10.3). Head, spindle and master gains apply.
 * @param {'burst'|'spinup'|'spindown'|'spindle_loop'|'idle'} kind
 * @returns {Float32Array}
 */
export function renderSequence(kind, input) {
  const p = sanitizeParams(input);
  const sr = p.export.sampleRate;
  const render = (engine, seconds) => {
    const out = new Float32Array(Math.round(seconds * sr));
    engine.process(out);
    return out;
  };
  switch (kind) {
    case 'burst': {
      p.sim = scenarioParams(p.export.burstScenario);
      const engine = new Engine(p, sr);
      engine.spinUp(true);
      engine.setSimEnabled(true);
      return render(engine, p.export.burstSeconds);
    }
    case 'spinup': {
      const engine = new Engine(p, sr);
      engine.spinUp();
      return render(engine, p.spindle.spinUpS + 1.5);
    }
    case 'spindown': {
      const engine = new Engine(p, sr);
      engine.spinUp(true);
      const lead = render(engine, 0.5);
      engine.spinDown();
      const tail = render(engine, p.spindle.spinDownS + 0.5);
      const out = new Float32Array(lead.length + tail.length);
      out.set(lead, 0);
      out.set(tail, lead.length);
      return out;
    }
    case 'spindle_loop': {
      const loop = renderSpindleLoop(p.spindle, p.drive.rpm, sr, p.export.loopSeconds, makeRng(p.seed, 11));
      const gain = dbToGain(p.mix.masterDb) * dbToGain(p.mix.spindleDb);
      for (let i = 0; i < loop.length; i++) loop[i] = softLimit(gain * loop[i]);
      return loop;
    }
    case 'idle': {
      const engine = new Engine(p, sr);
      engine.spinUp(true);
      return render(engine, p.export.idleSeconds);
    }
    default:
      throw new Error(`unknown sequence: ${kind}`);
  }
}

/** The one-shot set as WAV files. */
export function exportClicks(input) {
  const p = sanitizeParams(input);
  return renderClickSet(p).map((f) => ({ name: f.name, data: encodeWav(f.samples, p.export.sampleRate) }));
}

/** One sequence as a WAV file. */
export function exportSequence(kind, input) {
  const p = sanitizeParams(input);
  return { name: `${kind}.wav`, data: encodeWav(renderSequence(kind, p), p.export.sampleRate) };
}

/** Every export as WAV files. */
export function exportAll(input) {
  const p = sanitizeParams(input);
  return [...exportClicks(p), ...SEQUENCE_NAMES.map((kind) => exportSequence(kind, p))];
}
