---
phase: 05-in-the-aisle
plan: 01
subsystem: agent
tags: [gemini-live, barge-in, watchdog, reliability]
requires:
  - phase: 04-browser-on-the-call-and-the-agent-calls-you
    provides: agent.mjs, tools.mjs, sim-call.mjs
provides:
  - bargeInConfig, createReplyWatchdog, callWarnMs (agent/turns.mjs)
  - onToolActivity hook in buildTools
  - barge-in off by default (AGENT_ALLOW_BARGE_IN=1 restores it), reply nudge wired into the call
affects: [05-02, 05-03]
tech-stack:
  added: []
  patterns: ["pure decision function with injected clock plus a thin timer in agent.mjs"]
key-files:
  created: [agent/turns.mjs, agent/turns.test.mjs]
  modified: [agent/agent.mjs, agent/tools.mjs, agent/tools.test.mjs, agent/prompt.mjs, .env.example]
key-decisions:
  - "Barge-in off by default through realtimeInputConfig.activityHandling NO_INTERRUPTION; only the exact string 1 turns it on"
  - "A caller turn that starts while the agent is speaking counts as answered (plan-check correction 1)"
requirements-completed: []
duration: 25min
completed: 2026-11-13
---

# Phase 5 Plan 01: Questions always get an answer Summary

Gemini is built with no-interruption activity handling by default, and a pure reply watchdog (nudge once after 6 s of silence, never while speaking or a tool runs, at most 3 per call) is wired to the session events. Six simulated "Can I eat a banana?" calls were all answered.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | Watchdog, barge-in config, warning delay, tool-activity hook, with tests | 7f904cc |
| 2 | Wire barge-in off and watchdog into agent.mjs, .env.example | b3fefc4 |
| 3 | D-18 simulated proof (no code change) | none |

## Simulated proof (D-18)

Calls: 6 of the phase's 14 (retry not needed, so 6 of this plan's 7). One agent process, six sequential calls, all `SIM_RC=0`, every RESULT `greeted:true`, `spokeBeforeReady:false`, `replies[0].replied:true`, `callSeconds` 26.6 to 29.5 (under 45).

- Answered: 6 of 6. Needed a nudge: 0 of 6. No answer at all: 0 of 6.
- secondsToReply: 9.8, 9.9, 10, 9.5, 9.7, 10.3 (median 9.85; this includes the time the simulated caller takes to say the question).
- Agent log, per call: `barge-in off`, `greeting requested kind=inbound`, `tool check_food ok=true`, `call ended`.
- SEGMENT 1 to 6: `nudges=0 nudge_failed=0 check_food_ok=1 session_errors=0` each.
- TOTAL: `barge_in_off=6 on_input_speech_started=18 aborting=0`. barge_in_off is 6, not 1, because each call runs in its own job process and logs the line once; the plan's "equals 1" meant once per call.
- Step B: `pgrep -fl '[a]gent/agent.mjs'` printed nothing, no forced kill. Step C printed NO_SECRETS before any line was printed. chert and Chert's HTTP API were never used. Logs are under `$TMPDIR`.

Gemini accepted the realtimeInputConfig at session start on every call, so no BLOCKER finding (d). The baseline fault was roughly one dropped reply in four; zero in six now is encouraging but six calls cannot prove the fault is gone, and the watchdog never fired, so it is exercised by unit tests only.

## Code-reading caveat (D-15)

NO_INTERRUPTION stops Gemini's server-side barge-in, but `AgentActivity.onInputSpeechStarted` in @livekit/agents 1.8.0 still sets user state to speaking and calls the framework's own `interrupt()` whenever the plugin emits `input_speech_started` (including on any new server-started generation). That can cancel a speech handle and a running tool, and the config cannot prevent it. The watchdog is what guarantees an answer. `on_input_speech_started=18` over six calls (three per call) shows the event still fires, yet no generation was aborted in these runs.

## Deviations from Plan

- `replyNudge` was added to agent/prompt.mjs in the Task 1 commit instead of Task 2, because turns.test.mjs imports it; no other change.
- In tools.mjs the original function was renamed `guardTool` and a local `guard` inside buildTools wraps it with the hook, so the eight call sites are unchanged.
- Plan-check correction 1 applied: a turn starting while the agent is speaking is marked answered; unit test added.
- None of Rules 1 to 4 otherwise.

## Human verification remaining (real phone)

- On a real FaceTime call, a question asked while the agent is still talking does not cut its reply off.
- A question that would earlier have gone unanswered gets an answer within about 10 seconds (directly or after the 6 s nudge). The nudge itself has not been seen on a call.

## Known Stubs

None added.

## Checks

`npm test`: 152 pass, 0 fail, offline. No agent process left. D-14 files identical to 72d84d3. `git status` clean (no .env.local, no logs). Requirements AISL-01 to AISL-03 not marked complete; plans 05-02 and 05-03 deliver them.

## Self-Check: PASSED

Commits 7f904cc and b3fefc4 exist; agent/turns.mjs and agent/turns.test.mjs are present.
