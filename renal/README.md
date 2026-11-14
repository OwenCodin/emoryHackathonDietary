# Track B: the renal brain

You own `renal/`. Your job is everything the agent knows about kidney diets: the patient's limits, reading a photo of food or a label, deciding whether a food fits, and suggesting meals. None of it needs a phone call, so you can build and test all of it on your laptop with still photos.

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

## Track B in detail

### What you build

| File | Purpose |
|---|---|
| `renal/index.mjs` | Re-exports the six functions in the contract. Nothing else is imported from outside this folder. |
| `renal/profile.mjs` | `getProfile`. Reads `renal/data/patients.json`. |
| `renal/vision.mjs` | `describeImage`. One Gemini call that turns a JPEG into a `Seen`. |
| `renal/nutrients.mjs` | Looks a food up: seeded table first, then cache, then USDA. |
| `renal/check.mjs` | `checkFood`. Pure logic, no network once nutrients are known. |
| `renal/meals.mjs` | `suggestMeals`. |
| `renal/diary.mjs` | `logFood`, `getToday`. In memory, saved to `renal/data/diary.json`. |
| `renal/data/foods.json` | About 60 common foods with sodium, potassium and phosphorus per 100 g, so the demo works offline. |
| `renal/data/hard-rules.json` | Foods that are always `avoid` or always need a warning. |
| `renal/photos/` | Test photos: labels, plates, an open fridge, a store shelf. |
| `renal/*.test.mjs` | Tests, run with `npm test`. |

### Order of work

1. `getProfile` and the demo patient. Ten minutes.
2. `checkFood` for a food that has a label (pure arithmetic). Write the tests first.
3. `nutrients.mjs` with the seeded table, then USDA lookup with a cache.
4. `checkFood` for a named food with no label.
5. `describeImage`, tested on your own photos.
6. `suggestMeals`.
7. `logFood` and `getToday`.

Merge after steps 2, 4 and 5 so Track A can swap its stubs for the real thing early.

### The demo patient

```json
{ "demo": { "id": "demo", "name": "Sam",
  "limits": { "sodiumMg": 2000, "potassiumMg": 2000, "phosphorusMg": 1000, "fluidMl": 1000 },
  "avoid": ["star fruit", "salt substitute"], "setBy": "care team" } }
```

These numbers are placeholders in the range commonly given to dialysis patients. Real limits are set per patient by their nephrologist and dietitian and vary a lot. Before the pitch, check them against a published source such as the National Kidney Foundation's patient guidance, and say in the demo that the limits come from the care team.

### `checkFood`

Input is a `Food` and a `Profile`. Work out sodium, potassium and phosphorus for the portion, then compare each with the daily limit.

Where the numbers come from, in this order:

1. `food.label`, if present. Use the label's own per-serving numbers. `source: 'label'`.
2. `renal/data/foods.json`, matched on name. `source: 'usda'`.
3. USDA lookup, then cached. `source: 'usda'`.
4. Nothing found: `verdict: 'unknown'`, `source: 'none'`, and a `say` that admits it. Never guess numbers.

Portion: use `food.grams` when given. Otherwise use a typical serving from your table and say which in `portion`.

A starting rule for the verdict, per portion, taking the worst of the three nutrients:

| Share of the daily limit | Verdict |
|---|---|
| under 10% | `ok` |
| 10% to 25% | `limit` (suggest a smaller portion) |
| over 25% | `avoid` (offer a `swap`) |

This rule is a heuristic invented for the demo, not a clinical standard. Sanity-check it against a renal diet food list: bananas, potatoes, tomatoes, oranges, avocado and beans should come out as `limit` or `avoid` for potassium; cola, processed cheese and deli meat for phosphorus or sodium; apples, grapes, cabbage, white rice and unsalted chicken as `ok`. Adjust the thresholds until the list looks right.

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
    ?api_key=$USDA_API_KEY&query=banana%20raw&dataType=Foundation,SR%20Legacy&pageSize=1
```

Each result has `foodNutrients`, an array of `{ nutrientId, nutrientName, unitName, value }`. Values are per 100 g. The ids you need:

| Nutrient | `nutrientId` | Unit |
|---|---|---|
| Sodium | 1093 | mg |
| Potassium | 1092 | mg |
| Phosphorus | 1091 | mg |
| Water | 1051 | g |

For "Bananas, raw" it returned potassium 358, phosphorus 22, sodium 1.

- Get a free key from api.data.gov. `DEMO_KEY` is limited to a few dozen requests an hour.
- Restrict `dataType` to `Foundation,SR Legacy`. Branded results are noisy and often lack phosphorus.
- The first search hit is not always the food you meant ("chicken" can return a breaded product). Seed `foods.json` by hand for the foods in the demo and check each number.
- Cache every lookup in `renal/data/cache.json` and commit it. Give the request a 2.5 second timeout so `checkFood` stays inside its 3 second budget.

### `describeImage`

One call with `@google/genai`, image plus a fixed instruction, JSON out:

```js
import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

const response = await ai.models.generateContent({
  model: 'gemini-3.8-flash',
  contents: [{ role: 'user', parts: [
    { inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } },
    { text: INSTRUCTION },
  ] }],
  config: { responseMimeType: 'application/json', responseSchema: SEEN_SCHEMA },
});
const seen = JSON.parse(response.text);
```

- The model ID is from Google's model list on 13 November and has not been run. Your first task in this step is one call with one photo. If image input is refused, try `gemini-4-hydrogen`.
- `INSTRUCTION` should say: decide whether this is a nutrition label, a plate, a fridge, a store shelf, or unclear; for a label copy the serving size, sodium, potassium and phosphorus numbers exactly as printed and the full ingredient list, using null for anything not printed; for the others list each distinct food with an estimated weight in grams; never invent a number that is not visible.
- The frame comes from a FaceTime call, so it may be low resolution, tilted, and may include FaceTime's on-screen controls. Test with photos taken from a phone screen at arm's length, not only clean close-ups. If small label text is unreadable, return `kind: 'unclear'` so the agent asks the caller to move closer.
- Validate the JSON yourself after parsing. If a field has the wrong type, return `{ ok: false, error: 'bad model output' }`.
- Stay inside 6 seconds: set a timeout and return `ok: false` when it passes.

### `suggestMeals`

Given the foods seen in the fridge and the profile, return up to `count` meals (default 2). Each meal's `missing` list uses the `CartItem` shape, because Track A passes it straight to Track C's `startCart`.

Let Gemini propose the meals as JSON, then run every ingredient through your own `checkFood` and drop any meal that contains an `avoid`. The model proposes; your rules decide. Do not ship a meal your checker has not passed.

### Tests

`npm test` runs every `*.test.mjs` with Node's built-in runner. Cover at least:

- A label with 860 mg sodium per serving against a 2000 mg limit is `avoid`.
- A label with no phosphorus number but `sodium phosphate` in the ingredients is not `ok`.
- A banana with no label is `limit` or `avoid` and names potassium.
- An unknown food is `unknown` and does not contain invented numbers.
- Every function returns `{ ok: false, ... }` instead of throwing when the network is off.
- `describeImage` on each photo in `renal/photos/` returns the expected `kind`.

### Done means

- All six functions exist with the exact names and shapes in the contract.
- Tests pass with the network off, except the ones that call Gemini.
- Ten real photos give the right `kind`, and the label photos give the printed numbers.
- No verdict ever contains a number that did not come from a label, the seeded table or USDA.
