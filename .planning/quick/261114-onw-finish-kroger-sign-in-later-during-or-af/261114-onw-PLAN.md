---
phase: quick-261114-onw
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - actions/kroger.mjs
  - actions/kroger-signin.mjs
  - actions/kroger-signin.test.mjs
  - actions/cart.mjs
  - actions/cart.test.mjs
  - actions/kroger-relay-e2e.test.mjs
  - kroger-relay/lib/relay.mjs
  - kroger-relay/lib/relay.test.mjs
  - agent/prompt.mjs
  - agent/prompt.test.mjs
  - agent/tools.mjs
  - agent/kroger.test.mjs
  - agent/sim/onboarding-run.mjs
  - actions/README.md
  - agent/README.md
  - kroger-relay/README.md
autonomous: true
requirements: [KROGER-LATER]

must_haves:
  truths:
    - "A patient who signs in from the texted link after the call (or the 4-minute poll) has ended, and calls back within the relay's 10-minute window, is connected on that call by the first Kroger tool call (kroger_status, start_cart's pre-check, or the cart itself) with nothing extra spoken"
    - "A pending sign-in is never claimed twice in one process and a second claim from another process (relay 404) is harmless: exactly one token save"
    - "In setup the caller hears that the link is being texted and that they can sign in now or ask for a new Kroger link on any call; if they already said skip/later for Kroger, no text is sent and the kroger_later line is said"
    - "When setup finishes and a link was texted this call but Kroger is still not connected, finish_onboarding's say ends with one fixed sentence telling them how to finish"
    - "The relay success page no longer claims Kroger is connected; it says what to do if the call has ended and that after ten minutes they need a new link"
    - "npm test is green with no .env.local, no network and no access to ~/.config/renal-dietitian"
  artifacts:
    - path: "actions/kroger.mjs"
      provides: "createPendingSignInStore({ dir }) with load/save/remove, same folder rules as the token store"
      contains: "kroger-signin-pending.json"
    - path: "actions/kroger-signin.mjs"
      provides: "pending record written by startKrogerSignIn, resumePendingSignIn, resume inside getKrogerStatus, exported resumeKrogerSignIn"
      exports: ["startKrogerSignIn", "getKrogerStatus", "waitForKrogerSignIn", "resumeKrogerSignIn", "createKrogerSignIn"]
    - path: "actions/cart.mjs"
      provides: "Kroger path resumes once and retries getUserToken before failing with Sign in to Kroger first"
      contains: "resumeSignIn"
    - path: "agent/prompt.mjs"
      provides: "kroger / kroger_later wording, later handling, normal-mode 'signed in -> kroger_status' rule"
    - path: "agent/tools.mjs"
      provides: "finish_onboarding Kroger sentence"
    - path: "kroger-relay/lib/relay.mjs"
      provides: "honest callback success page"
  key_links:
    - from: "actions/kroger-signin.mjs startKrogerSignIn"
      to: "<tokenDir>/kroger-signin-pending.json"
      via: "createPendingSignInStore(...).save({ state, startedAt }) awaited before the link is returned"
      pattern: "createPendingSignInStore"
    - from: "actions/kroger-signin.mjs getKrogerStatus"
      to: "resumePendingSignIn"
      via: "bounded await before reading the token store"
      pattern: "resumePendingSignIn"
    - from: "actions/cart.mjs runKroger"
      to: "actions/kroger-signin.mjs resumeKrogerSignIn"
      via: "injected resumeSignIn(config) on getUserToken error no_sign_in"
      pattern: "resumeSignIn\\("
    - from: "agent/tools.mjs finish_onboarding"
      to: "actions.getKrogerStatus"
      via: "bounded call after the setup save"
      pattern: "getKrogerStatus"
---

<objective>
Make the Kroger sign-in work during onboarding with a real "finish later" path. Today the pending sign-in lives only in the memory of the call's job process, so a sign-in finished after the call ends is never claimed. This plan persists a small pending record next to the token store, lets any later process resume it (one claim, exchange, save), wires the resume into `getKrogerStatus()` and the Kroger cart path, makes "later" an explicit choice in the setup script, adds a closing reminder in `finish_onboarding`, and makes the relay's success page honest.

Purpose: product owner: "it should work during onboarding with the option to finish setting up later."
Output: code + tests in actions/, agent/, kroger-relay/; docs; SUMMARY.md (uncommitted).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<executor_environment>
- You run in an isolated git worktree with no `.env.local` and no `node_modules`. First: `ln -s /Users/ptrczx/Desktop/emoryHackathonDietary-merge/node_modules node_modules` in the worktree root. Never commit it. Stage files by name only (never `git add -A` / `git add .`). Remove the symlink before finishing so `git status` shows nothing but the uncommitted SUMMARY.md.
- Never print key values. Never stage `renal/data/cache.json`. Do not push.
- HARD RULES: no `vercel` commands (do NOT deploy the relay), no texts, no real Kroger sign-in/cart/token calls, no FaceTime minutes, no network in tests. Do not read, change or delete anything in `~/.config/renal-dietitian/` (tests always set a throwaway `KROGER_TOKEN_DIR` or inject `tokenDir`). Do not start, stop or signal any running `npm start` / `chert` / `facetime` process. No new dependency anywhere.
- Baseline: `npm test` currently passes 615 tests. Run `npm test` at the end of every task; it must stay green.
- Do NOT touch the "Shared contract" section of agent/README.md, renal/README.md or actions/README.md (lines ~5-230). Its `startKrogerSignIn`/`getKrogerStatus` rows stay true: the return shapes do not change, and `pending` still means "a relay sign-in is being polled" (the resume is a poll on demand). Put the new detail in the track sections only.
</executor_environment>

<context>
@.planning/STATE.md
@.planning/quick/261114-m9n-kroger-sign-in-by-texted-link-during-onb/261114-m9n-SUMMARY.md
@actions/kroger-signin.mjs
@actions/kroger-signin.test.mjs
@actions/kroger-relay-e2e.test.mjs
@agent/prompt.mjs

<interfaces>
From actions/kroger.mjs (read lines 1-40 and 140-200 before editing):
- `defaultTokenDir(env)`; `readKrogerConfig(env)` -> `{ clientId, clientSecret, locationId, redirectUri, tokenDir } | null`
- private: `REPO_ROOT`, `TOKEN_FILE = 'kroger-tokens.json'`, `MAX_FILE_BYTES = 8192`, `isInside(root, target)`
- `createTokenStore({ dir })` -> `{ load(): {refreshToken}|null, save({refreshToken}): {ok} }`. Its inner `folderOk()` does: refuse a folder inside the repo, `mkdir(..., {recursive, mode: 0o700})`, lstat must be a real directory owned by the current uid, realpath not inside the repo, chmod to 700 if needed. `save` writes `.kroger-tokens.<pid>.<hex>.tmp` with `{ mode: 0o600, flag: 'wx' }` then `rename`s; unlinks the tmp on failure.
- client `getUserToken()` -> `{ ok: true, token } | { ok: false, error: 'no_sign_in' | ... }`; `exchangeCode({ code, redirectUri })` -> `{ ok }`.

From actions/kroger-signin.mjs (in context above): `createKrogerSignIn({ env, fetchImpl, createClient, createStore, setTimer, clearTimer, now, randomState, pollMs=2000, maxWaitMs=240000, requestTimeoutMs=5000, unrefTimers=true })` -> `{ startKrogerSignIn, getKrogerStatus, waitForKrogerSignIn, cancel }`; internal `claimOnce(config, relay, state)` -> `{code}|{keepGoing}|{stop: 'relay_rejected'|'exchange_failed'}`; `getKrogerStatus()` -> `{ ok: true, configured, relay, connected, pending }`.

From kroger-relay/lib/relay.mjs: `export const CODE_TTL_MS = 600_000`; `export const isValidState = (s) => /^[A-Za-z0-9_-]{43}$/` test; callback success page at line ~121: `page(200, ['Kroger is connected. You can go back to your call.', 'You can close this page.'])` (first line renders as h1, the rest as p). Claim returns 200 `{code}` once, then 404.

From actions/cart.mjs: `createCartController({ ..., getKrogerConfig, createKroger, ... })` at line 285; `runKroger(items, config)` at line 375: `const auth = await kroger.getUserToken(); if (!auth.ok) { if (auth.error === 'no_sign_in') fail(\`Sign in to Kroger first: ${KROGER_LOGIN_COMMAND}\`) ... }`. Tests: actions/cart.test.mjs `makeKrogerController({ stored })` (around line 403-480, `KROGER_CONFIG.tokenDir = '/unused'`), test 'kroger path with no stored sign-in fails with the login command' at line ~552.

From agent/tools.mjs: `buildTools({ ..., actions, phone, now, timeoutMs = 12000 })`; closure var `krogerTextAt` (set when a Kroger link text was sent, reset to null on a definite failure); `kroger_status` (line ~851) maps status to `{connected, set_up, can_text, pending, say}`; `finish_onboarding` (line ~1029) returns `{ ok: true, complete: true|false, say }` after `saveDraft({...d, setupDone: true})` and `setupActive = false`. agent/kroger.test.mjs `setup({ status, start, send, build, cart })` injects `actions.getKrogerStatus` and `buildTools({..., setupDue?})` — pass `setupDue: true` via `build` for finish_onboarding tests. `makeFakeActions()` (agent/fake-modules.mjs) has `getKrogerStatus` returning `configured: false`, so existing onboarding tests see no Kroger sentence.

From agent/prompt.test.mjs line 110-113: asserts `SETUP_STEPS` order `['welcome','name','condition','limits','avoid','voice','style','kroger','capabilities','kroger_later','done']` and total words <= 300 (today 241).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Persisted pending sign-in and the resume step (actions/kroger.mjs, actions/kroger-signin.mjs, actions/cart.mjs)</name>
  <files>actions/kroger.mjs, actions/kroger-signin.mjs, actions/kroger-signin.test.mjs, actions/cart.mjs, actions/cart.test.mjs</files>
  <behavior>
    kroger-signin.test.mjs (all with throwaway dirs from the existing tempDir helper and the existing makeFetch; add `pendingFile = join(dir, 'kroger-signin-pending.json')`):
    - start writes the record: file mode 600 (`(await stat(f)).mode & 0o777 === 0o600`), folder mode 700, JSON has exactly keys `state` (equal to the link's state) and `startedAt` (number = injected now()); no tmp files left in the dir.
    - in-process poller success removes the record; exchange_failed (Kroger rejected the code, or a bad code) removes it; relay_rejected (401/403) KEEPS it (a secret problem, not a patient problem; it expires by age); `timed_out` (maxWaitMs) KEEPS it (another process may still claim within 10 min); a second start overwrites it with the new state.
    - fresh process resume: controller A starts (claims answer 404, short maxWaitMs, then `A.cancel()` WITHOUT removing the record — cancel must not delete it); a NEW controller B (same env/dir, fetch answering 200 {code}) calls `resumePendingSignIn()` -> `{ resumed: 'connected' }`, exactly one claim with A's state, one token exchange, token file saved, record removed; `B.getKrogerStatus()` -> connected true, pending false.
    - resume with relay 404: returns `{ resumed: 'waiting' }`, record kept, `getKrogerStatus().pending === true` on a new controller with nothing in memory.
    - stale record (injected now() > startedAt + 600_000) is deleted with ZERO claims, returns `{ resumed: 'expired' }`; same for a record dated more than 60 s in the future.
    - Kroger rejects the exchange (tokenOk false) -> `{ resumed: 'failed' }`, record removed, nothing saved; an over-long code -> failed, no exchange, record removed.
    - relay 401 -> `{ resumed: 'failed' }`, record kept.
    - no record / no Kroger config / no relay config -> `{ resumed: 'none' }`, no fetch at all; a corrupt record (bad JSON, bad state, symlink) -> treated as none and removed (except a symlink: never follow, never delete the target; just return none).
    - never throws and respects its time cap: a fetch that never resolves (honours `init.signal` or not) makes `resumePendingSignIn()` return `{ resumed: 'waiting' }` within `resumeWaitMs` + 200 ms (construct with `resumeWaitMs: 100`); `getKrogerStatus()` with that hanging fetch also returns within that bound with the documented shape.
    - no double save: one controller starts, the claim endpoint answers 200 {code} only to the FIRST claim and 404 after; call `resumePendingSignIn()` concurrently with the running poller (and two resumes concurrently) -> exactly 1 token exchange and the record removed. Also: two different controllers sharing the dir and fetch, both resuming concurrently -> exactly 1 exchange (the relay's once-only answer makes the second a 404 that keeps nothing broken).
    - getKrogerStatus shape unchanged: keys exactly `ok, configured, relay, connected, pending`; existing tests (including 'status without keys never touches the token store' and the default-controller wrapper test) still pass unchanged.
    - privacy: extend the existing leak test so results of `resumePendingSignIn()` and all console lines from resume/record paths contain no state, code, token or secret.
    cart.test.mjs:
    - `makeKrogerController` gains an injectable `resumeSignIn` (default in tests: a stub returning `{ resumed: 'none' }` that counts calls) so no cart test ever reaches the real resume.
    - stored null + resume stub that sets the fake stored token -> the cart proceeds and adds items (getUserToken called twice, resume once).
    - stored null + resume stub returning none -> still fails with exactly `Sign in to Kroger first: ${LOGIN}` (existing test keeps passing), resume called once.
    - resume stub that throws, and one that never resolves -> still fails with the same step; the never-resolving case finishes within the cart's cap (inject `resumeWaitMs: 50`).
    - with a stored sign-in, resume is never called.
  </behavior>
  <action>
    A) actions/kroger.mjs: hoist the body of `folderOk()` into a module-level `async function secureFolder(folder)` (same checks, same order) and make `createTokenStore` call it, so the token store's behaviour is byte-for-byte unchanged. Add `export function createPendingSignInStore({ dir } = {})` using `PENDING_FILE = 'kroger-signin-pending.json'` in `resolve(dir ?? defaultTokenDir())`:
    - `load()` -> `{ state, startedAt } | null`, never throws: refuse when the folder is inside the repo; `lstat` the file, return null unless it is a regular file (not a symlink) of at most 1024 bytes; parse JSON; valid only if `state` matches `/^[A-Za-z0-9_-]{43}$/` and `startedAt` is a finite number; on a regular file that is unparsable or invalid, unlink it and return null.
    - `save({ state, startedAt })` -> `{ ok }`: validate as above, `secureFolder`, then atomic write exactly like the token store (tmp name `.kroger-signin-pending.<pid>.<hex>.tmp`, `{ mode: 0o600, flag: 'wx' }`, `rename`, unlink tmp on failure). Content is ONLY `{ state, startedAt }`.
    - `remove({ ifState } = {})` -> `{ ok }`, never throws: when `ifState` is given, load first and only unlink if the stored state equals it (so an old poller never deletes a newer record); ENOENT counts as ok; never unlink a symlink (lstat check).

    B) actions/kroger-signin.mjs (keep the module's "nothing throws, one value-free log line per outcome" rule):
    - New options: `createPendingStore = createPendingSignInStore`, `codeTtlMs = 600_000` (mirror of the relay's CODE_TTL_MS — do not import kroger-relay code into actions), `resumeWaitMs = 2500`, `resumeRequestTimeoutMs = 2000`.
    - Refactor `claimOnce(relay, state, timeoutMs)` and a helper `exchange(config, relay, code)` (the existing createClient + exchangeCode block, returning `{ ok }`), used by both the poller and the resume.
    - `startKrogerSignIn`: after `cancel()` and creating the state, `await createPendingStore({ dir: config.tokenDir }).save({ state, startedAt: now() })` inside try/catch; a failed save does not block the sign-in (in-process polling still works) — log `[actions] kroger sign-in not remembered` (no values). Keep `pending.state = state` in the in-memory record. Return value unchanged (only `{ ok, link }`).
    - Poller endings: success (`{ ok: true }`) -> `remove({ ifState: state })`; `exchange_failed` -> `remove({ ifState: state })` (the relay already deleted the code); `relay_rejected`, `timed_out` and `cancelled` -> keep the record (it expires by age; same rules as the resume). Do the removal inside `finish` before resolving so tests awaiting `waitForKrogerSignIn()` see it gone; never let a removal error escape.
    - `resumePendingSignIn({ config: given } = {})` (exposed on the controller): returns `{ resumed: 'none'|'waiting'|'connected'|'expired'|'failed' }`, never throws. Single-flight: if a resume is already running in this controller, return that same promise. Inner work: config = `given ?? readKrogerConfig(env)`; none -> 'none'. Load the record from `config.tokenDir`; none -> 'none'. Age = `now() - startedAt`; if age > codeTtlMs or age < -60_000 -> remove, 'expired' (no claim). relay = `readRelayConfig(env)`; null -> 'none' (keep record). If the in-memory `pending` holds the same state -> 'waiting' with NO claim (the poller owns it; this is what prevents an in-process double claim). Otherwise ONE `claimOnce(relay, state, resumeRequestTimeoutMs)`: `keepGoing` (404/5xx/network) -> 'waiting', record kept; `stop: 'relay_rejected'` -> 'failed', record kept; `stop: 'exchange_failed'` (bad code) -> remove({ifState}), 'failed'; a code -> `exchange(...)`, then remove({ifState}) in both outcomes (the relay deleted the code either way), 'connected' or 'failed'. If the in-memory poller for the same state is still pending when a resume somehow got the code, end it with ok via `finish`. Log one value-free line only for 'connected' (`[actions] kroger sign-in connected (resumed)`), 'failed' and 'expired'.
    - Time cap: the exported resume races the inner work against an unref'd `resumeWaitMs` timer (use `setTimer`/`clearTimer`; always `unref` this one regardless of `unrefTimers` so it never holds a process open) and resolves `{ resumed: 'waiting' }` on timeout; the inner work keeps running in the background (an exchange that finishes late still saves and removes the record) and the single-flight slot is cleared when the inner work settles, not at the timeout.
    - `getKrogerStatus()`: when config exists, `await resumePendingSignIn({ config })` first (bounded; wrapped so it cannot throw), then load the token store as today, then `pending = pending !== null || (await createPendingStore({dir}).load()) !== null` — but report `pending: false` when `connected` is true. When config is null, behave exactly as today (no store or record access at all). Shape and catch path unchanged.
    - Export `export const resumeKrogerSignIn = (opts) => controller.resumePendingSignIn(opts);` beside the other default-controller wrappers. Do NOT add it to actions/index.mjs (the agent reaches it through getKrogerStatus; cart imports it directly).
    - Update the header comment: pending record (state + start time only, 600 file in the 700 token folder), resume rules, and that the state appears only in the texted link and that file.

    C) actions/cart.mjs: import `resumeKrogerSignIn` from './kroger-signin.mjs'. Add options `resumeSignIn = (config) => resumeKrogerSignIn({ config })` and `resumeWaitMs = 3000` to `createCartController`. In `runKroger`, when `auth.error === 'no_sign_in'`: race `Promise.resolve().then(() => resumeSignIn(config))` (catch -> null) against an unref'd `resumeWaitMs` timer, then call `kroger.getUserToken()` once more and continue with that result through the existing branches (so a resumed sign-in fills the cart; otherwise the same `Sign in to Kroger first: ...` step). Do not call resume for any other error. Passing `config` makes the resume use the cart's own `tokenDir`, never `defaultTokenDir()` of a test process.
    - In cart.test.mjs make `makeKrogerController` inject a counting `resumeSignIn` stub by default and accept an override; add the cart cases from <behavior>.

    Write the tests first (RED), then implement (GREEN). Tests must construct controllers with throwaway `KROGER_TOKEN_DIR`, `unrefTimers: false` where they await timers, and never reach a real network address.
  </action>
  <verify>
    <automated>cd /Users/ptrczx/Desktop/emoryHackathonDietary-merge && node --test actions/kroger-signin.test.mjs actions/cart.test.mjs actions/kroger.test.mjs actions/kroger-relay-e2e.test.mjs && npm test 2>&1 | tail -8</automated>
  </verify>
  <done>All behaviors above are tested and pass; existing kroger-signin/cart/kroger tests unchanged and green; `npm test` green with at least 615 + new tests passing and 0 failing; `git diff actions/kroger.mjs` shows createTokenStore behaviour unchanged (only the folder check hoisted).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: "Later" in the setup script, finish_onboarding reminder, honest relay page, second-process end-to-end</name>
  <files>agent/prompt.mjs, agent/prompt.test.mjs, agent/tools.mjs, agent/kroger.test.mjs, agent/sim/onboarding-run.mjs, kroger-relay/lib/relay.mjs, kroger-relay/lib/relay.test.mjs, actions/kroger-relay-e2e.test.mjs</files>
  <behavior>
    - prompt.test.mjs: SETUP_STEPS order unchanged (same 11 step names); `kroger` says exactly the new text below and contains "new Kroger link" and not "few more minutes"; `kroger_later` says exactly the new text; no step contains "few more minutes"; total words <= 300 (print the count in the assertion message); `instructions` still includes `kroger_status` and `text_kroger_sign_in`; the normal-mode text includes "signed in to Kroger" together with `kroger_status`; the setup paragraph tells the model not to call text_kroger_sign_in when the caller said skip or later for Kroger, and no longer asks for a second kroger_status before finish_onboarding.
    - agent/kroger.test.mjs, new describe 'finish_onboarding Kroger sentence' (use `build: { setupDue: true }` and a fresh memory dir if buildTools needs one — follow agent/onboarding.test.mjs `setup()`):
      * link texted this call (call text_kroger_sign_in first), status configured+relay, connected false -> say ends with exactly `KROGER_FINISH_LATER` (one occurrence), `complete` unchanged, ok true.
      * link texted, then status connected -> say ends with " Your Kroger account is connected." 
      * no link texted this call (caller said later), status not connected -> no Kroger sentence (kroger_later was already said).
      * status not configured, or relay false, or getKrogerStatus missing / throws / never resolves -> no Kroger sentence and setup still saved (`setupDone` true), finishing within the bound (`timeoutMs: 2000` guard is NOT tripped: a never-resolving status with timeoutMs 2000 returns ok within ~1 s).
      * the extra sentence never contains a link, state or phone (extend the existing privacy test or add an assertion).
    - relay.test.mjs: success page contains the new h1 and paragraphs below, does not contain "Kroger is connected", still no code/state in the body, headers unchanged.
    - kroger-relay-e2e.test.mjs: the existing test asserts the new page text instead of /Kroger is connected/; a NEW test "phone signs in after the starting process is gone; a second process picks it up": process A = `createKrogerSignIn({ env, fetchImpl, pollMs: 15, maxWaitMs: 60, unrefTimers: false })` starts and returns the link; wait for `A.waitForKrogerSignIn()` -> `timed_out` (A is "gone"; also call `A.cancel()`); the phone follows the link (302) and hits the callback with a code AFTER A stopped; process B = a NEW `createKrogerSignIn` with the same env/dir and NO start; `B.getKrogerStatus()` -> `{ ok: true, configured: true, relay: true, connected: true, pending: false }`; exactly one token exchange with the right code and redirect_uri; the token file holds the refresh token; `kroger-signin-pending.json` is gone; a direct claim for the state now gives 404. Use a separate throwaway dir from the first test.
  </behavior>
  <action>
    A) agent/prompt.mjs (per the product owner: "it should work during onboarding with the option to finish setting up later"):
    - `kroger` step says: "Next, your Kroger account, so I can fill your grocery cart. I'm texting you a sign-in link now. Tap it and sign in while we keep going, or if now isn't a good time, just ask me for a new Kroger link on any call."
    - `kroger_later` step says: "No problem, you can connect Kroger later. Just ask me to text you the Kroger link, and your cart will work once you've signed in."
    - Keep the step order. Rewrite setup item 7 and the closing sentence of `setupParagraph` to: "7. Kroger: call kroger_status. If it says connected, say its say sentence. If set_up is false, say nothing about Kroger. If the caller has already said to skip Kroger or do it later, do not text a link; say: "<kroger_later>". Otherwise, if it is not connected and can_text is true, say: "<kroger>" and call text_kroger_sign_in; if that fails, say its say sentence. If the caller then says later or skip, say: "<kroger_later>". Never read a link aloud." and "Then say: "<capabilities>" Then call finish_onboarding, say its say sentence, and then say: "<done>" Keep setup to about three minutes." (Remove the "call kroger_status once more before finish_onboarding" instruction and the "few more minutes" line: finish_onboarding now carries the Kroger reminder, which also saves a turn.)
    - Normal-mode cart paragraph: keep the existing sentence and add "Whenever the caller says they have signed in to Kroger, call kroger_status and say its say sentence." (A sign-in finished after the last call is picked up silently by the first Kroger tool call; nothing is spoken at call start.)
    - Export `export const KROGER_FINISH_LATER = "Kroger isn't connected yet; you can finish from the link I texted, or ask me for a new one on any call.";` from agent/tools.mjs (not prompt.mjs, it is a tool sentence) and use it in tests.
    B) agent/tools.mjs `finish_onboarding`: after the existing save succeeds and `setupActive = false`, compute the base result exactly as today, then (only if `typeof actions.getKrogerStatus === 'function'`) get the status raced against `Math.min(3000, Math.floor(timeoutMs / 2))` ms (try/catch, timeout -> no sentence). Append `' ' + KROGER_FINISH_LATER` when `krogerTextAt !== null && s.ok && s.configured && s.relay && !s.connected`; append `' Your Kroger account is connected.'` when `krogerTextAt !== null && s.ok && s.configured && s.connected`; otherwise nothing. Never let this path change `ok`/`complete` or fail the tool. Update the `finish_onboarding` description to mention it reports Kroger if a link was texted.
    C) agent/sim/onboarding-run.mjs: drop the second `kroger_status` step (the script no longer asks for it); keep the single text assertion; leave the fake's "connected after the link was made" so the run exercises the connected closing; adjust `callerAnswers` (remove 'I signed in'). Run it and record the printed `estimate=` seconds (must be < 240 and PASS) for the SUMMARY. Also do a one-off variant check (not committed): temporarily make the fake never connect, run, note that estimate too, then revert.
    D) kroger-relay/lib/relay.mjs callback success page lines: ["Thanks, you're signed in to Kroger.", "If you're still on your call, go back to it. If your call has ended, call your dietitian back within a few minutes to finish connecting.", "After ten minutes this sign-in is dropped, and you can ask for a new link on any call.", "You can close this page."]. Use typographic-safe text (apostrophes are fine; the page helper escapes nothing in these fixed lines, so keep them free of `<`, `>` and `&`). Do not change any other page, header or route. DO NOT deploy; the SUMMARY must say a redeploy (`vercel deploy --prod` from `kroger-relay/`, done by a person) is needed for the new page text.
    E) Tests per <behavior>.
  </action>
  <verify>
    <automated>cd /Users/ptrczx/Desktop/emoryHackathonDietary-merge && node --test agent/prompt.test.mjs agent/kroger.test.mjs agent/onboarding.test.mjs kroger-relay/lib/relay.test.mjs actions/kroger-relay-e2e.test.mjs && node agent/sim/onboarding-run.mjs | tail -2 && npm test 2>&1 | tail -8</automated>
  </verify>
  <done>Setup script wording, later handling and normal-mode rule are in the instructions and tested; total setup words <= 300 (report the number); finish_onboarding adds the fixed Kroger sentence only when a link was texted and Kroger is not connected (or the connected line), bounded and never failing; relay page is honest and tested; the second-process e2e passes; simulated estimate < 240 s PASS; `npm test` green.</done>
</task>

<task type="auto">
  <name>Task 3: Docs, final suite, clean worktree</name>
  <files>actions/README.md, agent/README.md, kroger-relay/README.md</files>
  <action>
    - actions/README.md, in the "### Kroger API cart" relay paragraph (around line 350, NOT the Shared contract): add that `startKrogerSignIn()` also writes `kroger-signin-pending.json` (state and start time only; mode 600 in the 700 token folder; atomic) in the token folder; that any later process resumes it on `getKrogerStatus()` and on the cart's no-sign-in path with one claim (capped at about 2.5 s; the cart waits at most 3 s), exchanges and saves, then deletes the record; that 404 keeps it, records older than 10 minutes (the relay's window) or rejected by Kroger are deleted; that the in-process poller still runs for 4 minutes and the record outlives it; that a second claim is a harmless 404, so there is never a double save; and that `pending` is true for an in-memory poll or a fresh record. Mention `resumeKrogerSignIn({ config })` as an internal export used by the cart. Note the unknown Kroger authorization-code lifetime: a late pick-up can be rejected, which deletes the record and the agent offers a new link.
    - agent/README.md: Onboarding section — update the Kroger part of "The script" bullet: the line now offers "or ask me for a new Kroger link on any call"; a caller who says skip/later gets the `kroger_later` line and no text; `finish_onboarding` appends the fixed reminder when a link was texted this call and Kroger is not connected; a sign-in finished after the call is picked up silently by the first Kroger tool call on the next call if that call starts within 10 minutes of the link (after that, ask for a new link). Tools table: update the `finish_onboarding` row purpose ("...and, if a Kroger link was texted this call, whether Kroger is connected"). Do not touch the Shared contract section.
    - kroger-relay/README.md: update the callback row to the new page text (short paraphrase plus "does not claim the sign-in is finished; the agent's Mac picks the code up on the current call or the next one within 10 minutes"), and add under "Verified / not verified" (or the deploy section) that this page text needs a redeploy by a person (`vercel deploy --prod` from `kroger-relay/`); the deployed relay still shows the old text until then.
    - Verify the three Shared contract sections are still byte-identical and untouched: `git diff --stat` must not show changes in renal/README.md, and the Shared contract blocks (from "## Shared contract" to the next "## Track") of the three READMEs must be identical.
    - Run `npm test` one last time; record pass/fail counts (expect > 615 passed, 0 failed) for the SUMMARY. Commit per task with conventional messages (e.g. `feat(quick-261114-onw): ...`), staging files by name. Remove the node_modules symlink; `git status --porcelain` must show only the SUMMARY.md.
  </action>
  <verify>
    <automated>cd /Users/ptrczx/Desktop/emoryHackathonDietary-merge && for f in agent actions renal; do awk '/^## Shared contract/{p=1} /^## Track/{p=0} p' $f/README.md | shasum; done | sort -u | wc -l | grep -qx ' *1' && git diff --quiet 84d383f -- renal/README.md && grep -c "kroger-signin-pending.json" actions/README.md && npm test 2>&1 | tail -8</automated>
  </verify>
  <done>Docs describe the pending record, the resume, "later" in setup and the 10-minute limit; Shared contract untouched and identical in all three READMEs; full suite green; worktree clean except SUMMARY.md; SUMMARY notes the needed relay redeploy, the setup word count and both simulated estimates.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| relay -> Mac | claim responses come from the public relay over HTTPS (authenticated with the shared secret) |
| disk -> process | the pending record is read back from the token folder by any later process |
| phone browser -> relay | the callback page is shown to the patient |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-onw-01 | Information disclosure | pending record | mitigate | Only `{state, startedAt}`; mode 600 file in a user-owned 700 folder outside the repo (shared `secureFolder` checks); atomic tmp+rename with `wx`; never logged or returned |
| T-onw-02 | Tampering | pending record load | mitigate | lstat: regular file only, never follow or delete symlinks; size cap 1024; state must match the 43-char regex; startedAt finite; invalid file removed |
| T-onw-03 | Denial of service | getKrogerStatus / cart on a live call | mitigate | resume single-flight, one claim per resume, 2 s request timeout, 2.5 s cap (cart 3 s, finish_onboarding min(3 s, timeoutMs/2)); unref'd timers; never throws |
| T-onw-04 | Tampering / replay | double claim and save | mitigate | in-process: resume skips a state the poller owns; cross-process: relay hands a code out once, second claim 404 is a no-op; remove({ifState}) never deletes a newer record |
| T-onw-05 | Information disclosure | claimed code / tokens | mitigate | code bounded to 2048 chars; exchanged locally only; existing leak test extended to resume paths |
| T-onw-06 | Spoofing | relay success page | accept | fixed text, no input reflected; page no longer over-promises |
| T-onw-SC | Tampering | package installs | accept | no new dependencies |
</threat_model>

<verification>
- `npm test` green (no .env.local, no network), > 615 passed.
- `node agent/sim/onboarding-run.mjs` PASS with estimate < 240 s.
- `grep -rn "few more minutes" agent/` returns nothing; `grep -n "Kroger is connected" kroger-relay/lib/relay.mjs` returns nothing.
- No change under renal/; Shared contract sections identical; nothing in ~/.config/renal-dietitian touched.
</verification>

<success_criteria>
- A sign-in finished after the call (within the relay's 10 minutes) is saved by the next process's first Kroger tool call, proven by the second-process e2e test.
- Setup offers "later" without an extra turn, sends no text when the caller already declined, and finishes with a short reminder when the texted link is not used yet.
- Relay page wording is honest; redeploy flagged for a person.
</success_criteria>

<output>
Create `.planning/quick/261114-onw-finish-kroger-sign-in-later-during-or-af/261114-onw-SUMMARY.md` (leave it uncommitted) with: what changed, test counts, setup word total, both simulated estimates (connected and not connected), the relay redeploy note (`vercel deploy --prod` from `kroger-relay/`, by a person), and the residual risk that Kroger's authorization-code lifetime is unknown so a late pick-up may be rejected (handled: record deleted, agent offers a new link).
</output>
