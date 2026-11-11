# Reviewer contract — hdd-sim

This contract applies when you were told to **run the current engagement** in `review/what-to-review.md`. In that run you are the independent reviewer. The reviewer is set in `.agent-roles` (currently `codex`). You did NOT build this and must not modify it. Builder rules in `AGENTS.md` and `CLAUDE.md` don't apply to this run; read them only as context for what the builder was told. The one exception is the **Review engagements** part of the agent-dashboard block at the end of your instruction file (`AGENTS.md` for codex, `CLAUDE.md` for claude): its finding format, `agentstat review check` and status calls apply to you.

## Authority chain

- `docs/SPEC.md`, at the commit named in the kickoff's Contract line, is the contract. Requirements have IDs (R4.4, R8.13, A1, …); cite them.
- `README.md` describes use; where it disagrees with the spec, the spec wins and the disagreement is a finding.
- Commit messages and builder summaries are claims, not evidence. Check them against the repo and your own runs.
- The files in `presets/` are the user's own saved parameter files. They are data, not a contract, and need not match the built-in presets.

## Write policy

You may write to exactly ONE path: the results file named under "Current engagement" in `review/what-to-review.md`. Commit only that file. Append into its pre-made sections; never rewrite earlier sections. Every other file in `review/` is a prior, closed engagement (read-only; those verdicts stand). Do not create or modify any other file in the repo; the gitignored `out/` folder written by the export command is fine. Do not install packages: the project has no dependencies and must stay that way.

## Commit the results

After the verdict is written and `agentstat review check` is clean, run `git add <results file>` and `git commit` only: never `-a`, never amend, never push. If `git status --short` shows any other modified or staged tracked file, do not commit; say so and stop. Commit identity is the repo's (`Hermit3090 <273447898+Hermit3090@users.noreply.github.com>`; see `AGENTS.md`). Message:

    Review <phase> round <N>: <VERDICT> [spec <short sha from the Contract line>]

    Engagement: <slug>
    Contract: <the kickoff's Contract line>
    Reviewed: <baseline>..<short sha of the last commit you reviewed>
    Findings: <b> blocker, <s> should-fix, <n> nit. New: <IDs>. Upheld: <IDs>. Resolved: <IDs>.
    Checks: <what ran, with counts>

    Agent: codex
    Co-Authored-By: <your exact model>      (omit if unknown)

If the sandbox refuses to write `.git`, ask the user to approve it; if it still can't be done, leave the file uncommitted and say so in your last message.

## Dashboard status calls

Besides the results file, you may run `agentstat -a <your name> ...` exactly as the block's **Review engagements** part says (status at the start, `review check` before each verdict, handoff or done at the verdict, never `state waiting`, `block` when checks can't run). It writes only to the gitignored `.agent-status/`. If the CLI is missing or fails, ignore it and review as normal.

## Scope and phasing

Scope and phases come from the kickoff. After writing each directed phase's findings and verdict, STOP and wait for the user.

## Findings format

The line format, the IDs per round and the carried-finding rule are in the block's **Review engagements** part; here the reference field is the SPEC requirement ID or section. Include a reproduction. For test findings, include a mutation check showing whether the test catches the bug. End each phase with a bold verdict under `## Phase verdict`: **CLEAN PASS**, **PASS WITH SHOULD-FIX** or **FAIL (blocker)**.

Severity calibration:

- **blocker:** breaks a numbered requirement in a way a user would meet in ordinary use; any violation of the server rules below; personal data or a secret in the repo; a claim of a test or check that didn't happen.
- **should-fix:** an in-scope defect that doesn't do any of the above, including a requirement that A1 lists as tested but no test would catch.
- **nit:** style or clarity.

The program runs on the user's own machine for the user alone. An issue that needs the user to edit the code or run a hostile program locally is a nit, unless it can also arise from opening a web page in the same browser, from another machine on the network, or from loading a parameter file someone else made.

## Standing checks (every engagement)

- **Server rules (SPEC R8.1, R8.12–R8.14):** the server listens on 127.0.0.1 only, answers only GET and HEAD, refuses requests addressed to another host name, serves only the page, the synth core and the preset folder, never writes anything, and serves from the preset folder only regular files directly in it with allowed names and sizes (no links, no sub-folders, no path that leaves the folder). Re-check these against the diff under review. Any violation is a blocker.
- **No dependencies:** `package.json` has no dependencies and no install step; the synth core in `src/dsp/` uses no browser or Node API (SPEC section 4).
- **Repository hygiene:** new commits' author and committer are the noreply identity, with an `Agent:` trailer. No personal data or secrets in the diff or in commit messages. No audio taken from recordings: every sample the project ships or exports is synthesized.

## Tests

Run `npm test` from the repo root (`node --test`, Node 20 or newer, no install step). The server tests listen on 127.0.0.1 on ports chosen by the system and create temporary folders with symbolic links in the system temp dir. If your sandbox refuses local sockets or those writes, ask the user to approve running the check with escalation; don't stop just because the sandbox refused. Record the Node version, counts and failures in "Test run". If it still can't run, say so in "Test run", use `block`, and stop: a review without a green run is not valid.

How the result sounds, and whether it is realistic (SPEC A3), is judged by the user by ear and is never inferred from tests.

## Probing

Allowed only against throwaway copies you create in the system temp dir (for example `git worktree add /tmp/<name> <sha>`), with a server you start there on a free port of 127.0.0.1 and a temporary preset folder. Never point anything at the repo working tree, a server the user is running, or the user's files. Anything found by probing goes into the results file as a finding with a reproduction. Do not add test files; propose missing tests as findings.
