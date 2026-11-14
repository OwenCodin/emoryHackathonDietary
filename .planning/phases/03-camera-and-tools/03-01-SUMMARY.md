---
phase: 03-camera-and-tools
plan: 01
subsystem: agent
tags: [livekit, camera, tools, gemini-live, simulation]
requires:
  - phase: 02-first-call
    provides: agent.mjs, prompt.mjs, sim-call.mjs
provides:
  - agent/camera.mjs (watchCaller, isFresh)
  - agent/tools.mjs (look_at_camera, check_food, spokenVerdict)
  - sim-call.mjs --image and --say
affects: [03-02-PLAN.md]
tech-stack:
  added: []
  patterns: ["guarded tool results with our own error codes", "latest-frame snapshot to JPEG on request"]
key-files:
  created: [agent/camera.mjs, agent/camera.test.mjs, agent/tools.test.mjs, agent/sim/speech.mjs, agent/sim/speech.test.mjs, agent/sim/fixtures/label.jpg]
  modified: [agent/agent.mjs, agent/tools.mjs, agent/prompt.mjs, agent/contract.test.mjs, agent/sim/sim-call.mjs, .env.example]
key-decisions:
  - "jpeg() ignores frames that arrive while the camera is muted, so an unmute never serves an old frame"
  - "Tool failures carry only our own error codes and fixed sentences, never module text"
requirements-completed: [CAM-01, CAM-02, CAM-03, TOOL-01, TOOL-02, TOOL-06, AISL-04]
duration: 45min
completed: 2026-11-13
---

# Phase 3 Plan 01: Camera and tools Summary

The agent now subscribes to the caller's video, turns the latest fresh frame into a JPEG for `look_at_camera`, speaks guarded "Yes / No / Small portion / I can't tell" verdicts from `look_at_camera` and `check_food`, and says it cannot see when there is no picture. The simulated caller can show a picture and speak, and all three paths were proven on simulated calls.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | watchCaller with freshness, mute and playground rules, wired into the call | e548963 |
| 2 | look_at_camera and check_food, spokenVerdict, updated instructions | 7f7f1af |
| 3 | Simulated caller --image/--say, label fixture, simulated proof | 536b10e |

## Simulated proof (Task 3)

Simulated calls used: 4 of the allowed 8 (each `--seconds 30`, callSeconds 27 to 34). `chert` was never run. One agent process per round, started with `AGENT_DEBUG_FRAME_DIR` set under `$TMPDIR`.

| Case | Wording | Result |
| ---- | ------- | ------ |
| (a) image + camera question | "Can I eat this? Please look at my camera." | `[agent] tool look_at_camera ok=true`, `[agent] camera video from=chert-bridge-sim`, `[agent] debug frame saved`, saved frame `FRAME 1280x720`; reply heard after 10.1 s; 162 frames sent; PASS |
| (b) no image + camera question | "Please look at my camera and tell me if I can eat this." | `[agent] tool look_at_camera ok=false`; reply heard after 8 s; PASS |
| (c) named food, first try | "Can I eat a banana?" | No tool call and no reply heard (`repliedToSay` failed, SIM_RC=1) |
| (c) named food, retry | "Is a banana okay for me to eat?" | `[agent] tool check_food ok=true`; reply after 9.8 s; PASS |

Every RESULT line had `"greeted":true`, `"spokeBeforeReady":false`, `"videoSize":"1280x720"`, callSeconds at most 45 and no `callUnder45s`. The one failed call (c, first try) failed only `repliedToSay`: the live model did not respond to that spoken question, a model/speech-recognition outcome and not a code failure. The retry used the plan's allowed second wording; no prompt change was needed.

- Step B: `pgrep -fl '[a]gent/agent.mjs'` printed nothing after each round (no forced kill).
- Step C: `NO_SECRETS` before any log line was printed; `FRAME 1280x720`.
- `npm test`: 43 pass, 0 fail, offline. greet.mjs, chert-rooms.mjs, package.json, renal/, actions/ and agent/README.md are identical to 51f88f3. No `.env.local`, log or frame files in git status (the untracked `.planning/phases/05-in-the-aisle/` is not mine).

## Simulated proof findings

None open. Verdict text on these calls is placeholder (`unknown` / "I can't tell") because renal/ is still the stub; the proof is that the paths run, not that the verdict is clinically right.

## Deviations from Plan

**1. [Rule 1 - Bug] Frames arriving while muted are dropped**
- **Found during:** Task 1
- **Issue:** clearing `latest` on mute would have let a frame that arrived during the mute be served right after unmute.
- **Fix:** the reader loop stores frames only while not muted; covered by a unit test.
- **Files modified:** agent/camera.mjs

Otherwise the plan was executed as written. Step C helper imports sharp through `createRequire` from the repo because the script lives in `$TMPDIR` (outside the repo, not committed).

## Known Stubs

`renal/index.mjs` and `actions/index.mjs` remain Phase 1 stubs by design (D-17); the unit-test and simulated verdicts are placeholders until Track B merges. `lastFoods` and `lastVerdicts` in tools.mjs are held for plan 03-02 and not yet read.

## Human verification remaining (real phone)

- On a real FaceTime Video call, a label held to the camera gets a spoken verdict starting with Yes, No or Small portion (also needs Chert caller capture to be on for the line).
- With the phone camera off, the agent says it cannot see and does not guess.
- A frame saved through `AGENT_DEBUG_FRAME_DIR` shows what the phone camera showed, and whether FaceTime controls or a self-preview appear in it.
- With `PLAYGROUND=1`, a LiveKit playground webcam produces a saved JPEG.
- Whether the live model reliably calls the tools on a real voice: on simulated (text-to-speech) callers, "Can I eat a banana?" got no reply on one of two tries.

## Self-Check: PASSED

Files exist (camera.mjs, tools.mjs, speech.mjs, label.jpg); commits e548963, 7f7f1af, 536b10e exist.
