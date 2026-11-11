# hdd-sim

## Repository rules

- Commit identity: always `Hermit3090 <273447898+Hermit3090@users.noreply.github.com>` (the GitHub noreply address), never a personal email.
- Never put personal data in this repository: API keys or other secrets, phone numbers, addresses, personal emails
  or other personal information. If the work seems to need any of it, ask the owner first.

## Builder rules

- Spec first: `docs/SPEC.md` is the contract. A behaviour change goes into the spec, with the user's approval, and
  is committed before the code. Never edit the spec to match code already written.
- No dependencies: plain JavaScript ES modules, nothing to install.
- Run `npm test` before every commit of code and before every review kickoff.
- Commit locally; never push.
- Review files: never write into or commit a `review/results-*.md` file beyond creating its empty sections, and do
  not edit `review/CONTRACT.md` while a review round is running. When asked to run the current engagement as the
  reviewer, `review/CONTRACT.md` applies in place of these rules.

<!-- agent-dashboard:begin (managed by `agentstat rules`; edits inside this block are overwritten) -->
## Progress status (agent-dashboard)
This repo reports live status to `.agent-status/` (gitignored) for the agent dashboard. Report as
`-a codex` (Antigravity: `-a antigravity`). If `agentstat` isn't available, skip this section. Other instructions in this file
take precedence over it.

Hooks, when installed, capture sessions, task lists, approval waits and stops automatically.
Use `agentstat` for the rest:
- **Plan:** the project has one task list. Its phases come from the spec and are set by the planner with the
  user: never erase or rewrite them. For multi-step work, add your steps under the task you work on, with ids
  below it: `agentstat -a codex task add --id P1.2.1 "<step>"`, `--id P1.2.2`, … (on an empty list, `task plan
  "<step>" "<step>" ...` is fine). Then `task <id> doing|done|failed|skipped`, for your own steps. `task plan`
  replaces the list: only the planner uses it, with `--replace`, when the user asks for a new plan; a
  runner-started run never does. Keep `agentstat -a codex doing "<one line, present tense>"` current.
- **Decisions:** when a question comes up during long or unattended work, run
  `agentstat -a codex ask "<question>" --default "<what you do meanwhile>"` and continue with the
  default. For a spec deviation forced by reality (platform/API/hardware), run
  `agentstat -a codex ask --spec-change "Approve spec change: <what>" --default "<what the code does now>"`.
- **Answers** arrive as injected context through the hooks. Without hooks, run
  `agentstat -a codex inbox --ack` between steps. If an answer differs from your default, adapt.
- **Stop for the human** (per the stop rules): run `agentstat -a codex state waiting "<why>"`, then
  ask in the chat. This locks the project on the pet, so use it only when you really can't continue.
  A finished turn is not a wait.
- **Handing work to another agent** (review done, fixes ready for review): run
  `agentstat -a codex handoff <agent> "<what>"`. It shows who has the ball and doesn't lock the pet.
- **Blocked:** `agentstat -a codex block "<what and why>"`, later `unblock <id>`.
  **Results:** `deliver "<title>" --path <path>` and `metric tests <n> --total <m> --label "tests passing"`.
- **End of every round:** run `agentstat -a codex recap --mark` and paste its output unchanged as
  the "Decisions & open items" section of your final summary. After each answered item, say what you
  changed because of it. List spec deviations in the commit message too.
- **Tickets** (`tickets/T-NNN/`) are handoffs between planner, builder, reviewer and the user. New ones for
  you, and results of yours, arrive as injected context or with `agentstat -a codex inbox`. To work one:
  `ticket show <id>` (for a rework or retest, read the earlier attempts it prints first), `ticket start <id>`,
  do what `contract.md` says, write `tickets/<id>/result.md`, then `ticket result <id> <verdict> --file
  tickets/<id>/result.md`. In `tickets/` write only your own result file, and commit it with your work;
  agentstat writes `record.md` files (the user's decisions) and the contracts of tickets it opens: commit
  those with your next commit (a reviewer commits only its own result file, by path). When one you created
  comes back: `ticket accept <id>`, or `ticket rework <id> --reason "..."`; answer every finding from the
  user's test with a fix ticket or a written reason. Address a role with `ticket add <kind> --role <role>`
  (`agentstat roles` lists them; a role may be the user).
- **Ask the user to test or look at something** that tests can't check (feel, timing, device behaviour,
  wording, layout) with a ticket, and list it in your reply too (the recap does) — the user answers in the
  chat or the dashboard: `ticket add test "<what>" --cases-file cases.json
  [--gate <phase>] [--blocking]`, cases as `[{"title": ..., "steps": [...], "expected": [...]}]`, or
  `ticket add check "<what>" --contract-file <file>`. Read the user's notes (`agentstat notes`) only when asked.
- **Answered in the chat:** record it so it leaves the dashboard queue, with the user's words:
  `agentstat -a codex answer <qid> "<answer>" --from-chat`, or `agentstat -a codex ticket result <id>
  <verdict> --from-chat --answer "<the user's words>"`.
- `.agent-status/` is never committed.
- **Commit your work** in git at logical points (a finished step with its checks passing), with this repo's
  commit identity and trailers, so finished work never sits only in the working tree. Commit only what your
  role allows (a reviewer: what its contract allows). **Never push:** the user pushes, or authorises a push
  when one is needed.
- **Sandbox refusals:** if a sandbox refuses a git command these rules ask for (such as staging or committing your
  work) or one of this repo's own test or build commands (its scripts, as its instructions name them), request
  approval to run that command; don't work around the refusal.

**Review engagements:** who builds and who reviews is set in `.agent-roles`, and per round in the kickoff
(`review/what-to-review.md`). When you are the reviewer there and were asked to run the current engagement,
the reviewer contract (`review/CONTRACT.md`, or the reviewer section at the top of `AGENTS.md`) governs that
run and the builder rules in this file don't apply to it. Report as the agent name the roles give you.
As the reviewer, in addition to the contract (the dashboard parses the results file):
- A finding is one line starting with its ID: `<ID> [severity: blocker | should-fix | nit] file:line — spec
  section or invariant — issue — one-line suggested fix`. The ID comes directly before `[severity: …]`, with
  no bold and no dash. IDs per round: F1… in round 1, R1… in round 2, S1… in round 3, and so on.
- A carried finding is marked **RESOLVED** or **UPHELD** (in full or in part) with evidence where you discuss
  it. Don't repeat it as a new finding line, even when its severity changes; say so in the disposition.
- Your review steps go under the phase's review task in the task list (`task add --id <its id>.1 "<step>"`,
  `.2`, …), never `task plan`: the phases are the planner's.
- Before each verdict, run `agentstat review check` and fix every problem it reports in your results file.
  If `agentstat` isn't available or fails, say so in the results file and review as normal.
- Status calls (they write only to the gitignored `.agent-status/`, so they are allowed beside a one-file
  write policy): at the start `agentstat -a <your name> state working "Reviewing <engagement>"`. At each
  verdict, before you stop: FAIL (blocker) or PASS WITH SHOULD-FIX → `handoff <builder> "<engagement>:
  <verdict> (<n> findings)"` (the builder's move; it doesn't lock the pet); CLEAN PASS → `state done
  "<engagement>: CLEAN PASS"`. Never `state waiting` for a verdict: the dashboard already shows the user the
  next step. When the checks can't run: `block "<why>"`.
<!-- agent-dashboard:end -->
