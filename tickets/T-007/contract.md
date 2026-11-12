# Review v1.1 round 1 (T-007)

## Current engagement

**Engagement:** `T-007` · phase v1.1, round 1
**Builder:** `claude` · **Reviewer:** `codex`
**Contract:** the reviewer contract (`review/CONTRACT.md`, or the reviewer section at the top of `AGENTS.md`) + this file.
**Carried findings:** mark each RESOLVED or UPHELD. To change an upheld finding's severity, write the new one right after the outcome, in the same clause: `F1 **UPHELD in part**, now should-fix` (anything else keeps its severity).
**Start:** `agentstat -a codex ticket start T-007`.
**Results file (the only file you write):** `tickets/T-007/result.md`. When it has a verdict: `agentstat review check --ticket T-007`, then `agentstat -a codex ticket result T-007 "<verdict>" --file tickets/T-007/result.md` (it refuses a file that doesn't parse), then commit that file only, by path.

### Review type

Full phase review

Delta review after the tag `v1`, before the repository is made public.

**Spec:** `docs/SPEC.md` v1.4 (1.3 and 1.4 dictated by the user on 2026-11-12), with `review/CONTRACT.md`.
**Baseline:** `f027832` (tag `v1`, CLEAN PASS in T-005, accepted by the user in T-006).
**Under review:** `f027832..000cf5a`.

### What changed
1. Spec 1.3, R9.8: the "Spin up" button pulses three times when the page opens, then stays steady; the page does not start sound by itself. Code: `web/style.css` (a CSS animation, no script), test in `test/page.test.js`.
2. Spec 1.4, R6.14: shipped presets also set the Activity source section (baseline, simulation scenario and its controls, read/write pattern); all three hold the default values. Code: `src/dsp/params.js` (`addActivitySource`, `defaultParams`), test in `test/features.test.js`, one line in `README.md`.
3. `README.md`: the R10.5 note now says exports are byte-identical in Chromium, Brave and Firefox (checked by the user).
4. The user's files in `presets/`: preset 1 re-saved by the user, preset 4 added, and two manual-mode background values added to preset 2 at the user's request.
5. Ticket records of T-005 and T-006.

### Priorities, in order
**Priority 1 — Presets and parameter files after the R6.14 change**
`defaultParams` now takes `live`, `pattern`, `scenario` and `sim` from the preset. Check that every default the spec states (R8.6–R8.9, R9.1, R9.5–R9.7) is unchanged for all three presets, that `sanitizeParams` still fills in and clamps a file that lacks these groups or names an unknown preset or scenario, that the hostile-file guarantees of round 1 (F4) still hold, and that choosing a preset in the page resets exactly what R6.14 says and nothing else (master volume, seed, export settings and the live/simulation choice stay). The builder's claim: exports are byte-identical to before the change.

**Priority 2 — R9.8, the pulse cue**
Three pulses after load, then the steady colour; no sound started by the page; no effect on the button's function, focus outline or disabled state.

**Priority 3 — The preset files**
All four files in `presets/` load through `sanitizeParams` without loss and contain no personal data. Their values are the user's and out of scope.

**Security (standing)** — re-check the server rules, the no-dependencies rule and repository hygiene from `review/CONTRACT.md` against this range. No server file changed in it; confirm that.

**Test quality** — would the R6.14 and R9.8 tests fail if the requirement were broken? Make at least two mutants in a throwaway copy: give one shipped preset a different baseline value; change the pulse count. Report each as killed or survived.

Places the builder is least sure of:
- The key order of the parameter object changed (`live`, `pattern`, `scenario`, `sim` now come from the preset). Anything that depends on key order.
- Parameters stored in the browser from before the change, loaded by the new page.
- The pulse was looked at by the user in a browser, not by the builder.

### Out of scope
- How the pulse looks and how the drive sounds: the user has judged both.
- The values in the user's preset files.
- F2 of round 1, accepted by the user as a nit, and everything else already closed in T-001 to T-006.
- The first name in the messages of commits `6bb492e` and `73e79b6` (the user's own commits; history is not rewritten) and the copyright holder's name in `LICENSE`.
- The agent-dashboard block in `CLAUDE.md` and `AGENTS.md`, `review/` and `tickets/`.
- Commits after `000cf5a`.

### Expected output
Findings into this ticket's `result.md`, as F1…, under one `## Priority N — <title>` section per priority above, then `## Security`, `## Test quality`, `## Phase verdict` and `## Notes / observations outside scope`, with `## Test run` first; phase verdict **CLEAN PASS** / **PASS WITH SHOULD-FIX** / **FAIL (blocker)**.
