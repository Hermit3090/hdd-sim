import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ClickSynth, CLICK_MAX_S } from '../src/dsp/click.js';
import { DriveModel } from '../src/dsp/drive-model.js';
import { Engine } from '../src/dsp/engine.js';
import {
  PRESET_NAMES, SAMPLE_RATES, SCENARIO_NAMES, SCHEMA, defaultParams, getPath, sanitizeParams, scenarioParams,
} from '../src/dsp/params.js';
import { makeRng } from '../src/dsp/prng.js';

const DSP_DIR = join(import.meta.dirname, '..', 'src', 'dsp');

function thrashEngine(sr, edit) {
  const p = defaultParams();
  p.sim = scenarioParams('thrash');
  if (edit) edit(p);
  const engine = new Engine(sanitizeParams(p), sr);
  engine.spinUp(true);
  engine.setSimEnabled(true);
  return engine;
}

function render(engine, seconds) {
  const out = new Float32Array(Math.round(seconds * engine.sr));
  engine.process(out);
  return out;
}

test('R4.2: the synth core uses no Node-only and no browser-only API', () => {
  for (const name of readdirSync(DSP_DIR)) {
    const code = readFileSync(join(DSP_DIR, name), 'utf8').replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(code, /from\s+'node:|require\(|process\.|Buffer\b/, `${name} uses a Node API`);
    assert.doesNotMatch(code, /\b(window|document|navigator|AudioContext|localStorage)\b/, `${name} uses a browser API`);
    for (const m of code.matchAll(/from\s+'([^']+)'/g)) assert.match(m[1], /^\.\/[\w-]+\.js$/, `${name} imports ${m[1]}`);
  }
});

test('R4.4: same parameters, seed and rate give bit-identical output', () => {
  for (const sr of SAMPLE_RATES) {
    const a = render(thrashEngine(sr), 2);
    const b = render(thrashEngine(sr), 2);
    assert.deepEqual(a, b);
  }
  const other = render(thrashEngine(44100, (p) => { p.seed = 2; }), 2);
  assert.notDeepEqual(other, render(thrashEngine(44100), 2));
});

test('R4.4: output does not depend on how the render is split into calls', () => {
  const whole = render(thrashEngine(48000), 1);
  const engine = thrashEngine(48000);
  const parts = new Float32Array(whole.length);
  const sizes = [1, 37, 128, 500, 4096, 77];
  for (let at = 0, i = 0; at < parts.length; i++) {
    const n = Math.min(sizes[i % sizes.length], parts.length - at);
    engine.process(parts, at, n);
    at += n;
  }
  assert.deepEqual(parts, whole);
});

test('R4.5: parameters survive JSON and validation fills and clamps', () => {
  for (const preset of PRESET_NAMES) {
    const p = defaultParams(preset);
    assert.deepEqual(sanitizeParams(JSON.parse(JSON.stringify(p))), p);
  }
  for (const name of SCENARIO_NAMES) {
    const p = defaultParams();
    p.sim = scenarioParams(name);
    assert.deepEqual(sanitizeParams(p).sim, p.sim, `scenario ${name} is inside the allowed ranges`);
  }
  const p = sanitizeParams({ drive: { rpm: 99999 }, mix: { headDb: 'loud' }, click: { resonators: [{ freq: 1 }] }, bogus: 1 });
  assert.equal(p.drive.rpm, 7200);
  assert.equal(p.mix.headDb, -8); // R6.11 default of the default preset
  assert.equal(p.bogus, undefined);
  assert.ok(p.click.resonators.length >= 2 && p.click.resonators.length <= 8);
  assert.deepEqual(sanitizeParams(null), defaultParams());
  for (const item of SCHEMA) assert.notEqual(getPath(defaultParams(), item.path), undefined, item.path);
});

test('spindle part levels: fine control below -60 dB, off at -100 dB, old files keep their meaning', () => {
  const rms = (whineDb) => {
    const p = sanitizeParams({ spindle: { motorDb: -100, noiseDb: -100, whineDb }, preset: 'desktop-90s' });
    const engine = new Engine(p, 48000);
    engine.spinUp(true);
    const out = render(engine, 0.5);
    return Math.sqrt(out.reduce((sum, v) => sum + v * v, 0) / out.length);
  };
  assert.equal(rms(-100), 0);
  const at80 = rms(-80);
  const at60 = rms(-60);
  assert.ok(at80 > 0 && Math.abs(20 * Math.log10(at60 / at80) - 20) < 0.5, 'the level follows the slider below -60 dB');

  const old = sanitizeParams({ version: 1, spindle: { whineDb: -60, noiseDb: -45, motorDb: -24 } });
  assert.deepEqual([old.spindle.whineDb, old.spindle.noiseDb, old.spindle.motorDb], [-100, -45, -24]);
  assert.equal(old.version, 2);
  assert.equal(sanitizeParams({ version: 2, spindle: { whineDb: -60 } }).spindle.whineDb, -60);
  assert.equal(defaultParams('laptop-2000s').spindle.whineDb, -100);
});

test('spec defaults: presets match the documented values', () => {
  const laptop = defaultParams('laptop-2000s');
  // R6.14: the default preset is the owner's tuning, as saved in presets/.
  const d = defaultParams();
  assert.equal(d.preset, 'desktop-90s-2');
  assert.deepEqual(d.mix, { headDb: -8, spindleDb: 0, masterDb: -6 });
  assert.equal(defaultParams('desktop-90s').mix.headDb, -8);
  assert.equal(defaultParams('laptop-2000s').mix.headDb, -11.5);
  const saved = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'presets', 'hdd-sim-preset-2-desktop.json'), 'utf8'));
  for (const key of ['drive', 'click', 'spindle']) assert.deepEqual(d[key], saved[key], key);
  assert.deepEqual([d.spindle.whineHz, d.spindle.whineDb], [4320, -56]);
  assert.equal(laptop.drive.rpm, 4200);
  assert.deepEqual(laptop.click.resonators.map((r) => r.freq), [1115, 1390, 1600, 1935, 3620]);
  assert.ok(laptop.click.resonators.every((r) => r.decayMs >= 5 && r.decayMs <= 10));
  assert.deepEqual([laptop.click.body.freq, laptop.click.body.decayMs, laptop.click.burstMs], [175, 15, 1.5]);
  const desktop = defaultParams('desktop-90s');
  assert.equal(desktop.drive.rpm, 5400);
  assert.deepEqual(desktop.click.resonators.map((r) => r.freq), [850, 1430, 2100, 3100]);
  assert.ok(desktop.click.resonators.every((r) => r.decayMs >= 4 && r.decayMs <= 12));
  assert.equal(desktop.click.body.freq, 300);
  for (const p of [laptop, desktop]) {
    assert.deepEqual([p.drive.settleMs, p.drive.fullStrokeMs, p.drive.transferMBps, p.drive.queueMax], [2, 22, 8, 64]);
    assert.deepEqual([p.spindle.spinUpS, p.spindle.spinDownS], [4, 6]);
    assert.deepEqual([p.click.varFreqPct, p.click.varLevelDb, p.click.varDecayPct, p.click.pairThreshold], [4, 3, 20, 0.3]);
    assert.deepEqual([p.light.onMs, p.light.offMs], [2, 30]);
    assert.deepEqual([p.export.sampleRate, p.export.clickCount, p.export.loopSeconds], [44100, 16, 4]);
  }
});

test('R5.3: seek time follows settle + (full - settle) * sqrt(distance)', () => {
  const model = new DriveModel(defaultParams().drive, makeRng(1));
  assert.equal(model.seekTimeS(0), 0);
  assert.ok(Math.abs(model.seekTimeS(1) - 0.022) < 1e-12);
  assert.ok(Math.abs(model.seekTimeS(0.25) - 0.012) < 1e-12);
});

test('R5.5: the queue is bounded and overflow merges into the newest operation', () => {
  const drive = defaultParams().drive;
  const model = new DriveModel(drive, makeRng(1));
  for (let i = 0; i < 1000; i++) model.addOp(1000, 0.5);
  assert.equal(model.queue.length, drive.queueMax);
  assert.equal(model.queue[drive.queueMax - 1].bytes, 1000 * (1000 - drive.queueMax + 1));
  assert.equal(model.queue[0].bytes, 1000);
});

test('R5.5: after a flood far beyond what the drive can serve, it is idle again within seconds', () => {
  const model = new DriveModel(defaultParams().drive, makeRng(1));
  const noSeek = () => {};
  // One second at 100000 operations/s and 400 MB/s, as an SSD can deliver.
  for (let i = 0; i < 1000; i++) {
    for (let k = 0; k < 100; k++) model.addOp(4096, 0.5);
    model.advance(0.001, noSeek);
  }
  let drain = 0;
  while ((model.busy || model.queue.length > 0) && drain < 60) {
    model.advance(0.001, noSeek);
    drain += 0.001;
  }
  assert.ok(drain < 5, `the drive needed ${drain.toFixed(1)} s to become idle`);
});

test('R5.8: never more seeks per second than 1 / settle time', () => {
  const drive = { ...defaultParams().drive, rpm: 7200, transferMBps: 100 };
  const model = new DriveModel(drive, makeRng(3));
  const times = [];
  let now = 0;
  for (let i = 0; i < 20000; i++) {
    for (let k = 0; k < 5; k++) model.addOp(0, 0.0001);
    model.advance(0.001, (offset) => times.push(now + offset));
    now += 0.001;
  }
  assert.ok(times.length > 1000);
  const limit = 1000 / drive.settleMs;
  assert.ok(times.length / now <= limit, `${times.length / now} seeks per second`);
  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i] - times[i - 1] >= drive.settleMs / 1000 - 1e-9);
  }
});

test('R5.2: sequential operations make the drive busy but produce no seek', () => {
  const model = new DriveModel(defaultParams().drive, makeRng(1));
  let seeks = 0;
  model.addOp(64000, 0);
  const busy = model.advance(0.1, () => seeks++);
  assert.equal(seeks, 0);
  assert.ok(busy > 0.008);
});

test('R5.7: an idle drive makes occasional recalibration seeks, and none when switched off', () => {
  const count = (idleRecal) => {
    const model = new DriveModel({ ...defaultParams().drive, idleRecal }, makeRng(5));
    let seeks = 0;
    for (let i = 0; i < 6000; i++) model.advance(0.1, () => seeks++);
    return seeks;
  };
  const seeks = count(true); // 600 s idle, one seek every 20-60 s
  assert.ok(seeks >= 9 && seeks <= 30, `${seeks} recalibration seeks`);
  assert.equal(count(false), 0);
});

test('R6.5: a click is at most 60 ms long and ends in silence', () => {
  for (const sr of SAMPLE_RATES) {
    for (const preset of PRESET_NAMES) {
      const p = defaultParams(preset);
      p.click.body.decayMs = 18;
      p.click.varDecayPct = 50;
      p.click.resonators.forEach((r) => { r.decayMs = 18; });
      const synth = new ClickSynth(sanitizeParams(p).click, sr);
      const rng = makeRng(7);
      for (const dist of [0.01, 0.3, 1]) {
        const buf = synth.render(dist, rng);
        assert.ok(buf.length <= CLICK_MAX_S * sr && CLICK_MAX_S <= 0.06);
        assert.equal(buf[buf.length - 1], 0);
        assert.ok(buf.every(Number.isFinite));
      }
    }
  }
});

test('R6.5: a default click has decayed 60 dB before its buffer ends', () => {
  const sr = 48000;
  const synth = new ClickSynth(defaultParams().click, sr);
  const buf = synth.render(1, makeRng(1));
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  let last = 0;
  buf.forEach((v, i) => { if (Math.abs(v) > peak / 1000) last = i; });
  assert.ok(last / sr < 0.06);
});

test('R6.4: longer seeks are louder and brighter, and long seeks click twice', () => {
  const sr = 48000;
  const p = defaultParams();
  Object.assign(p.click, { varFreqPct: 0, varLevelDb: 0, varDecayPct: 0 });
  const synth = new ClickSynth(p.click, sr);
  const stats = (dist) => {
    const buf = synth.render(dist, makeRng(4));
    let peak = 0;
    let diff = 0;
    let energy = 0;
    for (let i = 1; i < buf.length; i++) {
      peak = Math.max(peak, Math.abs(buf[i]));
      diff += (buf[i] - buf[i - 1]) ** 2;
      energy += buf[i] ** 2;
    }
    return { peak, brightness: diff / energy };
  };
  const near = stats(0.05);
  const far = stats(1);
  assert.ok(far.peak > near.peak);
  assert.ok(far.brightness > near.brightness);

  const clicksFor = (dist) => {
    const engine = new Engine(defaultParams(), sr);
    engine.spinUp(true);
    let n = 0;
    const original = engine.scheduleClick.bind(engine);
    engine.scheduleClick = (...args) => { n++; original(...args); };
    engine.triggerSeek(dist);
    return n;
  };
  assert.equal(clicksFor(0.2), 1);
  assert.equal(clicksFor(0.6), 2);
});

test('R6.6: the head layer is digital silence between clicks', () => {
  const run = (filtersOn) => {
    const p = defaultParams();
    p.drive.idleRecal = false;
    if (!filtersOn) for (const type of ['hp', 'lp']) for (const f of Object.values(p.filters[type])) f.on = false;
    const engine = new Engine(sanitizeParams(p), 48000);
    engine.spinUp(true);
    engine.triggerSeek(0.2);
    const head = new Float32Array(48000);
    const spindle = new Float32Array(48000);
    engine.processLayers(head, spindle);
    assert.ok(spindle.some((v) => v !== 0));
    return head;
  };
  const head = run(false);
  assert.ok(head.subarray(0, 2880).some((v) => v !== 0));
  assert.ok(head.subarray(2880).every((v) => v === 0));
  // With the default filters the click rings out a little longer, then it is exact silence too.
  const filtered = run(true);
  assert.ok(filtered.subarray(0, 2880).some((v) => v !== 0));
  assert.ok(filtered.subarray(9600).every((v) => v === 0)); // from 200 ms
});

test('R6.12: with the spindle at silence the output is exactly the head layer, and the reverse', () => {
  const sr = 44100;
  const headOnly = render(thrashEngine(sr, (p) => { p.mix.spindleDb = -60; }), 2);
  const otherSpindle = render(thrashEngine(sr, (p) => {
    p.mix.spindleDb = -60;
    p.drive.idleRecal = true;
    p.spindle.motorDb = 0;
    p.spindle.noiseDb = 0;
    p.spindle.whineDb = 0;
  }), 2);
  assert.deepEqual(headOnly, otherSpindle);
  assert.ok(headOnly.some((v) => v !== 0));

  const spindleOnly = render(thrashEngine(sr, (p) => { p.mix.headDb = -60; }), 2);
  const quiet = new Engine(sanitizeParams({ drive: { idleRecal: false } }), sr);
  quiet.spinUp(true);
  assert.deepEqual(spindleOnly, render(quiet, 2));

  const silent = render(thrashEngine(sr, (p) => { p.mix.headDb = -60; p.mix.spindleDb = -60; }), 1);
  assert.ok(silent.every((v) => v === 0));
});

test('R6.13: the loudest settings never clip and never produce NaN', () => {
  for (const preset of PRESET_NAMES) {
    const out = render(thrashEngine(48000, (p) => {
      Object.assign(p, { ...defaultParams(preset), sim: p.sim });
      p.mix = { headDb: 6, spindleDb: 6, masterDb: 6 };
      p.click.levelDb = 6;
      p.spindle.motorDb = 0;
      p.spindle.noiseDb = 0;
      p.spindle.whineDb = 0;
    }), 3);
    let peak = 0;
    for (const v of out) {
      assert.ok(Number.isFinite(v));
      peak = Math.max(peak, Math.abs(v));
    }
    assert.ok(peak <= 1, `peak ${peak}`);
    assert.ok(peak > 0.9, 'the limiter was actually reached');
  }
});

test('R6.9, R6.10: spin-up takes the configured time, then the head unlocks; spin-down stops', () => {
  const sr = 48000;
  const engine = new Engine(defaultParams(), sr);
  const head = new Float32Array(sr / 2);
  const spindle = new Float32Array(sr / 2);
  engine.spinUp();
  const headEnergy = [];
  const speeds = [];
  for (let i = 0; i < 10; i++) {
    engine.processLayers(head, spindle);
    headEnergy.push(head.some((v) => v !== 0));
    speeds.push(engine.spindle.speed);
  }
  assert.deepEqual(headEnergy.slice(0, 7), Array(7).fill(false), 'no head sound before the drive is at speed');
  assert.equal(headEnergy[8], true, 'unlock clicks after 4 s');
  assert.ok(speeds[3] > speeds[1] && speeds[7] === 1 && speeds[6] < 1);
  assert.equal(engine.model.ready, true);

  engine.spinDown();
  for (let i = 0; i < 14; i++) engine.processLayers(head, spindle); // 6 s to stop, then the filters ring out
  assert.equal(engine.spindle.state, 'stopped');
  assert.ok(spindle.every((v) => v === 0));
});

test('R7.1, R7.2: the light follows the busy signal, rises fast and falls slower', () => {
  const sr = 48000;
  const engine = new Engine(sanitizeParams({ drive: { idleRecal: false }, live: { baselineMode: 'off' } }), sr);
  engine.spinUp(true);
  const out = new Float32Array(128);
  engine.process(out);
  assert.equal(engine.takeLight(), 0);
  engine.feed(1, 400000, 0.001); // one 50 ms transfer (capped at 30 ms) plus rotation
  for (let i = 0; i < 6; i++) engine.process(out); // 16 ms
  assert.ok(engine.light > 0.95, `light ${engine.light} while busy`);
  while (engine.model.busy) engine.process(out);
  const atEnd = engine.light;
  for (let i = 0; i < 11; i++) engine.process(out); // about 30 ms later
  assert.ok(engine.light < atEnd * 0.5 && engine.light > atEnd * 0.2, `light ${engine.light} one fall time later`);
  for (let i = 0; i < 200; i++) engine.process(out);
  assert.ok(engine.light < 0.001);
});

test('R9.4: a scenario change takes effect at once, not after a pause drawn for the old one', () => {
  const p = defaultParams();
  p.drive.idleRecal = false;
  const engine = new Engine(p, 48000);
  engine.spinUp(true);
  engine.setSimEnabled(true);
  engine.activity.wait = 30; // a long pause from a quiet scenario
  const next = sanitizeParams({ ...p, sim: scenarioParams('thrash') });
  engine.setParams(next);
  const out = new Float32Array(4800); // 100 ms, the limit in R9.4
  engine.process(out);
  assert.ok(out.some((v) => Math.abs(v) > 0.01) || engine.model.busy, 'activity within 100 ms');
  assert.ok(engine.model.busy);
});

test('R8.4: live activity is turned into the same number of operations, spread over the interval', () => {
  const engine = new Engine(sanitizeParams({ drive: { idleRecal: false, queueMax: 256 } }), 48000);
  engine.spinUp(true);
  let ops = 0;
  const original = engine.model.addOp.bind(engine.model);
  engine.model.addOp = (bytes, dist) => { ops++; original(bytes, dist); };
  engine.feed(40, 40 * 4096, 0.05);
  const out = new Float32Array(1200); // half the interval
  engine.process(out);
  assert.ok(ops >= 18 && ops <= 22, `${ops} operations after half the interval`);
  engine.process(out);
  engine.process(out);
  assert.equal(ops, 40);
});
