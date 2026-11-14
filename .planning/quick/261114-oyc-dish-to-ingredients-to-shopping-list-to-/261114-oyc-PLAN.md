---
phase: quick-261114-oyc
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - renal/dish.mjs
  - renal/dish.test.mjs
  - renal/meals.mjs
  - renal/index.mjs
  - renal/README.md
  - actions/cart-card.mjs
  - actions/cart-card.test.mjs
  - actions/cart.mjs
  - actions/cart.test.mjs
  - actions/index.mjs
  - actions/README.md
  - agent/contract.test.mjs
  - agent/memory.mjs
  - agent/memory.test.mjs
  - agent/tools.mjs
  - agent/tools.test.mjs
  - agent/fake-modules.mjs
  - agent/prompt.mjs
  - agent/prompt.test.mjs
  - agent/README.md
autonomous: true
requirements:
  - OYC-1-dish-ingredients-rechecked
  - OYC-2-short-say-one-question
  - OYC-3-list-preview-card
  - OYC-4-step-by-step-list-edits
  - OYC-5-text-the-list
  - OYC-6-start-cart-exactly-the-list
  - OYC-7-honest-kroger-removal
  - OYC-8-intent-guard-rails

must_haves:
  truths:
    - "Naming or showing a dish and asking for its ingredients gives the dish's usual ingredients (at most 8, no water/oil/pepper/herbs), each with a verdict from checkFood and the built-in swap; no nutrient number ever comes from the model"
    - "With Gemini slow or absent, a ham sandwich, turkey sandwich, omelet or chicken and rice still gets ingredients from a built-in table, re-checked the same way, inside the 12 s tool guard"
    - "After the caller agrees, the ingredients go on the existing shopping list (agent/memory.mjs), and a card titled as NOT in the Kroger cart yet, with Kroger product photos and prices, shows on the call video"
    - "An avoid ingredient is held off the list until the caller keeps it after hearing the warning"
    - "The caller can remove items (remove_from_list), add items and change a quantity; the list card is re-shown after each change"
    - "'Text me the list' texts names and quantities plus the care-team closing line once per content to PATIENT_PHONE"
    - "start_cart with an empty list uses exactly the current list, returns its item names, refuses with confirm_list until the caller has heard that list in this call, fails with nothing_to_buy when the list is empty, and never re-sends items already sent this call"
    - "Asking to remove an item already sent to Kroger always gets the fixed honest sentence; nothing claims it left the Kroger cart"
    - "The prompt has a short numbered dish-and-shopping playbook; start_setup is only for explicit setup/limits/voice/preferences requests"
    - "The preview never loads the user token and never calls /v1/cart/*; npm test is green without .env.local"
  artifacts:
    - path: "renal/dish.mjs"
      provides: "dishIngredients({ dish, profile }, { ai, check, modelMs, checkMs })"
      exports: ["dishIngredients", "DISH_MAX_INGREDIENTS", "BUILTIN_DISHES"]
    - path: "actions/cart.mjs"
      provides: "previewCart on the cart controller (app-token search only, preview card, hold/clear)"
      exports: ["previewCart"]
    - path: "actions/cart-card.mjs"
      provides: "title/footer/totalLabel options; PREVIEW_TITLE, PREVIEW_FOOTER"
      contains: "PREVIEW_TITLE"
    - path: "agent/tools.mjs"
      provides: "dish_ingredients, remove_from_list, set_quantity, text_list tools; start_cart confirm guard; honest-removal sentence"
      contains: "dish_ingredients"
    - path: "agent/memory.mjs"
      provides: "remove(names) and clearList() on the shopping list"
      contains: "clearList"
    - path: "agent/prompt.mjs"
      provides: "numbered dish-and-shopping playbook and start_setup guard"
      contains: "dish_ingredients"
  key_links:
    - from: "agent/tools.mjs dish_ingredients"
      to: "renal.dishIngredients"
      via: "renal module import"
      pattern: "renal\\.dishIngredients"
    - from: "renal/dish.mjs"
      to: "checkFood"
      via: "injected check, every ingredient"
      pattern: "check\\(\\{ food"
    - from: "agent/tools.mjs list tools"
      to: "actions.previewCart"
      via: "best-effort, not awaited, after every list change"
      pattern: "actions\\.previewCart"
    - from: "agent/tools.mjs start_cart"
      to: "memory.load needed list + in-call quantities"
      via: "listNow()"
      pattern: "listNow"
    - from: "Shared contract section"
      to: "agent/README.md, renal/README.md, actions/README.md"
      via: "byte-identical copy, one commit"
      pattern: "dishIngredients"
---

<objective>
Make the agent do the "dish → ingredients → list → text → Kroger cart, step by step, with removals" request end to end.

Purpose: on today's live calls (14 Nov 2026) the model had no dish tool, so call 1 wrongly ran `start_setup` and call 2 ran `start_cart([])`, which silently bought an old leftover list. This plan adds a renal `dishIngredients` (model names + quantities only, every ingredient re-checked by `checkFood`), a read-only actions `previewCart` card ("Your list · not in your Kroger cart yet"), list-editing tools, a list text, a confirmation guard on `start_cart`, an honest fixed sentence for Kroger removals, and a compact prompt playbook.

Output: renal/dish.mjs (+tests), previewCart + card options (+tests), new agent tools + prompt playbook (+tests), shared contract and README updates, one read-only live check.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<executor_environment>
- You run in an isolated git worktree with NO `.env.local` and NO `node_modules`.
- First: `ln -s /Users/ptrczx/Desktop/emoryHackathonDietary-merge/node_modules node_modules` in the worktree root. Never commit it. Stage files BY NAME only, never `git add -A` / `git add .`. Never stage `renal/data/cache.json`.
- Live check only: `node --env-file=/Users/ptrczx/Desktop/emoryHackathonDietary-merge/.env.local <script>`. Never print key values.
- Before finishing: `rm node_modules` (the symlink) so `git status` shows only the uncommitted SUMMARY.md.
- Hard rules: do not start, stop or signal any `npm start` / `chert` / `facetime` process. No `vercel` commands, no texts, no Kroger sign-in, no user-token or cart calls, no FaceTime minutes. Do not touch `~/.config/renal-dietitian/`. No new dependency. Do not push. Do not edit `agent/turns.mjs` (the orchestrator owns that change).
- Baseline: `npm test` passes 639 tests without `.env.local`. It must stay green; new tests use no keys and no network (inject `ai`, `check`, `fetchImpl`; scrub `GOOGLE_API_KEY` where the real default path could run).
- Big files: read `agent/tools.mjs` (1079 lines) and `agent/tools.test.mjs` (1472 lines) in parts; grep `start_cart`, `add_to_shopping_list`, `text_recipe` in the test file for the patterns to copy.
</executor_environment>

<context>
@.planning/STATE.md
@./CLAUDE.md
@agent/prompt.mjs
@agent/memory.mjs
@renal/meals.mjs
@actions/cart-card.mjs

<facts_verified_live_do_not_rederive>
Kroger's PUBLIC API can only ADD to a cart. With a real signed-in token: `GET /v1/carts` → 403 "required scope not found"; `PUT /v1/cart/add` with quantity 0 or -1 → 400 ("Quantity is required" / "Quantity must be at least 1"); there is no remove route; the sign-in page rejects every cart scope except `cart.basic:write` (`cart.basic:rw`, `:read` → invalid_scope). The agent can neither remove nor read items in the real Kroger cart; kroger.com blocks automated browsers. So "remove" must happen on the list BEFORE anything is sent. Kroger cart, cart card, text link, app-token product search, from-scratch meals (fast model first, ~3 s) all work. Replies stay short; calls are capped at 5 minutes. Health guidance uses only real numbers from `checkFood`; nothing is ever paid; limits are the care team's.
</facts_verified_live_do_not_rederive>

<interfaces>
From renal/meals.mjs (private today; Task 1 exports the first two):
- `function isPantryStaple(name)` — water, oils, pepper, herbs.
- `function canonicalFoodName(name, catalog)` — catalog name or alias, else normalized.
- `proposeMeals(contents, injected, { fastFirst })` pattern: no key and no injected ai → fallback; `generateJsonWithFallback({ ai, models: [RENAL_MEALS_FALLBACK_MODEL||'gemini-3.5-flash-lite', RENAL_MEALS_MODEL||'gemini-3.8-flash'], buildRequest: (model, signal) => ({ model, contents, config: { responseMimeType: 'application/json', responseSchema, abortSignal: signal } }), parse, totalMs, hedgeMs, label })` resolves `{ ok, value }` and never rejects (renal/gemini.mjs).
- Catalog (renal/data/foods.json via `readData('foods.json')`) includes: white bread, ham, deli turkey, turkey breast, cheddar cheese, processed cheese, lettuce, tomato, egg, egg white, milk, onion, bell pepper, unsalted chicken, white rice, broccoli, garlic, cucumber, bacon …
- checkFood SWAPS: ham → 'fresh unsalted chicken', deli turkey → 'fresh unsalted chicken', processed cheese → 'a small portion of fresh mozzarella', tomato → 'cabbage'. `checkFood({ food: { name, grams: null }, profile }, { ai })` returns a Verdict `{ ok, food, verdict, say, nutrients, portion, swap, source }`; unknown foods can take ~8 s (USDA 2.4 s, then web 5.5 s).

From actions/cart.mjs `createCartController({ getKrogerConfig, createKroger, publishFrame, activateFrame, renderCard, fetchPicture, setTimer, clearTimer, cardHoldMs, ... })`: internal `hideCard()`, `scheduleHold()`, `cardShown`, `runPromise`, `stopRequested`; `startCart` calls `hideCard()`; `stopCart` sets `stopRequested` and hides. Kroger client (actions/kroger.mjs `createKrogerClient`) exposes `searchProducts(term)` (app token, client_credentials, scope product.compact), `getUserToken()`, `addToCart()`. Helpers: `chooseProduct(itemName, products)` → `{ upc, description, unitPrice } | null`, `pickImageUrl(product)`, `parseQuantity(text)` (leading integer, cap 5), `readKrogerConfig(env)` (null without both keys).

From actions/cart-card.mjs: `cartCardSvg({ storeName, items, step, total, scale })`, `renderCartCard(same)` → exact WIDTH*HEIGHT*4 Uint8Array; `CARD_MAX_TILES = 6`; title is `Your ${store} cart`; FOOTER 'Nothing is paid. Review and check out yourself.'; total text `Total $X`.

From agent/tools.mjs: `guardTool(fn, { timeoutMs, limit, onTimeout })` (fn gets `call` with `timedOut`; `call.display` shown only when the fitted result has `verdict` string or `results` array); `fail(code, extra)` with fixed `FAILS` sentences; `clean(value, max)`; `displayItem(v, name, verdict)`; `normalVerdict`; `RECIPE_CLOSING`; in-call state `lastMissing`, `sentRecipes`, `candidates` (judged foods with verdict); `phoneOk`; `memory` may be null. `text_recipe` shows the once-per-content send pattern (mark before send, unmark on failure, `/outcome is unknown/` → unconfirmed).

From agent/memory.mjs: `createMemory()` → `{ load, add, mark, addPantry, removePantry, clearPantry, ... }`, state `{ needed, approved, rejected, pantry, updatedAt }` (names only, 2 h expiry), `matchPantry(list, wanted)` (exact, else containment ≥ 3 chars), `serial()` write chain, `cleanName`.

agent/contract.test.mjs lists renal functions (line ~129) and actions functions (line ~227) that must return a Promise with an `ok` boolean when called with no argument; extend both lists.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: renal dishIngredients — model names and quantities only, every ingredient re-checked by checkFood, built-in fallback table</name>
  <files>renal/dish.mjs, renal/dish.test.mjs, renal/meals.mjs, renal/index.mjs, renal/README.md, agent/contract.test.mjs</files>
  <behavior>
    - Model returns 10 ingredients incl. "water", "olive oil", "black pepper", "fresh basil" and a duplicate "Ham"/"ham" → staples and the duplicate are dropped, at most 8 (DISH_MAX_INGREDIENTS) are kept, `omitted` counts the rest.
    - Model output carrying extra fields (sodiumMg, calories, verdict, swap) → ignored; each ingredient's verdict, swap, nutrients, portion, say and source come only from the injected `check`; the check is called once per kept ingredient with `{ food: { name, grams: null }, profile }`.
    - check returns `avoid` for ham with swap 'fresh unsalted chicken' → the ingredient has verdict 'avoid' and that swap; check returns `{ ok:false }`, throws, or exceeds `checkMs` → verdict 'unknown', `checked: false`, nutrients null.
    - No GOOGLE_API_KEY and no injected ai → "ham sandwich" (also "Ham Sandwich", "a ham sandwich") comes from BUILTIN_DISHES with `source: 'builtin'`; an injected ai that never answers with `modelMs: 50` → falls back to the table within about the budget; a dish in neither → `{ ok: true, ingredients: [], source: 'none' }`.
    - Invalid input (missing/empty dish, dish over 80 chars, no profile limits) → `{ ok: false, error }`; `dishIngredients()` with no argument resolves to `{ ok: false, error }`.
    - The prompt sent to the injected ai contains the cleaned dish quoted as data and the catalog names, and contains no limit numbers or avoid-list entries from the profile.
  </behavior>
  <action>
Implements OYC-1 (renal side). RED first: write renal/dish.test.mjs (node:test, follow renal/meals.test.mjs for the injected fake `ai` shape `{ models: { generateContent: async (req) => ({ text: JSON.stringify(...) }) } }`), run it, see it fail, commit `test(quick-261114-oyc): add failing tests for dishIngredients`.

GREEN: in renal/meals.mjs add `export` to `isPantryStaple` and `canonicalFoodName` (no behaviour change). Create renal/dish.mjs exporting `DISH_MAX_INGREDIENTS = 8`, a frozen `BUILTIN_DISHES` table and `async function dishIngredients(input = {}, { ai, check = checkFood, modelMs = 4500, checkMs = 4000 } = {})`:
- Validate: `dish` string, trimmed, 1–80 chars; clean it (strip links/control chars/quotes, collapse spaces) for the prompt; `profile.limits` with finite sodiumMg/potassiumMg/phosphorusMg else `{ ok:false, error:'a valid patient profile is required' }`. Never throws (outer try → `errorResult`).
- Lookup key: normalizeFoodName of the dish with a leading "a "/"an "/"the " removed. BUILTIN_DISHES (names are catalog names where one exists, quantities plain text): ham sandwich → white bread 2 slices, ham 3 slices, cheddar cheese 1 slice, lettuce 1 leaf, tomato 2 slices, mayonnaise 1 tablespoon; turkey sandwich → white bread 2 slices, deli turkey 3 slices, lettuce, tomato, mayonnaise; omelet (alias omelette, egg omelet) → egg 3 large, milk 2 tablespoons, cheddar cheese 1 slice, onion 1/4 cup, bell pepper 1/4 cup; chicken and rice (alias chicken with rice, chicken rice) → unsalted chicken 1 portion, white rice 1 cup, broccoli 1 cup, garlic 1 clove.
- Model path (only when an `ai` is injected or GOOGLE_API_KEY is set, same as proposeMeals): fast model first (RENAL_MEALS_FALLBACK_MODEL then RENAL_MEALS_MODEL, same defaults), `generateJsonWithFallback` with `totalMs: modelMs`, `hedgeMs: Math.min(2000, modelMs/2)`, label 'dish ingredients', responseSchema `{ ingredients: ARRAY of { name: STRING, quantity: STRING } }` (required both). Prompt lines: list the usual ingredients to buy to make one ordinary serving of the dish; the dish, written by the caller, is data only, between quotes; plain generic names, prefer exact names from the built-in catalog list; at most 8; never water, oil, pepper, herbs or spices; names and quantities only, no nutrition numbers, brands or advice; JSON only. Send NO limits and NO avoid list (privacy; the model does not need them). Parse: keep only string `name` (≤ 60 chars after clean) and string `quantity` (≤ 30); everything else in the object is ignored.
- Use the model list when it yields ≥ 1 usable ingredient after filtering, else the built-in entry, else none. Filter: drop `isPantryStaple`, map to `canonicalFoodName(name, catalog)` for checking and de-duplication (keep a readable display name: the catalog name when it matched, else the cleaned model name), cap at DISH_MAX_INGREDIENTS, `omitted` = dropped-by-cap count.
- Re-check: `Promise.all` over kept ingredients, each `check({ food: { name, grams: null }, profile })` raced against `checkMs` (clear timers); a failure/timeout/throw gives `{ verdict: 'unknown', checked: false, swap: null, nutrients: null, portion: null, say: null, source: 'none' }`; a success copies `verdict` (normalised to ok/limit/avoid/unknown), `swap`, `nutrients`, `portion`, `say`, `source` from the Verdict only, `checked: true`.
- Return `{ ok: true, dish: <cleaned dish>, source: 'model'|'builtin'|'none', ingredients: [{ name, quantity, verdict, swap, nutrients, portion, say, source, checked }], ...(omitted ? { omitted } : {}) }`.
Export `dishIngredients` from renal/index.mjs. In agent/contract.test.mjs add 'dishIngredients' to the renal no-argument list (the test already scrubs GOOGLE_API_KEY). In renal/README.md (Track B part only, not the shared contract — Task 2 does that) add a `### dishIngredients` section after `### suggestMeals`: what it returns, model names/quantities only, every ingredient re-checked, the built-in table, the 8-cap, budgets (model ≤ 4.5 s fast-first, each check ≤ 4 s, about 8.5 s worst case under the 12 s guard), no limits sent to the model. Commit `feat(quick-261114-oyc): renal dishIngredients re-checked through checkFood`.
  </action>
  <verify>
    <automated>node --test renal/dish.test.mjs renal/meals.test.mjs agent/contract.test.mjs</automated>
  </verify>
  <done>dish tests (cap, staples, duplicates, numbers never from the model, avoid/unknown, timeout fallback, no-key fallback, unknown dish, bad input, prompt has no limits) pass; meals and contract tests still pass; two commits made.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: actions previewCart — read-only list card with Kroger photos and prices; shared contract in all three READMEs; read-only live check</name>
  <files>actions/cart-card.mjs, actions/cart-card.test.mjs, actions/cart.mjs, actions/cart.test.mjs, actions/index.mjs, actions/README.md, agent/contract.test.mjs, agent/README.md, renal/README.md</files>
  <behavior>
    - cartCardSvg with no new options is byte-identical to today (title 'Your Kroger cart', 'Total $', FOOTER); with `title: PREVIEW_TITLE, footer: PREVIEW_FOOTER, totalLabel: 'About'` it contains PREVIEW_TITLE and PREVIEW_FOOTER, and contains neither 'Your Kroger cart' nor 'Nothing is paid. Review and check out yourself.'; renderCartCard with those options returns exactly 1280*720*4 bytes.
    - previewCart with 3 items on a Kroger-configured fake controller: searches each item, downloads pictures only from www.kroger.com/product/images, publishes one frame of exact size and activates it, returns `{ ok: true, shown: true, found: 3, notFound: 0, total }`; every fetched URL is the token endpoint with grant_type=client_credentials, /v1/products, or a product image; NO /v1/cart URL, NO refresh_token grant, token store `loads === 0`.
    - An item with no matching product still gets a tile (its list name, no price) and counts in notFound; total sums found items only (unitPrice × parseQuantity).
    - previewCart({ items: [] }) publishes nothing and, when a preview card is showing, hides it; returns `{ ok: true, shown: false }`.
    - Without Kroger config → `{ ok: false, error: 'not_configured' }` and no fetch; while a cart run is in progress → `{ ok: false, error: 'busy' }` and nothing published; invalid items → `{ ok: false, error }`.
    - Hold/clear: the preview card stays cardHoldMs then the frame is deactivated; startCart and stopCart remove it at once; a slower older previewCart that finishes after a newer one (or after stopCart/startCart) does not publish.
    - A second previewCart for an already-searched item reuses the cached product and picture (no second /v1/products call for it).
  </behavior>
  <action>
Implements OYC-3 (actions side) and the documentation part of OYC-7. RED: add tests to actions/cart-card.test.mjs and actions/cart.test.mjs (reuse `makeKrogerController`, `krogerProduct`, `assertUrlsAllowed`, the fake `png`; add a stricter `PREVIEW_URL_ALLOWED` list without '/v1/cart/add' and assert token bodies are client_credentials only); add 'previewCart' to the actions no-argument list in agent/contract.test.mjs (scrubbed Kroger → `{ ok:false, error:'not_configured' }`). Commit the failing tests.

GREEN, actions/cart-card.mjs: add optional `title`, `footer`, `totalLabel` to `cartCardSvg` and `renderCartCard` (pass through), defaults exactly today's text so the existing card is unchanged. Export `PREVIEW_TITLE = 'Your list · not in your Kroger cart yet'` and `PREVIEW_FOOTER = "Not in your Kroger cart yet. Nothing is added or paid until you say so."`. Clean and fit custom title/footer with the existing `cleanText`/`fitText` (title width 700, min 30; footer same font as now).

actions/cart.mjs, inside `createCartController`: add `previewCart({ items } = {})` and return it with the others; export `previewCart = (input) => controller.previewCart(input)`; add it to actions/index.mjs. Rules:
- Order of checks: items must be an array of CartItem-like objects (≤ 12, names 1–80 chars after trim; reuse `validateItems` if its rules fit, otherwise a local check) → `getKrogerConfig()` null → `not_configured` (no network) → `runPromise` set → `busy` → empty array → hide a preview card if one is showing (track `cardKind = 'preview' | 'cart'`; never hide a real cart card from here) and return `{ ok: true, shown: false }`.
- One lazily created preview client `createKroger(config)` reused across calls (keeps the app token); call ONLY `searchProducts`. Never call `getUserToken`, `addToCart`, `resumeSignIn` or the token store.
- Per item (in parallel, overall budget about 6 s via a race; items not finished count as not found): cache hit by lowercase name → reuse `{ description, unitPrice, picture }`; else search, `chooseProduct`, `pickImageUrl` + `fetchPicture` (existing downloadPicture rules). Cache only successes, bounded to 40 entries (drop oldest).
- Generation counter: bump on every previewCart, startCart and stopCart; after the work, publish only if the generation is unchanged and no run started. Tiles: found → product description, price = round2(unitPrice × parseQuantity(quantity)), quantity, picture; not found → the list name, price null, picture null. Step line: `Kroger prices · ${found} of ${n} found` (no item names). Render with `{ storeName: 'Kroger', items, step, total, title: PREVIEW_TITLE, footer: PREVIEW_FOOTER, totalLabel: 'About' }`; on success `publishFrame` → `activateFrame(true)`, `cardShown = true`, `cardKind = 'preview'`, `scheduleHold()`. Render failure → `{ ok: false, error: 'render_failed' }`, nothing shown. Never throws; logs nothing with item names.
- Return `{ ok: true, shown: true, found, notFound, total }`.

Docs (one commit for the contract, OYC constraint): in the "Shared contract" section, make the SAME edit in agent/README.md, renal/README.md and actions/README.md: renal hand-off row `dishIngredients({ dish, profile }, { ai }?)` → `{ ok, dish, source: 'model' | 'builtin' | 'none', ingredients: [{ name, quantity, verdict, swap, nutrients, portion, say, source, checked }], omitted? }` (model gives names and quantities only, every ingredient re-checked with checkFood, at most 8, built-in table for a few common dishes, about 8.5 s worst case); actions hand-off row `previewCart({ items })` where items is CartItem[] → `{ ok, shown, found, notFound, total }` or `{ ok: false, error: 'not_configured' | 'busy' | ... }` (read-only: app-token product search and pictures, no sign-in, no cart call; the card is titled "Your list · not in your Kroger cart yet", held 20 s, removed by startCart/stopCart; an empty list shows nothing); rule 3 time budgets gets `dishIngredients about 8.5 s` and `previewCart about 6 s`; under "Seen in live testing on 14 November 2026" one bullet: Kroger's public API only adds to a cart (`GET /v1/carts` 403 "required scope not found"; `PUT /v1/cart/add` with quantity 0 or -1 → 400; no remove route; only `cart.basic:write` is accepted at sign-in), so removing happens on the list before anything is sent. Then verify byte identity: `for f in agent renal actions; do awk '/^## Shared contract/{f=1} f&&/^## /&&!/Shared contract/{exit} f' $f/README.md | shasum; done` prints three equal hashes. In actions/README.md "### Kroger API cart" add a **The list preview card** paragraph (what previewCart does, read-only, title/footer, hold/clear, cache, no user token) and replace the one-line "The public API cannot view or remove cart items" with the plain statement plus the evidence above. Commit the three READMEs together: `docs(quick-261114-oyc): shared contract for dishIngredients and previewCart`.

Live check (read-only, OYC constraint; after the tests pass): write /private/tmp/claude-501/-Users-ptrczx-Desktop/49d7789a-b64c-470b-9826-f7eda7d76f05/scratchpad/oyc/live-check.mjs (outside the repo) that: sets `RENAL_STATE_DIR` and `KROGER_TOKEN_DIR` to fresh `mkdtemp` folders BEFORE importing the modules (so the real `~/.config/renal-dietitian/` and renal/data/cache.json are never touched); wraps `globalThis.fetch` to allow only Gemini (generativelanguage.googleapis.com), USDA (api.nal.usda.gov) and the web-lookup hosts checkFood already uses, `api.kroger.com/v1/connect/oauth2/token` with grant_type=client_credentials, `api.kroger.com/v1/products`, and `www.kroger.com/product/images/`, throwing and recording anything else (any `/v1/cart`, any refresh_token → fail the script); imports the worktree's renal/index.mjs and actions/cart.mjs by absolute path; runs `getProfile({ patientId: 'demo' })` then `dishIngredients({ dish: 'ham sandwich', profile })` timing it; builds the list (each ingredient, swap name instead of the original for avoid items that have a swap); runs a controller from `createCartController({ getKrogerConfig: () => readKrogerConfig(process.env), publishFrame: rgba => { captured = rgba; return true; }, activateFrame: () => {}, cardHoldMs: 0 })` → `previewCart({ items })` timing it; writes the captured RGBA with sharp (`raw: { width: 1280, height: 720, channels: 4 }`) to scratchpad/oyc/preview.png; prints ingredients, verdicts, swaps, source, timings and previewCart's result (no keys, no profile limits). Run with `node --env-file=/Users/ptrczx/Desktop/emoryHackathonDietary-merge/.env.local`. Read preview.png with the Read tool and describe what the card shows. Record all of it in SUMMARY.md. NO user token, NO cart add, NO texts. If GOOGLE or Kroger keys are absent, record that and skip only that part.
  </action>
  <verify>
    <automated>node --test actions/cart.test.mjs actions/cart-card.test.mjs agent/contract.test.mjs && for f in agent renal actions; do awk '/^## Shared contract/{f=1} f&&/^## /&&!/Shared contract/{exit} f' $f/README.md | shasum; done | uniq | wc -l | grep -q '^ *1$'</automated>
  </verify>
  <done>Preview tests pass (endpoint allow-list without cart/add, no user token, exact frame size, different title/footer, empty list shows nothing, busy, hold/clear, stale generation not published, cache); the existing cart card is unchanged; the three shared-contract sections hash identically and were committed together; live check PNG viewed and its results recorded for SUMMARY.md.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: agent tools, start_cart guard, honest removal, prompt playbook, docs</name>
  <files>agent/memory.mjs, agent/memory.test.mjs, agent/tools.mjs, agent/tools.test.mjs, agent/fake-modules.mjs, agent/prompt.mjs, agent/prompt.test.mjs, agent/README.md</files>
  <behavior>
    - memory.remove(['mayo']) removes 'mayonnaise' from needed and approved (matchPantry rules), returns `{ ok, removed, notFound, state }`; clearList() empties needed and approved, keeps pantry and rejected.
    - dish_ingredients({ dish: 'ham sandwich' }) → `{ ok, dish, ingredients: [{ name, quantity, verdict, swap? }], say, ask }`; say names the ingredients and only avoid/limit/unknown verdict words and swaps, with no digits; result ≤ 900 chars even with 8 long-named ingredients and never drops an avoid ingredient; a verdict card is offered via onDisplay; empty ingredients → fail dish_unknown; limitsNeeded → limits_needed.
    - add_to_shopping_list(['white bread','ham','lettuce']) after that dish → ham is held (`held: ['ham']`, fixed say), others listed with the dish quantities; the same call with keep_after_warning true adds ham only because it was held before in this call; keep_after_warning on a never-held name does not bypass; the result carries `list` (≤ 8 names) and previewCart is called with exactly the current list and quantities.
    - remove_from_list({ items: ['mayo'] }) removes it and re-shows the preview; a name not on the list and not sent to Kroger → fail not_on_list; `all: true` clears the list and calls previewCart({ items: [] }).
    - set_quantity({ name: 'white bread', quantity: '2 loaves' }) changes the quantity passed to previewCart and to start_cart.
    - text_list sends exactly one text to PATIENT_PHONE with "- name (quantity)" lines and the care-team closing line, no digits from nutrients and no limits; the same content again → list_already_sent; no phone → no_phone; empty list and no dish → nothing_to_text.
    - start_cart({ items: [] }): empty list → nothing_to_buy (says what they want to buy); list not yet returned to the model in this call (e.g. only leftovers from a previous call) → fail confirm_list with `items` and nothing started; after shopping_list/add/remove returned the list → startCart called with exactly the list (names + quantities) and the result lists the item names; items already sent this call are not re-sent; nothing new → already_in_cart.
    - After start_cart sent 'ham', remove_from_list({ items: ['ham'] }) (or with from_kroger_cart true) → ok with say exactly KROGER_NO_REMOVE and ham is off the list; no code path says it was removed from Kroger.
    - Console output during the whole dish → list → preview → remove → text → cart flow contains no item names and no limit numbers.
    - Prompt: has the numbered playbook naming dish_ingredients, add_to_shopping_list, remove_from_list, set_quantity, text_list, start_cart, confirm_list, text_cart_link, from_kroger_cart, "several parts", "one short question"; restricts start_setup to explicit setup/limits/voice/preferences requests; keeps every existing rule the current prompt tests check.
  </behavior>
  <action>
Implements OYC-1..OYC-8 on the agent side. RED: add tests (agent/memory.test.mjs, agent/tools.test.mjs, agent/prompt.test.mjs) and update the tool-name list in the "buildTools shape" test; add `dishIngredients` to makeFakeRenal (deterministic ham sandwich: white bread 2 slices ok; ham 3 slices avoid swap 'fresh unsalted chicken'; lettuce 1 leaf ok; mayonnaise 1 tablespoon unknown checked false; with nutrients only where a fake check would have them) and `previewCart` to makeFakeActions (returns `{ ok: true, shown: true, found: n, notFound: 0, total: 0 }`). Tests use a temp `createMemory({ dir })`. Commit failing tests.

GREEN:
1. agent/memory.mjs: add `remove(names)` (serial; for each name `matchPantry` on needed and approved; returns `{ ok, removed, notFound, state }`) and `clearList()` (needed = approved = []). Names only, never throws, same folder checks.
2. agent/tools.mjs — in-call state: `qty` Map (lowercase name → quantity text ≤ 40), `lastDish`, `avoidNames` Set (from dish avoid ingredients and from `candidates` with verdict avoid), `heldNames` Set, `listShownSig` (string), `sentToKroger` Set, `sentLists` Set. Helpers: `listNow()` → current list as CartItems: memory.load() needed names when memory works, else `lastMissing` names (this call only); quantity = qty.get(lower) ?? '1'; `sig(list)` = lowercase names+quantities joined; `showList(list)` → if `typeof actions.previewCart === 'function'` and not timed out, fire `Promise.resolve().then(() => actions.previewCart({ items: list.slice(0, 12) })).catch(() => {})` without awaiting; `listResult(list)` → `{ list: names ≤ 8 (≤ 40 chars), listMore? }` and sets `listShownSig = sig(list)`.
   - New FAILS (fixed sentences): dish_unknown "I'm not sure what usually goes in that. Tell me the main ingredients and I'll check each one.", not_on_list "That isn't on your list.", confirm_list "Before I add anything to your Kroger cart, here is what's on your list. Shall I add these?", already_in_cart "Those are already in your Kroger cart from this call. I can text you the cart link.", nothing_to_text "There's nothing on your list yet. Tell me a dish or the items you need first.", list_already_sent "I've already texted you that list. Please check your messages.", list_text_unconfirmed, list_text_failed (same style as the recipe ones). Change nothing_to_buy to "Your list is empty. What would you like to buy?". Export `KROGER_NO_REMOVE = "Kroger doesn't let me take items out of your cart. I've taken it off your list so it won't be added again, and I can text you the cart link so you can remove it there."` and `LIST_CLOSING = 'This list follows the limits set by your care team and does not replace their advice.'`.
   - `dish_ingredients({ dish })` (z.string trim 1–80): getProfile (limitsNeeded → limits_needed; !ok → profile_unavailable) → renal.dishIngredients → !ok → check_failed; empty → dish_unknown. Unless timed out: set lastDish, qty for every ingredient and for its swap (swap inherits the quantity), avoidNames. `call.display` = up to 6 `displayItem` rows; widen the guard's display condition to also accept `Array.isArray(fitted.ingredients)`. Result `{ ok, dish ≤ 40, ingredients: [{ name ≤ 30, quantity ≤ 20, verdict, swap? ≤ 40 }], ...(omitted), say, ask: 'Use the swap or keep the original, and shall I put these on your list?' }` where say is built in code from names and verdict words only: "A <dish> usually takes A, B and C." then per avoid "<X> is a no for your limits", per limit "keep <X> to a small portion", per unknown "I couldn't check <X>", each with "; <swap> is a good swap" when present. No digits from nutrients ever. Fit to DISH_LIMIT = 900 by dropping quantities, then shortening names, never dropping an avoid row. Description: call after look_at_camera when shown, for "what's in it / get the ingredients / buy what it needs"; never list ingredients yourself.
   - `add_to_shopping_list`: add optional `keep_after_warning` (boolean nullish). Names in avoidNames are held (added to heldNames, returned as `held` with say "I left <names> off your list because it's not a good fit for your limits. Tell me if you still want to keep it.") unless keep_after_warning is true AND the name is already in heldNames. Add the rest via memory.add; set qty '1' only for names with no quantity yet. Return the existing fields plus `listResult(listNow())`; call showList. When a dish ingredient is replaced by its swap, the swap's quantity was set by dish_ingredients.
   - `remove_from_list({ items: string[] 0–20, all?: boolean, from_kroger_cart?: boolean })`: `all` → memory.clearList(); else memory.remove(items). honest = from_kroger_cart === true or any asked/removed name matches sentToKroger (matchPantry). Remove matched names from qty. Nothing removed and not honest → not_on_list. Result `{ ok, removed ≤ 5, ...listResult, ...(honest ? { say: KROGER_NO_REMOVE } : {}) }`; showList (an empty list calls previewCart({ items: [] })).
   - `set_quantity({ name, quantity })` (trim 1–80 / 1–40): name must match the list (matchPantry on listNow names) else not_on_list; qty.set; return listResult; showList.
   - `text_list()`: no phone → no_phone; list = listNow(); empty → if lastDish, the dish ingredients; else nothing_to_text. Text: first line "Shopping list from your AI renal dietitian:" (or "Ingredients for <dish> from your AI renal dietitian:"), then "- name (quantity)" per item (≤ 20 items, text ≤ 1500 chars), then LIST_CLOSING. Same once-per-content flow as text_recipe (key = the text; mark before send; unmark on failure; `/outcome is unknown/` → list_text_unconfirmed; timeout → list_text_unconfirmed).
   - `start_cart`: explicit items keep today's behaviour. Empty items → list = listNow() minus names in sentToKroger; listNow() empty → nothing_to_buy; all already sent → already_in_cart; `sig(fullList) !== listShownSig` → `fail('confirm_list', listResult(list))` (sets listShownSig, starts nothing). Then the existing Kroger status check and `actions.startCart({ items: list.slice(0, 12) })`; on ok (not timed out) add the sent names to sentToKroger; result `{ ok, started, items: names ≤ 5, more?, say: "I'm adding these to your Kroger cart now." }`. Description: pass an empty list to add exactly the caller's current list; call only after the caller heard the list and said to add it; never pays.
   - `shopping_list`: also sets listShownSig and calls showList when non-empty. `suggest_meal`: also put each missing item's quantity in qty (existing memory.add stays).
   - `start_setup` description: "Only when the caller explicitly asks to change their setup, limits, voice or preferences (for example 'update my setup'). Never for a food, a dish, ingredients, a list or a cart."
   - Update existing tests whose expectations change by design (empty start_cart now needs the list shown first; nothing_to_buy sentence) — keep their coverage, add the confirm step; do not delete tests.
3. agent/prompt.mjs: replace the start_cart/shopping-list sentences in buildInstructions and the from-scratch "offer to add its ingredients to the cart with start_cart" clause with a compact numbered "Dish and shopping list" playbook (one line each): 1 dish shown or named + ingredients/buy → look_at_camera if shown, then dish_ingredients; never list ingredients yourself; say its say, then ask its ask. 2 when they agree → add_to_shopping_list with what they chose (swap names if they chose swaps); a held item only with keep_after_warning true after they say to keep it. 3 after each list change, one short sentence on what changed; the card shows the list is not in their Kroger cart yet. 4 "remove/take off" → remove_from_list; "add" → add_to_shopping_list; "make it two" → set_quantity. 5 "text me the ingredients/list" → text_list. 6 only when they clearly say to put it in their Kroger cart → start_cart with an empty list and say the items it returns; on confirm_list read the items, ask, and call again only after yes; then offer text_cart_link. 7 removing something already sent to Kroger → remove_from_list with from_kroger_cart true and say its say exactly; never say it left the Kroger cart. 8 a request with several parts → do them in order, one short sentence between steps, finish all without being asked again; unsure between two things → ask one short question. Setup paragraph: "Call start_setup only when the caller explicitly asks to change their setup, limits, voice or preferences (for example "update my setup"); never because they showed or named a food or dish, asked for ingredients, or asked to shop." Keep every existing safety rule and all phrases the existing prompt tests check (from_scratch, text_recipe, only when they agree, Never pay, update my setup, etc.); keep it short — no long prose.
4. agent/README.md (Track A part, not the shared contract): Tools table rows for dish_ingredients, remove_from_list, set_quantity, text_list and the changed add_to_shopping_list / start_cart / shopping_list / start_setup, with the new failure codes; a short "Dish to cart" paragraph (the flow, in-call quantities are not persisted — memory keeps names only — the confirm guard, the honest sentence and why: the Kroger API cannot remove or read cart items).
Run `npm test` (must be green, ≥ 639 + new). Commit `feat(quick-261114-oyc): dish to list to Kroger cart, step by step, with honest removal` and `docs(quick-261114-oyc): agent tools for the dish playbook`. Finally `rm node_modules` (symlink) and confirm `git status` shows only the uncommitted SUMMARY.md.
  </action>
  <verify>
    <automated>node --test agent/memory.test.mjs agent/tools.test.mjs agent/prompt.test.mjs agent/contract.test.mjs && npm test</automated>
  </verify>
  <done>All listed behaviours are tested and pass; npm test green without .env.local; no item names or limits in logs; prompt carries the playbook and the start_setup guard; agent README updated; symlink removed; only SUMMARY.md uncommitted.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| caller speech → voice model → tool args | dish names, item names and flags are model-written, untrusted |
| tool → Gemini (dishIngredients prompt) | dish text crosses into a model prompt |
| Gemini output → renal | model JSON is untrusted; must not carry health numbers |
| actions → api.kroger.com / www.kroger.com | network calls with the app credentials; pictures downloaded |
| agent → sendText → patient phone | texts leave the system |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-oyc-01 | Tampering | renal/dish.mjs prompt | mitigate | dish cleaned (≤ 80 chars, no links/control chars/quotes), quoted as data; responseSchema allows only name/quantity strings; names capped and canonicalised; no limits or avoid list sent |
| T-oyc-02 | Tampering | model-invented nutrition | mitigate | verdict, swap, nutrients, portion only from checkFood; tests feed model output with fake numbers and assert they never appear |
| T-oyc-03 | Elevation | start_cart([]) adding stale/unheard items | mitigate | confirm_list guard (list must have been returned in this call), sentToKroger de-dupe, prompt rule 6 |
| T-oyc-04 | Repudiation/Spoofing | false "removed from Kroger" claim | mitigate | fixed KROGER_NO_REMOVE sentence returned by code; prompt rule 7; test asserts exact text |
| T-oyc-05 | Elevation | previewCart touching the real cart | mitigate | only searchProducts on a separate client; tests assert no /v1/cart URL, no refresh_token grant, token store never loaded; live-check fetch wrapper refuses anything else |
| T-oyc-06 | Tampering/SSRF | product picture download | mitigate | reuse downloadPicture + isKrogerImageUrl (https, exact host, image path, size/time caps) |
| T-oyc-07 | Info disclosure | logs | mitigate | no item names, dish names or limits logged; test captures console during the flow |
| T-oyc-08 | Spoofing | text_list to wrong number / repeats | mitigate | sendText refuses non-PATIENT_PHONE; phoneOk check; once-per-content set |
| T-oyc-09 | Elevation | avoid food on the list without warning | mitigate | held unless keep_after_warning and the name was held earlier this call |
| T-oyc-10 | Elevation | accidental start_setup | mitigate | tool description and prompt restrict it to explicit setup/limits/voice/preferences requests |
| T-oyc-SC | Tampering | package installs | accept | no new dependency; node_modules is a symlink to the main checkout |
</threat_model>

<verification>
- `npm test` green without `.env.local` (baseline 639 plus new tests).
- Shared contract sections in agent/README.md, renal/README.md, actions/README.md hash identically and were changed in one commit.
- Live check: `dishIngredients('ham sandwich')` for patient demo returns ingredients with checkFood verdicts and swaps within the budget; preview.png shows Kroger photos, prices, the "Your list · not in your Kroger cart yet" title and the not-in-cart footer; the fetch wrapper recorded no cart or user-token call.
- `git status` in the worktree: only SUMMARY.md uncommitted; no node_modules symlink; renal/data/cache.json not staged.
</verification>

<success_criteria>
- A caller can name or show a ham sandwich, hear its ingredients with real verdicts and a swap, put them on the list, see the not-yet-in-cart card, remove/add/change items, get the list texted, then send exactly that list to the Kroger cart, and hear the honest sentence if they ask to remove something already sent.
- `start_cart([])` never silently buys leftovers; `start_setup` is not triggered by food or shopping requests.
- Nothing in the code path can remove from, read, or pay for the real Kroger cart.
</success_criteria>

<source_audit>
| Source item | Covered by |
|---|---|
| Target 1: dish → ingredients with quantity, checkFood verdict, swap; fast model, schema, fallback table, cap 8, no basics | Task 1, Task 3 dish_ingredients |
| Target 2: short say, verdict words only where they matter, one question | Task 3 (say built in code, ask) + prompt step 1 |
| Target 3: list = existing memory list; preview card with photos/prices titled not-in-cart; hold/clear | Task 2 previewCart, Task 3 showList |
| Target 4: remove_from_list, add, quantity; re-show after each; avoid held unless kept | Task 3 (set_quantity is the first thing to cut if needed) |
| Target 5: text the list, care-team closing line, once per content | Task 3 text_list |
| Target 6: start_cart exactly the list, names returned, empty list fails with question | Task 3 start_cart |
| Target 7: honest fixed sentence after Kroger add | Task 3 KROGER_NO_REMOVE, Task 2 docs evidence |
| Target 8: start_setup guard, start_cart confirmation, multi-part requests, one short question, compact prompt | Task 3 prompt + descriptions + confirm_list guard |
| Constraints: identical shared contract, READMEs, tests, live check, worktree hygiene | Tasks 1–3 |
| Cut order if out of budget | set_quantity first, then BUILTIN_DISHES; never KROGER_NO_REMOVE, the start_cart confirmation or the checkFood re-check |
</source_audit>

<output>
Create `.planning/quick/261114-oyc-dish-to-ingredients-to-shopping-list-to-/261114-oyc-SUMMARY.md` when done (leave it uncommitted). Include the live-check results: ingredients, verdicts, swaps, source, timings, previewCart result and what preview.png shows.
</output>
