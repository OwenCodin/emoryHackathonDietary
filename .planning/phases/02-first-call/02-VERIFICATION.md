---
phase: 02-first-call
verified: 2026-11-13T00:00:00Z
status: human_needed
score: 9/9 code-verifiable must-haves verified (CALL-01..05 real-phone parts pending human)
overrides_applied: 0
human_verification:
  - test: "CALL-01: run `npm start` and `chert dev`, FaceTime Video the line"
    expected: "The agent answers the call (call joined line in agent log)."
    why_human: "Needs a real FaceTime call on the Chert line; shared trial minutes."
  - test: "CALL-02: on that call, time the greeting after FaceTime connects"
    expected: "Greeting heard on the phone within 10 s of FaceTime being ready; nothing said before it; no greeting fired by participant join alone."
    why_human: "Needs a real phone and the Chert Mac's bridge_ready signal."
  - test: "CALL-03: hold a short two-way spoken conversation"
    expected: "Agent replies in one or two short sentences, in persona, on gemini-3.8-live; voice choice and reason recorded (spike plus simulated calls)."
    why_human: "Simulated caller sends silence; real speech needs a person."
  - test: "CALL-04: listen through a multi-turn call"
    expected: "Care-team line (follows care team's limits, does not replace them) heard once, in the greeting, not repeated later."
    why_human: "Spoken model behaviour over turns cannot be asserted from code."
  - test: "CALL-05: hang up, then FaceTime again"
    expected: "Second real call answered and greeted the same way."
    why_human: "Needs a second real call. Simulated back-to-back calls already pass."
  - test: "Roadmap criterion 5: `chert doctor` passes, `chert dev` reaches waiting-room message, and say 'can I eat a banana?' on a call or LiveKit playground"
    expected: "`[agent] tool check_food ok=true` appears in the agent log."
    why_human: "Needs Chert line / spoken input; the tool-log path is untested because the simulated caller is silent."
---

# Phase 2: First call Verification Report

**Phase Goal:** A patient can FaceTime the line, is greeted in time, and holds a spoken conversation with the dietitian persona, repeatably
**Verified:** 2026-11-13
**Status:** human_needed
**Re-verification:** No, initial verification

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| D-01 | Voice is google.realtime.RealtimeModel, default `gemini-3.8-live`, voice Puck, no OpenAI code | VERIFIED | agent.mjs has `process.env.GEMINI_LIVE_MODEL \|\| 'gemini-3.8-live'` once; `grep -il openai agent/*.mjs agent/sim/*.mjs` empty |
| D-02 | prompt.mjs exports instructions and greeting; agent.mjs imports them, defines neither | VERIFIED | prompt.mjs read: AI renal dietitian, kidney/dialysis, 1-2 sentences, tools, never invent numbers, care-team limits, never pays/orders, says AI if asked. Import at agent.mjs line 10 |
| D-03 | Greeting says AI renal dietitian, follows care team limits, does not replace, asks what food; once per call via unchanged greet.mjs | VERIFIED | greeting text read; instructions tell model not to repeat. Wired through `greetOnBridgeReady(ctx.room, ...)`, which fires once and stops |
| D-04 | sim-call.mjs flow and imports | VERIFIED | 156 lines; imports by package name and `../../shared/video.mjs`; chert-bridge-sim, facetime-remote-audio, chert_bridge_ready, updateRoomMetadata, deleteRoom present; no absolute paths (grep count 0) |
| D-05 | --seconds/--calls, pass criteria, exit codes, no npm script | VERIFIED | Arg parsing with usage, four failed-check names, watchdog, exit 0/1; package.json unchanged from 5f46925 and has no sim-call |
| D-06 | `--calls 2` passes against one agent; two of each lifecycle line | VERIFIED | Re-ran myself (2 calls): SIM_RC=0, `[sim] PASS 2/2 calls`; agent log has 2x call joined, session started, greeting requested, call ended |
| D-07 | `[agent]` lifecycle lines incl. FunctionToolsExecuted; no secrets or speech | VERIFIED (tool line untested live) | Code read: logs caller identity, model, tool name and ok only; no transcript listeners; try/catch around handler. Tool line not exercised since the sim is silent (human item) |
| D-08 | npm test passes offline; sim not in it | VERIFIED | `npm test`: 13 pass, 0 fail |
| D-10 | Protected files unchanged | VERIFIED | `git diff --quiet 5f46925 -- greet.mjs chert-rooms.mjs README.md files package.json` clean; git status clean |
| D-09 | Guard rails (<=8 calls, no chert, no leftover process) | VERIFIED (partly claimed) | My run: 2 calls, no chert, pgrep empty afterwards. Executor's own count (2 calls) is from the SUMMARY |

**Score:** 9/9 verifiable truths verified. Real-phone parts of CALL-01..05 are human items, not gaps.

## Simulated proof (re-run by verifier)

| Call | spokeBeforeReady | greeted | first sound after ready | videoSize | pass |
|------|------------------|---------|-------------------------|-----------|------|
| 1 | false | true | 1.0 s | 1280x720 | true |
| 2 | false | true | 1.2 s | 1280x720 | true |

Agent stopped with SIGTERM; `pgrep -fl '[a]gent/agent.mjs'` printed nothing.

## Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| CALL-01 | 02-01 | Needs human (code path verified) | Agent joins and logs call joined in simulated rooms; real FaceTime answer unproven |
| CALL-02 | 02-01 | Needs human (sim timing verified) | Silent before ready, first sound 1.0-1.2 s after; greeting only through greetOnBridgeReady, no join-triggered greeting |
| CALL-03 | 02-01 | Needs human | Model session starts and speaks; two-way conversation needs a real person |
| CALL-04 | 02-01 | Needs human (code verified) | Care-team line is in the greeting once; instructions forbid repeating |
| CALL-05 | 02-01 | Needs human (sim verified) | Second simulated call works after first ends on the same agent process |

No orphaned requirements: REQUIREMENTS.md maps exactly CALL-01..05 to Phase 2 and all appear in the plan.

## Anti-Patterns

None found in agent.mjs, prompt.mjs, sim-call.mjs (no TBD/FIXME/TODO markers of note, no stub returns). `.env.local` not read; no log files in the repo.

## Notes

- ROADMAP criterion 5 ("chert doctor passes", `[agent] tool check_food ok=true`) is not proven by the simulated run; kept as a human item.
- REQUIREMENTS.md and ROADMAP.md already mark CALL-01..05 and Phase 2 as complete, ahead of the real-call confirmation. Consider treating these as provisional until the human items pass.

## Gaps Summary

No gaps. Code and simulated proof match the plan. Remaining work is the real-phone confirmation listed above.

---

_Verified: 2026-11-13_
_Verifier: Claude (gsd-verifier)_
