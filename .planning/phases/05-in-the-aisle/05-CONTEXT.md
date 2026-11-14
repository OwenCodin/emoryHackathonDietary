# Phase 5: In the aisle - Context

**Gathered:** 2026-11-14
**Status:** Ready for planning
**Source:** PRD Express Path (agent/README.md — "In the aisle (twist 4)")

<domain>
## Phase Boundary

Make the agent usable while shopping in a store, where calls are capped at 5 minutes on the trial. Four things: a spoken question always gets an answer (a dropped-reply fault found in simulated calls is fixed); pointing at a shelf gets "this one is the best choice"; a shopping list and what has been approved survive a hangup so a call back carries on; and the agent warns at about four minutes that the call will end and asks for a call back. All proven without a phone using unit tests and the simulated caller.

Not in this phase: anything in `renal/` or `actions/`; recognising different patients (one demo patient); continuous camera watching.

</domain>

<decisions>
## Implementation Decisions

### Shelf comparison (AISL-01)
- D-01: When `look_at_camera` gets a `Seen` with `kind: 'shelf'` and two or more foods, it still checks each food (up to 6) and additionally returns `best`: the food to choose. Ranking is a pure exported function over the contract `Verdict` objects: verdict order `ok`, then `limit`, then `unknown`, then `avoid`; ties are broken by the lowest largest share of a daily limit among sodium, potassium and phosphorus when `nutrients` and the profile limits are available, otherwise by the order seen. If every food is `avoid`, `best` is `null`.
- D-02: For a shelf the tool result's first `spoken` sentence names the best choice by name, for example "Yes, the unsalted broth is the best choice here." followed by at most one short sentence about why; when `best` is `null` it says none of the items in view fit and offers to look at another shelf. The per-food results stay available but the prompt tells the model to lead with the best choice and not read out every item.
- D-03: Update `agent/prompt.mjs`: in a store, replies are one sentence, verdict word first; for a shelf, say which product to pick by name; never invent a product that was not in the tool result.

### Memory across calls (AISL-02)
- D-04: Add `agent/memory.mjs`: a small store keyed by `patientId` holding `{ needed: string[], approved: string[], rejected: string[], updatedAt }`. Each call runs in its own process, so the store is a JSON file, one per patient, in the directory `process.env.AGENT_STATE_DIR` or, when unset, a folder named `renal-agent-state` under the operating system's temporary directory (never inside the repo). Writes go to a temporary file and are renamed into place; files are created with mode 600. State older than 2 hours is ignored and overwritten. A corrupt or unreadable file is treated as empty and never crashes a call. `patientId` is reduced to letters, digits, `-` and `_` before it is used in a file name.
- D-05: The store holds food and product names only: no phone numbers, no limits, no transcripts.
- D-06: New tools in `agent/tools.mjs`, same rules as the existing ones (no `name` option, never throw, small results, `[agent] tool <name> ok=<bool>` log line):
  - `add_to_shopping_list` (`items: string[]`, 1 to 20 names, each trimmed and at most 80 characters): adds to `needed` without duplicates (case-insensitive).
  - `shopping_list` (no parameters): returns `needed`, `approved`, `rejected`.
  - `mark_item` (`name: string`, `status: 'approved' | 'rejected'`): moves the item between the lists; an approved item leaves `needed`.
  - `suggest_meal` also adds its meals' `missing` item names to `needed`.
  - `start_cart` with an empty `items` array uses the remembered `needed` list when the last suggested meal has no missing items.
- D-07: At the start of a call, if the store has fresh state with anything in `needed` or `approved`, the greeting adds one short sentence that it remembers the shopping list and how many items are left. Implement as a third greeting builder in `agent/prompt.mjs` (inbound resume), keeping the AI and care-team line. With no fresh state the Phase 2 greeting is used unchanged.

### Time warning (AISL-03)
- D-08: About four minutes after `chert_bridge_ready`, the agent says once, in one sentence, that this call will end in about a minute because of a time limit and asks the caller to call back, adding that it will remember their list. The delay is `Number(process.env.AGENT_CALL_WARN_SECONDS) || 240`. The timer starts when the greeting is requested, is cleared on shutdown, fires at most once per call, applies to inbound and outbound calls, and logs `[agent] time warning requested`. A failure to speak it is logged as `[agent] time warning failed` and does not end the call.
- D-09: Add `AGENT_STATE_DIR` and `AGENT_CALL_WARN_SECONDS` to `.env.example` as optional, empty variables with comments.

### Dropped replies (found on 14 November)
- D-15: Finding. In roughly one simulated call in four, a spoken question got no answer. The debug log of a failed call shows the model starting its reply, then a second `onInputSpeechStarted` from Gemini's server-side voice detection in the same instant, then `Aborting all realtime generation tasks due to interruption`, and no new generation afterwards. The caller's audio was received; the reply was cancelled as an interruption and never restarted.
- D-16: Turn off barge-in by default. Construct the Gemini model with `realtimeInputConfig` set so that caller activity does not interrupt a reply in progress (`activityHandling` set to the no-interruption value exported by `@google/genai`; check the exact names in `node_modules/@livekit/agents-plugin-google/dist/realtime/realtime_api.d.ts` and `node_modules/@google/genai`). When `process.env.AGENT_ALLOW_BARGE_IN === '1'` the default interrupting behaviour is kept. Add the variable to `.env.example` as optional and empty. Replies are one or two sentences, and a store is noisy, so not being interruptible is the better default.
- D-17: Reply watchdog. When the caller stops speaking and, within 6 seconds, the agent has neither started speaking nor run a tool, call `session.generateReply` once with an instruction to answer the caller's last question now or, if it was not caught, to ask them to repeat it. At most one nudge per caller turn and three per call; never while the agent is speaking or a tool is running; never before the greeting. Log `[agent] reply nudge`. Use the session's user-state and agent-state events from `@livekit/agents` 1.8.0 (check the installed type definitions for the exact event names). The decision logic is a small pure function with an injected clock so it can be unit tested.
- D-18: Proof. With the agent running normally, six simulated calls each with `--say "Can I eat a banana?"` and `--seconds 22`: every call must show the agent replying (directly or after a nudge) and `[agent] tool check_food ok=true`. Report how many needed a nudge. These six calls are in addition to the budget in D-13, making 14 simulated calls for the phase.

### Proof
- D-10: Unit tests (offline, part of `npm test`): the ranking function (ok beats limit beats unknown beats avoid; tie broken by nutrient share; all avoid gives `null`); `look_at_camera` on a shelf using an injected fake `renal` module; the memory store (add without duplicates, mark, 2 hour expiry with an injected clock, corrupt file treated as empty, unsafe `patientId` sanitised, file mode 600); the three list tools; the resume greeting chosen only when fresh state exists. `npm test` exits 0 with no network and writes only under a temporary directory.
- D-11: Simulated proof against one running agent started with `AGENT_STATE_DIR` set to a new temporary directory: call 1 with `--say "Please add unsalted chicken broth and white rice to my shopping list."` after which the agent log contains `[agent] tool add_to_shopping_list ok=true` and the state file lists both items; then call 2 (a new call to the same agent) with `--say "What is on my shopping list?"` after which the log contains `[agent] tool shopping_list ok=true` and a greeting line showing the resume greeting was used.
- D-12: Simulated proof of the warning: with the agent started with `AGENT_CALL_WARN_SECONDS=10`, a call with `--seconds 24` after which the agent log contains `[agent] time warning requested` and the simulated caller's result shows agent speech both for the greeting and again after the ten second mark.

### Guard rails
- D-13: The executor may run at most 8 simulated calls of at most 45 seconds each, passing keys only through `--env-file=.env.local`. It must never read, print, copy or edit `.env.local`, never run `chert dev` or touch the FaceTime line, keep logs and state outside the repo, scan kept log lines for secrets before printing any, and stop every agent process it starts.
- D-14: `agent/greet.mjs`, `agent/chert-rooms.mjs`, `package.json`, the stubs in `renal/` and `actions/`, and the three track READMEs stay unchanged.

### Claude's Discretion
- Exact wording of the warning, the resume sentence and the shelf sentences.
- File layout inside the state directory beyond one JSON file per patient.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `/private/tmp/claude-501/-Users-ptrczx-Desktop/a0a663c5-84c0-4c14-b44c-8af38014aa92/scratchpad/dbg/agent.log` — debug log of a failed and a successful spoken call (search for `Aborting all realtime generation tasks`); read it only with grep for message names, never print it whole
- `agent/README.md` — "In the aisle (twist 4)", the shared contract types (`Seen`, `Verdict`, `Profile`), rules for tools
- `agent/agent.mjs`, `agent/tools.mjs`, `agent/prompt.mjs`, `agent/camera.mjs`, `agent/sim/sim-call.mjs`, `agent/tools.test.mjs` — current code after Phases 3 and 4
- `.planning/phases/03-camera-and-tools/*-SUMMARY.md` and `.planning/phases/04-browser-on-the-call-and-the-agent-calls-you/*-SUMMARY.md` — how tools are built and tested, how the simulated caller is run
- `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md` (AISL-01 to AISL-03), `.planning/ROADMAP.md` (Phase 5), `CLAUDE.md`

</canonical_refs>

<specifics>
## Specific Ideas

- Each LiveKit job (call) runs in a separate process, which is why the store is a file rather than a module-level variable.
- The `renal` stub's `describeImage` always returns a plate, so the shelf path cannot be exercised through a simulated call until Track B's module is merged; the unit tests with an injected fake module are the proof, and the real behaviour is a human verification item.
- Human verification items, none of them gaps: on a real call in a store, pointing at a shelf gets a single best-choice sentence that is audible over background noise; after hanging up and calling back within two hours the agent mentions the remembered list; at about four minutes the warning is heard before the trial's five minute cut-off.
- All work is on the `agent` branch. Do not switch, create, merge or push branches. The person is asleep; nothing may need a human.

</specifics>

<deferred>
## Deferred Ideas

- Recognising who is calling and keeping separate lists per patient
- Syncing the list to the cart automatically without being asked

</deferred>

---

*Phase: 05-in-the-aisle*
*Context gathered: 2026-11-14 via PRD Express Path*
