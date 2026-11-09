import assert from 'node:assert/strict';
import { request } from 'node:http';
import { after, before, test } from 'node:test';
import { createSampler, delta, parseDiskstats, wholeDisks } from '../src/server/diskstats.js';
import { HOST, SAMPLE_HZ, createHddSimServer } from '../src/server/server.js';

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

let server;
let port;
let ticks = 0;

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
  server = createHddSimServer({ sampler });
  await new Promise((resolve) => server.listen(0, HOST, resolve));
  port = server.address().port;
});

after(() => new Promise((resolve) => {
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
  for (const path of ['/app.js', '/worklet.js', '/dsp/engine.js', '/dsp/export.js']) {
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

test('R8.1: there are no write endpoints', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    assert.equal((await get('/', { method })).status, 405, method);
    assert.equal((await get('/stats', { method })).status, 405, method);
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
