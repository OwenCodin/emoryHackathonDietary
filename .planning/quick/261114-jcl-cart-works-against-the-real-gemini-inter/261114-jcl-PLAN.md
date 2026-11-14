---
phase: quick-261114-jcl
plan: 01
quick_id: 261114-jcl
type: execute
wave: 1
depends_on: []
files_modified:
  - actions/cart.mjs
  - actions/cart.test.mjs
  - actions/README.md
autonomous: true
requirements: [QUICK-261114-jcl]
must_haves:
  truths:
    - "The cart talks to Gemini through the v1beta Interactions API and reads actions from the reply's `steps`, not `outputs`"
    - "A steps-based function_call is carried out in the browser, its `arguments.intent` shows up in getCartStatus().step, and a function_result with the same call_id goes back with previous_interaction_id"
    - "A steps-based final text (ADDED/MISSING) is parsed into added/missing"
    - "Click and scroll coordinates are mapped to the 1280x720 viewport the way the live API was seen to mean them"
    - "Every existing safety guard still fires: store allow-list, checkout/payment block, personal/payment text refusal, blocked intent, safety_decision pause, 60-action cap, four-minute cap"
    - "npm test passes with no keys and no network"
    - "A three-item headed run on kroger.com was made and its real outcome (added / missing / stuck / blocked) is recorded in SUMMARY and actions/README.md"
  artifacts:
    - path: "actions/cart.mjs"
      provides: "Gemini v1beta computer-use loop over steps"
      contains: "apiVersion: 'v1beta'"
    - path: "actions/cart.test.mjs"
      provides: "Fakes in the real reply shape plus tests for steps, final text, coordinates, function_result"
      contains: "steps:"
  key_links:
    - from: "actions/cart.mjs createAi"
      to: "GoogleGenAI"
      via: "new GoogleGenAI({ apiKey, apiVersion: 'v1beta' })"
      pattern: "apiVersion: 'v1beta'"
    - from: "actions/cart.mjs run loop"
      to: "interaction.steps"
      via: "function_call / model_output step readers"
      pattern: "\\.steps"
---

<objective>
Make the Track C grocery cart (`actions/cart.mjs`) work against the real Gemini Interactions API and
prove it with one headed three-item run on https://www.kroger.com.

Purpose: today the cart builds a v1 client (rejects image input) and reads `interaction.outputs`, which
the real reply does not have, so every item is reported missing. The cart is part of the demo.
Output: fixed `actions/cart.mjs`, fakes and new tests in `actions/cart.test.mjs`, honest status lines in
`actions/README.md` (Track C section only), and a SUMMARY with the live findings.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md
@actions/cart.mjs
@actions/cart.test.mjs
@actions/store.mjs
@actions/frames.mjs

<established_facts>
Seen live on 14 Nov 2026. Treat as facts; do not re-derive.
1. `@google/genai` 3.3.0. `new GoogleGenAI({ apiKey })` + `ai.interactions.create` with an `{type:'image'}`
   input -> `400 The value 'image' is not supported for 'input[1].type' in v1, it is available in v1beta.`
   `new GoogleGenAI({ apiKey, apiVersion: 'v1beta' })` makes the same request succeed. Model
   `gemini-4-hydrogen` accepts `tools:[{type:'computer_use',environment:'browser',enable_prompt_injection_detection:true}]`.
2. The real reply has no `outputs`. Top-level keys: `id, status, usage, created, updated, service_tier, steps,
   object, model, sdkHttpResponse, continuation_ids`. Sample (Kroger home, "search for unsalted butter"):
   `status: "requires_action"`, `steps: [ {type:'thought', signature:'…'}, {id:'call_1452…', type:'function_call',
   name:'click', arguments:{intent:'Click the search box to search for unsalted butter.', x:690, y:60}} ]`.
   Note `intent` is inside `arguments`, not on the call; cart.mjs sets `status.step` from `call.intent`.
3. Kroger blocks headless Chromium; headed Playwright Chromium loads it, with a pickup store already set in the
   main checkout's `actions/.browser-profile/`. Kroger sign-in shows "access denied" to automation, so the run
   is a guest run. Playwright chromium build 1255 installed. `getCartStatus` exported from cart.mjs is async.
   `npm test` currently passes 410 tests with no keys and no network.
</established_facts>

<sdk_and_docs_facts>
Read by the planner from node_modules/@google/genai/dist/genai.d.ts and the computer-use guide
(https://aistudio.google.com/docs/computer-use). Use these; the probe in Task 1 confirms the live behaviour.

From genai.d.ts:
- `FunctionCallStep = { type: 'function_call'; id: string; name: string; arguments: {[k]: any} }` (no typed intent or safety field).
- `ModelOutputStep = { type: 'model_output'; content?: Content[]; error?: Status }`.
- `FunctionResultStep = { type: 'function_result'; call_id: string; name?: string; is_error?: boolean; result: FunctionResultSubcontent[] | object | string }`.
- Interaction status values: in_progress, requires_action, completed, failed, cancelled, incomplete, budget_exceeded, queued, requires_continuation.
- ComputerUse tool: `{ type:'computer_use', environment, enable_prompt_injection_detection, excluded_predefined_functions?, disabled_safety_policies? }`.

From the computer-use guide (Interactions version):
- Browser actions and args: click / double_click / triple_click / middle_click / right_click / mouse_down / mouse_up / move: `x, y`;
  type: `text, press_enter`; drag_and_drop: `start_x, start_y, end_x, end_y`; wait: `seconds` (default 1);
  press_key / key_down / key_up: `key`; hotkey: `keys` (list); take_screenshot; scroll: `x, y, direction`
  (up/down/left/right), `magnitude_in_pixels` (default 300); go_back; go_forward; navigate: `url`. Every action carries `intent` in its args.
- Coordinates: tables say 0-999, sample converts with `x / 1000 * width`; one paragraph says pixels. Inconsistent -> Task 1 decides.
- Safety: `arguments.safety_decision = { decision: 'require_confirmation' | …, explanation }`. Do not auto-approve (we never send `safety_acknowledgement`).
- function_result sent back: `{ type:'function_result', name, call_id, result:[ {type:'text', text: JSON.stringify({ url, ...actionResult })}, {type:'image', data: base64png, mime_type:'image/png'} ] }`, with `previous_interaction_id`.
- Parallel calls: one reply may hold several function_call steps; send one function_result per call.
- Done: no function_call step; answer text is in `model_output` steps' `content[].type === 'text'`.
</sdk_and_docs_facts>

<interfaces>
Public contract that must not change (agent/tools.mjs and agent/contract.test.mjs depend on it):
- actions/index.mjs: `export { startCart, getCartStatus, stopCart } from './cart.mjs'; export { getCartFrame } from './frames.mjs';`
- `startCart({ items })` -> `{ ok }` at once, `{ ok:false, error:'busy' }` when one is running, validation errors as today.
- `getCartStatus()` (exported async) -> `{ ok, state: 'idle'|'running'|'waiting_for_patient'|'done'|'failed', step, added:[{name,price}], missing:string[], total, cartUrl }`.
- `stopCart()` -> `{ ok }`. `getCartFrame()` sync, exactly WIDTH*HEIGHT*4 bytes or null.
- `createCartController({ openContext, createAi, getStoreUrl, captureFrame, activateFrame, createFallbackLink, now })` is the test seam; keep its option names.
- shared/video.mjs: `WIDTH = 1280`, `HEIGHT = 720`.
</interfaces>

<worktree_setup>
The executor runs in an isolated git worktree with no `.env.local`, no `node_modules` and no browser profile.
Before anything else, from the worktree root:
- `ln -s /Users/ptrczx/Desktop/emoryHackathonDietary-merge/node_modules node_modules` (git-ignored; never `git add` it).
- `ln -s /Users/ptrczx/Desktop/emoryHackathonDietary-merge/actions/.browser-profile actions/.browser-profile`
  (this is the profile with the Kroger pickup store set. If Chromium says the profile is in use,
  stop and report it rather than deleting lock files.)
- The .gitignore patterns `node_modules/` and `actions/.browser-profile/` end in a slash, so git does NOT
  ignore these two symlinks: they show as `??` in `git status`. Never `git add -A` or `git add .`; stage
  files by explicit path only. Base commit for diffs below is `1174eca`.
- Load keys only with `node --env-file=/Users/ptrczx/Desktop/emoryHackathonDietary-merge/.env.local …`.
  Never print, log, echo, grep or commit any value from that file. Never `cat` it.
- Throwaway probe/run scripts live outside the repo (the executor's scratchpad directory). They load
  packages with `createRequire('<worktree>/package.json')` (both `@google/genai` and `playwright` ship CJS)
  and import worktree modules by absolute path. Never commit them.
</worktree_setup>

<hard_rules>
- Safety must not get weaker: keep the store-domain allow-list, the checkout/payment block, the refusal to
  type personal or payment data, the BLOCKED_INTENT check, the safety_decision pause, the 60-action cap, the
  four-minute cap and stop-before-checkout. Never send `safety_acknowledgement`. Do not add
  `disabled_safety_policies`.
- Keep `npm test` green with no keys and no network.
- Spend Gemini quota sparingly: Task 1 at most 6 `interactions.create` calls; Task 3 at most 2 full cart runs.
- No Chert FaceTime minutes. No `git push`. Do not edit anything under `agent/` or `renal/`.
- Do not touch the "Shared contract (identical in all three track READMEs)" section of actions/README.md
  (lines 5-215); it would need identical edits in agent/README.md, which this task may not edit. Edit only
  under "## Track C in detail".
- A store block is a valid recorded outcome. Do not disguise the browser (no user-agent spoofing, stealth
  plugins, or headless tricks).
</hard_rules>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Probe the live v1beta Interactions API for the four unknowns</name>
  <files>(no repo files; scratch scripts outside the repo, findings go into the SUMMARY)</files>
  <action>
Do the worktree setup above first. Then write one throwaway probe script in the scratchpad that opens the
symlinked profile with `chromium.launchPersistentContext(<worktree>/actions/.browser-profile, { headless:false,
viewport:{width:1280,height:720} })`, goes to https://www.kroger.com, waits for the page to settle, and uses
`new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY, apiVersion:'v1beta' })` with model `gemini-4-hydrogen`
and the same computer_use tool object cart.mjs uses. When printing any reply, print only `status`, `id`
presence, and `steps` with every `signature` and base64 `data` replaced by its length; never print
`sdkHttpResponse`, headers, or the key. Answer, and record verbatim for the SUMMARY:

(a) Coordinate scale. Probe 1: screenshot (PNG, 1280x720) + prompt "Click the shopping cart icon at the top
right of this page. Take no other action." Take the first function_call. Compute both candidates: normalized
(x/1000*1280, y/1000*720) and pixel (x, y). For each, run `page.evaluate` with `document.elementFromPoint`
and print the element's tag, aria-label, and first 40 chars of innerText (and its closest `a`/`button`). An x
above 999 settles it as pixels. Decide which mapping hits the cart control. If still ambiguous, Probe 1b
asks for a small target far from centre on the vertical axis (for example the Kroger logo, or a footer-side
element after nothing else) and repeats the check. Do not execute the click in the browser.

(b) function_result acceptance and reply history. Probe 2: send `previous_interaction_id: <probe1 id>` with
input `[{ type:'function_result', name, call_id, result:[{type:'text', text: JSON.stringify({ url:'https://www.kroger.com/' })}, {type:'image', data:<fresh screenshot base64>, mime_type:'image/png'}] }]`.
Record: accepted or the exact 4xx message; whether the reply's `steps` hold only the new turn or the whole
history (does probe 1's call id reappear?); the status value. If the shape is rejected, try at most one
variant (for example `result` as the plain JSON string, or name omitted) and record which one works.

(c) Final text shape. Probe 3: a fresh interaction with the screenshot and the prompt "Do not take any browser
action. Reply with exactly: MISSING: probe". Record the full step list shape (expected
`{type:'model_output', content:[{type:'text', text}]}`), and the `status` value when finished.

(d) Action names and safety. List every action name and argument key seen across the probes. Cross-check
against the guide list in <sdk_and_docs_facts>. Note where `intent` and any `safety_decision` appear. Do not
try to provoke a safety decision with extra calls; the guide's `arguments.safety_decision.decision` placement
is what the code will read (cart.mjs already reads `arguments.safety_decision` and stringifies objects).

Close the browser at the end. Total `interactions.create` calls across Task 1: 6 or fewer.
  </action>
  <verify>
    <automated>test -L node_modules && test -L actions/.browser-profile && git status --porcelain | grep -v -e '^?? .planning' -e '^?? node_modules$' -e '^?? actions/.browser-profile$' | grep -c . | grep -qx 0 && echo clean</automated>
  </verify>
  <done>
Findings for (a)-(d) written down (they go into the SUMMARY): coordinate scale decided with element evidence,
function_result shape accepted (or the working variant), whether steps accumulate, final model_output shape and
status values, observed action/argument names. No repo files changed; nothing secret printed.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Read steps, use v1beta, map coordinates as observed, and test it with real-shape fakes</name>
  <files>actions/cart.mjs, actions/cart.test.mjs</files>
  <behavior>
    - Fake reply `{ id, status:'requires_action', steps:[{type:'thought',signature:'s'}, {type:'function_call', id:'call-1', name:'navigate', arguments:{ intent:'Searching for broth', url:'https://www.walmart.com/search?q=broth' }}] }` then `{ id, status:'completed', steps:[{type:'model_output', content:[{type:'text', text:'ADDED: Unsalted broth | $3.25'}]}] }` -> state done, added [{name:'Unsalted broth', price:3.25}], total 3.25, cartUrl the search URL.
    - While the navigate runs, getCartStatus().step equals the call's `arguments.intent`.
    - The second create call receives `previous_interaction_id` equal to the first reply's id and an input `function_result` with `call_id:'call-1'`, `name:'navigate'`, a text part whose JSON parses to `{ url: 'https://www.walmart.com/search' }` (origin+path only, no query) and an image part with `mime_type:'image/png'`.
    - Final text `MISSING: out of stock` -> missing ['broth: out of stock']; a completed reply with no text -> 'broth: no confirmed result'.
    - Coordinate mapping: click `{x:500, y:500}` lands on the fake mouse at the point the Task 1 finding says (normalized -> (640, 360); pixels -> (500, 500)); an out-of-range coordinate for that scale fails with 'Click coordinates are invalid'.
    - Scroll with `direction:'down', magnitude_in_pixels:400` wheels by 400; `direction:'right'` wheels horizontally; magnitude clamped to 1200.
    - Two function_call steps in one reply: both executed in order, both counted toward the cap, next create input holds two function_results with matching call_ids. If either call carries a blocked safety decision or blocked intent, neither runs (checked before executing any).
    - `arguments.safety_decision = { decision:'require_confirmation', explanation:'x' }` -> waiting_for_patient, step matches /confirm/i, mouse never clicked.
    - Unchanged guards, converted to steps fakes: checkout navigate -> waiting_for_patient and page stays on store; phone-like text -> failed /personal or payment data/; 61 take_screenshot replies -> failed /60 browser actions/; four-minute clock -> 'Cart stopped after four minutes'; bot challenge -> Instacart fallback; busy; restart after early failure.
  </behavior>
  <action>
RED first: convert every fake in actions/cart.test.mjs from `outputs:[…]` to the real shape (`status`, `steps`
with a leading `{type:'thought', signature:'s'}` on action replies, `intent` inside `arguments`), make the
fake `interactions.create` record its request arguments, make `makeBrowser` record `mouse.click`/`mouse.wheel`/
`mouse.move` arguments, and add the tests in <behavior>. Run `npm test -- actions/cart.test.mjs` (or
`node --test actions/cart.test.mjs`) and confirm the new ones fail.

GREEN in actions/cart.mjs:
1. `createAi` builds `new GoogleGenAI({ apiKey, apiVersion: 'v1beta' })` (fact 1). Keep the missing-key error.
2. Replace `getAction(outputs)`/`getModelText(outputs)` with readers over `interaction.steps ?? []`:
   pending calls = `function_call` steps whose id has not been handled yet in this item's loop (track a Set of
   handled call ids, so it is correct whether or not Task 1 found the steps accumulate); text = text parts of
   `model_output` steps (if steps accumulate, only those after the last handled function_call). Do not keep a
   fallback to `outputs`.
3. For each reply with pending calls: run the safety_decision check and `intentIsBlocked` on every call first
   (pause exactly as today if any trips), then the MAX_ACTIONS check, then execute in order. Set
   `status.step` from `call.arguments?.intent` (fall back to `call.intent`, then `Performing ${name}`).
   Send one function_result per executed call in the next `interactions.create` input, using the shape Task 1
   confirmed (default: text part `JSON.stringify({ url: getPageReference(page) })` plus the PNG image part),
   with `previous_interaction_id` and the same `{ timeout_ms: 30_000 }`.
4. Coordinates: one helper `toViewport(x, y)` used by click, double_click, triple_click, move and scroll,
   implementing the scale Task 1 established, with bounds checks for that scale (normalized: 0-999; pixels:
   0..WIDTH-1 and 0..HEIGHT-1). Keep rejecting non-finite values.
5. Actions, all followed by the existing allow-list and checkout URL guards: keep navigate (allow-list +
   checkout check before goto), click, type (keep the personal/payment regexes and 500-char limit), press_key,
   wait, go_back, take_screenshot. Add double_click and triple_click (`page.mouse.click(px, py, { clickCount })`),
   move (`page.mouse.move`), go_forward (`page.goForward`), hotkey (`keys` array of 1-4 strings each up to 32
   chars, pressed as `keys.join('+')`). Scroll reads `magnitude_in_pixels` (fall back to `amount`, default 300,
   clamp 0-1200) and supports up/down/left/right (left/right via `mouse.wheel(dx, 0)`). For any other action
   name (drag_and_drop, right_click, key_down, …) do not fail the run: send that call's function_result with
   text `JSON.stringify({ url, error: 'unsupported action' })` and a screenshot so the model picks another
   action; it still counts toward MAX_ACTIONS. Safety-related refusals keep today's state transitions.
6. Leave BLOCKED_INTENT, isAllowedStoreUrl/isCheckoutUrl use, the type-text refusal, MAX_ACTIONS = 60,
   MAX_DURATION_MS, the prompt text, the Instacart fallback, the frame timer and all exports unchanged.
   Never add `safety_acknowledgement` or `disabled_safety_policies`.

Then run the full `npm test` (no keys, no network; the worktree has no .env.local so `--env-file-if-exists`
loads nothing) and confirm the count is 410 plus the tests added, all passing. Commit with message
`fix(actions): cart reads Gemini v1beta interaction steps` (ending with the attribution line), staging only
actions/cart.mjs and actions/cart.test.mjs.
  </action>
  <verify>
    <automated>npm test 2>&1 | tail -15 && grep -c "apiVersion: 'v1beta'" actions/cart.mjs && test "$(grep -v '^\s*//' actions/cart.mjs | grep -c 'outputs')" = 0 && test "$(grep -v '^\s*//' actions/cart.test.mjs | grep -c 'outputs:')" = 0 && test -z "$(git diff --name-only 1174eca -- agent renal)"</automated>
  </verify>
  <done>
npm test fully green with no keys/network; cart.mjs and its fakes use `steps` only; v1beta client; coordinate
mapping matches Task 1; every guard listed in hard_rules still has a passing test; one commit touching only
actions/cart.mjs and actions/cart.test.mjs.
  </done>
</task>

<task type="auto">
  <name>Task 3: Headed three-item run on kroger.com, then record what was seen</name>
  <files>actions/README.md</files>
  <action>
Write a throwaway run script in the scratchpad that imports `startCart`, `getCartStatus`, `stopCart` from
`<worktree>/actions/cart.mjs` by absolute path (the real controller: headed persistent profile, real
Gemini, `GROCERY_STORE_URL` from env). Run it with
`node --env-file=/Users/ptrczx/Desktop/emoryHackathonDietary-merge/.env.local <script>`.
The script calls `startCart({ items: [ { name:'unsalted butter', quantity:'1' }, { name:'white rice', quantity:'1' }, { name:'apples', quantity:'3' } ] })`,
then every 500 ms `await getCartStatus()` (it is async) and prints a timestamped line whenever `state`,
`step`, `added`, `missing`, `total` or `cartUrl` changes. It exits when state leaves `running`; as a backstop
at 5 minutes it calls `stopCart()` (the cart's own four-minute cap should end it first). It must also flag
any logged step or cartUrl matching /checkout|payment/i. Never log env values or screenshots. Optionally
save the last `getCartFrame()` to a PNG in the scratchpad for your own inspection (not committed).

Interpret honestly: what was added (name, price), what was missing and why, where it got stuck (last step,
state), whether any guard fired (blocked intent, safety pause, checkout block, caps), whether Kroger showed
a bot/"access denied" page (that triggers the Instacart fallback path, which needs INSTACART_API_KEY; record
whatever happened). If the run exposes a code bug in the steps handling (not a store block, not a model
choice), fix it with a test in cart.test.mjs, keep npm test green, commit, and do the one permitted re-run.
Do not tweak prompts or caps to make the run look better, and do not work around blocks by disguising the
browser.

Update actions/README.md, only below "## Track C in detail":
- "### Local implementation status": replace the opening sentence about no store being tested with what the
  run actually showed (date 14 Nov 2026, kroger.com, guest, headed, which of the three items were added or
  missing, total, where it stopped, any block). State that the cart has still not been run on a live call.
- "### The cart" model-loop bullets: say the client must use `apiVersion: 'v1beta'` (image input is rejected
  on v1), that replies carry `steps` (function_call / model_output) not `outputs`, that `intent` and
  `safety_decision` are inside `arguments`, the coordinate scale Task 1 established, scroll's
  `magnitude_in_pixels`, and the function_result text JSON `{ url }`. Replace the sentence "Real store
  interactions remain unverified until the user signs into a store and runs the manual test." with what was
  seen.
- "### What to do next" item 1: adjust only if the run changes it (for example Kroger sign-in is denied to
  automation, so runs are as a guest).
Do not edit lines 5-215 (the shared contract). Commit `docs(actions): record live Kroger cart run` with only
actions/README.md (plus any cart fix from a re-run in its own earlier commit). Do not push.
  </action>
  <verify>
    <automated>npm test 2>&1 | tail -5 && git diff 1174eca --stat && test -z "$(git diff --name-only 1174eca -- agent renal)" && test -z "$(git diff 1174eca -- actions/README.md | grep '^@@' | awk '{split($2,a,","); n=substr(a[1],2); if (n+0 < 216) print}')" && test -z "$(git ls-files node_modules actions/.browser-profile)" && git status --porcelain | grep -v -e '^?? .planning' -e '^?? node_modules$' -e '^?? actions/.browser-profile$' | grep -c . | grep -qx 0 && echo ok</automated>
  </verify>
  <done>
One (at most two) headed three-item Kroger run happened, never reached checkout, and ended within the cart's
own limits; the SUMMARY carries the timestamped status log (no secrets) and the Task 1 findings; README Track C
status reflects only what was seen; shared contract untouched; nothing under agent/ or renal/ changed; no
symlink, profile, key or scratch script committed; nothing pushed.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| store web page -> Gemini | Page text and screenshots are untrusted; may carry prompt injection |
| Gemini reply -> Playwright | Model-chosen actions run in a real browser on the patient's behalf |
| .env.local -> process | API key loaded at runtime only |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-jcl-01 | Elevation | executeAction navigate/URL guard | mitigate | Keep isAllowedStoreUrl before goto and after every action; go back on off-domain |
| T-jcl-02 | Tampering | checkout/payment | mitigate | Keep isCheckoutUrl check + BLOCKED_INTENT on every call in a multi-call reply before any runs; tests cover both |
| T-jcl-03 | Info disclosure | type action | mitigate | Keep @/password/credential/card/phone regex refusal and 500-char limit; test kept |
| T-jcl-04 | Elevation | safety_decision | mitigate | Pause on require_confirmation/blocked read from arguments.safety_decision; never send safety_acknowledgement or disabled_safety_policies |
| T-jcl-05 | DoS / cost | loop | mitigate | Keep 60-action cap (now counting every call in parallel replies and unsupported actions) and 4-minute cap; probe capped at 6 requests, live runs at 2 |
| T-jcl-06 | Info disclosure | probe/run scripts, logs | mitigate | Never print env values, sdkHttpResponse, signatures or base64; scripts live outside the repo; .env.local, profile and node_modules are git-ignored and checked absent from git ls-files |
| T-jcl-07 | Spoofing | Kroger bot defences | accept | No browser disguise; a block is recorded as the outcome |
</threat_model>

<verification>
- `npm test` green with no keys and no network.
- `grep "apiVersion: 'v1beta'" actions/cart.mjs` matches; no non-comment `outputs` in cart.mjs or `outputs:` in cart.test.mjs.
- `git log --oneline 1174eca..HEAD` shows the fix commit(s) and the README commit; `git diff 1174eca --name-only` lists only actions/cart.mjs, actions/cart.test.mjs, actions/README.md (plus .planning files).
- SUMMARY contains Task 1 findings (a)-(d) and the timestamped Kroger status log.
</verification>

<success_criteria>
- The cart reads the real v1beta reply shape and executes model actions at the correct viewport points.
- All safety guards present and tested; public contract unchanged; agent/ and renal/ untouched.
- A real three-item Kroger run was made and its true outcome is written down in SUMMARY and actions/README.md.
</success_criteria>

<output>
Create `.planning/quick/261114-jcl-cart-works-against-the-real-gemini-inter/261114-jcl-SUMMARY.md` when done.
</output>
