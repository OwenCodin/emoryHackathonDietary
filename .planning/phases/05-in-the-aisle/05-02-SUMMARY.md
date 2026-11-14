---
phase: 05-in-the-aisle
plan: 02
subsystem: agent
tags: [shopping-list, memory, resume-greeting, time-warning]
requires:
  - phase: 05-in-the-aisle
    provides: callWarnMs, onToolActivity hook, replyNudge (plan 05-01)
provides:
  - agent/memory.mjs per-patient shopping list file store
  - add_to_shopping_list, shopping_list, mark_item tools
  - resumeGreeting, chooseGreeting, timeWarning (agent/prompt.mjs)
  - sim-call speech segments and --expect-speech-after
affects: [05-03]
tech-stack:
  added: []
  patterns: ["file-backed store with injected clock, serialised writes, atomic rename", "deadline armed with the greeting, cleared on shutdown"]
key-files:
  created: [agent/memory.mjs, agent/memory.test.mjs, agent/prompt.test.mjs]
  modified: [agent/tools.mjs, agent/tools.test.mjs, agent/prompt.mjs, agent/agent.mjs, agent/sim/sim-call.mjs, .env.example]
key-decisions:
  - "State folder checked once per store: refused when inside the repo, a symlink, not a directory, or owned by someone else; otherwise tightened to mode 700 (plan-check correction 2)"
  - "Resume greeting carries a count only, never an item name"
requirements-completed: [AISL-02, AISL-03]
duration: 40min
completed: 2026-11-13
---

# Phase 5 Plan 02: Shopping list that survives a call back, and a time warning Summary

A per-patient JSON shopping list (mode 600, 2 hour expiry, outside the repo) managed by three tools, a "I remember your list, N items left" greeting on a call back, and a one-shot spoken warning about four minutes in.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | Memory store and three list tools, with tests | d8e4fb4 |
| 2 | Resume greeting, time warning, sim speech timeline, .env.example | 76cf868 |
| 3 | D-11 and D-12 simulated proof (no code change) | none |

## Simulated proof

Calls used in this plan: 3 of 5 (no retries). Phase total so far: 9 (6 in 05-01 plus 3). One agent process at a time, all stopped; Step B printed nothing for `pgrep -fl '[a]gent/agent.mjs'` after each run, no forced kill. Step C printed NO_SECRETS before any line was printed. chert and Chert's HTTP API were never used. Barge-in default (BARGE empty), since 05-01 had no BLOCKER. Logs and state folders are under `$TMPDIR` (prefix phase05-02-).

All cases passed:

- D-11 call 1 (add): SIM_RC=0, replied true (6.7 s). Agent: `greeting requested kind=inbound`, `tool add_to_shopping_list ok=true`.
  `STATE exists=true mode=600 keys=approved,needed,rejected,updatedAt needed_broth=true needed_rice=true needed_count=2`
- D-11 call 2 (list): SIM_RC=0, replied true (7 s). Agent: `greeting requested kind=resume waited_ms=1`, `tool shopping_list ok=true`.
- D-12 (warning, AGENT_CALL_WARN_SECONDS=10): SIM_RC=0, greeted true, `speech: [[1,8.3],[10.7,15]]`, `spokeAfterMark: true`, callSeconds 32.6 (the run is not scripted, so the 45 s check applies only through --expect-speech-after, which passed). Agent: `time warning requested`, no `time warning failed`.
- No `shopping list memory unavailable` or `state folder refused` in any run.

## Deviations from Plan

- Plan-check correction 2 applied: store refuses a symlink, non-directory or foreign-owned folder (logs `[agent] state folder refused` once) and tightens a group- or world-writable folder to 700; unit tested (`tightens a group or world writable folder to 700`). The check applies to every state folder, not only the temp default.
- Task 1 and 2 were committed once each with tests alongside the code, not as separate RED and GREEN commits (the plan's tasks are not `type: tdd`).
- The existing test title 'has the eight tools, anonymous' was left unchanged so only the plan-named line differs; the list now has eleven names.
- sim-call: callUnder45s is also checked in `--expect-speech-after` mode, as the plan said; the unscripted proof call lasted 32.6 s.
- 05-01 had already added the tool-activity hook and `replyNudge`; edit points were located by string, not line number.

## Human verification remaining (real phone)

- Hang up after adding items, call back within two hours: the agent says it remembers the list and how many items are left.
- At about four minutes into a real call the warning is heard before the trial's five-minute cut-off.
- Wording of the warning and the resume greeting on a real line is Claude's discretion and unheard by a person.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model (state file path, mode and expiry covered by tests).

## Checks

`npm test`: 179 pass, 0 fail, offline, writes only under temp directories. D-14 files (greet.mjs, chert-rooms.mjs, package.json, renal/, actions/, agent/README.md) identical to 72d84d3. No agent process left running. `git status` clean of *.json, *.log, .env.local.

## Self-Check: PASSED

Commits d8e4fb4 and 76cf868 exist; agent/memory.mjs, agent/memory.test.mjs and agent/prompt.test.mjs are present.
