# Track A: the call

You own `agent/`. Your job is the FaceTime call itself: the agent answers, greets in time, talks, grabs frames from the caller's camera, shows either a face or the shopping browser, and calls Track B and Track C through tools. You also own the root scaffold, the Chert line and `chert dev`.

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
kroger-relay/        Track C  small public Vercel relay for the Kroger sign-in callback (not part of the agent; deployed by a person)
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
| `AGENT_END_SILENCE_MS` | A | Optional | How long the caller must be silent before the agent treats their turn as finished, in milliseconds (300 to 3000). Empty means 1000. Raise it if the agent answers while the caller is still talking. |
| `AGENT_STATE_DIR` | A | Optional | A folder outside this repo for the per-patient shopping list and pantry (food names only) and the caller's chosen voice, reply length, language and preferred name. Empty uses a folder in the system temp directory. |
| `AGENT_CALL_WARN_SECONDS` | A | Optional | Seconds after the greeting before the agent warns the call will end soon. Empty means 240. |
| `AGENT_SKIP_ONBOARDING` | A | Optional | `1` stops first-call setup from starting by itself ("update my setup" still works). Empty means a caller with no finished setup is set up on their first call. |
| `VIDEO_SAFE_SCALE` | A, C | Optional | Share of the frame's width and height used by everything shown on the call, centred, because FaceTime shows the agent's video zoomed and cuts off the edges. Backgrounds still fill the whole frame. 0.5 to 1; empty or invalid means 0.8; 1 is the old full-frame layout. Read once at start. |
| `USDA_API_KEY` | B | Optional | FoodData Central key from api.data.gov. `DEMO_KEY` works but allows 10 requests an hour; a personal key allows 3600 an hour. |
| `RENAL_STATE_DIR` | B | Optional | Folder where renal keeps its writable `diary.json` and `cache.json` (empty uses `renal/data`) and the patient's saved `profiles.json` (empty uses a `renal-state` folder in the system temp directory; never inside the repo). Tests use a temp folder. |
| `CHERT_API_KEY`, `CHERT_PROJECT_ID`, `CHERT_LINE_ID` | C | Required for texts and outbound calls | Project API key (`ftk_...`, from the Chert Developer page), project id and line id. |
| `PATIENT_PHONE` | A, C | Required for texts and outbound calls | The patient's phone in international form, for example `+1XXXXXXXXXX`. If it is empty, `text_cart_link` and `text_recipe` fail with `no_phone`. |
| `GROCERY_STORE_URL` | C | Required for the cart | HTTPS URL of a supported grocery retailer. |
| `INSTACART_API_KEY` | C | Optional | Instacart shopping-list fallback when the store blocks automation. |
| `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET` | C | Optional | Kroger public API app credentials (developer.kroger.com, Production, with Cart, Locations, Products and Profile). When both are set the cart uses the Kroger API instead of the browser. |
| `KROGER_LOCATION_ID` | C | Optional | Kroger store used for product search and prices. Empty means `01100695` (Kroger - Ponce). |
| `KROGER_REDIRECT_URI` | C | Optional | Used only by the localhost sign-in, when the two relay variables below are empty; must match the redirect URI registered on the Kroger app. Empty means `http://localhost:8765/callback`. |
| `KROGER_RELAY_URL`, `KROGER_RELAY_SECRET` | C | Optional | The sign-in relay's production domain (https, no trailing slash) and the shared secret (the relay's `RELAY_SECRET`, 32 characters or more). When both are set, Kroger sign-in goes through the relay (a texted link, or `actions/kroger-login.mjs`), and the Kroger app's redirect URI must be `<relay>/api/kroger/callback`. See `kroger-relay/README.md`. |
| `KROGER_TOKEN_DIR` | C | Optional | A folder outside this repo for the saved Kroger sign-in. Empty means `~/.config/renal-dietitian`. |

### Rules for every function that crosses a track boundary

1. `async`, takes one plain object, returns one plain object. The one exception is `getCartFrame`, which is synchronous because it is called 15 times a second.
2. Never throws. On failure it returns `{ ok: false, error: 'short reason' }`. On success the object has `ok: true`.
3. Returns within its time budget, because a person is waiting on a live call. `describeImage` about 5.4 s and `suggestMeals` about 5.1 s in total, including the fallback model; `dishIngredients` about 8.5 s and `previewCart` about 6 s. `checkFood` is quick from the built-in list but can take about 8 s in the worst case (USDA about 2.4 s, then the online lookup 5.5 s). The agent guards every tool at 12 s. `startCart` and `callPatient` return as soon as the work has started. A USDA failure no longer fails `checkFood`: it falls through to the online lookup and then to an honest `unknown`.
4. Works with no network where it can (cached or seeded data), so the demo survives bad wifi.

### Types

```js
// Profile: the patient's daily limits, from their care team (built-in demo) or as the patient read them out in first-call setup (setBy 'patient, as told by their care team', plus setOn and condition).
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
| `getProfile({ patientId })` | `{ ok, profile }`. The patient's saved profile when first-call setup saved all four limits (`setBy: 'patient, as told by their care team'`, `setOn`, `condition`, `source: 'patient'`), otherwise the built-in one from `renal/data/patients.json` (`source: 'builtin'`). A saved profile without limits gives `{ ok: false, error, limitsNeeded: true }`, never a default. |
| `getSavedProfile({ patientId })` | `{ ok, saved }`, where `saved` is `null` or `{ id, name, condition, limits, avoid, setBy, setOn, setupDone }` and `limits` may be `null`. Used to decide whether a caller needs setup. |
| `saveProfile({ patientId, profile: { name, condition, limits, avoid, setupDone } })` | `{ ok, saved }` or `{ ok: false, error, field? }`. Replaces the saved profile after strict checks: `limits` is `null` or all four whole numbers within `LIMIT_BOUNDS` (sanity bounds, not medical advice), `condition` is one of `CONDITIONS` or `null`, and `avoid` holds at most 10 short names. Stored in `profiles.json` outside the repo, mode 600. |
| `resetProfile({ patientId })` | `{ ok, removed }`. Deletes the saved profile, so the built-in profile and first-call setup come back (for demos). |
| `describeImage({ jpeg }, { ai }?)` where `jpeg` is a `Buffer` | a `Seen` |
| `checkFood({ food, profile }, { ai }?)` | a `Verdict` |
| `suggestMeals({ foods, profile, count, fromScratch? }, { ai }?)` where `foods` is `string[]` (ignored when `fromScratch` is true) | `{ ok, meals: [{ title, uses: string[], missing: CartItem[], minutes, steps: string[], why, totals? }] }`. With `fromScratch: true` every non-staple ingredient is in `missing`, and each meal has `totals: { sodiumMg, potassiumMg, phosphorusMg }` (one typical portion of each ingredient, each total at most one third of the daily limit). |
| `logFood({ patientId, verdict })` | `{ ok }` |
| `dishIngredients({ dish, profile }, { ai }?)` | `{ ok, dish, source: 'model' \| 'builtin' \| 'none', ingredients: [{ name, quantity, verdict, swap, nutrients, portion, say, source, checked }], omitted? }`. The model gives names and quantities only; every ingredient is re-checked with `checkFood` and its verdict, swap and numbers come from there. At most 8 ingredients, no water, oil, pepper, herbs or spices. A built-in table covers a few common dishes when the model is absent or slow. About 8.5 s worst case. |
| `getToday({ patientId })` | `{ ok, totals, remaining, items }` where `totals` and `remaining` have `sodiumMg`, `potassiumMg`, `phosphorusMg` |

The optional second argument `{ ai }` is an injected Gemini client. It is a test seam only; the agent never passes it.

`actions/index.mjs` (Track C)

| Function | Returns |
|---|---|
| `startCart({ items })` where `items` is `CartItem[]` | `{ ok }` at once; the cart fills in the background. One cart at a time: a second call returns `{ ok: false, error: 'busy' }`. |
| `getCartStatus()` | `{ ok, state: 'idle' \| 'running' \| 'waiting_for_patient' \| 'done' \| 'failed', step, added: [{ name, price }], missing: string[], total, cartUrl }` |
| `getCartFrame()` (synchronous) | A `Uint8Array` of exactly `WIDTH * HEIGHT * 4` RGBA bytes showing the browser, or `null` when no cart is running. |
| `stopCart()` | `{ ok }` |
| `previewCart({ items })` where `items` is `CartItem[]` (at most 12) | `{ ok, shown, found, notFound, total }`, or `{ ok: false, error: 'not_configured' \| 'busy' \| 'render_failed' \| ... }`. Read-only: app-token product search and product pictures only, no sign-in, no user token, no cart call. The card is titled "Your list · not in your Kroger cart yet", held 20 s, and removed by `startCart` or `stopCart`. An empty list shows nothing (and hides a showing preview). |
| `callPatient({ phone, reason })` | `{ ok, callId }` once Chert has accepted the request |
| `sendText({ phone, text })` | `{ ok }`. Refuses any recipient other than `PATIENT_PHONE`. |
| `startKrogerSignIn()` | `{ ok: true, link }`, where `link` is `${KROGER_RELAY_URL}/k/<43-character state>`; otherwise `{ ok: false, error: 'not_configured' \| 'no_relay' }`. Starts polling the relay in the background for up to 4 minutes and saves the Kroger sign-in when the patient finishes. Nothing but the link is returned, and no code, state, secret or token is logged. |
| `getKrogerStatus()` | `{ ok: true, configured, relay, connected, pending }`, all booleans: both Kroger keys set; both relay variables set and valid; a stored sign-in exists (no refresh call, so an expired sign-in reads as connected until the cart reports it); a relay sign-in is being polled. |

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
- Kroger's public API only adds to a cart. With a real signed-in token, `GET /v1/carts` returned 403 "required scope not found"; `PUT /v1/cart/add` with quantity 0 or -1 returned 400 ("Quantity is required", "Quantity must be at least 1"); there is no remove route; and the sign-in page accepts only the `cart.basic:write` cart scope (`cart.basic:rw` and `:read` give `invalid_scope`). The agent can neither remove nor read items in the real Kroger cart, so removing happens on the list before anything is sent.
- The shared USDA `DEMO_KEY` allows 10 requests an hour and ran out during testing.
- `gemini-3.8-flash` was overloaded all day (503s, timeouts). Vision and meals fall back to `gemini-3.5-flash-lite` after 2.5 s. Google Search grounding needs billing on the Gemini key; without it every grounded request returned 429 "exceeded your current quota".

The Live voice model defaults to `gemini-3.8-live` when `GEMINI_LIVE_MODEL` is empty (see `agent/agent.mjs`).

Not verified yet:

- The grocery cart on a live call.
- The Kroger sign-in relay deployed on Vercel, the switch of the Kroger app's redirect URI, and the texted sign-in link tapped on a real phone. Only the handlers and a local end-to-end test with a fake Kroger token endpoint have run.
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
- Optional protein and carbohydrate limits: setup asks one skippable question after the four limits. `propose_limits` and `confirm_limits` take optional `protein_g` and `carbs_g` (whole grams, 20 to 200 and 50 to 500), read them back only when given, and save them only on a matching confirm. The verdict card adds Protein and Carbs tiles in a second row when the check returned them (the panel grows upward; cards for three or fewer nutrients are unchanged). Known gaps: meal and dish totals, picking the best item and the diary stay on the three minerals; online lookups have no protein or carbs.

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

## Track A in detail

### What changed in your module during the merge

- The real `renal/` and `actions/` replaced the stubs. `agent/tools.mjs` is still the only file that imports them.
- The agent tests now run on deterministic fakes (`agent/fake-modules.mjs`, not the real modules). `agent/contract.test.mjs` checks the real renal and actions contracts.
- Pantry memory (`agent/memory.mjs`): the agent remembers food names between shots and calls, per patient, and the file expires after 2 hours. New tools: `pantry_list`, `remove_from_pantry`, `clear_pantry` and `text_recipe`.
- `look_at_camera` gained an optional `place` argument (`home` or `store`) and the failure codes `vision_failed`, `unclear_picture` and `no_food_seen`. It no longer returns `check_failed`. A look that saw foods is always `ok: true`, with `unjudged: true` when none could be checked, `online: true` when a verdict came from the online lookup, and `remembered: true` when foods were added to the pantry.
- A label with no printed product name is judged as "this product" with `unnamed: true` (only numbers printed on the label are used; it is not remembered in the pantry or for `log_meal`; a label with nothing usable returns `label_unreadable`). `suggest_meal` keeps water, ice, pepper and cooking oils off the shopping list and the cart. A leading `Okay,`, `Limit,` or `Avoid,` from renal is no longer repeated after the agent's own verdict word.
- `agent/toollog.mjs` formats the log line `[agent] tool <name> ok=true|false [error=<code>]`. The code must match `^[a-z_]{1,40}$`, otherwise it logs `other`. Other values: `none` (failed with no code), `tool_exception` (the tool threw), `bad_output` (not an object), and the tool name `unknown_tool` for an invalid name.
- The prompt (`agent/prompt.mjs`) has rules for the kitchen tour (fridge, then cupboards, one shot at a time) and for texting a recipe only when the caller agrees.
- Seen on live calls on 14 November: the agent called `check_food` and `look_at_camera`, and a fridge frame (1280 by 720) was read as kind `fridge` with two foods. Pantry memory and `text_recipe` are tested with fakes only; the texting path was proven by a direct API send, not yet from a live call.

### What to do next

1. Run a scripted live test call: fridge, cupboard, "what can I cook", text me the recipe, and a Coke by name. The patient phone must have joined the project and texted the line within 24 hours first (see "Texting the patient" in the root README). Spend minutes only on scripted calls.
2. Fix what the calls reveal.
3. Decide whether a store-shelf look should name brands. Today shelf looks return plain food names without brands (open decision).
4. Everyone: the patient texts the line before the demo call.

### What you build

| File | Purpose |
|---|---|
| `agent/agent.mjs` | Entry point: joins the room, greets, runs the Gemini Live session, switches video between the face and the cart, logs each tool result. |
| `agent/chert-rooms.mjs`, `agent/greet.mjs` | Chert's starter code: run the agent the way `chert dev` needs it, and greet once when `bridge_ready` arrives. |
| `agent/face.mjs` | The picture shown when no cart is running. |
| `agent/camera.mjs` | Keeps the caller's latest video frame and turns it into a JPEG on request. |
| `agent/tools.mjs` | The tools the voice model can call. The only place `renal/` and `actions/` are imported. |
| `agent/prompt.mjs` | The dietitian's instructions and greetings. |
| `agent/memory.mjs` | Per-patient shopping list and pantry kept between calls (food names only, 2-hour expiry). |
| `agent/toollog.mjs` | Formats the per-tool log line. |
| `agent/turns.mjs` | Turn handling for noisy calls: barge-in switch, reply watchdog, time-warning delay. |
| `agent/video.mjs` | Picks which picture goes out on each frame tick (the cart frame when one is offered). |
| `agent/outbound.mjs` | Validates the job metadata for outbound calls. |
| `agent/fake-modules.mjs` | Test fixtures: fakes of `renal/` and `actions/`. |
| `agent/sim/` | A simulated Chert call (see "Testing without spending FaceTime minutes"). |

### Order of work

This is the original plan. Everything in it is built; see the Status section of the root README for what has been seen on a live call.

1. **Scaffold** from Chert's video starter (`npx @trychert/facetime@0.1.0-beta.20 new starter --video`, run outside the repo). Built.
2. **Ask Chert staff about caller capture.** The caller's camera now reaches the agent (14 November), so this is answered for our line.
3. **First call with the starter untouched.** Superseded: the agent runs on Gemini Live.
4. **Switch the voice to Gemini.** Built (see "Voice model").
5. **Camera in** (`camera.mjs`). Built; debug frames show what the caller shows.
6. **Tools** against `renal/` and `actions/`. Built.
7. **Video out switch** (face or cart). Built.
8. **Outbound entry path.** Built; not seen on a live call.
9. **In-aisle behaviour.** Built as prompt and tool behaviour; not tried in a store.

### Running it

```sh
npm install
npm start                                                                            # terminal 1, repo root
npx @trychert/facetime@0.1.0-beta.20 doctor                                          # terminal 2, repo root
npx @trychert/facetime@0.1.0-beta.20 dev --agent renal-dietitian --minutes 30        # terminal 2; wait for the waiting-room message
```

Both terminals stay running. Call the line with FaceTime Video. After any code change restart both. Stop `chert dev` with Ctrl+C only, never by killing the process, or the line stays held. To save the frames the agent looks at, set `AGENT_DEBUG_FRAME_DIR` to a folder outside the repo; the frames show what the caller shows, so keep them out of git.

### Rules Chert enforces

- Greet within 10 seconds of `bridge_ready` or the call ends. `greet.mjs` handles this: it fires when the room metadata contains `"chert_bridge_ready": true`. Never greet because someone joined.
- Exactly one unmuted audio track in the room. A second audio publisher ends the call.
- The caller only sees video published by the same participant that speaks. So the browser must be shown through your `VideoSource`; Track C cannot join the room and publish it.
- Join the room at once, but do not open the model session until `ctx.waitForParticipant()` resolves (inbound calls).

### Voice model

`agent/agent.mjs` uses `google.realtime.RealtimeModel` with the model from `GEMINI_LIVE_MODEL`, or `gemini-3.8-live` when it is empty, and the voice the caller chose in setup (`Puck` by default). The voice is read when a call starts and does not change mid-call: changing it mid-call would restart the Gemini session. The plugin reads `GOOGLE_API_KEY`.

The older notes below are still true as background. Plugin 1.8.0 predates `gemini-3.8-live`. For any model whose name contains `3.1` the plugin throws on `session.generateReply(...)`, so with such a model the greeting would need to come from the instructions instead. I have not checked from the repo which model ran on the live calls; do not assume one.

### Camera in

`agent/camera.mjs` exports `watchCaller(room, options)`. It keeps the latest frame from the caller's video track (the participant `chert-bridge-<call id>`, or any non-agent participant when `PLAYGROUND=1`) and returns a JPEG on request. A muted camera or a stale frame returns `null`, never an old picture. `agent/agent.mjs` connects with `ctx.connect()` so video is subscribed and keeps `videoEnabled: false` in `inputOptions` (the voice model cannot use frames). Chert's docs warn that the captured picture may include FaceTime's own controls or self-preview, so look at a saved debug frame before trusting a change.

### Tools

The object key in `agent/tools.mjs` is the tool name. Everything a tool returns is read by the voice model, so results are small and every failure carries a fixed spoken `say` from `tools.mjs`, never a module's own error text. Every tool is guarded: a tool that takes more than 12 s returns `timeout`, and one that throws returns `tool_failed`.

| Tool | What it does | Failure codes |
|---|---|---|
| `look_at_camera` (optional `place`: `home` or `store`) | Reads the caller's camera, judges each food seen, remembers fridge and shelf foods | `no_camera_picture`, `vision_failed`, `unclear_picture`, `no_food_seen`, `label_unreadable` |
| `check_food` | Judges a food the caller names | `bad_food`, `bad_amount`, `profile_unavailable`, `limits_needed`, `check_failed` |
| `dish_ingredients` (`dish`) | The usual ingredients of a dish (at most 8), each with a quantity, a verdict and a swap from `checkFood`; the result carries a `say` built in code from names and verdict words only (no numbers) and an `ask`; shows a verdict card; result at most 900 characters and never drops an `avoid` row | `bad_food`, `profile_unavailable`, `limits_needed`, `check_failed`, `dish_unknown` (the dish is not known; asks for the main ingredients) |
| `suggest_meal` (optional `from_scratch`) | Suggests a meal from everything remembered from the kitchen; with `from_scratch` true, a meal built only from the built-in food list, with every ingredient on the shopping list and per-serving sodium, potassium and phosphorus totals | `nothing_seen`, `profile_unavailable`, `limits_needed`, `not_enough_food` (too little to cook a real meal; asks to see the cupboards), `no_safe_meal` (from scratch: no meal could be fully checked within the limits), `check_failed` |
| `log_meal` | Logs what was eaten | `nothing_to_log`, `tool_failed` |
| `todays_totals` | Today's totals and what is left | `limits_needed`, `tool_failed` |
| `start_cart` | Adds exactly the caller's current list to the Kroger cart (pass an empty list), and returns the item names and "I'm adding these to your Kroger cart now." With an empty list it refuses until the caller has heard that list in this call, and never re-sends items already sent this call; first checks Kroger when it is configured and says plainly if nobody has signed in | `nothing_to_buy` (the list is empty), `confirm_list` (the list was not read back yet; carries `items`), `already_in_cart`, `cart_busy`, `kroger_not_connected` (the relay can text a link), `kroger_sign_in_needed` (no relay, so no link can be texted), `kroger_sign_in_pending` (a sign-in is waiting), `tool_failed`, `cart_unconfirmed` (timeout) |
| `cart_status` | Reports the cart | `cart_failed`, `kroger_not_connected` (the run failed because the Kroger sign-in is missing or expired), `tool_failed` |
| `kroger_status` | Whether the Kroger account is connected; the result carries a fixed `say` and never a link, state or account detail | `tool_failed` |
| `text_kroger_sign_in` | Texts a Kroger sign-in link to the patient phone (once per 60 s). The text reads "Sign in to Kroger so your renal dietitian can fill your cart: <link> Nothing is ever paid for you." The link is never returned or spoken | `no_phone`, `kroger_not_configured`, `kroger_link_already_sent`, `kroger_texting_refused` (HTTP 403: the phone has not texted the line within 24 hours), `kroger_text_unconfirmed` (outcome unknown or timeout), `kroger_text_failed`, `tool_failed` |
| `text_cart_link` | Texts the cart link to the patient phone | `no_phone`, `no_cart_link`, `nothing_added` (the cart finished but the store had none of the items), `link_already_sent`, `tool_failed` |
| `add_to_shopping_list` (`items`, optional `keep_after_warning`), `shopping_list`, `mark_item` | The shopping list kept between calls (names only; quantities live for the call). Each change returns the current `list` and shows the list card ("Your list, not in your Kroger cart yet") on the video. A food judged `avoid` is held off the list (`held`) until the caller keeps it after the warning | `bad_items`, `bad_item`, `memory_unavailable` |
| `remove_from_list` (`items`, `all`, `from_kroger_cart`) | Takes items off the list or clears it. For anything already sent to Kroger, or with `from_kroger_cart` true, it also returns the fixed sentence "Kroger doesn't let me take items out of your cart. I've taken it off your list so it won't be added again, and I can text you the cart link so you can remove it there." | `bad_items`, `not_on_list`, `memory_unavailable` |
| `set_quantity` (`name`, `quantity`) | Changes one item's quantity for this call | `bad_item`, `not_on_list` |
| `text_list` | Texts the list as "- name (quantity)" lines plus the care-team closing line, once per content | `no_phone`, `nothing_to_text`, `list_already_sent`, `list_text_unconfirmed`, `list_text_failed` |
| `pantry_list`, `remove_from_pantry`, `clear_pantry` | What the agent remembers from the kitchen | `bad_items`, `not_in_pantry`, `timeout` |
| `text_recipe` | Texts one suggested recipe | `no_phone`, `no_recipe`, `which_recipe`, `recipe_already_sent`, `text_failed`, `text_unconfirmed` |
| `start_setup` | Only when the caller explicitly asks to change their setup, limits, voice or preferences ("update my setup"), never for a food, dish, list or cart; the setup tools below refuse until it runs (or setup started on a first call) | |
| `save_profile_basics` (setup only) | Saves the preferred name and condition | `setup_not_started`, `bad_name`, `bad_condition`, `profile_unsaved` |
| `propose_limits` (setup only) | Step 1: checks the four numbers and returns the sentence to read back; saves nothing | `setup_not_started`, `limit_missing`, `bad_sodium`, `bad_potassium`, `bad_phosphorus`, `bad_fluid` |
| `confirm_limits` (setup only) | Step 2: saves the limits after the caller said yes | `setup_not_started`, `no_proposal`, `limits_changed`, `limits_not_confirmed`, `profile_unsaved` |
| `set_avoid_foods` (setup only) | Saves foods to avoid (at most 10) | `setup_not_started`, `bad_foods`, `profile_unsaved` |
| `set_preferences` | Saves voice, reply style and language; a new voice starts on the next call | `bad_preference`, `prefs_unsaved` |
| `finish_onboarding` (setup only) | Marks setup done, says whether limits were saved and, if a Kroger link was texted this call, whether Kroger is connected | `setup_not_started`, `profile_unsaved` |

**Dish to cart.** A named or shown dish goes through `dish_ingredients` (the model names ingredients and quantities, `checkFood` judges each one), the caller agrees, and `add_to_shopping_list` puts them on the list, holding any `avoid` ingredient until the caller keeps it. The list card shows on the video as not in the Kroger cart yet, and is shown again after every change. The caller can remove, add or re-quantify items, ask for the list by text, and only then say to put it in the Kroger cart; `start_cart` with an empty list sends exactly that list and refuses with `confirm_list` until the list has been read back in this call, so an old leftover list is never bought unheard. Quantities are not stored in memory (it keeps names only), so they last for the call. Kroger's public API can only add to a cart, not remove or read it, so removal happens on the list before sending, and a request to remove something already sent always gets the fixed honest sentence above; the agent never says it left the Kroger cart.

Any tool can also return `timeout` or `tool_failed` from the guard. Whether Gemini Live calls tools reliably through plugin 1.8.0 was untested on 13 November; on 14 November live calls the agent called `check_food` and `look_at_camera`.

### Onboarding (first-call setup)

- When it runs. An inbound call from a caller whose saved profile is missing or has `setupDone` false starts with the setup greeting. `AGENT_SKIP_ONBOARDING=1` stops that (it also spares the first 3 minutes of a scarce 5-minute call). Saying "update my setup" at any time calls `start_setup` and runs the same steps. A first call that drops before `finish_onboarding` gets setup again next time; whatever was confirmed is already saved. Outbound calls never start setup.
- The script (`SETUP_STEPS` in `agent/prompt.mjs`, always in the instructions, gated in words to "only while setup is running"): welcome, name, condition, limits (read back and confirmed), foods to avoid, voice (upbeat, firm, warm or mature), brief or detailed and English or Spanish, Kroger (`kroger_status`; if not connected and a link can be texted, say a text is coming and call `text_kroger_sign_in`, then keep going; the line offers "or ask me for a new Kroger link on any call"; a caller who says skip or later gets the `kroger_later` line and no text), what I can do, finish. `finish_onboarding` appends one fixed sentence when a link was texted this call: Kroger is connected, or "Kroger isn't connected yet; you can finish from the link I texted, or ask me for a new one on any call." A sign-in finished after the call is picked up silently by the first Kroger tool call on the next call if that call starts within 10 minutes of the link (after that, ask for a new link). The script is about 267 words (capped at 300 by a test); `node agent/sim/onboarding-run.mjs` estimates the whole setup at about 212 s (219 s if Kroger never connects), inside the 180 to 240 s target and the 240 s warning. The Kroger step needs `KROGER_RELAY_URL` and `KROGER_RELAY_SECRET`; with Kroger not configured the agent says nothing about it. The time warning first calls `finish_onboarding` so what was confirmed is saved.
- Two-step limits, enforced in code. `propose_limits` validates four whole numbers against `LIMIT_BOUNDS` and returns a read-back sentence; `confirm_limits` saves only when it carries exactly the same four numbers, at least `CONFIRM_MIN_MS` (2500 ms) after the proposal, and (when the call's transcription has produced any event) after the caller spoke again more than 1 s after the proposal. If transcription has produced nothing at all, only the time check applies, so a line without transcription is not a dead end. A changed number clears the proposal. The code cannot prove the word "yes"; the prompt requires it. Outside setup the setup tools refuse with `setup_not_started`, so no limit can be accepted or changed.
- No limits means no judging. A caller who does not have their limits finishes setup with `limits: null`; the food tools then answer `limits_needed` ("I don't have your care team's limits yet...") and never use the built-in demo profile. Without any saved profile the built-in demo profile is used, as before.
- Safety and privacy. Saved limits are labelled as told by the patient, not by a care team record. Name, condition, limits and foods are never logged (the log shows tool name, ok, an error code and `setup due=true|false`), never texted, and reach only the Gemini calls that already receive limits. `profiles.json` (renal) and `<patient>.prefs.json` (agent) are mode 600 in user-owned 700 folders outside the repo (`RENAL_STATE_DIR`, `AGENT_STATE_DIR`, or folders in the system temp directory).
- The voice is applied at the start of the next call (`realtimeOptions` in `agent/prefs.mjs`); language and reply length ride in the instructions. Language is by instruction only; Spanish is unproven live.
- Demo reset: `node --env-file-if-exists=.env.local agent/sim/reset-setup.mjs [patientId]` deletes the saved profile and preferences.
- Run-through with no keys: `node agent/sim/onboarding-run.mjs`.

### Video out

Sizes still come from `shared/video.mjs` (`WIDTH`, `HEIGHT`, `FPS`). Track C's cart frame still wins when it is exactly the right length (`agent/video.mjs`). Otherwise `agent/screen.mjs` shows a FaceTime-style RenaLine companion portrait with a voice wave and a concise floating information panel.

After a successful `check_food` or `look_at_camera` the panel shows YES, MAYBE, NO or CHECK, the food, and the nutrient numbers and portion from the tool result only. A look shows up to three rows, and "Found online" appears when the numbers came from a web search. The portrait mouth follows the speaking state; the voice wave remains synchronized with it. The card stays for 15 seconds (`AGENT_CARD_SECONDS`) or until the next verdict, then the brand screen returns. A failed or timed-out tool never shows a card.

Everything the agent draws (brand screen, verdict cards, voice wave, drawn face) is laid out at full size and then placed in the centred safe area from `shared/video.mjs` (80% of the width and height by default, set by `VIDEO_SAFE_SCALE`), because a caller reported on 14 Nov 2026 that the picture was cut off on all four edges. The background still fills the frame. The scale is applied when a screen is rendered, not per frame. It has not yet been seen on a live call.

The card data goes through the `onDisplay` callback of `buildTools` and is never sent to the model. Screens are SVG pages rendered by sharp in the background; the wave is painted on each frame tick. If a render fails the last screen stays. If the brand screen cannot be rendered, the drawn face in `agent/face.mjs` is shown.

Preview the screens with `node agent/sim/preview-card.mjs <folder outside the repo>`. Whether the text is readable on a phone is not checked on a live call.

### Outbound calls (twist 3)

Track C's `callPatient` creates a room and dispatches your agent into it with job metadata `{"outbound": true, "reason": "...", "bridgeIdentity": "chert-bridge-out-..."}`. `agent/outbound.mjs` validates it. When `outbound` is true the entry must behave differently from the inbound path:

- Do not wait for a participant. Chert requires the agent to be in the room, publishing its audio and video tracks, before it dials.
- Stay silent until the room metadata gets `chert_bridge_ready`. `greet.mjs` then fires as usual with a check-in greeting.

This path has not been seen on a live call, and whether the trial line may place outbound calls is unknown.

### In the aisle (twist 4)

- Calls end at 5 minutes on the trial. The shopping list and the pantry are kept per patient between calls, and the agent warns about the time limit after the greeting (default 240 seconds, `AGENT_CALL_WARN_SECONDS`).
- On a `shelf` picture the agent compares the products in view. Shelf looks now return plain food names without brands.
- Stores are loud. Keep replies short and say the verdict word first.

### Testing without spending FaceTime minutes

- `npm test` needs no keys and no network. The agent tests use `agent/fake-modules.mjs`.
- `agent/sim/` holds a simulated Chert call, a developer tool that is not part of `npm test`: `sim-call.mjs` creates a LiveKit room, joins as `chert-bridge-sim`, dispatches the agent, publishes a silent caller microphone (and optionally a picture or spoken text on macOS) and measures greeting timing, silence before the signal and video size. `fake-cart.mjs` is the magenta test cart used with `AGENT_FAKE_CART=1`. Read the header comments in `sim-call.mjs` for the flags. It needs LiveKit keys and an already running agent.
- Connect to the agent from LiveKit's Agents Playground with your microphone and webcam. The agent registers under a name, so look for an agent-name setting there. Set `PLAYGROUND=1` so the camera accepts any non-agent participant's video.
- Real FaceTime calls are for scripted checks only: greeting, camera frame, video out, hangup, then a second call to prove cleanup.

### Done means

- A FaceTime Video call is answered and greeted every time, twice in a row.
- "Can I eat this?" with a label in view returns B's verdict in under about eight seconds.
- With the camera off, the agent says it cannot see and does not guess.
- When a cart is running the caller sees the browser; when it stops they see the face again.
- The agent says once per call that it follows limits set by the care team.
