#!/usr/bin/env node
// Local server (spec section 8): serves the page and the synth core, and
// streams disk statistics. Loopback only, read only.
//   node src/server/server.js [--port 8125] [--presets <folder>]

import { closeSync, constants, createReadStream, fstatSync, lstatSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSampler } from './diskstats.js';

export const HOST = '127.0.0.1';
export const DEFAULT_PORT = 8125;
export const SAMPLE_HZ = 20;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_PRESETS_DIR = join(ROOT, 'presets');
// R8.13: plain file names only, so a name can never leave the preset folder.
const PRESET_NAME = /^[A-Za-z0-9_-][A-Za-z0-9 ._-]*\.json$/;
const PRESET_MAX_BYTES = 1024 * 1024;

// A preset file is a regular file (not a link) directly in the folder.
function isPresetFile(dir, name) {
  if (!PRESET_NAME.test(name)) return false;
  try {
    const info = lstatSync(join(dir, name));
    return info.isFile() && info.size <= PRESET_MAX_BYTES;
  } catch {
    return false;
  }
}

// Reads a file through one open handle: links are not followed (O_NOFOLLOW),
// type and size are checked on the handle, and at most maxBytes are read.
// Returns null for anything else, also when the file changes or fails while
// it is read, so that no file can end the server process.
function readRegularFile(path, maxBytes) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > maxBytes) return null;
    const buf = Buffer.alloc(maxBytes + 1);
    let n = 0;
    let got;
    while (n < buf.length && (got = readSync(fd, buf, n, buf.length - n, null)) > 0) n += got;
    return n > maxBytes ? null : buf.subarray(0, n);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function listPresets(dir) {
  try {
    return readdirSync(dir).filter((name) => isPresetFile(dir, name)).sort();
  } catch {
    return []; // no folder, no presets
  }
}
// URL prefix -> directory. Nothing outside these two directories is served.
const MOUNTS = [
  ['/dsp/', join(ROOT, 'src', 'dsp')],
  ['/', join(ROOT, 'web')],
];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

function resolveFile(urlPath) {
  let path;
  try {
    path = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (path.includes('\0')) return null;
  if (path === '/') path = '/index.html';
  for (const [prefix, dir] of MOUNTS) {
    if (!path.startsWith(prefix)) continue;
    const file = normalize(join(dir, path.slice(prefix.length)));
    if (!file.startsWith(dir + sep)) return null;
    if (!TYPES[extname(file)]) return null;
    try {
      if (statSync(file).isFile()) return file;
    } catch {
      /* not found */
    }
    return null;
  }
  return null;
}

/**
 * @param {{port?: number, sampler?: () => object|null, presetsDir?: string}} [options]
 * @returns {import('node:http').Server} not yet listening
 */
export function createHddSimServer({ port = DEFAULT_PORT, sampler = createSampler(), presetsDir = DEFAULT_PRESETS_DIR } = {}) {
  const presets = resolve(presetsDir);
  const clients = new Set();
  let timer = null;
  let last = 0;

  const tick = () => {
    const now = performance.now();
    const devices = sampler();
    const dt = (now - last) / 1000;
    last = now;
    const message = devices ? { dt, devices } : { unavailable: true };
    const frame = `data: ${JSON.stringify(message)}\n\n`;
    for (const res of clients) res.write(frame);
  };
  const startSampling = () => {
    if (timer) return;
    sampler(); // set the baseline; the first streamed sample is then a real change
    last = performance.now();
    timer = setInterval(tick, 1000 / SAMPLE_HZ);
  };
  const stopSampling = () => {
    clearInterval(timer);
    timer = null;
  };

  const server = createServer((req, res) => {
    // Only answer requests addressed to this machine by a loopback name, so
    // another site cannot reach the server through a DNS trick.
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    if (host !== 'localhost' && host !== HOST) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
      return;
    }
    const path = (req.url || '/').split('?')[0];

    if (path === '/stats') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      res.write('retry: 1000\n\n');
      clients.add(res);
      startSampling();
      req.on('close', () => {
        clients.delete(res);
        if (clients.size === 0) stopSampling();
      });
      return;
    }

    // R8.12, R8.13: the preset folder, read only.
    if (path.startsWith('/presets/')) {
      const send = (status, type, body) => {
        res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : body);
      };
      let name = null;
      try {
        name = decodeURIComponent(path.slice('/presets/'.length));
      } catch {
        /* a malformed name is not found */
      }
      if (name === '') {
        send(200, TYPES['.json'], JSON.stringify(listPresets(presets)));
        return;
      }
      const body = name !== null && isPresetFile(presets, name)
        ? readRegularFile(join(presets, name), PRESET_MAX_BYTES) : null;
      if (body) send(200, TYPES['.json'], body);
      else send(404, 'text/plain', 'Not found');
      return;
    }

    const file = resolveFile(path);
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)], 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  });
  server.on('close', () => {
    stopSampling();
    for (const res of clients) res.end();
  });
  server.hddSimPort = port;
  return server;
}

function main() {
  let port = Number(process.env.PORT) || DEFAULT_PORT;
  let presetsDir = DEFAULT_PRESETS_DIR;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) port = Number(args[++i]);
    else if (args[i] === '--presets' && args[i + 1]) presetsDir = args[++i];
    else {
      console.error('Usage: node src/server/server.js [--port 8125] [--presets <folder>]');
      process.exit(2);
    }
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('The port must be a whole number between 1 and 65535.');
    process.exit(2);
  }
  const server = createHddSimServer({ port, presetsDir });
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use. Try --port with another number.` : err.message);
    process.exit(1);
  });
  server.listen(port, HOST, () => {
    console.log(`hdd-sim is running at http://${HOST}:${port}/`);
    console.log(`Preset folder (read only): ${resolve(presetsDir)}`);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) main();
