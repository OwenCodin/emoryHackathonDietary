---
status: partial
phase: 04-browser-on-the-call-and-the-agent-calls-you
source: [04-VERIFICATION.md]
started: 2026-11-14T03:28:31Z
updated: 2026-11-14T03:28:31Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. The agent's picture on a real FaceTime Video call
expected: The caller sees the agent's animated picture, and the agent's voice does not stutter while the picture is showing.
result: [pending]

### 2. The browser on the call (needs Track C's real cart merged)
expected: Ask the agent to shop for something. While the cart runs the phone shows the browser and its text is readable; when the cart stops the agent's picture returns. The agent log prints "[agent] video: cart" then "[agent] video: face".
result: [pending]

### 3. A real outbound call (needs Track C's callPatient, and Chert allowing outbound calls on the line)
expected: Run Track C's check-in. The phone rings, and after answering the agent says it is checking in at mealtime and asks to see your plate. It says nothing before you are connected. The log prints "[agent] outbound call reason=..." and "greeting requested kind=checkin".
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
