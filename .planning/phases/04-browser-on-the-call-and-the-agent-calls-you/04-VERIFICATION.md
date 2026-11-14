---
phase: 04-browser-on-the-call-and-the-agent-calls-you
verified: 2026-11-13T00:00:00Z
status: human_needed
score: 6/6 automated must-haves verified (2 real-phone criteria pending)
human_verification:
  - test: "Real FaceTime Video call to the agent line"
    expected: "The caller sees the agent's animated picture at 1280x720 (moving accent bar, blink, mouth opens while it speaks), from the same participant that speaks, and the voice does not stutter."
    why_human: "Needs a real phone and FaceTime; picture quality and audio smoothness are perceptual."
  - test: "Real call with Track C's real cart (getCartFrame) running"
    expected: "The shopping browser is visible on the phone, cart text is readable on a phone screen, and the agent's picture returns after the cart stops."
    why_human: "Depends on Track C's real module (a stub here) and on how it looks on a phone."
  - test: "Real outbound call placed by Track C's callPatient"
    expected: "The patient answers and hears the mealtime check-in (AI renal dietitian checking in at mealtime, follows care-team limits, asks to see their plate). Agent is silent until the patient is connected."
    why_human: "Needs Track C's callPatient, and Chert must allow outbound calls on the line."
---

# Phase 4 Verification Report

**Goal:** The patient sees the shopping browser on the call while a cart fills, and a patient who answers an outbound call is greeted with a mealtime check-in.
**Mode:** Goal-backward against current code (after review fixes). Re-verification: No.

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | VID-01: picture at WIDTH x HEIGHT from the speaking participant (D-04) | VERIFIED (simulated); real call human | `face.mjs` `createFaceFrames` pre-renders idle, blink and 3 mouth states once; `drawFace` kept; sim RESULT `videoSize 1280x720`. Published from the agent's own track. |
| 2 | VID-02/D-01..D-03: cart frame used when exact-size Uint8Array, else face; once-per-call logs | VERIFIED | `video.mjs` `pickFrame`/`createVideoPicker` never throw, copy partial-view buffers, and log once. `agent.mjs` wires `getCartFrame` or the fake provider. |
| 3 | D-05/D-06: fake cart proof, face -> cart -> face | VERIFIED | Re-run: sim exit 0, `videoTimeline ["face","cart","face"]`, `cartSwitch true`; agent log has `[agent] video: cart` then `[agent] video: face`. `.env.example` has `AGENT_FAKE_CART=`. |
| 4 | OUT-01/D-07/D-08: outbound joins and publishes audio and video without waiting, silent until `chert_bridge_ready` | VERIFIED | `outbound.mjs` strict parsing; `agent.mjs` skips `waitForParticipant`, pre-publishes one audio track via `ParticipantAudioOutput`. Re-run: `agentPublishedBeforeBridge true`, `spokeBeforeReady false`, `agentAudioTracksAtEnd 1`, exit 0. Malformed outbound metadata is rejected, not treated as inbound. Unanswered job ends after a wait limit (`createDeadline`). |
| 5 | OUT-02/D-09/D-10: mealtime check-in greeting | VERIFIED | `prompt.mjs` `checkinGreeting`; log `[agent] outbound call reason=dinner_checkin` and `greeting requested kind=checkin`; reason is sanitized. The greeted audio was audible (`greeted true`). |
| 6 | Inbound unchanged (D-13c) | VERIFIED | Plain sim call exit 0, `kind=inbound`. |

**Real-call success criteria 1 and 4, and the real-cart half of criterion 2, are not verifiable here; see human verification.**

## Spot-checks and tests

- `npm test`: 129 pass, 0 fail.
- Simulated call (a): pass. Simulated calls (b) outbound and inbound: pass. No agent process left afterwards (`pgrep` empty).
- Only marker lines were read from logs; `.env.local` was passed only through `--env-file`.

## Requirements coverage

| ID | Plan | Status |
|----|------|--------|
| VID-01 | 04-01 | Satisfied in simulation; real phone pending |
| VID-02 | 04-01 | Satisfied in simulation; real cart pending |
| OUT-01 | 04-02 | Satisfied in simulation |
| OUT-02 | 04-02 | Satisfied in simulation; real outbound call pending |

No orphaned requirements: all four IDs map to Phase 4 in REQUIREMENTS.md and appear in plan frontmatter.

## Anti-patterns

No TBD, FIXME or XXX markers found in the reviewed files. No stubs in Track A code. The stubs in `actions/` (Track C) are out of scope.

## Notes

- D-15 (unchanged files) could not be checked against git here (not a git repository from this directory); no sign of changes seen in the files read.

## Gaps Summary

No gaps in Track A's code or the simulated proof. Three real-phone items remain for the person.
