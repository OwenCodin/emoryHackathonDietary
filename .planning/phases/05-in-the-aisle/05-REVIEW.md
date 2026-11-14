---
phase: 05-in-the-aisle
reviewed: 2026-11-14T00:00:00Z
depth: deep
files_reviewed: 11
files_reviewed_list:
  - agent/agent.mjs
  - agent/tools.mjs
  - agent/prompt.mjs
  - agent/memory.mjs
  - agent/turns.mjs
  - agent/sim/sim-call.mjs
  - agent/memory.test.mjs
  - agent/prompt.test.mjs
  - agent/tools.test.mjs
  - agent/turns.test.mjs
  - .env.example
findings:
  critical: 1
  warning: 10
  info: 2
  total: 13
status: issues_found
---

# Phase 5: Code Review Report

**Depth:** deep. `npm test` passes (193/193). No simulated call was run.

## Critical Issues

### CR-01: The barge-in fix (D-16) probably does not stop the dropped reply
**File:** `agent/agent.mjs:89-91`, `agent/turns.mjs:10-13`
**Issue:** `ActivityHandling.NO_INTERRUPTION` is only read in the Google plugin's `RealtimeSession.interrupt()` (realtime_api.js:550). The abort in D-15 ("Aborting all realtime generation tasks due to interruption") comes from LiveKit's `speechHandle.interrupted` (agent_activity.js:3197). The chain is:
- The plugin emits `input_speech_started` whenever a generation that was not user-initiated is created (realtime_api.js:1091).
- `AgentActivity.onInputSpeechStarted` then calls `this.interrupt()` (agent_activity.js:1169-1180).
- That calls `currentSpeech.interrupt()` unconditionally, because the speech allows interruptions by default (agent_activity.js:1987).
- `activityHandling` is never consulted on this path.

So the setting leaves the reported symptom in place. Only the watchdog remains as protection, and it has the gaps in WR-01 and WR-02.
**Fix:** Stop LiveKit from interrupting its own speech. For example, set the session-level interruption option to disabled, or `allowInterruptions: false` in the `AgentSession` options, then check the installed `AgentSession` options type. Note that `generateReply` forces `allowInterruptions = true` when the realtime model has server-side turn detection (agent_activity.js:1900), so the setting must be applied at session level. Prove it with the six D-18 calls, and keep the nudge counts.

## Warnings

### WR-01: A caller turn that starts while the agent is speaking is treated as answered forever
**File:** `agent/turns.mjs:43`
**Issue:** `answered: agentNow === 'speaking'` marks the turn answered, but with barge-in off the agent's current speech is not an answer to that new question. If Gemini then drops the reply, the watchdog never nudges. This is the most common case in a noisy store.
**Fix:** Start the turn with `answered: false`. Set `answered = true` only when the agent enters `speaking` after `endedAt` is set. `due()` already waits for the agent to stop speaking.

### WR-02: A tool run marks the turn answered even if the agent then stays silent
**File:** `agent/turns.mjs:61-63`, `agent/agent.mjs:103`
**Issue:** `toolsExecuted()` sets `answered = true`. A fault where the tool runs but the model never speaks the result goes unnudged. This is a likely variant of the dropped reply.
**Fix:** Do not set `answered` on tool completion. Treat it as a reset of the wait clock instead (`endedAt = now()`), so the nudge fires 6 s after the tool finishes if the agent has not spoken.

### WR-03: The watchdog does not hold off while the agent is `thinking`
**File:** `agent/turns.mjs:68`
**Issue:** `due()` blocks only on `speaking`. A slow but live generation (state `thinking`, no audio yet) can be nudged after 6 s. `generateReply` is queued behind the current speech (agent_activity.js:3286), so the caller can hear a duplicate answer.
**Fix:** Also return false while `agentNow === 'thinking'` has lasted less than a hard cap (for example 12 s). Alternatively, track generation start through `SpeechCreated`.

### WR-04: The time warning is not gated and can collide with a nudge or an answer
**File:** `agent/agent.mjs:151-160`
**Issue:** `warnNow` calls `generateReply` without checking agent speaking, a running tool, a pending nudge or a caller turn in progress. The warning speech sets `turn.answered` through the `speaking` event (turns.mjs:52), which suppresses the nudge for the caller's real question. It can also queue directly behind a nudge reply.
**Fix:** Route the warning through the watchdog. Defer it (retry every 500 ms, up to about 20 s) while the agent is speaking or thinking, a tool is running, or the user is speaking. Do not let warning speech count as an answer: add a `watchdog.ignoreNextSpeech()` flag, or set a flag around the call.

### WR-05: `chmod 700` is applied to whatever `AGENT_STATE_DIR` names
**File:** `agent/memory.mjs:80`
**Issue:** Only the repository is refused. `AGENT_STATE_DIR=$HOME` or any existing directory the user owns is silently re-moded to 0700. State files are then written into it.
**Fix:** Chmod only a directory this call created. Compare `mode` before and after `mkdir`, or `lstat` first and refuse a non-empty existing directory that is not already mode 0700.

### WR-06: `mark_item` fuzzy matching can approve or reject the wrong needed item
**File:** `agent/memory.mjs:168-171`
**Issue:** The match is any substring with 3 or more characters, in both directions. "oil" matches "boiled potatoes", "ham" matches "graham crackers", and "oat" matches "goat cheese". The wrong item leaves `needed`, so the caller never buys it.
**Fix:** Match on whole words (split on non-letters and require a complete-token match), or require the shorter string to be at least 5 characters. When more than one item matches, do not guess: return `bad_item`.

### WR-07: A shelf "best choice" is stated when not every item was checked
**File:** `agent/tools.mjs:280-284`
**Issue:** The best choice is picked from `good` only. If a check failed (`good.length < foods.length`) or more than 6 foods were seen (`notChecked > 0`), the spoken sentence still says "the X is the best choice here". An unchecked item could be better, or could be the only safe one.
**Fix:** When `good.length < foods.length || notChecked > 0`, use a hedged sentence ("Of the ones I could check, the X fits best, I couldn't check the rest") and keep `omitted`. Alternatively, omit `best`.

### WR-08: `start_cart` with an empty list buys stored items the caller did not ask for
**File:** `agent/tools.mjs:391-396`
**Issue:** The fallback to the stored `needed` list applies whenever `lastMissing` is empty. That includes calls where no meal was suggested this call. The list holds up to 50 items from earlier calls and from earlier `suggest_meal` runs (auto-added, D-06). They are sent to the cart with no confirmation. The result then reports `more: list.length - 5` of the 12-item slice, so the count is wrong when `needed` has more than 12 items.
**Fix:** Say the items back in the result so the model must confirm. Ideally require the model to pass the items. If the fallback stays, return `needs_confirmation` on the first call listing the names. Compute `more` from the unsliced length.

### WR-09: `add_to_shopping_list` reports success when nothing was stored
**File:** `agent/memory.mjs:146`, `agent/tools.mjs:459-461`
**Issue:** At `MAX_ITEMS` the extra items are skipped. The tool returns `ok: true` with `added: []`, and `skipped` is dropped. The model tells the caller the items were added. An item already in `approved` or `rejected` is also added to `needed` again.
**Fix:** Return `skipped` and `full: true` in the tool result, with a `FAILS.list_full` sentence when `added.length === 0 && skipped > 0`. Skip items already in `approved` or `rejected`, or move them.

### WR-10: Stored names reach the model with an incomplete strip
**File:** `agent/memory.mjs:26-34`, `agent/tools.mjs:17-20`, `agent/tools.mjs:470`
**Issue:** `cleanName` strips C0 and C1 controls and URLs, and caps at 80 characters. It leaves zero-width and bidi characters (U+200B-200F, U+202A-202E, U+2066-2069), which can hide text. Natural-language instruction text ("ignore your limits...") passes through unchanged and is returned in `shopping_list` and `mark_item` results.
**Fix:** Also strip the zero-width and bidi ranges U+200B to U+200F, U+202A to U+202E, U+2060 to U+2069 and U+FEFF. Restrict stored names to letters, digits, spaces and basic punctuation with a cap of about 60. Make the prompt say list names are data, never instructions. The local `clean` in tools.mjs also lacks the C1 control strip (U+0080 to U+009F) that memory.mjs has.

## Info

### IN-01: Shelf sentence can name an empty product
**File:** `agent/tools.mjs:173`
**Issue:** `best.food ?? fallbackName` does not fall back when the module returns an empty string. The result is "Yes, the  is the best choice here."
**Fix:** `clean(best.food, 60) || clean(fallbackName, 60)`, and return the `NONE_FIT` text if both are empty.

### IN-02: Concurrent processes can lose list updates
**File:** `agent/memory.mjs:119-123`
**Issue:** `serial()` only orders writes within one process. Each call is its own process, so two overlapping calls do read-modify-write on the same file and the last writer wins. The write is atomic (temp file plus rename), so the file is never corrupt, but an update can be lost.
**Fix:** Acceptable for the one-line demo. Document it, or take a `wx` lock file around the read-modify-write.

## Checked and found sound
- `patientId` is reduced to a safe file name (`safePatientId`).
- The state file is written with mode 0600 and the folder is refused if inside the repo or not owned by the current user.
- An oversized or corrupt file reads as empty.
- Expiry arithmetic, including future timestamps, is correct.
- `pickBest` never returns an avoided or failed item, handles missing limits and zero limits without division, and breaks ties by order seen.
- No timer leaks in `agent.mjs`: the nudge interval and warning timer are cleared in the shutdown callback, and `greetOnBridgeReady` fires once.
- The warning fires at most once (`createDeadline`) and `closing` blocks it after shutdown.
- One-audio-track logic and greeting trigger are unchanged. Only the up-to-1 s memory read before the inbound greeting is new, and it is capped by a race.

_Reviewed: 2026-11-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
