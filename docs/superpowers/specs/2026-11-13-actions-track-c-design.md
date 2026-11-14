# Track C: Actions Design

## Goal

Implement Track C for the renal-dietitian demo: a cart visible on the FaceTime
call, patient messages, optional outbound calls, and demo story materials. The
work stays on a local branch and is not pushed to GitHub.

## Repository baseline and ownership

The local checkout was two commits behind GitHub `main` and contained only the
initial README. Work starts from the fetched `origin/main`, which contains the
planning document and the `agent/`, `renal/`, and `actions/` track READMEs.

Track C owns `actions/`. Add only the minimum shared root files needed to run
and test Track C: `package.json`, `.env.example`, `.gitignore`, and
`shared/video.mjs`. Do not modify `agent/` or `renal/`; their implementation
and the complete root `start` command remain outside this scope. Preserve the
shared function contracts in all three track READMEs.

## Components

- `actions/index.mjs` exports the six contracted functions.
- `actions/cart.mjs` manages one persistent Playwright cart session, including
  status, stop, and background execution.
- `actions/frames.mjs` returns the latest browser screenshot as exactly
  `WIDTH * HEIGHT * 4` RGBA bytes while a cart is active.
- `actions/login.mjs` opens the persistent browser profile so the user can
  sign in to a grocery site directly. The model never handles passwords.
- `actions/text.mjs` sends Chert shared-line messages.
- `actions/outbound.mjs` dispatches the LiveKit agent and requests an outbound
  Chert call, following the documented bridge flow.
- `actions/checkin.mjs` provides an explicit CLI trigger for a configured
  mealtime check-in.
- `actions/demo/` contains a storyboard and generation prompts, not generated
  footage or recordings.

Use the Gemini computer-use loop through Playwright for the cart. Evaluate
Walmart, Kroger, Instacart, and Amazon Fresh for accessibility, and record the
most reliable site in `actions/README.md`. Store authentication stays in the
ignored persistent browser profile and is performed by the user. If direct
store automation is blocked, support the documented Instacart product-list
link when its API key is configured; show that page in the same browser.
Restrict browser navigation to HTTPS on those supported retailer domains and
enable Gemini's prompt-injection check. Treat page content as untrusted.
Screenshots are sent to Gemini for action selection but are not persisted or
logged.

## Cart behavior and safety

`startCart({ items })` returns immediately and refuses a second active cart.
The browser loop works on one item at a time, prefers low-sodium/unsalted
options, and updates status with the model's current intent. Respect model
`require_confirmation` by entering `waiting_for_patient` without executing
that action.

Enforce these limits in code, not just in the model prompt:

- Never proceed to checkout or payment. If navigation or a click reaches a
  checkout/payment URL, return to the previous page and pause in
  `waiting_for_patient`.
- Stop after four minutes or 60 browser actions with a clear failed status.
- When all requested items are added or reported missing, set `done` with the
  cart URL and total.
- Close the browser context on stop and on completion so the persistent
  profile can be reopened.

All cross-track functions use the documented result shapes, return explicit
`{ ok: false, error }` values rather than throwing, and keep the fast-start
functions non-blocking. `getCartFrame()` is synchronous and returns `null`
when no cart is active.

## Messaging and outbound calls

`sendText({ phone, text })` calls Chert's shared-message API with the project,
line, and a unique idempotency key. Restrict recipients to the configured
verified `PATIENT_PHONE`. If a send result is unknown, inspect its existing
state; never send again with a new key. Document the trial's inbound-message
eligibility and rate limits.

`callPatient({ phone, reason })` restricts the recipient to the same configured
verified patient number. It creates a LiveKit room, dispatches the configured
agent, waits for published audio, mints a short-lived bridge token, requests
the Chert call, and signals bridge readiness. It cleans up rooms on terminal
failure or timeout. Return explicit errors when credentials or outbound-call
capability are unavailable; do not silently substitute a text. The check-in
CLI is manually invoked and does not schedule or initiate calls by itself.

Real messages and calls require the user's local `.env.local` values and are
never part of automated tests. No credentials are requested or printed.

## Configuration and privacy

Keep the README's pinned dependency versions and Node engine range. `.env.example`
contains variable names only. `.env.local`, all `.env.*` except
`.env.example`, `node_modules/`, logs, `.DS_Store`, and
`actions/.browser-profile/` are ignored. Required credentials include the
LiveKit, Chert, Google, and optional Instacart API values listed in the track
README. Never inspect, print, commit, or send secret values.

## Validation

Use `node:test` and mocks for the browser, model, LiveKit, and Chert clients.
Cover exported return shapes, busy behavior, frame byte length, confirmation
pauses, checkout/payment blocking, time and action caps, cleanup, recipient
validation, idempotency, and error paths. Run tests without keys or live
services. Do not sign in to a store, run `chert dev`, place orders, send
messages, or place calls during implementation or validation. Real store
accessibility and media calls require a later user-run manual check.
