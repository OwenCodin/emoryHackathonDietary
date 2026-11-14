---
phase: 03-camera-and-tools
verified: 2026-11-13T23:00:00Z
status: human_needed
score: 4/4 roadmap criteria verified in code and simulation (criterion 4 and the real-phone part of 1 need a human)
human_verification:
  - test: "On a real FaceTime call, hold a nutrition label to the phone camera and ask 'Can I eat this?'"
    expected: "A spoken verdict starting with Yes, No or Small portion, within about 8 seconds, for the product on the label."
    why_human: "A real FaceTime call cannot be placed unattended."
  - test: "On a real call, turn the camera off (or mute video) and ask 'Can I eat this?'"
    expected: "The agent says it cannot see and asks you to turn the camera on or name the food. It never describes food."
    why_human: "Needs a real phone camera toggle."
  - test: "Set AGENT_DEBUG_FRAME_DIR to a folder outside the repo, make a real call, open the saved frame-*.jpg"
    expected: "The picture shows what the phone showed, with no FaceTime controls or self-preview covering it."
    why_human: "Only a person can judge the real phone frame."
  - test: "Run with PLAYGROUND=1, join from LiveKit's playground with a webcam, ask about something in view"
    expected: "A JPEG of the current frame is saved (debug dir) and a verdict is spoken; with the flag unset only chert-bridge- video is accepted."
    why_human: "Needs a browser, webcam and the real LiveKit project."
  - test: "By real voice: ask for a meal idea with the fridge in view, say what you ate, ask what is left today, ask to shop for missing items, ask for the link by text"
    expected: "Each is answered in one or two sentences from tool results. The link is texted only once the cart is done. Nothing is paid."
    why_human: "Needs a real call and real voice. Simulated proof covered only the look, no-camera and named-food paths."
---

# Phase 3: Camera and tools Verification Report

**Phase Goal:** A patient shows or names a food and hears a short, correct verdict based on their own limits, and the agent never guesses when it cannot see.
**Verified:** 2026-11-13
**Status:** human_needed
**Re-verification:** No, initial verification, against the current code after the review fixes.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | PLAYGROUND=1 lets a non-agent participant's video in; unset keeps chert-bridge- only; a JPEG is saved when AGENT_DEBUG_FRAME_DIR is set | VERIFIED (code and tests); real playground run is human | `agent/camera.mjs` `accepts()` branches on `playground`. `saveDebugFrame` in `agent/tools.mjs` writes `frame-*.jpg` and refuses folders inside the repo. `.env.example` lines 17 and 19 list both variables. |
| 2 | Camera off, muted, or frame older than 1.5 s gives "cannot see", never an old frame | VERIFIED | `jpeg()` returns null when muted, there is no latest frame, or `isFresh` fails. Unsubscribe and mute clear `latest`. `look_at_camera` returns `fail('no_camera_picture')` with its own sentence. Simulated call with no `--image` produced `[agent] tool look_at_camera ok=false`. |
| 3 | Named food (`check_food`), `log_meal` and `todays_totals`, `suggest_meal`, and cart tools all answer, and failures speak a plain sentence | VERIFIED against stubs | `agent/tools.mjs` has all 8 tools, each wrapped by `guard` (timeout, exception and size cap, own error codes, no module error text). The review fixes are present: `log_meal` takes `foods`; `look_at_camera` sorts by severity and reports `omitted`; `cart_status` and `todays_totals` return `ok: false` on bad data; `text_cart_link` sends only when state is `done` and a valid link exists, once per link. Simulated "Can I eat a banana?" gave `[agent] tool check_food ok=true`. |
| 4 | [real call] Holding a label gives a correct verdict | Simulated proof passed; real phone is human | Simulated call with `--image label.jpg --say "Can I eat this? Please look at my camera."` gave `[agent] camera video from=chert-bridge-sim`, `[agent] tool look_at_camera ok=true`, and a saved debug frame, which `file` reports as 1280x720 JPEG. |
| 5 | Verdicts are one sentence starting with Yes, No or Small portion (AISL-04) | VERIFIED | `spokenVerdict` maps ok to Yes, avoid to No, limit to Small portion, else "I can't tell". It strips a duplicate module verdict word and caps at two sentences. `prompt.mjs` tells the model to say each spoken sentence as given, verdict word first. |

**Score:** all must-haves verified in code and simulation. The real-phone parts remain as human items.

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `agent/camera.mjs` | VERIFIED | 107 lines. Exports `watchCaller` and `isFresh`. Handles subscribe, unsubscribe, mute and unmute. RGBA to sharp JPEG at quality 85. `close()` releases the stream and listeners. |
| `agent/tools.mjs` | VERIFIED | 412 lines. Imports only `../renal/index.mjs` and `../actions/index.mjs`. 8 tools, each guarded. |
| `agent/prompt.mjs` | VERIFIED | Names every tool and when to use it. Says to claim sight only after `look_at_camera` returns ok. Never pay. The Phase 2 "cannot see the camera yet" line is gone. |
| `agent/agent.mjs` | VERIFIED | `watchCaller(ctx.room)` runs before `ctx.connect()`. `buildTools({ camera, patientId: 'demo' })`. `videoEnabled: false`. The `[agent] tool <name> ok=` log is kept. The camera is closed on shutdown. |
| `agent/sim/sim-call.mjs`, `speech.mjs` | VERIFIED | `--image` and `--say` worked in the live runs (`imageFramesSent` 141, `says` 1, replied true). |
| `agent/sim/fixtures/label.jpg` | VERIFIED | 78,913 bytes, under 100 KB. |

### Key Links

| From | To | Status |
|------|----|--------|
| `agent.mjs` | `camera.mjs` via `watchCaller(ctx.room)` | WIRED |
| `agent.mjs` | `tools.mjs` via `buildTools({ camera, ... })` | WIRED |
| `tools.mjs` | `renal/` and `actions/` | WIRED (stubs) |
| `sim-call.mjs` | agent via the `facetime-remote-video` track | WIRED (live run showed the camera video line) |

### Behavioral Spot-Checks and Simulated Proof

3 simulated calls, each at most 30 s, against one agent with a temporary debug frame directory outside the repo.

| Case | Result | Status |
|------|--------|--------|
| `--image label.jpg --say "Can I eat this? ..."` | `look_at_camera ok=true`; 1280x720 JPEG saved | PASS |
| same, no `--image` | `look_at_camera ok=false` | PASS |
| `--say "Can I eat a banana?"` | `check_food ok=true` | PASS |
| `npm test` | 104 pass, 0 fail | PASS |

After the runs I sent SIGTERM to the agent. `pgrep` found no `agent/agent.mjs` process.

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| CAM-01 | SATISFIED | `watchCaller`, `jpeg()`, and the live look call. |
| CAM-02 | SATISFIED | Freshness, mute and unsubscribe rules, tests, and the live no-camera call. |
| CAM-03 | SATISFIED in code and tests (`PLAYGROUND` flag); a real playground run is a human item. |
| TOOL-01 | SATISFIED | `look_at_camera`. |
| TOOL-02 | SATISFIED | `check_food`, with a live call. |
| TOOL-03 | SATISFIED against stubs | `suggest_meal`. |
| TOOL-04 | SATISFIED against stubs | `log_meal` and `todays_totals`. |
| TOOL-05 | SATISFIED against stubs | `start_cart`, `cart_status` and `text_cart_link`. |
| TOOL-06 | SATISFIED | `guard` and `fail` codes with own sentences. |
| AISL-04 | SATISFIED | `spokenVerdict` and the prompt. |

All 10 IDs are marked Phase 3 in REQUIREMENTS.md and are claimed by the plans. No orphaned requirements.

### Anti-Patterns

No TBD, FIXME, XXX or TODO markers in `agent/*.mjs` or `agent/sim/*.mjs`. No stubs found in the Phase 3 code.

### Notes (not gaps)

- In simulated calls about one spoken question in four gets no reply, because Gemini's server-side voice detection cancels it as an interruption. Phase 5 adds a no-interruption setting and a reply watchdog. All three cases here passed on the first attempt.
- The tools run against the renal and actions stubs. Real results depend on the other tracks merging.

### Gaps Summary

No gaps in the code or the simulated proof. The remaining items need a real phone or browser, listed in `human_verification` above.

---

_Verified: 2026-11-13_
_Verifier: Claude (gsd-verifier)_
