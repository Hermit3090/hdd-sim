# T-001 — v1 round 1 review

## Test run

Contract: `docs/SPEC.md` v1.0 (approved by the user 2026-11-10; later changes each dictated or approved by the user), `review/CONTRACT.md`.
Reviewed: `58c5343..2342fb8`. Reviewer: codex. No carried findings.

- Node **v22.23.4**, Linux. Required `npm test`: **69 passed, 0 failed, 0 skipped** after sandbox escalation, 1.821 s. The first sandboxed run failed because loopback listening and child processes were denied (`EPERM`), not because of application assertions.
- Exported `2342fb8` with `git archive` into an authorized disposable directory. Production source, tests, package metadata and spec in the working tree matched the reviewed revision. All additional probes and mutations ran in the disposable copy, with synthetic files and ephemeral loopback servers.
- Seven distinct mutants: **six killed, one survived**; details below. The chunk mutant first exceeded the subprocess output-buffer limit while printing its failed array assertion; rerunning with output directed to a file completed normally and confirmed the failure.
- Final clean-copy `npm test`, after restoring every mutant: **69 passed, 0 failed, 0 skipped**, 1.834 s.
- Additional checks: HTTP paths/hosts/methods; deterministic filesystem races; bounded SSE backpressure load; parameter and diskstats fixtures; 128 renders at combinations of parameter-range endpoints; engine lifecycle probes; page logic with a minimal DOM/event double. The endpoint renders produced **0 nonfinite outputs and 0 clipping failures**.
- The page harness is **not a browser run**. No claim is made about layout, actual downloads in a browser, browser audio scheduling, non-Chromium parity, A2 end-to-end latency, or A3 sound realism.

## Priority 1 — Server boundaries and resource handling

F1 [severity: blocker] src/server/server.js:154 — R8.1, R8.13 — Preset validation and opening use separate pathname lookups, permitting symlink replacement, oversized responses and a process-ending read error between them — Open without following links, validate the opened regular file, bound the bytes read, and handle stream errors before committing a successful response.

Reproduction: in a throwaway copy, wrap the built-in `lstatSync`, call the original, then perform a one-time fixture change before returning its result; use `syncBuiltinESMExports()` before importing the server. Request a permitted `race.json` initially containing `{}`. Replacing it with a symlink to an outside fixture returned **200 and `OUTSIDE_SENTINEL`**. Appending 2 MiB instead returned **200 and 2,097,154 bytes**, exceeding the 1 MiB limit. Deleting it instead terminated a disposable server process with exit **1**, an unhandled ReadStream `ENOENT`. These probes force an actual gap between checking and opening; they do not change the server's validation logic. Existing tests only check files whose state is fixed before the request.

F2 [severity: blocker] src/server/server.js:68 — R8.1, standing server confinement rule — The web and DSP mounts follow filesystem symlinks outside their permitted directories — Enforce filesystem confinement, including symlinked path components, when opening static files.

Reproduction: create `web/probe-link.json` as a symlink to a synthetic file outside `web/` and `src/dsp/`, then GET `/probe-link.json`. It returns **200 and the outside sentinel**. `normalize` and the string-prefix check constrain only the pathname; `statSync` and `createReadStream` follow the link. No such link is shipped, and this is not a remote link-creation exploit; the blocker classification follows the contract's explicit rule for violations of server confinement.

F3 [severity: should-fix] src/server/server.js:94 — T-001 priority 1, bounded statistics-stream resources — Every tick writes to every client despite backpressure, and accepted SSE connections have no application limit — Bound active streams and per-client buffering, disconnecting or otherwise handling clients that cannot consume samples.

Reproduction: start the copy's server with a synthetic sampler returning 1,500 device entries, open 64 GET `/stats` sockets, and pause their receiving side. All 64 connections remained accepted. Summed `ServerResponse.writableLength` was **120,383,694 bytes at 6 s** and **269,325,006 bytes at 9 s**, with `writableNeedDrain` true for all 64. These are queued-byte counts, **not measured RSS**; the large synthetic frame accelerates the test and is not representative of an ordinary disk inventory. The probe stopped at 9 s and closed all sockets. The missing bound also exists for small frames over a longer stalled connection. No machine exhaustion or cross-site exploit was attempted.

Other checks: main binds to `127.0.0.1`. Traversal, encoded traversal/separators, double encoding, backslashes and nulls did not escape the permitted mounts. `/dsp//engine.js` serves the same permitted file; `//dsp/engine.js` and doubled preset separators returned 404. A 20 KB request path returned Node's 431 response. Host values `evil.example`, `127.0.0.1.evil.example` and `localhost.evil.example` were refused on both `/stats` and `/presets/`; allowed loopback names worked. There are no permissive CORS response headers. DNS rebinding to a foreign Host therefore fails the checked Host gate; ordinary cross-origin reads are not enabled. POST, PUT, PATCH, DELETE, OPTIONS and TRACE returned 405 on the page, DSP, stats and preset routes. HEAD returns no body. Static preset links, invalid names, directories, missing folders and initially oversized files are covered by the green suite. The builder's assertion that the suite covers every refused case is too broad: it lacks the races, static-mount symlinks and resource cases above.

## Priority 2 — Parameter files and statistics

F4 [severity: should-fix] src/dsp/params.js:125 — R4.5, T-001 hostile-parameter validation — Prototype property names are treated as valid preset/scenario names and can break parameter loading or export — Use own-property membership or the exported name lists consistently for every preset/scenario lookup and fallback.

Reproduction: `sanitizeParams(JSON.parse('{"preset":"__proto__"}'))` throws while reading missing `light.color`; preset `constructor` or `toString` throws during cloning. A file containing `{"export":{"burstScenario":"constructor"}}` survives sanitization, then `renderSequence('burst', p)` throws. `__proto__` as the burst scenario is also accepted and supplies an empty scenario rather than the documented fallback. By contrast, `bogus` correctly falls back. This is inherited-property lookup, **not demonstrated prototype pollution or code execution**. The page catches the load/export error; CLI sanitization can exit with an uncaught exception.

F5 [severity: blocker] src/server/diskstats.js:55 — R8.2, R8.3 — Whole-disk discovery is cached forever, so a disk attached after sampling starts is never streamed or selectable — Refresh the whole-disk inventory and establish an initial counter baseline for newly discovered devices.

Reproduction: use fixture `blockDir` and `statsPath`. Start with `sda`, sample, then add a `sdb` directory and valid diskstats rows for both devices. Sample again with increasing `sdb` counts. Both results contain only `sda`. An ordinary newly attached disk is invisible until the server restarts. The missing-file and whole-disk-filter unit tests do not exercise discovery after initialization.

The merge walks known default keys; injected `__proto__` and `constructor.prototype` objects did not pollute Object.prototype. Incorrect primitive/container types fall back for the checked fields. Valid JSON overflow numbers (`1e400`, `-1e400`) clamp or fall back. Invalid split and baseline modes fall back. Arrays of 50,000 resonator/harmonic objects were reduced to **8/16**, though cloning and filtering still traverse the input before truncation. No code-evaluation or HTML-interpolation path was found: file names, error text and device names reach `Option` or `textContent`.

Direct JavaScript `NaN` is a separate limitation: `sanitizeParams({filters:{hp:{all:{hz:NaN}}}})` retains NaN, and an Engine using that result renders NaN; `resDb` behaves the same. The filter fields omit the finite-number fallback used by SCHEMA fields. NaN cannot be represented by a JSON parameter file, and the page's numeric handlers reject nonfinite numbers, so this is not asserted to be a file-based exploit or an ordinary-user blocker. Finite fallbacks would make the public sanitizer's promise consistent.

Diskstats fixtures confirmed positive deltas, counter resets clamped to zero, disappearing devices omitted, and returning previously known devices starting with zero deltas. Arbitrary malformed counters are not validated (`Number` can produce NaN); the normal producer is the kernel, not a downloaded parameter file. Odd device names were passed as literal option text in the page harness. Zero/negative intervals are rejected by `Engine.feed` before baseline history grows: 2,000 rejected calls left both history and feeds empty. Calling `Baseline.sample` directly 5,000 times with zero interval retains 5,000 entries; that requires bypassing the actual entry-point guard.

## Priority 3 — Determinism and exports

No demonstrated runtime determinism defect for the tested valid inputs. Seeded, numbered PRNG streams keep layers independent. The core has no `Math.random`, wall clock or host API dependency. The engine caches complete 128-sample chunks; the split-call mutation was killed. JSON round trips preserve the tested outputs, and fixed array iteration and known-field merging avoid depending on parameter-file key order. The ZIP date is fixed. Disabled filters bypass exactly in the exercised paths, and default filter tails eventually become exact silence.

R10.5 remains only partly evidenced: the automated parity test compares the Node CLI against the same export core running in Node. It does not run the page; see F11. Chromium parity is a builder claim that this review did not independently rerun.

There is a concrete portability risk, but no demonstrated cross-browser mismatch here: the DSP uses `Math.sin`, `Math.cos`, `Math.exp`, powers and logarithms in oscillators, resonators and filters. ECMAScript permits implementation-approximated results for these transcendental operations, so shared source alone does not prove bit identity across engines. Small differences may be erased by Float32/PCM rounding or may cross a rounding boundary; actual artifact comparisons are needed. Source: [ECMAScript Math operations](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.sin). This agrees with README's explicitly disclosed verification limitation; it is not evidence that a particular other browser fails.

## Priority 4 — Drive model, baseline and read/write pattern

F6 [severity: blocker] src/dsp/drive-model.js:22 — R5.5, R9.4 — Reducing the queue-length control leaves the existing queue above its new maximum — Coalesce excess queued work into the retained newest entry when applying a smaller bound, preserving its operation type.

Reproduction: spin an Engine up immediately, enqueue 64 operations of 400,000 bytes at distance 0.5, then set sanitized parameters with `drive.queueMax=1`. After processing 128 samples the model still has **63 queued operations with maximum 1**. The old backlog persists while new operations merge into its last entry. The current queue test covers a fixed maximum at admission, not a live parameter change.

F7 [severity: blocker] src/dsp/engine.js:271 — R8.9 — Adaptive light brightness uses the latest activity level during an operation instead of the level at seek start — Capture the adaptive level when service starts and use that operation's captured light target for its busy duration.

Reproduction: sanitized defaults with idle recalibration off, `maxTransferMs=2000`, read spread 1 and the default adaptive ramp/background brightness; feed one 16 MB operation over 0.05 s and render 0.1 s. Level is **0.125**, light **0.18625**, and the operation has **1.96869 s** left. Feed a second operation over 0.05 s and render five 128-sample chunks. The same operation is still being served, but level is **0.25** and light rises to **0.30235**. Its captured target should still be 0.18625. Click attenuation does take its level when `scheduleSeek` runs; the light path does not. Existing adaptive tests hold the level fixed throughout the operation.

F8 [severity: blocker] src/dsp/engine.js:54 — R9.7 — The first simulated write is flushed immediately because the flush countdown starts at zero — Initialize/reinitialize the countdown to the selected flush interval when beginning a simulation flush cycle.

Reproduction: sanitized defaults with `sim.opsPerSec=40`, `burstiness=0`, `readMix=0`, pattern on and `flushS=5`; spin up immediately, enable simulation and observe `model.addOp` during the first second. One write is delivered at **t=0**, with 39 others held. R9.7 says writes are collected instead of passed on when generated. The first flush should occur at the interval boundary; the builder's `2ed2c9b` message also explicitly states that interpretation. The existing mixed-read/write test happens not to catch an initial write.

The fixed-bound queue merge, merged operation type, seek timing formula and minimum inter-seek interval are sound in the inspected paths and exercised tests. Read/write spreads, write reach, live operation-type counts and live timing bypass of the simulated flush are covered. Manual threshold inclusion and adaptive ramp/cooldown math match the tested sample sequences. The manual/adaptive background pairs are separate, and swapping them kills three tests.

Defaults checked against sections 5–10: settle/full-stroke 2/22 ms; transfer 8 MB/s and cap 30 ms; queue 64; recalibration 20–60 s; laptop click bank/body/burst and variations; 4200/5400 rpm; harmonic numbers 1/10/12; spin-up/down 4/6 s; gains and default preset; all filter defaults; separate-write offsets; light constants; live mode/baseline and both background pairs; pattern spreads/reach/flush; sample rate, click count and loop length. These stated defaults match. The light-desktop scenario uses five-operation bursts; not every named scenario is required to have identical burst statistics.

On stream loss the page stops feeding and displays an unavailable status after its timeout; existing queued work drains rather than being explicitly discarded. Simulation remains independent of the stream. End-to-end A2 timings were not measured. The tests labelled A2 only exercise Baseline sample math, not HTTP delivery, main-thread scheduling, worklet delivery or rendered light/audio latency.

## Priority 5 — Sound chain

F9 [severity: blocker] src/dsp/engine.js:293 — R6.5, R6.19 — Live head filtering can extend a single click above its −60 dB tail limit far beyond 60 ms — Preserve the specified click-duration bound through the live filtered head chain and test the final head signal at allowed filter extremes.

Reproduction: default parameters, idle recalibration off, pair threshold 1, combined high-pass on at **20 Hz, 24 dB resonance, 24 dB/oct**. Trigger one distance-0.2 seek and render three seconds with `processLayers`. Relative to the resulting head signal's peak, the last sample at or above peak/1000 occurs at **778.12 ms at 44100 Hz** and **852.17 ms at 48000 Hz**. There is only one click; no long-seek pair or unlock is involved. The source click buffer's fade does not constrain the subsequent filter tail. One-shot export applies a separate post-filter fade, so its passing duration tests do not establish the live requirement.

The suite meaningfully checks layer isolation, mono WAV format, limiting, click normalization/fade, filter modes and slopes, write pitch/level and exported names. The 128 additional endpoint-parameter renders were finite and within full scale. Off-filter and loop-periodicity mutants were killed. Combined filters are implemented as equivalent per-layer filters before gains to preserve isolation. Presets correctly replace their Drive/Mix/Filters settings while retaining master volume; saved files are not coupled to shipped preset values. This is a technical signal review, not a realism judgment.

## Priority 6 — Page behavior

F10 [severity: should-fix] web/app.js:579 — R8.14, R6.14 — An earlier preset request can complete after a later selection and overwrite the user's newer choice — Give loads a request generation or cancel obsolete fetches, invalidating outstanding loads on every preset/file/reset choice.

Reproduction: in the page logic harness, supply a preset list containing A.json and B.json. Invoke the actual change handlers for A then B. Resolve B's fetch with seed 222, then A's fetch with seed 111. The final selector is **file:A.json** and parameters have **seed 111**, despite B being selected last. Choosing a built-in while A is pending is exposed to the same stale completion. A deferred-response harness forces the ordering; this review did not claim to reproduce the timing in a real browser.

The harness confirmed live start, a loaded file retaining master −6 dB despite containing +6 dB, literal display of an HTML-looking file name, and edits after loading reaching the current filter/resonator objects and saved JSON. Filter frequency 777 and resonator frequency 1234 persisted. Manual mode showed only its three settings; adaptive settings were hidden. Inspection confirms `[hidden]` has a display override, and rebuilding filter/resonator controls after object replacement avoids the earlier stale-reference bug. Storage reload calls the same sanitizer; schema controls address the current `params` object. Actual browser rendering, reload interaction and download delivery remain unverified here.

## Security

Historical metadata exceptions: `git log 58c5343..2342fb8 --format='%h %(trailers:key=Agent,valueonly)'` shows no Agent trailer on 459fb18 and 6bb492e; every other commit in the range has one. Every author and committer in the range uses the specified noreply identity. These exceptions are recorded here without proposing forbidden history rewriting or reopening the accepted first name in 6bb492e.

F1 and F2 violate the standing server rules. Host/method controls passed the checked cases; F3 records the resource limitation without claiming a demonstrated remote exploit. No dependencies or installation step appear in package.json, and the core imports only its own modules and uses portable language APIs. Inspection of the implementation, shipped preset strings and reviewed commit messages found no new secret or personal-data issue outside the two explicitly accepted names. All shipped files are source/configuration/text; no recorded audio asset is present, and synthesis generates the exports. The dashboard block, review infrastructure and later commits were excluded as directed.

## Test quality

F11 [severity: should-fix] test/export.test.js:111 — A1, R10.5 — The parity test never executes the page, so it passes when page exports ignore the current parameters — Exercise the page export path with nondefault parameters and compare its resulting files with the CLI, including browser-engine coverage for the promised portability.

Mutation reproduction: replace `const p = sanitizeParams(params);` inside `web/app.js`'s `runExport` with `const p = defaultParams();`. This breaks current-parameter page exports but **all 69 tests still pass**. It establishes a coverage gap, not a claim that the unmutated page currently uses defaults.

Each mutant was applied individually to the disposable copy and restored before the next run:

| Mutant | Change | Outcome | Evidence |
| --- | --- | --- | --- |
| M1 | Disable the Host rejection condition | Killed | 68 pass / 1 fail; Host refusal test |
| M2 | Use statSync instead of lstatSync for preset eligibility | Killed | 67 pass / 2 fail; listing and refused-link tests |
| M3 | Swap manual/adaptive background brightness and click fields in Engine | Killed | 66 pass / 3 fail; manual light, manual click and adaptive scaling tests |
| M4 | Multiply samples by 0.9 when Filter.run is off | Killed | 67 pass / 2 fail; combined/separate equivalence and motor-tone isolation |
| M5 | Discard Engine.avail at each process call | Killed | 68 pass / 1 fail; arbitrary split-call identity test |
| M6 | Page exports use defaults instead of current parameters | Survived | 69 pass / 0 fail |
| M7 | Return the spindle loop's initial transient pass and omit filtered settling rounds | Killed | 67 pass / 2 fail; raw and filtered loop seam checks |

A1 requirement-by-requirement assessment follows. “Meaningful” means an assertion compares an observable property that would fail for a corresponding break, not a claim of exhaustive coverage.

| A1 requirement | Assessment |
| --- | --- |
| R4.4 | Meaningful byte/sample equality, changed-seed inequality and arbitrary split sizes at supported rates; M5 killed. Cross-engine identity is not established. |
| R5.5 | Meaningful queue length, merge-byte accounting and backlog-drain assertions; misses changing the limit with work queued (F6). |
| R5.8 | Checks both average rate and consecutive seek spacing; a too-short seek interval would fail. |
| R6.5 | Checks raw ClickSynth length, finite samples and tail threshold; does not constrain the final filtered live head signal (F9). |
| R6.12 | Meaningful equality while changing the muted layer and exact all-muted silence, including active filters. |
| R6.13 | Checks every rendered sample for finiteness and range while ensuring the limiter is reached; valid settings also passed the extra endpoint probes. Not a hostile-input validation suite. |
| R10.2 | Checks WAV header, rate, channels, bit depth, variant count/names, onset, peak and silent faded end for presets/rates; additional filtered-click cases exist. |
| R10.3 | Checks seam step and curvature against within-loop steps and checks sequence output/gains; M7 killed. These are useful numerical checks, not perceptual proof of all seams. |
| R10.5 | Node CLI vs Node core equality is meaningful for CLI plumbing but misses the page and other engines; M6 survives (F11). |
| R6.16 | Combined/separate equivalence, independent HP/LP modes and part isolation are meaningful and catch M4's collateral changes. |
| R6.17 | Asserts preset defaults and equality for off/inactive settings; M4 is killed elsewhere in the filter suite. |
| R6.18 | Isolation and limiter assertions are meaningful; the title's filter-before-gain ordering is not separately proven for arbitrary settings. |
| R6.19 | Filtered exports differ from plain exports while preserving one-shot properties and loop seams; M7 killed. Live duration remains uncovered (F9). |
| R6.20 | Combined equality, separate inequality, quantitative level scaling and pitch zero-crossing counts are meaningful. |
| R6.21 | Counts simulated/live read and write types and checks merged type and recalibration reads. Unlock read sound is checked by implementation inspection rather than a specific assertion. |
| R8.6 | Manual last-second window boundaries and inclusion of the new sample are asserted. |
| R8.7 | Modes, default mode and parameter clamps are asserted. |
| R8.8 | Ramp, cooldown, saturation and separated/nearby burst behavior are asserted with fixed sample intervals. |
| R8.9 | Quantitative background light/click scaling, silence and independent mode values; M3 killed. The activity level stays fixed during each tested seek, missing F7. |
| R9.5 | Pattern-off equivalence, default settings and sound-mode independence are asserted. |
| R9.6 | Per-type spread ratios, write reach and live timing are meaningfully checked. |
| R9.7 | Counts flush groups, later spacing, read delivery and unaltered live timing; the initial all-write case is missing (F8). |
| R10.6 | Exact file names/counts and unchanged read-set bytes are asserted. |
| R8.12–R8.13 | Listing, contents, absent folder and static name/type/link/size refusals are asserted; M2 killed. No concurrent-change probes (F1). |

The suite is useful but is insufficient for a clean phase verdict. Server boundary mutations being killed does not establish resistance to all pathname races; likewise an export-core check is not a page check. Add regression cases tied to the confirmed findings, without treating the passing baseline as evidence those cases already ran.

## Phase verdict

**FAIL (blocker)**

**7 blocker, 4 should-fix, 0 nit.** New: F1–F11. Upheld: none. Resolved: none.

Blockers: F1, F2, F5, F6, F7, F8, F9. Should-fix: F3, F4, F10, F11. The green baseline does not waive these reproduced defects. No implementation or spec changes were made.

## Notes / observations outside scope

- R-20261112-001 left no result. The updated reviewer contract authorizes the temporary copies/fixtures needed here. No additional package, tool installation, other-repository change or push was needed.
- A3 realism and personal preset tuning were not judged. Roadmap/open-question sections were not reviewed. A2 end-to-end timing and non-Chromium parity are explicitly unverified, not silently accepted deviations.
- No behavior changes or spec amendments were proposed/applied as part of this reviewer-only ticket. The findings identify deviations for the builder to resolve under the existing contract.
- The task list was empty and provided no existing phase review task to attach steps to; it was not replaced or invented by the reviewer.
- `tickets/T-001/record.md` was already modified at the start by the dashboard's release-from-hold entry. Under **Commit the results**, any other modified tracked file prevents the reviewer commit. If it remains modified at completion, the result must stay uncommitted; the reviewer may not alter, stage or commit that record to clear the condition.
