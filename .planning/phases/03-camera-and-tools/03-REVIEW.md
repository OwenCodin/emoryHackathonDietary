---
phase: 03-camera-and-tools
reviewed: 2026-11-13T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - agent/camera.mjs
  - agent/tools.mjs
  - agent/prompt.mjs
  - agent/agent.mjs
  - agent/sim/sim-call.mjs
  - agent/sim/speech.mjs
  - agent/camera.test.mjs
  - agent/tools.test.mjs
  - agent/sim/speech.test.mjs
  - .env.example
findings:
  critical: 1
  warning: 9
  info: 2
  total: 12
status: issues_found
---

# Phase 3: Code Review Report

**Depth:** standard. `npm test` passes (70/70). No agent or simulated call was run. CR-01 was reproduced offline by calling `buildTools` with fake renal functions.

## Summary

The camera freshness and mute handling is sound. `jpeg()` returns null for no video, muted, unsubscribed and old frames, and it catches its own errors. Tool errors are mapped to fixed sentences, so no module error text, URL or phone number reaches the model. Nothing can pay or check out. `startCart` and `sendText` are called with the contract shapes. The shell is not used for `say` or `afconvert`. The main defect is that the 600-character cap in `tools.mjs` silently drops foods from a look, which can hide an "avoid" item.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: The 600-character cap silently drops foods from `look_at_camera`, including "avoid" items

**File:** `agent/tools.mjs:45-55` (used at 57-70, results built at 113-125)
**Issue:** `fit()` shrinks any result over 600 characters by keeping only the first 3 array entries. It adds no flag and does not sort by severity.
- Reproduced with 5 foods (banana, potato, star fruit, tomato, orange): the result was `ok:true` with 3 rows. Tomato and orange vanished.
- Had the "avoid" food been 4th to 6th, it would have vanished the same way.
- A plate or fridge with 4 or more foods is the normal case, and each row is about 170 to 340 characters.
- With realistic, longer `say` text, 3 rows still exceed 600. Then `fit` returns `tool_failed`, so a normal plate of 3 or more foods fails outright.
- The model then tells the patient the foods are fine, or nothing about the rest.
**Fix:** Do not use the generic `fit` for `look_at_camera`. Build the result from the most severe row first (order: avoid, limit, unknown, ok). Cap each row's `spoken` at about 140 characters. Cap the row count at 3 and return `omitted: N` plus a `say` saying "I only checked the first three; show me the rest". For example:
```js
const rank = { avoid: 0, limit: 1, unknown: 2, ok: 3 };
results.sort((a, b) => (rank[a.verdict] ?? 2) - (rank[b.verdict] ?? 2));
const shown = results.slice(0, 3);
return { ok: true, kind: seen.kind, results: shown, ...(results.length > 3 ? { omitted: results.length - 3 } : {}) };
```
Also give this tool its own size limit, or raise the limit for it.

## Warnings

### WR-01: `todays_totals` and `cart_status` return `ok:true` with empty or undefined numbers
**File:** `agent/tools.mjs:89, 181, 203`
**Issue:** `three(undefined)` returns an object with all-undefined fields. The result is `{ok:true,totals:{},remaining:{}}`, which I reproduced. The model reads "ok" with no data and may fill in numbers, which the prompt forbids. `total: s.total` can be undefined in the same way. `three()` also passes through non-numbers such as strings or NaN.
**Fix:** Require finite numbers for all three fields in both `totals` and `remaining`. Otherwise return `fail('tool_failed')`. For `cart_status`, omit `total` unless it is a finite number.

### WR-02: `log_meal` can write the whole fridge or shelf into today's totals
**File:** `agent/tools.mjs:123-124, 136-137, 165-174`
**Issue:**
- `look_at_camera` sets `lastVerdicts` to every food in view (up to 6 for a `fridge` or `shelf`). "I ate it" then logs all of them, which inflates the totals the health advice depends on.
- If the second `logFood` fails, nothing is cleared and the function returns not-ok. A retry then logs the first food twice.
- A failed `look_at_camera` keeps the previous verdicts. `check_food` also overwrites `lastFoods`, so `suggest_meal` after a fridge look plus one "can I eat X" uses only X.
**Fix:**
- Log only when `kind` is `plate` or `label`, or have the caller choose which item. Otherwise return `fail('nothing_to_log')`.
- Remove each verdict from the list as soon as its `logFood` succeeds.
- Keep fridge foods separate from the last-checked food.

### WR-03: Frame reader is never cancelled or released
**File:** `agent/camera.mjs:27-40, 50-56, 81-88`
**Issue:** On unsubscribe, `generation++` and `close()` only make the loop exit at the next frame. The reader is never cancelled and the lock is never released. In rtc-node's `VideoStreamSource`, only `cancel()` frees the FFI handle and the event listener. After the loop breaks, the stream keeps enqueuing frames of 1 to 4 MB each, with no backpressure, until the track ends.
- This happens whenever a second video track replaces the first, and on `close()` while the track is still live.
- A parked `read()` on a track that stops sending also never wakes.
**Fix:** Keep the reader in the closure and call `reader.cancel().catch(() => {})` in `onUnsubscribed`, `close()` and `start()` (for the previous reader). Cancel it on the `mine !== generation` break as well.

### WR-04: Timeout does not stop the work, so late results change state
**File:** `agent/tools.mjs:57-70`
**Issue:** `guard` only races a timer. The original function keeps running after "timeout" is returned.
- A late `look_at_camera` overwrites `lastVerdicts` with foods the caller never heard a verdict for. A later `log_meal` then logs them.
- A `start_cart` that times out can still start the cart. The model says it failed, the caller retries, and gets `busy`.
- A late `log_meal` can log foods after the caller was told it failed, and a retry double-counts.
**Fix:** Use a per-call token or abort flag. Write `lastFoods`, `lastVerdicts` and `lastMissing` only if the call has not timed out. For `start_cart`, check `getCartStatus` or treat a timeout as "started, check status".

### WR-05: Debug frames: path unchecked, files world-readable, patient images on disk
**File:** `agent/tools.mjs:98-104`
**Issue:**
- `AGENT_DEBUG_FRAME_DIR` is used as-is. A relative path resolves against the cwd, which is normally the repo, and `.gitignore` does not cover it. Frames of a patient's food, and possibly their face from FaceTime's self-preview, could be committed.
- `.env.example` says "outside this repo" but nothing enforces it.
- `mkdir` and `writeFile` use default modes, so the files are readable by other users.
- The name `frame-${Date.now()}.jpg` can overwrite a file written in the same millisecond.
**Fix:** `path.resolve` the directory and refuse it if it is inside the repo root. Use `mkdir(..., { mode: 0o700 })`, `writeFile(..., { mode: 0o600, flag: 'wx' })`, and add a random suffix to the filename. Log a one-time warning at startup when the variable is set.

### WR-06: `text_cart_link` sends a link while the cart is still running, and can send it repeatedly
**File:** `agent/tools.mjs:206-216`
**Issue:**
- Only `cartUrl` is checked. If `state` is `running`, `waiting_for_patient` or `failed`, the SMS still says the cart "is ready to review".
- There is no limit on repeats, so the model can send duplicate texts.
- `cartUrl` is not checked to be http(s).
**Fix:** Require `s.state === 'done'` (return `no_cart_link` otherwise). Check `/^https:\/\//.test(s.cartUrl)`. Keep a `sentLinks` set per call and reject a second send of the same URL.

### WR-07: `check_food` does not validate its model-supplied input
**File:** `agent/tools.mjs:130-134`
**Issue:**
- The name can be empty or very long.
- `grams` can be 0, negative, NaN or huge, and it goes straight into the nutrient calculation that produces health numbers.
- `z.number().nullable()` requires the key. A model that leaves out `grams` gets a schema error rather than null.
**Fix:** `z.object({ name: z.string().trim().min(1).max(80), grams: z.number().positive().max(5000).nullish() })`. Map `undefined` to `null` before calling `checkFood`.

### WR-08: `cart_status` passes `step` through unchanged and reports failed carts as ok
**File:** `agent/tools.mjs:203`
**Issue:**
- `step` comes from Track C and can hold URLs or internal error text. It is returned to the model unsanitised and is limited only by the 600-character cap.
- `state: 'failed'` returns `ok:true` with no `say`, so the model may describe it as progress.
**Fix:** Map `state` to fixed `say` sentences and drop `step`, or truncate it to about 60 characters and remove anything that looks like a URL. Return `ok:false` with a `say` when `state === 'failed'`.

### WR-09: No `stopCart` at call end, and sequential shutdown without a timeout
**File:** `agent/agent.mjs:62-69`
**Issue:**
- Nothing calls `stopCart()` when the call ends. A cart left in `waiting_for_patient` blocks the next call's `start_cart` with `busy`. The next caller's `cart_status` also reports the previous caller's items and total.
- The shutdown loop awaits `session.close()` with no timeout. If it hangs, the track, source and camera never close.
**Fix:** Add `() => stopCart()` to the shutdown list, or leave it to Phase 4 with a note. Wrap each close in `Promise.race` against a 3 to 5 s timer.

### WR-10: `say` and `afconvert` run with no timeout, and before the watchdog starts
**File:** `agent/sim/speech.mjs:43-44`, `agent/sim/sim-call.mjs:237-249`
**Issue:** `execFile` has no `timeout`. A hung `say` (for example no voice installed) hangs the script before the watchdog timer is created. There is no length cap on the text, so a long `--say` produces long audio. Injection is not possible: `execFile` takes an argv array, and a leading `-` is rejected.
**Fix:** Pass `{ timeout: 30000 }` to both calls. Pass `--` before the text (`['-o', aiff, '--', text]`) and cap the text at about 300 characters.

## Info

### IN-01: `spokenVerdict` can cut or change the module's wording
**File:** `agent/tools.mjs:16-24`
**Issue:**
- Splitting on `[.!?]\s+` treats "approx. 420 mg" as a sentence end.
- The 240-character cut can stop mid-sentence.
- The first letter is lower-cased even for brand names, so "Campbell's" becomes "campbell's".
- If `say` already begins with "Yes" or "No", the output reads "Yes, yes ...".
**Fix:** Skip a leading verdict word in `say`. Truncate at a sentence boundary, not at 240 characters. Do not lower-case words that are capitalised in the middle.

### IN-02: Camera freshness uses arrival time, not capture time
**File:** `agent/camera.mjs:35, 73`
**Issue:** `at` is when the frame reached the agent, not when it was captured. If the bridge repeats its last frame after the camera is turned off without a mute event, `jpeg()` keeps returning that frame as "fresh". The code cannot detect this, so check it on a real call (human verification already listed).
**Fix:** Compare `frame.timestampUs` between frames. If it stops advancing, treat the frame as stale.

---

_Reviewed: 2026-11-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
