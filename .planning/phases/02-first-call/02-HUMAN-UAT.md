---
status: partial
phase: 02-first-call
source: [02-VERIFICATION.md]
started: 2026-11-14T02:36:20Z
updated: 2026-11-14T02:36:20Z
---

## Current Test

[awaiting human testing]

## How to run these

Terminal 1, repo root: `npm start` and wait for "registered worker".
Terminal 2, repo root: `npx @trychert/facetime@0.1.0-beta.20 dev` and wait for the waiting-room message. Stop it with Ctrl+C only.
Then call the line with FaceTime Video. Each call is capped at 5 minutes and draws on the shared 49 trial minutes; these six checks fit in two short calls.

## Tests

### 1. CALL-01: a real FaceTime Video call to the line is answered
expected: The call connects and the agent's picture appears; `chert dev` prints call_accepted and the agent log prints "[agent] call joined".
result: [pending]

### 2. CALL-02: the greeting is heard in time
expected: Within 10 seconds of FaceTime connecting, the agent speaks first; nothing is said before FaceTime is ready and the call is not dropped for silence.
result: [pending]

### 3. CALL-03: a spoken two-way conversation works
expected: Ask two or three questions; the agent answers each in one or two short sentences as a renal dietitian, on the gemini-3.8-live voice.
result: [pending]

### 4. CALL-04: the care-team line is said once
expected: The greeting says it is an AI, follows the limits set by your care team and does not replace them; it is not repeated in every reply.
result: [pending]

### 5. CALL-05: a second call works
expected: Hang up, wait for `chert dev` to show the line free, call again; it is answered and greeted the same way.
result: [pending]

### 6. A spoken food question reaches the tool
expected: Say "can I eat a banana?"; the agent log prints "[agent] tool check_food ok=true" and the agent answers (with placeholder wording until Track B's module is merged).
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps
