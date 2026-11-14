# Phase 4: Browser on the call and the agent calls you - Context

**Gathered:** 2026-11-14
**Status:** Ready for planning
**Source:** PRD Express Path (agent/README.md — "Video out", "Outbound calls (twist 3)", shared contract)

<domain>
## Phase Boundary

Two things on Track A's side of the contract. First, the agent's video track shows Track C's shopping browser while a cart is running and the agent's own picture otherwise. Second, when Track C's `callPatient` dispatches the agent into a room it prepared for an outbound call, the agent joins and publishes at once, stays silent until FaceTime is ready, and opens with a mealtime check-in. Both are proven without a phone and without Track C's real module, using unit tests and the simulated caller.

Not in this phase: the browser itself, frame capture, `callPatient` and `sendText` (Track C); shelf comparison, cross-call memory and the four-minute warning (Phase 5).

</domain>

<decisions>
## Implementation Decisions

### Video out
- D-01: In `agent/agent.mjs`, each tick of the frame timer calls `getCartFrame()` from `../actions/index.mjs`. If it returns a `Uint8Array` of exactly `WIDTH * HEIGHT * 4` bytes, that buffer is captured as the frame; otherwise the agent's own picture is captured. The video source keeps using `WIDTH`, `HEIGHT`, `FPS` from `shared/video.mjs`.
- D-02: The choice is a small pure exported function (for example `pickFrame(cartFrame, drawOwnPicture, expectedLength)` in a new `agent/video.mjs`) that never throws: `null`, `undefined`, a non-`Uint8Array`, or a wrong-length buffer all fall back to the agent's own picture. It is unit tested offline.
- D-03: A wrong-length cart frame is logged once per call as `[agent] cart frame ignored: wrong size`, not on every tick. A `getCartFrame()` that throws is caught, logged once as `[agent] cart frame failed`, and treated as no frame. Switching to the browser logs `[agent] video: cart` once and switching back logs `[agent] video: face` once.
- D-04: The agent's own picture must not cost a full per-pixel JavaScript loop on every tick at 1280x720. Pre-render a small set of frames (for example mouth closed, two or three mouth-open states, a blink) once per call and reuse them, keeping some visible motion so a frozen picture is easy to spot. `agent/face.mjs` keeps exporting `drawFace(tick, speaking)` returning `WIDTH * HEIGHT * 4` bytes so the existing test still passes.

### Proving the switch without Track C
- D-05: Do not edit `actions/index.mjs` (Track C's stub returns `null`). For the proof, when `process.env.AGENT_FAKE_CART === '1'` the agent uses a built-in fake frame provider from a new `agent/sim/fake-cart.mjs` instead of the real `getCartFrame`: it returns `null` for the first 6 seconds after the session starts, a solid magenta `WIDTH * HEIGHT * 4` RGBA buffer for the next 6 seconds, then `null` again. Add `AGENT_FAKE_CART` to `.env.example` as an optional, empty variable with a comment that it is for the simulated proof only.
- D-06: Extend `agent/sim/sim-call.mjs` with `--expect-cart-switch`: while listening, sample the centre pixel of the agent's video frames about twice a second and record a timeline of `face` or `cart` (magenta); the call passes this check only if the timeline goes face, then cart, then face. The check is added to the existing exit-code logic only when the option is given.

### Outbound entry path
- D-07: At the start of `entry`, parse `ctx.job.metadata` with a helper that never throws (invalid JSON or a missing value gives `{}`). The call is treated as outbound only if `outbound === true` and `bridgeIdentity` is a string starting with `chert-bridge-`; anything else follows the inbound path unchanged. The helper is exported and unit tested.
- D-08: On the outbound path the agent does not call `ctx.waitForParticipant()`. It connects, publishes its video track, starts the session immediately with `participantIdentity` set to `bridgeIdentity` so its one audio track is published before the bridge joins, and says nothing until the room metadata contains `chert_bridge_ready`. The greeting trigger is still `greet.mjs`, unchanged.
- D-09: Add `checkinGreeting` to `agent/prompt.mjs`: in one or two short sentences the agent says it is the caller's AI renal dietitian checking in at mealtime, that it follows the limits set by their care team, and asks them to show their plate. The outbound path uses `checkinGreeting`; the inbound path keeps `greeting`.
- D-10: The outbound path logs `[agent] outbound call reason=<reason>` where `<reason>` is the metadata `reason` reduced to lowercase letters, digits and underscores, at most 40 characters, or `unspecified`. The greeting log line says which greeting was requested (`kind=checkin` or `kind=inbound`). Nothing else from the metadata is logged.
- D-11: Extend `agent/sim/sim-call.mjs` with `--outbound`: create the room, dispatch the agent with metadata `{"outbound": true, "reason": "dinner_checkin", "bridgeIdentity": "chert-bridge-out-sim"}` before joining, wait (up to 20 s) until the room's participant list shows the agent publishing both an audio and a video track, record that as `agentPublishedBeforeBridge`, then join as `chert-bridge-out-sim`, hold the 3 second quiet window, write `chert_bridge_ready`, and listen. With `--outbound` the call passes only if `agentPublishedBeforeBridge` is true in addition to the existing checks.

### Proof
- D-12: Unit tests (offline, part of `npm test`): the frame-choice function for a correct frame, `null`, a wrong-length buffer and a non-`Uint8Array`; the metadata helper for valid outbound metadata, inbound metadata, invalid JSON, a missing `bridgeIdentity` and a `bridgeIdentity` without the `chert-bridge-` prefix; `drawFace` still returning `WIDTH * HEIGHT * 4` bytes. `npm test` exits 0 with no network.
- D-13: Simulated proof against one running agent: (a) with the agent started with `AGENT_FAKE_CART=1`, a call with `--expect-cart-switch --seconds 20` exits 0 and the agent log contains `[agent] video: cart` then `[agent] video: face`; (b) with a normally started agent, a call with `--outbound --seconds 14` exits 0, and the agent log contains `[agent] outbound call reason=dinner_checkin` and a greeting line with `kind=checkin`; (c) a plain inbound call with `--seconds 14` still exits 0 with `kind=inbound`.

### Guard rails
- D-14: The executor may run at most 10 simulated calls of at most 45 seconds each, passing keys only through `--env-file=.env.local`. It must never read, print, copy or edit `.env.local`, never run `chert dev` or touch the FaceTime line, never call Chert's HTTP API, keep logs outside the repo and print only marker lines from them, and stop every agent process it starts.
- D-15: `agent/greet.mjs`, `agent/chert-rooms.mjs`, `package.json`, the stubs in `renal/` and `actions/`, and the three track READMEs stay unchanged.

### Claude's Discretion
- Which frames the cached picture uses and how it animates.
- Exact wording of `checkinGreeting`.
- Whether the frame-choice and metadata helpers share one new file or two.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `agent/README.md` — "Video out" and "Outbound calls (twist 3)" sections, the `getCartFrame` contract (synchronous, exact byte length or `null`), Chert's rules (video only from the speaking participant; for outbound the agent must be in the room publishing before the bridge joins and silent until ready)
- `actions/README.md` — Track C's `callPatient` steps, to see exactly what it dispatches and when it writes `chert_bridge_ready`
- `agent/agent.mjs`, `agent/face.mjs`, `agent/prompt.mjs`, `agent/sim/sim-call.mjs`, `agent/greet.mjs`, `shared/video.mjs`, `actions/index.mjs` — current code
- `.planning/phases/03-camera-and-tools/*-SUMMARY.md` — what Phase 3 built and how the simulated caller is run now
- `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md` (VID-01, VID-02, OUT-01, OUT-02), `.planning/ROADMAP.md` (Phase 4), `CLAUDE.md`
- `node_modules/@livekit/agents/dist/voice/*.d.ts`, `node_modules/@livekit/rtc-node/dist/*.d.ts`, `node_modules/livekit-server-sdk/dist/*.d.ts` — installed type definitions to check API use against

</canonical_refs>

<specifics>
## Specific Ideas

- Verified earlier from the installed packages: `livekit-server-sdk` has `AgentDispatchClient.createDispatch(roomName, agentName, { metadata })`, `RoomServiceClient.listParticipants(room)` and `updateRoomMetadata(room, metadata)`; a real LiveKit job exposes the dispatch metadata as the string `ctx.job.metadata`.
- Whether `session.start` accepts a `participantIdentity` for a participant who has not joined yet is not verified. The simulated `--outbound` call is the check; if it does not work, the executor should find the smallest change that still publishes the agent's audio before the bridge joins (for example starting the session without a bound participant and binding when the bridge arrives) and record what it did.
- Human verification items for this phase, none of them gaps: on a real FaceTime Video call the caller sees the agent's picture; with Track C's real cart running, the browser is visible on the phone and its text is readable; after it stops, the agent's picture returns; a real outbound call placed by Track C's `callPatient` is answered with the mealtime check-in. The last two also depend on Track C's module and on Chert allowing outbound calls on the line.
- All work is on the `agent` branch. Do not switch, create, merge or push branches. The person is asleep; nothing may need a human.

</specifics>

<deferred>
## Deferred Ideas

- The agent narrating cart progress without being asked — only if time allows after Phase 5
- Annotating or drawing on the outgoing video — out of scope

</deferred>

---

*Phase: 04-browser-on-the-call-and-the-agent-calls-you*
*Context gathered: 2026-11-14 via PRD Express Path*
