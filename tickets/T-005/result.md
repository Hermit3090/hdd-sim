## Test run

Engagement: T-005, v1 round 3, narrow residual verification. Contract: `docs/SPEC.md` v1.2 and `review/CONTRACT.md`, as named in `tickets/T-005/contract.md`. Reviewed: `2a1bfee..4ee99b5`; subsequent result/kickoff commits are excluded.

- Node **v22.23.4**, Linux. Baseline `npm test`: **85 passed, 0 failed, 0 skipped**, 2.286 s. The initial sandboxed attempt failed in the export, page-export and server test subprocesses; the required retry with approved escalation passed.
- Archived `4ee99b5` into `.review-tmp/T-005/copy`. Tests ran from that copy's root using `npm test --prefix`; mutation runs used `npm test` with that root as their working directory. `TMPDIR` pointed inside `.review-tmp/T-005/tmp`, keeping fixtures and exports inside this repo. No installation or other-repository change.
- Seven isolated mutants, each checked with the full production suite: **seven killed**, each with 84 passes and one assertion failure. Restored final suite: **85 passed, 0 failed, 0 skipped**, 2.220 s. Restored `src`, `web` and `test` trees matched the working tree, which matched the reviewed revision.
- Independent deterministic probes exercised the exact stream admission/backpressure boundaries and reproduced F2's intermediate-directory replacement race. These invoked the real server request handler with request/response doubles; the production server tests separately exercised real loopback sockets.

## Priority 1 — Disposition of F11 and F2

F11 **RESOLVED** — `test/page-export.test.js:256`, `web/app.js:498`, R10.4/R10.5/A1. The new retained test imports the actual page module unchanged, loads a nondefault parameter file through its file-input handler, edits its controls, and fires all seven export buttons taken from the HTML. Independently constructed expected parameters go through `cli/render.js`; the test compares downloaded bytes, ZIP member names/content, download names and MIME types. It exercises seed, sample rate, click count, mix gains, separate write sound, resonator and low-pass controls. The original M6-page substitution, `pageExport(what, defaultParams())` inside `runExport`, now fails the retained test on the click-set names. Additional independent mutations of seed/rate/filter binding and download payload also fail this test. This closes the remaining automated page-binding gap. Actual browser engines and download delivery remain with the existing owner browser check (task 5), as this engagement explicitly permits; Node equality is not browser portability evidence.

F2 **UPHELD in part**, now nit — `src/server/server.js:83–93`, R8.1/standing confinement rule. No runtime change was made, and the known intermediate-directory race remains reproducible. In the disposable copy, create `web/review-race/probe.json` and an outside-of-mount `outside/probe.json` containing `OUTSIDE_SENTINEL`. Wrap `fs.lstatSync` so that after obtaining the real stat for `web/review-race`, it renames the directory and replaces it with a symlink to `outside` before returning that original stat; call `syncBuiltinESMExports()`. A GET for `/review-race/probe.json` returns **200 and `OUTSIDE_SENTINEL`**. The leaf is a regular file, so its `O_NOFOLLOW` open does not stop this intermediate-component substitution. Stationary links remain covered by passing production tests. This requires write access to the served tree and remains the owner's accepted nit; no additional hardening is requested under the engagement's explicit decision.

## Priority 2 — R8.1 in spec 1.2

The code and tests match the approved numbers and comparison. Relative to `6e9d6b9`, server code differs only in the explanatory comment.

- `STATS_MAX_STREAMS` is 16. With 16 active GET streams, another receives 503. Closing one frees admission; HEAD does not consume a stream. The production test verifies admission, refusal, continued page service and slot recovery.
- `STATS_MAX_UNSENT_BYTES` is 262144. At each sampling tick the server destroys a response when `writableLength > 262144`, before writing another frame. The independent probe allowed 262143 and exactly 262144 bytes, then confirmed destruction without another write at 262145. Sampling stopped when no clients remained. The production socket test confirms a stalled client is dropped and accumulation stays bounded.
- As in the previous review, the check occurs before the next frame: one frame can cross the threshold before the following tick closes the stream. This is not a hard maximum on every instantaneous queue length; no new runtime behavior was introduced by the spec/comment change.
- The two new assertions independently pin 16 and 256 KiB. Mutating either constant now fails its corresponding test, rather than silently changing the test's own expectation.

## Priority 3 — Regressions introduced by the fix

No in-scope regression demonstrated. The new test uses only Node built-ins. Its global browser doubles, URL hooks and module resolver are confined to its test-file process under the declared `node --test` command. Its long timers are unreferenced, its render timeout completes before each comparison, and its temporary export folder is removed in `finally`. Baseline and restored suites exit normally in about 2.2–2.3 seconds, without the ten-second URL-release timers delaying exit. The doubles do not emulate browser layout or enforce the existence of every static HTML ID; this is handler regression coverage with the explicitly deferred browser check, not an end-to-end browser test.

## Security (standing)

No new violation found in the reviewed diff. The server's executable logic is unchanged: loopback binding, GET/HEAD restriction, host validation, static mounts, read-only preset routes and bounded regular-file reads remain in place. Their existing production tests pass; the independent handler probe also confirms 405 for POST and 403 for a foreign Host. F2's accepted local-write limitation is preserved above.

`package.json` still declares no dependencies or installation step. The new test imports only Node built-ins and repository modules; the platform-independent synth core is unchanged. Inspection of all three commits in the reviewed range confirms the prescribed noreply author/committer identity and `Agent:` trailers. No new secret, personal data, recording, external download or runtime dependency was found in the diff or commit messages. `git diff --check` passes.

## Test quality

Each mutation below was applied alone in the disposable copy, tested with the full suite, then restored. Each failed by assertion in its intended test, not by an infrastructure error.

| Mutation | Result |
| --- | --- |
| M6-page: `runExport` passes `defaultParams()` | **KILLED**: downloaded click-set names differ |
| Seed handler no longer stores the new seed | **KILLED**: click bytes differ |
| Export-rate handler no longer stores the selected rate | **KILLED**: click bytes differ |
| Filter cutoff handler no longer stores the edited cutoff | **KILLED**: click bytes differ |
| Download uses `result.files[0].data` instead of `result.data` | **KILLED**: ZIP-member expectations fail |
| Stream cap changes from 16 to 17 | **KILLED**: explicit numeric assertion |
| Unsent threshold changes from 256 to 512 KiB | **KILLED**: explicit numeric assertion |

## Phase verdict

**CLEAN PASS**

**0 blocker, 0 should-fix, 1 nit.** New: none. Upheld in part: F2 (nit). Resolved: F11.

The remaining automated-test gap is closed and the approved stream limits are verified. The accepted local directory-replacement limitation remains the only carried spec deviation. No spec or implementation edits were made by this review. Listening realism (A3), actual browser downloads/layout and cross-engine parity remain with the existing owner check, task 5. No new decision or duplicate owner-test ticket is needed. Disposable probe files are removed after recording this evidence; no worktree was registered.
