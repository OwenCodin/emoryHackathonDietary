# Track C Actions Implementation Plan

## Goal

Implement Track C from the approved design on local branch `actions-track-c`.
Do not push. Do not edit `agent/` or `renal/`. Do not use real credentials,
log into stores, send texts, place calls, or order anything during development
or tests.

## 1. Establish the shared runtime

- Add the README-pinned root `package.json` dependencies and Node engine range.
- Add the `test` script; do not add a broken `start` script while
  `agent/agent.mjs` is absent.
- Add `shared/video.mjs` with the exact 1280x720x15 contract.
- Add `.env.example` with names only and `.gitignore` rules for secrets,
  dependencies, logs, and `actions/.browser-profile/`.
- Verify ignored paths and clean diff; install dependencies only after the
  manifest exists.

## 2. Implement browser profile and frame output

- Add `actions/login.mjs` to launch a visible persistent Playwright context and
  allow the user to sign in directly.
- Add screenshot capture and conversion in `actions/frames.mjs`, returning
  only an exact-size RGBA `Uint8Array` while the cart is active.
- Add tests for frame shape, no-active-cart behavior, and cleanup.

## 3. Implement safe cart lifecycle

- Add cart state and `startCart`, `getCartStatus`, and `stopCart`.
- Keep startup non-blocking, enforce one active cart, update status from model
  intent, and return documented success/error shapes.
- Implement the Gemini computer-use loop through an injectable client and
  Playwright. Handle all documented action kinds and return screenshots and
  interaction IDs as required. Enable prompt-injection detection and restrict
  navigation to HTTPS on the supported grocery domains.
- Enforce `require_confirmation`, checkout/payment URL blocking, four-minute
  and 60-action limits, missing-item reporting, and browser cleanup.
- Add mocked tests for action translation, confirmations, safety guards,
  caps, busy behavior, state transitions, and error cleanup.

## 4. Implement Chert messaging

- Add `sendText` with environment validation, exact configured-recipient
  matching, unique idempotency keys, and Chert response parsing.
- On an ambiguous send, read the existing message state; never retry with a
  new key.
- Test successful, denied, ambiguous, and transport-error cases with mocked
  fetch only.

## 5. Implement outbound call and check-in

- Add `callPatient` with recipient/configuration validation, LiveKit room
  creation and agent dispatch, bounded participant polling, bridge-token
  creation, Chert call request, bridge-ready metadata, and cleanup.
- Keep orchestration bounded and return only when accepted or on explicit
  failure; use idempotency keys for call creation and cleanup.
- Add the explicit `actions/checkin.mjs` CLI trigger, which never runs
  automatically.
- Test mocked API and LiveKit success/failure/timeout paths; do not call Chert
  or use FaceTime minutes.

## 6. Add docs and contract verification

- Export the six functions through `actions/index.mjs`.
- Update `actions/README.md` only where needed to record tested store choice,
  credential setup, safety behavior, and known external limitations.
- Add a storyboard and Higgsfield prompt text under `actions/demo/`; do not
  generate or record footage.
- Run the full local test script and inspect `git diff --check`, branch state,
  ignored paths, and changed-file boundaries.
