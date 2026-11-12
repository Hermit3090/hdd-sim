import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  ONE_SHOT_PEAK, SEQUENCE_NAMES, exportAll, exportClicks, pageExport, renderSequence,
} from '../src/dsp/export.js';
import { PRESET_NAMES, SAMPLE_RATES, defaultParams } from '../src/dsp/params.js';
import { decodeWav } from '../src/dsp/wav.js';
import { makeZip } from '../src/dsp/zip.js';

const CLI = join(import.meta.dirname, '..', 'cli', 'render.js');

test('R10.1, R10.2: one-shot clicks have the specified format, onset, peak, silent end and length', () => {
  for (const sr of SAMPLE_RATES) {
    for (const preset of PRESET_NAMES) {
      const p = defaultParams(preset);
      p.export.sampleRate = sr;
      const files = exportClicks(p);
      assert.equal(files.length, 16);
      files.forEach((file, i) => {
        assert.equal(file.name, `click_${String(i + 1).padStart(2, '0')}.wav`);
        const wav = decodeWav(file.data);
        assert.deepEqual([wav.format, wav.channels, wav.bitsPerSample, wav.sampleRate], [1, 1, 16, sr]);
        const s = wav.samples;
        assert.ok(s.length / sr <= 0.06, `${file.name} is ${s.length / sr} s long`);
        let peak = 0;
        for (const v of s) peak = Math.max(peak, Math.abs(v));
        const peakDb = 20 * Math.log10(peak / 32768);
        assert.ok(Math.abs(peakDb - -1) < 0.05, `${file.name} peaks at ${peakDb} dBFS`);
        const onset = s.findIndex((v) => Math.abs(v) >= peak * 0.01);
        assert.ok(onset / sr <= 0.001, `${file.name} onset at ${onset / sr} s`);
        assert.ok(s.subarray(s.length - 8).every((v) => v === 0), `${file.name} ends in silence`);
        // The fade leaves no step at the end.
        assert.ok(Math.abs(s[s.length - 20]) < peak * 0.01);
      });
    }
  }
  assert.ok(Math.abs(20 * Math.log10(ONE_SHOT_PEAK) + 1) < 1e-9);
});

test('R10.2: the click count and distance range are configurable, variants differ', () => {
  const p = defaultParams();
  p.export.clickCount = 5;
  const files = exportClicks(p);
  assert.equal(files.length, 5);
  assert.notDeepEqual(files[0].data, files[4].data);
  p.export.clickCount = 1;
  assert.equal(exportClicks(p).length, 1);
});

test('R10.3: every sequence renders, with sound, without clipping', () => {
  const p = defaultParams();
  p.export.burstSeconds = 3;
  p.export.idleSeconds = 2;
  const sr = p.export.sampleRate;
  const expected = { burst: 3, spinup: 5.5, spindown: 7, spindle_loop: 4, idle: 2 };
  for (const kind of SEQUENCE_NAMES) {
    const out = renderSequence(kind, p);
    assert.equal(out.length, Math.round(expected[kind] * sr), kind);
    assert.ok(out.some((v) => v !== 0), `${kind} is not silent`);
    assert.ok(out.every((v) => Number.isFinite(v) && Math.abs(v) <= 1), kind);
  }
  const down = renderSequence('spindown', p);
  assert.ok(down.subarray(down.length - 1000).every((v) => v === 0), 'spin-down ends stopped');
});

test('R10.3: head and spindle gains apply to sequences', () => {
  const p = defaultParams();
  p.export.burstSeconds = 3;
  p.mix.spindleDb = -60;
  const headOnly = renderSequence('burst', p);
  assert.ok(headOnly.filter((v) => v === 0).length > headOnly.length / 2, 'head-only burst is silent between clicks');
  assert.ok(headOnly.some((v) => v !== 0));
  assert.ok(renderSequence('spindle_loop', p).every((v) => v === 0));
});

test('R10.3: the spindle loop repeats without a seam', () => {
  for (const preset of PRESET_NAMES) {
    for (const sr of SAMPLE_RATES) {
      const p = defaultParams(preset);
      p.export.sampleRate = sr;
      p.drive.rpm = preset === 'desktop-90s' ? 5460 : 4200; // 91 Hz and 70 Hz
      p.export.loopSeconds = 2.5;
      const loop = renderSequence('spindle_loop', p);
      const n = loop.length;
      // The step across the seam is no larger than steps inside the loop,
      // for the signal and for its slope.
      let maxStep = 0;
      let maxBend = 0;
      for (let i = 1; i < n; i++) maxStep = Math.max(maxStep, Math.abs(loop[i] - loop[i - 1]));
      for (let i = 2; i < n; i++) maxBend = Math.max(maxBend, Math.abs(loop[i] - 2 * loop[i - 1] + loop[i - 2]));
      assert.ok(Math.abs(loop[0] - loop[n - 1]) <= maxStep, `${preset} ${sr}: step at the seam`);
      assert.ok(Math.abs(loop[1] - 2 * loop[0] + loop[n - 1]) <= maxBend, `${preset} ${sr}: bend at the seam`);
      assert.ok(Math.abs(loop[0] - 2 * loop[n - 1] + loop[n - 2]) <= maxBend, `${preset} ${sr}: bend at the seam`);
    }
  }
});

test('R4.4: exports are reproducible and change with the seed', () => {
  const p = defaultParams();
  p.export.burstSeconds = 2;
  p.export.idleSeconds = 1;
  const a = exportAll(p);
  const b = exportAll(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(a, b);
  p.seed = 99;
  assert.notDeepEqual(exportAll(p)[0].data, a[0].data);
});

test('R10.5: the command writes exactly the files the shared export code produces', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdd-sim-test-'));
  try {
    const p = defaultParams('desktop-90s');
    p.seed = 42;
    p.export.sampleRate = 48000;
    p.export.clickCount = 4;
    p.export.burstSeconds = 2;
    p.export.idleSeconds = 1;
    p.mix.spindleDb = -6;
    const paramFile = join(dir, 'params.json');
    writeFileSync(paramFile, JSON.stringify(p));
    const out = join(dir, 'out');
    execFileSync(process.execPath, [CLI, '--params', paramFile, '--out', out]);
    const expected = exportAll(p);
    assert.deepEqual(readdirSync(out).sort(), expected.map((f) => f.name).sort());
    for (const f of expected) {
      assert.ok(Buffer.from(f.data).equals(readFileSync(join(out, f.name))), `${f.name} differs`);
    }
    assert.throws(() => execFileSync(process.execPath, [CLI, '--rate', '22050', '--out', out], { stdio: 'pipe' }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The files in a stored (uncompressed) ZIP, read from its local headers. */
function unzipStored(zip) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const files = [];
  let pos = 0;
  while (view.getUint32(pos, true) === 0x04034b50) {
    assert.equal(view.getUint16(pos + 8, true), 0, 'stored');
    const size = view.getUint32(pos + 18, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    const name = Buffer.from(zip.subarray(pos + 30, pos + 30 + nameLen)).toString('latin1');
    const start = pos + 30 + nameLen + extraLen;
    files.push({ name, data: zip.subarray(start, start + size) });
    pos = start + size;
  }
  return files;
}

test('R10.4, R10.5: the page export path with non-default parameters gives the same files as the command', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdd-sim-page-'));
  try {
    // Many settings away from their defaults, as a user would leave them in the page.
    const p = defaultParams('laptop-2000s');
    p.seed = 4242;
    p.export.sampleRate = 48000;
    p.export.clickCount = 3;
    p.export.distMin = 0.2;
    p.export.burstScenario = 'thrash';
    p.export.burstSeconds = 1;
    p.export.idleSeconds = 1;
    p.export.loopSeconds = 1;
    p.spindle.spinUpS = 1;
    p.spindle.spinDownS = 1;
    p.mix.headDb = -3;
    p.mix.spindleDb = -9;
    p.mix.masterDb = -2;
    p.rw.mode = 'separate';
    p.rw.writePitchPct = -10;
    p.click.resonators[0].freq = 1234;
    p.filters.lpMode = 'separate';
    Object.assign(p.filters.lp.head, { on: true, hz: 2500, resDb: 6, slope: 24 });
    const paramFile = join(dir, 'params.json');
    writeFileSync(paramFile, JSON.stringify(p));
    const out = join(dir, 'out');
    execFileSync(process.execPath, [CLI, '--params', paramFile, '--out', out]);
    const cli = Object.fromEntries(readdirSync(out).map((name) => [name, readFileSync(join(out, name))]));
    const same = (files, what) => {
      for (const f of files) assert.ok(cli[f.name] && Buffer.from(f.data).equals(cli[f.name]), `${what}: ${f.name} differs from the command's`);
    };

    const all = pageExport('all', p);
    assert.equal(all.name, 'hdd-sim-export.zip');
    assert.equal(all.type, 'application/zip');
    const inZip = unzipStored(all.data);
    assert.deepEqual(inZip.map((f) => f.name).sort(), Object.keys(cli).sort());
    assert.ok(inZip.some((f) => f.name === 'click_write_01.wav'), 'separate write sound reached the export');
    same(inZip, 'all');

    const clicks = pageExport('clicks', p);
    assert.equal(clicks.name, 'hdd-clicks.zip');
    const clickFiles = unzipStored(clicks.data);
    assert.equal(clickFiles.length, 6);
    same(clickFiles, 'clicks');

    for (const kind of SEQUENCE_NAMES) {
      const one = pageExport(kind, p);
      assert.deepEqual([one.name, one.type], [`${kind}.wav`, 'audio/wav']);
      same([one], kind);
    }
    // The parameters matter: the defaults give other files.
    assert.ok(!Buffer.from(pageExport('burst', defaultParams()).data).equals(cli['burst.wav']));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('zip: the archive lists every file and unzip accepts it', () => {
  const files = exportClicks(defaultParams()).slice(0, 3);
  const zip = makeZip(files);
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(zip.length - 22 + 10, true), 3);
  const dir = mkdtempSync(join(tmpdir(), 'hdd-sim-zip-'));
  try {
    const path = join(dir, 'clicks.zip');
    writeFileSync(path, zip);
    let listing;
    try {
      listing = execFileSync('unzip', ['-t', path], { encoding: 'utf8' });
    } catch (err) {
      if (err.code === 'ENOENT') return; // unzip is not installed; the structure checks above stand
      throw err;
    }
    assert.match(listing, /No errors detected/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
