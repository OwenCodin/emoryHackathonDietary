---
status: complete
quick: 261114-eyk
---

# Quick 261114-eyk: Pantry memory and texted recipes

Commits (branch build/pantry, nothing pushed):
- 862321d feat(agent): per-patient pantry memory with 2-hour expiry (memory.mjs and its tests)
- d07039d feat(agent): remember the kitchen across shots and calls, and text one recipe (tools.mjs, tools tests, fake-modules.mjs)
- a42f907 feat(agent): prompt rules for the kitchen tour and texted recipes (prompt.mjs and its tests)

Final `npm test`: 298 tests, 298 pass, 0 fail. `git status --short -- . ':!.planning'` is empty after the commits. No change to renal/ or actions/ or any Shared contract section.

## recipeText sample

```
Recipe from your AI renal dietitian: Rice with herbed chicken
Uses from your kitchen: rice, chicken
Missing: unsalted chicken broth (1 carton)
Time: about 25 minutes
Steps:
1. Cook the rice in unsalted broth.
2. Pan-cook the chicken with herbs.
3. Serve together.
Why it fits: Low in sodium and potassium, with a modest phosphorus load.
This recipe follows the limits set by your care team and does not replace their advice.
```

## Prompt rules (final wording)

Replaced the old suggest_meal sentence with:
"When the caller wants meal ideas or asks what to cook, ask them to show their fridge first and then their pantry or cupboards, one shot at a time, call look_at_camera with place home for each shot, and tell them you will remember what they have. In a store, call look_at_camera with place store. Then call suggest_meal, which cooks from everything they showed from their kitchen; if it says nothing was seen, ask them to show the fridge. After suggesting a meal, offer to text them the recipe; call text_recipe only when they agree to it, passing the title or position they chose; if it says which_recipe, ask which one; never ask it to send the same recipe twice, and if it says it could not confirm, ask them to check their messages instead of trying again. When they ask what you remember they have, call pantry_list; when they say something is gone or was wrong, call remove_from_pantry with those items; when they ask you to forget everything, call clear_pantry."

timeWarning now ends: "...and say you will remember their shopping list and what they showed you from their kitchen."

## Tools

- look_at_camera: new optional arg `place` ('home' | 'store'). Fridge/shelf looks that are not a single label and not place store add up to 20 food names to the pantry; result gets `remembered: true`. place home skips the shelf best-pick.
- suggest_meal: now cooks from the whole pantry (falls back to last look; nothing_seen if both empty). Remembers cleaned meals for text_recipe.
- pantry_list(): { ok, count, names (max 12, 40 chars), more } or fixed sentence when empty. No failure codes besides timeout/tool_failed.
- remove_from_pantry({ items: 1..20 strings }): fails bad_items, not_in_pantry; success { ok, removed, left } (+ say if the write failed).
- clear_pantry(): { ok, say }; says "may not remember next time" if the write failed.
- text_recipe({ title?, position? }): fails no_phone, no_recipe, which_recipe (with titles), recipe_already_sent, text_failed (definite failure, un-marked, retry works), text_unconfirmed (unknown outcome or timeout, mark kept, never resent).
- Exported recipeText(meal); no_phone say changed to the neutral "...so I can't send that."
- State file now has an extra `pantry` key (approved, needed, pantry, rejected, updatedAt); old files without it still load.

## Deviations

- Existing test 'a failed look clears the previous verdicts and foods' (WR-02 block): its assertion that suggest_meal gives nothing_seen after a failed look conflicts with the new rule that the pantry survives a later look. I kept every assertion and changed only the first look to `{ place: 'store' }` (store looks are never remembered). Also the memory test went four keys to five, as planned.
- Tasks 1 and 2 were implemented together in tools.mjs, so they are one commit (memory split out), and the prompt is one commit; no separate RED commits.
- The `look_at_camera` description says "the caller own fridge" (an apostrophe would break the single-quoted string).

## Notes and limitations

- Pantry is names only; an in-call "hidden" set keeps removed/cleared names gone this call even if the stored write fails.
- A failed or unclear look does not erase the pantry (by design); only remove/clear or expiry does.
- Only the first 20 foods of a shot are remembered; the pantry holds 40, oldest dropped first.
- remove_from_pantry matching is substring based (3+ chars), so "rice" removes every entry containing rice.
- text_recipe de-duplicates per call by title only; a new call can resend. A timed-out send that later fails definitely may un-mark.
- Nothing was run against real Gemini/Chert; all tests use fakes.
