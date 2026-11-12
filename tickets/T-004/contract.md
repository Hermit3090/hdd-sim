# Fix v1 round 2 (T-003)

The user chose Fix for T-003 (PASS WITH SHOULD-FIX).

## From the user

Fix the one remaining should-fix, F11 (read tickets/T-003/result.md): add a test that is kept in the suite and exercises the page's actual export handler (runExport in web/app.js) with edited, non-default parameters through to the downloaded bytes, and compares the files with the command's. Use built-in Node facilities only for the DOM and event double; no dependency. The reviewer's mutant must be killed: replace pageExport(what, params) inside runExport with pageExport(what, defaultParams()). Say so in the commit message (Fix F11: ...).

F2 (now nit): no change. The user's rule stands: a finding that needs write access to the user's own files is not hardened further. Leave the code as it is and say so in the kickoff.

Spec: docs/SPEC.md is now v1.2. The user approved q1, and R8.1 states the stream limits your F3 fix already implements (16 streams, 503 beyond; more than 256 KiB unsent is dropped). Check that the code and its tests match the R8.1 wording exactly; change no spec text. Add R8.1's stream limits to nothing else.

npm test green before the commit. Never push.

The next round: when you run agentstat review kickoff --after T-003, give it a contract file in the usual sections: Contract docs/SPEC.md v1.2 (changed: R8.1 stream limits, approved by the user 2026-11-12) and review/CONTRACT.md (unchanged); Baseline 2a1bfee; Under review pinned to your fix commit; Review type 'residual verification, round 3 — narrow'; Priority 1 — Disposition of F11 and F2 (F2: no change, the user accepts the remaining local-access limitation as a nit); Priority 2 — R8.1 as worded in spec 1.2 against the code and tests of 6e9d6b9; Priority 3 — Regressions introduced by the fix; Security (standing); Test quality (your mutant); Out of scope: everything else.

## Findings to fix

- F11 [should-fix] test/export.test.js:111 — A1, R10.5 — The parity test never executes the page, so it passes when page exports ignore the current parameters — Exercise the page export path with nondefault parameters and compare its resulting files with the CLI, including browser-engine coverage for the promised portability.
- F2 [nit] src/server/server.js:68 — R8.1, standing server confinement rule — The web and DSP mounts follow filesystem symlinks outside their permitted directories — Enforce filesystem confinement, including symlinked path components, when opening static files.

## When done

Commit the fixes, record `agentstat ticket result <this ticket> done --file tickets/<this ticket>/result.md`, then `agentstat review kickoff --after T-003` (the next round checks this fix).
