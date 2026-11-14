---
phase: 04-browser-on-the-call-and-the-agent-calls-you
plan: 01
subsystem: agent
tags: [video, livekit, cart-frame, simulation]
requires:
  - phase: 03-camera-and-tools
    provides: agent.mjs, face.mjs, sim-call.mjs
provides:
  - agent video track shows Track C's cart frame when valid, cached face otherwise
  - fake cart provider and sim --expect-cart-switch check
affects: [04-02, phase-05]
tech-stack:
  added: []
  patterns: ["pure frame picker with once-per-call logging", "pre-rendered face frames plus a painted moving bar"]
key-files:
  created: [agent/video.mjs, agent/video.test.mjs, agent/sim/fake-cart.mjs, agent/sim/fake-cart.test.mjs]
  modified: [agent/face.mjs, agent/agent.mjs, agent/sim/sim-call.mjs, .env.example]
key-decisions:
  - "Fake cart is used only when AGENT_FAKE_CART is exactly '1'; fake-cart.mjs reads no environment"
  - "Blink is shown only while not speaking in the cached face frames"
requirements-completed: [VID-01, VID-02]
duration: 25min
completed: 2026-11-13
---

# Phase 4 Plan 01: Browser on the call Summary

The agent's video now carries Track C's browser frame while getCartFrame returns a Uint8Array of exactly WIDTH*HEIGHT*4 bytes, and its own pre-rendered face otherwise; the switch was proven face, cart, face on one simulated call.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | Fake cart provider and sim `--expect-cart-switch` | 440f585 |
| 2 | pickFrame/createVideoPicker, cached face frames, agent wiring, .env.example | 6722879 |
| 3 | Simulated proof (no code change) | none |

## Simulated proof

Simulated calls used in this plan: 1 of 4 (`--expect-cart-switch --seconds 20`, agent started with `AGENT_FAKE_CART=1`). Case passed first time:

`RESULT {"call":1,...,"greeted":true,"secondsFromReadyToFirstSound":0.98,"spokeBeforeReady":false,"videoSize":"1280x720","callSeconds":27.9,"videoTimeline":["face","cart","face"],"cartSwitch":true,"failed":[],"pass":true}`, `SIM_RC=0`.

Agent log markers, in order: `[agent] video: fake cart provider on (simulated proof only)`, `[agent] video: cart`, `[agent] video: face`; no `cart frame ignored` or `cart frame failed`. Step B: `pgrep -fl '[a]gent/agent.mjs'` printed nothing, no forced kill. Step C printed `NO_SECRETS` before any line was printed. `chert` and Chert's HTTP API were never used. Logs are under `$TMPDIR`, not in git.

## Deviations from Plan

- The plan's line references were out of date after commits cb16e8d to 1396e0e; I edited the current files. Per the plan corrections: `callSeconds` is now computed for every call (it appears in every RESULT line), and `callUnder45s` is pushed once, for `SCRIPTED` or `--expect-cart-switch`. The watchdog stays where d435e31 put it.
- Task 1 was committed with its tests together rather than as a separate failing-test commit (the plan itself says the end-to-end check cannot run live until Task 2).
- Step A was run from a scratch script under the session scratchpad (outside the repo, not committed).
- Not needed: the 4-call retry budget.

## Human verification remaining (real phone)

- On a real FaceTime Video call the caller sees the agent's picture at 1280x720 from the participant that speaks, and the voice does not stutter with the cached frames.
- With Track C's real cart running, the browser is visible on the phone and its text is readable.
- When the cart stops, the agent's picture returns.

## Known Stubs

`actions/getCartFrame` is still Track C's stub returning null (unchanged by design); the fake provider covers the proof only.

## Checks

`npm test`: 117 pass, 0 fail, offline. No agent process left. D-15 files identical to 70b8a21; `git status` clean apart from planning files.

## Self-Check: PASSED

Commits 440f585 and 6722879 exist; all created files are present.
