---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: verifying
stopped_at: Roadmap created, ready to plan Phase 1
last_updated: "2026-11-14T03:56:59.822Z"
last_activity: 2026-11-14
progress:
  total_phases: 5
  completed_phases: 5
  total_plans: 9
  completed_plans: 9
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-11-13)

**Core value:** A kidney patient can FaceTime the agent, point the camera at food, and hear a correct, specific answer to "can I eat this?" based on their own limits.
**Current focus:** Phase 05 — in-the-aisle

## Current Position

Phase: 05 (in-the-aisle) — EXECUTING
Plan: 3 of 3
Status: Phase complete — ready for verification
Last activity: 2026-11-14 - Fast task: setup opens only after the caller confirms

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 1
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 1 | - | - |
| Phase 02 P01 | 20min | 3 tasks | 3 files |
| Phase 03 P01 | 45min | 3 tasks | 12 files |
| Phase 03 P02 | 30min | 2 tasks | 3 files |
| Phase 04 P01 | 25min | 3 tasks | 8 files |
| Phase 04 P02 | 20min | 3 tasks | 5 files |
| Phase 05 P01 | 25min | 3 tasks | 7 files |
| Phase 05 P02 | 40min | 3 tasks | 9 files |
| Phase 05 P03 | 20min | 2 tasks | 4 files |

## Accumulated Context

| Phase 01 P01 | 15min | 3 tasks | 13 files |

### Decisions

- Roadmap: five phases; AISL-04 (one-sentence verdicts starting Yes/No/Small portion) is delivered in Phase 3 with the verdict tools, not Phase 5
- Roadmap: video out and outbound (Phase 4) and in-aisle (Phase 5) are the first things to cut
- Voice model: try gemini-3.8-live, then gemini-3.1-flash-live-preview, then OpenAI Realtime; at most two hours on the choice
- [Phase ?]: [Phase 01] face.mjs offsets scaled by HEIGHT/360 for 1280x720
- [Phase 02]: Keep gemini-3.8-live default; agent logs only caller identity, model, tool name+ok
- [Phase 03]: 03-01: jpeg() drops frames that arrive while muted; tool failures use only our own error codes
- [Phase 03]: text_cart_link has no parameters; destination only PATIENT_PHONE validated as E.164
- [Phase 04]: Fake cart provider only when AGENT_FAKE_CART is exactly 1; cached face frames with painted moving bar
- [Phase 04]: 04-02: outbound only for outbound===true with chert-bridge-* identity; outbound audio via external ParticipantAudioOutput before session.start
- [Phase 05]: Barge-in off by default via NO_INTERRUPTION; reply watchdog guarantees an answer
- [Phase 05]: 05-02: shopping list state folder refused unless a real directory owned by the user, tightened to 700; resume greeting carries a count only
- [Phase 05]: 05-03: shelf best choice from pickBest; spoken built from fixed templates

### Pending Todos

None yet.

### Blockers/Concerns

- Caller capture may not be enabled on the line; ask Chert staff before writing more code after Phase 1
- Trial has about 49 FaceTime minutes left, 5 per call, shared by the team (Track A budget about 25)
- Trial may end 24 or 48 hours after activation (about 6:30pm Friday 13 November); check the billing page
- LiveKit and Gemini keys must be put in `.env.local` by the person, not an agent
- Outbound calls on the trial line are unconfirmed (Track C asks Chert)

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 261114-ecm | Merge all three tracks into integration branch merge/all-tracks (origin/main + origin/track-b/renal); 248 tests, 12 stub-era failures, not pushed | 2026-11-14 | 4791f8a | [261114-ecm-merge-all-tracks](./quick/261114-ecm-merge-all-tracks/) |
| 261114-ej7 | Fix renal food-check crash, cola brand resolution and USDA match guard, numberless-label fallback, Gemini fallback model, test isolation; repair 12 stub-era agent tests (270/270 pass) | 2026-11-14 | 618fd3e | [261114-ej7-fix-renal-and-tests](./quick/261114-ej7-fix-renal-and-tests/) |
| 261114-eyk | Fridge and pantry memory across shots and calls, suggest_meal from the whole pantry, pantry tools, text_recipe by iMessage, prompt rules (298/298 pass) | 2026-11-14 | a42f907 | [261114-eyk-pantry-and-texted-recipes](./quick/261114-eyk-pantry-and-texted-recipes/) |
| 261114-fc6 | Grounded Gemini web lookup after USDA, USDA failures fall through, generic food names, look_at_camera never a dead end, tool failure codes in the log (350/350 pass) | 2026-11-14 | 57c12e4 | [261114-fc6-grounded-lookup-and-tool-logging](./quick/261114-fc6-grounded-lookup-and-tool-logging/) |
| 261114-g29 | READMEs for the merged app: root README for RenaLine, shared contract rebuilt and identical in the three track READMEs, per-track merge changes and next steps (docs only) | 2026-11-14 | a24bfca | [261114-g29-readmes-for-merged-app](./quick/261114-g29-readmes-for-merged-app/) |
| 261114-gnr | Judge a nutrition label that shows no product name, label_unreadable code, kitchen basics kept off the shopping list, no doubled verdict word, whole sentences in camera results (368/368 pass) | 2026-11-14 | 7d38d55 | [261114-gnr-label-without-product-name](./quick/261114-gnr-label-without-product-name/) |
| 261114-h5e | Verdict card video in place of the starter face: RenaLine idle screen, verdict cards from structured tool results, voice wave, fallback to the drawn face (401/401 pass) | 2026-11-14 | 4ccd74e | [261114-h5e-verdict-card-video](./quick/261114-h5e-verdict-card-video/) |
| 261114-i1o | suggest_meal asks to see the cupboards (not_enough_food) when Track B's meal code finds too little to cook; merged origin/renal locally first (410/410 pass) | 2026-11-14 | 0deb27d | [261114-i1o-empty-kitchen-message](./quick/261114-i1o-empty-kitchen-message/) |
| 261114-jcl | Cart against the real Gemini Interactions API: v1beta client, actions and final text read from `steps`, 0-999 coordinates confirmed, extra action names, wait default (421/421 pass). Live: kroger.com returns an empty search page to the automated browser, so nothing was added there | 2026-11-14 | 6def87f | [261114-jcl-cart-works-against-the-real-gemini-inter](./quick/261114-jcl-cart-works-against-the-real-gemini-inter/) |
| 261114-k0g | Kroger public API cart path beside the browser cart: client (app token, product search at the store, stored sign-in, add to cart), one-time sign-in script, startCart uses the API when both KROGER keys are set (441/441 pass). Live: product search only; sign-in and add-to-cart not yet run | 2026-11-14 | f9a0ec8 | [261114-k0g-kroger-api-cart-path-beside-the-browser-](./quick/261114-k0g-kroger-api-cart-path-beside-the-browser-/) |
| fast | Docs: live Kroger API cart run recorded (three items added and confirmed in the cart on kroger.com); KROGER keys added to the shared env table in all three track READMEs and to the root README | 2026-11-14 | 1194f75 | - |
| fast | Agent prompt: always speak English unless the caller clearly asks for another language (the agent had switched to Spanish on a call; no language was set anywhere) | 2026-11-14 | 5c02273 | - |
| fast | text_cart_link waits up to 8 s for a running cart before giving up (a live call asked for the link 0.4 s after start_cart and got no_cart_link) (443/443 pass) | 2026-11-14 | b6d5de7 | - |
| 261114-kle | Product pictures on the call for the Kroger cart: a 1280x720 cart card (photos, names, prices, total, nothing-is-paid line) offered through getCartFrame after each add and held 20 s after the run; pictures only from www.kroger.com/product/images (464/464 pass). Rendered live from product search; not yet seen on a call | 2026-11-14 | 8dbeb03 | [261114-kle-product-pictures-on-the-call-for-the-kro](./quick/261114-kle-product-pictures-on-the-call-for-the-kro/) |
| 261114-kvi | Meal ideas from scratch within the renal limits: suggestMeals fromScratch (built-in foods only, every ingredient judged from real numbers, summed sodium, potassium and phosphorus each within one third of the daily limit, totals returned), suggest_meal from_scratch, no_safe_meal, shared contract row updated in all three READMEs (483/483 pass). Live: Gemini meals in about 3.2 s after putting the quick model first (763acc5) | 2026-11-14 | 050d5f8 | [261114-kvi-meal-ideas-from-scratch-within-the-renal](./quick/261114-kvi-meal-ideas-from-scratch-within-the-renal/) |
| fast | From-scratch meals: when no proposed dish passes, the built-in meals go through the same checks before no_safe_meal (a live call got no_safe_meal) (484/484 pass) | 2026-11-14 | 910b62e | - |
| 261114-lep | Safe area for the call video: all content (brand screen, verdict cards, voice wave, drawn face, Kroger cart card, browser cart frame) drawn inside the centre 80% of the frame, VIDEO_SAFE_SCALE to tune it (505/505 pass). Rendered pictures checked; not yet seen on a phone | 2026-11-14 | a566c56 | [261114-lep-safe-area-so-the-call-video-is-not-cut-o](./quick/261114-lep-safe-area-so-the-call-video-is-not-cut-o/) |
| 261114-leq | New-patient setup on the first call: saved profile store in renal (limits as read out by the caller, validated, never the built-in demo limits), seven setup tools with a two-step limit confirmation enforced in code, agent preferences (voice menu, reply style, language, name) applied at the start of the next call, reset and skip switches, shared contract updated in all three READMEs (557/557 pass). Simulated run about 164 s; not yet run on a call | 2026-11-14 | 1e0c8a3 | [261114-leq-new-patient-onboarding-call-with-agent-p](./quick/261114-leq-new-patient-onboarding-call-with-agent-p/) |
| fast | Kroger product matching accepts joined or split word pairs (SportWater); text_cart_link and cart_status say nothing_added when the cart finished empty instead of not ready (559/559 pass) | 2026-11-14 | dc352aa | - |
| 261114-m9n | Kroger sign-in by texted link: kroger-relay (short link, callback page, one-time claim; holds only the short-lived code), relay sign-in in actions (startKrogerSignIn, getKrogerStatus), agent tools kroger_status and text_kroger_sign_in, a Kroger step in setup, shared contract updated in all three READMEs (615/615 pass). Local end-to-end test passes; the deployed relay and a real sign-in are not yet verified | 2026-11-14 | 4bf20bb | [261114-m9n-kroger-sign-in-by-texted-link-during-onb](./quick/261114-m9n-kroger-sign-in-by-texted-link-during-onb/) |
| fast | Docs: kroger-relay deployed and checked live; first real Kroger sign-in through a link texted by Chert, saved on the Mac about 30 s later | 2026-11-14 | bcbb203 | - |
| 261114-onw | Finish the Kroger sign-in later: the pending sign-in is recorded in the token folder and picked up by any later process within the relay window (getKrogerStatus and the cart path), setup offers later, finish_onboarding says how to finish, relay page wording made honest (639/639 pass). Second-process pick-up passes locally; relay page needs a redeploy | 2026-11-14 | 71f7a81 | [261114-onw-finish-kroger-sign-in-later-during-or-af](./quick/261114-onw-finish-kroger-sign-in-later-during-or-af/) |
| fast | Agent waits for the caller to stop talking: end-of-speech sensitivity low and one second of silence (AGENT_END_SILENCE_MS, 300 to 3000) before a turn ends; the model accepted the setting in a test session (641/641 pass). Not yet heard on a call | 2026-11-14 | 11ff696 | - |
| 261114-oyc | Dish to ingredients to list to Kroger cart: renal dishIngredients (model gives names and quantities only, every ingredient re-checked by checkFood), actions previewCart (read-only list card, not in the Kroger cart yet), agent tools dish_ingredients, remove_from_list, set_quantity, text_list, start_cart refuses until the list was read back (confirm_list), honest sentence that Kroger items cannot be removed, prompt playbook and start_setup restriction, shared contract updated in all three READMEs (679/679 pass). Live read-only check for a ham sandwich passed; not yet run on a call | 2026-11-14 | d7d4018 | [261114-oyc-dish-to-ingredients-to-shopping-list-to-](./quick/261114-oyc-dish-to-ingredients-to-shopping-list-to-/) |
| 261114-pqe | Full recipe by iMessage for a shown or named dish: renal dishRecipe (ingredients re-checked by checkFood, avoid items swapped or left out and named, model writes only steps and minutes, salt steps rejected, built-in steps for four dishes), text_recipe sends the dish from the last dish_ingredients via dishRecipeText, per-serving numbers line in meal recipes, recipe_unavailable, prompt and shared contract in all three READMEs (704 tests: 701 pass without .env.local; the 3 failures are in agent/card.test.mjs and predate this task). Live: ham sandwich and spaghetti bolognese recipes built in under 2 s; not yet run on a call | 2026-11-14 | b5d3aa6 | [261114-pqe-recipe-flow-meal-preferences-another-ide](./quick/261114-pqe-recipe-flow-meal-preferences-another-ide/) |
| fast | Dish flow after a simulated voice call: dish_ingredients no longer reads the ingredients out (count and flagged items only; the texted recipe carries them), a dish the model does not recognize gives dish_unknown instead of a guessed recipe, the generic swap phrase is not returned as a swap; on branch recipe-fixes with origin/ui-work merged in (708 tests: 705 pass without .env.local; the 3 failures are in agent/card.test.mjs and predate this). Live: nonsense dishes refused, ham sandwich and banana smoothie recipes built; spoken dish name to texted recipe confirmed once on a simulated call before these fixes | 2026-11-14 | e5a693b | - |
| fast | Voice choice in setup: the agent plays a recorded sample of voice one (Puck) and voice two (Sulafat) with play_voice_samples, then asks which; one/two/first/second accepted, the four older words still work (714 tests: 711 pass without .env.local; the 3 failures are in agent/card.test.mjs). Simulated call: both samples then the question played in order; not yet heard on a FaceTime call | 2026-11-14 | 2e3c6d6 | - |
| fast | Call screen layout after merging origin/ui-work (cd7b09f, companion halo): card widened to most of the frame, At a glance no longer overlapped, long names wrap to two lines, tagline and values fitted to the card, even badge spacing, single food centred, no visible inner box, name under the mark (718/718 pass, including the three card tests that failed before). Rendered pictures checked; not yet seen on a phone | 2026-11-14 | 19837b6 | - |
| 261114-sks | Optional protein and carbs daily limits in grams: skippable setup step, judged only when the profile has the limit, verdict card grows to a second row of tiles (694 tests: 686 pass, 8 fail, the same 8 as before the change) | 2026-11-14 | e8a7c2d | [261114-sks-add-optional-protein-and-carbs-limits-on](./quick/261114-sks-add-optional-protein-and-carbs-limits-on/) |
| 261114-sr6 | Per-caller identity from the Chert call record behind AGENT_OPEN_ACCESS=1: own profile and memory per phone, texts to the caller's own number, text-first setup step with check_text_received; lookup and text check verified read-only against the live Chert API, not yet on a live call (727 tests: 719 pass, 8 fail, the same 8 as before) | 2026-11-14 | 413a227 | [261114-sr6-per-caller-identity-from-chert-so-any-jo](./quick/261114-sr6-per-caller-identity-from-chert-so-any-jo/) |
| 261114-tk4 | Per-caller Kroger sign-in and cart: each caller's sign-in is stored in its own folder, the cart uses the calling patient's sign-in and is hidden from other callers, the demo patient keeps the existing folder (782 tests, all pass without .env.local); not yet proven on a live call | 2026-11-14 | 4773c09 | [261114-tk4-per-caller-kroger-sign-in-and-cart-each-](./quick/261114-tk4-per-caller-kroger-sign-in-and-cart-each-/) |
| fast | Setup no longer starts on the model's own initiative: a refused setup tool no longer says "update my setup", and start_setup asks the caller first and opens setup only on a second call after they answer (seen live at 22:03: a normal call drifted into setup). 783 tests pass without .env.local | 2026-11-14 | 2bebbfd | |

## Session Continuity

Last session: 2026-11-14T03:56:57.280Z
Stopped at: Roadmap created, ready to plan Phase 1
Resume file: None
