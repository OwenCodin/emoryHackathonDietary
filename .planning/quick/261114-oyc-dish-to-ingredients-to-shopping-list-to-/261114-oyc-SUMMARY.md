---
phase: quick-261114-oyc
plan: 01
subsystem: renal, actions, agent
tags: [dish-ingredients, shopping-list, kroger-preview, honest-removal]
requires: []
provides:
  - renal dishIngredients (model names and quantities only, every ingredient re-checked by checkFood)
  - actions previewCart (read-only list card with Kroger photos and prices)
  - agent tools dish_ingredients, remove_from_list, set_quantity, text_list; start_cart confirm guard
key-files:
  created: [renal/dish.mjs, renal/dish.test.mjs]
  modified: [renal/meals.mjs, renal/index.mjs, actions/cart.mjs, actions/cart-card.mjs, actions/index.mjs, agent/tools.mjs, agent/memory.mjs, agent/prompt.mjs, agent/fake-modules.mjs, agent/contract.test.mjs, three READMEs]
decisions:
  - A model answer with fewer than 3 ingredients for a dish the built-in table knows falls back to the table (live: flash-lite returned only bread and ham).
  - Nothing cut: set_quantity, the built-in table, the confirmation rule, the honest sentence and the checkFood re-check are all in.
metrics:
  tests: 679 pass (641 on the base)
  completed: 2026-11-14
---

# Quick 261114-oyc: dish to ingredients to list to Kroger cart Summary

A named or shown dish now becomes checked ingredients, a list the caller can edit, a not-in-cart preview card, a text, and an exact Kroger add, with an honest sentence for removals.

## Result

`npm test`: 679 tests, 679 pass, no `.env.local` (base 641). Nothing was cut.

## Live check (read-only)

Script outside the repo: `/private/tmp/claude-501/-Users-ptrczx-Desktop/49d7789a-b64c-470b-9826-f7eda7d76f05/scratchpad/oyc/live-check.mjs`. Throwaway `RENAL_STATE_DIR` and `KROGER_TOKEN_DIR`; a fetch wrapper allowed only Gemini, USDA, the Kroger app-token endpoint (client_credentials), `/v1/products` and `www.kroger.com/product/images/`, and would have aborted on any `/v1/cart` or refresh_token. Hosts actually contacted: generativelanguage.googleapis.com, api.kroger.com (token, products), www.kroger.com (images). No user token, cart call, text or sign-in.

"ham sandwich" for the demo patient, final run: source `model` (Gemini fast model), 0.8 s.

| Ingredient | Quantity | Verdict | Swap |
|---|---|---|---|
| white bread | 2 slices | ok | none |
| ham | 3 slices | avoid | fresh unsalted chicken |
| processed cheese | 1 slice | limit | none |
| lettuce | 1 leaf | ok | none |
| tomato | 2 slices | limit | none |

All five were checked (source usda). An earlier run before the fix returned only bread and ham from the model; that is why a thin model answer now falls back to the table. `previewCart` on the list with ham swapped for the chicken: 1.3 s, `{ ok: true, shown: true, found: 4, notFound: 1, total: 20.24 }`.

Preview PNG: `/private/tmp/claude-501/-Users-ptrczx-Desktop/49d7789a-b64c-470b-9826-f7eda7d76f05/scratchpad/oyc/preview.png`. It shows the title "Your list · not in your Kroger cart yet", "About $20.24" in green, the line "Kroger prices · 4 of 5 found", five tiles with real Kroger photos (white bread $3.98 x2, processed cheese spread $9.79, iceberg lettuce $2.49, Roma tomato $3.98 x2), a "No picture" tile for "fresh unsalted chicken" (no match), and the footer "Not in your Kroger cart yet. Nothing is added or paid until you say so." Note: the product matcher picked a Tastee cheese spread for "processed cheese"; matching quality was not in scope.

## New and changed tools

- `dish_ingredients({ dish })`: `{ ok, dish, ingredients: [{ name, quantity, verdict, swap? }], omitted?, say, ask }`, at most 900 characters, never drops an avoid row; say built in code from names and verdict words (no digits); verdict card shown. Failures: `bad_food`, `profile_unavailable`, `limits_needed`, `check_failed`, `dish_unknown` ("I'm not sure what usually goes in that. Tell me the main ingredients and I'll check each one.").
- `add_to_shopping_list({ items, keep_after_warning? })`: returns the existing fields plus `list` (at most 8 names); `held` with say "I left <names> off your list because it's not a good fit for your limits. Tell me if you still want to keep it." for avoid foods; keep works only for a name held earlier in the call; previewCart is called, not awaited.
- `remove_from_list({ items?, all?, from_kroger_cart? })`: `{ ok, removed, list, say? }`; failure `not_on_list` ("That isn't on your list."), `bad_items`, `memory_unavailable`.
- `set_quantity({ name, quantity })`: `{ ok, name, quantity, list }`; `not_on_list`, `bad_item`.
- `text_list()`: one text, "- name (quantity)" lines plus the care-team closing line, once per content; `no_phone`, `nothing_to_text`, `list_already_sent`, `list_text_unconfirmed`, `list_text_failed`.
- `shopping_list` now also shows the card; `suggest_meal` records quantities.
- `start_cart`: see below.
- Renal `dishIngredients({ dish, profile }, { ai }?)`; actions `previewCart({ items })` (`{ ok, shown, found, notFound, total }` or `not_configured`, `busy`, `render_failed`, `preview_failed`, validation errors).

## start_cart

With explicit items it behaves as before. With an empty list it uses exactly the current list. It fails `nothing_to_buy` ("Your list is empty. What would you like to buy?") when empty; `already_in_cart` when everything was sent this call; and `confirm_list` ("Before I add anything to your Kroger cart, here is what's on your list. Shall I add these?", with `items`) when the current list differs from the list last handed back to the model in this call (for example a leftover list from an earlier call, or a suggest_meal list). Success returns the item names and "I'm adding these to your Kroger cart now."

## Honest removal sentence

"Kroger doesn't let me take items out of your cart. I've taken it off your list so it won't be added again, and I can text you the cart link so you can remove it there."

## Prompt

Numbered playbook "Dish and shopping list:" steps 1 to 8 (dish_ingredients, add_to_shopping_list with keep_after_warning, one short sentence per change, remove/add/set_quantity, text_list, start_cart with confirm_list then text_cart_link, from_kroger_cart with the exact say and never claiming removal, several parts in order and one short question when unsure). Restriction line: `Call start_setup only when the caller explicitly asks to change their setup, limits, voice or preferences (for example "update my setup"); never because they showed or named a food or dish, asked for ingredients, or asked to shop.` The tool description says the same.

## Shared contract

The three Shared contract sections are byte-identical (same shasum), changed in one commit (d0badb4).

## Commits

e1530b7 test dish, 0675efe feat dish, 180218a test preview, 73edee1 feat preview, d0badb4 docs contract, 52093b5 fix thin model answer, d7d4018 feat agent, 0fafd95 docs agent.

## Deviations from Plan

- [Rule 1] Live check showed the fast model can return only 2 ingredients; added a 3-ingredient minimum before trusting the model for a dish in the built-in table and a stronger prompt line (52093b5).
- [Rule 1] Dish ingredient filter also drops "fresh basil" style staples and salt (the existing `isPantryStaple` did not match "fresh basil"); done locally in dish.mjs without changing meals behaviour.
- `ask` is "Shall I put these on your list?" when no ingredient has a swap (the plan's fixed sentence mentions a swap).
- A list returned by add/remove/set_quantity/shopping_list counts as read back, so start_cart then goes straight through; `confirm_list` fires when the list changed since, or was never returned (leftovers, suggest_meal).
- The memory tests were written with the code rather than strictly red-first.

## Known Stubs

None.

## Self-Check: PASSED
