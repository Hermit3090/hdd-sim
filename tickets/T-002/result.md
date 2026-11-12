# T-002 — Fix v1 round 1 findings: result

**Verdict: done.** All eleven findings of T-001 are fixed, one commit per finding, each with a regression
test; `npm test` was green before every commit (84 passed, 0 failed at the last fix commit `3cd240b`; 69
in round 1). No dependencies, no spec text changed, nothing pushed. `tickets/T-001/result.md` was not
touched.

## Fixes

| Finding | Commit | Fix | Regression test | Mutants killed |
| --- | --- | --- | --- | --- |
| F9 | `11b64ee` | Spec 1.1: `FILTER_LIMITS.resDb` 0–12 dB; the page's hint text and the tests use 12 dB. Nothing shortens filter ringing. | R6.15: resonance is 0-12 dB; values outside are clamped | M8 |
| F8 | `24a6548` | Switching simulation on starts a flush cycle with the countdown at the flush interval. | R9.7: the first simulated write waits for the first flush interval, also after simulation is switched on again | M9 |
| F7 | `5251b38` | The drive model reads the adaptive level when it starts serving an operation; the light target uses that captured level. | R8.9: the light limit of an operation uses the activity level at the moment its seek started | M10, M11 |
| F6 | `91281bf` | A lower queue maximum merges the excess into the newest queued operation, which keeps its type. | R5.5: lowering the queue length applies to work already queued; the newest operation keeps its type | M12 |
| F5 | `37f2e83` | The disk list is read on every sample; a new disk starts with no change, then counts from that baseline. | R8.2, R8.3: a disk attached while the server runs is found and starts from a baseline | M13 |
| F4 | `d6ac989` | Strict parameter reading: own, known fields only; preset and scenario names as own properties with the documented fallback; every non-finite number (filters included) falls back; lists cut to 64 before validation. | `test/params.test.js` (4 tests with hostile files) | M14, M15, M16 |
| F1 | `019a02c` | Preset file read through one handle: `O_NOFOLLOW`/`O_NONBLOCK` open, type and size checked with `fstat`, at most 1 MB + 1 byte read, any failure 404. | R8.1, R8.13: a preset file changed between check and read is not served, and never ends the server | M18 |
| F2 | `2378270` | Static mounts: every path part below the mount checked with `lstat`, links refused; the file read through the same one-handle reader. | R8.1: symbolic links in the web and synth-core directories are not followed | M20 |
| F3 | `6e9d6b9` | At most 16 statistics streams (503 beyond); a client with more than 256 KiB unsent is dropped. Internal safeguards. | R8.1: the number of open statistics streams is limited; R8.1: a statistics client that does not take its data is dropped | M21, M22 |
| F10 | `6a1c3d9` | `web/loads.js`: a load gate; every preset/file/reset choice makes loads on their way obsolete. | `test/page.test.js`: R8.14, R6.14: a load that completes after a later choice does not overwrite it | M23, M24 |
| F11 | `3cd240b` | The file-building part of the page's `runExport` moved into the core as `pageExport(what, params)`; page and test call it. | R10.4, R10.5: the page export path with non-default parameters gives the same files as the command | M6, M25 |

Mutants (each applied alone, run, restored):

- M6: `pageExport` renders `sanitizeParams({})` instead of the current parameters (the round 1 survivor, moved
  with the code): killed.
- M8: `FILTER_LIMITS.resDb` back to [0, 24]: killed.
- M9: `setSimEnabled` no longer restarts the flush countdown: killed.
- M10: light target from the current level (round 1 behaviour): killed. M11: captured level always 0: killed
  (2 tests).
- M12: `DriveModel.setParams` does not shrink the queue: killed.
- M13: disk list cached after the first sample: killed.
- M14: name lookup accepts inherited properties: killed (2 tests). M15: filter cutoff without the finite
  fallback: killed. M16: merge reads inherited fields (the round 1 `in` check): killed.
- M18: open without `O_NOFOLLOW`: killed. The F1 test also fails against the round 1 `server.js`.
- M20: path parts not checked for links: killed (the linked-folder case).
- M21: no drop of a stalled client: killed. M22: no stream cap: killed.
- M23: load result taken without the newest-choice check: killed. M24: `invalidate` does nothing: killed.
- M25: the clicks zip drops a file: killed.
- Survived, not claimed: M17 (lists deep-copied before they are cut): no observable difference, only cost.
  M19 (no size check on the handle): the bounded read still refuses a file over 1 MB, so the result is the
  same.

## Limits and notes

- F10: the test covers the load gate. That `web/app.js` calls it for every preset, file and reset choice is
  checked by reading only; there is no browser or DOM double in the tests.
- F11: the page's export path runs in Node. A run in browser engines (Firefox, Safari) needs a browser, which
  the tests cannot use without a dependency; that part of R10.5 stays with the user's browser check (task 5).
- F3: the limits (16 streams, 256 KiB unsent) are internal safeguards. Asked as a spec-change question (q1):
  "Approve spec change: R8.1 states the stream limits"; default: keep them as internal safeguards, spec
  unchanged.
- F1, F2: the user rates these as nits; the fixes are kept to a few lines, no elaborate hardening. The race
  test changes the file right after the server's `lstat`, using `syncBuiltinESMExports`.
- The F2 test creates links named `link-test-<pid>*` in `web/` and `src/dsp/` and removes them in `finally`.
- Smoke check: the server started on a spare port served `/`, `/app.js`, `/loads.js`, `/worklet.js`,
  `/dsp/export.js`, `/dsp/zip.js`, `/dsp/params.js`, `/presets/` and a statistics stream.

## Spec deviations

None. No spec text was changed. F9 follows spec 1.1, which the user approved before this ticket.
