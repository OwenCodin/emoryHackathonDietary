# Phase 2: First call - Context

**Gathered:** 2026-11-13
**Status:** Ready for planning
**Source:** PRD Express Path (agent/README.md) plus a simulated-call spike run on 13 November

<domain>
## Phase Boundary

Make the call itself solid: the agent greets in time with the renal-dietitian persona, says the care-team line once, holds a conversation on a Gemini Live voice, and survives a hangup followed by a second call. Everything that can be proven without a phone is proven with a simulated caller; the real FaceTime checks are left as human verification items because the person is asleep and only they can place a call.

Not in this phase: reading the caller's camera and the full tool set (Phase 3), cart frames and outbound entry (Phase 4), in-aisle behaviour (Phase 5).

</domain>

<decisions>
## Implementation Decisions

### Voice model (settled by the spike)
- D-01: Keep `gemini-3.8-live` as the default voice model through `process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live'`. A simulated call on 13 November with `@livekit/agents-plugin-google` 1.8.0 showed: the agent stayed silent before the ready signal, spoke 1.1 s after `chert_bridge_ready` was written to the room metadata, was audible for about 6 s, and published 1280x720 video at about 15 frames a second. Do not add the OpenAI fallback or any other model code.

### Persona and greeting
- D-02: Create `agent/prompt.mjs` exporting `instructions` and `greeting`, and have `agent/agent.mjs` import them instead of defining its own strings. `instructions`: an AI renal dietitian on a FaceTime video call for people with kidney disease or on dialysis; replies of one or two short sentences; uses its tools for any food question and never invents nutrient numbers; applies the sodium, potassium, phosphorus and fluid limits the caller's care team set, never changes them and does not replace the care team; never pays for or orders anything; says it is an AI if asked.
- D-03: `greeting` (spoken once per call when `chert_bridge_ready` arrives) must make the agent say, in one or two short sentences, that it is an AI renal dietitian, that it follows the limits set by the caller's care team and does not replace them, and ask what food they want to check. This is how the care-team line is said exactly once per call (CALL-04). The greeting trigger stays `greet.mjs` unchanged.

### Simulated caller (developer tool, lives in the repo)
- D-04: Add `agent/sim/sim-call.mjs`, based on the working spike script at `/private/tmp/claude-501/-Users-ptrczx-Desktop/a0a663c5-84c0-4c14-b44c-8af38014aa92/scratchpad/sim/sim-call.mjs` (read it; it works as is against a running agent). It creates a LiveKit room, joins as identity `chert-bridge-sim`, publishes a silent audio track named `facetime-remote-audio`, dispatches the agent by `AGENT_NAME` with job metadata `{"sim": true}`, waits for the agent's audio track, writes `{"chert_call":"sim","chert_bridge_ready":true,"at":<ISO time>}` to the room metadata, listens, prints one line `RESULT <json>`, deletes the room and exits. In the repo version, import `@livekit/rtc-node` and `livekit-server-sdk` by package name, and import `WIDTH` and `HEIGHT` from `shared/video.mjs`.
- D-05: `sim-call.mjs` accepts `--seconds N` (listen time, default 14) and `--calls N` (default 1; runs N calls one after another against the same running agent). It exits 0 only if every call has `spokeBeforeReady: false`, `greeted: true`, first sound within 10 seconds of the ready signal, and `videoSize` equal to `${WIDTH}x${HEIGHT}`; otherwise it exits 1 and says which check failed. It is run as `node --env-file=.env.local agent/sim/sim-call.mjs`; do not add an npm script (the root `package.json` is part of the shared contract and stays as it is).
- D-06: `node --env-file=.env.local agent/sim/sim-call.mjs --calls 2` must pass against one running `npm start` process. This is the no-phone proof that a second call works after the first ends (CALL-05).

### Observability
- D-07: `agent/agent.mjs` prints one short line per lifecycle event, each starting with `[agent]`: call joined (with the caller identity), session started (with the model name), greeting requested, each tool call (tool name and whether it returned `ok`), and call ended. Use the session events the starter already uses plus `voice.AgentSessionEventTypes.FunctionToolsExecuted`. Never log API keys, tokens, the LiveKit URL, or what the caller said.

### Guard rails for whoever executes this
- D-08: `npm test` must still pass with no network and no keys; the simulated call is not part of `npm test`.
- D-09: The executor may run the simulated call with the person's real keys by passing `--env-file=.env.local` to node, at most 8 simulated calls of at most 20 seconds each. It must never read, print, copy or edit `.env.local`, never run `chert dev`, `chert onboard` or anything that touches the FaceTime line, and must stop every agent process it starts.
- D-10: `agent/greet.mjs` and `agent/chert-rooms.mjs` stay byte-for-byte unchanged, and the three track READMEs are not edited.

### Claude's Discretion
- Exact wording of the prompt and greeting within the rules above.
- Internal structure of `sim-call.mjs` beyond the options and exit codes above.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `agent/README.md` — shared contract, Chert's rules (greet only on `chert_bridge_ready`, exactly one audio publisher, video from the speaking participant), Track A order of work
- `agent/agent.mjs`, `agent/greet.mjs`, `agent/tools.mjs`, `shared/video.mjs` — current code from Phase 1
- `/private/tmp/claude-501/-Users-ptrczx-Desktop/a0a663c5-84c0-4c14-b44c-8af38014aa92/scratchpad/sim/sim-call.mjs` — the working spike to base the simulated caller on
- `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md` (CALL-01 to CALL-05), `.planning/ROADMAP.md` (Phase 2), `CLAUDE.md`
- `.planning/phases/01-scaffold-and-stubs/01-01-SUMMARY.md` — what Phase 1 built

</canonical_refs>

<specifics>
## Specific Ideas

- Verified on 13 November, so plans can rely on them: `.env.local` holds working LiveKit, Gemini and Chert values; `chert doctor --agent renal-dietitian` passed (agent joined a test room in 1.0 s); the Gemini key lists `gemini-3.8-live`, `gemini-3.8-flash` and `gemini-4-hydrogen`.
- Starting the agent for a simulated call: `node --env-file=.env.local agent/agent.mjs start` in the background, wait for the log line containing `registered worker`, run the simulated call, then stop the agent with SIGTERM and confirm with `pgrep -f agent/agent.mjs` that nothing is left.
- What cannot be proven here and must be listed as human verification, not as gaps: a real FaceTime Video call to the line is answered (CALL-01), the greeting is heard on the phone within 10 seconds (CALL-02), a real spoken conversation works (CALL-03), and a second real call works (CALL-05). The trial has about 49 FaceTime minutes, 5 per call, shared by three people.
- All work is on the `agent` branch. Do not switch, create, merge or push branches.

</specifics>

<deferred>
## Deferred Ideas

- Feeding synthetic speech into the simulated call to drive tool calls by voice — Phase 3, if needed
- OpenAI Realtime fallback voice — dropped unless a real call shows Gemini failing

</deferred>

---

*Phase: 02-first-call*
*Context gathered: 2026-11-13 via PRD Express Path and a simulated-call spike*
