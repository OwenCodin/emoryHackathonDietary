---
phase: 02-first-call
plan: 01
subsystem: agent
tags: [livekit, gemini-live, simulation, persona]
requires:
  - phase: 01-scaffold-and-stubs
    provides: agent.mjs, greet.mjs, shared/video.mjs, tools.mjs
provides:
  - agent/prompt.mjs (renal-dietitian instructions and once-per-call care-team greeting)
  - agent/sim/sim-call.mjs (no-phone simulated Chert caller)
  - "[agent] lifecycle log lines in agent/agent.mjs"
affects: [03-camera-and-tools]
tech-stack:
  added: []
  patterns: ["simulated caller via LiveKit room metadata chert_bridge_ready"]
key-files:
  created: [agent/prompt.mjs, agent/sim/sim-call.mjs]
  modified: [agent/agent.mjs]
key-decisions:
  - "Keep gemini-3.8-live as default; no fallback model code"
  - "Log only caller identity, model name, tool name + ok; never speech or secrets"
requirements-completed: [CALL-01, CALL-02, CALL-03, CALL-04, CALL-05]
duration: 20min
completed: 2026-11-13
---

# Phase 2 Plan 01: First call Summary

Renal-dietitian persona with a once-per-call care-team greeting, [agent] lifecycle logging, and a repo-kept simulated Chert caller that proved greeting timing, silence before the ready signal, 1280x720 video and a second call, all without a phone.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | Simulated Chert caller (agent/sim/sim-call.mjs) | 5282a43 |
| 2 | Persona, greeting, [agent] log lines (agent/prompt.mjs, agent/agent.mjs) | 032a6a7 |
| 3 | End-to-end run: one agent, two simulated calls | no file changes needed |

## Evidence (Task 3)

Simulated calls run: 2 of the allowed 8 (14 s listening each). `chert` was never run.

```
RESULT {"call":1,...,"spokeBeforeReady":false,"greeted":true,"secondsFromReadyToFirstSound":0.96,"audibleSeconds":5.2,"videoFrames":212,"videoSize":"1280x720","failed":[],"pass":true}
RESULT {"call":2,...,"spokeBeforeReady":false,"greeted":true,"secondsFromReadyToFirstSound":1.09,"audibleSeconds":5,"videoFrames":211,"videoSize":"1280x720","failed":[],"pass":true}
[sim] PASS 2/2 calls      SIM_RC=0
```

Agent log `[agent]` lines (one agent process, both calls):

```
[agent] call joined caller=chert-bridge-sim
[agent] session started model=gemini-3.8-live
[agent] greeting requested
[agent] call ended
(same four lines again for call 2)
```

- Step B: `pgrep -fl '[a]gent/agent.mjs'` printed nothing (no agent process left; clean SIGTERM, no forced kill).
- Step C: `NO_SECRETS` (our `[agent]`, `[sim` and RESULT lines contain none of the LiveKit URL, key, secret or Gemini key).
- `npm test`: 13 pass, 0 fail. greet.mjs, chert-rooms.mjs, the three track READMEs and package.json are unchanged from 5f46925.

## Deviations from Plan

None - plan executed exactly as written. Note: the sim's output also contains rtc-node native `lk-rtc` debug lines ("ignoring incoming byte stream ... lk.agent.session"); these are harmless and contain no secrets. Not tested: the `[agent] tool ... ok=` line, because simulated callers send silence and so no tool is triggered (listed below).

## Known Stubs

None.

## Human verification remaining (for the person, real phone)

- CALL-01: run `npm start` and `chert dev`, FaceTime Video the line, confirm the agent answers.
- CALL-02: the greeting is heard on the phone within 10 seconds of FaceTime connecting, with nothing said before it.
- CALL-03: a short two-way spoken conversation works on gemini-3.8-live.
- CALL-04: the care-team line is heard once, in the greeting, and not repeated in later replies.
- CALL-05: after hanging up, a second real FaceTime call is answered and greeted the same way.
- Roadmap criterion 5: saying "can I eat a banana?" on a real call (or the LiveKit playground) produces `[agent] tool check_food ok=true` in the agent log.

## Self-Check: PASSED

agent/prompt.mjs, agent/sim/sim-call.mjs exist; commits 5282a43 and 032a6a7 exist.
