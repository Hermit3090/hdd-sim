// Hostile parameter files (R4.5). Parameter files are shared between users,
// so reading one must use only own, known fields: a hostile file can at worst
// give default values, and never throws, pollutes or carries anything along.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderSequence } from '../src/dsp/export.js';
import {
  DEFAULT_PRESET, DEFAULT_SCENARIO, FILTER_TARGETS, PRESET_NAMES, SCHEMA, applyPreset, defaultParams,
  getPath, presetParams, sanitizeParams, scenarioParams,
} from '../src/dsp/params.js';

const PROTO_NAMES = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'prototype', '__defineGetter__'];

/** Key structure and value types, so extra or missing fields show up. */
function shape(v) {
  if (Array.isArray(v)) return v.map(shape);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = shape(v[k]);
    return out;
  }
  return typeof v;
}

function assertClean(p, what) {
  const reference = defaultParams(p.preset);
  assert.deepEqual(Object.keys(p).sort(), Object.keys(reference).sort(), `${what}: top-level fields`);
  for (const key of ['drive', 'click', 'spindle', 'live', 'pattern', 'rw', 'light', 'mix', 'sim', 'export', 'filters']) {
    assert.deepEqual(shape({ ...p[key], resonators: undefined, harmonics: undefined }),
      shape({ ...reference[key], resonators: undefined, harmonics: undefined }), `${what}: fields of ${key}`);
  }
  // Every value is plain data: it survives JSON unchanged and every number is finite.
  assert.deepEqual(JSON.parse(JSON.stringify(p)), p, `${what}: plain JSON data`);
  const walk = (v) => {
    if (typeof v === 'number') assert.ok(Number.isFinite(v), `${what}: finite numbers`);
    else if (v && typeof v === 'object') {
      assert.equal(Object.getPrototypeOf(v), Array.isArray(v) ? Array.prototype : Object.prototype, `${what}: plain objects`);
      Object.values(v).forEach(walk);
    }
  };
  walk(p);
  assert.ok(PRESET_NAMES.includes(p.preset));
}

test('R4.5: preset and scenario names from a file are looked up as own names; others fall back', () => {
  for (const name of PROTO_NAMES) {
    for (const text of [
      `{"preset":"${name}"}`,
      `{"scenario":"${name}"}`,
      `{"export":{"burstScenario":"${name}"}}`,
      `{"preset":"${name}","scenario":"${name}","export":{"burstScenario":"${name}"}}`,
    ]) {
      const p = sanitizeParams(JSON.parse(text));
      assertClean(p, text);
      assert.equal(p.preset, DEFAULT_PRESET, text);
      assert.equal(p.scenario, DEFAULT_SCENARIO, text);
      assert.equal(p.export.burstScenario, DEFAULT_SCENARIO, text);
      assert.deepEqual(p, defaultParams(), `${text} loads the defaults`);
    }
    assert.deepEqual(presetParams(name), presetParams(DEFAULT_PRESET), name);
    assert.deepEqual(scenarioParams(name), scenarioParams(DEFAULT_SCENARIO), name);
    assert.deepEqual(defaultParams(name), defaultParams(), name);
    assert.equal(applyPreset(defaultParams(), name).preset, DEFAULT_PRESET, name);
  }
  // The documented fallback also holds for an export of the burst sequence.
  const p = sanitizeParams(JSON.parse('{"export":{"burstScenario":"constructor","burstSeconds":1,"sampleRate":44100}}'));
  const fallback = sanitizeParams({ export: { burstScenario: DEFAULT_SCENARIO, burstSeconds: 1, sampleRate: 44100 } });
  assert.deepEqual(renderSequence('burst', p), renderSequence('burst', fallback));
});

test('R4.5: only own, known fields of a file are used; prototypes are not touched', () => {
  const before = Object.getOwnPropertyNames(Object.prototype).sort();
  const hostile = [
    '{"__proto__":{"seed":5,"polluted":1},"constructor":{"prototype":{"polluted":1}},"seed":3}',
    '{"drive":{"__proto__":{"rpm":7000,"polluted":1}},"mix":{"constructor":{"prototype":{"polluted":1}}}}',
    '{"click":{"resonators":[{"__proto__":{"freq":5000}},[1,2,3],"x",null,{"freq":2000}]}}',
    '{"filters":{"__proto__":{"hpMode":"separate"},"hp":{"all":{"__proto__":{"on":true}}}}}',
    '{"bogus":{"deep":[1,{"a":2}]},"preset":{"name":"laptop-2000s"},"version":"1"}',
  ];
  for (const text of hostile) {
    const p = sanitizeParams(JSON.parse(text));
    assertClean(p, text);
    assert.equal(({}).polluted, undefined, `${text}: no pollution`);
  }
  assert.equal(sanitizeParams(JSON.parse(hostile[0])).seed, 3);
  assert.equal(sanitizeParams(JSON.parse(hostile[1])).drive.rpm, defaultParams().drive.rpm);
  assert.deepEqual(sanitizeParams(JSON.parse(hostile[2])).click.resonators,
    [{ freq: 1500, decayMs: 7, gainDb: 0 }, { freq: 2000, decayMs: 7, gainDb: 0 }]);
  assert.equal(sanitizeParams(JSON.parse(hostile[3])).filters.hpMode, defaultParams().filters.hpMode);
  assert.deepEqual(Object.getOwnPropertyNames(Object.prototype).sort(), before);

  // Inherited fields of a non-JSON object are not read either.
  const inherited = Object.create({ seed: 77, preset: 'laptop-2000s', mix: { headDb: 3 } });
  assert.deepEqual(sanitizeParams(inherited), defaultParams());
  const drive = Object.create({ rpm: 7000 });
  assert.equal(sanitizeParams({ drive }).drive.rpm, defaultParams().drive.rpm);

  // Things that are not a parameter object at all.
  for (const value of [null, 0, 'text', true, [], [1, 2], ['preset']]) {
    assert.deepEqual(sanitizeParams(value), defaultParams(), JSON.stringify(value));
  }
});

test('R4.5: numbers that are not finite fall back to the preset value, the filter fields included', () => {
  const defaults = defaultParams('laptop-2000s');
  for (const bad of [Infinity, -Infinity, NaN]) {
    const p = defaultParams('laptop-2000s');
    for (const type of ['hp', 'lp']) {
      for (const target of FILTER_TARGETS) Object.assign(p.filters[type][target], { hz: bad, resDb: bad, slope: bad });
    }
    for (const item of SCHEMA) if (item.type !== 'bool') {
      const keys = item.path.split('.');
      getPath(p, keys.slice(0, -1).join('.'))[keys.at(-1)] = bad;
    }
    p.seed = bad;
    p.click.resonators = [{ freq: bad, decayMs: bad, gainDb: bad }, { freq: bad, decayMs: bad, gainDb: bad }];
    p.spindle.harmonics = [{ n: bad, db: bad }];
    const s = sanitizeParams(p);
    assertClean(s, `${bad}`);
    assert.deepEqual(s.filters, defaults.filters, `${bad}: filters fall back`);
    for (const item of SCHEMA) if (item.type !== 'bool') {
      assert.equal(getPath(s, item.path), getPath(defaults, item.path), `${bad}: ${item.path}`);
    }
  }
  // Overflowing JSON numbers are infinite after parsing.
  const text = '{"preset":"laptop-2000s","filters":{"hp":{"all":{"hz":1e400,"resDb":-1e400}}},"drive":{"rpm":1e400}}';
  const s = sanitizeParams(JSON.parse(text));
  assert.equal(s.filters.hp.all.hz, defaults.filters.hp.all.hz);
  assert.equal(s.filters.hp.all.resDb, defaults.filters.hp.all.resDb);
  assert.equal(s.drive.rpm, defaults.drive.rpm);
});

test('R4.5: long lists in a file are shortened and their entries rebuilt', () => {
  const many = Array.from({ length: 50000 }, (_, i) => ({ freq: 1000 + i, decayMs: 5, gainDb: 0 }));
  const p = sanitizeParams({ click: { resonators: many }, spindle: { harmonics: many.map(() => ({ n: 2, db: -3 })) } });
  assert.equal(p.click.resonators.length, 8);
  assert.equal(p.spindle.harmonics.length, 16);
  assert.notEqual(p.click.resonators[0], many[0], 'entries are rebuilt, not shared');
  assertClean(p, 'long lists');
});
