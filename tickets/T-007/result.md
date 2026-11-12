# Review results — T-007 (v1.1 round 1)

Reviewer: codex. Contract: the reviewer contract + `tickets/T-007/contract.md`.
Append into the sections below; never rewrite an earlier section.

## Test run

<!-- full suite result: command, toolchain version, counts -->

Reviewed `f027832..000cf5a` against `docs/SPEC.md` v1.4 and `review/CONTRACT.md`. The working tree was clean at entry; the stopped run had left this empty scaffold, no unfinished implementation or review result. HEAD was `8f3bc2a`; its later kickoff does not change `src/`, `web/`, `test/` or `package.json` relative to the review endpoint.

Node **v22.23.4**. Required `npm test`: **86 passed, 0 failed, 0 skipped** after approved escalation. The initial sandboxed run reported 4 passing and 3 failing test-file wrappers; a direct server-test diagnostic exposed `listen EPERM` on 127.0.0.1. These were environment failures, not counted as product findings. Snapshot creation and mutation-test subprocess streams also required escalation after EPERM; each was retried with approval, not bypassed.

Additional checks: one page-handler integration probe passed (six preset choices, three presets in each mode); six full baseline/current export comparisons passed (126 WAV files); four saved-file round trips passed; two required mutants were killed by their intended assertions. Disposable snapshots of the exact baseline and endpoint were kept inside `.review-tmp/T-007/`, then removed. No dependencies were installed.

## Priority 1 — Presets and parameter files after the R6.14 change

<!-- findings -->

No functional finding. All three `defaultParams(name)` objects are deeply equal to the baseline objects despite the different property insertion order. Live defaults remain adaptive, 99 operations/s, 0.4 s ramp-up, 8 s cooldown, adaptive background 7% / -18 dB and manual background 15% / -7.5 dB. Pattern defaults remain enabled, read/write spreads 0.9/0.5, reach 0.2 and flush 5 s. The scenario remains light desktop use, with operations/s 4, burstiness 0.85, burst length 5, spread 0.7, read share 0.7 and operation size 32 KB. These match R6.14, R8.6–R8.9 and R9.1–R9.7; existing baseline/generator tests remain green.

For every preset, loaded a baseline-produced JSON object with edited activity settings, seed and simulation controls: sanitization preserved it. Deleted each of `live`, `pattern`, `scenario` and `sim` in turn: the new sanitizer matched the baseline fallback. Malformed group containers and out-of-range baseline, simulation and pattern values also matched baseline filling/clamping. The four hostile-file tests passed, including unknown and prototype-property preset/scenario names, nested prototype payloads, inherited fields, overflowing/nonfinite numbers and 50,000-entry arrays. The closed round-1 F4 guarantees remain intact; this is not a reopening of that finding.

A throwaway probe reused the repository's dependency-free page stand-in from `test/page-export.test.js` and imported the actual unchanged `web/app.js`. It restored edited stored JSON on startup, then loaded nondefault parameter files and fired the real preset change listener for every shipped preset in both live and simulation modes. Persisted parameters equalled the selected preset plus the preserved master volume, seed and entire export object; every schema control and scenario selector refreshed, and the mode boxes stayed in the selected mode. An AudioContext guard recorded zero automatic starts. This is a handler-level probe, not a browser layout or audio judgement.

Export reproduction: import each snapshot's `defaultParams` and `exportAll`; for each of the three preset names and both 44100/48000 Hz, compare the complete named byte arrays returned by the old and new functions. All **6 × 21 = 126 WAV files** were byte-identical. This supports the builder's claim for the shipped defaults at both supported rates. Property order changes JSON text ordering, but no value change or dependence on that order was found in storage, sanitization or rendering.

## Priority 2 — R9.8, the pulse cue

<!-- findings -->

No functional finding. `web/style.css:69` declares `spin-up-cue 1.4s ease-in-out 0.4s 3`: three finite iterations after the delay, with the ordinary non-retaining fill behaviour. The keyframes return to the primary button's steady background at each end. Only background and box-shadow animate; the focus outline and disabled opacity/cursor rules remain independent. The button markup, handlers and audio-start path did not change. Startup constructs no audio context; sound starts through explicit button handlers. The R9.8 assertion catches a changed iteration count (below). Visual softness and actual browser rendering remain the user's already-completed judgement, as the kickoff requires.

## Priority 3 — The preset files

<!-- findings -->

No finding. Parsed all four endpoint files and asserted `sanitizeParams(parsed)` deeply equals the complete parsed object: preset 1, preset 2 desktop, preset 3 desktop and preset 4 laptop soft idle all passed without dropped fields, added defaults or clamping. Their content consists of parameter values; no personal information, secrets, executable content or recording data was found. The user's tuning values were not judged or changed.

## Security

<!-- invariant re-check against the diff -->

`git diff --name-only f027832 000cf5a -- src/server package.json` is empty. Re-read the server and checked the green server suite: loopback binding, GET/HEAD-only handling, loopback Host validation, web/DSP mounts, direct preset-file names and size limits, regular-file/no-link handling, read-only behaviour, stream count and backpressure limits are unchanged. The previously accepted F2 local-filesystem limitation is outside this engagement and is not reopened.

`package.json` still has no dependency or install requirement; the core API-isolation test passes, and the changed parameter code uses plain JavaScript only. Reviewed the in-scope diff and commit metadata: all ten commits use the required noreply identity for both author and committer; no new personal-data/secret issue was found outside the kickoff's explicit exclusions. No audio assets or recording inputs were added. Approved spec commits precede both behaviour changes.

F1 [severity: nit] presets/hdd-sim-preset-1.json:1 — review/CONTRACT.md standing repository-hygiene invariant — The user-authored commit 73e79b6 lacks the required Agent: trailer (the other nine commits have it) — Keep history intact as instructed; include an appropriate attribution trailer on future commits.

Reproduction: `git show -s --format='%(trailers:key=Agent,valueonly)' 73e79b6` returns no trailer. This is a historical attribution nit, not a personal-data or runtime defect; the excluded name in that commit message is not a finding and no history rewrite is requested.

## Test quality

<!-- mutation checks -->

Both mutants were made independently from `000cf5a`; production files were never mutated. The assertions failed for the intended values after escalation, not merely because the test process could not run.

| Mutant | Reproduction in disposable copy | Result |
| --- | --- | --- |
| One preset has the wrong baseline | After `addActivitySource();` in `src/dsp/params.js`, insert `PRESETS['laptop-2000s'].live.baselineOps = 100;`; run `node --test --test-name-pattern='R6.14' test/features.test.js` | **KILLED**: R6.14 fails at `test/features.test.js:717`, actual 100 versus expected 99. |
| Spin-up cue has two pulses | In `web/style.css`, change `spin-up-cue 1.4s ease-in-out 0.4s 3` to the same declaration ending in `2`; run `node --test --test-name-pattern='R9.8' test/page.test.js` | **KILLED**: R9.8 fails at `test/page.test.js:65`, actual `'2'` versus expected `'3'`. |

The baseline assertion uses literal spec values independently of `defaultParams`, so it detects a jointly wrong preset/default. The pulse test checks the declaration and keyframe existence, not computed browser styling or perceived softness; those limits are not claimed as covered by this run. The additional page probe verifies the preset wiring that the direct `applyPreset` test alone does not exercise.

## Phase verdict

<!-- CLEAN PASS | PASS WITH SHOULD-FIX | FAIL (blocker) -->

**CLEAN PASS**

0 blockers, 0 should-fix findings, 1 attribution nit (F1). No carried findings were assigned to this delta engagement. No implementation or spec edits, and no new behavioural spec deviations. Result-format validation is required before recording this verdict.

## Notes / observations outside scope

<!-- -->

The user's previous listening and browser judgements stand; this review did not repeat or independently certify Chromium/Brave/Firefox playback, downloads or perceived pulse softness. The README accurately attributes the browser parity check to the user and leaves Safari unverified. Commits after `000cf5a`, closed findings and the kickoff's excluded files/history remain outside the verdict.

The stopped run's dashboard steps were under the old phase-3 review task. Marked those superseded steps skipped and recorded this engagement's completed work under phase 7 instead; the planner's phase list was preserved. No questions or spec decisions were needed.
