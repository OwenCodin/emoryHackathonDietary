---
phase: quick-261114-sr6
plan: 01
subsystem: agent
tags: [chert, identity, texting, setup]
requires: [quick-261114-sks]
provides: [per-caller identity behind AGENT_OPEN_ACCESS, check_text_received, call-scoped sendText allow]
key-files:
  created: [actions/caller.mjs, actions/caller.test.mjs, agent/caller.mjs, agent/caller.test.mjs]
  modified: [actions/text.mjs, actions/text.test.mjs, actions/index.mjs, agent/fake-modules.mjs, agent/prompt.mjs, agent/prompt.test.mjs, agent/tools.mjs, agent/tools.test.mjs, agent/agent.mjs, renal/profile.mjs, renal/profile.test.mjs, .env.example, README.md, agent/README.md]
metrics:
  completed: 2026-11-14
---

# Phase quick-261114-sr6 Plan 01: Per-caller identity Summary

With `AGENT_OPEN_ACCESS=1`, each inbound caller is identified from Chert's call record (1.5 s cap, never throws), gets their own patient id, can be texted at their own number only, and gets a skippable text-first setup step; with the flag unset every call is the demo patient exactly as before.

## Commits
- 1f56605: Chert caller lookup, call-scoped sendText `allow`, reply_window_closed code, hasRecentInboundText
- 5dc1010: text_first setup step, check_text_received tool, texting_refused wording
- 2dca2b4: resolveCaller, getProfile fallback for p/g ids, agent.mjs wiring, docs

## Flag-off verification
- `instructions` and `buildInstructions({}, {})` are byte-identical to the base string (compared against a capture taken before the edit).
- Default `buildTools` key list unchanged (existing deepEqual test green); `sendText` receives exactly `{ phone, text }` (tested).
- `resolveCaller` returns demo with zero lookups when the flag is not `1` (tested with unset, empty and `0`).

## Deviations from Plan

1. **[Rule 3] text_first line shortened to 12 words.** The plan's wording pushed SETUP_STEPS to 320 words (test limit 300); the base was already about 288. Now "Please text hello to this number, then tell me, or say skip."
2. **[Demo safety] Reply-window refusal wording only when `textAllow` is set.** The plan applied `texting_refused` to text_recipe / text_cart_link / text_list for any 403. That would change the demo phone's failure wording (`text_failed` / `tool_failed`), so it is gated on per-caller texting. text_kroger_sign_in already mapped 403 for everyone and still does; it also accepts the `reply_window_closed` code.
3. `createCallerLookup` and `createInboundCheck` return the function itself (not an object with a method); the module-level `getCallerPhone` / `hasRecentInboundText` wrap a fresh instance per call so env is read per call.
4. One extra log line `[agent] caller kind=<kind>` appears on every call, including flag-off (kind only, no identifiers).

## Known Stubs
None.

## Self-Check: PASSED
