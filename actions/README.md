# Track C: reaching out and shopping

You own `actions/`. Your job is everything the agent does beyond talking: filling a grocery cart in a browser that Gemini drives, turning that browser into video frames for the call, calling or texting the patient at mealtimes, and the demo video. The cart can be built and tested entirely on your laptop.

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
| `KROGER_REDIRECT_URI` | C | Optional | Sign-in redirect; must match the redirect URI registered on the Kroger app. Empty means `http://localhost:8765/callback`. |
| `KROGER_TOKEN_DIR` | C | Optional | A folder outside this repo for the saved Kroger sign-in. Empty means `~/.config/renal-dietitian`. |

### Rules for every function that crosses a track boundary

1. `async`, takes one plain object, returns one plain object. The one exception is `getCartFrame`, which is synchronous because it is called 15 times a second.
2. Never throws. On failure it returns `{ ok: false, error: 'short reason' }`. On success the object has `ok: true`.
3. Returns within its time budget, because a person is waiting on a live call. `describeImage` about 5.4 s and `suggestMeals` about 5.1 s in total, including the fallback model. `checkFood` is quick from the built-in list but can take about 8 s in the worst case (USDA about 2.4 s, then the online lookup 5.5 s). The agent guards every tool at 12 s. `startCart` and `callPatient` return as soon as the work has started. A USDA failure no longer fails `checkFood`: it falls through to the online lookup and then to an honest `unknown`.
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

## Track C in detail

### What changed in your module during the merge

- Nothing in `actions/` changed. The merge took `actions/` unchanged from `origin/main`. Check with `git log --oneline origin/main..HEAD -- actions`, which prints nothing.
- The merge appended `GROCERY_STORE_URL` and `INSTACART_API_KEY` to `.env.example` and the `overrides` pin (`glob` ^14.0.2 under `@livekit/throws-transformer`) to `package.json`. Both must stay.
- `agent/contract.test.mjs` now holds an "actions contract" block that tests your functions through the real module.
- The agent now calls `sendText` from `text_recipe` as well as `text_cart_link`, so every text the patient gets goes through your function. `sendText` refuses any recipient other than `PATIENT_PHONE`.
- `agent/agent.mjs` exists and `npm start` runs the agent, so the cart and calls can be tried through the real agent.

### What to do next

1. Run the cart end to end through the agent: set `GROCERY_STORE_URL` (and `INSTACART_API_KEY` for the fallback) and sign in by hand with `node actions/login.mjs` (Kroger shows "access denied" to a sign-in from automation, so on kroger.com the cart runs as a guest; try another approved store if search results matter). The cart and the outbound mealtime call have not been seen working on a live call since the merge.
2. Ask Chert staff: how to turn off the auto-reply the project sends to inbound texts, whether the trial line can place outbound calls, and whether photos can be received on the trial.
3. The demo video and the write-up.
4. Everyone: the patient texts the line before the demo call.

### Local implementation status

The Track C modules are implemented. On 14 Nov 2026 the cart was run against the real Gemini Interactions API on https://www.kroger.com, headed, as a guest (Kroger refuses sign-in to automation), asking for unsalted butter, white rice and 3 apples. The model loop worked: about 30 actions were carried out and every `function_result` was accepted. No item was added (0 added, 0 missing, total $0.00): Kroger's search never produced results for the model, it kept retrying search and browsing categories, and the run stopped on the first item (unsalted butter) with state `failed` when a `go_back` timed out after about 200 seconds. It never reached checkout. Later the same day a Kroger public API cart path was added beside the browser one (see "Kroger API cart" below). The cart has still not been run on a live call. Set `GROCERY_STORE_URL` and test a retailer before claiming it works. `agent/agent.mjs` exists and the root `npm start` runs the agent.

Reported when Track C was written: the runtime dependency audit showed three high advisories in
`sharp@0.35.3`, which is pinned transitively by `@livekit/agents@1.8.0`.
Upgrading the LiveKit stack is outside this track and conflicts with the
compatibility pin above; the Track C screenshot converter uses the root
`sharp@0.35.5` dependency. Revisit the transitive advisory when the pinned
LiveKit stack can be upgraded safely. I have not re-run the audit.

### What you build

| File | Purpose |
|---|---|
| `actions/index.mjs` | Re-exports the six functions in the contract. |
| `actions/cart.mjs` | `startCart`, `getCartStatus`, `stopCart`. The Gemini computer-use loop over a Playwright browser. |
| `actions/kroger.mjs` | Kroger public API client: app-token product search, stored sign-in, add to cart, product choice. |
| `actions/cart-card.mjs` | Draws the Kroger cart card (product photos, names, prices, total) as a video frame. |
| `actions/kroger-login.mjs` | One-time Kroger sign-in, run by a person: `node --env-file=.env.local actions/kroger-login.mjs`. |
| `actions/frames.mjs` | `getCartFrame`. Keeps the latest browser screenshot as RGBA at `WIDTH` by `HEIGHT`. |
| `actions/login.mjs` | Opens the browser profile so you can sign in to the store by hand, once. |
| `actions/outbound.mjs` | `callPatient`. |
| `actions/text.mjs` | `sendText`. |
| `actions/checkin.mjs` | Command-line trigger: `node --env-file=.env.local actions/checkin.mjs` calls the patient now. |
| `actions/.browser-profile/` | The logged-in browser session. Git-ignored. Never commit it. |
| `actions/demo/` | Storyboard, Higgsfield prompts and recorded footage for the demo video. |

### Order of work

1. **Ask Chert staff (first 30 minutes):** "Can our trial line place outbound FaceTime video calls to a verified phone, and can it do that while `chert dev` is holding the line for inbound calls?" The answer decides whether twist 3 is a call or a text.
2. **Pick the store (first hour).** Sign in by hand in a Playwright browser on two or three grocery sites and try adding one item with a script. Choose the one that does not throw a bot check. Record the choice in this README. Store accessibility is not verified until this manual login test is completed.
3. `frames.mjs` and a fake cart that just browses a page, so Track A can test video out early. Merge.
4. The real cart loop on the chosen store.
5. `sendText`.
6. `callPatient`, with Track A.
7. Demo video shots that do not depend on the build (see the end of this file).

### The cart

**Browser.** Playwright with a persistent profile, so the store login survives restarts:

```js
import { chromium } from 'playwright';
import { WIDTH, HEIGHT } from '../shared/video.mjs';

const context = await chromium.launchPersistentContext('actions/.browser-profile', {
  headless: false,
  viewport: { width: WIDTH, height: HEIGHT },
});
const page = context.pages()[0] ?? await context.newPage();
```

Run `npx playwright install chromium` once. Set `GROCERY_STORE_URL` to an HTTPS URL on a supported retailer domain, then run `node actions/login.mjs`. It opens this same profile and waits while you sign in by hand. Do the login yourself; do not have the model type a password. Credentials and cookies remain in the ignored browser profile.

The computer-use loop restricts navigation to Walmart, Kroger, Instacart and Amazon domains and enables Gemini's prompt-injection check. It sends browser screenshots to Gemini to choose actions; screenshots and credentials are not written to logs.

**Frames.** A timer takes `await page.screenshot({ type: 'png' })` about four times a second and converts it:

```js
import sharp from 'sharp';
latest = new Uint8Array(await sharp(png)
  .resize(WIDTH, HEIGHT, { fit: 'contain', background: '#ffffff' })
  .ensureAlpha().raw().toBuffer());
```

`getCartFrame()` returns `latest` while a cart is running and `null` otherwise. It must be exactly `WIDTH * HEIGHT * 4` bytes or Track A's video track will show garbage; assert the length. Track A repeats your latest frame at 15 frames a second, so four screenshots a second is enough.

**Why you cannot publish the video yourself.** Chert only shows the caller video that comes from the same participant that speaks. The browser has to travel through Track A's video track, which is why the hand-off is a frame, not a LiveKit track.

**The model loop.** Google's computer-use guide is at https://ai.google.dev/gemini-api/docs/computer-use. The current implementation follows the Interactions API and enables its prompt-injection check. Seen live on 14 Nov 2026 on kroger.com: the loop runs and the API accepts the follow-up turns, but the model could not get Kroger search results, so no item was added yet (see Local implementation status).

- Use `@google/genai` and the Interactions API: `ai.interactions.create({ model, input, tools: [{ type: 'computer_use', environment: 'browser' }] })`. The guide's examples use `gemini-4-hydrogen`. Build the client with `new GoogleGenAI({ apiKey, apiVersion: 'v1beta' })`: on v1 an image input is rejected (`'image' is not supported ... in v1, it is available in v1beta`).
- The reply has no `outputs`. It has `status` (`requires_action` while it wants an action, `completed` when done) and `steps`: `thought` steps, `function_call` steps (`id`, `name`, `arguments`) and `model_output` steps whose `content` holds the final text. `intent` and `safety_decision` are inside `arguments`.
- The model replies with function calls such as `navigate { url }`, `click { x, y }`, `double_click`, `triple_click`, `move`, `type { text, press_enter }`, `scroll { x, y, direction, magnitude_in_pixels }`, `press_key { key }`, `hotkey { keys }`, `wait { seconds }`, `go_back`, `go_forward`, `take_screenshot`. Each also carries an `intent` string inside `arguments`. Actions the cart does not support get a `function_result` saying `unsupported action`.
- Coordinates are 0 to 999 on both axes (seen live: a click for the cart icon came back as x 967, y 61, which only lands on the cart link when scaled). Convert with `x / 1000 * WIDTH` and `y / 1000 * HEIGHT` before calling Playwright.
- After each action, send back a `function_result` with the same `call_id`, a text part `{"url":"<origin+path>"}`, and a PNG image part, passing `previous_interaction_id` from the last response. Do not send `tools` again on the follow-up (a follow-up that re-sent `tools` was rejected with a 400 safety error in a probe; the form without `tools` was accepted in the live run).
- A function call may include `arguments.safety_decision` with `require_confirmation`. Do not auto-approve. Set `state: 'waiting_for_patient'` and stop; the agent asks the patient on the call.

The `intent` strings are useful: copy the latest one into `getCartStatus().step` so the agent can narrate what is happening ("searching for unsalted chicken broth").

**The task you give the model.** One item at a time works better than the whole list: search for the item, open the best match, add it to the cart, report the name and price. Tell it to prefer low-sodium and unsalted versions and to never open checkout.

**Stopping before payment, enforced in code, not only in the prompt.**

- Before executing any `navigate` or after any click, if the page URL contains `checkout` or `payment`, go back and set `state: 'waiting_for_patient'`.
- When every item is added or reported missing, set `state: 'done'` with `cartUrl` and `total`, and stop the loop.
- Cap the run at four minutes and 60 actions, then `state: 'failed'` with a `step` that says why.

**Fallback when the selected store blocks automation.** Instacart's Developer Platform turns a list of items into a shoppable page with one request (`POST /idp/v1/products/products_link` on `https://connect.dev.instacart.tools`, bearer key from their developer dashboard; see https://docs.instacart.com/developer_platform_api/api/products/create_shopping_list_page for the body). Open the returned link in the same Playwright browser so the caller still sees a cart on screen, and return it as `cartUrl`.
The generated link is a shopping list: the patient must choose a store and review the items there. It does not purchase anything. The local implementation uses this fallback when it detects a bot challenge and `INSTACART_API_KEY` is configured.
No store login has been tested by this implementation yet; the user must sign in and validate the selected site before it can be called reliable.

**Where it runs.** Track A imports `actions/index.mjs`, so the browser runs inside the agent's process for that call. Module-level state is fine. Close the browser context in `stopCart()` and when the cart finishes, or the next call cannot open the profile.

### Kroger API cart

The browser cart cannot fill a real cart: kroger.com, walmart.com and Instacart all block the guest browser. So `startCart` has a second path that uses Kroger's public API and opens no browser.

**When it is used.** The API path runs when both `KROGER_CLIENT_ID` and `KROGER_CLIENT_SECRET` are set. With either unset the browser cart runs exactly as before. There is no other switch. Argument validation runs first on both paths.

**One-time sign-in.** A person runs `node --env-file=.env.local actions/kroger-login.mjs`. It opens Kroger's sign-in page in the normal browser, receives the redirect on `KROGER_REDIRECT_URI` (default `http://localhost:8765/callback`, which must be registered on the Kroger app), checks a random state value, exchanges the code and saves a refresh token. The token is stored in `KROGER_TOKEN_DIR` (default `~/.config/renal-dietitian`) as `kroger-tokens.json`, folder mode 700, file mode 600. The folder is refused if it is inside this repo. Without a stored sign-in a run ends `failed` with the step "Sign in to Kroger first: node --env-file=.env.local actions/kroger-login.mjs"; it does not fall back to the browser. If Kroger rejects the stored sign-in the step says it expired and to run the command again.

**How a run works.** For each item: search products at `KROGER_LOCATION_ID` (default 01100695, Kroger - Ponce), choose a product, add it with `PUT /v1/cart/add` (pickup). Product choice is deterministic: it needs a positive price (promo if there is one, else regular) and every content word of the item name in the description. A request for unsalted, low sodium, no salt added, reduced sodium or sodium free must match such a marker; otherwise a product with a marker is preferred; ties keep Kroger's order. Quantity is the leading integer of the quantity text ("3 apples" is 3, "a dozen" is 1) and is capped at 5. Status steps read "Searching Kroger for ...", "Adding ... to the Kroger cart", then "Kroger cart updated" (or "No items could be added to the Kroger cart" with no `cartUrl`). `getCartStatus` has the same shape as on the browser path, and `cartUrl` is `https://www.kroger.com/cart` when at least one item was added.

**The cart card.** After each item is added, the cart draws a card and offers it through `getCartFrame`: a photo on white, a short name, the line price ("x3" after it when the quantity is more than 1), the running total and the line "Nothing is paid. Review and check out yourself." It shows up to 6 tiles; with more than 6 items the first 5 are drawn and the sixth tile reads "+N more". When the run ends the final card stays for 20 seconds and then the agent's own picture returns. `stopCart` or a new `startCart` removes it at once. Nothing is shown when nothing was added. Pictures come only from `https://www.kroger.com/product/images/...` (https, exact host, redirects refused), with a 3 second timeout and a 2 MB cap each, and only if the response is an image. A missing or failed picture gives a "No picture" tile and never fails the run. The download starts before the add and runs alongside it. The drawing code is in `actions/cart-card.mjs`. The card and the browser cart frames are drawn inside the same safe area (`VIDEO_SAFE_SCALE`, default 0.8) so the zoomed FaceTime picture does not cut them off. The product names (26 px), step line and footer were made slightly larger so they stay readable after the inset. The click coordinates sent to Gemini are unaffected, because it sees the raw screenshot. The inset card has not yet been seen on a live call.

**Safety.** Adding to a cart is not a purchase. The code has no checkout, order or payment call; a test checks that every URL it fetches is the token, products or cart/add endpoint or a www.kroger.com product picture. The public API cannot view or remove cart items, so the patient reviews the cart on kroger.com.

**What was verified live (14 Nov 2026):** the app token, the locations lookup, and product search at 01100695, including a read-only check through this code: "unsalted butter" chose Kroger Unsalted Butter Sticks ($3.59), "white rice" chose Kroger Enriched Long Grain White Rice ($1.89), "apples" chose Kroger Honeycrisp Apples 4 Pack Tray ($5.00). Kroger's authorize URL with `http://localhost:8765/callback` returns the Kroger sign-in page.

**Also verified live (14 Nov 2026), from the command line, not on a call:** the one-time sign-in completed and was saved, and a three-item run through `startCart` finished in 5.5 s with state `done`: Kroger Unsalted Butter Sticks ($3.59), Kroger Enriched Long Grain White Rice ($1.89) and 3 x Kroger Honeycrisp Apples 4 Pack Tray ($15.00), total $20.48. A person then confirmed the items were in the cart on kroger.com. So `PUT /v1/cart/add` with scope `cart.basic:write` and body `{items:[{upc, quantity, modality}]}`, and the authorization-code grant, are confirmed by use. They still come from third-party libraries, because Kroger's official docs could not be read (JavaScript-rendered pages).

**Cart card check (14 Nov 2026), read-only:** a script outside the repo searched the same three items, downloaded the three front pictures from www.kroger.com (25 to 52 KB each, 130 to 290 ms) and rendered the card to a PNG outside the repo. The photos showed on white, names and prices fitted inside their tiles, and the total ($20.48) and footer were readable. No sign-in and no cart call was used.

**Not verified:** the cart on a live call (the agent's `start_cart` tool calls the same code), the cart card on a live call (not seen until a person calls), and the token refresh after the first access token expires.

**Known weakness:** quantity is a count of packages, and the first priced match wins, so "apples" with quantity 3 became three 4-pack trays.

**Browser cart, same day:** kroger.com returned an empty search page to the automated browser, walmart.com showed a "Robot or human?" press-and-hold page (the cart paused with "The patient must confirm the next browser action"; its challenge check does not recognise that wording), and the Instacart Kroger storefront asked a guest to sign in or give an address (the cart paused on its blocked-intent guard).

### `sendText`

From Chert's setup doc:

```
POST https://app.trychert.com/api/v1/shared-messages
Authorization: Bearer $CHERT_API_KEY
X-Chert-Project-Id: $CHERT_PROJECT_ID
Idempotency-Key: <unique, 8 to 200 characters>
Content-Type: application/json

{ "line_id": "$CHERT_LINE_ID", "recipient": "$PATIENT_PHONE", "text": "Your cart is ready: https://..." }
```

`sendText` only sends to `PATIENT_PHONE`; any other recipient returns `Recipient must be the configured verified patient number`.

Seen on the trial line on 14 November:

- The agent can only reply. A send is refused with HTTP 403 `shared_reply_window_closed` ("On a free trial the agent only replies: this phone has not texted in the last 24 hours") until two things are true. First, the patient's phone has joined the project by texting the project's join phrase to the line (Chert shows the phrase for the project; it is not written here). Second, the phone has texted the line a message with words in it within the last 24 hours. After that a send returned `{"state":"sent"}`.
- `GET /shared-messages` lists the project's messages with the fields `id`, `line_id`, `direction` (`inbound` or `outbound`), `state`, `masked_recipient`, `created_at` and `text`, so inbound texts can be read by polling.
- Photo-only iMessages did not appear in that list, and the trial project has no attachment field or per-message endpoint. Receiving photos is not available and is parked.
- Something on Chert's side auto-replies "Hi there! How can I help you today?" to inbound texts on the project. How to turn it off is an open question for Chert staff.
- `PATIENT_PHONE` must be set in `.env.local`, or the agent's `text_cart_link` and `text_recipe` fail with `no_phone`.

What the agent sees: a non-2xx reply makes `sendText` return `Chert rejected the message (HTTP 403)`, so `text_recipe` reports `text_failed`. An unknown outcome returns `Send outcome is unknown; inspect Chert before retrying`, which `text_recipe` reports as `text_unconfirmed`.

Earlier notes from Chert's setup doc: there is a cap of 50 messages an hour. If a send comes back with state `unknown`, read the message list again; do not retry with a new idempotency key or it may send twice.

The texting path was proven by a direct API send from the command line, not yet from a live call.

### `callPatient` (twist 3)

Chert dials out and joins a LiveKit room that you prepare. The agent must already be in that room, publishing audio and video, and silent.

1. Pick a room name (`outbound-<timestamp>`) and a bridge identity (`chert-bridge-out-<timestamp>`). The `chert-bridge-` prefix matters: Track A's camera code matches on it.
2. Create the room and dispatch the agent into it with `livekit-server-sdk`:
   ```js
   import { AccessToken, AgentDispatchClient, RoomServiceClient } from 'livekit-server-sdk';
   const host = process.env.LIVEKIT_URL.replace(/^wss:/, 'https:');
   const rooms = new RoomServiceClient(host, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
   const dispatch = new AgentDispatchClient(host, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
   await rooms.createRoom({ name: room, emptyTimeout: 300 });
   await dispatch.createDispatch(room, process.env.AGENT_NAME, {
     metadata: JSON.stringify({ outbound: true, reason, bridgeIdentity }),
   });
   ```
3. Wait until `rooms.listParticipants(room)` shows the agent with a published audio track (poll for up to 15 seconds; give up with `ok: false` after that).
4. Mint the bridge token. Chert requires `exp - nbf` of at most 7200 seconds and more than 90 seconds left; the SDK sets `nbf` to now, so a 30 minute `ttl` is right:
   ```js
   const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: bridgeIdentity, ttl: '30m' });
   token.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
   const participantToken = await token.toJwt();
   ```
5. Create the call at `https://app.trychert.com/api/v1/calls` (the host `actions/outbound.mjs` uses) with the project API key. The call request is retried at most once with the same idempotency key if its outcome is uncertain.
   ```
   POST https://app.trychert.com/api/v1/calls
   Authorization: Bearer $CHERT_API_KEY
   X-Chert-Project-Id: $CHERT_PROJECT_ID
   Idempotency-Key: <unique, 8 to 200 characters>
   Content-Type: application/json

   { "direction": "outbound", "mode": "customer_managed", "line_id": "$CHERT_LINE_ID",
     "destination": "$PATIENT_PHONE", "destination_type": "phone",
     "media": { "audio": true, "video": true },
     "livekit_url": "$LIVEKIT_URL", "participant_token": "<the token>",
     "remote_participant_identity": "<the agent's identity in the room>" }
   ```
   HTTP 201 means accepted, not answered. Save `data.id`. If the request times out, retry with the same idempotency key, never a new one, or the patient may be called twice.
6. Poll `GET https://app.trychert.com/api/v1/calls/<id>/events` once a second. When a `bridge_ready` event appears, write the signal Track A's greeting waits for:
   ```js
   await rooms.updateRoomMetadata(room, JSON.stringify({ chert_call: id, chert_bridge_ready: true, at: new Date().toISOString() }));
   ```
   The exact shape of the events response has not been verified. Confirm it
   during a user-approved manual call, without logging raw response data that
   might contain personal information.
7. If nobody answers in 45 seconds, the call reaches its terminal state, or the call runs for five minutes, `POST https://app.trychert.com/api/v1/calls/<id>/end` with a new idempotency key and an empty JSON body when needed, then `rooms.deleteRoom(room)`.

The API key needs the `facetime:write` and `facetime:read` scopes. The project owner creates it on Chert's Developer page and puts it in `.env.local`.

**If outbound calls are not available on our line**, twist 3 becomes a text: `sendText` with "It's dinner time. FaceTime me and show me your plate." The patient taps the number and the normal inbound call does the rest. Build this first; it takes ten minutes and is the safety net either way.

### Testing without FaceTime

- The cart and frames: run a small script that calls `startCart`, then writes `getCartFrame()` to a PNG every second with `sharp(frame, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } })`. If the PNGs look right, the call will too.
- `callPatient` steps 1 to 4 can be checked in the LiveKit dashboard: the room appears and the agent joins it.
- Steps 5 to 7 use FaceTime minutes. Do them with Track A present, inside the integration budget.

### Demo video

The written product overview and verification status are in
[the demo write-up](./demo/write-up.md).

The team wants an impressive demo using Higgsfield. The rule: generated footage tells the story, real recordings show the product. Never use a generated shot where the product is supposed to be working.

| Shot | Source |
|---|---|
| A dialysis patient alone at a kitchen table with a stack of diet handouts, slow push-in | Higgsfield |
| Title card: the name and "FaceTime your renal dietitian" | Simple edit |
| The real call: a label held up, the spoken verdict | Screen recording of the phone |
| The real cart filling on the call | Screen recording of the phone |
| The agent calling at dinner time, or the text arriving | Screen recording of the phone |
| In a store aisle, phone pointed at a shelf | Real footage, filmed in a store |
| The finished meal on the table, warm light | Higgsfield |
| Closing card: Chert, Gemini, team names | Simple edit |

Generate the Higgsfield shots on Saturday; they need nothing from the build. Record the phone screen directly (iPhone screen recording), not by filming the phone. Record a clean take the first time each feature works, as a backup for the live demo.

### Done means

- `startCart` with three items ends in `done` on the chosen store with the right items, without opening checkout, three runs in a row.
- `getCartFrame()` always returns the exact byte length or `null`.
- A `require_confirmation` from the model stops the run and shows up in `getCartStatus()`.
- The mealtime check-in reaches the patient's phone, by call or by text.
- The browser profile and all keys are absent from `git status`.
