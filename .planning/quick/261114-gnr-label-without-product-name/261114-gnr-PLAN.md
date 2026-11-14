---
phase: quick-261114-gnr
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - agent/tools.mjs
  - agent/tools.test.mjs
  - agent/prompt.mjs
  - agent/prompt.test.mjs
  - agent/toollog.test.mjs
  - agent/README.md
autonomous: true
requirements: [QUICK-261114-gnr]

must_haves:
  truths:
    - "A Nutrition Facts panel with no product name but a sodium, potassium or phosphorus number is judged and the caller hears a verdict sentence naming 'this product', not 'I couldn't spot any food there'"
    - "A nameless label with only an ingredient list is judged through renal.checkFood (a phosphate ingredient gives a limit verdict)"
    - "A nameless label verdict never carries a nutrient number that is not printed on the label (a number from a name lookup of 'this product', or an online result, is refused with label_unreadable)"
    - "The look result says unnamed: true, and the model is told it may ask what the product is or to see the front, while still saying the verdict sentence as given"
    - "A nameless label is never added to the pantry, to lastFoods (suggest_meal) or to the log_meal candidates"
    - "A label with nothing usable fails with label_unreadable, whose sentence asks for the front of the package or a closer nutrition panel"
    - "A label with a product name behaves exactly as before"
    - "Water, ice, pepper and cooking oils listed as missing by a recipe never reach lastMissing, the saved shopping list or start_cart; the texted recipe still lists them"
  artifacts:
    - path: "agent/tools.mjs"
      provides: "nameless label path in look_at_camera, label_unreadable code, KITCHEN_BASICS filter in suggest_meal"
      contains: "label_unreadable"
    - path: "agent/prompt.mjs"
      provides: "rule for unnamed look results"
      contains: "unnamed"
    - path: "agent/tools.test.mjs"
      provides: "tests for nameless labels and kitchen basics"
      contains: "this product"
  key_links:
    - from: "agent/tools.mjs look_at_camera"
      to: "renal.checkFood"
      via: "food { name: 'this product', label: seen.label }"
      pattern: "this product"
    - from: "agent/tools.mjs suggest_meal"
      to: "lastMissing / memory.add / start_cart"
      via: "KITCHEN_BASICS exact-name skip"
      pattern: "KITCHEN_BASICS"
---

<objective>
Fix the live-call failure where a caller held a can's Nutrition Facts panel to the camera and the agent said "I couldn't spot any food there" twice. Vision read the panel correctly, but a Nutrition Facts panel does not show the product name, so `label.product` was null and look_at_camera threw the label away. Also stop suggest_meal from putting kitchen basics such as "water" on the caller's shopping list.

Purpose: the core value is "point the camera at food and get a correct, specific answer". A label is the most precise thing a caller can show; it must never be a dead end.
Output: agent/tools.mjs (nameless label path, `label_unreadable`, kitchen-basics filter), prompt rule, tests, Track A README rows.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@.planning/STATE.md
@agent/tools.mjs
@agent/prompt.mjs

Working directory: /Users/ptrczx/Desktop/emoryHackathonDietary-build (git worktree, branch `build/label`). zsh. `node_modules` is a symlink: never run npm install. Local only: never push, fetch or pull. Never touch /Users/ptrczx/Desktop/emoryHackathonDietary or /Users/ptrczx/Desktop/emoryHackathonDietary-merge. Never change anything under renal/ or actions/ (other tracks' modules; READ ONLY). Never invent nutrient numbers.

<interfaces>
<!-- Extracted from the codebase; use directly. -->

renal.describeImage result for the failing frames (reproduced by the orchestrator):
  { ok: true, kind: 'label', foods: [], label: { product: null, servingSize: '1 Can - 12 fl oz', sodiumMg: 25, potassiumMg: null, phosphorusMg: null, ingredients: 'Carbonated water, natural flavors, citric acid, ... sodium citrate, sucralose, acesulfame potassium.' } }
  (second frame: same with ingredients: null). renal/vision.mjs validation: kind 'label' always has a non-null label object; label nutrient fields are finite numbers or null; text fields strings or null.

agent/tools.mjs today (look_at_camera, lines ~296-305):
  const seen = await renal.describeImage({ jpeg: picture });
  if (!seen?.ok) return fail('vision_failed');
  if (seen.kind === 'unclear') return fail('unclear_picture');
  const named = f => f && typeof f.name === 'string' && f.name.trim();
  const all = seen.label?.product ? [{ name: seen.label.product, label: seen.label }] : (Array.isArray(seen.foods) ? seen.foods : []).filter(named);
  const foods = all.slice(0, 6); const notChecked = all.length - foods.length;
  if (foods.length === 0) return fail('no_food_seen');
  Later: lastFoods = foods.map(...) and good.forEach(g => remember(g.v, g.name)) inside `if (!call.timedOut)`;
  pantry add only when (kind fridge|shelf) && !seen.label?.product && place !== 'store';
  shelf pick only when kind shelf && place !== 'home' && !seen.label?.product && foods.length >= 2;
  build() returns { ok, kind, unjudged?, online?, remembered?, best?/spoken?, results, omitted?, say? }.
  FAILS map (line ~77) + fail(error, extra) => ({ ok:false, error, say: FAILS[error], ...extra }).

renal/check.mjs checkFood({ food, profile }) (READ ONLY):
  - requires non-empty food.name; food.label object -> label path.
  - label with any finite sodiumMg/potassiumMg/phosphorusMg: nutrients = label numbers only (other keys null), source 'label', NO lookup, NO network.
    say = `${'Okay'|'Limit'|'Avoid'}, ${name} has about ${numberWords(worst)} milligrams of ${'sodium'|...}.` -> with name 'this product': "Okay, this product has about twenty five milligrams of sodium." (grammatical).
  - label with no numbers: calls lookupFood(name) (seed -> generic seed -> USDA search -> online web lookup). With name 'this product' a lookup could in principle return numbers for some other food. If nothing is found, nutrients are all null and the ingredient rules decide: /phos/i or /potassium\s+chloride/i in label.ingredients -> verdict 'limit', source 'rule', say "Limit this product. phosphate additive in the ingredients can add phosphorus not shown on the label"; otherwise verdict 'unknown', nutrients null.
  - countsAsFluid tests the name, so 'this product' never adds the fluid note (acceptable; no invented data).

agent/toollog.mjs: code pattern /^[a-z_]{1,40}$/ already accepts `label_unreadable` (no change needed).

Test helpers in agent/tools.test.mjs: build(over), camOk, verdictFor(food, verdict, say), rec(obj, name, impl), PHONE = '+15551234567', makeFakeRenal({ scenes }), memory tests use createMemory({ patientId:'demo', dir }) via a local withMemory(dir, over) helper inside describe blocks (copy that pattern into the new describe). globalThis.fetch is stubbed to throw ('network used'), so any accidental network call fails loudly.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: look_at_camera judges a label with no product name as "this product"</name>
  <files>agent/tools.mjs, agent/tools.test.mjs, agent/prompt.mjs, agent/prompt.test.mjs, agent/toollog.test.mjs</files>
  <behavior>
    New describe block in agent/tools.test.mjs, "quick 261114-gnr: a label without a product name":
    - Sodium-only nameless label (the exact live payload: kind 'label', foods [], label { product: null, servingSize: '1 Can - 12 fl oz', sodiumMg: 25, potassiumMg: null, phosphorusMg: null, ingredients: null }) run through the REAL checkFood (import { checkFood } from '../renal/index.mjs' and pass renal: { ...renal, describeImage: ..., checkFood }); this label path is offline (label numbers skip every lookup). Expect ok true, unnamed true, kind 'label', results.length 1, results[0].food 'this product', results[0].verdict 'ok', results[0].spoken starts with 'Yes, ' and matches /this product has about twenty five milligrams of sodium\.$/. Also with a recording fake checkFood assert it was called once with food deep-equal { name: 'this product', label } (label object passed through unchanged).
    - After that look on a tool set built with memory (kind 'fridge', foods [], same nameless label, place 'home', to prove the skip is explicit and not just a kind check): pantry_list count 0, result has no remembered; suggest_meal returns error 'nothing_seen' and suggestMeals is never called; log_meal({ foods: ['this product'] }) returns error 'nothing_to_log'.
    - Ingredients-only nameless label (all numbers null, ingredients 'Water, sugar, sodium phosphate, citric acid') with a fake checkFood that mimics renal's ingredient rule (returns verdict 'limit', food a.food.name, say 'Limit this product. Phosphate additive in the ingredients can add phosphorus not shown on the label.', nutrients { sodiumMg: null, potassiumMg: null, phosphorusMg: null }, source 'rule'): ok true, unnamed true, results[0].verdict 'limit', spoken starts with 'Small portion, '.
    - Number guard: nameless label with no numbers but ingredients, fake checkFood returns verdict 'avoid' with nutrients { sodiumMg: 900, potassiumMg: null, phosphorusMg: null } (as if a name lookup of 'this product' matched another food) -> ok false, error 'label_unreadable'. Same when the fake returns source 'web'. Also a nameless label with sodiumMg 25 whose fake verdict reports sodiumMg 30 (does not match the label) -> label_unreadable.
    - Nothing usable: label { product: null, servingSize: '1 cup', all numbers null, ingredients null } and also ingredients '   ' -> ok false, error 'label_unreadable', say matches /front/ and /closer/; checkFood never called.
    - Named label unchanged: the existing 'judges the label product once' test still passes untouched, and a new assertion that a named label result has no unnamed key.
    - A plate/fridge look with named foods and a nameless label object whose kind is not 'label' still uses the foods (foods win when kind is not 'label').
    - Profile unavailable on a nameless usable label -> ok true, unjudged true, unnamed true, and still nothing remembered.
    - agent/toollog.test.mjs: toolLogLine('look_at_camera', { output: JSON.stringify({ ok: false, error: 'label_unreadable' }) }) logs error=label_unreadable (follow the file's existing test style).
    - agent/prompt.test.mjs: instructions include 'unnamed' and 'front of the package'.
  </behavior>
  <action>
    Write the failing tests first (commit `test(agent): nameless label and label_unreadable cases`), then implement in agent/tools.mjs and commit `fix(agent): judge a nutrition label that shows no product name`.

    In agent/tools.mjs:
    1. Add to FAILS: `label_unreadable` with the sentence "I can't read enough on that side of the package. Please show me the front of the package, or hold the nutrition panel a little closer." (requirement 2; `unclear_picture` does not fit because it never asks for the front, so a specific code is added; the toollog pattern already accepts it).
    2. Add a module constant UNNAMED_PRODUCT = 'this product' (verified: renal/check.mjs composes "<Verdict>, this product has about N milligrams of <nutrient>." and "Limit this product. ..." which read naturally).
    3. In look_at_camera after the unclear check, compute: `product` = cleaned trimmed seen.label?.product when seen.label is a non-null object; `namedFoods` = seen.foods filtered by `named`; `nameless` = seen.label is a non-null object AND no product AND (seen.kind === 'label' OR namedFoods.length === 0). `usable` = any of sodiumMg/potassiumMg/phosphorusMg is a finite number >= 0, OR ingredients is a string with non-whitespace content. Then: if product -> today's single label food (unchanged, requirement 3); else if nameless and usable -> all = [{ name: UNNAMED_PRODUCT, label: seen.label }]; else if nameless and not usable -> return fail('label_unreadable') before getProfile/checkFood; else -> namedFoods (unchanged). Keep `no_food_seen` for an empty foods list.
    4. Number guard for the nameless path only, applied to each ok verdict before it is used: refuse the verdict when v.source === 'web', or when for any of the three nutrient keys v.nutrients?.[key] is a finite number and it is not equal to the label's own finite value for that key. A refused verdict makes look_at_camera return fail('label_unreadable') (do not speak it, do not remember it). Reason in a comment: renal/check.mjs falls back to a name lookup when a label has no numbers, and 'this product' is not a real food name, so only numbers printed on the label may reach the caller (never invent nutrient numbers).
    5. For the nameless path skip every memory side effect inside `if (!call.timedOut)`: do not set lastFoods (leave the [] set at the start), do not call remember(), and do not add to the pantry (add `&& !nameless` to the pantry condition) or run the shelf pick (add `!nameless`). Requirement 1: there is no name to remember.
    6. In build() add `...(nameless ? { unnamed: true } : {})` next to kind.
    7. Extend the look_at_camera tool description with: "If the result has unnamed true, the product name was not visible: say each spoken sentence as given, then you may ask what the product is or to see the front of the package."

    In agent/prompt.mjs `instructions`, add one sentence after the "Say each result's spoken sentence as given..." rules: "If look_at_camera returns unnamed true, the label showed no product name: still say its spoken sentence as given, then you may ask what the product is or ask them to show the front of the package." Do not use the phrases 'camera yet', 'never claim to see food' or 'could not check it' (the existing tools.test prompt test forbids them). Keep every existing sentence.

    Do not touch renal/, actions/, or fake-modules.mjs defaults (per-test overrides cover the cases; changing the default fake would ripple through unrelated tests).
  </action>
  <verify>
    <automated>cd /Users/ptrczx/Desktop/emoryHackathonDietary-build && node --test agent/tools.test.mjs agent/prompt.test.mjs agent/toollog.test.mjs</automated>
  </verify>
  <done>All new nameless-label tests pass; the live payload gives "Yes, ... this product has about twenty five milligrams of sodium." with unnamed true; label_unreadable is returned for an unusable label and for a verdict carrying numbers not on the label; named labels and food lists behave as before; nothing nameless reaches pantry, lastFoods or log_meal candidates.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: kitchen basics never reach the shopping list or the cart; README rows</name>
  <files>agent/tools.mjs, agent/tools.test.mjs, agent/README.md</files>
  <behavior>
    New test(s) in agent/tools.test.mjs (memory-backed, same withMemory pattern; phone: PHONE; actions recorded with rec(actions, 'startCart')):
    - suggestMeals overridden (rec(renal, 'suggestMeals', () => ...)) to return one meal { title: 'Rice bowl', uses: ['rice'], missing: [{ name: 'Water', quantity: '1 cup' }, { name: ' olive  oil ', quantity: '1 tbsp' }, { name: 'black pepper', quantity: 'pinch' }, { name: 'unsalted butter', quantity: '1 tbsp' }, { name: 'salt-free seasoning', quantity: '1 tsp' }], minutes: 20, steps: ['Cook.'], why: 'Low sodium.' } after a default look.
    - shopping_list.needed deep-equals ['unsalted butter', 'salt-free seasoning'].
    - start_cart({ items: [] }) calls startCart with exactly [{ name: 'unsalted butter', quantity: '1 tbsp' }, { name: 'salt-free seasoning', quantity: '1 tsp' }].
    - suggest_meal's own result still lists the recipe's missing names as renal returned them (meals[0].missing includes 'Water'), and text_recipe({ position: 1 }) sends text containing 'Water (1 cup)' (the texted recipe keeps the recipe's own list).
    - A meal whose only missing item is 'salt' keeps 'salt' (salt is deliberately not a basic).
    - The existing 'suggest_meal adds the missing items to needed' test (unsalted chicken broth) still passes.
  </behavior>
  <action>
    Write the failing test first (commit `test(agent): kitchen basics stay off the shopping list`), then implement and commit `fix(agent): keep water and other kitchen basics off the shopping list`.

    In agent/tools.mjs add a module constant KITCHEN_BASICS = new Set(['water', 'tap water', 'ice', 'black pepper', 'pepper', 'cooking oil', 'oil', 'olive oil', 'vegetable oil']) with a comment: exact normalized names only; salt is deliberately absent (a renal recipe should not call for salt, and hiding it would hide a bad recipe); salt-free seasoning is a real shopping item. In suggest_meal's loop that fills the `seen` Map (the source of lastMissing and memory.add, and therefore start_cart), skip an item when its key (already clean(...) then lower-cased; clean collapses and trims whitespace) is in KITCHEN_BASICS (requirement 4). Leave lastMeals[].missing (texted recipe) and the returned meals[].missing untouched.

    In agent/README.md, Track A section only (never the "Shared contract" section): in the Tools table add `label_unreadable` to the look_at_camera failure codes; in the "What changed in your module during the merge" list add one bullet: a label with no printed product name is judged as "this product" with `unnamed: true` (only numbers printed on the label are used, it is not remembered in the pantry or for log_meal, and a label with nothing usable returns `label_unreadable`), and suggest_meal keeps water, ice, pepper and cooking oils off the shopping list and the cart. Commit as `docs(agent): nameless labels and kitchen basics`.

    Finally run the full suite and confirm the tree is clean outside .planning.
  </action>
  <verify>
    <automated>cd /Users/ptrczx/Desktop/emoryHackathonDietary-build && npm test 2>&1 | tail -15 && git status --short -- . ':!.planning'</automated>
  </verify>
  <done>Kitchen-basics tests pass; full `npm test` green (350 previous tests plus the new ones, 0 failures); `git status --short -- . ':!.planning'` prints nothing; commits are small and prefixed test(agent)/fix(agent)/docs(agent); nothing pushed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| camera frame -> renal.describeImage | Whatever is printed on a package becomes model-read text (label fields) |
| renal.checkFood -> voice model | A verdict and numbers are spoken to a patient with kidney disease |
| model -> suggest_meal -> memory / cart | Recipe missing items become shopping list entries and cart items |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-gnr-01 | Tampering (wrong data) | look_at_camera nameless path | mitigate | Number guard: a nameless-label verdict is refused (label_unreadable) when it is from the web or carries any nutrient number not printed on the label, so a name lookup of "this product" can never put another food's numbers in the caller's ear |
| T-gnr-02 | Information disclosure / injection | label text into results | mitigate | Only the fixed name 'this product' and renal's verdict pass through the existing clean() and spokenVerdict(); the label's ingredients text is never copied into the result |
| T-gnr-03 | Tampering | pantry / log_meal memory | mitigate | Nameless looks skip lastFoods, remember() and addPantry, so 'this product' never becomes a stored food name |
| T-gnr-04 | Denial of service | ingredients-only nameless label | accept | renal may spend up to ~8 s on a lookup of 'this product'; the existing 12 s guard returns timeout with no state change |
| T-gnr-05 | Tampering | KITCHEN_BASICS filter | accept | Exact-match short list; salt deliberately not filtered so a bad recipe stays visible |
</threat_model>

<verification>
- node --test agent/tools.test.mjs agent/prompt.test.mjs agent/toollog.test.mjs passes
- npm test passes in full
- git diff --stat 23d4399 -- renal actions prints nothing (other tracks untouched)
- git status --short -- . ':!.planning' prints nothing
- grep -n "label_unreadable" agent/tools.mjs agent/README.md finds the FAILS entry and the README row
</verification>

<success_criteria>
The live payload that produced "I don't spot any food there" now yields an ok look with unnamed true and the spoken verdict for "this product"; a label with nothing usable asks for the front or a closer panel; named labels are unchanged; water and other kitchen basics no longer reach the shopping list or the cart; no file under renal/ or actions/ changed; full test suite green; nothing pushed.
</success_criteria>

<output>
Create `.planning/quick/261114-gnr-label-without-product-name/261114-gnr-SUMMARY.md` when done
</output>
