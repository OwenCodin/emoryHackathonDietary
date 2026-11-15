# RenaLine

The repo is called `emoryHackathonDietary`; the product is RenaLine.

RenaLine is a renal dietitian you can FaceTime. A person with kidney disease or on dialysis calls the line, points the camera at a food label, a plate, their fridge or a store shelf, and hears whether the food fits their sodium, potassium, phosphorus and fluid limits. The agent can suggest a meal from what the caller showed it and text the recipe, fill a grocery cart in a browser that is shown on the call, and call the patient at mealtimes. There is no app to install. The limits are the ones a care team set; the agent says so and never changes them.

Three people own three folders: `agent/` (the call), `renal/` (the renal brain) and `actions/` (cart, outbound calls, texts). Use the branch `merge/all-tracks`, which holds all three.

## Status

Seen working on a live call (14 November):

- Two-way audio and video on live FaceTime calls, after Chert fixed a fault on their side.
- The agent sees the caller's camera. A fridge frame (1280 by 720) was read correctly as kind `fridge` with two foods.
- The agent called `check_food` and `look_at_camera` on live calls.

Run from the command line against the real services, not on a call:

- The grounded online lookup, the USDA lookup, the vision fallback and meal suggestion.
- One iMessage was sent successfully through Chert's shared-messages API.

Built and tested with fakes only, not yet proven on a live call: per-caller identity behind `AGENT_OPEN_ACCESS=1` (own profile, memory, diary, texting and a text-first setup step for any phone that has joined the project).
- Along the way the shared USDA key and Gemini limits were hit (see "Limits and deadlines").

Built and tested with fakes, not yet proven on a live call:

- Pantry memory and `text_recipe`.
- `text_cart_link` from a call. The texting path was proven only by a direct API send.
- The grocery cart on a call. From the command line the Kroger API cart added three items to a real Kroger cart, confirmed on kroger.com (14 November); it has not been seen on a live call. The browser cart is blocked by kroger.com, walmart.com and Instacart.
- The outbound mealtime call. It has not been seen working on a live call since the merge.
- The online lookup as part of a call. It ran from the command line with billing on, but no caller has heard an online answer yet.

- First-call setup (name, condition, limits read out and confirmed, foods to avoid, voice and reply preferences). Simulated only.

Parked: receiving photos by iMessage.

`npm test` passes 557 tests with no keys and no network.

## Setup from a fresh clone

You need Node 24 (22.23.2 or later also works).

```sh
git clone <the team repo address>
cd emoryHackathonDietary
git checkout merge/all-tracks
npm install
npx playwright install chromium     # only needed for the grocery cart
cp .env.example .env.local
```

Then fill `.env.local` by key name. Put no values in this README, in chat, or in git; `.env.local` is ignored by git.

| Key | Where it comes from | Required? |
|---|---|---|
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | A LiveKit Cloud project. Leave the `YOUR_` placeholders to use Chert rooms through `chert dev`. | Optional |
| `GOOGLE_API_KEY` | A Gemini key from Google AI Studio. Turn billing on for it if you want the online lookup to work. | Required |
| `USDA_API_KEY` | A personal key from api.data.gov. `DEMO_KEY` runs out quickly. | Optional, but use a personal key |
| `CHERT_API_KEY`, `CHERT_PROJECT_ID`, `CHERT_LINE_ID` | The Chert Developer page: the project key, the project and the line. | Required for texts and outbound calls |
| `PATIENT_PHONE` | The patient's phone in international form. | Required for texts and outbound calls |
| `GROCERY_STORE_URL`, `INSTACART_API_KEY` | Only for the browser cart (Track C). | Optional |
| `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET` | A Production app on developer.kroger.com with Cart, Locations, Products and Profile, and the redirect URI `http://localhost:8765/callback` (once the relay below is deployed, the redirect URI becomes `<relay>/api/kroger/callback`; see `kroger-relay/README.md`). When both are set the cart uses the Kroger API. Then sign in once: `node --env-file=.env.local actions/kroger-login.mjs`, or let the agent text the patient a link during setup. | Optional, needed for the Kroger cart |
| `KROGER_RELAY_URL`, `KROGER_RELAY_SECRET` | The production domain of the small Vercel relay in `kroger-relay/` (https, no trailing slash) and the shared secret it was given (32 characters or more). With both set the agent can text a Kroger sign-in link during setup. A person deploys the relay by following `kroger-relay/README.md`. | Optional, needed for sign-in by texted link |

The optional model, agent and state keys (`GEMINI_LIVE_MODEL`, `RENAL_*`, `AGENT_*`, `PLAYGROUND`) are listed with their defaults in the "Environment variables" table of the Shared contract in any track README, for example [renal/README.md](renal/README.md).

## Run a call

1. In a terminal at the repo root, check the setup: `npx @trychert/facetime@0.1.0-beta.20 doctor`.
2. In terminal 1: `npm start`.
3. In terminal 2: `npx @trychert/facetime@0.1.0-beta.20 dev --agent renal-dietitian --minutes 30`. Wait for the waiting-room message.
4. Both stay running. Call the line with FaceTime Video.

Rules:

- One `chert dev` session holds the team's single line at a time, so only one person can be on the line. Say so in the team chat first.
- Restart both terminals after a code change.
- Stop `chert dev` with Ctrl+C only. Killing the process leaves the line held.
- To save each camera frame the agent looks at, set `AGENT_DEBUG_FRAME_DIR` to a folder outside the repo. The frames show what the caller shows, so never commit them.

## Test without spending FaceTime minutes

`npm test` runs everything on fakes with no keys and no network.

First-call setup, with no keys and no call: `node agent/sim/onboarding-run.mjs` drives the setup tools in throwaway folders and prints the stored profile, the stored voice and an estimate of the spoken length. `node --env-file-if-exists=.env.local agent/sim/reset-setup.mjs` forgets the saved profile and preferences so setup runs again in a demo (set `AGENT_SKIP_ONBOARDING=1` to skip setup while testing other features).

To call `renal/` directly with real keys, run these from the repo root. They use a throwaway state folder so nothing in `renal/data` changes, and they spend USDA and Gemini quota.

A check of a named food (patient `demo`):

```sh
RENAL_STATE_DIR=$(mktemp -d) node --env-file=.env.local --input-type=module -e "const r=await import('./renal/index.mjs'); const p=await r.getProfile({patientId:'demo'}); console.log(JSON.stringify(await r.checkFood({food:{name:'oatly oat milk'},profile:p.profile}),null,1))"
```

The same check forced through the online lookup, by blanking the USDA key for that one command:

```sh
RENAL_STATE_DIR=$(mktemp -d) USDA_API_KEY= node --env-file=.env.local --input-type=module -e "const r=await import('./renal/index.mjs'); const p=await r.getProfile({patientId:'demo'}); console.log(JSON.stringify(await r.checkFood({food:{name:'Local Bounti Spring Mix'},profile:p.profile}),null,1))"
```

Expect either `source: 'web'` with numbers per found serving, or `verdict: 'unknown'`. The code never invents numbers.

For LiveKit Agents Playground tests, set `PLAYGROUND=1` so the camera accepts video from any non-agent participant (see `.env.example`).

## How a food is judged

1. Label numbers on camera.
2. The built-in list (`renal/data/foods.json`), by exact name or alias.
3. The built-in list by plain name (trailing words dropped, guarded).
4. USDA (guarded match).
5. Gemini with Google Search. Accepted only with real search evidence, a matching product and sane bounds. It is spoken with "That is from what I found online, not from your care team's list."
6. "I cannot judge it yet."

Hard rules (always avoid, always limit, phosphate additives) apply on top of every step and only ever make a verdict stricter.

## Texting the patient

On the Chert trial line the agent can only reply to the patient. Follow these rules:

- Before any demo, the patient's phone joins the project by texting the join phrase Chert shows for the project. The phrase is not written here.
- Then the patient texts the line a message with words in it, within 24 hours before the demo.
- Without both, a send is refused with HTTP 403 `shared_reply_window_closed` ("On a free trial the agent only replies: this phone has not texted in the last 24 hours").
- After both, a send returned `{"state":"sent"}`.
- `PATIENT_PHONE` must be set in `.env.local`, or `text_cart_link` and `text_recipe` fail with `no_phone`.
- Photo-only iMessages did not show up in the project's message list, so receiving photos is parked.
- With `AGENT_OPEN_ACCESS=1` the agent texts the verified caller of the current call only (the number comes from Chert's call record, never from what the caller says); `PATIENT_PHONE` and outbound calls are unchanged. Chert still requires that phone to have joined the project and texted the line in the last 24 hours. Setup asks for that text, and `check_text_received` checks it by the last four digits only, which is weak evidence; Chert's window is the real gate. A refusal is spoken as "send any message to this number, then ask me again".
- Something on Chert's side auto-replies "Hi there! How can I help you today?" to inbound texts on the project. How to turn it off is an open question for Chert staff.

## Limits and deadlines

- Chert trial: 50 FaceTime minutes in total, about 33 left at 16:20 UTC on 14 November, 5 minutes per call. The trial ends 15 November 2026 at 23:12 UTC. Spend minutes only on scripted test calls and the demo recording.
- USDA: the shared `DEMO_KEY` allows 10 requests an hour and ran out during testing. A personal key from api.data.gov allows 3600 an hour.
- Gemini: `gemini-3.8-flash` was overloaded all day on 14 November (503s, timeouts). Vision and meals fall back automatically to `gemini-3.5-flash-lite` after 2.5 s. For a demo, set `RENAL_VISION_MODEL=gemini-3.5-flash-lite` (and `RENAL_MEALS_MODEL`) to skip the wait.
- Google Search grounding, used by the online lookup, needs billing enabled on the Gemini key. Without it every grounded request returns 429 "exceeded your current quota" and the lookup falls through to "cannot judge".

## Known weaknesses

- Foods found in USDA with no serving size are judged per 100 g. That is harsh for cereal and condiments and lenient for drinks such as coconut water. This is the top open item for Track B.
- Diet colas reuse regular cola numbers. "Soda", "pop" and "soft drink" are judged as cola.
- The online lookup can return different results for the same product on different tries.
- The demo patient profile ("Sam", fixed limits) is hard-coded data.
- Open access (`AGENT_OPEN_ACCESS=1`): each caller signs in to their own Kroger account (the demo patient's sign-in stays at `<KROGER_TOKEN_DIR or ~/.config/renal-dietitian>/kroger-tokens.json`; every other caller's is kept in `callers/<id>/` under that folder, folder mode 700 and file mode 600, where the id is the same pseudonymous hash as the profile); a guest may sign in for the call but the guest folder is never reused, a known leftover to delete by hand; `actions/kroger-login.mjs` signs in the demo patient only; the mealtime outbound call still uses `PATIENT_PHONE`; one Chert line answers one call at a time; a caller whose FaceTime handle is an email (or whose lookup fails) gets a one-call guest identity with no texting, and their setup is not kept for next time (each guest call writes a small profile/memory file under a new random id); the per-caller id is an unsalted hash of the phone, so the local state folder is pseudonymous, not anonymous; the call-start lookup can add up to 1.5 s before the session starts.
- Optional protein and carbohydrate limits (grams) can be set in first-call setup and are judged by the food check and shown on the verdict card. The protein and carbs values for the 65 seed foods were entered from USDA reference values and need a spot-check. Meal and dish totals and online lookups do not use them yet.
- The Kroger sign-in relay (`kroger-relay/`) and the texted sign-in link have not been deployed or run live; only unit tests and a local end-to-end test with a fake Kroger token endpoint have run.
- The grocery cart (Track C) has not been seen working on a live call. The Kroger API cart works from the command line; it needs `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET` and a one-time sign-in. Its quantity is a count of packages, so "3 apples" can become three multi-packs.
- The outbound mealtime call has not been seen working on a live call since the merge.
- Pantry memory and `text_recipe` are tested with fakes. The texting path was proven only by a direct API send, not yet from a live call.
- Store-shelf looks now return plain food names without brands (open decision).

## Who does what next

Track A (the call, `agent/`):

- Run a scripted live test call: fridge, cupboard, "what can I cook", text me the recipe, a Coke by name.
- Fix what the calls reveal.
- Decide whether shelf looks should name brands.

Track B (the renal brain, `renal/`):

- Review the `renal/` commits made during the merge. List them with `git log --oneline origin/track-b/renal..HEAD -- renal`.
- Fix serving sizes first (the per-100 g problem).
- Add every demo food to `renal/data/foods.json`.
- Give the patient realistic limits.

Track C (cart, calls, texts, `actions/`):

- Run the cart end to end.
- Ask Chert staff: turn off the auto-reply, outbound calls on the trial, photos on the trial.
- The demo video and the write-up.

Everyone: the patient texts the line before the demo call.

## Troubleshooting

| Symptom | What it means | What to do |
|---|---|---|
| No sound both ways on a call | A fault on Chert's side, not the agent (seen on 14 November, fixed by Chert). | Run `doctor`, then ask Chert staff. |
| Text not sent, HTTP 403 `shared_reply_window_closed`. The agent log shows `text_recipe` with `error=text_failed`. | The patient's phone has not joined the project, or has not texted the line in the last 24 hours. | Have the phone join and text the line (see "Texting the patient"). |
| `no_phone` | `PATIENT_PHONE` is empty. | Set it in `.env.local` and restart `npm start`. |
| USDA 429 | The shared `DEMO_KEY` is used up. | Use a personal key from api.data.gov in `USDA_API_KEY`. |
| Gemini 503 or slow answers | The primary model is overloaded. | The fallback starts after 2.5 s, or set `RENAL_VISION_MODEL` and `RENAL_MEALS_MODEL` to `gemini-3.5-flash-lite`. |
| Gemini 429 "exceeded your current quota" on the online lookup | Billing is not enabled on the Gemini key. | Enable billing. Until then the lookup says it cannot judge. |
| `[agent] tool <name> ok=false error=<code>` in the agent log | A tool failed. The code is a short machine code. `none` means failed with no code, `tool_exception` means the tool threw, `bad_output` means the result was not an object, `other` means the code was not a plain short code. | Look the code up in the Tools table in [agent/README.md](agent/README.md). |
| `no_camera_picture` | The agent has no fresh camera picture. The agent says "I can't see your camera right now" and asks to turn the camera on and hold the food still. | Check the caller's camera is on. Use `AGENT_DEBUG_FRAME_DIR` to see what arrives. |
| `vision_failed` | The picture could not be read. The agent says it couldn't look at that just now and asks to hold it still and ask again. | Check the Gemini rows above. Try again. |
| `unclear_picture` | The picture was read as unclear. The agent asks the caller to hold it closer and keep it still. | Hold the food closer and still. |
| `no_food_seen` | The picture was read but no food was named. The agent asks to point the camera at the food. | Point the camera at the food. |
| `ok: true` with `unjudged: true` from `look_at_camera` | Foods were seen but none could be checked, because the lookups failed. | Check the USDA and Gemini rows above. |
| `timeout` | A tool took longer than the agent's 12 s limit. | Try again. If it repeats, check the USDA and Gemini rows. |
| The line stays held after a crash | `chert dev` was stopped without Ctrl+C. | Start `chert dev` again and stop it with Ctrl+C. If no agent is connected for 3 hours the line is released and the number can change. |

## Track guides

Each guide holds a section named "Shared contract". It is the same text in all three and must stay identical; change it in all three files in the same commit.

- [agent/README.md](agent/README.md): Track A, the call.
- [renal/README.md](renal/README.md): Track B, the renal brain.
- [actions/README.md](actions/README.md): Track C, cart, calls and texts.
