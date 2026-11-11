# What to review

How this works: the planner writes the "Current engagement" section and an empty results file for each round. The user starts the reviewer with:

> Read review/CONTRACT.md and review/what-to-review.md, then run the current engagement.

The reviewer writes only the named results file and commits only it. Slugs are `YYYY-MM-DD-<phase>[-residuals-N]`, with the date from `date +%F`. Earlier results files are closed and read-only.

## Current engagement

**Engagement:** `2026-11-12-v1`
**Builder:** `claude` · **Reviewer:** `codex`
**Results file (the ONLY path you may write):** `review/results-2026-11-12-v1.md`
**Contract:** `docs/SPEC.md` as of `d730524` (the spec carries no version number; approved by the user 2026-11-10, with later changes each dictated or approved by the user)
**Baseline:** `58c5343` (initial commit: repository rules only)
**Under review:** `58c5343..d730524` — the whole of v1: synth core, export command, server, page and tests. This is the first review of the project, before it is made public.

### What changed
1. Synth core, shared by the page and Node: `src/dsp/` (click, spindle, filters, drive model, baseline, engine, activity, export, parameters, WAV and ZIP writers, random generator).
2. Export command: `cli/render.js`.
3. Server: `src/server/server.js`, `src/server/diskstats.js` (page, synth core, statistics stream, read-only preset folder).
4. Page: `web/` (controls, light, live mode, exports, audio worklet).
5. Tests: `test/` (69 tests, `npm test`).
6. Project files: `package.json`, `README.md`, `LICENSE`, `.agent-roles`, and the instruction files.

### Review type
code review

### Priorities, in order
**Priority 1 — The server serves only what R8.1 and R8.12–R8.14 allow**
The repo is about to be public and other people will run this server. Verify the standing server rules in `review/CONTRACT.md` by reading and by probing a throwaway copy: path handling for `/`, `/dsp/` and `/presets/` (encoded separators, dot segments, doubled slashes, null bytes, very long paths), the Host check (a page on another site must not be able to read `/stats` or `/presets/`, including through DNS rebinding), methods other than GET and HEAD, and what happens to the preset folder between the name check and the read (a link swapped in, a file that grows). Also check that many open statistics streams, or clients that stop reading, cannot exhaust the server. The builder's claim: the tests in `test/server.test.js` cover each refused case.

**Priority 2 — Input the user did not write: parameter files and statistics**
Parameter files come from the preset folder, from "Load parameters…" and from `cli/render.js --params`, and may be made by someone else. Check `sanitizeParams` and everything that consumes its result: keys such as `__proto__` and `constructor`, wrong types, NaN and infinities, numbers far outside the limits, a very long resonator or harmonics list, an unknown preset or mode. A hostile file must not run code in the page, hang the page or the command, or produce NaN or clipping in the output (R6.13). Check how file names and file contents reach the page (the preset selector and the status line). Do the same for device names and counters read from `/proc/diskstats` (R8.2–R8.4): odd names, counters that wrap or go backwards, a device that disappears.

**Priority 3 — Same seed, same output (R4.4, R10.2–R10.6)**
Exports must be bit-identical for the same parameters and seed, from the page and from the command (R10.5). The builder's claims: the engine renders whole 128-sample chunks so that output does not depend on how calls are split; filters that are off leave the signal bit for bit unchanged (R6.17); filters settle to exact silence (R6.6). Look for anything that depends on call order, time, `Math.random`, object key order or the platform's floating point library in a way that could differ between browsers. R10.5 was verified in Chromium only; say whether you see a reason it could fail elsewhere.

**Priority 4 — Drive model and live rating against sections 5, 8 and 9**
Queue bound and seek-rate cap (R5.5, R5.8); the idle baseline (R8.6–R8.10: manual threshold, adaptive level with ramp-up and cooldown, a separate pair of background values per mode, the level taken when the seek starts); the read/write pattern and write flushing (R9.5–R9.7); behaviour when the stream stops (R8.5). Compare the defaults in `src/dsp/params.js` with every default the spec states.

**Priority 5 — Sound chain against section 6**
Click length (R6.5), layer isolation (R6.12), no clipping and no NaN (R6.13), filter modes, slopes and resonance (R6.15–R6.19), separate write sound (R6.20–R6.21), presets and what a preset does and does not set (R6.11, R6.14). Whether it sounds realistic is out of scope.

**Priority 6 — Page behaviour against the spec**
Start mode (R8.11), preset selector and file loading (R6.14, R8.14: master volume kept, file name shown), the baseline settings shown per mode (R8.10), settings kept across a reload. The builder checked the page in headless Chromium only, by script, and one earlier defect was of this kind: controls kept editing a stale copy of the parameters after a load. Look for more of that class.

**Security (standing)** — re-check the server rules, the no-dependencies rule and repository hygiene from `review/CONTRACT.md` against the whole range.

**Test quality** — A1 in the spec lists the requirements that tests cover. For each, judge whether the test would fail if the requirement were broken. Make at least five mutants of your own in a throwaway copy, among them: drop the Host check; let a symbolic link through in the preset folder; swap the two background pairs of R8.9; make a switched-off filter change the signal; break the chunk independence of the engine. Report each as killed or survived.

Places the builder is least sure of:
- `sanitizeParams` against deliberately hostile files; it was written for honest ones.
- The server under misbehaving clients (no limits on streams were designed in).
- Growth of the baseline's sample history if statistics samples arrive with a zero or negative interval.
- The page in browsers other than Chromium.
- A2 (reaction times in live mode) was never measured end to end.

### Out of scope
- How it sounds and whether it is realistic (A3): the user judges that by ear.
- The roadmap and open questions (spec sections 12 and 13).
- The values in the user's files in `presets/`; check them for personal data only.
- The agent-dashboard block in `CLAUDE.md` and `AGENTS.md`, and `review/` itself.
- Two things the user has seen and accepted: the first name in the message of commit `6bb492e`, and the copyright holder's name in `LICENSE`. History will not be rewritten.
- Commits after `d730524` (this kickoff and later work).

### Expected output
Findings into `review/results-2026-11-12-v1.md`, as F1…; phase verdict **CLEAN PASS** / **PASS WITH SHOULD-FIX** /
**FAIL (blocker)**. Commit the results file, then stop.

## Template for the next engagement

```markdown
## Current engagement

**Engagement:** `<slug>`
**Builder:** `<agent>` · **Reviewer:** `<agent>`
**Results file (the ONLY path you may write):** `review/results-<slug>.md`
**Contract:** `docs/SPEC.md` as of `<sha>` (<changed | unchanged>)
**Baseline:** `<sha or tag>`
**Under review:** `<baseline>..<pinned sha>` — <one-line summary>

### What changed
1. <one item per logical change, with paths>

### Review type
<code review | residual verification, round N — narrow | regression verification>

### Priorities, in order
**Priority 1 — <the thing most likely to be wrong>**
<what to verify, against which SPEC requirement; the builder's claim to test>

**Priority 2 — ...**

**Security (standing)** — re-check the standing checks in `review/CONTRACT.md` against this diff.

**Test quality** — do new tests fail for the right reason? Reproduce: <mutants from commit messages>.

### Out of scope
<explicit list>

### Expected output
Findings into `review/results-<slug>.md`; carried findings marked RESOLVED/UPHELD
with evidence; phase verdict **CLEAN PASS** / **PASS WITH SHOULD-FIX** /
**FAIL (blocker)**. Commit the results file, then stop.
```
