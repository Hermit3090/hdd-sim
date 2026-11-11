// The page: controls, light, live statistics, and export downloads.

import { exportAll, exportClicks, exportSequence } from '/dsp/export.js';
import {
  DEFAULT_PRESET, FILTER_LIMITS, PRESET_NAMES, RESONATOR_LIMITS, SCENARIO_NAMES, SCHEMA,
  applyPreset, defaultParams, getPath, sanitizeParams, scenarioParams, setPath,
} from '/dsp/params.js';
import { makeZip } from '/dsp/zip.js';

const STORE_KEY = 'hdd-sim-params';
const LIVE_TIMEOUT_MS = 1000;
const $ = (id) => document.getElementById(id);

let params = loadStored();
let audio = null; // { ctx, node } once sound has been started
let mode = 'live'; // R8.11
let pushQueued = false;
const FILE_KEY = 'hdd-sim-file';
let loadedFile = ''; // name of the parameter file the settings came from, if any
let presetFiles = []; // file names in the server's preset folder (R8.14)
try {
  loadedFile = localStorage.getItem(FILE_KEY) || '';
} catch {
  /* storage may be unavailable */
}

function setLoadedFile(name) {
  loadedFile = name;
  try {
    localStorage.setItem(FILE_KEY, name);
  } catch {
    /* storage may be unavailable */
  }
}

// The preset selector: shipped presets, then the files of the preset folder
// and, if it is not one of them, the file loaded by hand.
function buildPresetSelect() {
  const select = $('preset');
  select.textContent = '';
  const builtIn = document.createElement('optgroup');
  builtIn.label = 'Built-in';
  for (const name of PRESET_NAMES) builtIn.append(new Option(name, name));
  select.append(builtIn);
  const names = presetFiles.includes(loadedFile) || !loadedFile ? presetFiles : [...presetFiles, loadedFile];
  if (names.length > 0) {
    const files = document.createElement('optgroup');
    files.label = 'Files';
    for (const name of names) files.append(new Option(name.replace(/\.json$/i, ''), `file:${name}`));
    select.append(files);
  }
  select.value = loadedFile ? `file:${loadedFile}` : params.preset;
}

async function refreshPresetFiles() {
  let names = [];
  try {
    const res = await fetch('/presets/');
    if (res.ok) names = (await res.json()).filter((n) => typeof n === 'string');
  } catch {
    /* without the list the selector shows the shipped presets only */
  }
  if (names.join('\n') === presetFiles.join('\n')) return;
  presetFiles = names;
  buildPresetSelect();
}

// Takes over a parsed parameter file. The master volume is the listener's.
function loadParamsObject(loaded, name) {
  if (loaded === null || typeof loaded !== 'object' || Array.isArray(loaded)) throw new Error('not a parameter object');
  const masterDb = params.mix.masterDb;
  params = sanitizeParams(loaded);
  params.mix.masterDb = masterDb;
  setLoadedFile(name);
  refreshAll();
  pushParams();
  setParamsStatus(`Loaded ${name}.`);
}

function loadStored() {
  try {
    const text = localStorage.getItem(STORE_KEY);
    if (text) return sanitizeParams(JSON.parse(text));
  } catch {
    /* fall through to defaults */
  }
  return defaultParams();
}

function post(message) {
  if (audio) audio.node.port.postMessage(message);
}

// Sends the current parameters to the engine, at most once per frame.
function pushParams() {
  if (pushQueued) return;
  pushQueued = true;
  requestAnimationFrame(() => {
    pushQueued = false;
    // `params` itself is left in place: the controls hold on to its parts.
    const clean = sanitizeParams(params);
    post({ type: 'params', params: clean });
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(clean));
    } catch {
      /* storage may be unavailable; the page works without it */
    }
  });
}

// ---------- controls built from the schema ----------

const refreshers = [];

function decimals(step) {
  const text = String(step);
  return text.includes('.') ? text.split('.')[1].length : 0;
}

function buildControl(item) {
  const row = document.createElement('div');
  row.className = 'row';
  // R8.10: a baseline setting shows only while its mode is selected.
  if (item.mode) refreshers.push(() => { row.hidden = params.live.baselineMode !== item.mode; });
  const id = `p-${item.path.replace(/\./g, '-')}`;
  if (item.type === 'bool') {
    const label = document.createElement('label');
    label.className = 'check';
    label.style.gridColumn = '1 / -1';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = id;
    label.append(box, ` ${item.label}`);
    row.append(label);
    box.addEventListener('change', () => {
      setPath(params, item.path, box.checked);
      pushParams();
    });
    refreshers.push(() => { box.checked = !!getPath(params, item.path); });
    return row;
  }
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = item.label;
  const range = document.createElement('input');
  range.type = 'range';
  range.id = id;
  const number = document.createElement('input');
  number.type = 'number';
  number.setAttribute('aria-label', `${item.label}, value`);
  for (const el of [range, number]) {
    el.min = item.min;
    el.max = item.max;
    el.step = item.step;
  }
  const unit = document.createElement('span');
  unit.className = 'unit';
  unit.textContent = item.unit || '';
  row.append(label, range, number, unit);

  const digits = decimals(item.step);
  const show = (v) => {
    range.value = v;
    number.value = Number(v).toFixed(digits);
  };
  const apply = (raw) => {
    let v = Number(raw);
    if (!Number.isFinite(v)) v = getPath(params, item.path);
    v = Math.min(item.max, Math.max(item.min, v));
    setPath(params, item.path, v);
    show(v);
    pushParams();
  };
  range.addEventListener('input', () => apply(range.value));
  number.addEventListener('change', () => apply(number.value));
  refreshers.push(() => show(getPath(params, item.path)));
  return row;
}

function buildControls() {
  for (const box of document.querySelectorAll('[data-group]')) {
    for (const item of SCHEMA) {
      if (item.group === box.dataset.group) box.append(buildControl(item));
    }
  }
}

function fillSelect(select, names) {
  for (const name of names) select.append(new Option(name, name));
}

// ---------- resonator table ----------

function buildResonators() {
  const body = document.querySelector('#resonators tbody');
  body.textContent = '';
  const list = params.click.resonators;
  list.forEach((res, index) => {
    const tr = document.createElement('tr');
    for (const [key, step] of [['freq', 1], ['decayMs', 0.5], ['gainDb', 0.5]]) {
      const td = document.createElement('td');
      const input = document.createElement('input');
      input.type = 'number';
      [input.min, input.max] = RESONATOR_LIMITS[key];
      input.step = step;
      input.value = res[key];
      input.setAttribute('aria-label', `Resonator ${index + 1} ${key}`);
      input.addEventListener('change', () => {
        const [lo, hi] = RESONATOR_LIMITS[key];
        const v = Number(input.value);
        res[key] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : res[key];
        input.value = res[key];
        pushParams();
      });
      td.append(input);
      tr.append(td);
    }
    const td = document.createElement('td');
    const remove = document.createElement('button');
    remove.textContent = 'Remove';
    remove.disabled = list.length <= RESONATOR_LIMITS.count[0];
    remove.addEventListener('click', () => {
      list.splice(index, 1);
      buildResonators();
      pushParams();
    });
    td.append(remove);
    tr.append(td);
    body.append(tr);
  });
  $('add-resonator').disabled = list.length >= RESONATOR_LIMITS.count[1];
}

// ---------- filters ----------

const FILTER_ROWS = {
  combined: [['all', 'All parts']],
  separate: [['head', 'Head clicks'], ['motor', 'Motor tones'], ['air', 'Airflow noise'], ['whine', 'Bearing whine']],
};
const CUTOFF_STEPS = 1000; // slider positions, spread evenly over the octaves

function buildFilters(type) {
  const body = document.querySelector(`#${type}-filters tbody`);
  body.textContent = '';
  const [lo, hi] = FILTER_LIMITS.hz;
  const toHz = (pos) => Math.round(lo * Math.pow(hi / lo, pos / CUTOFF_STEPS));
  const toPos = (hz) => Math.round((CUTOFF_STEPS * Math.log(hz / lo)) / Math.log(hi / lo));
  const kind = type === 'hp' ? 'high-pass' : 'low-pass';
  for (const [target, title] of FILTER_ROWS[params.filters[`${type}Mode`]]) {
    const f = params.filters[type][target];
    const tr = document.createElement('tr');
    const cell = (...nodes) => {
      const td = document.createElement('td');
      td.append(...nodes);
      tr.append(td);
    };
    const on = document.createElement('input');
    on.type = 'checkbox';
    on.checked = f.on;
    const name = document.createElement('label');
    name.className = 'check';
    name.append(on, ` ${title}`);
    on.addEventListener('change', () => { f.on = on.checked; pushParams(); });

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = 0;
    slider.max = CUTOFF_STEPS;
    slider.value = toPos(f.hz);
    slider.setAttribute('aria-label', `${title} ${kind} cutoff`);
    const hz = document.createElement('input');
    hz.type = 'number';
    [hz.min, hz.max] = FILTER_LIMITS.hz;
    hz.value = f.hz;
    hz.title = 'Cutoff in Hz';
    hz.setAttribute('aria-label', `${title} ${kind} cutoff in Hz`);
    const setHz = (v) => {
      f.hz = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : f.hz;
      hz.value = f.hz;
      slider.value = toPos(f.hz);
      pushParams();
    };
    slider.addEventListener('input', () => setHz(toHz(Number(slider.value))));
    hz.addEventListener('change', () => setHz(Number(hz.value)));

    const res = document.createElement('input');
    res.type = 'number';
    [res.min, res.max] = FILTER_LIMITS.resDb;
    res.step = 0.5;
    res.value = f.resDb;
    res.title = 'Resonance in dB';
    res.setAttribute('aria-label', `${title} ${kind} resonance in dB`);
    res.addEventListener('change', () => {
      const v = Number(res.value);
      const [rLo, rHi] = FILTER_LIMITS.resDb;
      f.resDb = Number.isFinite(v) ? Math.min(rHi, Math.max(rLo, v)) : f.resDb;
      res.value = f.resDb;
      pushParams();
    });

    const slope = document.createElement('select');
    slope.setAttribute('aria-label', `${title} ${kind} slope`);
    for (const s of FILTER_LIMITS.slopes) slope.append(new Option(`${s} dB/oct`, s));
    slope.value = f.slope;
    slope.addEventListener('change', () => { f.slope = Number(slope.value); pushParams(); });

    cell(name);
    cell(slider);
    cell(hz, ' Hz');
    cell(res, ' dB');
    cell(slope);
    body.append(tr);
  }
}

function harmonicsText() {
  return params.spindle.harmonics.map((h) => `${h.n}:${h.db}`).join(', ');
}

function parseHarmonics(text) {
  const list = [];
  for (const part of text.split(',')) {
    const m = part.trim().match(/^(\d+)\s*:\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return null;
    list.push({ n: Number(m[1]), db: Number(m[2]) });
  }
  return list.length ? list : null;
}

/** Shows the current parameters in every control. */
function refreshAll() {
  for (const fn of refreshers) fn();
  buildPresetSelect();
  $('scenario').value = params.scenario;
  $('export-scenario').value = params.export.burstScenario;
  $('export-rate').value = params.export.sampleRate;
  $('light-color').value = params.light.color;
  $('lamp').dataset.color = params.light.color;
  $('seed').value = params.seed;
  $('harmonics').value = harmonicsText();
  $('rw-mode').value = params.rw.mode;
  $('seek-write').hidden = params.rw.mode !== 'separate';
  $('seek').textContent = params.rw.mode === 'separate' ? 'Seek (read)' : 'Seek';
  $('baseline-mode').value = params.live.baselineMode;
  $('hp-mode').value = params.filters.hpMode;
  $('lp-mode').value = params.filters.lpMode;
  buildFilters('hp');
  buildFilters('lp');
  buildResonators();
}

// ---------- sound ----------

async function startAudio() {
  if (audio) {
    if (audio.ctx.state === 'suspended') await audio.ctx.resume();
    return;
  }
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule('/worklet.js');
  const node = new AudioWorkletNode(ctx, 'hdd-sim', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { params: sanitizeParams(params) },
  });
  node.port.onmessage = (event) => showState(event.data);
  node.connect(ctx.destination);
  audio = { ctx, node };
  post({ type: 'mode', mode });
  post({ type: 'mute', muted: $('mute').checked });
}

const STATE_TEXT = {
  stopped: 'Stopped.',
  up: 'Spinning up…',
  ready: 'Ready.',
  down: 'Spinning down…',
};

function showState(state) {
  $('lamp').style.setProperty('--b', state.light.toFixed(3));
  const queue = state.queue > 0 ? ` Queue: ${state.queue}.` : '';
  $('drive-state').textContent = `${STATE_TEXT[state.spindle] || ''}${queue}`;
  // R8.10
  let text = 'Baseline off: all activity is normal.';
  if (params.live.baselineMode === 'adaptive') {
    text = `Activity level: ${Math.round(state.level * 100)} %.`;
  } else if (params.live.baselineMode === 'manual') {
    const rated = state.rate > 0 ? (state.background ? 'background' : 'normal') : 'none';
    text = `Baseline: ${state.baseline.toFixed(1)} operations/s. Last second: ${state.rate} operations, rated ${rated}.`;
  }
  if ($('baseline-status').textContent !== text) $('baseline-status').textContent = text;
}

async function spin(up) {
  try {
    await startAudio();
    post({ type: 'spin', up });
  } catch (err) {
    $('drive-state').textContent = `Sound could not be started: ${err.message}`;
    $('drive-state').classList.add('error');
  }
}

// ---------- live mode ----------

let stream = null;
let lastLive = 0;
let knownDevices = '';

function setLiveStatus(text, isError = false) {
  $('live-status').textContent = text;
  $('live-status').classList.toggle('error', isError);
}

function onLive(event) {
  const m = JSON.parse(event.data);
  if (m.unavailable) {
    lastLive = 0;
    setLiveStatus('Live data is unavailable: this system has no /proc/diskstats.', true);
    return;
  }
  lastLive = performance.now();
  const names = Object.keys(m.devices);
  if (names.join() !== knownDevices) {
    knownDevices = names.join();
    const select = $('device');
    const chosen = select.value;
    select.length = 1;
    fillSelect(select, names);
    select.value = names.includes(chosen) ? chosen : '*';
  }
  const pick = $('device').value;
  let ops = 0;
  let writeOps = 0;
  let bytes = 0;
  for (const name of names) {
    if (pick !== '*' && pick !== name) continue;
    const [reads, writes, bytesRead, bytesWritten] = m.devices[name];
    ops += reads + writes;
    writeOps += writes;
    bytes += bytesRead + bytesWritten;
  }
  // Samples without activity are sent too: the idle baseline is built from them.
  post({ type: 'feed', ops, writes: writeOps, bytes, interval: m.dt });
  const rate = `${Math.round(ops / m.dt)} operations/s, ${(bytes / m.dt / 1e6).toFixed(1)} MB/s`;
  setLiveStatus(audio ? rate : `${rate}. Press Spin up to hear and see it.`);
}

function setMode(next) {
  mode = next;
  $('live-box').hidden = mode !== 'live';
  $('sim-box').hidden = mode !== 'sim';
  post({ type: 'mode', mode });
  if (mode === 'live' && !stream) {
    setLiveStatus('Connecting…');
    stream = new EventSource('/stats');
    stream.onmessage = onLive;
  } else if (mode !== 'live' && stream) {
    stream.close();
    stream = null;
  }
}

// With no data for a second the drive simply receives no activity and goes
// idle; this only tells the user why (R8.5).
setInterval(() => {
  if (mode === 'live' && performance.now() - lastLive > LIVE_TIMEOUT_MS && lastLive !== 0) {
    setLiveStatus('Live data is unavailable: no statistics from the server. Is it still running?', true);
  } else if (mode === 'live' && lastLive === 0 && stream && stream.readyState === EventSource.CONNECTING) {
    setLiveStatus('Live data is unavailable: cannot reach the server.', true);
  }
}, 500);

// ---------- export and parameter files ----------

function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function runExport(what) {
  const status = $('export-status');
  status.classList.remove('error');
  status.textContent = 'Rendering…';
  // Let the status text paint before the render blocks the page.
  setTimeout(() => {
    try {
      const p = sanitizeParams(params);
      if (what === 'clicks') {
        const files = exportClicks(p);
        download('hdd-clicks.zip', makeZip(files), 'application/zip');
        status.textContent = `Saved ${files.length} clicks in hdd-clicks.zip.`;
      } else if (what === 'all') {
        const files = exportAll(p);
        download('hdd-sim-export.zip', makeZip(files), 'application/zip');
        status.textContent = `Saved ${files.length} files in hdd-sim-export.zip.`;
      } else {
        const file = exportSequence(what, p);
        download(file.name, file.data, 'audio/wav');
        status.textContent = `Saved ${file.name}.`;
      }
    } catch (err) {
      status.textContent = `Export failed: ${err.message}`;
      status.classList.add('error');
    }
  }, 30);
}

function setParamsStatus(text, isError = false) {
  $('params-status').textContent = text;
  $('params-status').classList.toggle('error', isError);
}

// ---------- wiring ----------

function init() {
  buildControls();
  fillSelect($('scenario'), SCENARIO_NAMES);
  fillSelect($('export-scenario'), SCENARIO_NAMES);
  refreshAll();
  setMode(mode);
  refreshPresetFiles();
  for (const type of ['focus', 'pointerdown']) $('preset').addEventListener(type, refreshPresetFiles);

  $('spin-up').addEventListener('click', () => spin(true));
  $('spin-down').addEventListener('click', () => spin(false));
  $('mute').addEventListener('change', () => post({ type: 'mute', muted: $('mute').checked }));
  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.addEventListener('change', () => { if (radio.checked) setMode(radio.value); });
  }

  $('seek-dist').addEventListener('input', () => {
    $('seek-dist-out').textContent = Number($('seek-dist').value).toFixed(2);
  });
  for (const [id, write] of [['seek', false], ['seek-write', true]]) {
    $(id).addEventListener('click', async () => {
      try {
        await startAudio();
        post({ type: 'seek', dist: Number($('seek-dist').value), write });
      } catch (err) {
        $('drive-state').textContent = `Sound could not be started: ${err.message}`;
      }
    });
  }
  $('rw-mode').addEventListener('change', () => {
    params.rw.mode = $('rw-mode').value;
    refreshAll();
    pushParams();
  });
  $('baseline-mode').addEventListener('change', () => {
    params.live.baselineMode = $('baseline-mode').value;
    refreshAll();
    pushParams();
  });
  $('device').addEventListener('change', () => post({ type: 'baseline-reset' }));
  for (const type of ['hp', 'lp']) {
    $(`${type}-mode`).addEventListener('change', () => {
      params.filters[`${type}Mode`] = $(`${type}-mode`).value;
      buildFilters(type);
      pushParams();
    });
  }

  $('preset').addEventListener('change', () => {
    const choice = $('preset').value;
    if (choice.startsWith('file:')) {
      const name = choice.slice(5);
      if (!presetFiles.includes(name)) return; // loaded by hand; there is nothing to read again
      fetch(`/presets/${encodeURIComponent(name)}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error('the server did not return it'))))
        .then((loaded) => loadParamsObject(loaded, name))
        .catch((err) => {
          setParamsStatus(`${name} could not be loaded: ${err.message}`, true);
          buildPresetSelect();
        });
      return;
    }
    setLoadedFile('');
    applyPreset(params, choice);
    refreshAll();
    pushParams();
  });
  $('scenario').addEventListener('change', () => {
    params.scenario = $('scenario').value;
    params.sim = scenarioParams(params.scenario);
    refreshAll();
    pushParams();
  });
  $('export-scenario').addEventListener('change', () => {
    params.export.burstScenario = $('export-scenario').value;
    pushParams();
  });
  $('export-rate').addEventListener('change', () => {
    params.export.sampleRate = Number($('export-rate').value);
    pushParams();
  });
  $('light-color').addEventListener('change', () => {
    params.light.color = $('light-color').value;
    $('lamp').dataset.color = params.light.color;
    pushParams();
  });
  $('seed').addEventListener('change', () => {
    const v = Number($('seed').value);
    if (Number.isInteger(v) && v >= 0) params.seed = v;
    $('seed').value = params.seed;
    pushParams();
  });
  $('harmonics').addEventListener('change', () => {
    const list = parseHarmonics($('harmonics').value);
    if (list) params.spindle.harmonics = list;
    params = sanitizeParams(params);
    refreshAll(); // the tables must point at the new object
    pushParams();
  });
  $('add-resonator').addEventListener('click', () => {
    params.click.resonators.push({ freq: 2500, decayMs: 6, gainDb: -6 });
    buildResonators();
    pushParams();
  });

  for (const button of document.querySelectorAll('[data-export]')) {
    button.addEventListener('click', () => runExport(button.dataset.export));
  }

  $('params-export').addEventListener('click', () => {
    download('hdd-sim-params.json', JSON.stringify(sanitizeParams(params), null, 2), 'application/json');
    setParamsStatus('Saved hdd-sim-params.json.');
  });
  $('params-import').addEventListener('click', () => $('params-file').click());
  $('params-file').addEventListener('change', async () => {
    const file = $('params-file').files[0];
    $('params-file').value = '';
    if (!file) return;
    try {
      loadParamsObject(JSON.parse(await file.text()), file.name);
    } catch (err) {
      setParamsStatus(`${file.name} could not be loaded: ${err.message}`, true);
    }
  });
  $('params-reset').addEventListener('click', () => {
    const preset = params.preset || DEFAULT_PRESET;
    const masterDb = params.mix.masterDb;
    params = defaultParams(preset);
    params.mix.masterDb = masterDb;
    setLoadedFile('');
    refreshAll();
    pushParams();
    setParamsStatus(`Reset to the ${preset} defaults.`);
  });
}

init();
