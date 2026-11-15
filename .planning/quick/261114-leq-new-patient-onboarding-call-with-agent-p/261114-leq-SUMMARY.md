---
phase: quick-261114-leq
plan: 01
subsystem: agent, renal
tags: [onboarding, profile, voice, safety]
key-files:
  created: [agent/prefs.mjs, agent/onboarding.test.mjs, agent/prefs.test.mjs, renal/profile.test.mjs, agent/sim/onboarding-run.mjs, agent/sim/reset-setup.mjs]
  modified: [renal/profile.mjs, renal/index.mjs, renal/diary.mjs, agent/tools.mjs, agent/memory.mjs, agent/prompt.mjs, agent/agent.mjs, agent/fake-modules.mjs]
metrics:
  completed: 2026-11-14
  tests: 557 pass, 0 fail (505 on base)
---

# Quick 261114-leq: First-call patient setup Summary

First-call setup where the caller reads out their own limits, confirmed in two steps enforced in code, saved per patient outside the repo, with stored voice and style applied from the next call.

## Commits
- 7d224b0 feat(renal): saved profile store with strict validation
- c2e8606 feat(agent): setup tools, two-step confirmation, preferences (also contains the prompt changes, see deviations)
- 1e0c8a3 feat(agent): setup greeting, voice at session start, sim scripts
- c7f57b5 docs: three READMEs, README.md, .env.example

## Run-through output (node agent/sim/onboarding-run.mjs)
Stored profile: name Ana, hemodialysis, limits 2000/2000/1000/1000, avoid grapefruit, setBy "patient, as told by their care team", setOn 2026-11-14, source patient.
Stored preferences: voice Sulafat, replyStyle brief, language en, name Ana. Next-call options: voice Sulafat.
Spoken length: agent words 297, caller words 69, estimate 164 s. Below the 180 s lower target (FAIL against 180-300 s); well under the 240 s warning. Reported plainly, script not padded.

## Deviations
- The prompt changes (prompt.mjs, prompt.test.mjs) went in the second commit rather than the third, because an existing test requires the prompt to name every tool.
- Implementation was written before the tests for Tasks 1 and 2 (tests written right after, all pass), not strict RED first.
- Not cut: Spanish and reply style are both in.

## Unproven live
Voice on next call, transcription timing for the confirm check, Spanish.

## Self-Check: PASSED
