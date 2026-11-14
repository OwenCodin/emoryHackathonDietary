---
phase: 04-browser-on-the-call-and-the-agent-calls-you
plan: 02
subsystem: agent
tags: [outbound, livekit, greeting, simulation]
requires:
  - phase: 04-browser-on-the-call-and-the-agent-calls-you
    provides: plan 04-01 agent.mjs and sim-call.mjs
provides:
  - outbound entry path (no waiting, one audio track published before the bridge joins, silent until chert_bridge_ready)
  - checkinGreeting mealtime check-in
  - sim-call --outbound
affects: [phase-05]
tech-stack:
  added: []
  patterns: ["strict job-metadata validation", "external ParticipantAudioOutput set before session.start"]
key-files:
  created: [agent/outbound.mjs, agent/outbound.test.mjs]
  modified: [agent/agent.mjs, agent/prompt.mjs, agent/sim/sim-call.mjs]
key-decisions:
  - "Outbound only when outbound === true and bridgeIdentity matches ^chert-bridge-[A-Za-z0-9_-]{1,100}$; everything else is inbound"
  - "Outbound audio uses an external voice.ParticipantAudioOutput set as session.output.audio, because RoomIO 1.8.0 publishes its own audio only after the linked participant joins"
requirements-completed: [OUT-01, OUT-02]
duration: 20min
completed: 2026-11-13
---

# Phase 4 Plan 02: The agent calls you Summary

A job with valid outbound metadata makes the agent publish video and its single audio track at once, stay silent, and open with a mealtime check-in on chert_bridge_ready; any other job takes the unchanged inbound path.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | Metadata helpers with tests, `sim-call --outbound` | 644981c |
| 2 | Outbound entry path, `checkinGreeting` | 6c43436 |
| 3 | Simulated proof (no code change) | none |

## Simulated proof

Simulated calls used in this plan: 2 of 6 (one outbound, one inbound, one agent process). Phase total including 04-01 (1 call): 3 of 10. Both passed first time; no fallback was needed.

- (b) `sim --outbound --seconds 14`, SIM_RC=0: `RESULT {"call":1,...,"spokeBeforeReady":false,"greeted":true,"secondsFromReadyToFirstSound":0.71,...,"videoSize":"1280x720","callSeconds":23.2,"agentPublishedBeforeBridge":true,"secondsToAgentPublished":4.99,"agentAudioTracksAtEnd":1,"failed":[],"pass":true}`. Agent log: `[agent] outbound call reason=dinner_checkin`, `[agent] greeting requested kind=checkin waited_ms=0`, no `call joined caller=`.
- (c) plain `sim --seconds 14`, SIM_RC=0: `"greeted":true,"spokeBeforeReady":false,"callSeconds":18.9`. Agent log: `[agent] call joined caller=chert-bridge-sim`, `[agent] greeting requested kind=inbound waited_ms=0`.
- No `fake cart provider on`, no `audio publish failed`. Step B: `pgrep -fl '[a]gent/agent.mjs'` printed nothing, no forced kill. Step C printed `NO_SECRETS` before any line was printed. chert and Chert's HTTP API were never used; logs are under `$TMPDIR`.

## Deviations from Plan

- Shutdown steps: per the plan-check corrections, `['audioAbort', ...]` and `['audioOut', ...]` were inserted into the existing `steps` array after `session`, with no extra try/catch (withTimeout isolates failures).
- `callUnder45s` is added once, for `SCRIPTED`, `--expect-cart-switch` or `--outbound`. Watchdog gets +20 s per call when outbound, applied where d435e31 left it.
- Task 1 committed together with its tests rather than as a separate failing-test commit (the end-to-end check cannot run live before Task 2).
- Step A ran from a scratch script under the session scratchpad (not committed).
- `RoomIO` behaviour checked in node_modules: a pre-set `session.output.audio` is kept and no second track is created, confirmed by `agentAudioTracksAtEnd: 1`.

## Human verification remaining (real phone)

- A real outbound call placed by Track C's `callPatient` is answered with the mealtime check-in (also depends on Track C's module and on Chert allowing outbound calls on the trial line).
- During that call the agent's picture is visible and there is exactly one agent audio publisher (Chert ends the call otherwise).

## Known Stubs

None added. `actions/` and `renal/` stubs unchanged by design.

## Checks

`npm test`: 123 pass, 0 fail, offline. No agent process left. D-15 files identical to 70b8a21; `git status` clean apart from planning files.

## Self-Check: PASSED

Commits 644981c and 6c43436 exist; agent/outbound.mjs and agent/outbound.test.mjs are present.
