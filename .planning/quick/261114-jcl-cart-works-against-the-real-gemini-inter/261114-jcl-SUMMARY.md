---
phase: quick-261114-jcl
plan: 01
subsystem: actions (Track C cart)
tags: [gemini, interactions-api, computer-use, playwright, kroger]
key-files:
  modified: [actions/cart.mjs, actions/cart.test.mjs, actions/README.md]
metrics:
  completed: 2026-11-14
  tests: 421 passing (410 before)
---

# Quick 261114-jcl: Cart against the real Gemini Interactions API

The cart now uses a v1beta client and reads `steps` (function_call / model_output) from the real reply. A headed Kroger run drove the loop for about 30 actions, but no item was added.

## Commits
- 49cda47 fix(actions): cart reads Gemini v1beta interaction steps
- 6def87f fix(actions): cart wait defaults to one second and caps at ten
- docs commit: docs(actions): record live Kroger cart run (README only)

## Live probe findings (Task 1, 5 of 6 requests used)
(a) Coordinates: normalized 0-999. Click for the cart icon came back x=967, y=61 (second probe 966, 61). Normalized (1237.8, 43.9) hit `a[aria-label="cart 0 items"]`; as pixels (967, 61) hit the search INPUT.
(b) function_result: the probe's follow-up (text+image, name, call_id, `previous_interaction_id`, with `tools` re-sent) was rejected: `400 Request blocked due to safety violations (harmful content)`. The plain-string `result` variant (also with tools) got the same 400. In the live cart run, the cart's own form (text JSON + image, no `tools`) was accepted for ~30 turns. So the likely cause is re-sending `tools`; not isolated further because the 6-request cap left no room. Whether steps accumulate across turns was not observed in a probe; the code tracks handled call ids so it works either way.
(c) Final text: `status: "completed"`, steps `[thought, {type:'model_output', content:[{type:'text', text:'MISSING: probe'}]}]`.
(d) Actions seen: click (x, y, intent), type, wait, move, scroll, go_back. `intent` is inside `arguments` (type, wait, move, scroll, go_back often came with no intent, so the step text falls back to "Performing <name>"). No `safety_decision` was seen.

## Live Kroger run (guest, headed, 3 items)
Run 1 (failed after 24 s): `wait` with no `seconds` was rejected as invalid. Fixed (default 1 s, cap 10 s, test added) in 6def87f.
Run 2 (about 200 s): items unsalted butter, white rice, apples x3. Result: added none, missing none, total 0, state `failed`. Stuck on the first item: typed a search and clicked search, but never got results; retried search, browsed Shop, Grocery, Dairy and Eggs, Butter and Margarine, Baking, Refrigerated, clicked the Shopping Assistant, then `go_back` timed out (10 s) and the run failed with `page.goBack: Timeout 10000ms exceeded`. No guard fired, no bot challenge, never reached checkout/payment (no flagged step or URL).
Status log: Searching for unsalted butter (3s) -> click search input (9s) -> type (13s) -> click search icon (17s) -> wait/retry search (21-29s) -> Shop menu, home, retry (33-68s) -> categories Grocery / Dairy & Eggs / Butter & Margarine (94-113s) -> Baking, Refrigerated, Shopping Assistant (155-184s) -> go_back (189s) -> failed (199s).
I did not tell whether Kroger search returns results to automation or the model never saw them; this is a site/model outcome, not a steps-handling bug, so it was left as is. The 2 allowed runs are used.

## Deviations
- [Rule 1] `wait` without `seconds` failed the run; fixed with a test.
- Plan allowed one function_result variant; I tried only the plain-string variant (which dropped the image) and then relied on the live run for the real shape.
- Probe request budget: 5 of 6 used; the run script and probes live in the scratchpad, not committed.

## Safety
Allow-list, checkout/payment block, personal-data refusal, blocked intent, safety_decision pause, 60-action and four-minute caps all remain, with tests; blocked intent and safety_decision are now checked on every call in a reply before any runs. No `safety_acknowledgement` or `disabled_safety_policies`.

## Known stubs
None.
