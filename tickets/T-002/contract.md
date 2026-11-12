# Fix v1 round 1 (T-001)

The user chose Fix for T-001 (FAIL (blocker)).

## From the user

Fix all eleven findings of T-001 (read tickets/T-001/result.md for each reproduction). The user's decisions and the planner's notes:

Decisions by the user (2026-11-12):
- F9: settled by a spec change, already committed (docs/SPEC.md v1.1): R6.5 limits the click before the filters, and the resonance range of R6.15 is 0–12 dB. Change FILTER_LIMITS, the page's control range and the tests to 12 dB. Do not add anything that shortens filter ringing.
- F1 and F2: the user rates these as nits (they need write access to the user's own files; review/CONTRACT.md now says so). Fix them anyway, in the simplest way, a few lines each: a file that disappears or fails while being read must never end the server process; read a preset file through one open handle (check type and size on the handle, never send more than the limit); refuse symbolic links in the web and synth-core mounts. No elaborate hardening.
- What matters most to the user: nothing from outside may get code onto the machine or run in the page through hdd-sim. Parameter files are shared between users. So for F4 make the reading of a parameter file strict: only own, known fields are used, preset and scenario names are looked up as own properties with the documented fallback, every number (the filter fields included) falls back when it is not finite, and a hostile file can at worst load defaults. Add tests with hostile files.

Planner's notes:
- F3: add simple limits as internal safeguards (a cap on open statistics streams, and dropping a client whose unsent data passes a bound). Choose the numbers; then ask the user whether they belong in the spec: `agentstat -a claude ask --spec-change "Approve spec change: R8.1 states the stream limits (<numbers>)" --default "keep them as internal safeguards, spec unchanged"`.
- F5, F6, F7, F8, F10: fix as the findings describe. F7 and F8 are plain deviations from R8.9 and R9.7.
- F11: test the page's export path without a browser and without adding a dependency (for example by moving the part of `runExport` that builds the files into a module the test can import, so the page and the test call the same function). Mutant M6 must then be killed.
- Spec first: change no spec text. If a fix seems to need a spec change, ask with `--spec-change` and build the default.
- One commit per finding, `Fix F<n>: …`, each with a regression test, and the commit message says which mutant the test kills. `npm test` green before every commit. No dependencies. Never push.
- Do not touch tickets/T-001/result.md: it is the reviewer's file, still uncommitted, and the reviewer commits it at the start of the next round.

The next round: when you run `agentstat review kickoff --after T-001`, give it a contract file with, in the kickoff's usual sections: Contract `docs/SPEC.md` v1.1 (changed: R6.5, R6.15) and `review/CONTRACT.md` (changed since round 1: severity of findings that need local file access, committing beside agentstat-written files, probing authorisation); Baseline `2342fb8`; Under review pinned to your last fix commit; What changed, one line per finding with its commit; Review type "residual verification, round 2 — narrow"; Priority 1 — Disposition of F1–F11 (state your claim per finding; say that F9 is answered by spec v1.1 and that the user rates F1 and F2 as nits); Priority 2 — Regressions introduced by the fixes; Security (standing); Test quality (the mutants from your commit messages, M6 included); Out of scope (everything not touched by the fixes, sound realism, the user's preset files). Add as the first line of Expected output: "First commit your uncommitted round 1 result, tickets/T-001/result.md, unchanged and by path, with the round 1 message."

## Findings to fix

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

## When done

Commit the fixes, record `agentstat ticket result <this ticket> done --file tickets/<this ticket>/result.md`, then `agentstat review kickoff --after T-001` (the next round checks this fix).
