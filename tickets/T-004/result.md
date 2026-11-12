# T-004 — Fix v1 round 2 findings: result

**Verdict: done.** F11 is fixed in `4ee99b5` with a retained test that runs the page's actual export handler.
F2 (nit) is unchanged, by the user's rule. Spec 1.2's R8.1 matches the code; the server tests now pin its two
numbers. `npm test`: 85 passed, 0 failed (84 before). No dependencies, no spec text changed, nothing pushed.
`tickets/T-003/result.md` was not touched.

## Fixes

| Finding | Commit | Fix | Test | Mutants killed |
| --- | --- | --- | --- | --- |
| F11 | `4ee99b5` | New `test/page-export.test.js`. It loads `web/app.js` unchanged in Node. A module resolve hook maps the page's `/dsp/…` and `/…` imports the way the server mounts them. A stand-in for the document, storage, timers, `EventSource` and the Blob URL download uses only Node's own facilities. The test loads a non-default parameter file through "Load parameters…", then edits more settings through the page's controls: seed, export rate, click variants, head volume (range input), master volume, separate write sound, write pitch, a resonator, and a separate head low-pass (on and cutoff). It then clicks all seven export buttons (taken from `web/index.html`) and compares each downloaded file byte for byte with the files of `cli/render.js` for the same parameters, which the test writes without going through the page. ZIP entries are compared one by one, and names and MIME types are checked. | R10.4, R10.5, A1: the page export buttons download the files of the command for edited parameters | M6-page and M26–M29 |

Mutants (each applied alone to `web/app.js`, the test run, then `git checkout` to restore):

- M6-page (the reviewer's): `pageExport(what, defaultParams())` inside `runExport`. **Killed**: the click set
  differs (16 default clicks with no write set, where 3 read and 3 write clicks were expected).
- M26: the seed control doesn't store its value. **Killed**.
- M27: the download takes `result.files[0].data` instead of the result's bytes. **Killed**.
- M28: the export rate control doesn't store its value. **Killed**.
- M29: a filter cutoff edit doesn't store its value. **Killed**.

## F2 (nit)

No change. Under the user's rule, a finding that needs write access to the user's own files isn't hardened
further. The directory-replacement race that T-003 describes is still there and is accepted as a nit.

## Spec 1.2, R8.1 (stream limits)

The code matches the wording:

- `STATS_MAX_STREAMS = 16`: a GET to `/stats` with 16 already open gets 503.
- `writableLength > 256 * 1024`: the stream is destroyed before the next frame. That is "more than 256 KiB of
  unsent data … is closed".

The two server tests read the constants, so before this fix they would have passed even if the numbers changed.
They now assert 16 and 256 KiB. The constants' comment cites R8.1 instead of "internal safeguards". The limits
were added nowhere else.

## Not covered

This is not a browser run. Layout, real Blob download delivery and other browser engines stay with the user's
browser check (task 5), as the round 2 kickoff allowed.

## Deviations from the spec

None.
