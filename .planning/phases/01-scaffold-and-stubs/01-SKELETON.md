# Walking Skeleton — emoryHackathonDietary (Track A, the call)

**Phase:** 1
**Generated:** 2026-11-13

## Capability Proven End-to-End

A teammate runs `npm install` and `npm start` in a fresh clone, and the agent process boots. It imports `shared/video.mjs`, builds its `check_food` tool from the `renal` stub, and waits for `chert dev`. `npm test` then calls every `renal` and `actions` contract function, and `check_food` itself, and gets contract-shaped answers with no network and no keys.

This project is a Node voice agent behind a FaceTime bridge. Its "full stack" is: process start, agent entry, tool, cross-track module, and shared constants. A real call is Phase 2.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runtime and module system | Node 24 (22.23.2+ works), ES modules, `.mjs` files, one root `package.json` | Locked by the shared contract in `agent/README.md`. One install and one `.env.local` for three tracks |
| Agent framework | Chert's video starter on `@livekit/agents` 1.8.0, `@livekit/rtc-node` 0.13.35 (pinned exactly) | The only versions Chert's starter has been run against. 1.10.0 needs rtc-node 1.x |
| Call transport | `agent/chert-rooms.mjs` + `agent/greet.mjs`, copied byte-for-byte from `@trychert/facetime@0.1.0-beta.20` | With no LiveKit keys it takes calls through `chert dev`. With keys it registers with our LiveKit project. Greeting fires only on `chert_bridge_ready` |
| Voice model | `@livekit/agents-plugin-google` 1.8.0 `realtime.RealtimeModel`, model from `GEMINI_LIVE_MODEL` (default `gemini-3.8-live`), voice `Puck` | Gemini track requirement. Whether this model works on a call is decided in Phase 2 (fallbacks `gemini-3.1-flash-live-preview`, then OpenAI Realtime) |
| Cross-track boundary | `renal/index.mjs` (Track B) and `actions/index.mjs` (Track C), imported only from `agent/tools.mjs`. Plain-object in and out, async (except sync `getCartFrame`), never throw, `ok: true/false` | Lets three people work in parallel. Stubs ship now and real modules replace them with the same exports |
| Tools | `buildTools({ patientId })` returns an object of anonymous `llm.tool(...)` values keyed by tool name, passed to `new voice.Agent({ instructions, tools })` | `@livekit/agents` 1.8.0 rejects named tools in an object. `execute` can be called directly in tests |
| Video size | `shared/video.mjs`: `WIDTH` 1280, `HEIGHT` 720, `FPS` 15; defined nowhere else | The agent's face, the cart browser frames (Track C) and the `VideoSource` must agree byte for byte |
| Configuration and secrets | `.env.local` at the root, loaded by `node --env-file` (start) / `--env-file-if-exists` (test); `.env.example` holds placeholders; `.gitignore` covers `.env*` and `actions/.browser-profile/` | Keys never reach git or chat. Placeholder `YOUR_` LiveKit values route to Chert rooms |
| Tests | Node's built-in `node:test` via `npm test` (auto-discovers `**/*.test.mjs`); first file `agent/contract.test.mjs` | No extra tooling. Each track adds its own `*.test.mjs` |
| Directory layout | `agent/` (Track A), `renal/` (Track B), `actions/` (Track C), `shared/` (constants all tracks read) | Each track owns one folder and does not edit the others |

## Stack Touched in Phase 1

- [x] Project scaffold: root `package.json`, pinned deps, `package-lock.json`, `node:test` runner
- [ ] Routing: **does not apply.** There is no HTTP server or web route. The "route" into the system is a FaceTime call delivered by `chert dev` to `agent/agent.mjs`'s `entry`, which this phase boots and leaves waiting
- [ ] Database: **does not apply.** There is no database in this project. Patient profile and day totals live behind `renal/` (Track B), and in-memory shopping state comes in Phase 5. The skeleton's real read is the `check_food` tool reading `getProfile` and `checkFood` through the cross-track boundary
- [ ] UI: **does not apply.** There is no app or web page by design ("no app, just FaceTime"). The patient-facing surface is the call's voice and the published video track. The agent publishes its face at the shared size once a call arrives (Phase 2 proves it on a call)
- [x] Run command: `npm start` (documented in the root README). It boots and waits for `chert dev` without keys. Deployment **does not apply**: the agent runs on Track A's laptop next to `chert dev` for the whole hackathon

## Out of Scope (Deferred to Later Slices)

- A real FaceTime call, the voice-model choice and its fallbacks, and the care-team line heard on a call (Phase 2)
- Reading the caller's camera (`agent/camera.mjs`), the `PLAYGROUND=1` path, and the other seven tools (Phase 3)
- Moving the instructions into `agent/prompt.mjs` (Phase 3, with the real persona and the one-sentence verdict rule)
- Showing cart frames from `getCartFrame()` on the video track, and the outbound entry path (Phase 4)
- Shopping list memory across calls and the four-minute warning (Phase 5)
- Real `renal/` and `actions/` logic: owned by Tracks B and C and merged behind the same exports
- Any database, web UI, auth or deployment target

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without changing its decisions:

- Phase 2: a patient FaceTimes the line, is greeted on `chert_bridge_ready` within 10 seconds, and talks with the dietitian on the chosen voice model, twice in a row
- Phase 3: the patient shows or names food and hears a one-sentence verdict tied to their limits (camera snapshots, all tools, against stubs then real Track B/C modules)
- Phase 4: the patient sees the shopping browser on the call while a cart fills, and an outbound mealtime call greets them
- Phase 5: the patient points at a shelf and hears the best choice, and a callback continues the same list
