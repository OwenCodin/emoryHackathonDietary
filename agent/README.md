# Track A: the call

You own `agent/`. Your job is the FaceTime call itself: the agent answers, greets in time, talks, grabs frames from the caller's camera, shows either a face or the shopping browser, and calls Track B and Track C through tools. You also own the root scaffold, the Chert line and `chert dev`.

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

## Track A in detail

### What you build

| File | Purpose |
|---|---|
| `agent/agent.mjs` | Entry point. Starts from Chert's video starter. |
| `agent/greet.mjs`, `agent/chert-rooms.mjs` | Copied unchanged from Chert's video starter. |
| `agent/face.mjs` | The picture shown when no cart is running. |
| `agent/camera.mjs` | Keeps the caller's latest video frame and turns it into a JPEG on request. |
| `agent/tools.mjs` | The tools the voice model can call. The only place B and C are imported. |
| `agent/prompt.mjs` | The dietitian's instructions and greetings. |

### Order of work

1. **Scaffold (by Friday 10pm).** Outside the repo, run `npx @trychert/facetime@0.1.0-beta.20 new starter --video` and copy `agent.mjs`, `greet.mjs`, `chert-rooms.mjs` and `face.mjs` into `agent/`. Read the starter's `AGENTS.md` once; it lists Chert's rules and error codes. At the repo root create `package.json` from the shared contract, `.env.example` and `.gitignore`, plus `shared/video.mjs` and stub `renal/index.mjs` and `actions/index.mjs` that return canned objects of the shapes in the contract. Push to `main`.
2. **Ask Chert staff two questions before writing more code.** "Is caller capture enabled on our line?" and "Which line do we use if not?" Without caller capture the agent is blind and the plan changes.
3. **First call with the starter untouched** (it uses OpenAI Realtime and needs `OPENAI_API_KEY`), if anyone on the team has an OpenAI key. This proves the line, LiveKit and `chert dev` before you change anything. If nobody has a key, skip to step 4.
4. **Switch the voice to Gemini** (see "Voice model" below). Call again. The greeting must be heard.
5. **Camera in** (`camera.mjs`). Prove a frame arrives by saving one JPEG to disk during a call and opening it.
6. **Tools** against the stubs, then against B's real functions as they merge.
7. **Video out switch**: face when idle, `getCartFrame()` when it returns frames.
8. **Outbound entry path** for twist 3, with Track C.
9. **In-aisle behaviour** for twist 4 (prompt and tool behaviour; see below).

### Running it

```sh
npm install
npm start                                  # terminal 1, repo root
npx @trychert/facetime@0.1.0-beta.20 doctor   # terminal 2, repo root
npx @trychert/facetime@0.1.0-beta.20 dev      # terminal 2; wait for the waiting-room message
```

Call the line with FaceTime Video. After any code change restart both terminals; a waiting room can hold old code. Stop `chert dev` with Ctrl+C only, never by killing the process, or the line stays held.

### Rules Chert enforces

- Greet within 10 seconds of `bridge_ready` or the call ends. `greet.mjs` handles this: it fires when the room metadata contains `"chert_bridge_ready": true`. Never greet because someone joined.
- Exactly one unmuted audio track in the room. A second audio publisher ends the call.
- The caller only sees video published by the same participant that speaks. So the browser must be shown through your `VideoSource`; Track C cannot join the room and publish it.
- Join the room at once, but do not open the model session until `ctx.waitForParticipant()` resolves (inbound calls).

### Voice model

Replace the OpenAI import and model in the starter:

```js
import * as google from '@livekit/agents-plugin-google';

const session = new voice.AgentSession({
  llm: new google.realtime.RealtimeModel({ model: 'gemini-3.8-live', voice: 'Puck' }),
});
```

The plugin reads `GOOGLE_API_KEY`. Voice names it accepts include `Puck`, `Kore`, `Aoede`, `Charon`.

This is the least certain part of the whole project, so test it in this order and stop at the first that works:

1. `gemini-3.8-live`. Google's docs call it the default voice model, but plugin 1.8.0 predates it.
2. `gemini-3.1-flash-live-preview`. Known to the plugin, but for any model whose name contains `3.1` the plugin throws on `session.generateReply(...)`. The greeting in `agent.mjs` uses exactly that call, so with this model the greeting must be replaced: put "Start the call by greeting the caller" in the instructions and check that the model speaks within 10 seconds of `bridge_ready`. If it stays silent the call is dropped.
3. Keep the starter's OpenAI Realtime voice. Chert has tested it. Gemini still does the vision and the shopping, which is what the Gemini track is judged on.

Do not spend more than two hours on this choice.

### Camera in

The starter ignores the caller's camera (`AutoSubscribe.AUDIO_ONLY`). Change `ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY)` to `ctx.connect()` so video is subscribed, keep `videoEnabled: false` in `inputOptions` (the voice model cannot use frames), and register the watcher before `ctx.connect()`:

```js
// agent/camera.mjs
import { RoomEvent, TrackKind, VideoBufferType, VideoStream } from '@livekit/rtc-node';
import sharp from 'sharp';

export function watchCaller(room) {
  let latest = null;            // { frame, at }
  let generation = 0;

  const start = track => {
    const mine = ++generation;
    const reader = new VideoStream(track).getReader();
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done || mine !== generation) break;
          latest = { frame: value.frame, at: Date.now() };
        }
      } catch { /* track ended */ }
      if (mine === generation) latest = null;
    })();
  };

  room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    if (track.kind === TrackKind.KIND_VIDEO && participant.identity.startsWith('chert-bridge-')) start(track);
  });
  room.on(RoomEvent.TrackUnsubscribed, track => {
    if (track.kind === TrackKind.KIND_VIDEO) { generation++; latest = null; }
  });

  return {
    // A JPEG of what the caller is showing now, or null if there is no fresh frame.
    async jpeg(maxAgeMs = 1500) {
      if (!latest || Date.now() - latest.at > maxAgeMs) return null;
      const rgba = latest.frame.convert(VideoBufferType.RGBA);
      return sharp(Buffer.from(rgba.data), { raw: { width: rgba.width, height: rgba.height, channels: 4 } })
        .jpeg({ quality: 85 }).toBuffer();
    },
  };
}
```

This is written against the installed type definitions and has not been run on a call. Chert's docs name the caller's tracks `facetime-remote-audio` and `facetime-remote-video`, published by the participant `chert-bridge-<call id>`. They also warn that the captured picture may include FaceTime's own controls or self-preview, not a clean camera feed, so look at a saved frame before trusting it. A muted camera must return `null`, never an old frame.

### Tools

```js
// agent/tools.mjs
import { llm } from '@livekit/agents';
import { z } from 'zod';
import { checkFood, describeImage, getProfile, getToday, logFood, suggestMeals } from '../renal/index.mjs';
import { getCartStatus, sendText, startCart } from '../actions/index.mjs';

export function buildTools({ camera, patientId }) {
  let lastFoods = [];      // names from the last look, for suggest_meal
  let lastVerdicts = [];   // for log_meal
  return {
    look_at_camera: llm.tool({
      description: 'Look at what the caller is showing right now (a label, plate, fridge or shelf) and judge it against their limits. Use whenever they ask about something in view.',
      execute: async () => {
        const jpeg = await camera.jpeg();
        if (!jpeg) return { ok: false, error: 'no camera picture; ask the caller to turn the camera on and hold still' };
        const seen = await describeImage({ jpeg });
        if (!seen.ok || seen.kind === 'unclear') return { ok: false, error: 'could not make it out; ask them to hold it closer' };
        const { profile } = await getProfile({ patientId });
        const foods = seen.label ? [{ name: seen.label.product, label: seen.label }] : seen.foods.slice(0, 6);
        lastFoods = foods.map(food => food.name);
        lastVerdicts = await Promise.all(foods.map(food => checkFood({ food, profile })));
        return { ok: true, kind: seen.kind, results: lastVerdicts.map(({ food, verdict, say, swap }) => ({ food, verdict, say, swap })) };
      },
    }),
    check_food: llm.tool({
      description: 'Judge a food the caller names without showing it.',
      parameters: z.object({ name: z.string(), grams: z.number().nullable() }),
      execute: async ({ name, grams }) => {
        const { profile } = await getProfile({ patientId });
        return checkFood({ food: { name, grams }, profile });
      },
    }),
    // suggest_meal, log_meal, todays_totals, start_cart, cart_status and text_cart_link follow the same pattern.
  };
}
```

Pass them with `new voice.Agent({ instructions, tools: buildTools({ camera, patientId: 'demo' }) })`. The object key is the tool name. Return small objects: everything a tool returns is read by the voice model, and a long result slows the reply.

Whether Gemini Live calls tools reliably through plugin 1.8.0 is untested. Check it with `check_food` (no camera needed) straight after the first Gemini call works.

### Video out

Use `WIDTH`, `HEIGHT`, `FPS` from `shared/video.mjs` for the `VideoSource`, not the starter's 640 by 360. In the frame timer:

```js
const cart = getCartFrame();                       // Uint8Array or null, from Track C
const pixels = cart ?? drawFace(tick++, speaking);
source.captureFrame(new VideoFrame(pixels, WIDTH, HEIGHT, VideoBufferType.RGBA));
```

`drawFace` loops over every pixel in JavaScript. At 1280 by 720 that is about 14 million pixel writes a second; if the agent's voice stutters, draw the face once into a few cached frames and reuse them, or lower `WIDTH` and `HEIGHT` in the one shared file and tell Track C. A phone held upright shows a wide picture small, so check on a real call that cart text is readable.

### Outbound calls (twist 3)

Track C's `callPatient` creates a room and dispatches your agent into it with job metadata `{"outbound": true, "reason": "...", "bridgeIdentity": "chert-bridge-out-..."}`. Read it with `JSON.parse(ctx.job.metadata || '{}')`. When `outbound` is true your entry must behave differently from the inbound path:

- Do not wait for a participant. Chert requires the agent to be in the room, publishing its audio and video tracks, before it dials. Start the session at once with `participantIdentity` set to `bridgeIdentity`.
- Stay silent until the room metadata gets `chert_bridge_ready` (Track C writes it when Chert reports the call was answered). `greet.mjs` then fires as usual. Use a check-in greeting: "It's dinner time. Show me your plate."

### In the aisle (twist 4)

- Calls end at 5 minutes on the trial. Keep the shopping list and what has been approved in memory keyed by patient, so a second call picks up where the first stopped, and have the agent say at about four minutes that it will need a call back.
- On a `shelf` picture, compare the products in view and name the best one by position or brand.
- Stores are loud. Keep replies to one sentence and repeat the verdict word first: "Yes", "No", or "Small portion".

### Testing without spending FaceTime minutes

- `renal` and `actions` stubs let every tool run with no network.
- Connect to the agent from LiveKit's Agents Playground with your microphone and webcam. The agent registers under a name, so it only joins if the playground dispatches that name; look for an agent-name setting there. In the playground the other participant is not named `chert-bridge-...` and no `bridge_ready` arrives, so behind an environment flag such as `PLAYGROUND=1` accept any non-agent participant's video and let the caller speak first. Remove nothing from the real path.
- Real FaceTime calls are for checkpoints only: greeting, camera frame, video out, hangup, then a second call to prove cleanup.

### Done means

- A FaceTime Video call is answered and greeted every time, twice in a row.
- "Can I eat this?" with a label in view returns B's verdict in under about eight seconds.
- With the camera off, the agent says it cannot see and does not guess.
- When a cart is running the caller sees the browser; when it stops they see the face again.
- The agent says once per call that it follows limits set by the care team.
