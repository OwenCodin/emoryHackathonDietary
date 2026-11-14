---
phase: 02-first-call
reviewed: 2026-11-13T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - agent/sim/sim-call.mjs
  - agent/prompt.mjs
  - agent/agent.mjs
findings:
  critical: 1
  warning: 7
  info: 1
  total: 9
status: issues_found
---

# Phase 2: Code Review Report

**Depth:** standard. Static review only; no agent or simulated call was run.

## Summary

agent.mjs logging is clean (no URL, token, key or caller words), and the shutdown loop closes each resource independently. The main defects are a sim check that cannot fail in practice, a greeting path that fails silently, and prompt gaps around invented numbers and limits.

## Critical Issues

### CR-01: `spokeBeforeReady` check is nearly vacuous, so the sim can pass when the agent greets too early

**File:** `agent/sim/sim-call.mjs:99-104`
**Issue:** The wait loop exits on the first agent audio frame (silence frames arrive as soon as the track is subscribed). `preReadyLoud` is sampled at that instant and `chert_bridge_ready` is written immediately after. The quiet window being tested is about 0 s. An agent that greets on participant join (the exact bug Chert forbids) speaks after `session.start`, which falls after the metadata write, so it is counted as `greeted` and the run passes.
**Fix:** After the first audio frame, hold a fixed quiet window (for example `await sleep(5000)`) before writing the metadata, then compute `preReadyLoud`. Make `greeted` require `firstLoudAt >= readyAt`, not `readyAt - 200`.

## Warnings

### WR-01: Greeting failure is silent

**File:** `agent/agent.mjs:78-81`
**Issue:** `greet.mjs` swallows synchronous throws from the callback, and `generateReply` can throw (the README notes it does for 3.1 models). Nothing is logged, so a call with no greeting (the Mac then hangs up after 10 s) has no trace. No `AgentSessionEventTypes.Error` listener is registered either, so model or connection errors are also invisible.
**Fix:** Wrap the callback body in try/catch with `console.error('[agent] greeting failed', error?.message)` and rethrow nothing. Add a `session.on(voice.AgentSessionEventTypes.Error, ...)` that logs only the error name and message.

### WR-02: Greeting is gated behind publish and `session.start`, with no timing visibility

**File:** `agent/agent.mjs:32,59,78`
**Issue:** The `chert_bridge_ready` listener is registered only after `publishTrack` and the awaited `session.start` (Gemini connect). If either is slow, the 10 s greeting budget is consumed with no log showing where the time went.
**Fix:** Log elapsed ms from `waitForParticipant` to "session started" and from "greeting requested" to the first `speaking` state. Consider registering the listener earlier and having it wait on a session-ready promise.

### WR-03: Resource leak if `publishTrack` or `session.start` throws

**File:** `agent/agent.mjs:32-33,51-72`
**Issue:** If `publishTrack` rejects, `track` and `source` are never closed because the shutdown callback is not yet registered. The `setInterval` timer is also created before the callback is registered, so a throw in between leaves it running.
**Fix:** Register the shutdown callback right after creating `source` and `track`, before `publishTrack`, and create the timer after.

### WR-04: Prompt can lead the model to invent numbers through `grams`

**File:** `agent/prompt.mjs:6`
**Issue:** `check_food` takes `grams` (nullable). The prompt does not say to pass `null` when the caller gives no amount, so the model may guess a portion. It also does not say what to do when the tool returns `ok:false` or verdict `unknown`, which invites the model to answer from its own knowledge.
**Fix:** Add: "If the caller gives no amount, pass null for grams; do not guess a portion. If a tool fails or returns unknown, say you could not check it and suggest asking their care team. Never give a nutrient number from your own knowledge."

### WR-05: Prompt says to "apply" care-team limits but the model has no limits

**File:** `agent/prompt.mjs:7`
**Issue:** No tool exposes the limits in this phase, so the model may state or assume limits (for example "2000 mg of sodium") that nobody gave it, or accept limits the caller states and treat them as the care team's.
**Fix:** "Only the tool results carry the caller's limits. Never state a daily limit yourself. If the caller asks to raise or lower a limit, say only their care team can change it."

### WR-06: Prompt asserts a greeting that may never have happened

**File:** `agent/prompt.mjs:10`
**Issue:** "You already told the caller in your greeting..." is false when no `chert_bridge_ready` arrives (greeting skipped by design) or the greeting failed. The care-team statement is then never made.
**Fix:** Soften: "If you have not yet said you follow the care team's limits, say it once in your first reply."

### WR-07: Watchdog and error paths can leave a room or agent behind

**File:** `agent/sim/sim-call.mjs:134`
**Issue:** The timeout calls `process.exit(1)` without deleting the room in progress, so it stays until `emptyTimeout` (60 s) and the agent may stay in it. `deleteRoom` failures in `finally` (line 130) are also swallowed silently.
**Fix:** Keep the current `roomName` in module scope and `await rooms.deleteRoom(...)` in the watchdog before exiting. Log a warning when `deleteRoom` fails.

## Info

### IN-01: Prompt does not say the camera cannot be seen yet

**File:** `agent/prompt.mjs:4-10`
**Issue:** The greeting and persona are on a video call, and there is no camera tool in this phase. The model may claim it can see the food.
**Fix:** Add "You cannot see the caller's camera yet; ask them to name the food."

---

_Reviewed: 2026-11-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
