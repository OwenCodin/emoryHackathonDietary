---
phase: quick-261114-sks
plan: 01
subsystem: renal brain, agent setup, verdict card
tags: [protein, carbs, limits, setup, card]
key-files:
  modified:
    - renal/profile.mjs
    - renal/check.mjs
    - renal/nutrients.mjs
    - renal/vision.mjs
    - renal/data/foods.json
    - agent/tools.mjs
    - agent/prompt.mjs
    - agent/card.mjs
    - README.md
    - renal/README.md
    - agent/README.md
metrics:
  completed: 2026-11-14
---

# Quick 261114-sks: optional protein and carbs limits

Optional `proteinG` (20-200) and `carbsG` (50-500) daily limits: asked (skippable) in setup, read back and saved only on confirm, judged in grams by the food check only for a profile that has them, and shown as a second tile row on the single-item card.

## Commits

- f75b847 feat: optional limits in profile, propose/confirm_limits, setup prompt
- 3720853 feat: renal check, seed foods, USDA ids, vision schema
- eaa50f1 feat: card two-row tiles, display pass-through, READMEs

## Demo-profile (Sam) safety

- Old vs new `renal/check.mjs` compared directly for the Sam profile over all 65 seed foods, aliases, four gram amounts and several labels (572 inputs): `deepEqual` identical.
- Old vs new `agent/card.mjs` SVG compared for 0-3 nutrients across verdicts, portions, online flag and two scales, plus multi and unjudged cards (360+ cases): byte-identical.
- `result.nutrients` has no `proteinG`/`carbsG` keys unless the profile has the limit. Saved four-limit profiles contain no new keys.
- Regression tests added (banana literal, label with protein printed but profile without protein limit).

## Decisions

- Thresholds for macros: avoid > 1/3, limit >= 1/5 of the daily limit (minerals keep 25% / 10%), because protein and carbs are eaten at every meal.
- Worst nutrient chosen by share relative to its own avoid line; for minerals this orders exactly as before.
- websearch.mjs left unchanged: web results have no protein/carbs, so they are null and not judged.
- Known gaps (unchanged on purpose): meals, dish, diary totals and `pickBest` stay on the three minerals.

## Needs a spot-check

The protein and carbs values for the 65 seed foods in `renal/data/foods.json` (per 100 g) were entered from memory of USDA reference values, not looked up. Weaker ones: deli turkey, ham, hot dog, chicken broth, tomato soup, unsalted crackers, tofu (which type), processed cheese, flour tortilla, yogurt (taken as low-fat plain), pork loin, ground beef (cooked, ~90% lean).

## Deviations from plan

1. [Rule 3 - test] `renal/profile.test.mjs` built its "every bound is enforced" loop from `Object.keys(LIMIT_BOUNDS)`, which now includes the optional keys. Limited that loop to the four required keys; optional keys have their own tests.
2. [Rule 1 - test expectation] My first banana literal forgot the 118 g scaling; corrected to the real seed output (422 mg potassium).
3. Worktree base was not the expected commit at start; reset to 6297835 as instructed.
4. Static prompt text and the Gemini vision instruction/schema do change for everyone (new macros step line; vision asked to also copy protein and carbs, optional nullable fields). Spoken output for Sam from the tools is unchanged, but the model-facing prompts are not byte-identical. Revert `renal/vision.mjs` INSTRUCTION/schema lines if you want zero model-side change for the demo recording (macro labels would then not be read).
5. No dedicated vision test was added for the new optional label fields.

## Baseline vs final tests

- Baseline on base commit: 680 tests, 677 pass, 3 FAIL (not 557 passing). The three failures are pre-existing in `agent/card.test.mjs`: "has the brand text and size", "shows three rows then +N more", "keeps the outer 9% background-only: limit". Not touched.
- Final: 694 tests, 691 pass, 3 fail (the same three).
- `agent/sim/onboarding-run.mjs` still passes its target (not re-run after the final commit; run after the prompt change, PASS).
