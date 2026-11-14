---
status: complete
quick_id: 261114-ej7
branch: merge/all-tracks
---

# Quick 261114-ej7: Fix renal defects and agent tests

## Commits
- 48dff8a fix(renal): RENAL_STATE_DIR keeps diary.json/cache.json writes out of committed data in tests
- 42ded6d fix(renal): foods with no known serving are judged per 100 g; numberWords is total (no stack overflow)
- aa4223d fix(renal): cola brand aliases resolve to the seed; USDA hits must pass plausibleMatch; hard rules match whole phrases against spoken and canonical name
- 11ee2ec fix(renal): numberless labels are judged by product name (seed, guarded USDA) plus ingredient rules
- 25f3825 fix(renal): generateJsonWithFallback hedged fallback Gemini model for describeImage and suggestMeals
- 618fd3e test(agent): tools tests run on deterministic fakes; contract test asserts the real renal contract

## Results
- npm test: 270 tests, 270 pass, 0 fail. `git status --short` is empty after the run; `git diff --stat HEAD -- renal/data` empty.
- Acceptance (no USDA/GOOGLE keys, temp RENAL_STATE_DIR), all ok:true:
  - banana: limit, source usda, "Limit, banana has about four hundred twenty two milligrams of potassium. A smaller portion may fit better."
  - Coca-Cola, coca cola, coke, pepsi, diet coke, cola, soda: all limit, source rule, phosphorus 60 mg, say "Limit, <name> has about sixty milligrams of phosphorus. Many colas contain phosphate additives; check the ingredient label."
  - white rice: ok, source usda, "Okay, white rice has about sixty eight milligrams of phosphorus."
  - star fruit: avoid, source rule, "Avoid star fruit. It is on the kidney care team's avoid list."
  - numberless Coca-Cola label: limit, source rule, same say and phosphate reason as cola.
- The "no seed and no credible USDA hit -> unknown, cannot judge" case is proven by stubbed-fetch tests; the live USDA path was not exercised (no USDA key here).

## Contract-relevant changes
- describeImage(input, { ai }) and suggestMeals(input, { ai }) accept an optional second argument (test seam); the agent is unaffected.
- checkFood for a numberless label answers from the product name; nothing known gives unknown with nutrients null and source 'none'.
- checkFood portion may read '100 g (no typical serving size known)'; say then ends "... in 100 grams."
- Hard rules (alwaysAvoid, alwaysLimit) match whole phrases against the spoken name and the resolved seed name; the care-team avoid list stays exact-match. alwaysLimit reasons are always added and the say speaks the reason when the rule escalated the verdict. A name matching alwaysLimit with no nutrient data returns limit (not unknown).
- Cola seed gained aliases only (no nutrient numbers changed).
- lookupFood results carry an internal `matched: 'seed'|'usda'` field; lookupUsda requests pageSize 10, picks the first plausible candidate, and ignores cached positives that fail plausibleMatch. nutrients.mjs exports plausibleMatch; check.mjs exports numberWords (not in renal/index.mjs).
- New env keys: RENAL_VISION_FALLBACK_MODEL, RENAL_MEALS_FALLBACK_MODEL (default gemini-3.5-flash-lite), RENAL_STATE_DIR (empty = renal/data). Fallback starts when the primary errors or has not answered in 2.5 s; total budgets unchanged (5.4 s / 5.1 s).

## Residual limitations
- Diet colas reuse regular cola numbers (seed reuse, no invented numbers).
- Generic soda/pop/soft drink are judged as cola (conservative).
- The USDA plausibility guard is token-based; a brand word inside a manufacturer phrase can still pass for a non-aliased query.
- spokenVerdict in the agent prefixes its own word, so a caller may hear "Small portion, limit, ..." (pre-existing, agent-side, unchanged).
- Live USDA and live Gemini fallback were not exercised (no keys, no network).

## Deviations
- Plan verification used `node --test renal/`, which fails on Node 24 (treats it as a file); used `node --test renal/*.test.mjs` instead.
- Added behaviour beyond the plan text: an unfound food matching an alwaysLimit rule (e.g. "cherry cola") returns limit with the rule reason rather than unknown (stricter, never more lenient).
- Not committed: this SUMMARY; STATE.md and ROADMAP.md untouched.
