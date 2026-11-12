// Page logic that runs without a browser: the parts of web/app.js that were
// moved into modules so that the page and these tests call the same code.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLoadGate } from '../web/loads.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('R8.14, R6.14: a load that completes after a later choice does not overwrite it', async () => {
  const gate = createLoadGate();
  const applied = [];
  const failed = [];
  const choose = (name, pending) => gate.run(() => pending.promise, (v) => applied.push([name, v.seed]), (e) => failed.push([name, e.message]));

  // A, then B; B answers first, then A.
  const a = deferred();
  const b = deferred();
  const doneA = choose('A.json', a);
  const doneB = choose('B.json', b);
  b.resolve({ seed: 222 });
  await doneB;
  a.resolve({ seed: 111 });
  await doneA;
  assert.deepEqual(applied, [['B.json', 222]]);

  // A built-in preset or a reset chosen while a file is on its way.
  const c = deferred();
  const doneC = choose('C.json', c);
  gate.invalidate();
  c.resolve({ seed: 333 });
  await doneC;
  assert.deepEqual(applied, [['B.json', 222]]);

  // An obsolete load that fails reports nothing; the current one does.
  const d = deferred();
  const e = deferred();
  const doneD = choose('D.json', d);
  const doneE = choose('E.json', e);
  d.reject(new Error('gone'));
  e.reject(new Error('not found'));
  await Promise.all([doneD, doneE]);
  assert.deepEqual(failed, [['E.json', 'not found']]);

  // The newest load is taken; an error in taking it over is reported as a failure.
  await gate.run(() => ({ seed: 5 }), () => { throw new Error('not a parameter object'); }, (err) => failed.push(['F.json', err.message]));
  assert.deepEqual(failed.at(-1), ['F.json', 'not a parameter object']);
  await choose('G.json', { promise: Promise.resolve({ seed: 7 }) });
  assert.deepEqual(applied.at(-1), ['G.json', 7]);
});

test('R9.8: the Spin up button pulses three times when the page opens, then stops', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../web/style.css', import.meta.url), 'utf8');
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.match(html, /<button id="spin-up"/);
  const rule = css.match(/#spin-up\s*\{\s*animation:\s*([^;]+);/);
  assert.ok(rule, 'the button has an animation');
  const [name, , , , count] = rule[1].trim().split(/\s+/);
  assert.equal(count, '3');
  assert.ok(css.includes(`@keyframes ${name}`));
  assert.doesNotMatch(rule[1], /infinite|forwards/);
});
