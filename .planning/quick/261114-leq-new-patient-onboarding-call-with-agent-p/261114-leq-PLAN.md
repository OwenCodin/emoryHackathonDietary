---
phase: quick-261114-leq
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - renal/profile.mjs
  - renal/index.mjs
  - renal/diary.mjs
  - renal/profile.test.mjs
  - agent/prefs.mjs
  - agent/prefs.test.mjs
  - agent/memory.mjs
  - agent/memory.test.mjs
  - agent/tools.mjs
  - agent/tools.test.mjs
  - agent/onboarding.test.mjs
  - agent/fake-modules.mjs
  - agent/prompt.mjs
  - agent/prompt.test.mjs
  - agent/agent.mjs
  - agent/sim/onboarding-run.mjs
  - agent/sim/reset-setup.mjs
  - agent/README.md
  - renal/README.md
  - actions/README.md
  - README.md
  - .env.example
autonomous: true
requirements: [QUICK-261114-leq]

must_haves:
  truths:
    - "On a caller's first inbound call (no saved profile with setupDone true, AGENT_SKIP_ONBOARDING not 1) the agent greets with the setup greeting and walks the setup steps in order: name, condition, four limits (read back, confirmed), foods to avoid, voice, brief or detailed and language, what I can do, finish"
    - "Limits are saved only by confirm_limits, only when propose_limits ran earlier in this call with exactly the same four numbers, at least CONFIRM_MIN_MS after the proposal, and (when the call's transcription is working) after the caller spoke again; out-of-range, non-integer or missing numbers are refused with a fixed say sentence naming the nutrient"
    - "renal.getProfile returns the patient's saved profile (setBy 'patient, as told by their care team', setOn date) when setup saved all four limits, the built-in renal/data/patients.json profile when nothing is saved, and { ok: false, limitsNeeded: true } when a saved profile has no limits; food tools then answer limits_needed and never apply a default"
    - "The voice, reply style, language and preferred name chosen in setup are stored per patient in the agent state folder and applied from the start of every later call: the stored voice reaches the RealtimeModel options and the instructions carry the language and reply length"
    - "Outside setup the agent never accepts or changes a limit; saying 'update my setup' calls start_setup and runs the same two-step confirmation"
    - "No name, condition, limit or food from setup is logged, texted or written inside the repository; profiles.json and the preferences file are mode 600 in user-owned 700 folders outside the repo"
    - "The Shared contract section stays byte-identical in agent/README.md, renal/README.md and actions/README.md; npm test passes with no .env.local (484 before, plus the new tests, 0 failures)"
    - "The simulated run-through prints the stored profile and preferences from a throwaway folder and an estimated spoken length inside 3 to 5 minutes and under the 240 s warning"
  artifacts:
    - path: "renal/profile.mjs"
      provides: "Saved-profile store, strict validation, reset, getProfile override"
      exports: ["getProfile", "getSavedProfile", "saveProfile", "resetProfile", "LIMIT_BOUNDS", "CONDITIONS", "MAX_AVOID", "PATIENT_SET_BY"]
    - path: "renal/profile.test.mjs"
      provides: "No-network tests for the store, every bound, file modes, atomic write"
    - path: "agent/prefs.mjs"
      provides: "Voice menu allow-list, preference cleaning, RealtimeModel option builder"
      exports: ["VOICE_MENU", "DEFAULT_PREFS", "cleanPreferences", "realtimeOptions", "readPreferences"]
    - path: "agent/tools.mjs"
      provides: "start_setup, save_profile_basics, propose_limits, confirm_limits, set_avoid_foods, set_preferences, finish_onboarding, limits_needed handling, setupStatus"
      contains: "confirm_limits"
    - path: "agent/prompt.mjs"
      provides: "buildInstructions(prefs), SETUP_STEPS, setup greeting, reworded limit rule, time warning that saves setup"
      exports: ["buildInstructions", "instructions", "SETUP_STEPS", "setupGreeting", "chooseGreeting", "timeWarning"]
    - path: "agent/sim/onboarding-run.mjs"
      provides: "Simulated setup run in a throwaway folder plus spoken-length estimate"
  key_links:
    - from: "agent/agent.mjs"
      to: "agent/prefs.mjs realtimeOptions"
      via: "preferences read before new google.realtime.RealtimeModel(...)"
      pattern: "RealtimeModel\\(realtimeOptions"
    - from: "agent/tools.mjs confirm_limits"
      to: "renal/profile.mjs saveProfile"
      via: "pending proposal from propose_limits in the same call"
      pattern: "saveProfile"
    - from: "renal/diary.mjs getToday"
      to: "renal/profile.mjs getProfile"
      via: "limits from the saved or built-in profile, not patients.json directly"
      pattern: "getProfile"
    - from: "agent/agent.mjs greeting"
      to: "agent/prompt.mjs chooseGreeting"
      via: "setupDue from setupStatus"
      pattern: "setupDue"
---

<objective>
New-patient setup on the first FaceTime call. In about 3 minutes the agent learns who the caller is, their kidney condition, the four limits their care team gave them (read out by the caller, read back, confirmed), foods to avoid, and how they want the agent to sound. It saves all of this and uses it on this call and on every later call.

Purpose: today every caller is the hard-coded demo patient "Sam" with fixed illustrative limits and the fixed voice Puck. A real patient needs their own limits, and the product owner wants the first call to set them up.

Output:
- a saved-profile store in renal (Track B);
- agent preferences and seven setup tools (Track A);
- the setup script in the prompt, the greeting and the time warning;
- the voice and instructions wired in before the model session starts;
- the shared contract and READMEs updated;
- a simulated run-through with a spoken-length estimate.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@renal/profile.mjs
@renal/data.mjs
@renal/diary.mjs
@agent/memory.mjs
@agent/prompt.mjs
@agent/agent.mjs

## Executor environment (read first)

- You run in an isolated git worktree that has no `.env.local` and no `node_modules`. Create a symlink first: `ln -s /Users/ptrczx/Desktop/emoryHackathonDietary-merge/node_modules node_modules`. Never commit it. Stage files by name only and never run `git add -A` or `git add .`. Remove the symlink (`rm node_modules`) before you finish, so that `git status --porcelain` shows only the uncommitted SUMMARY.md.
- Never print key values. No step here needs a key or the network. Do not spend FaceTime minutes and make no live calls. Do not start, stop or signal any running `npm start`, `chert` or `facetime` process: a live Chert session is running from the main checkout.
- Under `actions/`, change only the Shared contract section of `actions/README.md`. Add no new dependency. Do not push.
- Another quick task (video safe area) will be merged first. It edits shared/video.mjs, agent/card.mjs, agent/screen.mjs, agent/face.mjs, actions/cart-card.mjs and README notes. Do not touch those files. Keep the edits to agent/agent.mjs and the READMEs to the lines named below.
- Baseline: `npm test` with no `.env.local` currently passes 484 tests.

## Decisions taken in this plan (Claude's discretion, stated with reasons)

- DEC-1. Where the profile is stored. profiles.json lives in `RENAL_STATE_DIR` when that is set. When it is empty, it lives in `join(os.tmpdir(), 'renal-state')`, NOT in renal/data. Reason: the profile is health information and must never land inside the repository, while today an empty `RENAL_STATE_DIR` means renal/data. The folder is refused when it is inside the repo (path or realpath), not a real directory, a symlink, or owned by another user. It is created with mode 700 (tightened if needed), and the file is written with mode 600. There is no new variable; only the RENAL_STATE_DIR row text changes.
- DEC-2. A caller who does not know their limits. Limits are all-or-nothing: all four confirmed, or none saved. A saved profile with `limits: null` makes `getProfile` return `{ ok: false, error: 'limits not set', limitsNeeded: true }`, and the agent's food tools answer `limits_needed` ("I don't have your care team's limits yet..."). There is NO fallback to the built-in illustrative Sam profile. Reason: the product owner said never guess and never apply a default. Sam's numbers belong to nobody, and check.mjs needs all four limits to judge a food. If no saved profile exists at all, the built-in profile is used exactly as today, so the demo and the tests keep working.
- DEC-3. A corrupt or unreadable profiles.json makes `getProfile` return `{ ok: false, error: 'profile store unreadable' }`, never the built-in profile. Reason: falling back would silently apply someone else's limits to a patient who did set up. Only a missing file (ENOENT) means "nothing saved".
- DEC-4. No mid-call voice change. The plugin's `RealtimeSession.updateOptions({ voice })` (node_modules/@livekit/agents-plugin-google/dist/realtime/realtime_api.js, about line 294) calls `markRestartNeeded()`. That tears down and reopens the Gemini session in the middle of the call, which is the fragile restart the brief forbids. `RealtimeModel.updateOptions` only changes options for new sessions. So the voice is applied when the next call starts, and set_preferences says "Your new voice starts on your next call." Mid-call voice samples are cut (first in the cut order).
- DEC-5. Language is set by instruction only. The `language` option is not passed to RealtimeModel, because support across Gemini Live models is unverified. Spanish ('es') swaps the "Always speak English" rule for "Always speak Spanish (chosen in setup) ... use another language only if the caller clearly asks". English is the default, and its instructions stay byte-identical to today's.
- DEC-6. The setup script is always present in the instructions, as a section headed "Setup", gated in words to "only while setup is running". Setup runs on a first call (the setup greeting starts it) or after start_setup. There is one source of truth, and "update my setup" works on any call without mid-session instruction updates. The tools enforce the gate: setup-only tools refuse with `setup_not_started` unless setup is active in this call.
- DEC-7. Setup is finished when `setupDone` is true. Each setup tool saves straight away, so a dropped call keeps what was confirmed. A first call that drops before finish_onboarding greets with setup again next time. The time warning tells the model to call finish_onboarding first, which saves `setupDone: true` with whatever was confirmed. The caller completes the rest later with "update my setup".
- DEC-8. `AGENT_SKIP_ONBOARDING=1` (optional, new) stops setup from starting on its own, so teammates can test other features without spending 3 of the scarce FaceTime minutes. "update my setup" still works. `agent/sim/reset-setup.mjs` deletes the saved profile and preferences so the setup can be shown again in a demo.
- DEC-9. Confirmation is checked in code, not only in the prompt. confirm_limits needs four things:
  - a proposal made by propose_limits in this call;
  - exactly the same four numbers (any change clears the proposal, and a new propose_limits is needed);
  - at least `CONFIRM_MIN_MS` (2500 ms) since the proposal (the read-back alone takes longer to say);
  - when the call's speech transcription has produced any event this call, a caller utterance heard more than 1000 ms after the proposal.
  When no transcription event has been seen at all this call, check (d) is skipped and only check (c) applies. This avoids a dead end if transcription is not delivered on the live line. The code cannot prove the word "yes"; the prompt requires it.

## Interfaces the executor needs (extracted from the codebase)

From renal/data.mjs: `readData(name)`, `writeData(name, value)` (no file mode; do NOT use it for profiles), `normalizeFoodName(value)`, `errorResult(error, fallback)`. `WRITABLE` = diary.json, cache.json, resolved under RENAL_STATE_DIR, otherwise renal/data.

From renal/profile.mjs (today): `getProfile({ patientId = 'demo' })` → `{ ok: true, profile: { ...patients[id], avoid: normalized, limits: copy } }` or `{ ok: false, error }`.

From renal/diary.mjs: `getToday` reads `patients.json` directly for limits (lines ~73-75). This must change to use getProfile.

From agent/memory.mjs: `createMemory({ patientId, dir, now, maxAgeMs })` returns `{ file, load, add, addPantry, removePantry, clearPantry, mark }`. Inside it: `checkFolder()` (outside the repo, 700, owner, not a symlink), atomic `writeFile(tmp, ..., { mode: 0o600, flag: 'wx' })` then `rename`, a `serial()` chain, `safePatientId`, `cleanName`, `defaultStateDir(env)` (AGENT_STATE_DIR or tmpdir/renal-agent-state). Shopping state expires after 2 h; preferences must NOT expire.

From agent/tools.mjs:
- `buildTools({ camera, patientId='demo', renal, actions, debugFrameDir, timeoutMs=12000, phone, onToolActivity, memory, onDisplay, cartWaitMs })` returns an object whose keys are tool names, each `llm.tool({ description, parameters: z.object(...), execute: guard(async (call, args) => ..., { timeoutMs, limit? }) })`.
- `fail(code, extra)` gives `{ ok: false, error: code, say: FAILS[code] }`. `guardTool` caps a result at 600 characters by default.
- `withTimeout(work, ms)` gives `{ ok }` (no value).
- The food tools call `renal.getProfile({ patientId })`: look_at_camera (~line 344: a profile problem leads to an unjudged result), check_food (~447), suggest_meal (~468). todays_totals calls `renal.getToday`.
- The `buildTools shape` test in agent/tools.test.mjs (~line 52) asserts the exact key list.

From agent/toollog.mjs: it logs the tool name, ok and an error code matching `/^[a-z_]{1,40}$/` only. New error codes must match that pattern.

From agent/agent.mjs:
- line 94: `new google.realtime.RealtimeModel({ model, voice: 'Puck', ...(realtimeInputConfig ? { realtimeInputConfig } : {}) })`
- line 104: UserInputTranscribed handler (length only)
- line 155: `const memory = createMemory({ patientId: 'demo' })`
- line 243: `chooseGreeting({ outbound: Boolean(call), remembered })`
- line 266: `new voice.Agent({ instructions, tools: buildTools({...}) })`

From the plugin api_proto.d.ts, the `Voice` union includes Puck, Kore, Sulafat, Gacrux (all four are used below).

From agent/prompt.mjs: `instructions` (string), `greeting`, `checkinGreeting`, `replyNudge`, `resumeGreeting(state)`, `chooseGreeting({ outbound, remembered })` → `{ kind: 'checkin'|'resume'|'inbound', instructions }`, `timeWarning`. The existing prompt tests check substrings such as 'one or two short sentences', 'care team', 'call back', 'shopping list', 'kitchen'.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Renal saved-profile store (save, read, reset, strict validation) and getToday on getProfile</name>
  <files>renal/profile.mjs, renal/index.mjs, renal/diary.mjs, renal/profile.test.mjs</files>
  <behavior>
    - Nothing saved: getProfile({ patientId: 'demo' }) returns exactly today's built-in Sam profile, and renal/data/patients.json is byte-identical before and after the whole test file (hash it)
    - saveProfile with valid name, condition 'hemodialysis', four in-range integer limits, avoid ['Grapefruit ', 'grapefruit', 'Star Fruit'] then getProfile returns those limits, avoid normalized and de-duplicated, setBy PATIENT_SET_BY, setOn equal to today's YYYY-MM-DD, source 'patient', and a limitsNote saying the patient told us these limits came from their care team
    - Every bound: for each of the four keys, min and max are accepted, min-1 and max+1 are refused with field set to that key, and 1500.5, '2000', NaN, Infinity, null-for-one-key and a missing key are refused; an unknown extra key in limits is refused
    - limits null is accepted (incomplete); getProfile then returns { ok: false, limitsNeeded: true } and never the built-in limits
    - name: control characters stripped, spaces collapsed, at most 40 characters, must contain a letter, null allowed (stored null, profile.name '' when read); condition outside CONDITIONS refused; avoid longer than MAX_AVOID (10), a non-array, or an entry over 40 characters after normalizing is refused
    - The file is mode 600, the folder 700, no leftover temporary file after a save, a second save replaces the first intact, and two concurrent saves for different patients both survive (writes are serialized)
    - resetProfile removes only that patient (removed true, then false the second time) and getProfile goes back to built-in
    - RENAL_STATE_DIR pointing inside the repo (renal/data) makes saveProfile return ok:false with no file written; a corrupt profiles.json makes getProfile return ok:false (not built-in) and getSavedProfile ok:false
    - getToday uses the saved limits for remaining, and returns { ok: false, limitsNeeded: true } when the saved profile has no limits
    - No console output at all from these functions (stub console.log and console.error in the test and assert they were never called)
  </behavior>
  <action>
In renal/profile.mjs (Track B), keep `getProfile`'s signature and add a store. Per DEC-1 and DEC-3, do not use data.mjs `writeData` for this file.

(a) Exported constants. Each is commented as a sanity bound, not medical advice.
- `LIMIT_BOUNDS = { sodiumMg: [500, 4000], potassiumMg: [1000, 4700], phosphorusMg: [500, 1500], fluidMl: [500, 4000] }`, frozen.
- `CONDITIONS = ['ckd', 'hemodialysis', 'peritoneal_dialysis', 'transplant', 'unsure']`.
- `MAX_AVOID = 10`.
- `PATIENT_SET_BY = 'patient, as told by their care team'`.

(b) A `profileDir()` helper, read at call time. It returns `resolve(RENAL_STATE_DIR)` when that is set and non-blank, otherwise `join(tmpdir(), 'renal-state')`. A `checkDir()` helper copies agent/memory.mjs `checkFolder`:
- refuse when the folder is inside the repo root (`fileURLToPath(new URL('..', import.meta.url))`), checked both before and after `realpath`;
- `mkdir` with recursive and mode 0o700;
- `lstat`: must be a directory and not a symlink;
- the owner uid must equal `process.getuid()` when that exists;
- chmod to 0o700 when the mode differs.
The file is `profiles.json`, with the shape `{ version: 1, patients: { [id]: saved } }`.

(c) Reading. ENOENT means `{ version: 1, patients: {} }`. A file that is not a regular file, is over 64 KB, or does not parse into that shape is an error ('profile store unreadable').

(d) Writing. Write a temporary file `.profiles.<pid>.<random hex>.tmp` in the same folder with `{ mode: 0o600, flag: 'wx' }`, then `rename` it over profiles.json; on failure, unlink the temporary file. All writes go through one module-level promise chain, the same pattern as diary.mjs `enqueueWrite`.

(e) patientId must match `/^[A-Za-z0-9_-]{1,64}$/` after trim, defaulting to 'demo' like getProfile.

(f) `validate(profile)` returns `{ ok: true, value }` or `{ ok: false, error, field }`. Errors are short fixed strings, never echoing input.
- name: null, or a string cleaned as described in the behavior list.
- condition: null or in CONDITIONS.
- limits: null, or an object with exactly the four keys, each `Number.isInteger` and within its bounds; field = the first bad key in the order sodiumMg, potassiumMg, phosphorusMg, fluidMl.
- avoid: an array of at most MAX_AVOID entries; each is `normalizeFoodName`d, empties dropped, de-duplicated, and every entry is 2 to 40 characters.
- setupDone: a boolean, defaulting to false.

(g) The exported functions:
- `saveProfile({ patientId, profile })` validates, then stores `{ id, name, condition, limits, avoid, setBy: PATIENT_SET_BY, setOn: today as YYYY-MM-DD (new Date().toISOString().slice(0,10)), setupDone }`, and returns `{ ok: true, saved }`. On failure it returns `{ ok: false, error, field? }` or `{ ok: false, error: 'profile store unavailable' }`. This is a full replace; the agent sends the whole draft each time.
- `getSavedProfile({ patientId })` returns `{ ok: true, saved: null | saved }`, or `{ ok: false, error }` when the store is unreadable or refused.
- `resetProfile({ patientId })` returns `{ ok: true, removed: boolean }`.
- `getProfile` reads the saved entry first, then:
  - a saved entry with limits returns `{ ok: true, profile: { id, name: name ?? '', condition, limits: { ...copy }, avoid, setBy, setOn, setupDone, source: 'patient', limitsNote: 'These limits are what the patient told us their care team gave them.' } }`;
  - a saved entry with `limits: null` returns `{ ok: false, error: 'limits not set', limitsNeeded: true }` (DEC-2);
  - a store error returns `{ ok: false, error: 'profile store unreadable' }` (DEC-3);
  - no saved entry: the existing built-in path, unchanged, adding `source: 'builtin'`. The built-in `setBy` stays 'care team', and agent/contract.test.mjs asserts that.
- check.mjs hard rules (hard-rules.json alwaysAvoid) still apply on top of any saved avoid list; do not change check.mjs.
- Nothing in this file logs.

(h) renal/index.mjs exports `getSavedProfile`, `saveProfile`, `resetProfile`, `LIMIT_BOUNDS`, `CONDITIONS` and `MAX_AVOID` beside `getProfile`.

(i) In renal/diary.mjs `getToday`, replace the direct `readData('patients.json')` limits read with `getProfile({ patientId })`. When that is not ok, return `{ ok: false, error: 'limits not set', limitsNeeded: true }` if it had `limitsNeeded`, else `{ ok: false, error: 'patient not found' }`. The remaining-numbers maths is unchanged. Import getProfile from './profile.mjs' (there is no cycle: profile.mjs does not import diary.mjs).

Write renal/profile.test.mjs first (RED). It sets `process.env.RENAL_STATE_DIR` to a fresh `mkdtemp` folder before importing, with an `after` cleanup like renal/contract.test.mjs, and covers every behavior above. Then implement (GREEN). Run the existing renal tests to confirm nothing else changed. Then confirm that every test file which imports renal/index.mjs or renal/profile.mjs sets RENAL_STATE_DIR to a temp folder: run `grep -L RENAL_STATE_DIR $(grep -l "renal/index.mjs\|profile.mjs" renal/*.test.mjs agent/*.test.mjs)` and inspect each hit. A test reading the real default folder could see a demo's saved profile. If a hit calls the real getProfile, add the same temp-folder setup to it.

Commit, staging by name: `feat(renal): per-patient saved profile with strict limits validation`, ending with the Co-Authored-By line.
  </action>
  <verify>
    <automated>node --test renal/profile.test.mjs renal/contract.test.mjs renal/check.test.mjs renal/meals.test.mjs agent/contract.test.mjs</automated>
  </verify>
  <done>All the behaviors above are tested and pass. The existing renal and contract tests pass unchanged. `git diff --stat renal/data/` is empty. getToday's limits come from getProfile.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Agent preferences, voice menu and the seven setup tools with two-step limit confirmation</name>
  <files>agent/prefs.mjs, agent/prefs.test.mjs, agent/memory.mjs, agent/memory.test.mjs, agent/tools.mjs, agent/fake-modules.mjs, agent/onboarding.test.mjs, agent/tools.test.mjs</files>
  <behavior>
    - realtimeOptions({ model: 'm', prefs: { voice: 'Kore' }, realtimeInputConfig: X }) gives { model: 'm', voice: 'Kore', realtimeInputConfig: X }; voice 'Evil', missing prefs or null gives voice 'Puck'; with no realtimeInputConfig the key is absent; no language key ever
    - memory.savePreferences({ voice: 'Sulafat', replyStyle: 'detailed', language: 'es', name: 'Ana' }) then loadPreferences returns them; a tampered file with voice 'Evil', replyStyle 'loud', language 'fr' or a 200-character name loads as the defaults for those fields; preferences do not expire after 2 h; the file is mode 600; resetPreferences deletes it; the shopping state file is untouched by preference writes
    - propose_limits with all four in range returns ok, pending true and a say that reads all four numbers back in the fixed sentence; confirm_limits with the same numbers 3 s later (fake clock) and callerHeardAfter returning true saves them through renal.saveProfile with the draft's name, condition and avoid kept
    - confirm_limits with no proposal gives no_proposal; with one number changed gives limits_changed and clears the proposal (a following confirm with the original numbers then gives no_proposal); under CONFIRM_MIN_MS gives limits_not_confirmed; callerHeardAfter false gives limits_not_confirmed; callerHeardAfter null (no transcription) and 3 s elapsed is accepted
    - propose_limits with potassium 9000 gives bad_potassium and its say "That potassium number doesn't sound right; can you read it again from your care team's sheet?"; with fluid null gives limit_missing; with sodium 1999.5 gives bad_sodium; a failed proposal clears any earlier pending one
    - Setup-only tools (save_profile_basics, propose_limits, confirm_limits, set_avoid_foods, finish_onboarding) return setup_not_started when setupDue is false and start_setup was not called; after start_setup they work, and the draft is loaded from renal.getSavedProfile so saved limits survive an update that skips limits
    - set_avoid_foods cleans names (links and control characters removed, 40 characters max), drops empties and duplicates, refuses more than 10 with bad_foods, and accepts an empty list
    - set_preferences accepts voice 'warm' (stored 'Sulafat'), reply_style 'detailed', language 'spanish' (stored 'es'); voice 'robot' gives bad_preference; when the voice changes the say mentions the next call
    - finish_onboarding saves setupDone true, clears any pending proposal, returns complete true or false with the matching fixed say, and turns setup off (a later propose_limits gives setup_not_started)
    - With renal.getProfile returning { ok: false, limitsNeeded: true }, check_food, suggest_meal and todays_totals return limits_needed with its say; look_at_camera returns its unjudged result with the limits_needed say added; with any other getProfile failure the old codes are unchanged
    - setupStatus: no saved profile gives needsSetup true; saved with setupDone false gives true; setupDone true gives false; a getSavedProfile failure, throw or a timeout over 1000 ms gives false
    - During a full setup sequence, captured console.log and console.error, plus toolLogLine of every result, contain no name, condition, limit number or avoid food
  </behavior>
  <action>
(a) Create agent/prefs.mjs (pure, no I/O except `readPreferences`).
- `VOICE_MENU` is a frozen map from the spoken word to the plugin voice name: `{ upbeat: 'Puck', firm: 'Kore', warm: 'Sulafat', mature: 'Gacrux' }`. All four names are in the plugin's `Voice` union in api_proto.d.ts.
- `DEFAULT_PREFS = { voice: 'Puck', replyStyle: 'brief', language: 'en', name: null }`.
- `cleanPreferences(raw)` keeps each field only when allowed, otherwise the default:
  - voice: one of the VOICE_MENU values;
  - replyStyle: 'brief' or 'detailed';
  - language: 'en' or 'es';
  - name: `cleanCallName` → a string matching `/^[A-Za-z][A-Za-z' -]{0,29}$/` with at most 3 words, else null.
  Export `cleanCallName` too; it is used in the prompt and must stay strict, because it ends up in instructions.
- `realtimeOptions({ model, prefs, realtimeInputConfig })` builds the RealtimeModel options as in the behavior list, with voice = `cleanPreferences(prefs).voice` (DEC-4, DEC-5).
- `readPreferences(memory, ms = 1000)` races `memory?.loadPreferences()` against a timer and returns cleaned prefs, or DEFAULT_PREFS on any failure, timeout or a missing memory. It never throws.

(b) In agent/memory.mjs, add to the object `createMemory` returns:
- `loadPreferences()` → `{ ok: true, prefs }` or `{ ok: false, error: 'unavailable' }`;
- `savePreferences(partial)`, which merges, cleans with `cleanPreferences` and writes, returning `{ ok, prefs }`;
- `resetPreferences()` → `{ ok, removed }`.
They use a sibling file `${id}.prefs.json` in the same folder. Reuse `checkFolder`, the `serial` chain and the same atomic write (mode 600, flag wx, rename); size cap 4096 bytes. There is no expiry. Only allow-listed values are written. Update the header comment: the folder now also holds the voice, reply length, language and preferred name. Import `cleanPreferences` from './prefs.mjs'. Nothing logs values. Add tests to agent/memory.test.mjs.

(c) In agent/tools.mjs:
- New buildTools options: `setupDue = false`, `callerHeardAfter = () => null` (returns true, false, or null when unknown) and `now = () => Date.now()`.
- Import `LIMIT_BOUNDS`, `CONDITIONS` and `MAX_AVOID` statically from '../renal/index.mjs'. The injected `renal` is still used for every call.
- Export `CONFIRM_MIN_MS = 2500`.
- In-call state: `setupActive = setupDue`, `draft = null`, `pending = null`.
- `loadDraft()`, on first need, gets `renal.getSavedProfile({ patientId })`. Use saved values when present, else `{ name: null, condition: null, limits: null, avoid: [], setupDone: false }`. If it fails, start from that empty draft but never overwrite saved limits with null: mark `draft.limitsUnknown = true` and refuse finish_onboarding / set_avoid_foods saves with profile_unsaved. This is the simplest safe choice.
- `saveDraft(next)` calls `renal.saveProfile({ patientId, profile: next })` and updates the draft only when it returns ok.
- Every new tool goes through the existing `guard` with `{ timeoutMs }`, and checks `call.timedOut` before changing state.

Add these FAILS entries (exact text):
- `setup_not_started`: "Say 'update my setup' and I'll take you through setup."
- `bad_name`: "I didn't catch the name. Tell me the first name you'd like me to use, or say skip."
- `limit_missing`: "I need all four numbers from your care team: sodium, potassium, phosphorus and fluid. Read me the ones on their sheet, or tell me you don't have them."
- `bad_sodium`, `bad_potassium`, `bad_phosphorus`, `bad_fluid`: "That <nutrient> number doesn't sound right; can you read it again from your care team's sheet?"
- `no_proposal`: "Read me your four limits first, and I'll repeat them back so you can check them."
- `limits_changed`: "Those aren't the numbers I read back. Let me read the new ones back to you first."
- `limits_not_confirmed`: "Please tell me if the numbers I read back are right."
- `bad_foods`: "Tell me up to ten foods to avoid, a few words each."
- `bad_preference`: "I can use an upbeat, firm, warm or mature voice, give brief or detailed answers, and speak English or Spanish. Which would you like?"
- `profile_unsaved`: "I couldn't save that just now. You can finish it later by saying 'update my setup'."
- `prefs_unsaved`: "I couldn't save that preference just now. We can try again on your next call."
- `bad_condition`: "Tell me which fits best: kidney disease without dialysis, hemodialysis, peritoneal dialysis, a kidney transplant, or not sure."
- `limits_needed`: "I don't have your care team's limits yet, so I can't judge foods against them. When you have them, say 'update my setup' and read them to me."

Then add these tools, in this key order after text_recipe, and update the `buildTools shape` key list in agent/tools.test.mjs to match:

- `start_setup` (no parameters). Sets setupActive true, clears pending, loads the draft, and returns `{ ok: true, say: "Let's update your setup. You can say skip at any step." }`.

- `save_profile_basics` with `{ name: z.string().max(80).nullish(), condition: z.string().max(40).nullish() }`. Requires setup. A non-null name must pass `cleanCallName`, else bad_name. Condition must be null or in CONDITIONS, else `bad_condition`. Save the draft with the name and condition, then `memory?.savePreferences({ name })`. A memory failure does not fail this tool. Returns `{ ok: true }`.

- `propose_limits` with `{ sodium_mg, potassium_mg, phosphorus_mg, fluid_ml }`, each `z.number().nullish()`. Ranges are checked in the handler, not in zod, so the refusal carries our say. Steps:
  1. Requires setup.
  2. Clear pending first.
  3. Any null or undefined value gives limit_missing.
  4. Then, in the order sodium, potassium, phosphorus, fluid, any value that is not `Number.isInteger` or is outside LIMIT_BOUNDS gives `bad_<nutrient>`.
  5. Otherwise set `pending = { limits: { sodiumMg, potassiumMg, phosphorusMg, fluidMl }, at: now() }` and return `{ ok: true, pending: true, say: 'I heard sodium S milligrams, potassium P milligrams, phosphorus F milligrams and fluid L milliliters a day. Is that right?' }`, built only from the validated integers.

- `confirm_limits` with the same four parameters. Steps:
  1. Requires setup.
  2. No pending gives no_proposal.
  3. Any value differing from pending: clear pending and return limits_changed.
  4. `now() - pending.at < CONFIRM_MIN_MS` gives limits_not_confirmed (pending kept).
  5. `const heard = callerHeardAfter(pending.at + 1000)`; if heard is false, return limits_not_confirmed (pending kept). If heard is null, accept (DEC-9).
  6. Save the draft with these limits; when that fails, return profile_unsaved (pending kept).
  7. On success, clear pending and return `{ ok: true, saved: true, say: "Saved. These are the limits you told me your care team gave you, and I'll use them from now on." }`.

- `set_avoid_foods` with `{ foods: z.array(z.string().max(80)).max(20) }`. Requires setup. Clean each entry with `clean(x, 40)`, drop empties and case-insensitive duplicates; more than MAX_AVOID left gives bad_foods. Save the draft with avoid; when renal refuses, return bad_foods. Returns `{ ok: true, count }`, never the names.

- `set_preferences` with `{ voice: z.string().max(20).nullish(), reply_style: z.string().max(20).nullish(), language: z.string().max(20).nullish() }`. This does NOT require setup, because changing a voice is harmless at any time.
  - Map voice through VOICE_MENU (lower-cased, trimmed). Also accept an exact voice name from the menu values.
  - reply_style must be 'brief' or 'detailed'.
  - language 'english'/'en' maps to 'en', 'spanish'/'es' to 'es'.
  - Any unknown, non-null value gives bad_preference. If all three are null, also bad_preference.
  - Missing memory or a failed save gives prefs_unsaved.
  - Returns `{ ok: true, say }`, where say is "Saved. Your new voice starts on your next call." when the voice changed, otherwise "Saved." (DEC-4).

- `finish_onboarding` (no parameters). Requires setup. Clear pending, save the draft with `setupDone: true`, and set setupActive false.
  - On complete: `{ ok: true, complete: true, say: "You're all set. I'll use the limits you told me your care team gave you." }`.
  - Without limits: `{ ok: true, complete: false, say: "Your setup is saved, but without your care team's limits I can't judge foods yet. When you have them, say 'update my setup'." }`.
  - When the save fails: profile_unsaved, with setup left active.

Export `setupStatus({ patientId = 'demo', renal = renalModule, timeoutMs = 1000 })`. It races `renal.getSavedProfile` against a timer and never throws. needsSetup is true only when the result is ok and (saved is null or `saved.setupDone !== true`); every failure gives false.

Wire limits_needed into the food tools: in check_food, suggest_meal and look_at_camera, read `got?.limitsNeeded === true`.
- check_food and suggest_meal return `fail('limits_needed')` instead of profile_unavailable.
- look_at_camera keeps its unjudged result (it still remembers what was seen) and adds `limitsNeeded: true` plus the limits_needed text joined to `say`.
- todays_totals returns `fail('limits_needed')` when `r?.limitsNeeded === true`.
No other behavior changes.

(d) agent/fake-modules.mjs makeFakeRenal gains an in-memory saved map with:
- `getSavedProfile`;
- `saveProfile`, which stores the profile as given plus setBy and setOn, and returns `{ ok: true, saved }`. It can be overridden in tests to fail;
- `resetProfile`.
Its `getProfile` stays as today unless a saved entry exists (then saved limits, or `{ ok: false, limitsNeeded: true }` when limits are null).

(e) Write agent/prefs.test.mjs and agent/onboarding.test.mjs first (RED). onboarding.test.mjs uses makeFakeRenal, a real createMemory in a `mkdtemp` folder, `globalThis.fetch` throwing, and a fake `now`. It covers every behavior above, including the log check: stub console.log and console.error, collect the output plus `toolLogLine(name, { output: JSON.stringify(result) })` for each step, and assert that the name, condition string, all four numbers and the avoid foods never appear. Then implement (GREEN). Edit agent/tools.test.mjs only to update the shape key list.

Commit, staging by name: `feat(agent): first-call setup tools, two-step limit confirmation and stored voice preferences`, ending with the Co-Authored-By line.
  </action>
  <verify>
    <automated>node --test agent/prefs.test.mjs agent/onboarding.test.mjs agent/memory.test.mjs agent/tools.test.mjs agent/toollog.test.mjs agent/contract.test.mjs</automated>
  </verify>
  <done>All the behaviors are tested and pass. Every pre-existing agent test still passes (only the shape key list changed). `grep -n "confirm_limits\|propose_limits\|CONFIRM_MIN_MS" agent/tools.mjs` shows the tools. No new log line prints preference or profile values.</done>
</task>

<task type="auto">
  <name>Task 3: Setup script in the prompt, greeting and time warning, agent.mjs wiring, shared contract and READMEs, simulated run-through</name>
  <files>agent/prompt.mjs, agent/prompt.test.mjs, agent/agent.mjs, agent/sim/onboarding-run.mjs, agent/sim/reset-setup.mjs, agent/README.md, renal/README.md, actions/README.md, README.md, .env.example</files>
  <action>
(a) agent/prompt.mjs.

1. Export `SETUP_STEPS`, a frozen array of `{ step, says }` holding the agent's near-verbatim lines, in this exact order:
   - welcome (said by the setup greeting): "Hi, I'm your AI renal dietitian. I follow the limits your care team gives you, and I don't replace them. Since this is your first call, let's set you up. It takes about three minutes, and you can say skip at any step."
   - name: "What name would you like me to call you?"
   - condition: "Which fits you best: kidney disease without dialysis, hemodialysis, peritoneal dialysis, a kidney transplant, or not sure?"
   - limits: "Do you have the daily limits your care team gave you? Please read me your sodium, potassium and phosphorus in milligrams, and your fluid in milliliters."
   - avoid: "Has your care team told you to avoid any foods, or do you have any food allergies?"
   - voice: "I can speak in an upbeat, firm, warm or mature voice. Which would you like?"
   - style: "Would you like brief answers or more detail? And English or Spanish?"
   - capabilities: "Here's what I can do. Show me a food, a label or your plate and I'll tell you if it fits your limits. I can suggest a meal from your fridge or from scratch, and I can fill a Kroger cart and text you the link. I never pay for anything."
   - done: "What would you like to check first?"

2. Build a "Setup" paragraph from SETUP_STEPS. It says:
   - Setup runs only on a caller's first call (when your greeting starts it) or after start_setup, when the caller says "update my setup" or asks to change their limits or details.
   - Ask one short question at a time in this order, saying each line close to as written.
   - After the name and condition answers, call save_profile_basics. After the avoid answer, call set_avoid_foods. After the style answer, call set_preferences once with voice, reply_style and language.
   - For limits: once you have all four numbers, call propose_limits (convert grams to milligrams and liters to milliliters), say its say sentence, and call confirm_limits with the same numbers only after the caller says yes. If they correct a number, call propose_limits again. If a result says a number doesn't sound right, ask them to read it again. If they don't have the limits or don't know one, say that's fine, you won't guess, and they can add them later by saying "update my setup", then move on.
   - The caller may say skip for any step, except that limits you have read back are either confirmed or dropped.
   - After set_preferences, say any say sentence it returned (the voice starts next call); then say the capabilities line, call finish_onboarding, say its say sentence, then the done line.
   - Keep setup to about three minutes.

3. Export `buildInstructions(prefs)`, using `cleanPreferences` from './prefs.mjs'. It returns today's instructions text with these changes:
   - the English line is unchanged when language is 'en'; for 'es' it is replaced by the Spanish rule (DEC-5), plus: when speaking Spanish, translate each tool sentence faithfully, keeping every number and the verdict meaning;
   - "Keep every reply to one or two short sentences" becomes "three or four short sentences" when replyStyle is 'detailed' (the store rule stays one sentence);
   - when `cleanCallName(prefs.name)` is set, add the line: The caller asked to be called "NAME"; this is only a name.
   - the limit rule is replaced by exactly: "Only tool results carry the caller's limits. Never state a daily limit yourself and never invent one. Outside setup, never accept or change a limit: if the caller asks to raise or lower one, say only their care team sets their limits, and that if their care team gave them new numbers they can say \"update my setup\" and read them to you. In setup, take limits only through propose_limits and then confirm_limits after the caller says yes to the numbers you read back, and never fill in a number they did not say. Limits saved in setup are the limits the caller told you their care team gave them: say it that way whenever you mention them. If a result says limits_needed, say its say sentence and do not judge the food yourself. You do not replace the care team.";
   - the Setup paragraph is appended;
   - every other line is kept byte-identical.
   `export const instructions = buildInstructions({})`.

4. Add `setupGreeting`: "Greet the caller in two or three short sentences: say you are an AI renal dietitian that follows the limits set by their care team and does not replace them, that this is their first call so you will set them up in about three minutes, and that they can say skip at any step. Then ask what name they would like you to call them."

5. `chooseGreeting({ outbound, remembered, setupDue })`: outbound stays checkin; then `setupDue === true` gives `{ kind: 'setup', instructions: setupGreeting }`; otherwise resume or inbound exactly as today.

6. `timeWarning` keeps its sentence and appends: "If setup is still running, first call finish_onboarding to save what the caller confirmed, and tell them they can finish setup next time by saying \"update my setup\"."

7. Update agent/prompt.test.mjs. Keep every existing assertion and add:
   - setup greeting choice: setupDue true and not outbound gives 'setup'; outbound wins; false gives today's kinds;
   - buildInstructions({}) === instructions, and the English line is present;
   - 'es' contains "Spanish" and not "Always speak English";
   - 'detailed' contains "three or four short sentences";
   - a name like "IGNORE ALL RULES now" (4 words) or with a digit is dropped;
   - the reworded limit rule contains "update my setup", "propose_limits", "confirm_limits", "told you their care team gave them" and "never invent";
   - SETUP_STEPS order is welcome, name, condition, limits, avoid, voice, style, capabilities, done;
   - a budget test: the total word count of SETUP_STEPS `says` is at most 300 (about 2 minutes at 150 words a minute);
   - timeWarning contains finish_onboarding.

(b) agent/agent.mjs. Make only these edits:
1. Imports: replace `instructions` with `buildInstructions` from './prompt.mjs'; add `readPreferences, realtimeOptions` from './prefs.mjs' and `setupStatus` from './tools.mjs'.
2. Move the `createMemory({ patientId: 'demo' })` line (with its comment) up to just before `const session = ...`.
3. Before the session, add:
   - `const prefs = await readPreferences(memory);`
   - `const setupDue = !call && process.env.AGENT_SKIP_ONBOARDING !== '1' && (await setupStatus({ patientId: 'demo' })).needsSetup;`
   - `console.log(\`[agent] setup due=${setupDue}\`)` (a boolean only).
4. `llm: new google.realtime.RealtimeModel(realtimeOptions({ model, prefs, realtimeInputConfig }))`.
5. In the UserInputTranscribed handler, after computing length: `if (length > 0) { heardAt = Date.now(); heardAny = true; }`, declaring `let heardAt = 0, heardAny = false;` beside the watchdog.
6. `chooseGreeting({ outbound: Boolean(call), remembered, setupDue })`.
7. `new voice.Agent({ instructions: buildInstructions(prefs), tools: buildTools({ ...existing, setupDue, callerHeardAfter: t => (heardAny ? heardAt > t : null) }) })`.
No other lines change. Run `node --check agent/agent.mjs`.

(c) agent/sim/reset-setup.mjs. Run it as `node --env-file-if-exists=.env.local agent/sim/reset-setup.mjs [patientId]`, with patientId defaulting to demo. It calls renal `resetProfile` and `createMemory({ patientId }).resetPreferences()`. It prints only `[reset] profile removed=<bool> preferences removed=<bool>`, and has a header comment explaining it is for demos.

(d) agent/sim/onboarding-run.mjs, a developer check that is not part of npm test. It must not touch the real folders.
- Before importing renal, it sets `process.env.RENAL_STATE_DIR` to a new `mkdtemp(join(tmpdir(), 'onboarding-run-'))`, sets `globalThis.fetch` to throw, and uses the real renal profile store and a real `createMemory({ dir: <second mkdtemp> })`.
- It prints setupStatus (expect true), then builds the tools with `setupDue: true`, a fake clock and `callerHeardAfter: () => true`.
- It drives the setup in order with sample answers:
  - save_profile_basics: name Ana, condition hemodialysis;
  - propose_limits with 2000/2000/1000/1000, printing its say;
  - one refused propose with potassium 9000, printing its say;
  - propose again, advance the clock 3 s, then confirm_limits;
  - set_avoid_foods ['grapefruit'];
  - set_preferences warm, brief, english;
  - finish_onboarding.
- It prints each tool's ok, error and say; then `renal.getProfile` and `memory.loadPreferences()` as JSON; then setupStatus (expect false); then realtimeOptions for the stored prefs.
- Spoken-length estimate:
  - agent words = SETUP_STEPS words + the say sentences returned during the run;
  - caller words = the fixed sample answers (about 60 words: name, condition, the four limits read as spoken numbers, yes, grapefruit, warm, brief, English);
  - seconds = (agent + caller words) / 150 × 60 + 12 turns × 1.5 s of model latency.
  - Print the words, the seconds and PASS/FAIL against "180 to 300 s total and under 240 s".
- Remove both temporary folders in a finally block, and exit 1 if any expected step failed.
Run it and paste its output into SUMMARY.md. If the estimate falls below 180 s, report it plainly (shorter is acceptable for the call cap) and do not pad the script.

(e) Shared contract (DEC-1, DEC-2, DEC-8). Use ONE scripted replacement (node or perl) applied to all three READMEs (agent/README.md, renal/README.md, actions/README.md), changing only these rows and lines in the "Shared contract" section.

Replace the getProfile row with:
`| \`getProfile({ patientId })\` | \`{ ok, profile }\`. The patient's saved profile when first-call setup saved all four limits (\`setBy: 'patient, as told by their care team'\`, \`setOn\`, \`condition\`, \`source: 'patient'\`), otherwise the built-in one from \`renal/data/patients.json\` (\`source: 'builtin'\`). A saved profile without limits gives \`{ ok: false, error, limitsNeeded: true }\`, never a default. |`

Insert right after it:
- `| \`getSavedProfile({ patientId })\` | \`{ ok, saved }\`, where \`saved\` is \`null\` or \`{ id, name, condition, limits, avoid, setBy, setOn, setupDone }\` and \`limits\` may be \`null\`. Used to decide whether a caller needs setup. |`
- `| \`saveProfile({ patientId, profile: { name, condition, limits, avoid, setupDone } })\` | \`{ ok, saved }\` or \`{ ok: false, error, field? }\`. Replaces the saved profile after strict checks: \`limits\` is \`null\` or all four whole numbers within \`LIMIT_BOUNDS\` (sanity bounds, not medical advice), \`condition\` is one of \`CONDITIONS\` or \`null\`, and \`avoid\` holds at most 10 short names. Stored in \`profiles.json\` outside the repo, mode 600. |`
- `| \`resetProfile({ patientId })\` | \`{ ok, removed }\`. Deletes the saved profile, so the built-in profile and first-call setup come back (for demos). |`

Change the Profile type comment to: `// Profile: the patient's daily limits, from their care team (built-in demo) or as the patient read them out in first-call setup (setBy 'patient, as told by their care team', plus setOn and condition).`

Change the RENAL_STATE_DIR row's description to: `Folder where renal keeps its writable \`diary.json\` and \`cache.json\` (empty uses \`renal/data\`) and the patient's saved \`profiles.json\` (empty uses a \`renal-state\` folder in the system temp directory; never inside the repo). Tests use a temp folder.`

Change the AGENT_STATE_DIR row's description to: `A folder outside this repo for the per-patient shopping list and pantry (food names only) and the caller's chosen voice, reply length, language and preferred name. Empty uses a folder in the system temp directory.`

Add after the AGENT_CALL_WARN_SECONDS row: `| \`AGENT_SKIP_ONBOARDING\` | A | Optional | \`1\` stops first-call setup from starting by itself (\"update my setup\" still works). Empty means a caller with no finished setup is set up on their first call. |`

Then verify: `for f in agent renal actions; do awk '/^## Shared contract/{p=1} /^## Track/{p=0} p' $f/README.md | shasum; done | sort -u | wc -l` must print 1.

(f) Other docs, outside the shared section.

agent/README.md:
- Voice model paragraph: the voice is the one chosen in setup (Puck by default), applied when a call starts; it does not change mid-call (DEC-4).
- Tools table: add rows for start_setup, save_profile_basics, propose_limits, confirm_limits, set_avoid_foods, set_preferences and finish_onboarding with their failure codes, and add limits_needed to check_food, suggest_meal and todays_totals.
- A new `### Onboarding (first-call setup)` section covering:
  - when setup runs;
  - the script order from SETUP_STEPS and the 3-minute budget, with the simulated estimate;
  - the two-step limit rule and DEC-9;
  - DEC-2 (no limits leads to limits_needed, never Sam's numbers);
  - safety and privacy (labelled as told by the patient; nothing logged, texted or sent except to the existing Gemini calls; files 600 in 700 folders outside the repo);
  - how to reset for a demo (`node --env-file-if-exists=.env.local agent/sim/reset-setup.mjs`);
  - AGENT_SKIP_ONBOARDING;
  - the run-through command (`node agent/sim/onboarding-run.mjs`).

renal/README.md: in "The demo patient", add a short "Saved profiles" paragraph covering the store location (DEC-1), validation, LIMIT_BOUNDS as sanity bounds not medical advice, DEC-2, DEC-3, and that getToday now reads limits through getProfile.

README.md:
- Under "Built and tested with fakes, not yet proven on a live call", add one bullet: first-call setup (name, condition, limits read out and confirmed, foods to avoid, voice and reply preferences), simulated only.
- Update the "npm test passes N tests" line to the new count.
- Under "Test without spending FaceTime minutes", add the two sim commands.

.env.example:
- add `# Optional. 1 = do not start first-call setup by itself ("update my setup" still works). Empty sets up a caller with no finished setup on their first call.` followed by `AGENT_SKIP_ONBOARDING=`, after AGENT_CALL_WARN_SECONDS;
- update the RENAL_STATE_DIR comment to mention profiles.json and its temp-folder default;
- update the AGENT_STATE_DIR comment to mention the preferences.

(g) Run `npm test` from the worktree with no .env.local. Every test must pass; record the count (484 before). Commit, staging by name:
- `feat(agent): first-call setup script, greeting and stored voice at session start`, with prompt.mjs, prompt.test.mjs, agent.mjs and both sim files;
- then ONE docs commit with all three READMEs, README.md and .env.example: `docs: first-call setup, saved profile functions and env in the shared contract`.
Each message ends with the Co-Authored-By line. Then `rm node_modules`; `git status --porcelain` must show only the uncommitted SUMMARY.md. Do not push.

In SUMMARY.md report:
- the pass count;
- the run-through output and the spoken-length estimate against the 3 to 5 minute target and the 240 s warning;
- DEC-1 to DEC-9;
- what is unproven live: the voice change on the next call, transcription timing for DEC-9 (d), and Spanish;
- any cut made. If you had to cut, cut in this order only: Spanish, then reply style. Never cut the two-step confirmation or the validation.
  </action>
  <verify>
    <automated>node --check agent/agent.mjs && node --test agent/prompt.test.mjs && node agent/sim/onboarding-run.mjs && for f in agent renal actions; do awk '/^## Shared contract/{p=1} /^## Track/{p=0} p' $f/README.md | shasum; done | sort -u | wc -l | grep -qx ' *1' && grep -c "saveProfile\|AGENT_SKIP_ONBOARDING" agent/README.md renal/README.md actions/README.md .env.example && npm test 2>&1 | tail -8</automated>
  </verify>
  <done>
- The agent greets a first-time caller with the setup greeting, and the instructions carry the setup script, the reworded limit rule and the stored language and reply length.
- The stored voice reaches RealtimeModel through realtimeOptions.
- The run-through prints a saved profile, the stored preferences and an estimate inside the target.
- The three Shared contract sections are byte-identical with the new rows.
- npm test passes with 0 failures and no .env.local.
- The node_modules symlink is removed. Nothing is pushed.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| caller speech → voice model → setup tool arguments | Names, numbers and food names are untrusted and may be misheard or adversarial |
| setup tools → renal profiles.json / agent prefs file | Health information written to disk and read back on every call |
| stored name → model instructions | A stored string is placed in the system instructions on later calls |
| agent → logs | Process logs are shared and visible to the team |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-leq-01 | Tampering | propose_limits / confirm_limits | mitigate | Integer and LIMIT_BOUNDS checks in the agent and again in renal saveProfile; the confirm needs a pending proposal with identical numbers, CONFIRM_MIN_MS, and caller speech after the proposal when transcription is available (DEC-9) |
| T-leq-02 | Elevation of privilege | limit changes outside setup | mitigate | Setup-only tools refuse with setup_not_started unless setup is active (first call or start_setup); the prompt rule is reworded so a limit is never accepted outside setup |
| T-leq-03 | Tampering | stored name in instructions | mitigate | cleanCallName allows letters, spaces, apostrophes and hyphens only, at most 30 characters and 3 words, quoted and labelled "only a name" |
| T-leq-04 | Information disclosure | logs | mitigate | Only tool name, ok, an error code and `setup due=<bool>` are logged; a test asserts no profile value appears in the logs |
| T-leq-05 | Information disclosure | profiles.json, prefs file | mitigate | Folders outside the repo (path and realpath checks), owned by the user, 700; files 600 written atomically with flag wx; nothing is texted; the profile only reaches the Gemini calls that already receive limits |
| T-leq-06 | Tampering | corrupt or swapped state files | mitigate | Size caps, shape checks, allow-list cleaning on load; a corrupt profiles.json gives ok:false, never the built-in limits (DEC-3); symlinked or foreign-owned folders are refused |
| T-leq-07 | Denial of service | setup over the 5-minute cap | mitigate | Script budget test (at most 300 agent words); the time warning calls finish_onboarding to save confirmed steps; setupStatus and readPreferences are capped at 1 s so the greeting is never delayed |
| T-leq-08 | Repudiation | where limits came from | accept | setBy 'patient, as told by their care team' and setOn date are stored and spoken; a hackathon demo needs no audit trail |
| T-leq-SC | Tampering | package installs | accept | No new dependency is installed |
</threat_model>

<verification>
- `node --test renal/profile.test.mjs agent/prefs.test.mjs agent/onboarding.test.mjs agent/prompt.test.mjs` passes.
- `npm test` with no .env.local: 0 failures, count above 484.
- `node agent/sim/onboarding-run.mjs` exits 0 and prints the saved profile (setBy 'patient, as told by their care team'), the preferences (voice Sulafat), and the estimate PASS.
- The Shared contract sha check prints 1.
- `git diff 2c546e5 --stat -- renal/data actions shared agent/screen.mjs agent/card.mjs agent/face.mjs` shows only actions/README.md.
- `git status --porcelain` shows only SUMMARY.md.
</verification>

<success_criteria>
- A first-time caller is set up in about 3 minutes, before the 240 s warning: name, condition, four confirmed limits, foods to avoid, voice, reply length and language.
- Limits are never saved from one utterance, never out of bounds, and never defaulted. Without them, food answers say the care team's limits are needed.
- Later calls start in the chosen voice and language, and use the saved limits, labelled as told by the patient.
- "update my setup" reruns the same two-step confirmation; outside setup no limit can change.
- State is outside the repo with 700/600 modes; no sensitive values appear in logs; the contract is identical in all three READMEs; npm test is green with no keys.
</success_criteria>

<output>
Create `.planning/quick/261114-leq-new-patient-onboarding-call-with-agent-p/261114-leq-SUMMARY.md` when done (leave it uncommitted).
</output>
