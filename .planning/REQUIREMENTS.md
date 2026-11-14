# Requirements: emoryHackathonDietary — Track A (the call)

**Defined:** 2026-11-13
**Core Value:** A kidney patient can FaceTime the agent, point the camera at food, and hear a correct, specific answer to "can I eat this?" based on their own limits.

**Scope:** Track A only, built on the `agent` branch. Tracks B (`renal/`) and C (`actions/`) are built by teammates and reached through the shared contract in `agent/README.md`. Until they merge, Track A runs against stubs with the contract's shapes.

## v1 Requirements

### Scaffold

- [x] **SCAF-01**: A teammate can clone the repo, run `npm install` and `npm start`, and the agent process starts from the root `package.json` defined in the shared contract
- [x] **SCAF-02**: All tracks read video size and frame rate from one file, `shared/video.mjs` (WIDTH 1280, HEIGHT 720, FPS 15)
- [x] **SCAF-03**: Stub `renal/index.mjs` and `actions/index.mjs` export every contract function and return canned objects of the exact contract shapes, so each track can develop alone
- [x] **SCAF-04**: `.env.example` lists every contract variable without values, and `.gitignore` keeps `.env.local`, `node_modules/` and `actions/.browser-profile/` out of git

### Call

- [x] **CALL-01**: A patient can FaceTime the line and the agent answers
- [x] **CALL-02**: The patient hears a greeting within 10 seconds of FaceTime being ready, triggered by the `chert_bridge_ready` room signal and never by a participant joining
- [x] **CALL-03**: The patient can hold a spoken two-way conversation with a renal dietitian persona using a Gemini voice model, or the starter's OpenAI voice if no Gemini Live model works with the pinned plugin
- [x] **CALL-04**: The patient hears, once per call, that the agent follows limits set by their care team and does not replace it
- [x] **CALL-05**: After the patient hangs up, a second call is answered and greeted the same way

### Camera

- [x] **CAM-01**: When the patient asks about something in view, the agent captures the caller's current video frame as a JPEG
- [x] **CAM-02**: When the camera is off, muted or the last frame is older than 1.5 seconds, the patient is told the agent cannot see and is asked to turn the camera on; an old frame is never used
- [x] **CAM-03**: A developer can test the camera path from LiveKit's playground without a FaceTime call, behind a `PLAYGROUND=1` flag that leaves the real path unchanged

### Tools

- [x] **TOOL-01**: Patient can show a label, plate, fridge or shelf and hear a verdict for what is in view (`look_at_camera`: frame, `describeImage`, `checkFood`)
- [x] **TOOL-02**: Patient can name a food without showing it and hear a verdict (`check_food`)
- [x] **TOOL-03**: Patient can ask what to cook from the foods last seen and hear a meal that fits their limits (`suggest_meal`)
- [x] **TOOL-04**: Patient can say they ate something and ask how much of each limit is left today (`log_meal`, `todays_totals`)
- [x] **TOOL-05**: Patient can ask the agent to shop for missing items, hear progress, and get the cart link by text (`start_cart`, `cart_status`, `text_cart_link`)
- [x] **TOOL-06**: When a renal or actions function returns `ok: false`, the patient hears a plain explanation and the call continues

### Video out

- [x] **VID-01**: On a FaceTime Video call the patient sees the agent's picture, published at the shared WIDTH and HEIGHT from the participant that speaks
- [x] **VID-02**: While a cart is running the patient sees the shopping browser, and sees the agent's picture again when it stops

### Outbound

- [x] **OUT-01**: When dispatched with job metadata `outbound: true`, the agent joins and publishes audio and video immediately, without waiting for a participant, and stays silent until `chert_bridge_ready`
- [x] **OUT-02**: A patient who answers an outbound call hears a mealtime check-in greeting asking to see their plate

### In the aisle

- [x] **AISL-01**: Patient can point at a shelf and hear which product in view is the best choice
- [x] **AISL-02**: Patient who calls back after a call ends continues with the same shopping list and approved items
- [x] **AISL-03**: Patient is told at about four minutes that the call will end soon and to call back
- [x] **AISL-04**: Verdicts are one sentence and start with "Yes", "No" or "Small portion"

## v2 Requirements

Deferred. Not in the current roadmap.

### Patients

- **PAT-01**: Agent recognises which patient is calling and loads their profile (v1 uses one demo patient)
- **PAT-02**: Patient can set or update their limits by voice with care-team confirmation

### Camera

- **CAM-04**: Agent watches the camera continuously and speaks up without being asked

## Out of Scope

| Feature | Reason |
|---------|--------|
| Renal logic, image reading, nutrient lookup | Track B (`renal/`), behind the contract |
| Browser cart, frame capture, outbound call placement, texts, demo video | Track C (`actions/`), behind the contract |
| Paying or checking out | Agent stops at a filled cart and asks |
| Reading lab sheets (twist 2) | Not selected |
| Upgrading LiveKit packages past 1.8.0 | Newer versions need rtc-node 1.x, untested with Chert's starter |
| Feeding live video to the voice model | The Node Gemini plugin discards video frames |
| A patient-facing app or web page | "No app, just FaceTime" is the point |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SCAF-01 | Phase 1 | Complete |
| SCAF-02 | Phase 1 | Complete |
| SCAF-03 | Phase 1 | Complete |
| SCAF-04 | Phase 1 | Complete |
| CALL-01 | Phase 2 | Complete |
| CALL-02 | Phase 2 | Complete |
| CALL-03 | Phase 2 | Complete |
| CALL-04 | Phase 2 | Complete |
| CALL-05 | Phase 2 | Complete |
| CAM-01 | Phase 3 | Complete |
| CAM-02 | Phase 3 | Complete |
| CAM-03 | Phase 3 | Complete |
| TOOL-01 | Phase 3 | Complete |
| TOOL-02 | Phase 3 | Complete |
| TOOL-03 | Phase 3 | Complete |
| TOOL-04 | Phase 3 | Complete |
| TOOL-05 | Phase 3 | Complete |
| TOOL-06 | Phase 3 | Complete |
| AISL-04 | Phase 3 | Complete |
| VID-01 | Phase 4 | Complete |
| VID-02 | Phase 4 | Complete |
| OUT-01 | Phase 4 | Complete |
| OUT-02 | Phase 4 | Complete |
| AISL-01 | Phase 5 | Complete |
| AISL-02 | Phase 5 | Complete |
| AISL-03 | Phase 5 | Complete |

**Coverage:**
- v1 requirements: 26 total
- Mapped to phases: 26
- Unmapped: 0 ✓

---
*Requirements defined: 2026-11-13*
*Last updated: 2026-11-13 after roadmap creation*
