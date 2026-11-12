// The page's own export handler (web/app.js, runExport) run in Node: the
// page module is loaded unchanged, with a small stand-in for the browser's
// document, storage and download, made from Node's built-in facilities only.
// Parameters are edited through the page's controls; every export button's
// downloaded bytes must equal the files of the command (R10.4, R10.5, A1).
//
// This is not a browser run: layout, real downloads and other browser
// engines stay with the owner's browser check.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { defaultParams, sanitizeParams } from '../src/dsp/params.js';

const CLI = join(import.meta.dirname, '..', 'cli', 'render.js');
const WEB_URL = new URL('../web/', import.meta.url).href;
const DSP_URL = new URL('../src/dsp/', import.meta.url).href;
const HTML = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');

// The page imports by server path; map them as the server's mounts do
// ('/dsp/' is src/dsp, everything else is web).
register(`data:text/javascript,${encodeURIComponent(`
  const web = ${JSON.stringify(WEB_URL)};
  const dsp = ${JSON.stringify(DSP_URL)};
  export async function resolve(specifier, context, next) {
    if (specifier.startsWith('/') && context.parentURL && context.parentURL.startsWith(web)) {
      const url = specifier.startsWith('/dsp/') ? new URL(specifier.slice(5), dsp) : new URL(specifier.slice(1), web);
      return { url: url.href, shortCircuit: true };
    }
    return next(specifier, context);
  }
`)}`);

// ---------- browser stand-in ----------

const byId = new Map();
const downloads = [];
const blobs = new Map();

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parent = null;
    this.listeners = {};
    this.dataset = {};
    this.attributes = {};
    this.style = { setProperty() {} };
    const classes = new Set();
    this.classList = {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
      contains: (c) => classes.has(c),
    };
    this.hidden = false;
    this.value = '';
    this.checked = false;
    this.text = '';
  }

  get id() {
    return this.attributes.id;
  }

  set id(value) {
    this.attributes.id = value;
    byId.set(value, this);
  }

  get textContent() {
    return this.text;
  }

  set textContent(value) {
    this.text = String(value);
    for (const child of this.children) child.parent = null;
    this.children = [];
  }

  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === 'string') continue;
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }

  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }

  /** Fires an event as the browser does after a user action. */
  fire(type) {
    for (const fn of this.listeners[type] || []) fn({ type, target: this });
  }

  click() {
    if (this.tagName === 'A') downloads.push({ name: this.download, blob: blobs.get(this.href) });
    this.fire('click');
  }
}

/** An element of the static page: created on first use, as the HTML has it. */
function staticElement(id) {
  if (!byId.has(id)) {
    const el = new Element('div');
    el.id = id;
  }
  return byId.get(id);
}

const document = {
  body: new Element('body'),
  createElement: (tag) => new Element(tag),
  getElementById: staticElement,
  querySelector(selector) {
    const m = selector.match(/^#([\w-]+) tbody$/);
    assert.ok(m, `unexpected selector ${selector}`);
    const table = staticElement(m[1]);
    if (!table.tbody) {
      table.tbody = new Element('tbody');
      table.append(table.tbody);
    }
    return table.tbody;
  },
  querySelectorAll(selector) {
    if (selector === '[data-group]') return groups;
    if (selector === '[data-export]') return exportButtons;
    if (selector === 'input[name="mode"]') return modeRadios;
    throw new Error(`unexpected selector ${selector}`);
  },
};

// The groups and export buttons are taken from the page's HTML, in its order.
const groups = [...HTML.matchAll(/data-group="([^"]+)"/g)].map(([, name]) => {
  const el = new Element('div');
  el.dataset.group = name;
  return el;
});
const exportButtons = [...HTML.matchAll(/data-export="([^"]+)"/g)].map(([, what]) => {
  const el = new Element('button');
  el.dataset.export = what;
  return el;
});
const modeRadios = ['sim', 'live'].map((value) => {
  const el = new Element('input');
  el.value = value;
  el.checked = value === 'live';
  return el;
});

function Option(text, value) {
  const el = new Element('option');
  el.text = text;
  el.value = value;
  return el;
}

class EventSource {
  static CONNECTING = 0;
  readyState = EventSource.CONNECTING;
  close() {}
}

const storage = new Map();
let blobCount = 0;
const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;

Object.assign(globalThis, {
  document,
  Option,
  EventSource,
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
  },
  fetch: async (url) => (url === '/presets/'
    ? { ok: true, json: async () => [] }
    : { ok: false, json: async () => null }),
  requestAnimationFrame: (fn) => realSetTimeout(fn, 0),
  // The page's long timers (status watch, URL release) must not keep the test alive.
  setInterval: (fn, ms) => realSetInterval(fn, ms).unref(),
  setTimeout: (fn, ms) => {
    const timer = realSetTimeout(fn, ms);
    if (ms >= 1000) timer.unref();
    return timer;
  },
});
URL.createObjectURL = (blob) => {
  const url = `blob:page-test/${++blobCount}`;
  blobs.set(url, blob);
  return url;
};
URL.revokeObjectURL = (url) => blobs.delete(url);

const $ = staticElement;

// ---------- helpers ----------

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

async function waitFor(check, what) {
  for (let i = 0; i < 1000; i++) {
    if (check()) return;
    await sleep(10);
  }
  assert.fail(`timed out waiting for ${what}`);
}

/** The number input of a schema control (the range input carries the id). */
const numberOf = (path) => $(`p-${path.replace(/\./g, '-')}`).parent.children[2];

/** Sets a control's value and fires the event the page listens for. */
function edit(el, value, type = 'change') {
  if (typeof value === 'boolean') el.checked = value;
  else el.value = String(value);
  el.fire(type);
}

// ---------- the test ----------

test('R10.4, R10.5, A1: the page export buttons download the files of the command for edited parameters', async () => {
  await import('../web/app.js');
  const dir = mkdtempSync(join(tmpdir(), 'hdd-sim-page-export-'));
  try {
    // 1. A parameter file is loaded through the page ("Load parameters…").
    const file = defaultParams('laptop-2000s');
    file.seed = 4242;
    file.export.sampleRate = 44100;
    file.export.clickCount = 2;
    file.export.distMin = 0.2;
    file.export.burstScenario = 'thrash';
    file.export.burstSeconds = 1;
    file.export.idleSeconds = 1;
    file.export.loopSeconds = 1;
    file.spindle.spinUpS = 1;
    file.spindle.spinDownS = 1;
    file.mix.spindleDb = -9;
    file.mix.masterDb = -20; // the listener's volume stays the page's (R8.14)
    file.click.resonators[0].freq = 1234;
    const input = $('params-file');
    input.files = [{ name: 'edited.json', text: async () => JSON.stringify(file) }];
    input.fire('change');
    await waitFor(() => $('params-status').textContent === 'Loaded edited.json.', 'the file to load');

    // 2. More settings are changed with the page's own controls.
    edit($('seed'), 777);
    edit($('export-rate'), 48000);
    edit(numberOf('export.clickCount'), 3);
    edit($('p-mix-headDb'), -4.5, 'input');
    edit(numberOf('mix.masterDb'), -2);
    edit($('rw-mode'), 'separate');
    edit(numberOf('rw.writePitchPct'), -10);
    edit($('resonators').tbody.children[1].children[0].children[0], 3210);
    edit($('lp-mode'), 'separate');
    const headLowPass = $('lp-filters').tbody.children[0]; // first row: head clicks
    edit(headLowPass.children[0].children[0].children[0], true); // its on box
    edit(headLowPass.children[2].children[0], 2500); // its cutoff in Hz

    // The same parameters, written independently of the page, for the command.
    const expected = sanitizeParams(file);
    expected.mix.masterDb = -2;
    expected.seed = 777;
    expected.export.sampleRate = 48000;
    expected.export.clickCount = 3;
    expected.mix.headDb = -4.5;
    expected.rw.mode = 'separate';
    expected.rw.writePitchPct = -10;
    expected.click.resonators[1].freq = 3210;
    expected.filters.lpMode = 'separate';
    expected.filters.lp.head.on = true;
    expected.filters.lp.head.hz = 2500;
    const paramFile = join(dir, 'params.json');
    writeFileSync(paramFile, JSON.stringify(expected));
    const out = join(dir, 'out');
    execFileSync(process.execPath, [CLI, '--params', paramFile, '--out', out]);
    const cli = Object.fromEntries(readdirSync(out).map((name) => [name, readFileSync(join(out, name))]));
    assert.ok(cli['click_write_01.wav'], 'the command made a write set');
    // The edits matter: the command's files for the defaults are other files.
    const plain = join(dir, 'plain');
    execFileSync(process.execPath, [CLI, '--out', plain]);
    assert.ok(!readFileSync(join(plain, 'burst.wav')).equals(cli['burst.wav']));

    // 3. Every export button of the page, through to the downloaded bytes.
    const status = $('export-status');
    assert.deepEqual(exportButtons.map((b) => b.dataset.export),
      ['clicks', 'burst', 'spinup', 'spindown', 'spindle_loop', 'idle', 'all']);
    for (const button of exportButtons) {
      const what = button.dataset.export;
      downloads.length = 0;
      button.fire('click');
      await waitFor(() => status.textContent !== 'Rendering…', `the ${what} export`);
      assert.ok(!status.classList.contains('error'), `${what}: ${status.textContent}`);
      assert.equal(downloads.length, 1, `${what}: one download`);
      const { name, blob } = downloads[0];
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const same = (f) => assert.ok(cli[f.name] && Buffer.from(f.data).equals(cli[f.name]), `${what}: ${f.name} differs from the command's`);
      if (what === 'clicks' || what === 'all') {
        assert.equal(name, what === 'all' ? 'hdd-sim-export.zip' : 'hdd-clicks.zip');
        assert.equal(blob.type, 'application/zip');
        const files = unzipStored(bytes);
        const names = files.map((f) => f.name).sort();
        if (what === 'all') assert.deepEqual(names, Object.keys(cli).sort());
        else assert.deepEqual(names, Object.keys(cli).filter((n) => n.startsWith('click_')).sort());
        files.forEach(same);
      } else {
        assert.deepEqual([name, blob.type], [`${what}.wav`, 'audio/wav']);
        same({ name, data: bytes });
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
