# Phase 1: Scaffold and stubs - Context

**Gathered:** 2026-11-13
**Status:** Ready for planning
**Source:** PRD Express Path (agent/README.md — the shared contract and Track A guide)

<domain>
## Phase Boundary

Deliver the root scaffold every track branches from: one root package, the shared video constants, Chert's video starter placed in `agent/` and booting, and stub versions of every cross-track function. After this phase `npm install && npm start` starts the agent process from a fresh clone and `npm test` proves every stub returns the contract's shapes. No real FaceTime call, no real model session, no LiveKit or Gemini keys are needed to finish it.

Not in this phase: choosing or proving the voice model on a call (Phase 2), reading the caller's camera (Phase 3), the full tool set (Phase 3), showing cart frames (Phase 4), outbound entry (Phase 4).

</domain>

<decisions>
## Implementation Decisions

### Root package
- D-01: Create the root `package.json` exactly as given in the "Stack and layout" section of `agent/README.md`: `"private": true`, `"type": "module"`, the `engines` range, scripts `start` = `node --env-file=.env.local agent/agent.mjs start` and `test` = `node --env-file-if-exists=.env.local --test`, and the eight dependencies at the stated versions (`@livekit/agents` 1.8.0, `@livekit/agents-plugin-google` 1.8.0, `@livekit/rtc-node` 0.13.35 pinned exactly). Commit `package-lock.json`.
- D-02: Create root `.env.example` listing every variable in the contract's environment table with placeholder values only (LiveKit placeholders in the starter's `YOUR_` form so `chert-rooms.mjs` treats them as unset), and root `.gitignore` containing `node_modules/`, `.env`, `.env.*`, `!.env.example`, `*.log`, `.DS_Store`, `actions/.browser-profile/`.

### Shared constants
- D-03: Create `shared/video.mjs` exporting `WIDTH = 1280`, `HEIGHT = 720`, `FPS = 15`. No other file defines the video size or rate; `agent/face.mjs` and `agent/agent.mjs` import them from there.

### Agent starter
- D-04: Generate Chert's video starter outside the repo with `npx --yes @trychert/facetime@0.1.0-beta.20 new <temp dir> --video` and copy `agent.mjs`, `greet.mjs`, `chert-rooms.mjs`, `face.mjs` into `agent/`. `greet.mjs` and `chert-rooms.mjs` stay byte-for-byte unchanged. Do not copy the starter's `package.json`, `.env.local`, `.env.example`, `.gitignore`, `README.md`, `AGENTS.md` or `CLAUDE.md`. Do not overwrite the existing `agent/README.md`.
- D-05: In `agent/agent.mjs` replace the OpenAI realtime import and model with `import * as google from '@livekit/agents-plugin-google'` and `new google.realtime.RealtimeModel({ model: process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live', voice: 'Puck' })`, so the process does not import a package that is not installed. Add `GEMINI_LIVE_MODEL` to `.env.example` as an optional variable. Whether that model works on a call is Phase 2's job; this phase only requires the process to start.
- D-06: Keep the starter's call behaviour otherwise unchanged in this phase: join, `waitForParticipant`, publish one camera track, greet on `chert_bridge_ready` through `greet.mjs`, `videoEnabled: false`. Replace the study-partner instructions and greeting with a short renal-dietitian placeholder that says it is an AI and follows limits set by the caller's care team.
- D-07: Add `agent/tools.mjs` exporting `buildTools({ patientId })` with exactly one tool in this phase, `check_food` (`name: string`, `grams: number | null`), which calls the `renal` stub's `getProfile` and `checkFood`. Pass it to `new voice.Agent({ instructions, tools })`. This proves the agent → renal import path end to end; the remaining tools belong to Phase 3.

### Stubs
- D-08: Create `renal/index.mjs` exporting `getProfile`, `describeImage`, `checkFood`, `suggestMeals`, `logFood`, `getToday`, and `actions/index.mjs` exporting `startCart`, `getCartStatus`, `getCartFrame`, `stopCart`, `callPatient`, `sendText`, with the exact names, argument objects and return shapes in the "Types" and "The hand-offs" sections of `agent/README.md`. Every function is `async` except `getCartFrame` (synchronous, returns `null`), never throws, uses no network, and returns `ok: true` canned data. Each stub file starts with a comment saying it is a stub that Track B or Track C replaces.
- D-09: Do not edit `renal/README.md` or `actions/README.md`, and add nothing else under `renal/` or `actions/`.

### Proof
- D-10: Add `agent/contract.test.mjs` (Node's built-in `node:test`) that calls every stub function and asserts the contract shape of each result, including that `getCartFrame()` returns `null` and that no call throws or needs the network. `npm test` exits 0.
- D-11: `npm start` must stay running without LiveKit keys: with placeholder LiveKit values the starter prints that it is waiting for `chert dev`. A missing `GOOGLE_API_KEY` must not crash the process at import or startup.
- D-12: Add a short "Getting started" section to the root `README.md`: Node version, `npm install`, `cp .env.example .env.local`, `npm start`, `npm test`, and a pointer to the three track READMEs. Keep the existing title line.

### Claude's Discretion
- The canned values inside the stubs, as long as they match the contract shapes (reuse the README's examples).
- Internal structure of the test file.
- Whether `face.mjs` keeps the per-pixel drawing or caches frames, as long as it draws at the shared WIDTH and HEIGHT.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Contract and track guide
- `agent/README.md` — the shared contract (layout, root package.json, environment variables, types, hand-off functions, verified and unverified facts) and Track A's order of work and Chert rules

### Project
- `.planning/PROJECT.md` — constraints, key decisions, findings
- `.planning/REQUIREMENTS.md` — SCAF-01 to SCAF-04
- `.planning/ROADMAP.md` — Phase 1 goal and success criteria
- `CLAUDE.md` — project guide

### External
- Chert's video starter, generated with `npx --yes @trychert/facetime@0.1.0-beta.20 new <temp dir> --video` — the source of the four agent files; its `AGENTS.md` lists Chert's rules

</canonical_refs>

<specifics>
## Specific Ideas

- This is a Node ES-module project with no web UI, no database and no deployment. For Walking Skeleton purposes the thinnest end-to-end slice is: `npm start` boots the agent process, which imports `shared/video.mjs`, builds its tools from the `renal` stub, and waits for a call; `npm test` exercises both stub modules.
- Secrets: never create `.env.local` with real values, never print or commit keys. A local `.env.local` copied from `.env.example` with placeholders is fine and is git-ignored.
- All work is on the `agent` branch. Do not switch, create or push branches. Merging to `main` is the person's decision after the phase.
- The repo is shared with two teammates; keep the scaffold boring and exactly as the contract states so their branches match it.

</specifics>

<deferred>
## Deferred Ideas

- Proving a Gemini Live model on a real call, and the OpenAI fallback — Phase 2
- Camera snapshots and the remaining tools — Phase 3
- Cart frames on the video track, outbound entry path — Phase 4

</deferred>

---

*Phase: 01-scaffold-and-stubs*
*Context gathered: 2026-11-13 via PRD Express Path*
