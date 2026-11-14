---
phase: quick-261114-onw
plan: 01
subsystem: kroger-signin
tags: [kroger, onboarding, relay]
requirements: [KROGER-LATER]
key-files:
  modified:
    - actions/kroger.mjs
    - actions/kroger-signin.mjs
    - actions/cart.mjs
    - agent/prompt.mjs
    - agent/tools.mjs
    - kroger-relay/lib/relay.mjs
completed: 2026-11-14
---

# Quick 261114-onw: Finish Kroger sign-in later

A pending relay sign-in is now persisted next to the token store, so a sign-in finished after the call (within the relay's 10-minute window) is claimed, exchanged and saved by the next process's first Kroger tool call.

## What changed
- `actions/kroger.mjs`: `createPendingSignInStore` (load/save/remove) with the token store's folder rules (`secureFolder` hoisted; token store behaviour unchanged).
- `actions/kroger-signin.mjs`: `startKrogerSignIn` writes `kroger-signin-pending.json` (`{state, startedAt}`, mode 600, folder 700, atomic); `resumePendingSignIn` / exported `resumeKrogerSignIn`; `getKrogerStatus` resumes first (shape unchanged).
- `actions/cart.mjs`: on `no_sign_in`, one bounded resume (3 s) then a second `getUserToken` before the same "Sign in to Kroger first" failure.
- `agent/prompt.mjs`, `agent/tools.mjs`: new `kroger` / `kroger_later` lines, later handling, normal-mode "signed in -> kroger_status" rule; `finish_onboarding` appends `KROGER_FINISH_LATER` or " Your Kroger account is connected." only when a link was texted this call (status wait capped at min(3 s, timeoutMs/2)).
- `kroger-relay/lib/relay.mjs`: honest success page.
- Docs: actions, agent, kroger-relay READMEs (track sections only).

## Resume rules
Runs on `getKrogerStatus()` and the cart's no-sign-in path; caller waits at most 2.5 s (cart 3 s, finish_onboarding min(3 s, timeoutMs/2)); one claim, 2 s request timeout; single-flight; work continues in the background after the cap.
- Kept: relay 404/5xx/network, relay 401/403, poller timed_out or cancelled, no relay config.
- Deleted: success, Kroger rejects the exchange, bad/over-long code, record older than 10 min or more than 60 s in the future, unparsable/invalid file.
- A symlink is never followed or deleted.

## Setup lines
- kroger: "Next, your Kroger account, so I can fill your grocery cart. I'm texting you a sign-in link now. Tap it and sign in while we keep going, or if now isn't a good time, just ask me for a new Kroger link on any call."
- kroger_later: "No problem, you can connect Kroger later. Just ask me to text you the Kroger link, and your cart will work once you've signed in."
- finish_onboarding: "Kroger isn't connected yet; you can finish from the link I texted, or ask me for a new one on any call." / " Your Kroger account is connected."

## Numbers
- `npm test`: 639 passed, 0 failed (baseline 615).
- Setup script words: 267 (limit 300).
- Simulated setup: 212 s when Kroger connects, 219 s when it never connects (both PASS, under 240 s).

## Relay page (needs redeploy)
New text: "Thanks, you're signed in to Kroger." / "If you're still on your call, go back to it. If your call has ended, call your dietitian back within a few minutes to finish connecting." / "After ten minutes this sign-in is dropped, and you can ask for a new link on any call." / "You can close this page." The deployed relay still shows the old text until a person runs `vercel deploy --prod` from `kroger-relay/`. NOT deployed.

## Tests
Second-process end-to-end (loopback relay, process A times out, phone signs in afterwards, process B `getKrogerStatus()` -> connected, one exchange, token saved, record gone, relay claim 404): PASS.

## Deviations from Plan
**1. [Rule 1] Two existing assertions updated.** In `kroger-signin.test.mjs`, 'relay_rejected' and 'timed_out' asserted `pending === false` afterwards. The plan's own rules keep the record in those cases and make `pending` true for a fresh record, so both now assert `true`. All other existing tests unchanged.
**2. Hung fetch guard.** `claimOnce` also races a timer (timeout + 500 ms) so a fetch that ignores its abort signal cannot hold the resume slot forever.
**3. Worktree base reset.** The worktree started on a different base than the expected one and was reset to aa1551a per the branch check.

## Residual risk
Kroger's authorization-code lifetime is unknown, so a late pick-up may be rejected (handled: record deleted, the agent offers a new link). Live behaviour on a call is untested (no real sign-in was performed).

## Self-Check: PASSED
Commits 966366e, 71f7a81, 65cf8bc exist; Shared contract sections identical across the three READMEs and unchanged from base; renal/ untouched.
