# Phase 3: Camera and tools - Context

**Gathered:** 2026-11-13
**Status:** Ready for planning
**Source:** PRD Express Path (agent/README.md — "Camera in", "Tools", shared contract)

<domain>
## Phase Boundary

The patient shows or names a food and hears a short verdict tied to their limits. The agent grabs the caller's current video frame on request, runs it through Track B's `describeImage` and `checkFood`, and speaks one sentence that starts with the verdict. It never guesses when it cannot see. The full tool set from the contract is wired to the `renal` and `actions` modules (stubs today, real modules when teammates merge). Everything is proven without a phone using unit tests and the simulated caller, which in this phase learns to send a video picture and spoken questions.

Not in this phase: showing cart frames on the video track and the outbound entry path (Phase 4); shelf comparison, cross-call memory and the four-minute warning (Phase 5).

</domain>

<decisions>
## Implementation Decisions

### Camera in
- D-01: Create `agent/camera.mjs` exporting `watchCaller(room, options)`, following the "Camera in" sketch in `agent/README.md`: listen for `RoomEvent.TrackSubscribed`, and for a video track from a participant whose identity starts with `chert-bridge-`, read frames with `VideoStream` and keep only the latest one with the time it arrived. It returns an object with `async jpeg(maxAgeMs = 1500)`, which returns a JPEG `Buffer` of the latest frame (convert with `frame.convert(VideoBufferType.RGBA)` then `sharp` raw input, quality 85) or `null`.
- D-02: `jpeg()` returns `null`, never an old picture, when there is no video track, when the latest frame is older than `maxAgeMs`, after `RoomEvent.TrackUnsubscribed` for the video track, and after `RoomEvent.TrackMuted` for the caller's video publication. The freshness decision is a small pure function (latest timestamp, now, maxAgeMs) so it can be unit tested without LiveKit.
- D-03: In `agent/agent.mjs`, call `watchCaller(ctx.room)` before `ctx.connect()`, and change `ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY)` to subscribe to all tracks so the caller's video arrives. Keep `videoEnabled: false` in the session's `inputOptions`: the Gemini voice model cannot use video frames, the snapshot tool does the seeing.
- D-04: When `process.env.PLAYGROUND === '1'`, `watchCaller` accepts video from any participant that is not an agent, so the camera path can be tested from LiveKit's playground. Without the flag the `chert-bridge-` rule applies unchanged. Add `PLAYGROUND` to `.env.example` as an optional, empty variable with a comment.
- D-05: When `process.env.AGENT_DEBUG_FRAME_DIR` is set, each JPEG handed to `describeImage` is also written to that directory as `frame-<timestamp>.jpg`. Nothing is written when it is unset. Add it to `.env.example` as an optional, empty variable.

### Tools
- D-06: `agent/tools.mjs` exports `buildTools({ camera, patientId })` returning these tools, each an `llm.tool` with no `name` option (the object key is the name), importing only from `../renal/index.mjs` and `../actions/index.mjs`:
  - `look_at_camera` (no parameters): `camera.jpeg()`; if `null`, return a not-ok result saying the camera cannot be seen; else `describeImage({ jpeg })`; if not ok or `kind === 'unclear'`, return a not-ok result asking to hold it closer; else `getProfile`, then `checkFood` for the label product (when `seen.label` is set, pass `{ name: label.product, label }`) or for up to 6 of `seen.foods`; remember the food names and verdicts.
  - `check_food` (`name: string`, `grams: number | null`): `getProfile` then `checkFood`.
  - `suggest_meal` (no parameters): `suggestMeals({ foods: <names from the last look>, profile, count: 2 })`; if nothing has been looked at yet, return a not-ok result asking the caller to show the fridge first; remember the meals' `missing` items.
  - `log_meal` (no parameters): `logFood({ patientId, verdict })` for each verdict from the last look or check; not-ok if there is none.
  - `todays_totals` (no parameters): `getToday({ patientId })`.
  - `start_cart` (`items`: array of `{ name: string, quantity: string }`, may be empty): `startCart({ items })`, using the remembered `missing` items when the array is empty; not-ok if there is nothing to buy.
  - `cart_status` (no parameters): `getCartStatus()`, returning only `state`, `step`, the names in `added`, `missing` and `total`.
  - `text_cart_link` (no parameters): `getCartStatus()`, then `sendText({ phone: process.env.PATIENT_PHONE, text })` with the `cartUrl`; not-ok if there is no `cartUrl` or no phone configured.
- D-07: Every tool returns a small plain object and never throws: wrap each `execute` so that an exception or an `ok: false` from a module becomes `{ ok: false, error, say }`, where `say` is one plain sentence the agent can speak (for example "I couldn't check that just now. Let's try again in a moment."). No tool returns raw module errors, stack traces, URLs with tokens, or more than about 600 characters.
- D-08: Verdict wording (AISL-04). Add a pure exported function in `agent/tools.mjs` that turns a contract `Verdict` into one spoken sentence starting with the verdict word: `ok` → "Yes", `avoid` → "No", `limit` → "Small portion", `unknown` → "I can't tell". The sentence is the verdict word followed by the module's `say` text, trimmed to one or two sentences. `look_at_camera` and `check_food` return it as `spoken` for each food.
- D-09: Update `agent/prompt.mjs` so the instructions tell the model: which tool to use for which request; to say each `spoken` sentence as given, verdict word first; when a tool result has `ok: false`, to say its `say` sentence and carry on; never to state nutrient numbers that did not come from a tool result; never to claim it can see unless `look_at_camera` returned `ok: true`; and never to pay or check out, only to start a cart and offer the link.
- D-10: Each tool call keeps printing the Phase 2 log line `[agent] tool <name> ok=<true|false>`.

### Simulated caller extensions
- D-11: Extend `agent/sim/sim-call.mjs` with `--image <path>`: publish a video track named `facetime-remote-video` from the simulated caller, sending that image (scaled with `sharp` to 1280x720 RGBA) about 5 times a second for the whole call.
- D-12: Extend it with `--say "<text>"` (repeatable): after the greeting has finished (agent audio silent for 1.5 s), speak the text into the simulated caller's microphone track. Produce the speech on this Mac with `say -o <tmp>.aiff "<text>"` and `afconvert -f WAVE -d LEI16@48000 -c 1 <tmp>.aiff <tmp>.wav`, read the PCM samples from the WAV, and send them as 10 ms frames; wait for the agent's reply to end before the next `--say`. Without `--say` and `--image` the Phase 2 behaviour and exit codes are unchanged.
- D-13: Add a small test image `agent/sim/fixtures/label.jpg` (a plain nutrition-label style picture with large text, generated with `sharp` from an SVG; under 100 KB) for `--image`.

### Proof
- D-14: Unit tests (offline, part of `npm test`): the freshness function; every tool's `execute` against the stubs, including the camera-off path (`camera.jpeg()` returning `null`), a module returning `ok: false`, a module throwing, and the verdict-word function for all four verdicts. `npm test` exits 0 with no network.
- D-15: Simulated proof against one running agent started with `AGENT_DEBUG_FRAME_DIR` set to a temporary directory: (a) a call with `--image agent/sim/fixtures/label.jpg --say "Can I eat this? Please look at my camera."` after which the agent log contains `[agent] tool look_at_camera ok=true` and the debug directory holds a JPEG whose size is 1280x720; (b) a call with no image and `--say "Please look at my camera and tell me if I can eat this."` after which the agent log contains `[agent] tool look_at_camera ok=false`; (c) a call with `--say "Can I eat a banana?"` after which the log contains `[agent] tool check_food ok=true`. If the model does not call the tool on the first try, rephrase the `--say` text and retry within the call budget.

### Guard rails
- D-16: The executor may run at most 12 simulated calls of at most 45 seconds each, passing keys only through `--env-file=.env.local`. It must never read, print, copy or edit `.env.local`, never run `chert dev` or touch the FaceTime line, keep logs outside the repo and grep them only for markers, and stop every agent process it starts.
- D-17: `agent/greet.mjs`, `agent/chert-rooms.mjs`, `package.json`, the stubs in `renal/` and `actions/`, and the three track READMEs stay unchanged.

### Claude's Discretion
- Exact prompt wording and the not-ok `say` sentences.
- How tool state (last foods, verdicts, missing items) is held inside `buildTools`.
- Test file layout.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `agent/README.md` — shared contract (types `Seen`, `Food`, `Verdict`, `CartItem`; the hand-off function tables; rules for cross-track functions), "Camera in" and "Tools" sketches, Chert's rules
- `agent/agent.mjs`, `agent/tools.mjs`, `agent/prompt.mjs`, `agent/sim/sim-call.mjs`, `agent/contract.test.mjs`, `renal/index.mjs`, `actions/index.mjs`, `shared/video.mjs` — current code
- `.planning/phases/02-first-call/02-01-SUMMARY.md` — what Phase 2 built and how the simulated caller is run
- `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md` (CAM-01 to CAM-03, TOOL-01 to TOOL-06, AISL-04), `.planning/ROADMAP.md` (Phase 3), `CLAUDE.md`
- `node_modules/@livekit/rtc-node/dist/*.d.ts` and `node_modules/@livekit/agents/dist/llm/tool_context.d.ts` — the installed type definitions to check API use against

</canonical_refs>

<specifics>
## Specific Ideas

- Verified on 13 November from the installed packages: `@livekit/rtc-node` 0.13.35 exports `VideoStream` (a `ReadableStream` of `{ frame, timestampUs, rotation }`), `VideoFrame.convert(dstType)`, `RoomEvent.TrackSubscribed` with arguments `(track, publication, participant)`, `RoomEvent.TrackUnsubscribed` with the same arguments, and `RoomEvent.TrackMuted` with `(publication, participant)`. `sharp` is already a dependency.
- The `renal` stub's `describeImage` always returns a plate with a banana and its `checkFood` returns verdict `unknown` with placeholder wording. That is expected; the proof here is that the path runs end to end, not that the verdict is clinically right.
- Chert's docs say the captured caller picture may include FaceTime's own controls or a self-preview and that caller capture is a per-line opt-in. Whether the real line delivers `facetime-remote-video` can only be checked on a real call; list it as human verification, not as a gap.
- Human verification items for this phase: on a real FaceTime Video call, a label held to the camera gets a spoken verdict; with the phone camera off the agent says it cannot see; a frame saved through `AGENT_DEBUG_FRAME_DIR` shows what the phone camera showed.
- All work is on the `agent` branch. Do not switch, create, merge or push branches. The person is asleep; nothing may need a human.

</specifics>

<deferred>
## Deferred Ideas

- Shelf comparison wording, cross-call shopping memory, four-minute warning — Phase 5
- Showing `getCartFrame()` on the video track, outbound entry path — Phase 4
- Continuous camera watching without being asked — v2

</deferred>

---

*Phase: 03-camera-and-tools*
*Context gathered: 2026-11-13 via PRD Express Path*
