# Track B: the renal brain

You own `renal/`. Your job is everything the agent knows about kidney diets: the patient's limits, reading a photo of food or a label, deciding whether a food fits, and suggesting meals. None of it needs a phone call, so you can build and test all of it on your laptop with still photos.

## Shared contract (identical in all three track READMEs)

If you change anything in this section, change it in `agent/README.md`, `renal/README.md` and `actions/README.md` in the same commit and tell the other two people.

### The product in one paragraph

RenaLine is a renal dietitian you can FaceTime. (The repo is still called `emoryHackathonDietary`.) A kidney or dialysis patient calls the line, points the camera at a food label, plate, fridge or store shelf, and hears whether it fits their sodium, potassium, phosphorus and fluid limits. The agent can also call the patient at mealtimes and fill a grocery cart in a browser that is shown on the call. There is no app.

### Stack and layout

- Node 24 (22.23.2 or later also works), ES modules, files end in `.mjs`.
- One `package.json` and one `.env.local` at the repo root. Each track owns one folder and does not edit the others.
- Pinned, do not upgrade: `@livekit/agents` 1.8.0, `@livekit/agents-plugin-google` 1.8.0, `@livekit/rtc-node` 0.13.35. These are the versions Chert's starter ships with. The 1.10.0 packages need `rtc-node` 1.x, which Chert's starter code has not been run against.
- The `overrides` pin (`glob` ^14.0.2 under `@livekit/throws-transformer`) came with Track C's merge and must stay.

```
package.json         one package for the whole repo
.env.example         names of every variable below, no values
.env.local           real values, never committed
shared/video.mjs     export const WIDTH = 1280, HEIGHT = 720, FPS = 15, and the safe area SAFE
agent/               Track A  the call: voice, camera in, video out, tools
renal/               Track B  the renal brain: profile, image reading, verdicts, meals
actions/             Track C  reaching out and shopping: cart, outbound call, texts, demo video
```

Root `package.json`:

```json
{
  "private": true,
  "type": "module",
  "engines": { "node": "^22.23.2 || ^24.0.0" },
  "scripts": {
    "start": "node --env-file=.env.local agent/agent.mjs start",
    "test": "node --env-file-if-exists=.env.local --test"
  },
  "dependencies": {
    "@livekit/agents": "1.8.0",
    "@livekit/agents-plugin-google": "1.8.0",
    "@livekit/rtc-node": "0.13.35",
    "@google/genai": "^3.3.0",
    "livekit-server-sdk": "^2.19.3",
    "playwright": "^1.65.1",
    "sharp": "^0.35.5",
    "zod": "^4.1.8"
  },
  "overrides": {
    "@livekit/throws-transformer": {
      "glob": "^14.0.2"
    }
  }
}
```

`.gitignore` contains `node_modules/`, `.env`, `.env.*`, `!.env.example`, `*.log`, `.DS_Store` and `actions/.browser-profile/` (that folder holds a logged-in store session).

### Environment variables

Every key in `.env.example` is listed here. Required means the feature it serves does not work without it. Keys go in `.env.local` only. Never paste them in chat, commit them, or print them.

| Variable | Used by | Required? | What it is and the default |
|---|---|---|---|
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | A, C | Optional | One LiveKit Cloud project, all three from the same project. Leave the `YOUR_` placeholders as they are to use Chert rooms through `chert dev`. |
| `AGENT_NAME` | A, C | Optional | The name the agent registers with. Code default `renal-dietitian`. |
| `GOOGLE_API_KEY` | A, B, C | Required | Gemini API key. The LiveKit plugin reads exactly this name. Google Search grounding for the online lookup needs billing enabled on this key. |
| `GEMINI_LIVE_MODEL` | A | Optional | Gemini Live voice model. Empty means `gemini-3.8-live`. |
| `RENAL_VISION_MODEL`, `RENAL_VISION_FALLBACK_MODEL` | B | Optional | Models for reading pictures. Empty means `gemini-3.8-flash` and fallback `gemini-3.5-flash-lite`. The fallback starts when the primary errors or has not answered in 2.5 s. |
| `RENAL_MEALS_MODEL`, `RENAL_MEALS_FALLBACK_MODEL` | B | Optional | Same for meal ideas. Same defaults. |
| `RENAL_LOOKUP_MODEL` | B | Optional | Model for the Google Search grounded nutrition lookup. Empty means `gemini-3.5-flash-lite`. |
| `RENAL_LOOKUP_FALLBACK_MODEL` | B | Optional | Fallback model for that lookup. Empty means no fallback. |
| `PLAYGROUND` | A | Optional | `1` makes the camera accept video from any non-agent participant, for LiveKit playground tests. Leave empty for real calls. |
| `AGENT_DEBUG_FRAME_DIR` | A | Optional | A folder outside this repo where each camera picture sent to `describeImage` is also saved. Empty saves nothing. The pictures show what the caller shows, so keep them out of git. |
| `AGENT_FAKE_CART` | A | Optional | `1` shows a built-in magenta test frame as the cart, for the simulated proof only. Leave empty for real calls. |
| `AGENT_ALLOW_BARGE_IN` | A | Optional | `1` lets the caller interrupt the agent mid-reply. Empty keeps replies uninterrupted. |
| `AGENT_STATE_DIR` | A | Optional | A folder outside this repo for the per-patient shopping list and pantry (food names only). Empty uses a folder in the system temp directory. |
| `AGENT_CALL_WARN_SECONDS` | A | Optional | Seconds after the greeting before the agent warns the call will end soon. Empty means 240. |
| `VIDEO_SAFE_SCALE` | A, C | Optional | Share of the frame's width and height used by everything shown on the call, centred, because FaceTime shows the agent's video zoomed and cuts off the edges. Backgrounds still fill the whole frame. 0.5 to 1; empty or invalid means 0.8; 1 is the old full-frame layout. Read once at start. |
| `USDA_API_KEY` | B | Optional | FoodData Central key from api.data.gov. `DEMO_KEY` works but allows 10 requests an hour; a personal key allows 3600 an hour. |
| `RENAL_STATE_DIR` | B | Optional | Folder where renal keeps its writable `diary.json` and `cache.json`. Empty uses `renal/data`. Tests use a temp folder. |
| `CHERT_API_KEY`, `CHERT_PROJECT_ID`, `CHERT_LINE_ID` | C | Required for texts and outbound calls | Project API key (`ftk_...`, from the Chert Developer page), project id and line id. |
| `PATIENT_PHONE` | A, C | Required for texts and outbound calls | The patient's phone in international form, for example `+1XXXXXXXXXX`. If it is empty, `text_cart_link` and `text_recipe` fail with `no_phone`. |
| `GROCERY_STORE_URL` | C | Required for the cart | HTTPS URL of a supported grocery retailer. |
| `INSTACART_API_KEY` | C | Optional | Instacart shopping-list fallback when the store blocks automation. |
| `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET` | C | Optional | Kroger public API app credentials (developer.kroger.com, Production, with Cart, Locations, Products and Profile). When both are set the cart uses the Kroger API instead of the browser. |
| `KROGER_LOCATION_ID` | C | Optional | Kroger store used for product search and prices. Empty means `01100695` (Kroger - Ponce). |
| `KROGER_REDIRECT_URI` | C | Optional | Sign-in redirect; must match the redirect URI registered on the Kroger app. Empty means `http://localhost:8765/callback`. |
| `KROGER_TOKEN_DIR` | C | Optional | A folder outside this repo for the saved Kroger sign-in. Empty means `~/.config/renal-dietitian`. |

### Rules for every function that crosses a track boundary

1. `async`, takes one plain object, returns one plain object. The one exception is `getCartFrame`, which is synchronous because it is called 15 times a second.
2. Never throws. On failure it returns `{ ok: false, error: 'short reason' }`. On success the object has `ok: true`.
3. Returns within its time budget, because a person is waiting on a live call. `describeImage` about 5.4 s and `suggestMeals` about 5.1 s in total, including the fallback model. `checkFood` is quick from the built-in list but can take about 8 s in the worst case (USDA about 2.4 s, then the online lookup 5.5 s). The agent guards every tool at 12 s. `startCart` and `callPatient` return as soon as the work has started. A USDA failure no longer fails `checkFood`: it falls through to the online lookup and then to an honest `unknown`.
4. Works with no network where it can (cached or seeded data), so the demo survives bad wifi.

### Types

```js
// Profile: the patient's daily limits, set by their care team.
{ id: 'demo', name: 'Sam', limits: { sodiumMg: 2000, potassiumMg: 2000, phosphorusMg: 1000, fluidMl: 1000 },
  avoid: ['star fruit', 'salt substitute'], setBy: 'care team' }

// Seen: what Gemini read from one camera frame.
{ ok: true,
  kind: 'label' | 'plate' | 'fridge' | 'shelf' | 'unclear',
  foods: [{ name: 'banana', grams: 118 }],          // grams may be null
  label: null | { product: 'Chicken broth', servingSize: '1 cup (240 mL)',
                  sodiumMg: 860, potassiumMg: null, phosphorusMg: null,
                  ingredients: 'chicken stock, salt, sodium phosphate' } }

// Food: one thing to judge. Built from Seen, or from what the patient says.
{ name: 'banana', grams: 118, label: null }           // grams and label are optional

// Verdict: the answer for one food.
{ ok: true, food: 'banana',
  verdict: 'ok' | 'limit' | 'avoid' | 'unknown',
  say: 'A banana has about 420 milligrams of potassium, a fifth of your day. Half is fine.',
  reasons: ['potassium 422 mg is 21% of the 2000 mg daily limit'],
  nutrients: { sodiumMg: 1, potassiumMg: 422, phosphorusMg: 26 },   // for the portion judged, or null
  portion: '1 medium (118 g)',
  swap: 'an apple' ,                                                // or null
  source: 'label' | 'usda' | 'web' | 'rule' | 'none' }

// CartItem: one thing to buy.
{ name: 'unsalted chicken broth', quantity: '1 carton' }
```

Notes on `Verdict`:

- `source` is `'label'` for numbers printed on a label, `'usda'` for the built-in list and USDA matches, `'web'` for the online lookup, `'rule'` when a hard rule decided it, and `'none'` when nothing was found.
- `portion` can read `'100 g (no typical serving size known)'`. Reasons and portion can say "judged as <food>" when a food was matched by its plain name.
- A `'web'` verdict's `say` ends with "That is from what I found online, not from your care team's list."
- Food names seen on a plate, fridge or shelf are generic (no brands). A label keeps its printed product name.

### The hand-offs

Track A imports everything below and exports nothing. B and C do not import each other.

`renal/index.mjs` (Track B)

| Function | Returns |
|---|---|
| `getProfile({ patientId })` | `{ ok, profile }` |
| `describeImage({ jpeg }, { ai }?)` where `jpeg` is a `Buffer` | a `Seen` |
| `checkFood({ food, profile }, { ai }?)` | a `Verdict` |
| `suggestMeals({ foods, profile, count, fromScratch? }, { ai }?)` where `foods` is `string[]` (ignored when `fromScratch` is true) | `{ ok, meals: [{ title, uses: string[], missing: CartItem[], minutes, steps: string[], why, totals? }] }`. With `fromScratch: true` every non-staple ingredient is in `missing`, and each meal has `totals: { sodiumMg, potassiumMg, phosphorusMg }` (one typical portion of each ingredient, each total at most one third of the daily limit). |
| `logFood({ patientId, verdict })` | `{ ok }` |
| `getToday({ patientId })` | `{ ok, totals, remaining, items }` where `totals` and `remaining` have `sodiumMg`, `potassiumMg`, `phosphorusMg` |

The optional second argument `{ ai }` is an injected Gemini client. It is a test seam only; the agent never passes it.

`actions/index.mjs` (Track C)

| Function | Returns |
|---|---|
| `startCart({ items })` where `items` is `CartItem[]` | `{ ok }` at once; the cart fills in the background. One cart at a time: a second call returns `{ ok: false, error: 'busy' }`. |
| `getCartStatus()` | `{ ok, state: 'idle' \| 'running' \| 'waiting_for_patient' \| 'done' \| 'failed', step, added: [{ name, price }], missing: string[], total, cartUrl }` |
| `getCartFrame()` (synchronous) | A `Uint8Array` of exactly `WIDTH * HEIGHT * 4` RGBA bytes showing the browser, or `null` when no cart is running. |
| `stopCart()` | `{ ok }` |
| `callPatient({ phone, reason })` | `{ ok, callId }` once Chert has accepted the request |
| `sendText({ phone, text })` | `{ ok }`. Refuses any recipient other than `PATIENT_PHONE`. |

The agent log prints each tool result as `[agent] tool <name> ok=true|false [error=<code>]`.

### What is verified and what is not

Checked on 13 November 2026 by reading the installed packages, Chert's docs and CLI, and a live request:

- Chert's starter is Node on `@livekit/agents` 1.8.0, and the caller sees whatever video the speaking participant publishes.
- In `@livekit/agents-plugin-google` (1.8.0 and 1.10.0) the Gemini voice model's `pushVideo` is empty. Live camera frames never reach the voice model in Node. That is why the camera is read as snapshots through `describeImage`.
- `@livekit/rtc-node` 0.13.35 exports `VideoStream`, `VideoFrame.convert`, `VideoSource`; `@livekit/agents` 1.8.0 exports `llm.tool` and `voice.Agent({ instructions, tools })`.
- `livekit-server-sdk` 2.19.3 sets the token's `nbf` to now, so a `ttl` of two hours or less meets Chert's bridge-token rule.
- The USDA search endpoint returns sodium (id 1093), potassium (1092) and phosphorus (1091) per 100 g.

Seen in live testing on 14 November 2026:

- A real call runs with `npm start` in one terminal and `npx @trychert/facetime@0.1.0-beta.20 dev --agent renal-dietitian --minutes 30` in another. One `chert dev` session holds the team's single line at a time.
- The caller's camera now reaches the agent. With `AGENT_DEBUG_FRAME_DIR` set, the saved frames show what the caller shows.
- iMessage through Chert on the trial line: the agent can only reply. A send is refused with HTTP 403 `shared_reply_window_closed` until the patient's phone has joined the project and has texted the line a message with words in it within the last 24 hours. After that a send returned `{"state":"sent"}`.
- The shared USDA `DEMO_KEY` allows 10 requests an hour and ran out during testing.
- `gemini-3.8-flash` was overloaded all day (503s, timeouts). Vision and meals fall back to `gemini-3.5-flash-lite` after 2.5 s. Google Search grounding needs billing on the Gemini key; without it every grounded request returned 429 "exceeded your current quota".

The Live voice model defaults to `gemini-3.8-live` when `GEMINI_LIVE_MODEL` is empty (see `agent/agent.mjs`).

Not verified yet:

- The grocery cart on a live call.
- The outbound mealtime call, and whether the trial allows outbound calls.
- `text_cart_link` and `text_recipe` from a live call. Only a direct API send worked.
- Pantry memory on a live call (tested with fakes only).
- The online lookup live with billing on.
- Receiving photos by iMessage (parked: photo-only messages did not show up through the API on the trial project).
- Turning off the auto-reply Chert sends to inbound texts on the project.

### Shared limits

- One Chert line, one call at a time. One `chert dev` session holds the line, so only one person can be on it. Say in the team chat before you place a call.
- Chert trial: 50 FaceTime minutes in total (about 33 left at 16:20 UTC on 14 November), 5 minutes per call. The trial ends 15 November 2026 23:12 UTC. Spend minutes only on scripted test calls and the demo recording.
- If no agent is connected for 3 hours the line is released and the number can change.
- The USDA `DEMO_KEY` allows only 10 requests an hour. Use a personal key.
- The online lookup needs billing enabled on the Gemini key.
- The agent gives guidance inside limits a care team set. It says so on the call, never changes the limits, and never pays for anything.

### Checkpoints

Times assume submission at 8:00am Sunday. Merge to `main` at each one; `main` must always start with `npm start`.

| When | What must be true |
|---|---|
| Friday 10pm | Root scaffold on `main`: `package.json`, `shared/video.mjs`, and stub versions of every function above that return canned data of the right shape. Everyone branches from this. |
| Saturday 2am | A: a FaceTime call is answered, greeted and conversational. B: `checkFood` and `describeImage` pass their tests on real photos. C: the cart fills on one store on a laptop. |
| Saturday 10am | Integrated: on a call, "can I eat this?" with a label in view gets a correct spoken verdict. Browser frames appear on the call or the fallback is chosen. |
| Saturday 8pm | Twist 3 (it calls or texts you) and twist 4 (in the aisle) work end to end. |
| Sunday 12am | Feature freeze. Record the real footage. Only fixes after this. |
| Sunday 8am | Submit. |

## Track B in detail

### What changed in your module during the merge

Nine commits touched `renal/` during the merge. You need to review them. Reproduce the list with:

```sh
git log --oneline origin/track-b/renal..HEAD -- renal
```

```
5aa78ce feat(renal): judge web results per found serving with spoken online provenance
d22daa7 fix(renal): USDA failures fall through to a grounded web lookup instead of failing the check
51d6823 feat(renal): generic food names from vision and a guarded generic seed fallback
4620a3c feat(renal): grounded web nutrition lookup with strict parsing and grounding gate
25f3825 fix(renal): fall back to a second Gemini model when the primary is overloaded
11ee2ec fix(renal): fall back to the product name when a label shows no nutrient numbers
aa4223d fix(renal): resolve cola brands to the curated seed and reject implausible USDA matches
42ded6d fix(renal): judge foods without a known serving per 100 g instead of crashing
48dff8a fix(renal): keep diary and USDA cache writes out of committed data during tests
```

In plain words:

- Tests no longer write to committed data: `RENAL_STATE_DIR` (empty means `renal/data`) moves `diary.json` and `cache.json` to a temp folder.
- A food with no known serving is judged per 100 g, and the portion reads `100 g (no typical serving size known)`. `numberWords` in `check.mjs` can no longer recurse forever.
- Cola brand names resolve to the cola entry in the built-in list (aliases only; no numbers changed). A USDA hit must pass `plausibleMatch` (now in `renal/data.mjs`) to be used. The search asks for 10 results and takes the first plausible one.
- Hard rules (always avoid, always limit) match whole phrases against the spoken name and the matched list name. A name that matches an always-limit rule with no nutrient data returns `limit` rather than `unknown`.
- A label with no nutrient numbers is judged by its product name plus the ingredient rules.
- `describeImage` and `suggestMeals` call a primary Gemini model and a fallback model under one deadline (`renal/gemini.mjs`). The fallback starts when the primary errors or has not answered in 2.5 s.
- Food names from `describeImage` for plates, fridges and shelves are now generic (no brands). A label keeps its printed product name. A guarded fallback matches a plain trailing name in the built-in list ("judged as lettuce").
- Online lookup (`renal/websearch.mjs`): when the built-in list and USDA have nothing, Gemini with Google Search is asked and the answer is accepted only under strict checks. A USDA failure (429, 5xx, timeout, bad JSON) no longer fails `checkFood`; it falls through to this lookup and then to an honest `unknown`. A web result is judged per found serving, with `source: 'web'` and a spoken "found online" sentence.
- `index.mjs` still exports exactly the six contract functions. `lookupFood`, `plausibleMatch` and `numberWords` are internal.

Residual limitations noted by the authors of those commits:

- Diet colas reuse regular cola numbers, and "soda", "pop" and "soft drink" are judged as cola (conservative).
- The USDA plausibility guard is token based; a brand word inside a manufacturer phrase can still pass for a name that has no alias.
- Grounded numbers cannot be verified against the page. The bounds are loose (sodium up to 5000 mg per serving), so a wrong but plausible number could pass.
- A web result with a serving in millilitres scales by grams as if 1 g were 1 ml when the caller gives grams.
- The agent's `look_at_camera` rows cut spoken verdicts at 130 or 60 characters, which can cut the "found online" sentence.
- The generic fallback is narrow on purpose, but a brand name that hides a risky product can still resolve to the plain entry.
- The web miss cache lives in memory for 10 minutes only.

### What to do next

1. Fix serving sizes first. Foods found in USDA with no serving size are judged per 100 g, which is harsh for cereal and condiments and lenient for drinks such as coconut water. This is the top open item.
2. Add every demo food to `renal/data/foods.json`, checking each number.
3. Give the demo patient realistic limits (see "The demo patient").
4. Review the nine commits above.

### Known weaknesses

- Per 100 g judging when USDA has no serving size (see above).
- Diet colas reuse regular cola numbers. "Soda", "pop" and "soft drink" are judged as cola.
- The online lookup can return different results for the same product on different tries.
- The demo patient profile ("Sam", fixed limits) is hard-coded data in `renal/data/patients.json`.
- The online lookup needs billing on the Gemini key. Without it every grounded request returns 429 and the answer is "I cannot judge it yet".
- `gemini-3.8-flash` was overloaded on 14 November; vision and meals rely on the fallback model.
- The live USDA, fallback and online paths were exercised against the real services from the command line, not on a call.

### What you build

| File | Purpose |
|---|---|
| `renal/index.mjs` | Re-exports the six functions in the contract. Nothing else is imported from outside this folder. |
| `renal/profile.mjs` | `getProfile`. Reads `renal/data/patients.json`. |
| `renal/vision.mjs` | `describeImage`. One Gemini call (primary plus fallback model) that turns a JPEG into a `Seen`. |
| `renal/gemini.mjs` | Calls a primary model with a hedged fallback under one deadline. Used by vision, meals and the online lookup. |
| `renal/nutrients.mjs` | Looks a food up: built-in list, guarded plain-name match, USDA with a cache, then the online lookup. |
| `renal/websearch.mjs` | The Google Search grounded nutrition lookup. |
| `renal/data.mjs` | Reads and writes the data files (honouring `RENAL_STATE_DIR`), name normalising, `plausibleMatch`. |
| `renal/check.mjs` | `checkFood`. Pure logic once the nutrients are known. |
| `renal/meals.mjs` | `suggestMeals`. |
| `renal/diary.mjs` | `logFood`, `getToday`. In memory, saved to `diary.json`. |
| `renal/data/foods.json` | The built-in list: 63 foods with sodium, potassium and phosphorus per 100 g, so the demo works offline. |
| `renal/data/hard-rules.json` | Foods that are always `avoid` or always need a warning. |
| `renal/data/patients.json`, `diary.json`, `cache.json` | The demo patient, the diary and the lookup cache. |
| `renal/*.test.mjs` | Tests, run with `npm test`. |

There is no `renal/photos/` folder in this checkout.

### Order of work

The original order is below. Everything in it is built.

1. `getProfile` and the demo patient.
2. `checkFood` for a food that has a label.
3. `nutrients.mjs` with the built-in list, then USDA lookup with a cache.
4. `checkFood` for a named food with no label.
5. `describeImage`.
6. `suggestMeals`.
7. `logFood` and `getToday`.

### The demo patient

```json
{ "demo": { "id": "demo", "name": "Sam",
  "limits": { "sodiumMg": 2000, "potassiumMg": 2000, "phosphorusMg": 1000, "fluidMl": 1000 },
  "avoid": ["star fruit", "salt substitute"], "setBy": "care team" } }
```

These numbers are placeholders in the range commonly given to dialysis patients. Real limits are set per patient by their nephrologist and dietitian and vary a lot. Before the pitch, check them against a published source such as the National Kidney Foundation's patient guidance, and say in the demo that the limits come from the care team.

### `checkFood`

Input is a `Food` and a `Profile`. Work out sodium, potassium and phosphorus for the portion, then compare each with the daily limit.

Where the numbers come from, in this order. Each step is tried only if the one before found nothing:

1. Label numbers on `food.label`. `source: 'label'`.
2. The built-in list (`foods.json`), by exact name or alias. `source: 'usda'`.
3. The built-in list by plain name: trailing words are dropped, guarded so a risk word or a food word is never dropped. `source: 'usda'`, and the reasons and portion say "judged as <food>".
4. USDA, with a guarded match. `source: 'usda'`.
5. Gemini with Google Search, accepted only with real search evidence, a matching product and sane bounds. `source: 'web'`. The spoken answer ends "That is from what I found online, not from your care team's list."
6. Nothing found: `verdict: 'unknown'`, `source: 'none'`, "I cannot judge it yet". Never guess numbers.

Hard rules (always avoid, always limit, phosphate additives, salt substitutes, the profile's avoid list) apply on top of any of these and only ever make a verdict stricter. When a rule decides, `source` is `'rule'`.

Portion: use `food.grams` when given. Otherwise use the typical serving from the built-in list or the found serving. With no known serving the food is judged per 100 g.

The verdict rule, per portion, taking the worst of the three nutrients (as implemented in `check.mjs`):

| Share of the daily limit | Verdict |
|---|---|
| under 10% | `ok` |
| 10% to 25% | `limit` (suggest a smaller portion) |
| over 25% | `avoid` (offer a `swap`) |

This rule is a heuristic invented for the demo, not a clinical standard. Sanity-check it against a renal diet food list: bananas, potatoes, tomatoes, oranges, avocado and beans should come out as `limit` or `avoid` for potassium; cola, processed cheese and deli meat for phosphorus or sodium; apples, grapes, cabbage, white rice and unsalted chicken as `ok`.

Rules that override the arithmetic (`source: 'rule'`):

- **Phosphate additives.** US labels are not required to list phosphorus, so a missing number does not mean zero. If `label.ingredients` contains `phos` (sodium phosphate, phosphoric acid, calcium phosphate and so on), the verdict is at least `limit` and the reason names the additive.
- **Salt substitutes.** Many are potassium chloride. If ingredients contain `potassium chloride`, at least `limit`.
- **Star fruit.** Always `avoid` for kidney patients.
- Anything in `profile.avoid`.

Fluid: for soups, drinks and ice, mention in `reasons` that it counts toward the fluid limit. Tracking millilitres is a stretch goal.

`say` is one or two short sentences the agent will speak word for word. Lead with the verdict, give one number, and offer the swap. Write numbers the way they are spoken ("about 420 milligrams"). No lists and no symbols.

### Nutrient lookup

USDA FoodData Central, checked live on 13 November:

```
GET https://api.nal.usda.gov/fdc/v1/foods/search
    ?api_key=$USDA_API_KEY&query=banana%20raw&dataType=Foundation,SR%20Legacy&pageSize=10
```

Each result has `foodNutrients`, an array of `{ nutrientId, nutrientName, unitName, value }`. Values are per 100 g. The ids you need:

| Nutrient | `nutrientId` | Unit |
|---|---|---|
| Sodium | 1093 | mg |
| Potassium | 1092 | mg |
| Phosphorus | 1091 | mg |
| Water | 1051 | g |

For "Bananas, raw" it returned potassium 358, phosphorus 22, sodium 1.

- Get a free key from api.data.gov. `DEMO_KEY` is limited to 10 requests an hour and ran out during testing on 14 November. A personal key allows 3600 an hour.
- `dataType` is restricted to `Foundation,SR Legacy`. The code asks for 10 results and takes the first one that passes `plausibleMatch` and has at least one of the three nutrients. The first hit alone is not always the food you meant.
- Lookups are cached in `cache.json` inside `RENAL_STATE_DIR` (default `renal/data`). `cache.json` is tracked in git and currently holds an empty `foods` object. Do not commit cache changes that a live test run left behind; check `git status` first. Tests set `RENAL_STATE_DIR` to a temp folder so they never touch it.
- The USDA request has a 2.4 second timeout (`nutrients.mjs`).
- A USDA failure is never a failed check and is not cached as "not found".

### Online lookup (`renal/websearch.mjs`)

- Model: `RENAL_LOOKUP_MODEL`, or `gemini-3.5-flash-lite` when empty. `RENAL_LOOKUP_FALLBACK_MODEL` is the fallback, empty means none. Budget: 5.5 s in total, with the fallback hedged at 3 s.
- The request uses Google Search grounding (`googleSearch` tool) with temperature 0. The model must answer with one free sentence then seven fixed lines (PRODUCT, SERVING, SERVING_AMOUNT, SODIUM_MG, POTASSIUM_MG, PHOSPHORUS_MG, PHOSPHATE_ADDITIVE). Anything else rejects the whole answer. `unknown` becomes null, never a default.
- Acceptance gate: the response has at least one web search query and at least one grounding chunk with an http(s) address; the product passes `plausibleMatch` against the query; at least one nutrient is a number; sodium and potassium are at most 5000 and phosphorus at most 3000 mg; the serving is 1 to 2000 g or ml. Cache reads run the same check again.
- Billing must be enabled on the Gemini key. Without it every grounded request returned 429 "exceeded your current quota" on 14 November, and the lookup falls through to "I cannot judge it yet".
- Accepted results are cached under a `web` namespace in `cache.json`. A rejected lookup is remembered in memory only, for 10 minutes.
- Results vary between tries for the same product.
- The spoken answer ends "That is from what I found online, not from your care team's list."

### `describeImage`

One call with `@google/genai`, image plus a fixed instruction, JSON out, through `renal/gemini.mjs`. The model is `RENAL_VISION_MODEL` (default `gemini-3.8-flash`) with `RENAL_VISION_FALLBACK_MODEL` (default `gemini-3.5-flash-lite`) as the fallback, started when the primary errors or has not answered in 2.5 s. The total budget is about 5.4 s.

- Food names for plates, fridges and shelves are generic, with no brands. A label keeps its printed product name.
- For a demo, set `RENAL_VISION_MODEL=gemini-3.5-flash-lite` (and `RENAL_MEALS_MODEL`) to skip the wait when the primary is overloaded.
- On 14 November a live fridge frame (1280 by 720) was read as kind `fridge` with two foods.
- The frame comes from a FaceTime call, so it may be low resolution, tilted, and may include FaceTime's on-screen controls. If small label text is unreadable, `kind: 'unclear'` makes the agent ask the caller to move closer.
- The JSON is validated after parsing. A wrong type returns `{ ok: false, error: 'bad model output' }`.

### `suggestMeals`

Given the foods seen and the profile, return up to `count` meals (default 2). Each meal's `missing` list uses the `CartItem` shape, because Track A passes it straight to Track C's `startCart`. Gemini proposes the meals as JSON, then every ingredient goes through `checkFood` and any meal containing an `avoid` is dropped. The model proposes; the rules decide. The model is `RENAL_MEALS_MODEL` with `RENAL_MEALS_FALLBACK_MODEL`, same defaults as vision, about 5.1 s in total.

From-scratch mode (`fromScratch: true`): Gemini gets its own prompt listing only the built-in foods that check `ok` or `limit` for this patient, with their per-portion numbers from `checkFood`. Every non-staple ingredient must be on the built-in list, pass `checkFood` (not `avoid` or `unknown`) with three real numbers, and number at most `FROM_SCRATCH_MAX_INGREDIENTS` (6). The summed totals must each be at most `MEAL_SHARE_OF_DAILY_LIMIT` (one third) of the daily limit, otherwise the meal is dropped. Totals count one typical portion of each ingredient and nothing is estimated. `FALLBACK_MEALS` work in this mode too, with every ingredient moved to `missing`.

The second argument also accepts a `check` option, a test seam that defaults to `checkFood`. It is not part of the shared contract.

Follow-up: the from-the-kitchen mode does not check totals yet, because kitchen foods can be judged from USDA, online or label numbers with different serving bases, or with missing phosphorus.

### Tests

`npm test` runs every `*.test.mjs` with Node's built-in runner and needs no keys or network. To run only renal's tests use `node --test renal/*.test.mjs` (on Node 24 `node --test renal/` fails because it treats the folder as a file).

### Done means

- All six functions exist with the exact names and shapes in the contract.
- Tests pass with the network off.
- No verdict ever contains a number that did not come from a label, the built-in list, USDA or a grounded web result that passed the gate.
