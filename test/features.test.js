// Tests for filters (spec 6.5), read and write sound (6.6), the idle baseline
// (R8.6-R8.9) and the export additions (R6.19, R10.6).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Baseline } from '../src/dsp/baseline.js';
import { ClickSynth } from '../src/dsp/click.js';
import { DriveModel } from '../src/dsp/drive-model.js';
import { Engine } from '../src/dsp/engine.js';
import { exportClicks, renderClickSet, renderSequence } from '../src/dsp/export.js';
import { Filter } from '../src/dsp/filters.js';
import {
  FILTER_TARGETS, PRESET_NAMES, applyPreset, defaultParams, sanitizeParams, scenarioParams,
} from '../src/dsp/params.js';
import { makeRng } from '../src/dsp/prng.js';

const SR = 48000;
const PARTS = ['head', 'motor', 'air', 'whine'];

/** Defaults with the filters and the read/write pattern off; each is tested on its own. */
function base(preset = 'laptop-2000s') {
  const p = defaultParams(preset);
  p.pattern.on = false;
  p.filters.hpMode = 'combined';
  p.filters.lpMode = 'combined';
  for (const type of ['hp', 'lp']) for (const target of FILTER_TARGETS) p.filters[type][target].on = false;
  return p;
}

function thrash(edit) {
  const p = base();
  p.sim = scenarioParams('thrash');
  if (edit) edit(p);
  const engine = new Engine(sanitizeParams(p), SR);
  engine.spinUp(true);
  engine.setSimEnabled(true);
  return engine;
}

function render(engine, seconds = 1) {
  const out = new Float32Array(Math.round(seconds * SR));
  engine.process(out);
  return out;
}

function layers(engine, seconds = 1) {
  const head = new Float32Array(Math.round(seconds * SR));
  const spindle = new Float32Array(head.length);
  engine.processLayers(head, spindle);
  return { head, spindle };
}

/** Gain in dB of a filter for a sine at `hz`, measured after it has settled. */
function gainDb(settings, type, hz) {
  const filter = new Filter(type, SR);
  filter.setParams(settings);
  const n = SR;
  const buf = new Float64Array(n);
  for (let i = 0; i < n; i++) buf[i] = Math.sin((2 * Math.PI * hz * i) / SR);
  filter.run(buf, n);
  let sum = 0;
  for (let i = n / 2; i < n; i++) sum += buf[i] * buf[i];
  return 10 * Math.log10(sum / (n / 2) / 0.5); // relative to a full-scale sine
}

/** Level in dB of the component at `hz`. */
function toneDb(samples, hz) {
  let re = 0;
  let im = 0;
  for (let i = 0; i < samples.length; i++) {
    re += samples[i] * Math.cos((2 * Math.PI * hz * i) / SR);
    im += samples[i] * Math.sin((2 * Math.PI * hz * i) / SR);
  }
  return 20 * Math.log10((2 * Math.hypot(re, im)) / samples.length + 1e-12);
}

const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
const peakOf = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

// ---------- filters ----------

test('R6.15: high-pass and low-pass with cutoff, 12 or 24 dB per octave, and a resonance boost at the cutoff', () => {
  for (const [type, far, pass] of [['hp', 250, 8000], ['lp', 4000, 100]]) {
    const base = { on: true, hz: 1000, resDb: 0, slope: 12 };
    assert.ok(Math.abs(gainDb(base, type, pass)) < 0.2, `${type}: pass band is flat`);
    assert.ok(Math.abs(gainDb(base, type, 1000) + 3) < 0.3, `${type}: -3 dB at the cutoff`);
    // Two octaves into the stop band.
    assert.ok(Math.abs(gainDb(base, type, far) + 24) < 1.5, `${type}: 12 dB per octave`);
    assert.ok(Math.abs(gainDb({ ...base, slope: 24 }, type, far) + 48) < 2.5, `${type}: 24 dB per octave`);
    for (const slope of [12, 24]) {
      const flat = gainDb({ ...base, slope }, type, 1000);
      const boosted = gainDb({ ...base, slope, resDb: 12 }, type, 1000);
      assert.ok(Math.abs(boosted - flat - 12) < 0.3, `${type} ${slope}: resonance lifts the cutoff by 12 dB`);
      assert.ok(Math.abs(gainDb({ ...base, slope, resDb: 12 }, type, pass)) < 0.3, `${type} ${slope}: pass band stays flat`);
    }
  }
});

test('R6.17: preset filter defaults; a filter that is off changes nothing', () => {
  const on = (hz, resDb = 0) => ({ on: true, hz, resDb, slope: 12 });
  const off = (hz) => ({ on: false, hz, resDb: 0, slope: 12 });
  const laptop = defaultParams('laptop-2000s').filters;
  assert.deepEqual([laptop.hpMode, laptop.lpMode], ['combined', 'combined']);
  assert.deepEqual(laptop.hp.all, on(150));
  assert.deepEqual(laptop.lp.all, on(4000));
  for (const part of PARTS) {
    assert.deepEqual(laptop.hp[part], off(150));
    assert.deepEqual(laptop.lp[part], off(4000));
  }
  for (const preset of ['desktop-90s', 'desktop-90s-2']) {
    const f = defaultParams(preset).filters;
    assert.deepEqual([f.hpMode, f.lpMode], ['combined', 'separate']);
    assert.deepEqual(f.hp.all, on(150));
    assert.deepEqual(f.lp, { all: off(4000), head: on(3606, 1.5), motor: on(5848), air: on(9100), whine: on(1897) });
    for (const part of PARTS) assert.deepEqual(f.hp[part], off(150));
  }
  assert.notDeepEqual(render(thrash((p) => { p.filters = defaultParams('laptop-2000s').filters; })), render(thrash()));

  const plain = render(thrash(), 2);
  for (const mode of ['combined', 'separate']) {
    const withOffFilters = render(thrash((p) => {
      p.filters.hpMode = mode;
      p.filters.lpMode = mode;
      for (const type of ['hp', 'lp']) {
        for (const target of FILTER_TARGETS) Object.assign(p.filters[type][target], { hz: 700, resDb: 24, slope: 24 });
      }
    }), 2);
    assert.deepEqual(withOffFilters, plain);
  }
  // A filter that belongs to the mode that is not selected does not act either.
  const otherMode = render(thrash((p) => {
    p.filters.hp.head.on = true; // high-pass mode is "combined"
    p.filters.lpMode = 'separate';
    p.filters.lp.all.on = true;
  }), 2);
  assert.deepEqual(otherMode, plain);
});

test('R6.16: combined mode filters all four sound parts, separate mode each part on its own', () => {
  for (const type of ['hp', 'lp']) {
    const settings = { on: true, hz: type === 'hp' ? 900 : 1200, resDb: 6, slope: 24 };
    const plain = layers(thrash());
    const combined = layers(thrash((p) => { Object.assign(p.filters[type].all, settings); }));
    assert.ok(maxDiff(combined.head, plain.head) > 0.01, `${type}: combined acts on the head`);
    assert.ok(maxDiff(combined.spindle, plain.spindle) > 1e-4, `${type}: combined acts on the spindle`);

    // The same setting on each part separately is the same filter.
    const allSeparate = layers(thrash((p) => {
      p.filters[`${type}Mode`] = 'separate';
      for (const part of PARTS) Object.assign(p.filters[type][part], settings);
    }));
    assert.ok(maxDiff(allSeparate.head, combined.head) < 1e-6);
    assert.ok(maxDiff(allSeparate.spindle, combined.spindle) < 1e-6);

    // One part only: the others are untouched.
    const headOnly = layers(thrash((p) => {
      p.filters[`${type}Mode`] = 'separate';
      Object.assign(p.filters[type].head, settings);
    }));
    assert.deepEqual(headOnly.spindle, plain.spindle);
    assert.ok(maxDiff(headOnly.head, combined.head) === 0);
    const motorOnly = layers(thrash((p) => {
      p.filters[`${type}Mode`] = 'separate';
      Object.assign(p.filters[type].motor, settings);
    }));
    assert.deepEqual(motorOnly.head, plain.head);
    assert.ok(maxDiff(motorOnly.spindle, plain.spindle) > 1e-4);
  }
});

test('R6.16: high-pass and low-pass modes are chosen independently', () => {
  const mixed = layers(thrash((p) => {
    p.filters.hpMode = 'separate';
    Object.assign(p.filters.hp.motor, { on: true, hz: 300, slope: 24 });
    Object.assign(p.filters.lp.all, { on: true, hz: 3000 });
  }));
  const lpOnly = layers(thrash((p) => { Object.assign(p.filters.lp.all, { on: true, hz: 3000 }); }));
  assert.deepEqual(mixed.head, lpOnly.head); // the motor high-pass does not touch the head
  assert.ok(maxDiff(mixed.spindle, lpOnly.spindle) > 1e-4);
});

test('R6.16: a high-pass on the motor tones removes the deep rotation tone and keeps the rest', () => {
  const quiet = (edit) => {
    const p = base(); // 4200 rpm: a 70 Hz rotation tone
    p.drive.idleRecal = false;
    if (edit) edit(p);
    const engine = new Engine(sanitizeParams(p), SR);
    engine.spinUp(true);
    return layers(engine, 2).spindle.subarray(SR); // skip the filter's start
  };
  const plain = quiet();
  const filtered = quiet((p) => {
    p.filters.hpMode = 'separate';
    Object.assign(p.filters.hp.motor, { on: true, hz: 300, slope: 24 });
  });
  assert.ok(toneDb(plain, 70) - toneDb(filtered, 70) > 40, '70 Hz rotation tone is at least 40 dB lower');
  assert.ok(Math.abs(toneDb(plain, 700) - toneDb(filtered, 700)) < 1, 'the 700 Hz harmonic stays');
});

test('R6.18: filters act before the mixer gains; layer isolation (R6.12) and the limiter (R6.13) still hold', () => {
  const loud = (p) => {
    for (const type of ['hp', 'lp']) Object.assign(p.filters[type].all, { on: true, hz: 1400, resDb: 24, slope: 24 });
  };
  const headOnly = render(thrash((p) => { loud(p); p.mix.spindleDb = -60; }));
  const otherSpindle = render(thrash((p) => { loud(p); p.mix.spindleDb = -60; p.spindle.motorDb = 0; p.spindle.whineDb = 0; }));
  assert.deepEqual(headOnly, otherSpindle);
  const silent = render(thrash((p) => { loud(p); p.mix.headDb = -60; p.mix.spindleDb = -60; }));
  assert.ok(silent.every((v) => v === 0));
  const all = render(thrash((p) => { loud(p); p.mix.headDb = 6; p.mix.spindleDb = 6; p.mix.masterDb = 6; p.click.levelDb = 6; }), 2);
  assert.ok(all.every((v) => Number.isFinite(v) && Math.abs(v) <= 1));
  assert.ok(peakOf(all) > 0.7);
});

test('R6.19: one-shot clicks with filters still meet R10.2', () => {
  const settingsList = [
    (p) => { Object.assign(p.filters.hp.all, { on: true, hz: 600, resDb: 12, slope: 24 }); },
    (p) => { Object.assign(p.filters.lp.all, { on: true, hz: 900, resDb: 24, slope: 12 }); },
    (p) => {
      p.filters.hpMode = 'separate';
      p.filters.lpMode = 'separate';
      Object.assign(p.filters.hp.head, { on: true, hz: 20, resDb: 24, slope: 24 });
      Object.assign(p.filters.lp.head, { on: true, hz: 2500 });
    },
  ];
  const plain = renderClickSet(base());
  for (const edit of settingsList) {
    const p = base();
    edit(p);
    const sr = p.export.sampleRate;
    const files = renderClickSet(p);
    assert.equal(files.length, plain.length);
    files.forEach((file, i) => {
      const s = file.samples;
      assert.ok(s.length / sr <= 0.06, `${file.name} length`);
      const peak = peakOf(s);
      assert.ok(Math.abs(20 * Math.log10(peak) + 1) < 0.01, `${file.name} peak ${peak}`);
      const onset = s.findIndex((v) => Math.abs(v) >= peak * 0.01);
      assert.ok(onset / sr <= 0.001, `${file.name} onset`);
      assert.ok(s.subarray(s.length - 8).every((v) => v === 0), `${file.name} ends in silence`);
      assert.ok(Math.abs(s[s.length - 20]) < peak * 0.01, `${file.name} has no step at the end`);
      assert.notDeepEqual(s, plain[i].samples);
    });
  }
  // A filter on another sound part leaves the clicks alone.
  const p = base();
  p.filters.hpMode = 'separate';
  Object.assign(p.filters.hp.motor, { on: true, hz: 300 });
  assert.deepEqual(renderClickSet(p), plain);
});

test('R6.19: filters apply to sequences, and the filtered spindle loop still repeats without a seam', () => {
  const edits = [
    (p) => { Object.assign(p.filters.hp.all, { on: true, hz: 20, resDb: 24, slope: 24 }); },
    (p) => {
      p.filters.hpMode = 'separate';
      Object.assign(p.filters.hp.motor, { on: true, hz: 250, resDb: 6, slope: 24 });
      Object.assign(p.filters.lp.all, { on: true, hz: 2000, resDb: 12 });
    },
  ];
  for (const edit of edits) {
    const p = base();
    p.export.loopSeconds = 1;
    const plain = renderSequence('spindle_loop', p);
    edit(p);
    const loop = renderSequence('spindle_loop', p);
    assert.equal(loop.length, plain.length);
    assert.ok(maxDiff(loop, plain) > 1e-4);
    const n = loop.length;
    let maxStep = 0;
    let maxBend = 0;
    for (let i = 1; i < n; i++) maxStep = Math.max(maxStep, Math.abs(loop[i] - loop[i - 1]));
    for (let i = 2; i < n; i++) maxBend = Math.max(maxBend, Math.abs(loop[i] - 2 * loop[i - 1] + loop[i - 2]));
    assert.ok(Math.abs(loop[0] - loop[n - 1]) <= maxStep, 'step at the seam');
    assert.ok(Math.abs(loop[1] - 2 * loop[0] + loop[n - 1]) <= maxBend, 'bend at the seam');
    assert.ok(Math.abs(loop[0] - 2 * loop[n - 1] + loop[n - 2]) <= maxBend, 'bend at the seam');
  }
  const p = base();
  p.export.burstSeconds = 2;
  const plainBurst = renderSequence('burst', p);
  Object.assign(p.filters.lp.all, { on: true, hz: 1000, slope: 24 });
  assert.ok(maxDiff(renderSequence('burst', p), plainBurst) > 0.01);
});

// ---------- read and write sound ----------

function seekSound(edit, write) {
  const p = base();
  p.drive.idleRecal = false;
  if (edit) edit(p);
  const engine = new Engine(sanitizeParams(p), SR);
  engine.spinUp(true);
  engine.triggerSeek(0.2, write);
  return layers(engine, 0.1).head;
}

test('R6.20: combined is the default and makes reads and writes sound the same', () => {
  assert.equal(defaultParams().rw.mode, 'combined');
  assert.equal(defaultParams().rw.writePitchPct, -6);
  assert.equal(defaultParams().rw.writeLevelDb, 0);
  assert.deepEqual(seekSound(null, true), seekSound(null, false));
  const s = sanitizeParams({ rw: { mode: 'nonsense', writePitchPct: -99, writeLevelDb: 99 } });
  assert.deepEqual(s.rw, { mode: 'combined', writePitchPct: -20, writeLevelDb: 12 });
});

test('R6.20: in separate mode write clicks differ by the pitch offset and the level offset', () => {
  const separate = (p) => { p.rw.mode = 'separate'; };
  const read = seekSound(separate, false);
  assert.deepEqual(read, seekSound(null, false)); // reads are unchanged
  assert.ok(maxDiff(seekSound(separate, true), read) > 0.01);

  // Level offset alone: the same click, 6 dB lower.
  const lower = seekSound((p) => { p.rw.mode = 'separate'; p.rw.writePitchPct = 0; p.rw.writeLevelDb = -6; }, true);
  const factor = Math.pow(10, -6 / 20);
  assert.ok(read.every((v, i) => Math.abs(lower[i] - v * factor) < 1e-6));

  // Pitch offset: every resonance moves by the factor.
  const p = base();
  p.click.resonators = [{ freq: 2000, decayMs: 10, gainDb: 0 }, { freq: 2000, decayMs: 10, gainDb: -60 }];
  p.click.body.gainDb = -60;
  Object.assign(p.click, { varFreqPct: 0, varDecayPct: 0, varLevelDb: 0 });
  const synth = new ClickSynth(sanitizeParams(p).click, SR);
  const crossings = (pitch) => {
    const c = synth.render(0.5, makeRng(1, 2), 0, false, pitch).subarray(0, 480); // 10 ms
    let count = 0;
    for (let i = 1; i < c.length; i++) if ((c[i - 1] < 0) !== (c[i] < 0)) count++;
    return count;
  };
  assert.ok(Math.abs(crossings(1) - 40) <= 2, `${crossings(1)} zero crossings at 2000 Hz`);
  assert.ok(Math.abs(crossings(0.8) - 32) <= 2, `${crossings(0.8)} zero crossings at 1600 Hz`);
});

test('R6.21: the operation type comes from the read share in simulation and from the real counts in live mode', () => {
  const countWrites = (engine) => {
    const seen = { reads: 0, writes: 0 };
    const original = engine.model.addOp.bind(engine.model);
    engine.model.addOp = (bytes, dist, write, bg) => {
      if (write) seen.writes++; else seen.reads++;
      original(bytes, dist, write, bg);
    };
    return seen;
  };
  for (const [readMix, check] of [[1, (s) => s.writes === 0 && s.reads > 50], [0, (s) => s.reads === 0 && s.writes > 50]]) {
    const engine = thrash((p) => { p.sim.readMix = readMix; });
    const seen = countWrites(engine);
    render(engine);
    assert.ok(check(seen), `read share ${readMix}: ${JSON.stringify(seen)}`);
  }
  const mixed = thrash((p) => { p.sim.readMix = 0.7; });
  const seenMixed = countWrites(mixed);
  render(mixed, 3);
  const share = seenMixed.reads / (seenMixed.reads + seenMixed.writes);
  assert.ok(Math.abs(share - 0.7) < 0.08, `read share ${share}`);

  const live = new Engine(sanitizeParams({ drive: { idleRecal: false, queueMax: 256 } }), SR);
  live.spinUp(true);
  const seenLive = countWrites(live);
  live.feed(10, 40960, 0.05, 3);
  live.feed(8, 40960, 0.05, 8);
  live.feed(5, 40960, 0.05, 0);
  render(live, 0.1);
  assert.deepEqual(seenLive, { reads: 12, writes: 11 });
});

test('R6.21: a merged operation takes the type of the one it joins; recalibration seeks are reads', () => {
  const drive = sanitizeParams({ drive: { queueMax: 1, recalMinS: 1, recalMaxS: 1, idleAfterS: 0 } }).drive;
  const model = new DriveModel(drive, makeRng(1, 1));
  model.addOp(1000, 0.5, false);
  model.addOp(1000, 0.5, true);
  assert.equal(model.queue.length, 1);
  assert.equal(model.queue[0].write, false);
  assert.equal(model.queue[0].bytes, 2000);

  const idle = new DriveModel(drive, makeRng(1, 1));
  const types = [];
  for (let i = 0; i < 400; i++) idle.advance(0.01, (offset, dist, seekS, op) => types.push(op.write));
  assert.ok(types.length >= 2);
  assert.ok(types.every((w) => w === false));
});

test('R10.6: separate mode exports a read set and a write set; combined names are unchanged', () => {
  const p = base();
  p.export.clickCount = 4;
  const combined = exportClicks(p);
  assert.deepEqual(combined.map((f) => f.name), ['click_01.wav', 'click_02.wav', 'click_03.wav', 'click_04.wav']);
  p.rw.mode = 'separate';
  const separate = exportClicks(p);
  assert.deepEqual(separate.map((f) => f.name), [
    'click_read_01.wav', 'click_read_02.wav', 'click_read_03.wav', 'click_read_04.wav',
    'click_write_01.wav', 'click_write_02.wav', 'click_write_03.wav', 'click_write_04.wav',
  ]);
  for (let i = 0; i < 4; i++) {
    assert.deepEqual(separate[i].data, combined[i].data); // read clicks are the combined clicks
    assert.notDeepEqual(separate[i + 4].data, combined[i].data);
  }
});

// ---------- idle baseline ----------

const DT = 0.05; // the server's 20 samples per second
const liveParams = (over) => ({ ...defaultParams().live, ...over });

test('R8.6: a sample is rated by the operations of the last second, the sample included', () => {
  const b = new Baseline(liveParams({ baselineMode: 'manual', baselineOps: 10 }));
  const ratings = [];
  for (let i = 0; i < 30; i++) ratings.push(b.sample(1, DT));
  // 1 operation per sample: the count reaches 10 at the tenth sample (still
  // background, "at or below") and 11 at the eleventh (normal).
  assert.deepEqual(ratings.slice(0, 12), [true, true, true, true, true, true, true, true, true, true, false, false]);
  assert.equal(b.rate, 20); // one second holds 20 samples
  for (let i = 0; i < 19; i++) b.sample(0, DT);
  assert.equal(b.rate, 1);
  assert.equal(b.background, true);
  b.sample(0, DT);
  assert.equal(b.rate, 0);
});

test('R8.7: baseline modes off, manual and adaptive; adaptive is the default', () => {
  const d = defaultParams().live;
  assert.deepEqual(d, { baselineMode: 'adaptive', baselineOps: 16, rampUpS: 0.4, cooldownS: 8, bgLightPct: 28, bgClickDb: -15.5 });
  const off = new Baseline(liveParams({ baselineMode: 'off' }));
  for (let i = 0; i < 40; i++) assert.equal(off.sample(1, DT), false);
  const manual = new Baseline(liveParams({ baselineMode: 'manual', baselineOps: 0 }));
  assert.equal(manual.sample(1, DT), false);
  const s = sanitizeParams({ live: { baselineMode: 'x', baselineOps: 9999, rampUpS: 0, cooldownS: 999, bgLightPct: 400, bgClickDb: 5 } }).live;
  assert.deepEqual(s, { baselineMode: 'adaptive', baselineOps: 500, rampUpS: 0.1, cooldownS: 120, bgLightPct: 100, bgClickDb: 0 });
});

test('R8.8: the activity level rises with activity over the ramp-up time and falls over the cooldown time', () => {
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const b = new Baseline(liveParams({ baselineMode: 'adaptive', rampUpS: 2, cooldownS: 10 }));
  assert.equal(b.level, 0);
  for (let i = 0; i < 20; i++) b.sample(3, DT); // 1 s of activity
  assert.ok(near(b.level, 0.5), `level ${b.level}`);
  for (let i = 0; i < 20; i++) b.sample(500, DT); // the amount of activity does not matter
  assert.ok(near(b.level, 1));
  for (let i = 0; i < 20; i++) b.sample(1, DT);
  assert.equal(b.level, 1); // never above 100 %
  for (let i = 0; i < 100; i++) b.sample(0, DT); // 5 s of quiet
  assert.ok(near(b.level, 0.5), `level ${b.level}`);
  for (let i = 0; i < 120; i++) b.sample(0, DT);
  assert.equal(b.level, 0); // never below 0 %
});

test('R8.8: one short burst stays quiet, bursts close together add up, far apart they do not', () => {
  const run = (gapS) => {
    const b = new Baseline(liveParams({ baselineMode: 'adaptive', rampUpS: 1.5, cooldownS: 10 }));
    const peaks = [];
    for (let burst = 0; burst < 6; burst++) {
      b.sample(20, DT);
      b.sample(20, DT);
      peaks.push(b.level);
      for (let i = 0; i < gapS / DT; i++) b.sample(0, DT);
    }
    return peaks;
  };
  const close = run(0.3);
  assert.ok(close[0] > 0 && close[0] < 0.1, `first burst ${close[0]}`);
  for (let i = 1; i < close.length; i++) assert.ok(close[i] > close[i - 1], 'each burst is louder than the one before');
  const apart = run(30);
  assert.ok(apart.every((v) => Math.abs(v - apart[0]) < 1e-9), 'bursts 30 s apart all stay at the first level');
});

test('A2: with a manual baseline, a load of five times the baseline is rated normal within 250 ms', () => {
  const b = new Baseline(liveParams({ baselineMode: 'manual', baselineOps: 4 }));
  for (let i = 0; i < 100; i++) b.sample(0, DT);
  let samples = 0;
  do samples++; while (b.sample(1, DT)); // 20 operations per second
  assert.ok(samples * DT <= 0.25 + 1e-9, `normal after ${samples * DT} s`);
});

test('A2: in adaptive mode a steady load is at the normal level within the ramp-up time plus 100 ms', () => {
  for (const rampUpS of [0.4, 1.5, 5]) {
    const b = new Baseline(liveParams({ baselineMode: 'adaptive', rampUpS }));
    b.sample(5, DT);
    b.sample(5, DT);
    assert.ok(b.level <= 0.1 / rampUpS + 1e-9, `a 100 ms burst from rest gives ${b.level}`);
    let t = 2 * DT;
    while (b.level < 1) { b.sample(5, DT); t += DT; }
    assert.ok(t <= rampUpS + 0.1 + 1e-9, `full level after ${t} s`);
  }
});

function liveEngine(live) {
  const p = base();
  p.drive.idleRecal = false;
  p.sim.seekSpread = 1; // every operation seeks
  Object.assign(p.live, live);
  const engine = new Engine(sanitizeParams(p), SR);
  engine.spinUp(true);
  return engine;
}

test('R8.9: background activity lights the light only to the background brightness', () => {
  const engine = liveEngine({ baselineMode: 'manual', baselineOps: 100, bgLightPct: 15 });
  const out = new Float32Array(128);
  let top = 0;
  for (let i = 0; i < 40; i++) {
    engine.feed(1, 400000, DT); // long transfers: the drive is busy most of the time
    for (let k = 0; k < 19; k++) {
      engine.process(out);
      top = Math.max(top, engine.light);
    }
  }
  assert.equal(engine.baseline.background, true);
  assert.ok(top > 0.14 && top <= 0.15 + 1e-9, `brightest ${top}`);

  // Activity above the baseline lights it fully again.
  for (let i = 0; i < 10; i++) {
    engine.feed(200, 200 * 4000, DT);
    for (let k = 0; k < 19; k++) engine.process(out);
  }
  assert.equal(engine.baseline.background, false);
  assert.ok(engine.light > 0.95, `light ${engine.light}`);
});

test('R8.9: background clicks play at the background click level, or not at all at silence', () => {
  const run = (live) => {
    const engine = liveEngine(live);
    engine.feed(3, 3000, DT);
    const result = layers(engine, 0.3);
    return { ...result, light: engine.takeLight() };
  };
  const normal = run({ baselineMode: 'off' });
  const background = run({ baselineMode: 'manual', baselineOps: 10, bgClickDb: -18 });
  const factor = Math.pow(10, -18 / 20);
  assert.ok(peakOf(normal.head) > 0.05);
  assert.ok(normal.head.every((v, i) => Math.abs(background.head[i] - v * factor) < 1e-6));

  const silent = run({ baselineMode: 'manual', baselineOps: 10, bgClickDb: -60 });
  assert.ok(silent.head.every((v) => v === 0));
  assert.ok(silent.light > 0, 'the drive model still serves the operations');
});

test('R8.9: in adaptive mode light limit and click level move from background to normal with the activity level', () => {
  const run = (level) => {
    const engine = liveEngine({ baselineMode: 'adaptive', bgClickDb: -18, bgLightPct: 15 });
    engine.feed(1, 400000, 0.001);
    engine.baseline.level = level;
    const result = layers(engine, 0.02); // the click starts here; the op is still being served
    return { head: result.head, light: engine.light };
  };
  const normalEngine = liveEngine({ baselineMode: 'off' });
  normalEngine.feed(1, 400000, 0.001);
  const normal = layers(normalEngine, 0.02).head;
  assert.ok(peakOf(normal) > 0.05);
  for (const [level, db, light] of [[0, -18, 0.15], [0.5, -9, 0.575], [1, 0, 1]]) {
    const r = run(level);
    const factor = Math.pow(10, db / 20);
    assert.ok(normal.every((v, i) => Math.abs(r.head[i] - v * factor) < 1e-6), `click level at ${level}`);
    assert.ok(r.light <= light + 1e-9 && r.light > light * 0.9, `light ${r.light} at level ${level}`);
  }
  // At silence the click is only missing while the level is 0.
  const quiet = (level) => {
    const engine = liveEngine({ baselineMode: 'adaptive', bgClickDb: -60 });
    engine.feed(1, 400000, 0.001);
    engine.baseline.level = level;
    return peakOf(layers(engine, 0.02).head);
  };
  assert.equal(quiet(0), 0);
  assert.ok(quiet(0.5) > 0);
});

// ---------- read/write pattern ----------

function watchOps(engine) {
  const ops = [];
  const original = engine.model.addOp.bind(engine.model);
  engine.model.addOp = (bytes, dist, write, bg) => {
    ops.push({ t: engine.pos / SR, dist, write: !!write });
    original(bytes, dist, write, bg);
  };
  return ops;
}

test('R9.5: the read/write pattern is on by default; switched off, its settings change nothing', () => {
  assert.deepEqual(defaultParams().pattern, { on: true, readSpread: 0.9, writeSpread: 0.5, writeReach: 0.2, flushS: 5 });
  const plain = render(thrash(), 2);
  const offButSet = render(thrash((p) => { Object.assign(p.pattern, { readSpread: 0, writeSpread: 0, writeReach: 0.01, flushS: 0.5 }); }), 2);
  assert.deepEqual(offButSet, plain);
  assert.notDeepEqual(render(thrash((p) => { p.pattern.on = true; }), 2), plain);
  // Independent of the head sound mode: either can be on without the other.
  const p = sanitizeParams({ pattern: { on: true }, rw: { mode: 'combined' } });
  assert.equal(p.pattern.on, true);
  assert.equal(p.rw.mode, 'combined');
});

test('R9.6: each type has its own seek spread and write seeks stay within the write seek reach', () => {
  const engine = thrash((p) => {
    p.sim.readMix = 0.5;
    p.sim.seekSpread = 0; // replaced by the two spreads
    Object.assign(p.pattern, { on: true, readSpread: 0.9, writeSpread: 0.5, writeReach: 0.2, flushS: 0.5 });
  });
  const ops = watchOps(engine);
  render(engine, 6);
  const reads = ops.filter((o) => !o.write);
  const writes = ops.filter((o) => o.write);
  assert.ok(reads.length > 200 && writes.length > 200);
  const seekShare = (list) => list.filter((o) => o.dist > 0).length / list.length;
  assert.ok(Math.abs(seekShare(reads) - 0.9) < 0.06, `read seek share ${seekShare(reads)}`);
  assert.ok(Math.abs(seekShare(writes) - 0.5) < 0.08, `write seek share ${seekShare(writes)}`);
  assert.ok(writes.every((o) => o.dist <= 0.2));
  assert.ok(reads.some((o) => o.dist > 0.5));

  // The same applies to live activity.
  const live = liveEngine({ baselineMode: 'off' });
  live.setParams(sanitizeParams({ ...live.p, pattern: { on: true, readSpread: 1, writeSpread: 1, writeReach: 0.1 } }));
  const liveOps = watchOps(live);
  for (let i = 0; i < 40; i++) { live.feed(10, 40960, DT, 5); render(live, DT); }
  assert.ok(liveOps.filter((o) => o.write).every((o) => o.dist > 0 && o.dist <= 0.1));
  assert.ok(liveOps.filter((o) => !o.write).some((o) => o.dist > 0.3));
});

test('R9.7: simulated writes are collected and passed on together at every flush interval; reads are not delayed', () => {
  const engine = thrash((p) => {
    p.sim = { ...p.sim, opsPerSec: 40, burstiness: 0, readMix: 0.5 };
    Object.assign(p.pattern, { on: true, flushS: 2 });
  });
  const ops = watchOps(engine);
  render(engine, 7);
  const writeTimes = [...new Set(ops.filter((o) => o.write).map((o) => o.t))];
  assert.equal(writeTimes.length, 3, `writes arrive at ${writeTimes}`); // every 2 s
  for (let i = 1; i < writeTimes.length; i++) assert.ok(Math.abs(writeTimes[i] - writeTimes[i - 1] - 2) < 0.01);
  const perFlush = ops.filter((o) => o.write && o.t === writeTimes[1]).length;
  assert.ok(perFlush > 20 && perFlush < 60, `${perFlush} writes in one flush`); // about 2 s x 20 writes/s
  const readTimes = new Set(ops.filter((o) => !o.write).map((o) => o.t));
  assert.ok(readTimes.size > 100);

  // Live timing is not changed.
  const live = liveEngine({ baselineMode: 'off' });
  live.setParams(sanitizeParams({ ...live.p, pattern: { on: true, flushS: 30 } }));
  const liveOps = watchOps(live);
  live.feed(4, 4096, DT, 4);
  render(live, 0.1);
  assert.equal(liveOps.filter((o) => o.write).length, 4);
});

// ---------- presets ----------

test('R6.14: a preset sets every Drive, Mix and Filters setting, and leaves the master volume alone', () => {
  const groups = ['drive', 'click', 'spindle', 'rw', 'light', 'filters'];
  for (const name of PRESET_NAMES) {
    // Start from another preset with every preset setting changed.
    const p = defaultParams(name === 'laptop-2000s' ? 'desktop-90s' : 'laptop-2000s');
    p.mix = { headDb: 3, spindleDb: -40, masterDb: -20 };
    p.rw = { mode: 'separate', writePitchPct: 10, writeLevelDb: 5 };
    p.light = { onMs: 20, offMs: 200, color: 'red' };
    p.filters.hpMode = 'separate';
    p.filters.lp.all.hz = 500;
    p.live.rampUpS = 3;
    applyPreset(p, name);
    const fresh = defaultParams(name);
    assert.equal(p.preset, name);
    for (const group of groups) assert.deepEqual(p[group], fresh[group], `${name}: ${group}`);
    assert.deepEqual(p.mix, { headDb: fresh.mix.headDb, spindleDb: fresh.mix.spindleDb, masterDb: -20 });
    assert.equal(p.live.rampUpS, 3, 'settings outside the preset stay');
    assert.deepEqual(sanitizeParams(p), p);
  }
  // R6.11 defaults, and all of it survives the parameter file.
  assert.deepEqual(defaultParams().mix, { headDb: -8, spindleDb: 0, masterDb: -6 });
  const edited = defaultParams();
  edited.mix = { headDb: -3, spindleDb: -7, masterDb: -12 };
  edited.filters.lp.head.hz = 2222;
  edited.light.color = 'amber';
  assert.deepEqual(sanitizeParams(JSON.parse(JSON.stringify(edited))), edited);
});
