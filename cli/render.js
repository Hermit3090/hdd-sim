#!/usr/bin/env node
// Command-line export (spec R10.5).
//   node cli/render.js [--params file.json] [--out dir] [--only clicks|sequences|all]
//                      [--preset name] [--rate 44100|48000] [--seed n]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { exportClicks, exportSequence, SEQUENCE_NAMES } from '../src/dsp/export.js';
import { PRESET_NAMES, SAMPLE_RATES, defaultParams, sanitizeParams } from '../src/dsp/params.js';

const USAGE = `Usage: node cli/render.js [options]
  --params <file>   parameter JSON exported from the page (default: built-in defaults)
  --out <dir>       output directory (default: out)
  --only <what>     clicks, sequences or all (default: all)
  --preset <name>   ${PRESET_NAMES.join(' or ')}; ignored when --params is given
  --rate <hz>       ${SAMPLE_RATES.join(' or ')}; overrides the parameter file
  --seed <n>        overrides the parameter file
  --help`;

function fail(message) {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

const opts = { out: 'out', only: 'all' };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') {
    console.log(USAGE);
    process.exit(0);
  }
  if (!['--params', '--out', '--only', '--preset', '--rate', '--seed'].includes(arg)) fail(`Unknown option: ${arg}`);
  if (i + 1 >= args.length) fail(`Missing value for ${arg}`);
  opts[arg.slice(2)] = args[++i];
}
if (!['clicks', 'sequences', 'all'].includes(opts.only)) fail(`--only must be clicks, sequences or all`);

let params;
if (opts.params) {
  try {
    params = JSON.parse(readFileSync(opts.params, 'utf8'));
  } catch (err) {
    fail(`Cannot read parameter file ${opts.params}: ${err.message}`);
  }
} else {
  if (opts.preset && !PRESET_NAMES.includes(opts.preset)) fail(`Unknown preset: ${opts.preset}`);
  params = defaultParams(opts.preset);
}
params = sanitizeParams(params);
if (opts.rate !== undefined) {
  const rate = Number(opts.rate);
  if (!SAMPLE_RATES.includes(rate)) fail(`--rate must be ${SAMPLE_RATES.join(' or ')}`);
  params.export.sampleRate = rate;
}
if (opts.seed !== undefined) {
  const seed = Number(opts.seed);
  if (!Number.isInteger(seed) || seed < 0) fail('--seed must be a non-negative whole number');
  params.seed = seed;
}

const files = [];
if (opts.only !== 'sequences') files.push(...exportClicks(params));
if (opts.only !== 'clicks') for (const kind of SEQUENCE_NAMES) files.push(exportSequence(kind, params));

const dir = resolve(opts.out);
mkdirSync(dir, { recursive: true });
for (const f of files) writeFileSync(join(dir, f.name), f.data);
console.log(`Wrote ${files.length} files to ${dir} (${params.export.sampleRate} Hz, preset ${params.preset}, seed ${params.seed})`);
