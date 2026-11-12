# Review v1 round 3 (T-005)

## Current engagement

**Engagement:** `T-005` · phase v1, round 3 (follows T-003, fix T-004)
**Builder:** `claude` · **Reviewer:** `codex`
**Contract:** the reviewer contract (`review/CONTRACT.md`, or the reviewer section at the top of `AGENTS.md`) + this file.
**Carried findings:** mark each RESOLVED or UPHELD. To change an upheld finding's severity, write the new one right after the outcome, in the same clause: `F1 **UPHELD in part**, now should-fix` (anything else keeps its severity).
**Start:** `agentstat -a codex ticket start T-005`.
**Results file (the only file you write):** `tickets/T-005/result.md`. When it has a verdict: `agentstat review check --ticket T-005`, then `agentstat -a codex ticket result T-005 "<verdict>" --file tickets/T-005/result.md` (it refuses a file that doesn't parse), then commit that file only, by path.

### Review type

Residual round

### Carried findings (mark each RESOLVED or UPHELD, with evidence)

- F11 [should-fix] test/export.test.js:111 — A1, R10.5 — The parity test never executes the page, so it passes when page exports ignore the current parameters — Exercise the page export path with nondefault parameters and compare its resulting files with the CLI, including browser-engine coverage for the promised portability.
- F2 [nit] src/server/server.js:68 — R8.1, standing server confinement rule — The web and DSP mounts follow filesystem symlinks outside their permitted directories — Enforce filesystem confinement, including symlinked path components, when opening static files.

### Review type

residual verification, round 3 — narrow

**Contract:** `docs/SPEC.md` v1.2 (changed since round 2: R8.1 states the statistics stream limits, approved by the user 2026-11-12) and `review/CONTRACT.md` (unchanged)
**Baseline:** `2a1bfee` (the round 2 result)
**Under review:** `2a1bfee..4ee99b5`: the spec 1.2 commit `aaeb237` and the fix commit `4ee99b5`. `efb6592` holds only ticket files. Commits after `4ee99b5` (the T-004 result, this kickoff) aren't under review.

### What changed
1. Spec 1.2 (`aaeb237`): R8.1 says at most 16 statistics streams are open, a further one is refused with 503, and a stream whose client has more than 256 KiB of unsent data is closed.
2. F11 (`4ee99b5`): new `test/page-export.test.js` runs the page's actual export handler (`runExport` in `web/app.js`, loaded unchanged) in Node, with a document, storage and download stand-in built only from Node's own facilities. It loads a non-default parameter file through the page, edits more settings through the page's controls, clicks all seven export buttons, and compares the downloaded bytes, ZIP entries included, with the files of `cli/render.js`.
3. R8.1 (`4ee99b5`): the two server stream tests now assert the spec's numbers (16, 256 KiB). The constants' comment cites R8.1. The code is unchanged.

### Priorities, in order
**Priority 1 — Disposition of F11 and F2**
- F11 RESOLVED (builder's claim): the retained test exercises `runExport` with edited, non-default parameters through to the downloaded bytes and compares them with the command's files. Your mutant, `pageExport(what, defaultParams())` inside `runExport`, is killed. A run in a real browser engine isn't part of this test; it stays with the user's browser check (task 5).
- F2: no change. The user accepts the remaining local-access limitation (the directory-replacement race) as a nit. By the user's rule, a finding that needs write access to the user's own files isn't hardened further.

**Priority 2 — R8.1 as worded in spec 1.2 against the code and tests of `6e9d6b9`**
Check that the code and its tests match the R8.1 wording exactly: 16 streams, 503 beyond, a stream with more than 256 KiB unsent is closed. `4ee99b5` adds only the two assertions on the numbers and the comment.

**Priority 3 — Regressions introduced by the fix**
For example, does the new test leave timers, files or global state that affect other test files? Is the suite still green and reasonably fast?

**Security (standing)** — re-check the server rules, the no-dependencies rule and repository hygiene from `review/CONTRACT.md` against `2a1bfee..4ee99b5`.

**Test quality** — rerun your M6-page mutant (`pageExport(what, defaultParams())` in `runExport`) against the production suite. Judge whether the new test would catch other simple faults in the page's export path and control binding.

**Out of scope:** everything else.
