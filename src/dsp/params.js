// The single parameter object (spec R4.5): defaults, presets, scenarios,
// the schema the page builds its controls from, and validation.

export const SAMPLE_RATES = [44100, 48000];
export const SILENCE_DB = -60; // gain sliders at this value mean exact silence
// Spindle part levels reach further down: a narrow whine at -60 dB is still
// audible on headphones, so these need room for fine adjustment below that.
export const PART_SILENCE_DB = -100;
export const PARAMS_VERSION = 2;
export const LIGHT_COLORS = ['red', 'green', 'amber'];
export const FILTER_TARGETS = ['all', 'head', 'motor', 'air', 'whine']; // 'all' is the combined filter
export const FILTER_LIMITS = { hz: [20, 20000], resDb: [0, 24], slopes: [12, 24] };
export const SPLIT_MODES = ['combined', 'separate'];
export const BASELINE_MODES = ['off', 'manual', 'adaptive'];

/** dB to linear gain; at or below the floor the gain is exactly 0. */
export function dbToGain(db, floor = SILENCE_DB) {
  return db <= floor ? 0 : Math.pow(10, db / 20);
}

const DEFAULT_MASTER_DB = -6;

// One filter per target, all off.
function filterSet(hz) {
  const set = {};
  for (const target of FILTER_TARGETS) set[target] = { on: false, hz, resDb: 0, slope: 12 };
  return set;
}

const PRESETS = {
  'laptop-2000s': {
    drive: {
      rpm: 4200, settleMs: 2, fullStrokeMs: 22, transferMBps: 8, queueMax: 64,
      maxTransferMs: 30, idleRecal: true, idleAfterS: 5, recalMinS: 20, recalMaxS: 60,
    },
    click: {
      levelDb: -6, burstMs: 1.5,
      resonators: [
        { freq: 1115, decayMs: 9, gainDb: -3 },
        { freq: 1390, decayMs: 10, gainDb: 0 },
        { freq: 1600, decayMs: 8, gainDb: -1.5 },
        { freq: 1935, decayMs: 9, gainDb: 0 },
        { freq: 3620, decayMs: 6, gainDb: 0 },
      ],
      body: { freq: 175, decayMs: 15, gainDb: -6 },
      varFreqPct: 4, varLevelDb: 3, varDecayPct: 20,
      pairThreshold: 0.3, distLevelDb: 3, brightnessDb: 4,
    },
    spindle: {
      motorDb: -24, harmonics: [{ n: 1, db: 0 }, { n: 10, db: -25 }, { n: 12, db: -28 }],
      whineHz: 4300, whineDb: PART_SILENCE_DB, noiseDb: -44, noiseHz: 900, noiseQ: 0.7,
      wobble: 0.15, spinUpS: 4, spinDownS: 6, unlockClicks: true,
    },
  },
  'desktop-90s': {
    drive: {
      rpm: 5400, settleMs: 2, fullStrokeMs: 22, transferMBps: 8, queueMax: 64,
      maxTransferMs: 30, idleRecal: true, idleAfterS: 5, recalMinS: 20, recalMaxS: 60,
    },
    click: {
      levelDb: 0, burstMs: 1.2,
      resonators: [
        { freq: 850, decayMs: 9, gainDb: 0 },
        { freq: 1430, decayMs: 8, gainDb: 0 },
        { freq: 2100, decayMs: 6, gainDb: -2 },
        { freq: 3100, decayMs: 4, gainDb: -4 },
      ],
      body: { freq: 300, decayMs: 15, gainDb: -3 },
      varFreqPct: 4, varLevelDb: 3, varDecayPct: 20,
      pairThreshold: 0.3, distLevelDb: 8, brightnessDb: 5,
    },
    spindle: {
      motorDb: -22, harmonics: [{ n: 1, db: 0 }, { n: 10, db: -21 }, { n: 12, db: -26 }],
      whineHz: 4300, whineDb: -36, noiseDb: -38, noiseHz: 1500, noiseQ: 0.7,
      wobble: 0.15, spinUpS: 4, spinDownS: 6, unlockClicks: true,
    },
  },
};

// The owner's tuning of desktop-90s: the same drive with a quieter bearing whine.
PRESETS['desktop-90s-2'] = JSON.parse(JSON.stringify(PRESETS['desktop-90s']));
Object.assign(PRESETS['desktop-90s-2'].spindle, { whineHz: 4320, whineDb: -56 });

// A preset also sets read and write sound, light, head and spindle volume
// and all filters (R6.14). Filter defaults: R6.17.
for (const name of Object.keys(PRESETS)) {
  const hp = filterSet(150);
  const lp = filterSet(4000);
  hp.all.on = true;
  let lpMode = 'combined';
  if (name === 'laptop-2000s') {
    lp.all.on = true;
  } else {
    lpMode = 'separate';
    Object.assign(lp.head, { on: true, hz: 3606, resDb: 1.5 });
    Object.assign(lp.motor, { on: true, hz: 5848 });
    Object.assign(lp.air, { on: true, hz: 9100 });
    Object.assign(lp.whine, { on: true, hz: 1897 });
  }
  Object.assign(PRESETS[name], {
    rw: { mode: 'combined', writePitchPct: -6, writeLevelDb: 0 },
    light: { onMs: 2, offMs: 30, color: 'green' },
    mix: { headDb: -11.5, spindleDb: 0 },
    filters: { hpMode: 'combined', lpMode, hp, lp },
  });
}

const SCENARIOS = {
  'idle': { opsPerSec: 0, burstiness: 0, burstLen: 5, seekSpread: 0.7, readMix: 0.8, opSizeKB: 32 },
  'light desktop use': { opsPerSec: 4, burstiness: 0.85, burstLen: 5, seekSpread: 0.7, readMix: 0.7, opSizeKB: 32 },
  'boot': { opsPerSec: 30, burstiness: 0.5, burstLen: 20, seekSpread: 0.6, readMix: 0.9, opSizeKB: 64 },
  'file copy': { opsPerSec: 80, burstiness: 0.1, burstLen: 40, seekSpread: 0.08, readMix: 0.5, opSizeKB: 256 },
  'thrash': { opsPerSec: 200, burstiness: 0.05, burstLen: 50, seekSpread: 1, readMix: 0.5, opSizeKB: 8 },
};

export const PRESET_NAMES = Object.keys(PRESETS);
export const SCENARIO_NAMES = Object.keys(SCENARIOS);
export const DEFAULT_PRESET = 'desktop-90s-2';
export const DEFAULT_SCENARIO = 'light desktop use';

const clone = (v) => JSON.parse(JSON.stringify(v));

/** Everything a preset sets (a fresh copy). The mix has no master volume. */
export function presetParams(name) {
  return clone(PRESETS[name] || PRESETS[DEFAULT_PRESET]);
}

/** Puts a preset's settings into a parameter object; the master volume stays. */
export function applyPreset(params, name) {
  const preset = presetParams(name);
  const masterDb = params.mix ? params.mix.masterDb : DEFAULT_MASTER_DB;
  Object.assign(params, preset, { preset: PRESETS[name] ? name : DEFAULT_PRESET });
  params.mix.masterDb = masterDb;
  return params;
}

/** Simulation parameters of a scenario (a fresh copy). */
export function scenarioParams(name) {
  return clone(SCENARIOS[name] || SCENARIOS[DEFAULT_SCENARIO]);
}

/** A complete parameter object. */
export function defaultParams(preset = DEFAULT_PRESET) {
  const name = PRESETS[preset] ? preset : DEFAULT_PRESET;
  return applyPreset({
    version: PARAMS_VERSION,
    seed: 1,
    preset: name,
    mix: { masterDb: DEFAULT_MASTER_DB },
    live: { baselineMode: 'adaptive', baselineOps: 16, rampUpS: 0.4, cooldownS: 8, bgLightPct: 28, bgClickDb: -15.5 },
    pattern: { on: true, readSpread: 0.9, writeSpread: 0.5, writeReach: 0.2, flushS: 5 },
    scenario: DEFAULT_SCENARIO,
    sim: scenarioParams(DEFAULT_SCENARIO),
    export: {
      sampleRate: 44100, clickCount: 16, distMin: 0.05, distMax: 1,
      burstScenario: 'light desktop use', burstSeconds: 8, loopSeconds: 4, idleSeconds: 20,
    },
  }, name);
}

// Numeric and boolean controls. `path` addresses the parameter object.
// The page builds its sliders from this list and validation clamps with it.
export const SCHEMA = [
  { group: 'Mix', path: 'mix.headDb', label: 'Head volume', min: -60, max: 6, step: 0.5, unit: 'dB' },
  { group: 'Mix', path: 'mix.spindleDb', label: 'Spindle volume', min: -60, max: 6, step: 0.5, unit: 'dB' },
  { group: 'Main', path: 'mix.masterDb', label: 'Master volume', min: -60, max: 6, step: 0.5, unit: 'dB' },

  { group: 'Simulation', path: 'sim.opsPerSec', label: 'Operations per second', min: 0, max: 500, step: 1, unit: '/s' },
  { group: 'Simulation', path: 'sim.burstiness', label: 'Burstiness', min: 0, max: 1, step: 0.01 },
  { group: 'Simulation', path: 'sim.burstLen', label: 'Mean burst length', min: 1, max: 100, step: 1, unit: 'ops' },
  { group: 'Simulation', path: 'sim.seekSpread', label: 'Seek-distance spread', min: 0, max: 1, step: 0.01 },
  { group: 'Simulation', path: 'sim.readMix', label: 'Read share', min: 0, max: 1, step: 0.01 },
  { group: 'Simulation', path: 'sim.opSizeKB', label: 'Mean operation size', min: 1, max: 4096, step: 1, unit: 'KB' },

  { group: 'Write sound', path: 'rw.writePitchPct', label: 'Write click pitch offset', min: -20, max: 20, step: 0.5, unit: '%' },
  { group: 'Write sound', path: 'rw.writeLevelDb', label: 'Write click level offset', min: -12, max: 12, step: 0.5, unit: 'dB' },

  { group: 'Baseline', path: 'live.baselineOps', label: 'Manual baseline', min: 0, max: 500, step: 1, unit: '/s' },
  { group: 'Baseline', path: 'live.rampUpS', label: 'Adaptive ramp-up time', min: 0.1, max: 10, step: 0.1, unit: 's' },
  { group: 'Baseline', path: 'live.cooldownS', label: 'Adaptive cooldown time', min: 1, max: 120, step: 1, unit: 's' },
  { group: 'Baseline', path: 'live.bgLightPct', label: 'Background brightness', min: 0, max: 100, step: 1, unit: '%' },
  { group: 'Baseline', path: 'live.bgClickDb', label: 'Background click level', min: -60, max: 0, step: 0.5, unit: 'dB' },

  { group: 'Pattern', path: 'pattern.on', label: 'Read/write pattern: writes flush close together, reads scatter', type: 'bool' },
  { group: 'Pattern', path: 'pattern.readSpread', label: 'Read seek spread', min: 0, max: 1, step: 0.01 },
  { group: 'Pattern', path: 'pattern.writeSpread', label: 'Write seek spread', min: 0, max: 1, step: 0.01 },
  { group: 'Pattern', path: 'pattern.writeReach', label: 'Write seek reach', min: 0.01, max: 1, step: 0.01 },
  { group: 'Pattern', path: 'pattern.flushS', label: 'Flush interval (simulation)', min: 0.5, max: 30, step: 0.5, unit: 's' },

  { group: 'Head click', path: 'click.levelDb', label: 'Click level', min: -30, max: 6, step: 0.5, unit: 'dB' },
  { group: 'Head click', path: 'click.burstMs', label: 'Noise burst length', min: 0.3, max: 3, step: 0.05, unit: 'ms' },
  { group: 'Head click', path: 'click.body.freq', label: 'Body frequency', min: 80, max: 600, step: 1, unit: 'Hz' },
  { group: 'Head click', path: 'click.body.decayMs', label: 'Body decay', min: 2, max: 18, step: 0.5, unit: 'ms' },
  { group: 'Head click', path: 'click.body.gainDb', label: 'Body level', min: -60, max: 6, step: 0.5, unit: 'dB' },
  { group: 'Head click', path: 'click.varFreqPct', label: 'Pitch variation', min: 0, max: 15, step: 0.5, unit: '%' },
  { group: 'Head click', path: 'click.varLevelDb', label: 'Level variation', min: 0, max: 9, step: 0.5, unit: 'dB' },
  { group: 'Head click', path: 'click.varDecayPct', label: 'Decay variation', min: 0, max: 50, step: 1, unit: '%' },
  { group: 'Head click', path: 'click.pairThreshold', label: 'Two-click seek threshold', min: 0, max: 1, step: 0.01 },
  { group: 'Head click', path: 'click.distLevelDb', label: 'Level rise with distance', min: 0, max: 20, step: 0.5, unit: 'dB' },
  { group: 'Head click', path: 'click.brightnessDb', label: 'Brightness rise with distance', min: 0, max: 12, step: 0.5, unit: 'dB/oct' },

  { group: 'Spindle', path: 'drive.rpm', label: 'Speed', min: 3600, max: 7200, step: 60, unit: 'rpm' },
  { group: 'Spindle', path: 'spindle.motorDb', label: 'Motor level', min: -100, max: 0, step: 0.5, unit: 'dB' },
  { group: 'Spindle', path: 'spindle.whineHz', label: 'Bearing whine frequency', min: 2000, max: 9000, step: 10, unit: 'Hz' },
  { group: 'Spindle', path: 'spindle.whineDb', label: 'Bearing whine level', min: -100, max: 0, step: 0.5, unit: 'dB' },
  { group: 'Spindle', path: 'spindle.noiseDb', label: 'Airflow noise level', min: -100, max: 0, step: 0.5, unit: 'dB' },
  { group: 'Spindle', path: 'spindle.noiseHz', label: 'Airflow noise centre', min: 200, max: 6000, step: 10, unit: 'Hz' },
  { group: 'Spindle', path: 'spindle.noiseQ', label: 'Airflow noise sharpness', min: 0.3, max: 8, step: 0.1 },
  { group: 'Spindle', path: 'spindle.wobble', label: 'Rotation wobble', min: 0, max: 1, step: 0.01 },
  { group: 'Spindle', path: 'spindle.spinUpS', label: 'Spin-up time', min: 0.5, max: 15, step: 0.1, unit: 's' },
  { group: 'Spindle', path: 'spindle.spinDownS', label: 'Spin-down time', min: 0.5, max: 20, step: 0.1, unit: 's' },
  { group: 'Spindle', path: 'spindle.unlockClicks', label: 'Head-unlock clicks after spin-up', type: 'bool' },

  { group: 'Drive model', path: 'drive.settleMs', label: 'Settle time', min: 0.5, max: 10, step: 0.1, unit: 'ms' },
  { group: 'Drive model', path: 'drive.fullStrokeMs', label: 'Full-stroke seek time', min: 5, max: 60, step: 0.5, unit: 'ms' },
  { group: 'Drive model', path: 'drive.transferMBps', label: 'Media transfer rate', min: 0.5, max: 100, step: 0.5, unit: 'MB/s' },
  { group: 'Drive model', path: 'drive.maxTransferMs', label: 'Longest single transfer', min: 5, max: 2000, step: 5, unit: 'ms' },
  { group: 'Drive model', path: 'drive.queueMax', label: 'Queue length', min: 1, max: 256, step: 1, unit: 'ops' },
  { group: 'Drive model', path: 'drive.idleRecal', label: 'Idle recalibration seeks', type: 'bool' },
  { group: 'Drive model', path: 'drive.idleAfterS', label: 'Idle time before recalibration', min: 0, max: 120, step: 1, unit: 's' },
  { group: 'Drive model', path: 'drive.recalMinS', label: 'Recalibration interval, shortest', min: 1, max: 300, step: 1, unit: 's' },
  { group: 'Drive model', path: 'drive.recalMaxS', label: 'Recalibration interval, longest', min: 1, max: 300, step: 1, unit: 's' },

  { group: 'Light', path: 'light.onMs', label: 'Rise time', min: 0.1, max: 50, step: 0.1, unit: 'ms' },
  { group: 'Light', path: 'light.offMs', label: 'Fall time', min: 1, max: 300, step: 1, unit: 'ms' },

  { group: 'Export', path: 'export.clickCount', label: 'Click variants', min: 1, max: 99, step: 1 },
  { group: 'Export', path: 'export.distMin', label: 'Shortest seek distance', min: 0.01, max: 1, step: 0.01 },
  { group: 'Export', path: 'export.distMax', label: 'Longest seek distance', min: 0.01, max: 1, step: 0.01 },
  { group: 'Export', path: 'export.burstSeconds', label: 'Burst length', min: 1, max: 60, step: 1, unit: 's' },
  { group: 'Export', path: 'export.loopSeconds', label: 'Spindle loop length', min: 1, max: 20, step: 0.5, unit: 's' },
  { group: 'Export', path: 'export.idleSeconds', label: 'Idle length', min: 1, max: 120, step: 1, unit: 's' },
];

export const RESONATOR_LIMITS = {
  count: [2, 8],
  freq: [100, 12000],
  decayMs: [1, 18],
  gainDb: [-60, 6],
};

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function merge(base, over) {
  if (over === null || typeof over !== 'object' || Array.isArray(over)) return base;
  for (const key of Object.keys(base)) {
    if (!(key in over)) continue;
    const b = base[key];
    const o = over[key];
    if (Array.isArray(b)) {
      if (Array.isArray(o)) base[key] = clone(o);
    } else if (b !== null && typeof b === 'object') {
      merge(b, o);
    } else if (typeof o === typeof b) {
      base[key] = o;
    }
  }
  return base;
}

/**
 * Returns a complete, valid parameter object. Missing values come from the
 * named preset, out-of-range values are clamped, unknown keys are dropped.
 */
export function sanitizeParams(input) {
  const src = input && typeof input === 'object' ? input : {};
  const p = merge(defaultParams(typeof src.preset === 'string' ? src.preset : DEFAULT_PRESET), src);
  if (src.version === 1) {
    // Version 1 switched spindle parts off at -60 dB; that is now an audible level.
    for (const key of ['motorDb', 'whineDb', 'noiseDb']) {
      if (p.spindle[key] <= SILENCE_DB) p.spindle[key] = PART_SILENCE_DB;
    }
  }
  p.version = PARAMS_VERSION;
  p.seed = Math.floor(clamp(num(p.seed, 1), 0, 0xffffffff));
  if (!PRESETS[p.preset]) p.preset = DEFAULT_PRESET;
  if (!SCENARIOS[p.scenario]) p.scenario = DEFAULT_SCENARIO;
  if (!SCENARIOS[p.export.burstScenario]) p.export.burstScenario = DEFAULT_SCENARIO;
  if (!SAMPLE_RATES.includes(p.export.sampleRate)) p.export.sampleRate = 44100;
  if (!LIGHT_COLORS.includes(p.light.color)) p.light.color = 'green';
  if (!SPLIT_MODES.includes(p.rw.mode)) p.rw.mode = 'combined';
  if (!BASELINE_MODES.includes(p.live.baselineMode)) p.live.baselineMode = 'adaptive';
  for (const type of ['hp', 'lp']) {
    if (!SPLIT_MODES.includes(p.filters[`${type}Mode`])) p.filters[`${type}Mode`] = 'combined';
    for (const target of FILTER_TARGETS) {
      const f = p.filters[type][target];
      const L = FILTER_LIMITS;
      f.hz = clamp(f.hz, L.hz[0], L.hz[1]);
      f.resDb = clamp(f.resDb, L.resDb[0], L.resDb[1]);
      if (!L.slopes.includes(f.slope)) f.slope = 12;
    }
  }

  const defaults = defaultParams(p.preset);
  for (const item of SCHEMA) {
    const fallback = getPath(defaults, item.path);
    const v = getPath(p, item.path);
    if (item.type === 'bool') setPath(p, item.path, typeof v === 'boolean' ? v : fallback);
    else setPath(p, item.path, clamp(num(v, fallback), item.min, item.max));
  }
  p.drive.queueMax = Math.round(p.drive.queueMax);
  p.export.clickCount = Math.round(p.export.clickCount);
  if (p.drive.fullStrokeMs < p.drive.settleMs) p.drive.fullStrokeMs = p.drive.settleMs;
  if (p.drive.recalMaxS < p.drive.recalMinS) p.drive.recalMaxS = p.drive.recalMinS;
  if (p.export.distMax < p.export.distMin) p.export.distMax = p.export.distMin;

  const L = RESONATOR_LIMITS;
  let res = p.click.resonators
    .filter((r) => r && typeof r === 'object')
    .slice(0, L.count[1])
    .map((r) => ({
      freq: clamp(num(r.freq, 1500), L.freq[0], L.freq[1]),
      decayMs: clamp(num(r.decayMs, 7), L.decayMs[0], L.decayMs[1]),
      gainDb: clamp(num(r.gainDb, 0), L.gainDb[0], L.gainDb[1]),
    }));
  if (res.length < L.count[0]) res = defaults.click.resonators;
  p.click.resonators = res;

  let harm = p.spindle.harmonics
    .filter((h) => h && typeof h === 'object')
    .slice(0, 16)
    .map((h) => ({ n: Math.round(clamp(num(h.n, 1), 1, 40)), db: clamp(num(h.db, 0), -60, 6) }));
  if (harm.length === 0) harm = defaults.spindle.harmonics;
  p.spindle.harmonics = harm;
  return p;
}
