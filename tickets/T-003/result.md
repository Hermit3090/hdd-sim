## Test run

Engagement: T-003, v1 round 2, residual verification. Contract: `docs/SPEC.md` v1.1 and `review/CONTRACT.md`, as named in `tickets/T-003/contract.md`. Reviewed: `2342fb8..3cd240b`; later kickoff/ticket commits are excluded.

- Node **v22.23.4**, Linux. Required `npm test`: **84 passed, 0 failed, 0 skipped**, 2.221 s. The sandboxed attempt failed in the server and export test files; the same command passed with approved escalation for local sockets and child processes.
- Archived `3cd240b` into `.review-tmp/T-003/copy`. All mutations, fixtures, subprocess outputs and synthetic servers stayed inside this repo; `TMPDIR` pointed into `.review-tmp/T-003/tmp`. No installation, other-repository change or push. Tests ran from the disposable copy's root using `npm test --prefix` so their temporary static-mount links never touched the working tree's implementation.
- Eight isolated mutants: **seven killed, one survived** by the production suite. After restoring them, final `npm test`: **84 passed, 0 failed, 0 skipped**, 2.601 s. Source, web and test directories in the restored copy matched the working tree, whose implementation matched the reviewed revision.
- Additional checks: 63 honest parameter-file comparisons against the round-one sanitizer, 63 JSON round trips, version-1 migration, 2,080 queue-reduction cases, light capture/cooldown and mixed-operation weighting at both supported sample rates, 61 HTTP cases, statistics sampling stop/restart, and a deterministic intermediate-directory race.
- Executed the actual page module with Node's built-in VM and a minimal DOM/event/download double: six load-order/invalidation scenarios and all seven export buttons passed. This is **not a browser run**. The same harness caught the page-binding mutant that the production suite misses. An initial auxiliary attempt to display a large byte-array mismatch was interrupted; rerunning with a compact byte-equality assertion gave the explicit expected assertion failure, then the restored page passed.
- Committed the unchanged prior-round result first as `d3afc97`, with the prescribed round-one message and identity. Git staging initially hit the sandbox's read-only index; approved escalation completed that commit.

## Priority 1 — Disposition of F1–F11

F1 **RESOLVED** — `src/server/server.js:41`: the preset route opens with `O_NOFOLLOW` and `O_NONBLOCK`, validates type and size on that handle, reads at most the limit plus one byte, and catches open/read failures before replying. The regression test replaces the checked file with a link, grows it beyond the limit, or deletes it; each gives 404 and subsequent requests work. Removing `O_NOFOLLOW` killed M18. This resolves the demonstrated round-one final-component races; it is not a claim of atomic pathname resolution for every directory component.

F2 **UPHELD in part**, now nit — `src/server/server.js:83–93`, R8.1 and standing confinement rule. Stationary symlinks in either mount, linked intermediate folders and final-component replacements are now refused; M20 verifies that the intermediate-component check matters. A checked intermediate directory can still be replaced before subsequent lookup/open. Reproduction in the disposable copy: create `web/review-race/probe.json` containing `{}` and an outside-of-mount fixture `outside/probe.json` containing `OUTSIDE_SENTINEL`; wrap `fs.lstatSync`, return the original stat for `web/review-race`, but first rename that directory and replace it with a link to the fixture; call `syncBuiltinESMExports()`. GET `/review-race/probe.json` returned **200 and `OUTSIDE_SENTINEL`**. The last component is a regular file, so `O_NOFOLLOW` does not reject it. This requires local write access to the served tree and is **a nit under the user's revised severity rule**, not a remotely reachable blocker. Preserve that limitation in the disposition; no elaborate hardening is required for this review's nonblocking verdict. Full confinement against directory replacement would require a separate decision if the owner wants it.

F3 **RESOLVED** — The server caps active GET streams at 16, refuses further streams with 503, and drops a response whose queued bytes exceed 256 KiB before writing another frame. The bound permits one frame of overshoot, not unlimited accumulation. Tests check admission, freeing a slot and dropping a stalled client; the independent normal-client probe confirmed sampling stops after the last client closes and restarts on reconnect. HEAD `/stats` does not start sampling. The existing question about documenting these internal safeguards remains the owner's decision.

F4 **RESOLVED** — Own-property name lookup is used by sanitizer, preset/default/apply helpers and scenario export fallback. Only known own fields are merged; array entries are rebuilt with known finite fields; filter NaN/Infinity now fall back. The four new parameter tests exercise prototype names, inherited/unknown fields, wrong containers, overflowing JSON numbers and bounded lists. Additional honest-file comparisons preserved all tested values, with only the approved resonance clamp accounted for.

F5 **RESOLVED** — `createSampler` refreshes the whole-disk inventory every sample. Its fixture test attaches a new disk after initialization, checks its zero-delta baseline and subsequent read/write/byte deltas. The page's existing device-list update consumes the refreshed keys. No hardware hotplug or end-to-end latency claim is made.

F6 **RESOLVED** — Lowering `queueMax` merges removed bytes into the original newest operation and preserves its write type, distance and background flag. The regression test covers both model and live engine parameter changes; M12 is killed. The independent 2,080-case matrix checked all reductions of queue lengths 1–64, byte conservation and retained newest metadata.

F7 **RESOLVED** — Service start captures the adaptive level; background busy time is weighted by that captured value. The regression test changes the live level during one long operation, then checks the next operation captures its own level; M10 is killed. Additional probes covered cooldown during service, reset, mixed normal/background operations and both 44100/48000 Hz. No new nonfinite light value or stale busy accumulator was observed.

F8 **RESOLVED** — The initial countdown and each off-to-on simulation transition start at the selected flush interval. The all-write regression checks the first group at approximately 5 s and no premature writes after re-enabling. M9, omitting the transition reset, is killed.

F9 **RESOLVED** — Resolved against **spec v1.1**, not by shortening filter ringing. R6.5 explicitly limits the pre-filter click; R6.15 now permits 0–12 dB resonance. `FILTER_LIMITS`, the generated control limits, page hint and tests agree. Existing raw-click and filtered one-shot tests remain green. This review does not reimpose the superseded post-filter 60 ms requirement.

F10 **RESOLVED** — Inspection and execution of the actual app handlers confirm that preset fetches and file imports use the load gate, while built-in selection, reset and selection of a hand-loaded file invalidate older loads. The independent harness exercised A-then-B with reversed completions, built-in selection, reset, file import, hand-loaded entry selection and obsolete failure suppression. Master volume stayed at the page's value. M24 kills omission of the gate's invalidation. Production tests cover the gate itself; page wiring was independently probed here.

F11 **UPHELD in part**, now should-fix — `web/app.js:498`, `test/export.test.js:157`, A1/R10.4/R10.5. The new test meaningfully verifies `pageExport` with nondefault values, ZIP entries and individual sequences against CLI files. The builder's relocated M6 (defaults inside `pageExport`) is killed, as claimed. However, the original defect class at the page boundary remains untested: replace `pageExport(what, params)` in the actual `runExport` with `pageExport(what, defaultParams())`; **all 84 production tests still pass**. The independent app harness fails on the resulting incorrect downloaded bytes and passes once restored. Add a retained test exercising the actual export handler with edited parameters through its download boundary, asserting files against the CLI; built-in Node facilities suffice for a DOM/event double. This is a coverage gap, not an observed failure in the unmutated page. Cross-engine execution remains deferred to the existing owner browser check, as the kickoff allows; it is not a new blocker or a reason to install packages.

## Priority 2 — Regressions introduced by the fixes

No additional runtime regression demonstrated in the changed code.

- Sanitizer: 60 generated honest parameter objects across all built-in presets and schema ranges, alternating version 1/2, matched the previous sanitizer. Three shipped parameter files also matched after accounting for the approved 12 dB resonance limit. Their chosen values were not judged. All 63 sanitized objects round-tripped unchanged; explicit version-1 spindle silence migration remained intact.
- Static serving: GET/HEAD for `/`, app/load/worklet/style assets, DSP modules, preset list, ordinary and empty preset files returned the expected success and matching content types, with empty HEAD bodies. Forbidden mount paths returned 404. Host and method matrix checks are described below.
- Statistics: normal streams delivered samples, disconnected cleanly, stopped sampling with no clients, and restarted on reconnect in two cycles. The suite separately verifies cap recovery and stalled-client disconnection. Actual browser EventSource reconnect timing was not measured.
- Queue and light: shrinking while work is queued conserves bytes and newest metadata; model background time and weighted levels remain separate from normal busy time. The reviewed change does not introduce an extra light/audio state transition.
- Page: six load-order cases and seven export button downloads passed in the actual module harness. For nondefault seed, 48 kHz, separate write sound and short sequence settings, every captured download's name, MIME type and bytes equalled `pageExport`. The production suite independently compares that helper's artifacts with the CLI. Browser layout, Blob download delivery and sound scheduling remain outside this harness.

## Security

Rechecked R8.1/R8.12–R8.14 against the changed server. The executable binds to `127.0.0.1`; foreign Host values are rejected. For page, stats, preset list/file and DSP routes, POST/PUT/PATCH/DELETE/OPTIONS/TRACE returned 405 and three non-loopback Host spellings returned 403. The checked traversal/malformed paths and stationary symlinks are refused. There is no new write endpoint, remote-content import path or permissive CORS header. The residual F2 directory race needs local filesystem writes and is rated nit under the current contract. No external exploit was demonstrated.

`package.json` still has no dependencies or install step. The added core export import is the existing portable ZIP module; the DSP core still uses no Node-only/browser-only API. All 17 commits in `2342fb8..3cd240b` use the required noreply author and committer identity and have an `Agent:` trailer. Inspection of the in-scope diff and commit messages found no new secret/personal-data issue or recorded-audio asset. Spec v1.1 was committed before the corresponding code fix. `git diff --check 2342fb8 3cd240b` passed. No spec or implementation file was edited by this review.

## Test quality

Each mutation ran alone against the complete production suite in the throwaway copy and was restored before the next:

| Mutant | Change | Result |
| --- | --- | --- |
| M6-core | `pageExport` sanitizes `{}` instead of its input | **KILLED**, 83 pass / 1 fail: new page-core parity test |
| M6-page | Actual app calls `pageExport(what, defaultParams())` | **SURVIVED**, 84 pass / 0 fail; independent handler/download harness kills it |
| M9 | Remove off-to-on flush countdown restart | **KILLED**, 83 / 1: first-write/re-enable regression |
| M10 | Light target uses current `bgLift()` | **KILLED**, 83 / 1: captured operation-level regression |
| M12 | Skip shrinking the existing queue | **KILLED**, 83 / 1: queue reduction regression |
| M18 | Remove `O_NOFOLLOW` from the one-handle reader | **KILLED**, 83 / 1: preset replacement race regression |
| M20 | Omit path-component symlink rejection | **KILLED**, 83 / 1: linked intermediate-folder regression |
| M24 | Gate invalidation does nothing | **KILLED**, 83 / 1: stale load regression |

Other new tests were assessed by reading their assertions and their green execution: resonance checks range and both clamps; disk discovery checks first baseline and later deltas; parameter tests assert sanitized structure/types/finite values/fallbacks; stream tests assert cap recovery and actual socket destruction. These would fail the specific simple regressions they target. Preset race coverage forces replacement/growth/deletion after `lstat`; it does not prove atomic intermediate-directory resolution (F2). The gate test is useful unit coverage, not proof of app wiring. Export ZIP contents are decoded and compared, rather than trusting the helper's returned file list.

The builder's M17 survivor only changes copying cost; M19 removes a redundant size check while the bounded read still enforces the externally observed limit. Those explanations are consistent with the code; they were not counted as independently rerun mutants here. No other builder mutation outcome is presented as an independent run. No browser-engine parity result is inferred from Node equality.

## Phase verdict

**PASS WITH SHOULD-FIX**

**0 blocker, 1 should-fix, 1 nit.** New: none. Upheld in part: F2 (now nit), F11 (should-fix). Resolved: F1, F3, F4, F5, F6, F7, F8, F9, F10.

The runtime fixes pass their demonstrated regressions. The remaining should-fix is the page export binding coverage gap; the local directory-replacement limitation is nonblocking under the owner's current severity rule. Hand back to builder `claude` for disposition. No new behavior or spec change is proposed or applied by this review.

## Notes / observations outside scope

- F9 follows the owner's approved spec-v1.1 decision; F1/F2 severity follows the revised local-access rule. No fresh owner answer was needed during this run.
- Existing q1 remains open: whether R8.1 should document the stream limits. The builder's default is unchanged: internal safeguards, spec unchanged. This review does not resolve it for the owner.
- The existing task 5 covers owner listening/browser checks. A3 realism, actual browser downloads/layout/audio timing, physical hotplug timing and non-Chromium artifact parity were not independently verified. No duplicate owner-test ticket or dependency installation was needed for this narrow review.
- Only the current result was authored as a tracked-file change; the earlier T-001 result was committed unchanged as explicitly required. Disposable probe files are removed after recording their evidence here. No worktree was registered.
