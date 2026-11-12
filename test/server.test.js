import assert from 'node:assert/strict';
import fs, { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createSampler, delta, parseDiskstats, wholeDisks } from '../src/server/diskstats.js';
import { connect } from 'node:net';
import {
  HOST, SAMPLE_HZ, STATS_MAX_STREAMS, STATS_MAX_UNSENT_BYTES, createHddSimServer,
} from '../src/server/server.js';

const SAMPLE = `   7       0 loop0 100 0 2000 50 0 0 0 0 0 60 50 0 0 0 0 0 0
 259       0 nvme0n1 1000 20 80000 300 500 40 16000 900 0 700 1300 0 0 0 0 10 100
 259       1 nvme0n1p1 900 20 70000 280 400 40 12000 800 0 600 1100 0 0 0 0 0 0
   8       0 sda 10 0 80 5 2 0 16 1 0 4 6
`;

test('R8.2: diskstats are parsed into operations and bytes', () => {
  const stats = parseDiskstats(SAMPLE);
  assert.deepEqual(stats.get('nvme0n1'), { reads: 1000, bytesRead: 80000 * 512, writes: 500, bytesWritten: 16000 * 512 });
  assert.deepEqual(stats.get('sda'), { reads: 10, bytesRead: 80 * 512, writes: 2, bytesWritten: 16 * 512 });
  assert.equal(parseDiskstats('').size, 0);
});

test('R8.2: only whole physical disks are reported', () => {
  assert.deepEqual(wholeDisks(['loop0', 'sda', 'nvme0n1', 'dm-0', 'zram0', 'md0', 'sr0', 'mmcblk0']), ['mmcblk0', 'nvme0n1', 'sda']);
});

test('R8.2: changes are differences between samples and never negative', () => {
  const a = { reads: 10, writes: 5, bytesRead: 1000, bytesWritten: 500 };
  const b = { reads: 14, writes: 5, bytesRead: 3000, bytesWritten: 500 };
  assert.deepEqual(delta(a, b), [4, 0, 2000, 0]);
  assert.deepEqual(delta(b, a), [0, 0, 0, 0]);
});

test('R8.5: the sampler reports unavailable statistics as null', () => {
  const sample = createSampler({ statsPath: '/nonexistent/diskstats', blockDir: '/nonexistent/block' });
  assert.equal(sample(), null);
});

test('R8.2, R8.3: a disk attached while the server runs is found and starts from a baseline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdd-sim-disks-'));
  try {
    const blockDir = join(dir, 'block');
    const statsPath = join(dir, 'diskstats');
    mkdirSync(join(blockDir, 'sda'), { recursive: true });
    const row = (name, reads, writes) => `   8       0 ${name} ${reads} 0 ${reads * 8} 5 ${writes} 0 ${writes * 8} 1 0 4 6\n`;
    writeFileSync(statsPath, row('sda', 10, 2));
    const sample = createSampler({ statsPath, blockDir });
    assert.deepEqual(sample(), { sda: [0, 0, 0, 0] });

    mkdirSync(join(blockDir, 'sdb'));
    writeFileSync(statsPath, row('sda', 11, 2) + row('sdb', 500, 300));
    assert.deepEqual(sample(), { sda: [1, 0, 8 * 512, 0], sdb: [0, 0, 0, 0] }, 'new disk: no change yet');
    writeFileSync(statsPath, row('sda', 11, 2) + row('sdb', 504, 301));
    assert.deepEqual(sample(), { sda: [0, 0, 0, 0], sdb: [4, 1, 32 * 512, 8 * 512] });

    rmSync(join(blockDir, 'sdb'), { recursive: true });
    writeFileSync(statsPath, row('sda', 11, 2));
    assert.deepEqual(sample(), { sda: [0, 0, 0, 0] }, 'a removed disk disappears');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

let server;
let port;
let ticks = 0;
let presetsDir;
let secretDir;

function get(path, { method = 'GET', host } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: HOST, port, path, method, headers: host ? { Host: host } : {} }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  const sampler = () => ({ sda: [ticks++, 1, 4096, 512] });
  // A preset folder with two good files and everything that must be refused.
  presetsDir = mkdtempSync(join(tmpdir(), 'hdd-sim-presets-'));
  writeFileSync(join(presetsDir, 'my drive 2.json'), '{"seed":7}');
  writeFileSync(join(presetsDir, 'a-first.json'), '{"seed":1}');
  writeFileSync(join(presetsDir, 'notes.txt'), 'no');
  writeFileSync(join(presetsDir, '.hidden.json'), '{}');
  writeFileSync(join(presetsDir, 'bad;name.json'), '{}');
  writeFileSync(join(presetsDir, 'huge.json'), 'x'.repeat(1024 * 1024 + 1));
  mkdirSync(join(presetsDir, 'folder.json'));
  mkdirSync(join(presetsDir, 'sub'));
  writeFileSync(join(presetsDir, 'sub', 'inner.json'), '{}');
  secretDir = mkdtempSync(join(tmpdir(), 'hdd-sim-outside-'));
  writeFileSync(join(secretDir, 'secret.json'), '{"secret":true}');
  symlinkSync(join(secretDir, 'secret.json'), join(presetsDir, 'link.json'));
  server = createHddSimServer({ sampler, presetsDir });
  await new Promise((resolve) => server.listen(0, HOST, resolve));
  port = server.address().port;
});

after(() => new Promise((resolve) => {
  rmSync(presetsDir, { recursive: true, force: true });
  rmSync(secretDir, { recursive: true, force: true });
  server.closeAllConnections();
  server.close(resolve);
}));

test('R8.1: the server listens on the loopback address only', () => {
  assert.equal(server.address().address, '127.0.0.1');
});

test('R8.1: the page, its script and the synth core are served', async () => {
  const page = await get('/');
  assert.equal(page.status, 200);
  assert.match(page.type, /text\/html/);
  for (const path of ['/app.js', '/loads.js', '/worklet.js', '/dsp/engine.js', '/dsp/export.js']) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    assert.match(res.type, /text\/javascript/, path);
  }
  assert.match((await get('/style.css')).type, /text\/css/);
});

test('R8.1: nothing outside the web and synth-core directories is served', async () => {
  for (const path of [
    '/../package.json', '/dsp/../server/server.js', '/dsp/%2e%2e/server/server.js', '/%2e%2e/%2e%2e/etc/passwd',
    '/dsp/..%2f..%2fpackage.json', '/server/server.js', '/docs/SPEC.md', '/.git/config', '/dsp/', '/nope.js', '/%zz',
  ]) {
    const res = await get(path);
    assert.equal(res.status, 404, path);
  }
});

test('R8.1: symbolic links in the web and synth-core directories are not followed', async () => {
  const root = join(import.meta.dirname, '..');
  const tag = `link-test-${process.pid}`;
  writeFileSync(join(secretDir, 'outside.js'), '// OUTSIDE_SENTINEL secret');
  const links = [
    [join(secretDir, 'secret.json'), join(root, 'web', `${tag}.json`), `/${tag}.json`],
    [join(secretDir, 'outside.js'), join(root, 'src', 'dsp', `${tag}.js`), `/dsp/${tag}.js`],
    [secretDir, join(root, 'web', tag), `/${tag}/secret.json`], // a linked folder in the path
    [join(root, 'web', 'app.js'), join(root, 'web', `${tag}-inside.js`), `/${tag}-inside.js`], // even to a file inside
  ];
  try {
    for (const [target, link] of links) symlinkSync(target, link);
    for (const [, , path] of links) {
      const res = await get(path);
      assert.equal(res.status, 404, path);
      assert.ok(!res.body.includes('secret') && !res.body.includes('SENTINEL'), path);
    }
    assert.equal((await get('/app.js')).status, 200);
  } finally {
    for (const [, link] of links) rmSync(link, { force: true });
  }
});

test('R8.1: there are no write endpoints', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    assert.equal((await get('/', { method })).status, 405, method);
    assert.equal((await get('/stats', { method })).status, 405, method);
    assert.equal((await get('/presets/', { method })).status, 405, method);
    assert.equal((await get('/presets/new.json', { method })).status, 405, method);
  }
});

test('R8.12, R8.13: the preset folder is listed and its parameter files are served', async () => {
  const list = await get('/presets/');
  assert.equal(list.status, 200);
  assert.match(list.type, /application\/json/);
  assert.deepEqual(JSON.parse(list.body), ['a-first.json', 'my drive 2.json']);
  const file = await get('/presets/my%20drive%202.json');
  assert.equal(file.status, 200);
  assert.match(file.type, /application\/json/);
  assert.deepEqual(JSON.parse(file.body), { seed: 7 });
  assert.equal((await get('/presets/a-first.json', { method: 'HEAD' })).body, '');
});

test('R8.13: other names, links, sub-folders, large files and paths out of the folder are refused', async () => {
  for (const path of [
    '/presets/notes.txt', '/presets/.hidden.json', '/presets/bad%3Bname.json', '/presets/huge.json',
    '/presets/folder.json', '/presets/sub/inner.json', '/presets/sub%2Finner.json', '/presets/link.json',
    '/presets/..%2Fpackage.json', '/presets/../package.json', '/presets/%2e%2e%2f%2e%2e%2fpackage.json',
    '/presets/missing.json', '/presets/%zz', '/presets/a-first.json%00.txt', '/presets',
  ]) {
    const res = await get(path);
    assert.equal(res.status, 404, path);
    assert.ok(!res.body.includes('secret'), path);
  }
});

// Runs `change` once, right after the server has checked `name` with lstat and
// before it opens the file: the gap a file changed at the wrong moment falls into.
async function withChangeAfterCheck(name, change, fn) {
  const original = fs.lstatSync;
  let pending = change;
  fs.lstatSync = function lstatThenChange(path, ...rest) {
    const info = original.call(this, path, ...rest);
    if (pending && String(path).endsWith(`${name}`)) {
      const run = pending;
      pending = null;
      run();
    }
    return info;
  };
  syncBuiltinESMExports();
  try {
    await fn();
    assert.equal(pending, null, 'the change ran between check and read');
  } finally {
    fs.lstatSync = original;
    syncBuiltinESMExports();
  }
}

test('R8.1, R8.13: a preset file changed between check and read is not served, and never ends the server', async () => {
  const race = join(presetsDir, 'race.json');
  const changes = {
    'replaced by a link': () => { unlinkSync(race); symlinkSync(join(secretDir, 'secret.json'), race); },
    'grown past 1 MB': () => appendFileSync(race, ' '.repeat(2 * 1024 * 1024)),
    'deleted': () => unlinkSync(race),
  };
  try {
    for (const [what, change] of Object.entries(changes)) {
      writeFileSync(race, '{}');
      await withChangeAfterCheck('race.json', change, async () => {
        const res = await get('/presets/race.json');
        assert.equal(res.status, 404, what);
        assert.ok(!res.body.includes('secret'), what);
        assert.ok(res.body.length < 1024, what);
      });
      rmSync(race, { force: true });
      assert.equal((await get('/presets/a-first.json')).status, 200, `${what}: the server still runs`);
    }
  } finally {
    rmSync(race, { force: true });
  }
});

test('R8.13: a missing preset folder gives an empty list', async () => {
  const other = createHddSimServer({ sampler: () => null, presetsDir: join(presetsDir, 'does-not-exist') });
  await new Promise((resolve) => other.listen(0, HOST, resolve));
  const savedPort = port;
  port = other.address().port;
  try {
    const list = await get('/presets/');
    assert.equal(list.status, 200);
    assert.deepEqual(JSON.parse(list.body), []);
    assert.equal((await get('/presets/a-first.json')).status, 404);
  } finally {
    port = savedPort;
    other.closeAllConnections();
    await new Promise((resolve) => other.close(resolve));
  }
});

test('R8.1: requests addressed to another host name are refused', async () => {
  assert.equal((await get('/', { host: 'evil.example' })).status, 403);
  assert.equal((await get('/', { host: `localhost:${port}` })).status, 200);
});

test('R8.2: statistics are streamed as server-sent events at 20 Hz', async () => {
  const messages = await new Promise((resolve, reject) => {
    const got = [];
    const req = request({ host: HOST, port, path: '/stats' }, (res) => {
      assert.equal(res.statusCode, 200);
      assert.match(res.headers['content-type'], /text\/event-stream/);
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (frame.startsWith('data: ')) got.push(JSON.parse(frame.slice(6)));
        }
        if (got.length >= 10) {
          req.destroy();
          resolve(got);
        }
      });
    });
    req.on('error', (err) => { if (err.code !== 'ECONNRESET') reject(err); });
    req.end();
  });
  assert.equal(SAMPLE_HZ, 20);
  for (const m of messages) {
    assert.equal(m.devices.sda.length, 4);
    assert.ok(m.dt > 0.02 && m.dt < 0.2, `interval ${m.dt}`);
  }
  const mean = messages.slice(1).reduce((sum, m) => sum + m.dt, 0) / (messages.length - 1);
  assert.ok(Math.abs(mean - 0.05) < 0.015, `mean interval ${mean}`);
});

/** Opens a statistics stream and resolves with its status once the head arrives. */
function openStream() {
  return new Promise((resolve, reject) => {
    const req = request({ host: HOST, port, path: '/stats' }, (res) => {
      res.resume();
      resolve({ status: res.statusCode, close: () => req.destroy() });
    });
    req.on('error', (err) => { if (err.code !== 'ECONNRESET') reject(err); });
    req.end();
  });
}

test('R8.1: the number of open statistics streams is limited', async () => {
  assert.equal(STATS_MAX_STREAMS, 16, 'R8.1: at most 16 statistics streams');
  const streams = [];
  try {
    for (let i = 0; i < STATS_MAX_STREAMS; i++) streams.push(await openStream());
    assert.ok(streams.every((s) => s.status === 200));
    const refused = await openStream();
    assert.equal(refused.status, 503);
    refused.close();
    assert.equal((await get('/')).status, 200, 'the page is still served');
    streams.pop().close();
    let again;
    for (let i = 0; i < 50; i++) {
      again = await openStream();
      if (again.status === 200) break;
      again.close();
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(again.status, 200, 'a closed stream frees its place');
    streams.push(again);
  } finally {
    for (const s of streams) s.close();
  }
});

test('R8.1: a statistics client that does not take its data is dropped', async () => {
  assert.equal(STATS_MAX_UNSENT_BYTES, 256 * 1024, 'R8.1: more than 256 KiB unsent closes the stream');
  // Large frames fill the socket buffers quickly; a normal frame is a few hundred bytes.
  const devices = {};
  for (let i = 0; i < 20000; i++) devices[`sd${i}`] = [1, 2, 3, 4];
  const other = createHddSimServer({ sampler: () => devices, presetsDir });
  const sockets = [];
  other.on('connection', (socket) => sockets.push(socket));
  await new Promise((resolve) => other.listen(0, HOST, resolve));
  const stalled = connect(other.address().port, HOST);
  try {
    await new Promise((resolve) => stalled.on('connect', resolve));
    stalled.write(`GET /stats HTTP/1.1\r\nHost: ${HOST}\r\n\r\n`);
    stalled.pause(); // reads nothing more
    let dropped = false;
    for (let i = 0; i < 300 && !dropped; i++) {
      await new Promise((r) => setTimeout(r, 50));
      dropped = sockets.length === 1 && sockets[0].destroyed;
      if (sockets.length === 1 && !dropped) {
        assert.ok(sockets[0].writableLength <= STATS_MAX_UNSENT_BYTES + 1024 * 1024, 'unsent data stays bounded');
      }
    }
    assert.ok(dropped, 'the stalled client was dropped');
  } finally {
    stalled.destroy();
    other.closeAllConnections();
    await new Promise((resolve) => other.close(resolve));
  }
});
