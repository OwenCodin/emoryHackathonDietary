# Roadmap: emoryHackathonDietary — Track A (the call)

## Overview

Track A is the FaceTime call itself. The path runs from a shared scaffold with stubs (two teammates are blocked on it), to the first answered and greeted call and the voice-model choice (the riskiest unknowns), to camera snapshots and tools that give a spoken verdict, and then to the cuttable pieces: the shopping browser shown on the call with the outbound mealtime call, and in-aisle behaviour. Tracks B (`renal/`) and C (`actions/`) are reached only through the contract functions and run as stubs until they merge. Times assume submission at 8:00am Sunday 15 November 2026.

Real FaceTime calls are scarce (about 49 minutes left on the trial, 5 minutes per call, shared by the whole team; Track A's budget is about 25). Every phase therefore has criteria checkable without a call (stubs, `npm` commands, LiveKit playground), and criteria that need a real call are marked **[real call]**. Human checkpoints are named in each phase.

## Phases

- [x] **Phase 1: Scaffold and stubs** - Repo starts with `npm start`, shared video size, and stub renal and actions modules so all three tracks can work alone (completed 2026-11-14)
- [x] **Phase 2: First call** - A FaceTime call is answered, greeted in time, and conversational, twice in a row (completed 2026-11-14)
- [ ] **Phase 3: Camera and tools** - The patient shows or names food and hears a one-sentence verdict tied to their limits
- [ ] **Phase 4: Browser on the call and the agent calls you** - The patient sees the shopping browser during a cart run, and an outbound call opens with a mealtime check-in
- [ ] **Phase 5: In the aisle** - The patient points at a shelf and hears the best choice, and a callback continues the same shopping list

## Phase Details

### Phase 1: Scaffold and stubs
**Goal**: A teammate can clone the repo, start the agent process, and develop their own track against stubs that match the shared contract
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: SCAF-01, SCAF-02, SCAF-03, SCAF-04
**Checkpoint**: Friday 10pm, on `main`. Two teammates are blocked until this lands.
**Success Criteria** (what must be TRUE):
  1. A teammate runs `npm install` then `npm start` from a fresh clone and the agent process starts (it may then wait for LiveKit keys without crashing on import)
  2. Importing `renal/index.mjs` and `actions/index.mjs` and calling every contract function returns canned objects of the exact contract shapes, with no network and no thrown errors
  3. `shared/video.mjs` is the only place the video size and rate are defined (1280, 720, 15) and the agent reads it from there
  4. `.env.example` lists every contract variable with no values, and `git status` shows `.env.local`, `node_modules/` and `actions/.browser-profile/` as ignored
**Human checkpoint**: Putting LiveKit and Gemini keys in `.env.local` is not needed to finish this phase, but the person must do it before Phase 2.
**Plans**: 1 plan

Plans:
- [x] 01-01-PLAN.md — Root package, contract test, stubs, shared video size and check_food tool, and the Chert starter on Gemini booting with `npm start` (walking skeleton; see 01-SKELETON.md)

### Phase 2: First call
**Goal**: A patient can FaceTime the line, is greeted in time, and holds a spoken conversation with the dietitian persona, repeatably
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: CALL-01, CALL-02, CALL-03, CALL-04, CALL-05
**Checkpoint**: Saturday 2am. Spend at most two hours on the voice-model choice.
**Success Criteria** (what must be TRUE):
  1. **[real call]** A person FaceTimes the line and the agent answers, and the patient hears a greeting within 10 seconds of FaceTime being ready, fired by the `chert_bridge_ready` room signal and never by a participant joining
  2. **[real call]** The patient holds a two-way spoken conversation with a renal dietitian persona on the chosen voice model: `gemini-3.8-live`, then `gemini-3.1-flash-live-preview` with the greeting moved into the instructions, then the starter's OpenAI voice, whichever works first; the choice and its reason are recorded
  3. **[real call]** The patient hears once per call that the agent follows limits set by their care team and does not replace it
  4. **[real call]** After the patient hangs up, a second call is answered and greeted the same way
  5. Without a call: `chert doctor` passes and `chert dev` reaches the waiting-room message while `npm start` is running; a Gemini tool call to `check_food` against the stubs works in the playground or a call (shows tool calling works through plugin 1.8.0)
**Human checkpoint**: The person puts keys in `.env.local`; asks Chert staff whether caller capture is enabled on the line (and which line to use if not) before more code is written; announces in team chat before each real call.
**Plans**: 1 plan

Plans:
- [x] 02-01-PLAN.md — Simulated Chert caller in the repo, dietitian persona and care-team greeting in prompt.mjs, [agent] lifecycle log lines, and a two-call no-phone proof against one running agent

### Phase 3: Camera and tools
**Goal**: A patient shows or names a food and hears a short, correct verdict based on their own limits, and the agent never guesses when it cannot see
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: CAM-01, CAM-02, CAM-03, TOOL-01, TOOL-02, TOOL-03, TOOL-04, TOOL-05, TOOL-06, AISL-04
**Checkpoint**: Saturday 10am. On a call, "can I eat this?" with a label in view gets a correct spoken verdict in under about eight seconds.
**Success Criteria** (what must be TRUE):
  1. Without a call: with `PLAYGROUND=1`, a developer joins from LiveKit's playground with webcam, asks about something in view, and a saved JPEG of the current frame is produced; with the flag unset the real Chert path is unchanged
  2. Without a call: with the camera off, muted, or the last frame older than 1.5 seconds, the agent says it cannot see and asks the patient to turn the camera on, and no old frame is ever used
  3. The patient names a food (`check_food`), says they ate something and asks what is left today (`log_meal`, `todays_totals`), or asks what to cook from foods last seen (`suggest_meal`) and hears an answer; this works against the stubs and then against Track B's real functions as they merge
  4. **[real call]** The patient holds up a label, plate, fridge or shelf and hears a verdict for what is in view (`look_at_camera`), after a saved frame has been opened and checked for FaceTime controls or self-preview in the picture
  5. Spoken verdicts are one sentence and start with "Yes", "No" or "Small portion"; when a renal or actions function returns `ok: false` the patient hears a plain explanation and the call continues
  6. The patient can ask the agent to shop for missing items, hear progress, and get the cart link by text (`start_cart`, `cart_status`, `text_cart_link`), working against the Track C stubs; the agent never pays for anything and stops at a filled cart
**Human checkpoint**: Real calls to prove caller capture delivers a clean frame and a verdict end to end; the person places them and watches the shared minute budget.
**Plans**: TBD

### Phase 4: Browser on the call and the agent calls you
**Goal**: The patient sees the shopping browser on the call while a cart fills, and a patient who answers an outbound call is greeted with a mealtime check-in. First to cut if time runs out; avatar plus narration is the fallback.
**Mode:** mvp
**Depends on**: Phase 3 (and Track C's `getCartFrame` and `callPatient`, stubbed until merged)
**Requirements**: VID-01, VID-02, OUT-01, OUT-02
**Checkpoint**: Saturday 8pm for twist 3 (the agent calls you).
**Success Criteria** (what must be TRUE):
  1. **[real call]** On a FaceTime Video call the patient sees the agent's picture at 1280 by 720, published by the same participant that speaks, and the agent's voice does not stutter
  2. While a cart is running the patient sees the shopping browser (cart text readable on a phone), and sees the agent's picture again when it stops; checkable without a call by feeding a stub `getCartFrame` that returns and then stops returning frames and watching the published track in the playground
  3. Without a call: dispatching the agent with job metadata `outbound: true` makes it join and publish audio and video at once without waiting for a participant, and it stays silent until `chert_bridge_ready` is written to the room metadata
  4. **[real call]** A patient who answers an outbound call hears a mealtime check-in such as "It's dinner time. Show me your plate."
**Human checkpoint**: Asking Chert staff whether the trial line may place outbound calls and to which verified numbers (with Track C); placing the real outbound test within the shared minute budget.
**Plans**: TBD

### Phase 5: In the aisle
**Goal**: A patient in a store points at a shelf and hears which product is best, and a callback after the 5-minute limit continues the same shopping list. Cuttable if time runs out.
**Mode:** mvp
**Depends on**: Phase 3 (Phase 4 improves the demo but is not required)
**Requirements**: AISL-01, AISL-02, AISL-03
**Checkpoint**: Saturday 8pm for twist 4. Feature freeze Sunday 12am.
**Success Criteria** (what must be TRUE):
  1. **[real call]** The patient points at a shelf and hears which product in view is the best choice, named by position or brand, in one sentence
  2. Without a call: after a session ends, a new session for the same patient starts with the same shopping list and approved items (kept in memory by patient), shown by a stub-driven test or the playground
  3. **[real call]** The patient is told at about four minutes that the call will end soon and to call back, and a call back continues the same list
**Human checkpoint**: A real shelf test in a store or with a printed shelf photo, placed by the person within the minute budget.
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Scaffold and stubs | 1/1 | Complete   | 2026-11-14 |
| 2. First call | 1/1 | Complete   | 2026-11-14 |
| 3. Camera and tools | 0/0 | Not started | - |
| 4. Browser on the call and the agent calls you | 0/0 | Not started | - |
| 5. In the aisle | 0/0 | Not started | - |
