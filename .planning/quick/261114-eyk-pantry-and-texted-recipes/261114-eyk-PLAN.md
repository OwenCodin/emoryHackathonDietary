---
phase: quick-261114-eyk
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - agent/memory.mjs
  - agent/memory.test.mjs
  - agent/tools.mjs
  - agent/tools.test.mjs
  - agent/fake-modules.mjs
  - agent/prompt.mjs
  - agent/prompt.test.mjs
autonomous: true
requirements: [EYK-1-pantry-memory, EYK-2a-suggest-from-pantry, EYK-2b-pantry-list, EYK-2c-pantry-remove-clear, EYK-2d-text-recipe, EYK-3-prompt, EYK-4-tests]

must_haves:
  truths:
    - "After the caller shows the fridge and then the cupboards (two look_at_camera calls of kind fridge or shelf), the agent remembers the foods from BOTH shots, with no duplicates (case-insensitive, cleaned names), at most 40 items"
    - "A plate or a single label look never adds to the pantry, and a look made with place 'store' never adds to the pantry"
    - "The pantry survives into a new buildTools for the same patient (a call back) through agent/memory.mjs, and is gone after the same 2-hour expiry as the shopping list"
    - "suggest_meal passes the whole remembered pantry to renal.suggestMeals (falling back to the last look when the pantry is empty); foods judged avoid are still passed and renal decides; nothing_seen only when both are empty"
    - "pantry_list says what is remembered in short spoken-friendly form; remove_from_pantry removes named items; clear_pantry forgets everything, in this call and for the next call"
    - "text_recipe texts exactly one suggested meal (by title or position, default the only one) to the configured phone as plain text of at most 4000 characters with title, uses, missing, minutes, numbered steps, why it fits and the care-team closing line, built only from cleaned renal.suggestMeals fields"
    - "text_recipe refuses with no_phone, no_recipe, which_recipe and recipe_already_sent; un-marks on a definite failure so a retry works; an unknown outcome or a timeout keeps the mark and is never resent automatically"
    - "The prompt asks for the fridge and then the pantry or cupboards, says it will remember, offers to text the recipe and calls text_recipe only when the caller agrees; every existing rule is kept"
    - "npm test is fully green with no network, no keys, no .env.local, and git status is clean after it runs"
  artifacts:
    - path: "agent/memory.mjs"
      provides: "pantry list in the same per-patient file: addPantry, removePantry, clearPantry; pure helpers mergePantry and matchPantry; PANTRY_MAX"
      exports: ["createMemory", "cleanName", "safePatientId", "defaultStateDir", "MAX_AGE_MS", "MAX_ITEMS", "PANTRY_MAX", "mergePantry", "matchPantry"]
    - path: "agent/tools.mjs"
      provides: "pantry accumulation in look_at_camera, suggest_meal from the pantry, pantry_list, remove_from_pantry, clear_pantry, text_recipe, recipeText"
      exports: ["buildTools", "spokenVerdict", "pickBest", "recipeText", "withTimeout", "endCall"]
    - path: "agent/prompt.mjs"
      provides: "fridge-then-pantry, remember, offer-to-text and pantry tool rules"
      contains: "text_recipe"
    - path: "agent/fake-modules.mjs"
      provides: "makeFakeRenal({ scenes }) returning describeImage results in order"
  key_links:
    - from: "agent/tools.mjs look_at_camera"
      to: "memory.addPantry"
      via: "await memory.addPantry(names) when kind is fridge or shelf, place is not store, and the call has not timed out"
      pattern: "addPantry"
    - from: "agent/tools.mjs suggest_meal"
      to: "renal.suggestMeals"
      via: "foods = remembered pantry (stored union in-call), else lastFoods"
      pattern: "suggestMeals\\(\\{ foods"
    - from: "agent/tools.mjs text_recipe"
      to: "actions.sendText"
      via: "sendText({ phone, text: recipeText(meal) }) after sentRecipes.add"
      pattern: "sendText\\(\\{ phone, text: recipeText"
---

<objective>
Give the FaceTime renal dietitian (Track A, agent/) a memory of what the caller has at home and a way to send a recipe by iMessage. The caller shows the fridge and then the cupboards, often in several shots; the agent remembers all of it (this call and the next call, same 2-hour expiry as the shopping list), suggests renal-safe meals from everything it has seen, can say, fix or forget what it remembers, and can text one chosen recipe to the caller's verified phone.

Purpose: covers the PROJECT.md requirement "Agent can propose a meal from what it sees in the fridge that fits the patient's limits", and closes the gap where a second shot overwrites the first one.
Output: pantry storage in agent/memory.mjs, four new tools plus pantry wiring in agent/tools.mjs, new prompt rules, deterministic tests. No change to renal/, actions/ or any README "Shared contract" section.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/PROJECT.md
@agent/tools.mjs
@agent/memory.mjs
@agent/prompt.mjs
@agent/fake-modules.mjs

Read when the task needs them (do not read twice): agent/tools.test.mjs (helpers lines 9-29 and 179-182; suggest_meal tests 184-208; guarding cases 302-324; prompt test 326-333; WR-04 timeouts 456-476; WR-06 text_cart_link 500-532; shopping list tools 629-691), agent/memory.test.mjs, agent/prompt.test.mjs, renal/meals.mjs (output shape only), actions/text.mjs (error strings only).

<interfaces>
Existing, from agent/memory.mjs (createMemory never throws; every write is serialised through `serial`):
- state shape today: { needed: string[], approved: string[], rejected: string[], updatedAt: number|null }
- readState(): returns emptyState() when the file is missing, a symlink, > 65536 bytes, bad JSON, any of needed/approved/rejected not an array, updatedAt not finite, older than maxAgeMs, or more than 60 s in the future.
- writeState(state): writes exactly { needed, approved, rejected, updatedAt: now() } (each list through cleanList, capped at MAX_ITEMS = 50), tmp file mode 600 then rename. Returns { ok: true, state } or { ok: false, error: 'unavailable' }.
- methods: load() -> { ok, state } | { ok:false, error:'unavailable' }; add(names) -> { ok, added, skipped, state }; mark(name, status) -> { ok, name, status, state } | { ok:false, error:'bad_item'|'unavailable' }.
- cleanName(value): strips links and control characters, collapses spaces, trims, max 80 chars; '' for non-strings.

Existing, from agent/tools.mjs:
- clean(value, max), norm(s) (lower-case, collapsed spaces), fail(code, extra) -> { ok:false, error, say: FAILS[code], ...extra }, guardTool via guard(fn, { timeoutMs, limit, onTimeout }) where fn(call, args) and call.timedOut becomes true on timeout.
- buildTools({ camera, patientId, renal, actions, debugFrameDir, timeoutMs, phone, onToolActivity, memory }); phoneOk = /^\+[1-9]\d{6,14}$/.test(phone).
- look_at_camera (lines 236-305): `all` = every named food from describeImage (or the single label product); `foods = all.slice(0, 6)` are checked; lastFoods/candidates are set only when !call.timedOut; shelf `best` is computed when kind === 'shelf', no label product and >= 2 foods.
- suggest_meal (lines 323-348): fails nothing_seen when lastFoods is empty; calls renal.suggestMeals({ foods, profile, count: 2 }); meals: [{ title, uses: string[], missing: [{ name, quantity }], minutes: int, steps: string[], why }].
- text_cart_link (lines 430-451): the pattern to copy: phoneOk gate, mark in a Set before sending, delete the mark when sendText throws or returns !ok.
- Tool key order asserted by tests: look_at_camera, check_food, suggest_meal, log_meal, todays_totals, start_cart, cart_status, text_cart_link, add_to_shopping_list, shopping_list, mark_item.

From actions/text.mjs: sendText({ phone, text }) -> { ok: true } | { ok: false, error: string }. The error 'Send outcome is unknown; inspect Chert before retrying' means the message may have gone out: never send again. Text must be 1..4000 characters. Its own fetch timeout is 15 s, longer than the tool's default 12 s.

From agent/tools.test.mjs: build(over) builds with camOk, renal/actions fakes, timeoutMs 2000; PHONE = '+15551234567'; rec(obj, fnName, impl?) records calls; clean(r) asserts an ok:false result with a say and no 'SECRET123', 'http' or 'boom'. Every key of build() must appear in prompt.instructions (test at line 326), so each task that adds a tool also names it in agent/prompt.mjs.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Pantry memory, pantry accumulation in looks, suggest_meal from the pantry, pantry_list / remove_from_pantry / clear_pantry</name>
  <files>agent/memory.mjs, agent/memory.test.mjs, agent/fake-modules.mjs, agent/tools.mjs, agent/tools.test.mjs, agent/prompt.mjs</files>
  <behavior>
    - memory: addPantry(['Rice', 'rice ', 'Eggs']) then addPantry(['EGGS', 'apples']) leaves pantry ['Rice', 'Eggs', 'apples']; adding a 41st item drops the oldest so the newest shot always counts (PANTRY_MAX = 40), and the result reports added and dropped.
    - memory: removePantry(['rice', 'apple']) removes 'Rice' (exact, case-insensitive) and 'apples' (substring match, both sides >= 3 chars) and reports removed and notFound; clearPantry() empties only the pantry and leaves needed/approved/rejected untouched.
    - memory: a file written by the old code (no pantry key) still loads with its needed list intact and pantry []; a pantry key that is not an array makes the whole file read as empty (same strictness as the other lists); the stored file has exactly the keys approved, needed, pantry, rejected, updatedAt; the pantry expires with the same 2-hour rule (injected clock); names are cleaned (no links, max 80 chars).
    - tools: a fridge look then a shelf look (fake scenes) accumulate both shots' foods into the pantry without duplicates; a plate look and a label look add nothing; place 'store' adds nothing; a timed-out look adds nothing.
    - tools: suggest_meal passes the whole pantry (both shots, including a food the fake checkFood judges avoid) to renal.suggestMeals; with an empty pantry it still uses the last look (existing test expecting ['banana'] stays green); with neither it fails nothing_seen.
    - tools: a new buildTools with a new createMemory on the same folder sees the pantry (pantry_list names it, suggest_meal passes it with no look in that call); after the injected clock moves past MAX_AGE_MS, pantry_list is empty and suggest_meal fails nothing_seen.
    - tools: pantry_list is short (at most 12 names of at most 40 chars plus a more count, result <= 900 chars) and says a fixed sentence when empty; remove_from_pantry removes matches from the stored list, the in-call list and lastFoods, and fails not_in_pantry when nothing matched; clear_pantry empties everything so suggest_meal then fails nothing_seen; all three still work in-call without memory.
  </behavior>
  <action>
Per required behaviour 1 and 2(a)-(c). Write the tests first (memory.test.mjs new describe 'pantry'; tools.test.mjs new describe 'pantry tools' using mkdtemp-based folders under the existing `dir`, never the default state folder), see them fail, then implement.

agent/memory.mjs (extend, do not add a second persistence scheme; store only food names): add export PANTRY_MAX = 40. Add `pantry: []` to emptyState. In readState: if data.pantry is undefined treat it as [] (old files keep working); if it is present and not an array return emptyState(); return pantry through a capped clean list (PANTRY_MAX). In writeState include pantry (cleaned, capped at PANTRY_MAX) so the body has exactly approved, needed, pantry, rejected, updatedAt. Add two pure exported helpers so tools.mjs can keep an identical in-call copy: mergePantry(list, names, max = PANTRY_MAX) returns { list, added, dropped } (cleanName each, skip empty, case-insensitive de-duplication against the list, when full shift the oldest to make room); matchPantry(list, wanted) returns the stored names that match one wanted name: exact case-insensitive first, otherwise every entry where one contains the other and both are at least 3 characters. Add methods addPantry(names), removePantry(names) -> { ok, removed, notFound, state } and clearPantry() -> { ok, state }, each inside serial() with the same checkFolder/readState/writeState/try-catch shape as add(), never throwing. Update the existing 'stores only the four keys' test to expect the five keys (necessary: the file now carries pantry) and leave every other existing memory test unchanged.

agent/fake-modules.mjs: change makeFakeRenal() to makeFakeRenal({ scenes } = {}): when scenes is a non-empty array, describeImage returns scenes[i] for the i-th call (the last one repeats); otherwise it returns today's plate result. Existing callers keep working unchanged.

agent/tools.mjs: import { mergePantry, matchPantry, PANTRY_MAX } from './memory.mjs'. In buildTools keep `let callPantry = []` (in-call copy, so the pantry works when memory is null or unavailable). Add a helper `pantryNow()` that returns callPantry merged after the stored pantry (memory.load(), ignore failure) using mergePantry, capped at PANTRY_MAX.
look_at_camera: give it parameters z.object({ place: z.enum(['home', 'store']).nullish() }) with the description extended: pass place home for the caller's own fridge, pantry or cupboards and place store in a shop. Read args.place safely (execute receives (call, args = {})). At the same point where lastFoods is set (only when !call.timedOut and the look succeeded), when seen.kind is 'fridge' or 'shelf', there is no single label product, and place is not 'store': take up to 20 names from `all` (not just the 6 checked ones, because suggestMeals re-checks every ingredient), merge them into callPantry and await memory.addPantry(names) inside try/catch (a memory failure never changes the result). Add `remembered: true` to the look result object inside build() only when names were remembered, so the size budget still covers it. When place is 'home' skip the shelf `best` pick (it is a store feature); with place null keep today's shelf behaviour. Do not filter avoid foods out of the pantry (behaviour 1: renal.suggestMeals decides).
suggest_meal: foods = pantryNow(); if empty use lastFoods; if still empty fail('nothing_seen'). Pass them unchanged to renal.suggestMeals({ foods, profile, count: 2 }). Update the description to say it cooks from everything the caller showed from their kitchen. Everything else (missing list, memory.add, result shape, MEALS_LIMIT) stays as is.
New tools, appended after mark_item in this order: pantry_list (no parameters; returns { ok, count, names: first 12 cut to 40 chars, more } or, when empty, { ok: true, count: 0, names: [], say: "I don't remember anything from your kitchen yet. Show me your fridge or cupboards." }; limit LIST_LIMIT); remove_from_pantry (parameters { items: array of 1..20 strings, trimmed, 1..80 chars }; bad input -> fail('bad_items'); applies matchPantry to callPantry and lastFoods and, when memory exists and the call has not timed out, memory.removePantry; nothing matched anywhere -> new FAILS code not_in_pantry "I don't have that in what I remember from your kitchen."; success -> { ok, removed (at most 5, 40 chars), left }, plus say "Done for this call, but I may not remember that next time." when memory exists and its write failed); clear_pantry (no parameters; empties callPantry and lastFoods and calls memory.clearPantry; returns { ok: true, say: "Okay, I've forgotten what you showed me from your kitchen." }, with the same "may not remember" say when the memory write failed). Use guard() with timeoutMs and LIST_LIMIT for all three; state changes only when !call.timedOut.

agent/prompt.mjs (minimal now, full rules in Task 3): add one sentence naming pantry_list, remove_from_pantry and clear_pantry so the existing 'prompt' test (every tool key appears in instructions) stays green.

agent/tools.test.mjs: update the 'buildTools shape' key list with pantry_list, remove_from_pantry, clear_pantry appended. Add the new tests per the behavior block. Commit: test(agent): pantry memory and pantry tools, then feat(agent): remember the caller's fridge and pantry across shots and calls (or one feat commit with its tests if the RED step was not committed separately).
  </action>
  <verify>
    <automated>cd /Users/ptrczx/Desktop/emoryHackathonDietary-merge && node --test agent/memory.test.mjs agent/tools.test.mjs agent/prompt.test.mjs agent/contract.test.mjs</automated>
  </verify>
  <done>All four test files pass, including the new pantry tests in memory.test.mjs and tools.test.mjs; the stored file has exactly approved, needed, pantry, rejected, updatedAt; an old-format file without pantry still loads; the existing suggest_meal, shopping list and WR-04 tests are unchanged and green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: text_recipe sends one suggested meal by iMessage, once</name>
  <files>agent/tools.mjs, agent/tools.test.mjs, agent/prompt.mjs</files>
  <behavior>
    - recipeText(meal) (pure, exported) gives plain text lines: "Recipe from your AI renal dietitian: {title}", "Uses from your kitchen: a, b", "Missing: name (quantity), ..." or "Missing: nothing", "Time: about N minutes" (omitted when minutes is not a positive integer), "Steps:" then "1. ...", "2. ...", "Why it fits: {why}", and last the exact line "This recipe follows the limits set by your care team and does not replace their advice."; links and control characters are stripped from every field; a meal with huge fields still gives at most 4000 characters (steps are dropped from the end until it fits, the closing line is always kept).
    - After look + suggest_meal, text_recipe({}) with exactly one remembered meal sends it; with two meals and no choice it fails which_recipe listing the titles and sends nothing; text_recipe({ position: 2 }) and text_recipe({ title: 'herbed' }) pick the right meal; an unknown title or out-of-range position fails which_recipe.
    - sendText is called exactly once with { phone: PHONE, text } where text equals recipeText of that meal; a second text_recipe for the same recipe fails recipe_already_sent and does not call sendText.
    - No phone ('', 'YOUR_PATIENT_PHONE', undefined) fails no_phone with zero sends; no suggestion yet fails no_recipe with zero sends.
    - sendText returning { ok:false, error:'Chert rejected...' } or throwing fails text_failed and un-marks, so the next text_recipe sends (2 calls total); sendText returning the 'Send outcome is unknown' error fails text_unconfirmed and the next text_recipe fails recipe_already_sent (1 call total); a sendText that never resolves (timeoutMs 30) fails text_unconfirmed and a retry fails recipe_already_sent.
    - A module error text (url, SECRET123, 'boom') never appears in any text_recipe result (add text_recipe to the 'guarding the new tools' cases).
  </behavior>
  <action>
Per required behaviour 2(a) remember-meals and 2(d). Tests first in tools.test.mjs (new describe 'text_recipe'; the fake suggestMeals returns two identical-title meals with count 2, so for the single-meal default use a renal override whose suggestMeals returns one meal, and for title/position use one with two different titles), then implement in agent/tools.mjs.

suggest_meal: when !call.timedOut set `lastMeals` to the meals, each reduced to cleaned fields only: title clean 80, uses up to 12 names clean 60, missing up to 12 of { name clean 80, quantity clean 40 } (drop empty names), minutes kept only when a positive integer up to 600, steps up to 12 clean 300 (drop empty), why clean 300. The spoken result of suggest_meal is unchanged.

Export recipeText(meal) built only from those cleaned fields (never from model arguments), joining lines with a newline (clean() removes control characters inside fields, the newlines are added only between lines). Keep the closing care-team line as a module constant. Guarantee length <= 4000 by removing steps from the end until it fits.

text_recipe tool, appended last (after clear_pantry): parameters z.object({ title: z.string().trim().min(1).max(80).nullish(), position: z.number().int().min(1).max(5).nullish() }). Order of checks: !phoneOk -> fail('no_phone'); lastMeals empty -> fail('no_recipe'); pick: position -> lastMeals[position - 1]; else title -> exact norm() match, otherwise a unique entry whose norm(title) contains the asked text or vice versa (both >= 3 chars); else exactly one meal -> that meal; anything else -> fail('which_recipe', { titles: up to 5 titles cut to 60 }). key = norm(meal.title); if sentRecipes has key -> fail('recipe_already_sent'). Mark sentRecipes.add(key) before sending, then call actions.sendText({ phone, text: recipeText(meal) }). If it throws -> delete the mark, fail('text_failed'). If r.ok -> { ok: true, sent: true, title: meal.title cut to 60 }. If r.error is a string matching /outcome is unknown/i -> keep the mark, fail('text_unconfirmed') and never send again automatically. Any other !ok -> delete the mark, fail('text_failed'). Never copy r.error into the result. guard with timeoutMs and onTimeout: () => fail('text_unconfirmed'); the mark stays on timeout, and if the late work then hits a definite failure it may delete the mark (that is a definite failure, allowed by the requirement).

FAILS: add no_recipe "I haven't suggested a meal yet. Ask me for a meal idea first, and then I can text you the recipe.", which_recipe "Which meal should I text you? Tell me its name, or say the first or the second.", recipe_already_sent "I've already texted you that recipe. Please check your messages.", text_unconfirmed "I tried to text the recipe but couldn't confirm it went through. Please check your messages before we try again.", text_failed "I couldn't send the recipe just now. I can try again if you like." Change no_phone to the neutral "I don't have a phone number to text, so I can't send that." (only its code is asserted by existing tests). Leave text_cart_link's behaviour unchanged.

agent/prompt.mjs: add a minimal sentence naming text_recipe (full wording in Task 3) so the tool-name prompt test stays green. tools.test.mjs: append text_recipe to the 'buildTools shape' list and add text_recipe to the 'guarding the new tools' cases with prep look_at_camera + a suggest_meal whose renal returns one meal, mod 'actions', fns ['sendText']. Commit: feat(agent): text a suggested recipe to the caller by iMessage (with its tests, or a preceding test(agent) commit).
  </action>
  <verify>
    <automated>cd /Users/ptrczx/Desktop/emoryHackathonDietary-merge && node --test agent/tools.test.mjs agent/contract.test.mjs</automated>
  </verify>
  <done>text_recipe sends exactly once per recipe per call with the expected text shape and length <= 4000, refuses with no_phone / no_recipe / which_recipe / recipe_already_sent, retries after a definite failure, and never resends after success, unknown outcome or timeout; no module error text leaks; tools.test.mjs and contract.test.mjs are green.</done>
</task>

<task type="auto">
  <name>Task 3: Prompt rules for fridge-then-pantry, remembering and texting recipes; full green run</name>
  <files>agent/prompt.mjs, agent/prompt.test.mjs</files>
  <action>
Per required behaviour 3. Rewrite the meal part of `instructions` in agent/prompt.mjs (replace the two minimal sentences added in Tasks 1 and 2, keep every other existing rule word for word: one or two short sentences, never invent or estimate nutrient numbers, only tool results carry limits and the care-team line, never pay, say you are an AI, the store/shelf rules, the greeting rule, and the existing sentence "if it says nothing was seen, ask them to show the fridge"). New meaning to express in plain short sentences:
- When the caller wants meal ideas or asks what to cook, ask them to show their fridge first and then their pantry or cupboards, one shot at a time; call look_at_camera with place home for each shot, and tell them you will remember what they have. In a store, call look_at_camera with place store.
- Then call suggest_meal, which cooks from everything they showed from their kitchen.
- After suggesting a meal, offer to text them the recipe; call text_recipe only when they agree, passing the title or position they chose; if it says which_recipe, ask which one; never ask it to send the same recipe twice, and if it says it could not confirm, ask them to check their messages instead of trying again.
- When they ask what you remember they have, call pantry_list; when they say something is gone or was wrong, call remove_from_pantry with those items; when they ask you to forget everything, call clear_pantry.
Also extend timeWarning to say you will remember their shopping list and what they showed you from their kitchen (keep the words 'call back' and 'shopping list').

agent/prompt.test.mjs: add describe 'kitchen and recipe rules' asserting instructions include 'fridge', 'pantry or cupboards', 'place home', 'place store', 'remember', 'suggest_meal', 'text_recipe', 'only when they agree', 'pantry_list', 'remove_from_pantry', 'clear_pantry'; and that the kept rules are still there: 'one or two short sentences', 'Never invent or estimate nutrient numbers', 'care team', 'Never pay', 'ask them to show the fridge'. Add a timeWarning assertion for 'kitchen'. Keep every existing prompt test unchanged.

Then run the full suite and confirm the worktree is clean apart from intended changes: npm test, then git status --short must list nothing after committing. Commits: feat(agent): prompt rules for the kitchen tour and texted recipes; test(agent): prompt covers kitchen and recipe rules (or one commit). Never push or fetch.
  </action>
  <verify>
    <automated>cd /Users/ptrczx/Desktop/emoryHackathonDietary-merge && npm test 2>&1 | tail -n 12 && test -z "$(git status --short -- . ':!.planning')" && echo CLEAN</automated>
  </verify>
  <done>npm test reports zero failures (270 existing tests plus the new ones), no .env.local needed, no network used; git status --short is empty after the final commit; prompt.mjs still carries every existing rule plus the new kitchen and recipe rules.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| vision model -> pantry | food names from renal.describeImage (Gemini output) are stored and later read back into tool results |
| LLM tool arguments -> tools | place, items, title, position come from the voice model and may be wrong or adversarial |
| agent -> iMessage | text_recipe sends text off the device to a phone |
| agent -> local disk | pantry is written to the per-patient state file between calls |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-eyk-01 | Tampering | pantry names (memory.mjs, tools.mjs) | mitigate | every stored name goes through cleanName (no links, no control characters, max 80); list capped at 40; names never enter the greeting text (resumeGreeting stays count-only) |
| T-eyk-02 | Information disclosure | state file | mitigate | reuse memory.mjs folder checks (outside repo, mode 700/600, no symlinks, 64 KB cap, 2-hour expiry); store food names only, no phone, limits or transcripts |
| T-eyk-03 | Spoofing / misuse | text_recipe recipient | mitigate | phone comes only from config (phoneOk gate); actions.sendText additionally refuses any number other than PATIENT_PHONE; the model cannot pass a phone |
| T-eyk-04 | Tampering | recipe text content | mitigate | recipeText is built only from cleaned renal.suggestMeals fields (links and control characters stripped), never from model arguments; length <= 4000; fixed care-team closing line |
| T-eyk-05 | Repudiation / duplication | repeated sends | mitigate | mark before send, one send per recipe per call, unknown outcome and timeout keep the mark and are never retried automatically |
| T-eyk-06 | Information disclosure | error text | mitigate | module error strings are never copied into results; fixed FAILS sentences only; covered by the guarding tests |
| T-eyk-07 | Tampering (health) | meal ingredients | mitigate | the whole pantry, including avoid foods, goes to renal.suggestMeals, which re-checks every ingredient and drops avoid/unknown; the agent does not weaken or bypass it and never invents numbers |
</threat_model>

<verification>
- node --test agent/memory.test.mjs agent/tools.test.mjs agent/prompt.test.mjs agent/contract.test.mjs passes.
- npm test passes in full with no .env.local and no network; git status --short is empty afterwards.
- No file under renal/ or actions/ changed: git diff --stat 3e1b290 -- renal actions prints nothing.
- The "Shared contract" sections of the READMEs are untouched: git diff --stat 3e1b290 -- '*.md' lists only files under .planning/.
</verification>

<success_criteria>
- Two looks (fridge, then cupboards) are both remembered, de-duplicated, capped at 40, and still there on a call back within 2 hours.
- suggest_meal cooks from the whole remembered kitchen and remembers the meals it suggested.
- The caller can hear what is remembered, remove items and clear it.
- text_recipe sends one recipe once, safely, with title, uses, missing, minutes, numbered steps, why and the care-team line.
- The prompt drives the fridge-then-pantry tour, says it will remember, and offers (not forces) the recipe text.
- Full suite green, small conventional commits, nothing pushed.
</success_criteria>

<output>
Create `.planning/quick/261114-eyk-pantry-and-texted-recipes/261114-eyk-SUMMARY.md` when done. In it, list for teammates: the new tool names (pantry_list, remove_from_pantry, clear_pantry, text_recipe), the new optional look_at_camera parameter place, the extra pantry key in the per-patient state file, and that no renal/ or actions/ code or Shared contract changed.
</output>
