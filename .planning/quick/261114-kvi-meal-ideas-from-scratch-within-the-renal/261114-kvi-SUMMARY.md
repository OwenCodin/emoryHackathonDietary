# Quick 261114-kvi: Meal ideas from scratch within the renal limits - Summary

From-scratch meal suggestions: renal builds meals only from the built-in food list, checks each ingredient with checkFood, requires each summed total to be at most one third of the daily limit, and returns the totals. suggest_meal gets a `from_scratch` parameter.

## Commits
- 050d5f8 feat(renal): meal ideas from scratch within the per-meal share of the renal limits
- 0d0f8cb feat(agent): suggest_meal from_scratch for callers with nothing to show
- d7a2aea docs: suggestMeals fromScratch in the shared contract

## Tests
`npm test` with no .env.local: 483 tests, 483 pass, 0 fail (464 before).

## Live check (demo profile, limits 2300/2000/1000, per-meal caps 766/666/333)
Run twice, 5142 ms and 5141 ms. GOOGLE_API_KEY was set. Both runs returned the FALLBACK_MEALS, not Gemini meals: the call hit the 5.1 s budget and fell back. A direct probe showed both models respond (1.8 s and 0.9 s for a trivial prompt), so the structured from-scratch prompt is slower than the budget. The budget was not changed.
- Herbed chicken and white rice: missing unsalted chicken (1 portion), white rice (1 cup cooked (158 g)), cabbage (1 cup shredded (75 g)); uses []; totals sodium 79, potassium 370, phosphorus 182.
- Apple and egg-white rice bowl: missing egg white (2 large), white rice (1 cup cooked (158 g)), apple (1 medium (182 g)); uses []; totals 59 / 304 / 93.

## suggest_meal with from_scratch true
Calls `renal.suggestMeals({ foods: [], profile, count: 2, fromScratch: true })` even when a pantry is remembered. Returns `{ ok: true, totalsAre: 'per serving, one typical portion of each ingredient', meals: [{ title, minutes?, totals?, missing: [names], steps (first meal only) }] }`. Fills lastMissing (start_cart with [] buys every ingredient except kitchen basics) and lastMeals (text_recipe works). With no meal it returns `{ ok: false, error: 'no_safe_meal', say: "I couldn't put together a meal I'm sure fits your limits right now. Tell me a food you have or want, and I'll check it for you." }`.

## Prompt sentence added
"When they ask for a meal idea without showing food, have nothing at home, or say to just suggest something, call suggest_meal with from_scratch true, say the dish and its sodium, potassium and phosphorus totals exactly as returned (per serving, one typical portion of each ingredient), and offer to add its ingredients to the cart with start_cart; if it says it could not find one, say its say sentence." The kitchen sentence now opens "When the caller wants meal ideas or asks what to cook from what they have, ask them to show their fridge first".

## Deviations
- [Rule 1 - size bound] To keep the from-scratch result within the 900-character limit and not the TOO_LONG summary (plan test S8), the from-scratch result omits `why` (the recipe text still has it) and caps each missing name at 30 characters instead of 40. Kitchen mode is unchanged.
- Added test S3b (empty uses gives "nothing from your kitchen" in the recipe text); S3 checks the olive oil use instead.
- The worktree base differed from the expected commit and was reset to 974fa83 as instructed.

## Follow-up
From-the-kitchen mode still does not check whole-meal totals (kitchen foods can come from USDA, online or label numbers with different serving bases, or null phosphorus). The Gemini from-scratch call exceeds the 5.1 s budget in the live check; consider a shorter food list or a larger budget for this mode.

## Self-Check: PASSED
