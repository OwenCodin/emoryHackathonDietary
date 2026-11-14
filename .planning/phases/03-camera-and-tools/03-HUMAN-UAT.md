---
status: partial
phase: 03-camera-and-tools
source: [03-VERIFICATION.md]
started: 2026-11-14T03:16:17Z
updated: 2026-11-14T03:16:17Z
---

## Current Test

[awaiting human testing]

## How to run these

First ask Chert staff whether caller capture (the agent receiving your camera) is enabled on the line; without it tests 1 to 3 cannot pass.
Terminal 1, repo root: `AGENT_DEBUG_FRAME_DIR=$HOME/renal-debug-frames npm start` (the folder must be outside the repo).
Terminal 2, repo root: `npx @trychert/facetime@0.1.0-beta.20 dev`. Then call the line with FaceTime Video.
Verdict wording is placeholder text until Track B's `renal/` module is merged.

## Tests

### 1. A label held to the phone camera gets a spoken verdict
expected: Ask "Can I eat this?" with a nutrition label in view. Within about 8 seconds the agent answers in one sentence starting with Yes, No, Small portion or I can't tell; the agent log prints "[agent] tool look_at_camera ok=true".
result: [pending]

### 2. Camera off: the agent says it cannot see
expected: Turn the phone camera off and ask again. The agent says it cannot see the camera and asks you to turn it on or name the food; it does not describe any food. The log prints "[agent] tool look_at_camera ok=false".
result: [pending]

### 3. The saved frame shows what the phone showed
expected: Open the newest JPEG in the debug folder. It shows what the phone camera was pointed at. Note whether FaceTime's own controls or your self-preview appear in the picture.
result: [pending]

### 4. Playground path
expected: Start the agent with PLAYGROUND=1 and AGENT_DEBUG_FRAME_DIR set, join from LiveKit's Agents Playground with a webcam, ask it to look. A JPEG is saved and a verdict is spoken.
result: [pending]

### 5. The other tools by real voice
expected: Ask what to cook from what it saw, say you ate one of the foods and ask what is left today, ask it to shop for the missing items, ask for the cart status, then ask for the link by text. Each gets a short spoken answer; the link is only texted once a cart is finished; nothing is paid for.
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
