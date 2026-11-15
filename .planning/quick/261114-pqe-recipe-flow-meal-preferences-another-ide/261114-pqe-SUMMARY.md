# Quick 261114-pqe Summary: full dish recipe by iMessage

`renal.dishRecipe` re-checks the dish's ingredients, swaps avoid items only for swaps that re-check ok or limit, has the model write steps for the final list only, and `text_recipe` texts the result for a shown or named dish.

## Commits
- 9402b32 renal dishRecipe (renal/dish.mjs, dish.test.mjs, index.mjs)
- cbfaa5b text_recipe dish branch, dishRecipeText, per-serving line for meals, recipe_unavailable, fake dishRecipe, contract test
- b5d3aa6 prompt wording and shared-contract README rows (three READMEs identical)

## Tests
`npm test`: 704 tests, 701 pass, 3 fail. The 3 failures are in agent/card.test.mjs (brandSvg text, cardSvg multi, safe area limit). They are in a file this plan does not touch and that imports none of its code (card.mjs is unchanged); the failure is a text mismatch in the brand SVG ("care team&#39;s limits"). Not fixed (out of scope; the plan forbids touching card.mjs).

## Deviations
None to the plan. Added the required end-to-end spoken-name test (dish_ingredients then text_recipe {} with no look_at_camera).

## Known Stubs
None.
