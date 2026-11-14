---
phase: quick-261114-kvi
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - renal/meals.mjs
  - renal/meals.test.mjs
  - agent/tools.mjs
  - agent/tools.test.mjs
  - agent/prompt.mjs
  - agent/prompt.test.mjs
  - agent/README.md
  - renal/README.md
  - actions/README.md
autonomous: true
requirements: [QUICK-261114-kvi]

must_haves:
  truths:
    - "suggestMeals({ foods: [], profile, count, fromScratch: true }) returns real dishes whose every non-staple ingredient is in missing as { name, quantity }, whose uses holds only pantry staples (or nothing), and which carry totals { sodiumMg, potassiumMg, phosphorusMg }"
    - "A from-scratch meal is returned only when every non-staple ingredient is on the built-in food list, passes checkFood with verdict ok or limit and three finite numbers, the meal has 1 to 6 such ingredients, and each total is at most MEAL_SHARE_OF_DAILY_LIMIT (1/3) of the profile's daily limit; otherwise it is dropped"
    - "totals are the exact sums of the per-portion numbers checkFood returned; nothing is estimated"
    - "With no GOOGLE_API_KEY and no injected ai, from-scratch mode uses FALLBACK_MEALS (every ingredient moved to missing) and still returns checked meals for the demo profile"
    - "From-the-kitchen mode (fromScratch absent/false) behaves exactly as before: same prompt lines, same checks, no totals field, existing tests unchanged and green"
    - "suggest_meal with from_scratch true calls renal.suggestMeals({ foods: [], profile, count: 2, fromScratch: true }) even when a pantry is remembered, returns the meal totals, fills lastMissing (start_cart with [] buys those items, kitchen basics filtered) and lastMeals (text_recipe works); with from_scratch false/absent and nothing seen it still returns nothing_seen without calling renal"
    - "When from-scratch yields no meal, suggest_meal returns ok:false error no_safe_meal with a fixed say sentence (never renal's message)"
    - "The Shared contract section is byte-identical in agent/README.md, renal/README.md and actions/README.md after the change; npm test passes with no .env.local"
  artifacts:
    - path: "renal/meals.mjs"
      provides: "fromScratch mode, from-scratch prompt, whole-meal totals check, check seam"
      exports: ["suggestMeals", "MEAL_SHARE_OF_DAILY_LIMIT", "FROM_SCRATCH_MAX_INGREDIENTS"]
    - path: "renal/meals.test.mjs"
      provides: "No-network tests for from-scratch mode"
    - path: "agent/tools.mjs"
      provides: "suggest_meal from_scratch parameter, no_safe_meal failure, totals in result"
      contains: "from_scratch"
    - path: "agent/prompt.mjs"
      provides: "Instruction to call suggest_meal with from_scratch true"
      contains: "from_scratch"
  key_links:
    - from: "agent/tools.mjs suggest_meal"
      to: "renal/meals.mjs suggestMeals"
      via: "fromScratch: true in the input object"
      pattern: "fromScratch: true"
    - from: "renal/meals.mjs from-scratch check"
      to: "renal/check.mjs checkFood"
      via: "check seam defaulting to checkFood; nutrients summed into totals"
      pattern: "MEAL_SHARE_OF_DAILY_LIMIT"
    - from: "agent/tools.mjs lastMissing"
      to: "start_cart with an empty list"
      via: "every from-scratch missing item (minus KITCHEN_BASICS)"
      pattern: "lastMissing"
---

<objective>
Let the agent suggest a whole meal when the caller shows nothing ("just suggest something I can make or buy"). Renal builds it only from the built-in food list (known numbers), checks every ingredient with checkFood, checks the whole meal against one third of each daily limit, and returns the totals. Every ingredient is a shopping item, so the caller can put the meal straight into the cart.

Purpose: today suggest_meal fails with nothing_seen unless the caller has shown their kitchen. Callers with an empty fridge, or who just want an idea, get nothing.
Output: from-scratch mode in renal/meals.mjs plus a new renal/meals.test.mjs; a from_scratch parameter on suggest_meal plus tests; one prompt sentence; the shared contract row updated identically in all three READMEs; the agent Tools table and renal notes updated; one live Gemini check reported in SUMMARY.md.

DECISION (whole-meal check in from-the-kitchen mode): NOT applied. That mode is left exactly as it is, and this is noted as follow-up. Reason: kitchen foods are often judged from USDA, online results or labels. Their serving bases differ, and some have null phosphorus. Requiring all numbers would drop meals that work today without a clear safety reason that applies to those meals specifically. Summing only the known numbers would present a partial total as if it were checked. So the totals check and the totals field exist only in from-scratch mode, where every ingredient comes from the built-in list and has a typical portion.

Contract shape chosen: an optional boolean `fromScratch` on the existing input object. In that mode `foods` is ignored (it is still validated as string[] when given). The only addition to the output is an optional `totals` on from-scratch meals. The second argument gains an internal test-only `check` seam (defaults to checkFood). It is documented in renal/README.md only, not in the shared contract (which keeps `{ ai }?`).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<executor_environment>
- You run in an isolated git worktree with no .env.local and no node_modules. First run, from the worktree root: `ln -s /Users/ptrczx/Desktop/emoryHackathonDietary-merge/node_modules node_modules`. The .gitignore entry `node_modules/` does NOT match a symlink, so it will show as untracked. Never commit it. Stage files by name only, never `git add -A` or `git add .`.
- The live check uses `node --env-file=/Users/ptrczx/Desktop/emoryHackathonDietary-merge/.env.local`. Never print, echo or log key values.
- Do not start, stop or signal any running `npm start`, `chert` or `facetime` process. A live Chert session is running from the main checkout. Do not push.
- The only file under actions/ you may edit is actions/README.md, and only its Shared contract section (the suggestMeals row, kept identical to the other two READMEs). No other edits under actions/. No new dependency.
- Before finishing, remove the symlink (`rm node_modules` with no -r, since it is a symlink). The worktree must be clean apart from the uncommitted SUMMARY.md.
</executor_environment>

<context>
@.planning/STATE.md
@CLAUDE.md
@renal/meals.mjs
@renal/check.mjs
@agent/tools.mjs
@agent/prompt.mjs

<interfaces>
Existing (do not change behaviour):
- renal/check.mjs `checkFood({ food: { name }, profile })` returns `{ ok, food, verdict: 'ok'|'limit'|'avoid'|'unknown', say, reasons, nutrients: { sodiumMg, potassiumMg, phosphorusMg } | null, portion: string, swap, source }`. For a built-in (seed) food with no grams, nutrients are for one typical serving (e.g. white rice "1 cup cooked (158 g)": sodium 2, potassium 55, phosphorus 68). Hard rules (star fruit) and profile.avoid give verdict 'avoid' with nutrients null. Any food whose single serving is over 25% of a daily limit gives 'avoid' (e.g. potato for the demo profile).
- renal/meals.mjs internals to reuse: `FALLBACK_MEALS` (3 meals, all built-in foods), `isPantryStaple(name)`, `canonicalFoodName(name, catalog)` (FOOD_ALIASES then catalog name/alias match, else the normalized input), `MEAL_SCHEMA`, `parseMeals`, `validMeal`, `generateJsonWithFallback({ ai, models, buildRequest, parse, totalMs: 5100, hedgeMs: 2500, label })`, `readData('foods.json')` (object of `{ name, aliases?, nutrients, servingGrams, portion }`), `normalizeFoodName`, `errorResult`.
- Demo profile (renal/data/patients.json `demo`): limits sodium 2300, potassium 2000, phosphorus 1000, fluid 1000. avoid ['star fruit','salt substitute']. Per-meal share at 1/3 is about 766 / 666 / 333 mg. All three FALLBACK_MEALS fit: chicken+rice+cabbage 79/370/182; rice+egg white+apple 59/304/93; pasta+cabbage+garlic 16/202/106.
- agent/tools.mjs inside buildTools: `three(o)` returns `{ sodiumMg, potassiumMg, phosphorusMg }` only when all three are finite, else null. `clean(v, n)`, `fail(code, extra)`, the `FAILS` map, `KITCHEN_BASICS`, `MEALS_LIMIT = 900`, `guard(fn, { timeoutMs, limit })` where fn receives `(call, args)`, and the closure vars `lastMissing`, `lastMeals`, `lastFoods`, `pantryNow()`, `memory`. Tool parameters use zod, e.g. `z.object({ place: z.enum(['home','store']).nullish() })`.
- agent/tools.test.mjs helpers: `build(over)`, `rec(obj, name, impl)` → `{ mod, calls }`, `renal = makeFakeRenal()` (getProfile name 'Sam'), `actions = makeFakeActions()`. `globalThis.fetch` throws in that file. `createMemory` / `stateDir` patterns are at lines ~663 and ~1229.
- agent/prompt.test.mjs requires the instructions to keep containing: 'fridge', 'pantry or cupboards', 'place home', 'place store', 'remember', 'suggest_meal', 'text_recipe', 'only when they agree', 'pantry_list', 'remove_from_pantry', 'clear_pantry', 'one or two short sentences', 'Never invent or estimate nutrient numbers', 'care team', 'Never pay', 'ask them to show the fridge'.
- Shared contract row today (identical in all three READMEs, line ~149):
  `| \`suggestMeals({ foods, profile, count }, { ai }?)\` where \`foods\` is \`string[]\` | \`{ ok, meals: [{ title, uses: string[], missing: CartItem[], minutes, steps: string[], why }] }\` |`
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: From-scratch mode with a whole-meal totals check in renal/meals.mjs</name>
  <files>renal/meals.mjs, renal/meals.test.mjs</files>
  <behavior>
    New file renal/meals.test.mjs. Use node:test and node:assert/strict. Copy the small fakeClient helper and the GOOGLE_API_KEY / RENAL_MEALS_* env save-delete-restore from renal/gemini.test.mjs. Set `globalThis.fetch` to throw for the whole file and restore it after. Set RENAL_STATE_DIR to a mkdtemp dir. Profile P = limits { sodiumMg 2300, potassiumMg 2000, phosphorusMg 1000, fluidMl 1000 }, avoid ['star fruit','salt substitute']. All tests set GOOGLE_API_KEY='dummy-key' and inject `ai`, except the fallback test.
    - T1 all ingredients go to missing, with exact totals. Gemini returns one meal: uses ['unsalted chicken','white rice','cabbage','olive oil','water'], missing [{ name:'unsalted chicken', quantity:'1 breast' }]. Call with fromScratch:true and foods ['white rice'] (foods are ignored). Expect ok:true, one meal. The lowercased missing names are exactly the set {unsalted chicken, white rice, cabbage}, the chicken quantity is '1 breast', and each other quantity is a non-empty string. uses contains only staples ('olive oil','water'). totals deepEquals the sum of the real checkFood nutrients for the three names, computed in the test by calling checkFood, not hard-coded.
    - T2 avoid drops the meal. A meal containing 'potato' (avoid for P), and separately one with 'ham', is dropped. The result is ok:true, meals [], and message is a non-empty string.
    - T3 unknown or off-list drops the meal. A meal with 'dragon fruit' (not on the built-in list) is dropped, and fetch is never called. Also inject `check` returning verdict 'unknown' for 'cabbage' → dropped.
    - T4 null numbers drop the meal. With injected `check` returning verdict 'ok' but nutrients { sodiumMg: 5, potassiumMg: 5, phosphorusMg: null } for one ingredient → dropped. Also nutrients null with verdict 'limit' → dropped.
    - T5 the per-meal share. Injected `check` returns verdict 'ok' and fixed numbers. Use a profile with sodium 3000. Two ingredients at sodium 500 each → total 1000 = exactly one third → kept, and totals.sodiumMg is 1000. Two at 501 → 1002 → dropped. Repeat once for potassium or phosphorus over the share → dropped.
    - T6 too many ingredients. 7 distinct built-in non-staple ingredients → dropped. 6 → not dropped for that reason (use the injected check with small numbers).
    - T7 fallback works from scratch. No key and no ai, count 2, fromScratch true, foods [], profile P. Expect ok:true and 1 or 2 meals. Every meal's uses are all pantry staples (FALLBACK uses have none, so []). The missing names include every non-staple from that fallback meal's uses. totals has three finite numbers, each at most limit/3.
    - T8 the from-scratch prompt. Capture params.contents. It must NOT match /actually seen/i. It must match /built-in renal food list/i and /salt substitutes/i. It must include 'white rice: '. It must NOT include 'ham: ' or 'deli turkey: ' (those are avoid for P, so they are filtered out). It must include the per-meal numbers derived from P: 766, 666 and 333.
    - T9 kitchen mode unchanged. suggestMeals({ foods:['white rice','cabbage'], profile:P, count:1 }, { ai }) with a valid kitchen meal returns that meal with no 'totals' key.
    - T10 validation. fromScratch:'yes' → ok:false. fromScratch true with the profile missing limits → ok:false.
  </behavior>
  <action>
Write the tests above first (RED: run them and see them fail), then implement in renal/meals.mjs.

(a) Add exported constants. `MEAL_SHARE_OF_DAILY_LIMIT = 1 / 3` is the usual rule of thumb of one third of the daily limit per meal. `FROM_SCRATCH_MAX_INGREDIENTS = 6`. Add a module-level `const TOTAL_KEYS = ['sodiumMg','potassiumMg','phosphorusMg']`.

(b) Change the signature to `suggestMeals(input = {}, { ai, check = checkFood } = {})`. Use `check` everywhere checkFood is called today. This is a behaviour-neutral test seam.

(c) Refactor `proposeMeals` to take the finished `contents` string: `proposeMeals(contents, injected)`. Model list, totalMs 5100, hedgeMs 2500, label and fallback-to-FALLBACK_MEALS stay unchanged. Move the existing kitchen prompt into `kitchenPrompt(foods, profile, count, preferredFoods)` and keep every line byte-identical. renal/gemini.test.mjs asserts on them.

(d) Read `fromScratch = input?.fromScratch ?? false`. If it is not a boolean, return `{ ok:false, error:'fromScratch must be a boolean' }`. Keep the existing foods, profile and count validation order. In from-scratch mode, also require the three limits in TOTAL_KEYS to be finite and greater than 0. Otherwise return the existing 'a valid patient profile is required' error. When fromScratch is false, run the existing code path exactly as it is. Do not reorder or alter its checks or messages.

(e) Add a from-scratch branch inside the existing try, after `catalog` is read, before the `available.size === 0` early return:
- builtIn = Set of normalizeFoodName(food.name) for every catalog food.
- Pre-filter the list sent to Gemini. Run `check({ food: { name }, profile })` in parallel for every catalog food name. These are seed lookups, so there is no network. Keep only foods with ok true, verdict 'ok' or 'limit', and all three TOTAL_KEYS finite. Build each line exactly as `${name}: ${portion}, sodium ${s} mg, potassium ${k} mg, phosphorus ${p} mg` and join the lines with '; '. Every number comes from check; none is invented.
- Build `fromScratchPrompt(profile, proposalCount, lines)` with its own wording and no "Foods actually seen" line, joined with '\n'. Lines, in order:
  1. Suggest up to N real, recognizable dishes the patient can cook from scratch after shopping (for example, herbed chicken with rice and cabbage, or an egg-white vegetable omelet), not generic ingredient combinations.
  2. Use only foods from this built-in renal food list, each shown with one typical portion and its sodium, potassium and phosphorus: {lines}.
  3. Besides those foods, only water, cooking oil, black pepper and ordinary fresh or dried herbs may be used. Never use salt or salt substitutes, and any other ingredient makes the dish unusable.
  4. Plan one serving using about one typical portion of each listed food, with at most 6 listed foods per dish.
  5. For one serving the whole meal must stay at or under sodium A mg, potassium B mg and phosphorus C mg, which is one third of the patient's daily limits. A/B/C = Math.floor(limit * MEAL_SHARE_OF_DAILY_LIMIT).
  6. Put every listed food the dish needs in missing as {name, quantity} using the list's exact name. Put only water, oil, pepper or herbs in uses.
  7. Avoid: {profile.avoid}. Prefer low-sodium preparation without salt substitutes. Return JSON only matching the schema.
- proposalCount = Math.min(requestedCount + 2, 5). Ask for a few extra so the stricter check still leaves enough. Proposals = (await proposeMeals(contents, ai)).filter(validMeal).slice(0, proposalCount). FALLBACK_MEALS flows through the same checks, so the fallback works from scratch with no special case.
- Check each meal (null means dropped):
  1. Take the non-staple names from meal.uses and meal.missing and canonicalize each with canonicalFoodName. Build a Map of canonical name → quantity. The quantity comes from the model's missing item when it is a non-empty string, else is filled in later.
  2. Drop the meal if the map is empty or has more than FROM_SCRATCH_MAX_INGREDIENTS entries.
  3. Drop it if any name is not in builtIn. This is checked before any check() call, so an off-list food never triggers a USDA or online lookup and is treated as unverifiable.
  4. results = await Promise.all(names.map(name => check({ food:{ name }, profile }))). Drop the meal if any result has !ok, verdict 'avoid', verdict 'unknown', non-object nutrients, or a TOTAL_KEYS value that is not a finite number. In from-scratch mode an ingredient without numbers makes the meal unverifiable.
  5. totals = per-key sums of results[i].nutrients[key]. Drop the meal if any `totals[key] > profile.limits[key] * MEAL_SHARE_OF_DAILY_LIMIT`. Exactly equal passes.
  6. Return `{ ...meal, uses: meal.uses.filter(isPantryStaple), missing, totals }`. missing lists one `{ name, quantity }` per ingredient, in first-seen order. The name is the model's missing name when it gave one, else the canonical name. The quantity is the model's quantity when present, else that result's `portion` string sliced to 60.
- meals = checked.filter(Boolean).slice(0, requestedCount). If none remain, return `{ ok:true, meals:[], message:"I couldn't put together a meal I could check fully against your limits." }`. Otherwise return `{ ok:true, meals }`.

Kitchen mode keeps no totals. This is the stated decision, for a follow-up.
  </action>
  <verify>
    <automated>node --test renal/meals.test.mjs renal/gemini.test.mjs renal/contract.test.mjs renal/check.test.mjs</automated>
  </verify>
  <done>All T1–T10 pass. The existing renal gemini, contract and check tests pass unchanged. `grep -n "Foods actually seen" renal/meals.mjs` shows the line only inside kitchenPrompt.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: suggest_meal from_scratch parameter, no_safe_meal, totals in the result, and the prompt sentence</name>
  <files>agent/tools.mjs, agent/tools.test.mjs, agent/prompt.mjs, agent/prompt.test.mjs</files>
  <behavior>
    Add a describe block 'quick 261114-kvi: meal ideas from scratch' at the end of agent/tools.test.mjs. Use a fake from-scratch meal M: title 'Herbed chicken with rice and cabbage'; uses ['olive oil']; missing [{ name:'unsalted chicken', quantity:'3 ounces cooked (85 g)' }, { name:'white rice', quantity:'1 cup cooked (158 g)' }, { name:'cabbage', quantity:'1 cup shredded (75 g)' }, { name:'Water', quantity:'1 cup' }]; minutes 25; steps ['Cook the rice.','Pan-cook the chicken with herbs.','Steam the cabbage.']; why 'Low in sodium.'; totals { sodiumMg:79, potassiumMg:370, phosphorusMg:182 }.
    - S1 from_scratch with nothing seen. Use rec(renal-with-suggestMeals→{ok:true,meals:[M]}). Call `execute({ from_scratch: true })` before any look. renal is called once, and calls[0] deepEquals `{ foods: [], profile: <Sam profile>, count: 2, fromScratch: true }` (check foods, count, fromScratch and profile.name). The result is ok:true. meals[0].totals deepEquals M.totals. meals[0].missing includes 'unsalted chicken', 'white rice' and 'cabbage'. JSON.stringify(result).length is at most 900.
    - S2 start_cart after from_scratch. Using rec(actions,'startCart'), call start_cart({ items: [] }). calls[0].items deepEquals the three non-water items with their quantities (Water is filtered by KITCHEN_BASICS).
    - S3 text_recipe after from_scratch, with a phone set and rec(actions,'sendText'). It returns ok, and the sent text includes the title and 'nothing from your kitchen'.
    - S4 from_scratch true after a look. After look_at_camera, calls[0].foods deepEquals [] and calls[0].fromScratch === true.
    - S5 kitchen behaviour unchanged. With from_scratch false and also absent, before any look, the result is error 'nothing_seen' and renal is not called. After a look with execute({}), calls[0] has no own property 'fromScratch' and foods are ['banana'].
    - S6 empty from scratch. renal returns { ok:true, meals:[], message:'ignored renal text' }. The result is ok:false with error 'no_safe_meal', say is non-empty, the JSON does not include 'ignored renal text', and text_recipe → 'no_recipe'.
    - S7 bad totals are omitted. A meal with totals { sodiumMg: 'lots' } or with no totals gives no 'totals' key on that result meal.
    - S8 size bound. Two meals, each with 6 missing items of 70-character names, long titles, why and steps. The result stays at most 900 characters and is not the TOO_LONG summary (r.meals exists).
    - prompt.test.mjs: extend the 'kitchen and recipe rules' first test word list with 'from_scratch'. Keep every existing word.
  </behavior>
  <action>
In agent/tools.mjs:

(a) Add a FAILS entry `no_safe_meal`: "I couldn't put together a meal I'm sure fits your limits right now. Tell me a food you have or want, and I'll check it for you."

(b) suggest_meal changes:
- Add `parameters: z.object({ from_scratch: z.boolean().nullish() })`.
- Description: 'Suggest meals within the caller\'s limits. By default it cooks from everything the caller showed from their kitchen (fridge, pantry, cupboards). Set from_scratch true when the caller wants an idea without showing their kitchen, has nothing at home, or says to just suggest something; then every ingredient is a shopping item.'
- execute becomes `guard(async (call, args = {}) => { ... })` with `const fromScratch = args?.from_scratch === true`.
- When fromScratch is false, keep the current code byte-for-byte in behaviour: pantryNow → lastFoods → `nothing_seen`, then the same renal call object `{ foods, profile: got.profile, count: 2 }` with no fromScratch key.
- When fromScratch is true, skip the pantry lookup and the nothing_seen check. Get the profile the same way (profile_unavailable on failure), then call `renal.suggestMeals({ foods: [], profile: got.profile, count: 2, fromScratch: true })`.
- `!r?.ok` → check_failed, as today. Empty meals → `fail(fromScratch ? 'no_safe_meal' : 'not_enough_food')`.
- Keep the seen/KITCHEN_BASICS dedupe, the `if (!call.timedOut)` guard around lastMissing/lastMeals, and the `memory && !call.timedOut` memory.add, all unchanged and used by both modes.
- In the returned meal objects, add `...(three(m?.totals) ? { totals: three(m.totals) } : {})` after `why`, so only real numbers renal returned are passed. Change the missing slice from 4 to 6 so a from-scratch shopping list is shown whole. Kitchen meals have at most 3 missing, so nothing changes there.
- When fromScratch is true, add top-level `totalsAre: 'per serving, one typical portion of each ingredient'` so the model states the basis honestly.
- Keep `limit: MEALS_LIMIT`. The existing fit/shrink path bounds the size.

(c) agent/prompt.mjs, in the kitchen sentence (instructions line 8):
- Change its opening to "When the caller wants meal ideas or asks what to cook from what they have, ask them to show their fridge first ...". Keep the rest of that sentence, including "if it says nothing was seen, ask them to show the fridge".
- Then insert one sentence: "When they ask for a meal idea without showing food, have nothing at home, or say to just suggest something, call suggest_meal with from_scratch true, say the dish and its sodium, potassium and phosphorus totals exactly as returned (per serving, one typical portion of each ingredient), and offer to add its ingredients to the cart with start_cart; if it says it could not find one, say its say sentence."
- Do not change the never-invent-numbers or never-pay sentences.

(d) Write the tests listed in behavior. Keep every existing test unchanged.
  </action>
  <verify>
    <automated>node --test agent/tools.test.mjs agent/prompt.test.mjs agent/contract.test.mjs</automated>
  </verify>
  <done>S1–S8 and the prompt test pass. Every pre-existing agent test passes unchanged. `grep -n "fromScratch: true" agent/tools.mjs` shows the from-scratch renal call.</done>
</task>

<task type="auto">
  <name>Task 3: Shared contract and READMEs (identical in all three), full test run, live Gemini check, cleanup</name>
  <files>agent/README.md, renal/README.md, actions/README.md</files>
  <action>
(a) Shared contract. In all three READMEs, replace the suggestMeals row with exactly the same line, using one scripted node or perl replacement applied to all three files:
`| \`suggestMeals({ foods, profile, count, fromScratch? }, { ai }?)\` where \`foods\` is \`string[]\` (ignored when \`fromScratch\` is true) | \`{ ok, meals: [{ title, uses: string[], missing: CartItem[], minutes, steps: string[], why, totals? }] }\`. With \`fromScratch: true\` every non-staple ingredient is in \`missing\`, and each meal has \`totals: { sodiumMg, potassiumMg, phosphorusMg }\` (one typical portion of each ingredient, each total at most one third of the daily limit). |`
Change nothing else in the Shared contract sections. The time budget in rule 3 stays at about 5.1 s. Then verify that `for f in agent renal actions; do awk '/^## Shared contract/{p=1} /^## Track/{p=0} p' $f/README.md | shasum; done | sort -u | wc -l` prints 1.

(b) agent/README.md Tools table only (outside the shared section):
- Replace the suggest_meal row's first cell with `suggest_meal` (optional `from_scratch`).
- The "What it does" cell becomes: Suggests a meal from everything remembered from the kitchen; with `from_scratch` true, a meal built only from the built-in food list, with every ingredient on the shopping list and per-serving sodium, potassium and phosphorus totals.
- Add `no_safe_meal` (from scratch: no meal could be fully checked within the limits) to the failure codes.

(c) renal/README.md, in the `### suggestMeals` section (Track B part, outside the shared section), append a paragraph covering:
- From-scratch mode (`fromScratch: true`): Gemini gets its own prompt listing only built-in foods that check ok or limit for this patient, with their per-portion numbers from checkFood. Every non-staple ingredient must be on the built-in list, pass checkFood (not avoid or unknown) with three real numbers, and number at most `FROM_SCRATCH_MAX_INGREDIENTS` (6). The summed totals must each be at most `MEAL_SHARE_OF_DAILY_LIMIT` (one third) of the daily limit. Totals count one typical portion of each ingredient and nothing is estimated. FALLBACK_MEALS work in this mode too.
- The `check` option is a test seam that defaults to checkFood.
- Follow-up: the from-the-kitchen mode does not check totals yet, because kitchen foods can be judged from USDA, online or label numbers with different serving bases, or with missing phosphorus.

(d) Run `npm test` from the worktree with no .env.local. Every test must pass. Record the pass count (it was 464 before; expect 464 plus the new tests and 0 failures).

(e) Commits. Stage files by name only.
- Task 1: renal/meals.mjs and renal/meals.test.mjs, message `feat(renal): meal ideas from scratch within the per-meal share of the renal limits`.
- Task 2: agent/tools.mjs, agent/tools.test.mjs, agent/prompt.mjs and agent/prompt.test.mjs, message `feat(agent): suggest_meal from_scratch for callers with nothing to show`.
- Task 3: all three READMEs in ONE commit, `docs: suggestMeals fromScratch in the shared contract`.
- Each message ends with the Co-Authored-By line from the system attribution. Never stage node_modules.

(f) Live check: Gemini only, no cart and no Chert. From the worktree root run
`RENAL_STATE_DIR=$(mktemp -d) node --env-file=/Users/ptrczx/Desktop/emoryHackathonDietary-merge/.env.local --input-type=module -e "<script>"`
where the script:
- imports getProfile and suggestMeals from './renal/index.mjs'
- calls getProfile({ patientId: 'demo' })
- times `suggestMeals({ foods: [], profile: p.profile, count: 2, fromScratch: true })`
- prints elapsed ms, whether GOOGLE_API_KEY is set (a boolean only, never the value), whether each title is one of the FALLBACK_MEALS titles (Gemini vs fallback), and per meal the title, missing (name and quantity), uses and totals.
In SUMMARY.md, report the meals, ingredients, totals and timing. If no meal comes back, report it plainly: the demo limits (2300/2000/1000), the per-meal caps (766/666/333) and what Gemini proposed if you can see it. Do NOT loosen MEAL_SHARE_OF_DAILY_LIMIT or any check to make it pass.

(g) Cleanup. Run `rm node_modules` (the symlink). Then `git status --porcelain` must show only the uncommitted SUMMARY.md.
  </action>
  <verify>
    <automated>for f in agent renal actions; do awk '/^## Shared contract/{p=1} /^## Track/{p=0} p' $f/README.md | shasum; done | sort -u | wc -l | grep -qx ' *1' && grep -c "fromScratch" renal/README.md agent/README.md actions/README.md && npm test 2>&1 | tail -8</automated>
  </verify>
  <done>The three Shared contract sections are byte-identical and carry the new suggestMeals row. The agent Tools table and renal notes are updated. npm test passes with no .env.local and no failures. The live check results (meals, ingredients, totals, ms, Gemini vs fallback) are in SUMMARY.md. The node_modules symlink is removed. Nothing is pushed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Gemini → renal/meals.mjs | Proposed meals are untrusted model output (names, quantities, steps) |
| voice model → suggest_meal | Tool arguments (from_scratch) come from the LLM |
| renal → voice model → caller | Health guidance spoken to a patient with a serious condition |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-kvi-01 | Tampering | renal/meals.mjs from-scratch proposals | mitigate | validMeal schema check; every non-staple ingredient must be on the built-in list and pass checkFood (not avoid/unknown) with three finite numbers; whole-meal totals ≤ MEAL_SHARE_OF_DAILY_LIMIT of each limit; otherwise dropped |
| T-kvi-02 | Information/Integrity (health) | totals spoken to caller | mitigate | totals are only sums of checkFood numbers; agent passes them only via three() (all finite); totalsAre states the basis; prompt keeps "Never invent or estimate nutrient numbers" |
| T-kvi-03 | Denial of Service | Gemini latency / off-list lookups | mitigate | 5.1 s budget with fallback model then FALLBACK_MEALS; off-list names rejected before any checkFood call so no USDA/web lookup in from-scratch mode; agent guard 12 s |
| T-kvi-04 | Elevation of Privilege | suggest_meal args | mitigate | zod `z.boolean().nullish()`; only `=== true` enables the mode; renal validates fromScratch is boolean |
| T-kvi-05 | Repudiation/Safety | cart from a suggestion | accept | start_cart only fills a cart, never pays (unchanged); KITCHEN_BASICS filtering unchanged |
| T-kvi-SC | Tampering | package installs | accept | no new dependency; node_modules symlinked from the main checkout, never committed |
</threat_model>

<verification>
- `node --test renal/meals.test.mjs` passes, and the existing renal tests pass unchanged.
- `node --test agent/tools.test.mjs agent/prompt.test.mjs agent/contract.test.mjs` passes.
- `npm test` passes with no .env.local, with 0 failures and more than 464 tests passing.
- The Shared contract sections hash to one value across the three READMEs.
- The live from-scratch call for patient `demo` is reported with meals, ingredients, totals and elapsed ms.
</verification>

<success_criteria>
- A caller with nothing to show can say "just suggest something". The agent calls suggest_meal with from_scratch true and says a real dish with its per-serving sodium, potassium and phosphorus as returned. start_cart with an empty list then fills the cart with all its ingredients.
- No from-scratch meal is ever returned unless every ingredient was judged from real built-in numbers and each meal total is within one third of the daily limit. Otherwise the tool says it cannot suggest one (no_safe_meal).
- From-the-kitchen mode and every existing test are unchanged.
</success_criteria>

<output>
Create `.planning/quick/261114-kvi-meal-ideas-from-scratch-within-the-renal/261114-kvi-SUMMARY.md` when done (leave it uncommitted), including the live check results and the kitchen-mode follow-up note.
</output>
