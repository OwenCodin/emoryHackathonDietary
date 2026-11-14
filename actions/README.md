# Track C: reaching out and shopping

You own `actions/`. Your job is everything the agent does beyond talking: filling a grocery cart in a browser that Gemini drives, turning that browser into video frames for the call, calling or texting the patient at mealtimes, and the demo video. The cart can be built and tested entirely on your laptop.

## Shared contract (identical in all three track READMEs)

If you change anything in this section, change it in `agent/README.md`, `renal/README.md` and `actions/README.md` in the same commit and tell the other two people.

### The product in one paragraph

A renal dietitian you can FaceTime. A kidney or dialysis patient calls the line, points the camera at a food label, plate, fridge or store shelf, and hears whether it fits their sodium, potassium, phosphorus and fluid limits. The agent can also call the patient at mealtimes and fill a grocery cart in a browser that is shown on the call. There is no app.

### Stack and layout

- Node 24 (22.23.2 or later also works), ES modules, files end in `.mjs`.
- One `package.json` and one `.env.local` at the repo root. Each track owns one folder and does not edit the others.
- Pinned, do not upgrade: `@livekit/agents` 1.8.0, `@livekit/agents-plugin-google` 1.8.0, `@livekit/rtc-node` 0.13.35. These are the versions Chert's starter ships with. The 1.10.0 packages need `rtc-node` 1.x, which Chert's starter code has not been run against.

```
package.json         one package for the whole repo
.env.example         names of every variable below, no values
.env.local           real values, never committed
shared/video.mjs     export const WIDTH = 1280, HEIGHT = 720, FPS = 15
agent/               Track A  the call: voice, camera in, video out, tools
renal/               Track B  the renal brain: profile, image reading, verdicts, meals
actions/             Track C  reaching out and shopping: cart, outbound call, texts, demo video
```

Root `package.json` scripts and dependencies:

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
  }
}
```

`.gitignore` must contain `node_modules/`, `.env`, `.env.*`, `!.env.example`, `*.log`, `.DS_Store` and `actions/.browser-profile/` (that folder holds a logged-in store session).

### Environment variables

| Variable | Used by | What it is |
|---|---|---|
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | A, C | One LiveKit Cloud project. All three values from the same project. |
| `AGENT_NAME` | A, C | The name the agent registers with, for example `renal-dietitian`. |
| `GOOGLE_API_KEY` | A, B, C | Gemini API key. The LiveKit plugin reads exactly this name; pass it explicitly to `new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY })`. |
| `USDA_API_KEY` | B | FoodData Central key (free, from api.data.gov). `DEMO_KEY` works but is heavily rate limited. |
| `CHERT_API_KEY`, `CHERT_PROJECT_ID`, `CHERT_LINE_ID` | C | Project API key (`ftk_...`, created on the Chert Developer page), project UUID and line UUID. |
| `PATIENT_PHONE` | C | The demo patient's phone in international form, for example `+15551234567`. Must be a phone verified for the Chert project. |

Keys go in `.env.local` only. Never paste them in chat, commit them, or print them.

### Rules for every function that crosses a track boundary

1. `async`, takes one plain object, returns one plain object. The one exception is `getCartFrame`, which is synchronous because it is called 15 times a second.
2. Never throws. On failure it returns `{ ok: false, error: 'short reason' }`. On success the object has `ok: true`.
3. Returns within its time budget, because a person is waiting on a live call: `checkFood` 3 s, `describeImage` 6 s, `suggestMeals` 6 s, `startCart` and `callPatient` return as soon as the work has started.
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
  source: 'label' | 'usda' | 'rule' | 'none' }

// CartItem: one thing to buy.
{ name: 'unsalted chicken broth', quantity: '1 carton' }
```

### The hand-offs

Track A imports everything below and exports nothing. B and C do not import each other.

`renal/index.mjs` (Track B)

| Function | Returns |
|---|---|
| `getProfile({ patientId })` | `{ ok, profile }` |
| `describeImage({ jpeg })` where `jpeg` is a `Buffer` | a `Seen` |
| `checkFood({ food, profile })` | a `Verdict` |
| `suggestMeals({ foods, profile, count })` where `foods` is `string[]` | `{ ok, meals: [{ title, uses: string[], missing: CartItem[], minutes, steps: string[], why }] }` |
| `logFood({ patientId, verdict })` | `{ ok }` |
| `getToday({ patientId })` | `{ ok, totals, remaining, items }` where `totals` and `remaining` have `sodiumMg`, `potassiumMg`, `phosphorusMg` |

`actions/index.mjs` (Track C)

| Function | Returns |
|---|---|
| `startCart({ items })` where `items` is `CartItem[]` | `{ ok }` at once; the cart fills in the background. One cart at a time: a second call returns `{ ok: false, error: 'busy' }`. |
| `getCartStatus()` | `{ ok, state: 'idle' \| 'running' \| 'waiting_for_patient' \| 'done' \| 'failed', step, added: [{ name, price }], missing: string[], total, cartUrl }` |
| `getCartFrame()` (synchronous) | A `Uint8Array` of exactly `WIDTH * HEIGHT * 4` RGBA bytes showing the browser, or `null` when no cart is running. |
| `stopCart()` | `{ ok }` |
| `callPatient({ phone, reason })` | `{ ok, callId }` once Chert has accepted the request |
| `sendText({ phone, text })` | `{ ok }` |

### What is verified and what is not

Checked on 13 November 2026 by reading the installed packages, Chert's docs and CLI, and a live request:

- Chert's starter is Node on `@livekit/agents` 1.8.0, and the caller sees whatever video the speaking participant publishes.
- In `@livekit/agents-plugin-google` (1.8.0 and 1.10.0) the Gemini voice model's `pushVideo` is empty. Live camera frames never reach the voice model in Node. That is why the camera is read as snapshots through `describeImage`.
- `@livekit/rtc-node` 0.13.35 exports `VideoStream`, `VideoFrame.convert`, `VideoSource`; `@livekit/agents` 1.8.0 exports `llm.tool` and `voice.Agent({ instructions, tools })`.
- `livekit-server-sdk` 2.19.3 sets the token's `nbf` to now, so a `ttl` of two hours or less meets Chert's bridge-token rule.
- The USDA search endpoint returns sodium (id 1093), potassium (1092) and phosphorus (1091) per 100 g.

Not verified, because it needs keys or a real call. Each is somebody's first task:

- Caller camera delivery ("caller capture") is a separate opt-in per Chert line. If it is off on our line, the agent cannot see anything. Track A asks Chert staff and tests this first.
- Which Gemini Live model the 1.8.0 plugin can drive, and whether the greeting works with it. Track A.
- Whether our trial line may place outbound calls. Track C asks Chert staff.
- The exact Gemini model IDs. Google's docs on 13 November list `gemini-3.8-live` for voice, `gemini-3.8-flash` as the stable fast model, and `gemini-4-hydrogen` in the computer-use examples. Confirm each in AI Studio before relying on it.

### Shared limits

- One Chert line, one call at a time, 5 minutes per call, 50 FaceTime minutes in total on the trial. About one minute is already used. Budget: 25 for Track A, 15 for integration, 9 for recording the demo. Say in the team chat before you place a call.
- The trial ends 24 or 48 hours after activation (Chert's CLI and setup doc disagree); activation was about 6:30pm on Friday 13 November. Check the billing page.
- Only one computer runs `chert dev` (Track A's). If no agent is connected for 3 hours the line is released and the number can change, so keep it running.
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

### What you build

| File | Purpose |
|---|---|
| `actions/index.mjs` | Re-exports the six functions in the contract. |
| `actions/cart.mjs` | `startCart`, `getCartStatus`, `stopCart`. The Gemini computer-use loop over a Playwright browser. |
| `actions/frames.mjs` | `getCartFrame`. Keeps the latest browser screenshot as RGBA at `WIDTH` by `HEIGHT`. |
| `actions/login.mjs` | Opens the browser profile so you can sign in to the store by hand, once. |
| `actions/outbound.mjs` | `callPatient`. |
| `actions/text.mjs` | `sendText`. |
| `actions/checkin.mjs` | Command-line trigger: `node --env-file=.env.local actions/checkin.mjs` calls the patient now. |
| `actions/.browser-profile/` | The logged-in browser session. Git-ignored. Never commit it. |
| `actions/demo/` | Storyboard, Higgsfield prompts and recorded footage for the demo video. |

### Order of work

1. **Ask Chert staff (first 30 minutes):** "Can our trial line place outbound FaceTime video calls to a verified phone, and can it do that while `chert dev` is holding the line for inbound calls?" The answer decides whether twist 3 is a call or a text.
2. **Pick the store (first hour).** Sign in by hand in a Playwright browser on two or three grocery sites and try adding one item with a script. Choose the one that does not throw a bot check. Record the choice in this README.
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

Run `npx playwright install chromium` once. `login.mjs` opens this same profile and waits while you sign in by hand. Do the login yourself; do not have the model type a password.

**Frames.** A timer takes `await page.screenshot({ type: 'png' })` about four times a second and converts it:

```js
import sharp from 'sharp';
latest = new Uint8Array(await sharp(png)
  .resize(WIDTH, HEIGHT, { fit: 'contain', background: '#ffffff' })
  .ensureAlpha().raw().toBuffer());
```

`getCartFrame()` returns `latest` while a cart is running and `null` otherwise. It must be exactly `WIDTH * HEIGHT * 4` bytes or Track A's video track will show garbage; assert the length. Track A repeats your latest frame at 15 frames a second, so four screenshots a second is enough.

**Why you cannot publish the video yourself.** Chert only shows the caller video that comes from the same participant that speaks. The browser has to travel through Track A's video track, which is why the hand-off is a frame, not a LiveKit track.

**The model loop.** Google's computer-use guide is at https://ai.google.dev/gemini-api/docs/computer-use. Read it before writing code; what follows is a summary of that page as of 13 November and has not been run.

- Use `@google/genai` and the Interactions API: `ai.interactions.create({ model, input, tools: [{ type: 'computer_use', environment: 'browser' }] })`. The guide's examples use `gemini-4-hydrogen`.
- The model replies with function calls such as `navigate { url }`, `click { x, y }`, `type { text, press_enter }`, `scroll { x, y, direction }`, `press_key { key }`, `wait { seconds }`, `go_back`, `take_screenshot`. Each also carries an `intent` string.
- Coordinates are 0 to 999 on both axes. Convert with `x / 1000 * WIDTH` and `y / 1000 * HEIGHT` before calling Playwright.
- After each action, send back a `function_result` with the same `call_id`, the current URL as text, and a PNG screenshot, passing `previous_interaction_id` from the last response.
- A function call may include `safety_decision` with `require_confirmation`. Do not auto-approve. Set `state: 'waiting_for_patient'` and stop; the agent asks the patient on the call.

The `intent` strings are useful: copy the latest one into `getCartStatus().step` so the agent can narrate what is happening ("searching for unsalted chicken broth").

**The task you give the model.** One item at a time works better than the whole list: search for the item, open the best match, add it to the cart, report the name and price. Tell it to prefer low-sodium and unsalted versions and to never open checkout.

**Stopping before payment, enforced in code, not only in the prompt.**

- Before executing any `navigate` or after any click, if the page URL contains `checkout` or `payment`, go back and set `state: 'waiting_for_patient'`.
- When every item is added or reported missing, set `state: 'done'` with `cartUrl` and `total`, and stop the loop.
- Cap the run at four minutes and 60 actions, then `state: 'failed'` with a `step` that says why.

**Fallback if every store blocks automation.** Instacart's Developer Platform turns a list of items into a shoppable page with one request (`POST /idp/v1/products/products_link` on `https://connect.dev.instacart.tools`, bearer key from their developer dashboard; see https://docs.instacart.com/developer_platform_api/api/products/create_shopping_list_page for the body). Open the returned link in the same Playwright browser so the caller still sees a cart on screen, and return it as `cartUrl`.

**Where it runs.** Track A imports `actions/index.mjs`, so the browser runs inside the agent's process for that call. Module-level state is fine. Close the browser context in `stopCart()` and when the cart finishes, or the next call cannot open the profile.

### `sendText`

From Chert's setup doc:

```
POST https://app.trychert.com/api/v1/shared-messages
Authorization: Bearer $CHERT_API_KEY
X-Chert-Project-Id: $CHERT_PROJECT_ID
Idempotency-Key: <unique, 8 to 200 characters>
Content-Type: application/json

{ "line_id": "$CHERT_LINE_ID", "recipient": "+15551234567", "text": "Your cart is ready: https://..." }
```

On the trial the agent can only reply: the phone must have texted the line within the last 24 hours, and there is a cap of 50 messages an hour. Before the demo, have the patient phone text the line. If a send comes back with state `unknown`, read the message list again; do not retry with a new idempotency key or it may send twice.

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
5. Create the call. Chert's FaceTime docs give the base `https://facetime.trychert.com/api`; its setup doc gives `https://app.trychert.com/api`. Try the first and keep whichever answers.
   ```
   POST https://facetime.trychert.com/api/v1/calls
   Authorization: Bearer $CHERT_API_KEY
   X-Chert-Project-Id: $CHERT_PROJECT_ID
   Idempotency-Key: <unique, 8 to 200 characters>
   Content-Type: application/json

   { "direction": "outbound", "mode": "customer_managed", "line_id": "$CHERT_LINE_ID",
     "destination": "+15551234567", "destination_type": "phone",
     "media": { "audio": true, "video": true },
     "livekit_url": "$LIVEKIT_URL", "participant_token": "<the token>",
     "remote_participant_identity": "<the agent's identity in the room>" }
   ```
   HTTP 201 means accepted, not answered. Save `data.id`. If the request times out, retry with the same idempotency key, never a new one, or the patient may be called twice.
6. Poll `GET /api/v1/calls/<id>/events` once a second. When a `bridge_ready` event appears, write the signal Track A's greeting waits for:
   ```js
   await rooms.updateRoomMetadata(room, JSON.stringify({ chert_call: id, chert_bridge_ready: true, at: new Date().toISOString() }));
   ```
   The exact shape of the events response is not documented in what was read; log the first response and match on what is really there.
7. If nobody answers in 45 seconds, or the call reaches a terminal state, `POST /api/v1/calls/<id>/end` with a new idempotency key and an empty JSON body, then `rooms.deleteRoom(room)`.

The API key needs the `facetime:write` and `facetime:read` scopes. The project owner creates it on Chert's Developer page and puts it in `.env.local`.

**If outbound calls are not available on our line**, twist 3 becomes a text: `sendText` with "It's dinner time. FaceTime me and show me your plate." The patient taps the number and the normal inbound call does the rest. Build this first; it takes ten minutes and is the safety net either way.

### Testing without FaceTime

- The cart and frames: run a small script that calls `startCart`, then writes `getCartFrame()` to a PNG every second with `sharp(frame, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } })`. If the PNGs look right, the call will too.
- `callPatient` steps 1 to 4 can be checked in the LiveKit dashboard: the room appears and the agent joins it.
- Steps 5 to 7 use FaceTime minutes. Do them with Track A present, inside the integration budget.

### Demo video

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
