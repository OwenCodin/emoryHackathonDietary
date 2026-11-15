---
phase: quick-261114-sks
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - renal/profile.mjs
  - renal/profile.test.mjs
  - agent/tools.mjs
  - agent/tools.test.mjs
  - agent/prompt.mjs
  - agent/prompt.test.mjs
  - agent/onboarding.test.mjs
  - agent/fake-modules.mjs
  - agent/sim/onboarding-run.mjs
  - renal/data/foods.json
  - renal/nutrients.mjs
  - renal/vision.mjs
  - renal/check.mjs
  - renal/check.test.mjs
  - agent/card.mjs
  - agent/card.test.mjs
  - README.md
  - renal/README.md
  - agent/README.md
autonomous: true
requirements: [QUICK-261114-SKS]

must_haves:
  truths:
    - "A profile with no proteinG/carbsG produces exactly today's verdicts, say sentences, reasons, nutrients objects, tool results and card SVGs (all 557 existing tests pass unchanged except the one setup-step-order assertion that must list the new step)"
    - "Setup asks one short skippable question for a daily protein or carbohydrate limit in grams after the four required limits"
    - "propose_limits/confirm_limits accept optional protein_g and carbs_g, read them back only when given, and save them only on confirmation"
    - "A profile with proteinG judges protein in grams (reasons say 'g', say says 'grams of protein') and can change the verdict"
    - "The single-item card shows Protein/Carbs tiles in grams in a second row, panel grows upward, nothing overlaps the voice wave (y 505-585)"
  artifacts:
    - path: "renal/profile.mjs"
      provides: "Optional proteinG/carbsG limits with bounds"
      contains: "OPTIONAL_LIMIT_KEYS"
    - path: "renal/check.mjs"
      provides: "Grams-based protein/carbs judging only when profile has the limit"
      contains: "proteinG"
    - path: "agent/card.mjs"
      provides: "Two-row nutrient tiles and lifted panel for 4-5 nutrients"
      contains: "Protein"
  key_links:
    - from: "agent/tools.mjs propose_limits"
      to: "renal/profile.mjs LIMIT_BOUNDS"
      via: "bounds check for protein_g/carbs_g"
      pattern: "LIMIT_BOUNDS\\[key\\]"
    - from: "renal/check.mjs"
      to: "profile.limits.proteinG"
      via: "active nutrient list built per call"
      pattern: "limits\\.(proteinG|carbsG)|activeNutrients"
    - from: "agent/tools.mjs displayItem"
      to: "agent/card.mjs detailParts"
      via: "nutrients.proteinG/carbsG passed through only when finite"
      pattern: "proteinG"
---

<objective>
Add protein and carbohydrate as two OPTIONAL daily limits (`proteinG`, `carbsG`, grams) next to sodium/potassium/phosphorus/fluid: ask for them in setup (skippable), judge foods against them only when the profile has them, and make the single-item verdict card grow to show them.

Purpose: patients on protein- or carb-restricted diets get advice that respects those targets.
Overriding constraint: a profile without proteinG and carbsG (including demo profile "Sam" in renal/data/patients.json) must produce byte-for-byte today's output everywhere. Every change is additive and gated on the profile having the key. The demo video is recorded tonight.

Output: updated profile/tools/prompt/check/nutrients/vision/card modules, seed food data with protein/carbs, new tests, brief README contract updates. Do not push. Do not touch `.env*`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md
@renal/profile.mjs
@renal/check.mjs
@agent/card.mjs

<interfaces>
Existing contracts (extracted; do not re-explore):

renal/profile.mjs
- export const LIMIT_BOUNDS = { sodiumMg:[500,4000], potassiumMg:[1000,4700], phosphorusMg:[500,1500], fluidMl:[500,4000] } (frozen)
- const LIMIT_KEYS = ['sodiumMg','potassiumMg','phosphorusMg','fluidMl']; validate() rejects any key not in LIMIT_KEYS, requires all four as integers in bounds, then rebuilds limits from LIMIT_KEYS only.
- getProfile (saved path) returns limits: { ...saved.limits } — already passes extra keys through.

agent/tools.mjs
- line ~363: const LIMIT_FIELDS = [['sodium','sodiumMg','sodium_mg'], ['potassium','potassiumMg','potassium_mg'], ['phosphorus','phosphorusMg','phosphorus_mg'], ['fluid','fluidMl','fluid_ml']]
- lines ~1176-1215: propose_limits / confirm_limits, zod params of four z.number().nullish(); fail(`bad_${nutrient}`) -> FAILS map (line ~127: bad_phosphorus, bad_fluid). pending = { limits, at }. confirm compares LIMIT_FIELDS args to pending.limits and fails 'limits_changed'.
- read-back say today: "I heard sodium X milligrams, potassium X milligrams, phosphorus X milligrams and fluid X milliliters a day. Is that right?"
- line ~297 displayItem(v, fallbackName, verdict): whitelists nutrients to {sodiumMg, potassiumMg, phosphorusMg}.
- line ~308 pickBest share(): three minerals only (leave as is).
- line ~539 nameless-label guard: ['sodiumMg','potassiumMg','phosphorusMg'].some(k => finite x && x !== label[k]) -> fail('label_unreadable').

agent/prompt.mjs
- SETUP_STEPS (frozen array of {step, says}); setupParagraph numbered list; LIMIT_RULE string.
- agent/prompt.test.mjs line 110 asserts exact step order ['welcome','name','condition','limits','avoid','voice','style','kroger','capabilities','kroger_later','done'] and total words <= 300 (currently ~254, so ~45 words of headroom).

renal/check.mjs
- NUTRIENTS = [['sodiumMg','sodium'],['potassiumMg','potassium'],['phosphorusMg','phosphorus']] drives: label validation, labelHasNumbers, noNutrients, label/web/seed nutrient objects, verdict loop (share > 0.25 avoid, >= 0.1 limit), worst, buildReasons ("sodium N mg is P% of the L mg daily limit"), say ("... has about <words> milligrams of <label>").
- profileIsValid requires the three minerals.

renal/nutrients.mjs
- line 6: NUTRIENT_IDS = { sodiumMg:1093, potassiumMg:1092, phosphorusMg:1091, waterMl:1051 }; acceptance at ~169 keys on the three minerals by explicit list; entry.nutrients built explicitly with three keys at ~185.

renal/vision.mjs
- RESPONSE_SCHEMA.label properties product, servingSize, sodiumMg, potassiumMg, phosphorusMg, ingredients; all listed in label.required. validateSeen checks the three mineral keys with validNullableNumber.

renal/websearch.mjs: SODIUM_MG/POTASSIUM_MG/PHOSPHORUS_MG lines; cache acceptance at ~132. DECISION: leave unchanged (web results carry no protein/carbs -> null, so no web cache entry acceptance changes). State this in SUMMARY.

agent/card.mjs
- detailParts(item) -> { nutrients: ['Sodium N mg', ...], portion }
- nutrientCards(item, x, y, width, compact): slices to 3, regex /^(Sodium|Potassium|Phosphorus)\s+(.+)$/, tile height 66 (58 compact), gap 9, portion text at y+99 (y+88 compact).
- cardSvg single item: text(710,142,'FOOD CHECK'), panel(692,165,510,330) [bottom 495], onlineBadge(1000,181), statusPill at y 198, name at 316, detail at 354, nutrientCards(item,730,385,430). WAVE.top = 505.
- Multi-item rows use detailParts(r).nutrients[0] (sodium first) - unaffected.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Optional protein/carbs limits in profile, setup tools and setup prompt</name>
  <files>renal/profile.mjs, renal/profile.test.mjs, agent/tools.mjs, agent/tools.test.mjs, agent/prompt.mjs, agent/prompt.test.mjs, agent/onboarding.test.mjs, agent/fake-modules.mjs, agent/sim/onboarding-run.mjs</files>
  <behavior>
    - profile: limits with only the four required keys validate and save exactly as today (saved object has no proteinG/carbsG keys).
    - profile: limits plus proteinG 60 and/or carbsG 200 validate; saved limits include them; getProfile returns them.
    - profile: proteinG 5, proteinG 250, proteinG 60.5, carbsG 30, carbsG 600, carbsG "200" -> { ok:false, error:'limit out of range', field:'proteinG'|'carbsG' }; proteinG null or undefined is treated as absent (no key saved).
    - profile: an unknown key (e.g. fatG) is still rejected as 'bad limits'.
    - propose_limits with four numbers only -> say string identical to today; pending.limits has no proteinG/carbsG.
    - propose_limits with protein_g 60 -> say "I heard sodium ..., phosphorus ... milligrams and fluid ... milliliters a day, with protein 60 grams. Is that right?" style (one appended clause covering protein, carbohydrates, or both: "with protein 60 grams and carbohydrates 200 grams"); protein_g 5 -> fail('bad_protein'); carbs_g 900 -> fail('bad_carbs').
    - confirm_limits with matching optional values saves them; a differing or omitted protein_g/carbs_g vs pending -> 'limits_changed' (treat null/undefined as "not given" on both sides).
    - prompt: SETUP_STEPS order is welcome, name, condition, limits, macros, avoid, ...; total words <= 300.
  </behavior>
  <action>
renal/profile.mjs: add proteinG [20,200] and carbsG [50,500] to LIMIT_BOUNDS (keep the existing comment: sanity bounds, not medical advice). Add a non-exported OPTIONAL_LIMIT_KEYS = ['proteinG','carbsG']. In validate(): allowed keys = LIMIT_KEYS plus OPTIONAL_LIMIT_KEYS; required four checked exactly as now; for each optional key, if value is null/undefined skip it, else require Number.isInteger and within bounds or return { ok:false, error:'limit out of range', field:key }. Build limits from LIMIT_KEYS, then add each optional key only when present, so a four-key profile's saved object is byte-identical to today. getProfile already spreads saved.limits; leave it, but confirm with a test. Previously saved profiles stay valid (no new required keys).

agent/tools.mjs: add const OPTIONAL_LIMIT_FIELDS = [['protein','proteinG','protein_g'], ['carbs','carbsG','carbs_g']]. Add FAILS entries bad_protein and bad_carbs in the exact style of bad_phosphorus ("That protein number doesn't sound right; can you read it again from your care team's sheet?" and the same with "carbohydrate"). propose_limits: add protein_g and carbs_g as z.number().nullish() params; update the description to say protein and carbohydrate in grams are optional and only passed if the caller gave them. After the required loop, for each optional field: if null/undefined skip; else bounds-check against LIMIT_BOUNDS[key] (integer) and fail(`bad_${nutrient}`) if bad; else set limits[key]. Build the read-back: keep the existing sentence verbatim when no optional key is present; otherwise insert before " Is that right?" a clause ", with protein N grams", ", with carbohydrates N grams", or ", with protein N grams and carbohydrates N grams" (replace the trailing "a day." with "a day, with ... ." so it reads as one sentence). confirm_limits: add the same two params; extend the limits_changed comparison so for each optional field (args[arg] ?? null) !== (pending.limits[key] ?? null) also fails. Update its description ("the same numbers") without mentioning "four" only. Saving uses { ...asked.limits } unchanged.

agent/prompt.mjs: insert a new SETUP_STEPS entry right after 'limits': { step: 'macros', says: 'Did your care team also give you a daily protein or carbohydrate limit in grams? You can skip either one.' }. In setupParagraph item 3 (Limits), add after the limits question: then ask "${say('macros')}". Rewrite the limits instruction sentence to: once you have the four numbers and the answer about protein and carbohydrates, call propose_limits with the four (converted as today) plus protein_g and carbs_g in grams only if the caller gave them; never fill in protein or carbohydrates they did not say. Keep the rest of the paragraph intact. LIMIT_RULE: only append nothing unless needed; it already says never fill in a number they did not say — leave LIMIT_RULE unchanged unless a test needs it (the 'the limit rule is reworded' test must still pass).

agent/prompt.test.mjs: update the expected step-order array at line ~110 to include 'macros' after 'limits'; add an assertion that instructions include 'protein_g' and the macros say line. agent/fake-modules.mjs and agent/sim/onboarding-run.mjs: only change if they hard-code the step list or the propose_limits schema; the sim's scripted caller may optionally answer the macros question with "skip" — keep the sim's existing flow working (run it if it is invoked by npm test). Add tests: renal/profile.test.mjs (validation with/without optional keys, bounds, old four-key profile round-trip unchanged), agent/tools.test.mjs or agent/onboarding.test.mjs (propose without optional -> exact old say string; with protein only, carbs only, both; bad_protein/bad_carbs; confirm match saves optional keys; confirm mismatch -> limits_changed). Reuse the existing test harness patterns in those files (CONFIRM_MIN_MS / callerHeardAfter fakes already used there).
  </action>
  <verify>
    <automated>cd /Users/ptrczx/Desktop/emoryHackathonDietary-ui && node --test renal/profile.test.mjs agent/tools.test.mjs agent/onboarding.test.mjs agent/prompt.test.mjs</automated>
  </verify>
  <done>Optional limits validate/save/read back/confirm as specified; read-back and saved profile without them are identical to today; setup asks the macros question; listed test files pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Renal brain judges protein/carbs in grams only when the profile has the limit</name>
  <files>renal/data/foods.json, renal/nutrients.mjs, renal/vision.mjs, renal/check.mjs, renal/check.test.mjs</files>
  <behavior>
    - Demo/three-mineral profile: every existing check test passes unchanged; result.nutrients keys are exactly sodiumMg, potassiumMg, phosphorusMg (no proteinG/carbsG keys at all).
    - Profile with proteinG 60, food "chicken breast" 120 g (~31 g protein/100 g -> ~37 g, share 0.62 > 1/3): verdict 'avoid' when protein is the deciding nutrient; reasons include "protein 37 g is 62% of the 60 g daily limit"; result.nutrients.proteinG === 37; no carbsG key since profile has no carbsG.
    - If protein is the worst (by severity) nutrient, say uses "grams of protein" (e.g. "Avoid, chicken breast has about thirty seven grams of protein.").
    - Profile with carbsG 200 and white rice 158 g (~28 g/100 g -> 44 g, share 0.22 >= 0.2): at least 'limit'.
    - Label with proteinG 12 and profile proteinG 60: share 0.2 -> 'limit' and nutrients.proteinG === 12; label without proteinG and profile with proteinG -> nutrients.proteinG null and protein not judged.
    - A cached USDA/seed entry without proteinG/carbsG -> treated as null, no error.
  </behavior>
  <action>
THRESHOLD DECISION (state in SUMMARY): protein/carbs use a per-meal-third rule (avoid if > 1/3 of the daily limit, limit if >= 1/5) instead of the minerals' 25%/10% per-item rule, because these are eaten in normal amounts at every meal, so the mineral rule would flag an ordinary portion of chicken or rice as "avoid" for a typical limit.

renal/data/foods.json: add "proteinG" and "carbsG" (per 100 g, one decimal, standard USDA SR Legacy / FNDDS values) to the nutrients object of all 65 seed foods. Do not change any other field. Note in SUMMARY that these were entered from reference knowledge and need a spot-check.

renal/nutrients.mjs: add proteinG: 1003 and carbsG: 1005 to NUTRIENT_IDS. Keep the candidate acceptance keyed on the explicit three-mineral list (unchanged). When building entry.nutrients, keep the three keys as today and add proteinG/carbsG only when the USDA value is a number, so fixtures without those ids produce byte-identical entries and cache files. If a seed or lookup test deep-equals seed nutrient objects and now fails because foods.json gained keys, update that expected object (lookup-level test only; check-level outputs must not change).

renal/vision.mjs: add "protein and total carbohydrate in grams" to the label sentence in INSTRUCTION (copied as printed, null if not printed). Add proteinG and carbsG as { type: 'NUMBER', nullable: true } label properties but do NOT add them to label.required (existing fakes omit them). In validateSeen, check proteinG and carbsG with validNullableNumber only when they are not undefined. Do not inject keys into parsed labels.

renal/check.mjs: keep NUTRIENTS (three minerals) as is and add MACROS = [['proteinG','protein'], ['carbsG','carbohydrates']] with unit 'g'. profileIsValid unchanged. At the start of checkFood, compute active = NUTRIENTS plus each MACRO whose profile.limits[key] is a finite number > 0. Replace every per-call use of NUTRIENTS (label validation, labelHasNumbers, noNutrients, label/web/seed nutrient object building, verdict loop, buildReasons) with active, so for a three-mineral profile the iteration is identical. For macros: scaling uses Math.round like minerals (grams); web branch yields null for macros (websearch has no macro lines). Verdict loop: for macro keys use share > 1/3 -> avoid, share >= 0.2 -> limit (when verdict is 'ok'); minerals unchanged. Worst: pick by severity = share / avoidThreshold (0.25 for minerals, 1/3 for macros) and store unit/label; for minerals-only this preserves today's ordering exactly. buildReasons: macro line "<label> N g is P% of the L g daily limit" (label 'protein' / 'carbohydrates'). say: unit word is 'milligrams' for minerals and 'grams' for macros; otherwise sentence templates unchanged (both the seed/label and the web branch). Keep labelHasNumbers counting a macro only if it is active. Early-return paths (avoid rules, limit rules, unknown) unchanged.

renal/check.test.mjs: add tests for the behaviors above, plus one explicit regression: run a handful of existing foods (banana, apple, a label) against the demo profile and against the same profile with no macro keys, asserting deepEqual against today's literal expected outputs (reuse existing fixtures).
  </action>
  <verify>
    <automated>cd /Users/ptrczx/Desktop/emoryHackathonDietary-ui && node --test renal/*.test.mjs</automated>
  </verify>
  <done>Protein/carbs judged in grams with the per-meal-third rule only when the profile has that limit; seed foods carry protein/carbs; USDA and vision read them as nullable; all renal tests pass and existing check outputs unchanged.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Dynamic verdict card, display pass-through, docs, full suite</name>
  <files>agent/card.mjs, agent/card.test.mjs, agent/tools.mjs, README.md, renal/README.md, agent/README.md</files>
  <behavior>
    - cardSvg for a single item with 0-3 nutrients is byte-identical to today (existing card tests and agent/sim/preview-card.mjs output unchanged).
    - Single item with 5 nutrients (sodium, potassium, phosphorus, proteinG 37, carbsG 0): row 1 has 3 tiles, row 2 has 2 tiles ("PROTEIN" "37 g", "CARBS" "0 g"); every y coordinate in the panel content < WAVE.top (505); panel rect bottom (y + height) <= 495; nothing above y 40.
    - 4 nutrients (protein only): row 2 has 1 tile.
    - detailParts lists 'Protein N g' and 'Carbs N g' after the minerals only when finite and >= 0.
    - displayItem passes proteinG/carbsG through only when finite; for a nutrients object without them the display object is deep-equal to today.
  </behavior>
  <action>
agent/card.mjs: in detailParts append ['Protein','proteinG','g'] and ['Carbs','carbsG','g'] after the three minerals, formatting `${label} ${Math.round(x)} g`. In nutrientCards: slice to 5 (not 3); extend the regex to (Sodium|Potassium|Phosphorus|Protein|Carbs); keep tile width computed from the first row only — each = (width - gap*(min(n,3)-1)) / min(n,3) — so the ≤3 case computes the identical number; place tile i at column i % 3, row floor(i / 3), with row y = y + row*(tileHeight + gap); portion line y = lastRowY + 99 (or +88 compact). For n ≤ 3 the produced string must be byte-identical (same arithmetic order, same template). In cardSvg compute, before building parts, lift = 80 when !unjudged && items.length === 1 && detailParts(items[0]).nutrients.length > 3, else 0. Apply it to the FOOD CHECK label y (142 - lift), panel(692, 165 - lift, 510, 330 + lift) so the panel grows upward and its bottom stays at 495, onlineBadge y (181 - lift), and in the single-item branch statusPill y (198 - lift), name (316 - lift), detail (354 - lift), nutrientCards y (385 - lift). With lift 80 the second tile row ends at 305+66+9+66 = 446 and the portion text sits at 479, clear of the wave at 505. Template literals with lift 0 must print the same numbers as today (compute the numbers, do not add "- 0" strings). The multi-item and unjudged branches use lift 0.

agent/tools.mjs displayItem: keep the three-key object exactly as today and spread in proteinG / carbsG only when Number.isFinite(v.nutrients.proteinG) / carbsG. Nameless-label guard (~line 539): extend the key list with 'proteinG','carbsG' so a protein/carbs number not printed on the label also fails label_unreadable (no effect for profiles without the limits since check.mjs never returns those keys). Leave pickBest, meals, dish and diary on the three minerals.

agent/card.test.mjs: add tests for 3 vs 4 vs 5 nutrients (identical SVG for a 3-nutrient item compared with a snapshot built from today's code path or the existing expected fixture; 5-nutrient layout checks: count of tile rects, text 'PROTEIN' and '37 g' present, max parsed y of text/rect elements in the panel < 505, panel bottom <= 495). Optionally run agent/sim/preview-card.mjs to eyeball a 5-nutrient card into the scratchpad; do not commit images.

Docs: in the shared-contract sections of README.md, renal/README.md and agent/README.md add 2-4 lines: limits may include optional proteinG and carbsG (grams; bounds 20-200 and 50-500); check judges them only when present using avoid > 1/3, limit >= 1/5 of the daily limit; result.nutrients includes them only when the profile has them; known gaps: meals, dish and diary totals and web lookups remain on the three minerals (web results carry no protein/carbs).

Finally run the whole suite with npm test (no keys, no network). Do not push. Do not touch .env files.
  </action>
  <verify>
    <automated>cd /Users/ptrczx/Desktop/emoryHackathonDietary-ui && npm test 2>&1 | tail -15</automated>
  </verify>
  <done>npm test passes with all previous tests plus the new ones; cards for ≤3 nutrients unchanged; 4-5 nutrient cards lay out in two rows inside the lifted panel above the wave; docs updated.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| caller speech -> LLM -> propose_limits/confirm_limits | spoken numbers (possibly misheard) become saved health limits |
| camera image -> Gemini vision -> label | model output may contain invented or malformed numbers |
| tool result -> SVG card | nutrient values are drawn into SVG |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-sks-01 | Tampering | propose_limits protein_g/carbs_g | mitigate | integer + LIMIT_BOUNDS check in tools and again in profile validate(); saved only after confirm_limits with matching values and the existing CONFIRM_MIN_MS / callerHeardAfter gate |
| T-sks-02 | Tampering | vision label proteinG/carbsG | mitigate | validNullableNumber in validateSeen; check.mjs label validation for active keys; nameless-label guard extended to protein/carbs |
| T-sks-03 | Injection | card text | mitigate | values are Math.round numbers formatted by detailParts and still go through escapeXml; regex only accepts the five known labels |
| T-sks-04 | Information disclosure | profile store | accept | no new storage location; same 0600 file outside the repo |
</threat_model>

<verification>
- npm test passes (557 existing + new), offline, no keys.
- Demo profile Sam: check outputs, tool results and card SVGs unchanged (covered by existing exact-match tests plus the new regression test).
- grep -n "proteinG" renal/check.mjs agent/card.mjs agent/tools.mjs renal/profile.mjs shows the additions; git diff shows no change to .env* and no push.
</verification>

<success_criteria>
- Optional proteinG/carbsG limits validate, read back, confirm and save; four-limit flow unchanged.
- Setup asks one skippable protein/carbohydrate question; setup word budget still <= 300.
- Protein/carbs judged in grams with the per-meal-third rule only when the profile has the limit.
- Card shows up to 5 tiles in two rows without overlapping the wave; ≤3 tiles byte-identical.
- SUMMARY lists: threshold choice, foods.json values need spot-check, websearch left without macros, meals/dish/diary/pickBest remain three-mineral (known gaps).
</success_criteria>

<output>
Create `.planning/quick/261114-sks-add-optional-protein-and-carbs-limits-on/261114-sks-SUMMARY.md` when done
</output>
