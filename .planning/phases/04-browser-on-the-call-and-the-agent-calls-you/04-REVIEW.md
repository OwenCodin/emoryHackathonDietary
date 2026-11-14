---
phase: 04-browser-on-the-call-and-the-agent-calls-you
reviewed: 2026-11-13T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - agent/agent.mjs
  - agent/video.mjs
  - agent/face.mjs
  - agent/outbound.mjs
  - agent/prompt.mjs
  - agent/sim/fake-cart.mjs
  - agent/sim/sim-call.mjs
  - .env.example
findings:
  critical: 1
  warning: 3
  info: 1
  total: 5
status: issues_found
---

# Phase 4: Code Review Report

**Depth:** standard. `npm test` passes (123/123).

## Summary

The outbound path correctly uses one audio track: RoomIO 1.8.0 keeps a pre-set `session.output.audio` (room_io.js:376) and never starts or closes it, so the agent starts and closes it itself. No second track is published, and the greeting waits for `chert_bridge_ready`. Inbound behaviour is unchanged apart from the cached face and the real `getCartFrame`. `AGENT_FAKE_CART` is gated on exactly `'1'`. Face frames are copied with `slice()` per tick, so they are not shared or mutated. Metadata parsing never throws and the reason is sanitised. One blocker remains: the outbound job has no timeout if the bridge never joins.

## Critical Issues

### CR-01: Outbound job never ends if the bridge never joins (model session and tracks leak)

**File:** `agent/agent.mjs:28-36,142-166`
**Issue:** On the outbound path the agent opens the paid Gemini Live session, the 15 fps video timer and the audio track immediately. `closeOnDisconnect` only fires after the linked participant has joined and then left. If the patient never answers, or Chert fails to dial, nothing ends the job. The model session, timers and published tracks stay alive until the room is deleted, and the README and CONTEXT do not say that anyone deletes it. Repeated unanswered mealtime calls would stack live sessions.
**Fix:** Add a deadline that is cleared on the first bridge participant or on `chert_bridge_ready`, and that shuts the job down.
```js
const answerTimer = call ? setTimeout(() => { console.error('[agent] bridge never joined; ending'); ctx.shutdown('bridge_timeout'); }, 90_000) : null;
// clear it in the greetOnBridgeReady callback and in the shutdown callback
```
Use a value that matches Chert's ring time. The existing shutdown callback then closes everything.

## Warnings

### WR-01: Audio publish failure is swallowed, so the call can run with no audio track

**File:** `agent/agent.mjs:147`
**Issue:** `audioOut.start(...).catch(log)` only logs. If `publishTrack` rejects, the outbound call continues with zero audio tracks, because RoomIO keeps the external output and will not make its own. Chert would drop the call, and the agent would sit there and hit CR-01.
**Fix:** In the catch, call `markFailed(error)` and `ctx.shutdown('audio_publish_failed')`.

### WR-02: Malformed outbound metadata silently becomes an inbound call

**File:** `agent/agent.mjs:21`, `agent/outbound.mjs:27-32`
**Issue:** When `outbound === true` but `bridgeIdentity` fails the regex, `outboundCall` returns null. The agent then waits for any participant (`ctx.waitForParticipant()`), publishes no audio before the bridge dials, and uses the inbound greeting. Nothing is logged, so the failure looks like Chert's fault.
**Fix:** Log `[agent] outbound metadata rejected` (without the contents) when `parseJobMetadata(...).outbound === true` and `outboundCall` is null. Better, end the job.

### WR-03: Cart-frame check ignores `byteOffset` and the backing buffer

**File:** `agent/video.mjs:7`
**Issue:** rtc-node 0.13.35 `VideoFrame.dataPtr` does `new Uint8Array(this.data.buffer)` (video_frame.cjs:35) and ignores `byteOffset`. A cart frame that is exactly `WIDTH*HEIGHT*4` bytes long but is a view into a larger `ArrayBuffer`, such as a Node `Buffer` slice or `subarray`, passes the length check. The pointer then addresses the start of the backing buffer, so the picture is wrong or an out-of-range read happens.
**Fix:**
```js
cartFrame instanceof Uint8Array && cartFrame.length === expectedLength
  && cartFrame.byteOffset === 0 && cartFrame.buffer.byteLength === expectedLength
```
Otherwise copy with `cartFrame.slice()`.

## Info

### IN-01: sim-call leaves its mic track and source unclosed

**File:** `agent/sim/sim-call.mjs:164-170,289-297`
**Issue:** The `finally` block closes the camera track and source but not the `mic` track or `source` (AudioSource). They are only released by `room.disconnect()`. Rooms themselves are deleted in `finally`, and the watchdog deletes the active room, so no room is left behind.
**Fix:** Hoist `mic` and `source` and close them in `finally`.

---

_Reviewed: 2026-11-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
