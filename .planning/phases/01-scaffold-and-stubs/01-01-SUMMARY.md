---
phase: 01-scaffold-and-stubs
plan: 01
subsystem: scaffold
tags: [livekit, chert, gemini, node-test, stubs]
requires: []
provides:
  - root package (pinned LiveKit 1.8.0 / rtc-node 0.13.35) with lockfile
  - shared/video.mjs (WIDTH 1280, HEIGHT 720, FPS 15)
  - renal and actions stubs matching the shared contract
  - agent process (Chert video starter on Gemini) with check_food tool
affects: [all later phases, Track B, Track C]
tech-stack:
  added: ["@livekit/agents 1.8.0", "@livekit/agents-plugin-google 1.8.0", "@livekit/rtc-node 0.13.35", "zod", "sharp", "playwright", "@google/genai", "livekit-server-sdk"]
  patterns: ["contract functions: async, one object argument, never throw", "anonymous llm.tool entries keyed by name"]
key-files:
  created: [package.json, package-lock.json, .env.example, shared/video.mjs, renal/index.mjs, actions/index.mjs, agent/tools.mjs, agent/agent.mjs, agent/greet.mjs, agent/chert-rooms.mjs, agent/face.mjs, agent/contract.test.mjs]
  modified: [README.md]
key-decisions:
  - "face.mjs pixel offsets scaled by HEIGHT/360 to keep proportions at 1280x720"
  - ".gitignore already matched the plan and was left unchanged"
requirements-completed: [SCAF-01, SCAF-02, SCAF-03, SCAF-04]
duration: ~15 min
completed: 2026-11-13
---

# Phase 1 Plan 01: Scaffold and stubs Summary

Root scaffold for the renal-dietitian voice agent: pinned LiveKit packages, Chert's video starter switched to Gemini Live, shared video constants, contract-shaped offline stubs for renal and actions, and a 13-test contract suite.

## Tasks

| Task | Commit | Result |
|---|---|---|
| 1 RED: package, env template, failing test | e577ce4 | npm test failed with ERR_MODULE_NOT_FOUND |
| 2 GREEN: video constants, stubs, check_food | 0732eb4 | 12 tests pass |
| 3 Starter wired, README | d521ec2 | 13 tests pass, bounded start check OK |

## Verification

- Installed versions: @livekit/agents 1.8.0, @livekit/agents-plugin-google 1.8.0, @livekit/rtc-node 0.13.35.
- `npm test`: 13 tests, 13 pass, 0 fail.
- Bounded `npm start` (placeholder LiveKit, blank GOOGLE_API_KEY, temp CHERT_HOME, 20 s, process group killed) printed:
  - `[chert] No LiveKit keys: "renal-dietitian" takes calls in Chert rooms through chert dev.`
  - `[chert] Waiting for chert dev. Run it in this folder: chert dev`
  - No agent process left running.
- greet.mjs and chert-rooms.mjs sha256 match the plan's values. WIDTH/HEIGHT/FPS are assigned only in shared/video.mjs. The three track READMEs are unchanged. `.env.local` was never read.

## Deviations from Plan

- **[Plan ordering] Face-size test moved to Task 3.** Task 1's test initially imported face.mjs, which would have kept Task 2 from going green; the test was added in Task 3 as the plan specified.
- The plan's acceptance checks reference commit 0d16bb2 for README diffs; that commit is not in this history, so unchanged-ness was verified against the phase's start commit instead.

## Known Stubs

renal/index.mjs and actions/index.mjs are intentional canned-data stubs; Tracks B and C replace them. The agent prompt is a placeholder until a later phase.

## Next steps for the person

Put real LiveKit and Gemini keys in `.env.local`, and decide on the merge to `main` before Phase 2. Whether `gemini-3.8-live` works with plugin 1.8.0 on a real call is Phase 2's job.

## Self-Check: PASSED
