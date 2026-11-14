---
phase: 05-in-the-aisle
plan: 03
subsystem: agent
tags: [shelf, best-choice, ranking, prompt]
requires:
  - phase: 05-in-the-aisle
    provides: guarded tools, shopping list, prompt rules (plans 05-01, 05-02)
provides:
  - pickBest(verdicts, limits) pure ranking in agent/tools.mjs
  - look_at_camera shelf result with best and a top-level spoken sentence
  - store and shelf rules in the instructions
affects: []
tech-stack:
  added: []
  patterns: ["pure ranking function, result fields built from fixed sentence templates"]
key-files:
  created: []
  modified: [agent/tools.mjs, agent/tools.test.mjs, agent/prompt.mjs, agent/prompt.test.mjs]
key-decisions:
  - "Shelf spoken sentence is built from fixed templates plus one cleaned sentence of at most 110 characters; best and spoken sit in build(), so every shrink step keeps them"
requirements-completed: [AISL-01]
duration: 20min
completed: 2026-11-13
---

# Phase 5 Plan 03: Best choice on a store shelf Summary

When the camera shows a shelf with two or more products, look_at_camera returns `best` (the chosen product name, or null) and one spoken sentence such as "Yes, the low sodium broth is the best choice here.", ranked by the pure `pickBest` (ok, then limit, then unknown; avoid and failed checks never chosen; ties by lowest largest share of a daily limit, then order seen).

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | pickBest, shelf result, prompt rules, with tests | a8a513d |
| 2 | Regression simulated call (no code change) | none |

## Deviations from Plan

- Plan line numbers had moved after 05-01 and 05-02; edit points were found by string. The Phase 3 review behaviour (worst-first, nothing dropped, `omitted`) is unchanged and its tests still pass.
- Tests and code were committed together in one commit (RED was confirmed in the working tree, not committed separately).
- Otherwise none.

## Simulated proof

Calls used in this plan: 1 of 2 (no retry needed). Phase total: 10 of 14 (6 + 3 + 1). Fresh `AGENT_STATE_DIR`, barge-in default (05-01 has no real blocker; the word only appears in "no BLOCKER finding"). One agent process, stopped by SIGTERM, no forced kill; `pgrep -fl '[a]gent/agent.mjs'` printed nothing. Step C printed NO_SECRETS before any line was printed. chert and Chert's HTTP API were never used.

- RESULT: `"greeted":true`, `"spokeBeforeReady":false`, `replies:[{"replied":true,"secondsToReply":10.1}]`, `callSeconds` 29.5, pass true; SIM_RC=0.
- Agent lines: `call joined`, `barge-in off`, `session started`, `greeting requested kind=inbound`, `tool check_food ok=true`, `call ended`.

Simulated cases passed: "Can I eat a banana?" regression. The live shelf path could not be run: the renal stub's describeImage always returns kind 'plate'. D-01 and D-02 are proven by offline unit tests with an injected fake renal module.

## Human verification remaining (real phone)

- In a store, or with a printed shelf photo, after Track B's describeImage is merged: pointing at a shelf gets one best-choice sentence naming the product, audible over background noise.
- Store replies stay to one sentence on a real call.

## Known Stubs

None added (the renal stub's plate-only describeImage is Track B's, unchanged).

## Checks

`npm test`: 193 pass, 0 fail, offline. D-14 files (greet.mjs, chert-rooms.mjs, package.json, renal/, actions/, agent/README.md) identical to 72d84d3. No agent process left. No *.log, *.json or .env.local in git status.

## Self-Check: PASSED

Commit a8a513d exists; pickBest and the prompt sentences are present.
