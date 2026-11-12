# Review v1 round 2 (T-003)

## Current engagement

**Engagement:** `T-003` · phase v1, round 2 (follows T-001, fix T-002)
**Builder:** `claude` · **Reviewer:** `codex`
**Contract:** the reviewer contract (`review/CONTRACT.md`, or the reviewer section at the top of `AGENTS.md`) + this file.
**Carried findings:** mark each RESOLVED or UPHELD. To change an upheld finding's severity, write the new one right after the outcome, in the same clause: `F1 **UPHELD in part**, now should-fix` (anything else keeps its severity).
**Start:** `agentstat -a codex ticket start T-003`.
**Results file (the only file you write):** `tickets/T-003/result.md`. When it has a verdict: `agentstat review check --ticket T-003`, then `agentstat -a codex ticket result T-003 "<verdict>" --file tickets/T-003/result.md` (it refuses a file that doesn't parse), then commit that file only, by path.

### Review type

Residual round

### Carried findings (mark each RESOLVED or UPHELD, with evidence)

- F1 [blocker] src/server/server.js:154 — R8.1, R8.13 — Preset validation and opening use separate pathname lookups, permitting symlink replacement, oversized responses and a process-ending read error between them — Open without following links, validate the opened regular file, bound the bytes read, and handle stream errors before committing a successful response.
- F10 [should-fix] web/app.js:579 — R8.14, R6.14 — An earlier preset request can complete after a later selection and overwrite the user's newer choice — Give loads a request generation or cancel obsolete fetches, invalidating outstanding loads on every preset/file/reset choice.
- F11 [should-fix] test/export.test.js:111 — A1, R10.5 — The parity test never executes the page, so it passes when page exports ignore the current parameters — Exercise the page export path with nondefault parameters and compare its resulting files with the CLI, including browser-engine coverage for the promised portability.
- F2 [blocker] src/server/server.js:68 — R8.1, standing server confinement rule — The web and DSP mounts follow filesystem symlinks outside their permitted directories — Enforce filesystem confinement, including symlinked path components, when opening static files.
- F3 [should-fix] src/server/server.js:94 — T-001 priority 1, bounded statistics-stream resources — Every tick writes to every client despite backpressure, and accepted SSE connections have no application limit — Bound active streams and per-client buffering, disconnecting or otherwise handling clients that cannot consume samples.
- F4 [should-fix] src/dsp/params.js:125 — R4.5, T-001 hostile-parameter validation — Prototype property names are treated as valid preset/scenario names and can break parameter loading or export — Use own-property membership or the exported name lists consistently for every preset/scenario lookup and fallback.
- F5 [blocker] src/server/diskstats.js:55 — R8.2, R8.3 — Whole-disk discovery is cached forever, so a disk attached after sampling starts is never streamed or selectable — Refresh the whole-disk inventory and establish an initial counter baseline for newly discovered devices.
- F6 [blocker] src/dsp/drive-model.js:22 — R5.5, R9.4 — Reducing the queue-length control leaves the existing queue above its new maximum — Coalesce excess queued work into the retained newest entry when applying a smaller bound, preserving its operation type.
- F7 [blocker] src/dsp/engine.js:271 — R8.9 — Adaptive light brightness uses the latest activity level during an operation instead of the level at seek start — Capture the adaptive level when service starts and use that operation's captured light target for its busy duration.
- F8 [blocker] src/dsp/engine.js:54 — R9.7 — The first simulated write is flushed immediately because the flush countdown starts at zero — Initialize/reinitialize the countdown to the selected flush interval when beginning a simulation flush cycle.
- F9 [blocker] src/dsp/engine.js:293 — R6.5, R6.19 — Live head filtering can extend a single click above its −60 dB tail limit far beyond 60 ms — Preserve the specified click-duration bound through the live filtered head chain and test the final head signal at allowed filter extremes.

### Review type

residual verification, round 2 — narrow

**Contract:** `docs/SPEC.md` v1.1 (changed since round 1: R6.5 — the 60 ms click limit applies to the click before the filters; R6.15 — resonance 0–12 dB), `review/CONTRACT.md` (changed since round 1: severity of findings that need local file access, committing beside agentstat-written files, probing authorisation)
**Baseline:** `2342fb8` (the revision reviewed in round 1)
**Under review:** `2342fb8..3cd240b` — the eleven fix commits of T-002, `11b64ee..3cd240b`. Commits after `3cd240b` (this kickoff, ticket files) are not under review.

### What changed
1. F9 — `11b64ee` — resonance range 0–12 dB (`FILTER_LIMITS`, page hint, tests).
2. F8 — `24a6548` — switching simulation on starts the flush countdown at the flush interval.
3. F7 — `5251b38` — the adaptive light limit uses the level captured when the operation's service starts.
4. F6 — `91281bf` — a lower queue maximum merges the excess into the newest queued operation.
5. F5 — `37f2e83` — the disk list is read on every sample; a new disk starts from a baseline.
6. F4 — `d6ac989` — strict parameter-file reading (own, known fields; own-property name lookups; non-finite numbers fall back); new `test/params.test.js`.
7. F1 — `019a02c` — preset files read through one handle (`O_NOFOLLOW`, `fstat`, bounded read, 404 on any failure).
8. F2 — `2378270` — symbolic links refused in the web and synth-core mounts; static files read through the same reader.
9. F3 — `6e9d6b9` — at most 16 statistics streams, a client with more than 256 KiB unsent is dropped.
10. F10 — `6a1c3d9` — `web/loads.js`, a load gate: the newest preset/file/reset choice wins; new `test/page.test.js`.
11. F11 — `3cd240b` — the page's export building moved into the core as `pageExport` in `src/dsp/export.js`; tested against the command.

### Priorities, in order
**Priority 1 — Disposition of F1–F11**
Mark each carried finding RESOLVED or UPHELD with evidence. The builder's claims:
- F1 RESOLVED: a preset file is opened once without following links; type and size are checked on the handle; no more than 1 MB + 1 byte is read; a file that disappears or fails gives 404 and the server keeps running. The user rates F1 as a nit (it needs write access to the user's own files; `review/CONTRACT.md` now says so) and asked for the simplest fix, no elaborate hardening.
- F2 RESOLVED: every path part below the web and synth-core mounts is checked for links and the file is opened without following links. The user rates F2 as a nit, as F1.
- F3 RESOLVED: streams are capped at 16 and a client with more than 256 KiB of unsent data is dropped. These are internal safeguards; whether R8.1 should state them is an open spec-change question to the user (default: spec unchanged).
- F4 RESOLVED: a hostile parameter file can at worst load defaults: only own, known fields are used, preset and scenario names are own-property lookups with the documented fallback, every non-finite number (filter fields included) falls back.
- F5 RESOLVED: a disk attached while the server runs appears in the next sample, starting from no change.
- F6 RESOLVED: lowering the queue length shrinks the waiting queue at once; no work is lost and the newest operation keeps its type.
- F7 RESOLVED: the light limit of an operation uses the activity level at the moment its service (seek) started.
- F8 RESOLVED: the first simulated write waits for the first flush interval, also after simulation is switched on again.
- F9 answered by spec v1.1: R6.5 now limits the click before the filters (a filter may ring longer), and the resonance range of R6.15 is 0–12 dB; the code and tests now use 12 dB. Nothing was added to shorten filter ringing, by the user's decision.
- F10 RESOLVED: a load that completes after a later choice is dropped. The gate is tested; that `web/app.js` calls it for every choice is checked by reading only.
- F11 RESOLVED for the page's export path: page and test call the same `pageExport`, which matches the command byte for byte with non-default parameters; M6 is killed. A run in other browser engines is not part of this fix (no browser in the tests, no dependencies); it stays with the user's browser check.

**Priority 2 — Regressions introduced by the fixes**
Look for new defects in the changed code: the strict `sanitizeParams` against honest files (saved by the page, older version-1 files, the shipped presets), static file serving after the switch from streams to one-handle reads (HEAD, `/`, `/dsp/` paths, content types), the statistics stream with normal clients (sampling start/stop, reconnects after a drop), the queue merge with live parameter changes, the light with mixed normal and background operations, and the page's preset selector and export buttons after the refactors.

**Security (standing)** — re-check the server rules, the no-dependencies rule and repository hygiene from `review/CONTRACT.md` against `2342fb8..3cd240b`.

**Test quality** — Judge whether each new regression test would fail if its requirement were broken. The builder's mutants are in the commit messages: M6 (page export uses defaults), M8–M16, M18, M20–M25, all killed; M17 and M19 survived and are explained in `tickets/T-002/result.md`. Run at least M6 and a few others of your own choice in a throwaway copy, and report each as killed or survived.

### Out of scope
- Everything not touched by the fixes.
- How it sounds and whether it is realistic (A3).
- The values in the user's files in `presets/`.
- The agent-dashboard block in `CLAUDE.md` and `AGENTS.md`, `review/` and `tickets/`.

### Expected output
First commit your uncommitted round 1 result, tickets/T-001/result.md, unchanged and by path, with the round 1 message.
Then findings into this ticket's `result.md`, as R1…, with `## Test run` first, then one `## Priority N — <title>` section per priority above, then `## Security`, `## Test quality`, `## Phase verdict` and `## Notes / observations outside scope`; phase verdict **CLEAN PASS** / **PASS WITH SHOULD-FIX** / **FAIL (blocker)**. Record the result, commit the result file, then stop.
