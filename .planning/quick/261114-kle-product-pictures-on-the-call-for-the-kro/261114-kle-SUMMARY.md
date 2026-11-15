---
phase: quick-261114-kle
plan: 01
subsystem: actions (Track C)
tags: [kroger, cart, video, sharp]
key-files:
  created: [actions/cart-card.mjs, actions/cart-card.test.mjs]
  modified: [actions/kroger.mjs, actions/kroger.test.mjs, actions/frames.mjs, actions/frames.test.mjs, actions/cart.mjs, actions/cart.test.mjs, actions/README.md]
metrics:
  completed: 2026-11-14
---

# Quick 261114-kle: Product pictures on the call for the Kroger API cart

The Kroger API cart now draws a 1280x720 cart card (photos, names, line prices, running total, safety footer) after each add and offers it through `getCartFrame`; nothing under `agent/` or `renal/` changed.

## Commits

- a34e594 feat: card renderer, `pickImageUrl`, `isKrogerImageUrl`, guarded `downloadPicture`
- 8dbeb03 feat: `setCartFrame`, publish / hold / clear wiring in `cart.mjs`
- 5484469 fix: name no longer overlaps the price; one row centred (found in the live render)
- 10509a8 docs: README "### Kroger API cart"

## Results

- `npm test`: 464 pass, 0 fail (base was 443), no `.env.local`, no network.
- Hold: the final card stays 20 s (`CARD_HOLD_MS`, unref'd timer), then `activateFrame(false)` returns the agent's picture. `stopCart` and a new `startCart` remove it at once and clear the timer. Nothing added means no card.
- Time added to a run: the picture download starts before the add and overlaps it. Each render took about 100 ms live; one render per add plus one at the end. A picture is capped at 3 s, so the worst case is about 3 s per item (a slow or missing picture), normally under 0.3 s.

## Live read-only check (14 Nov 2026)

PNG: `/private/tmp/claude-501/-Users-ptrczx-Desktop/49d7789a-b64c-470b-9826-f7eda7d76f05/scratchpad/kle/cart-card-live.png`

Choices (token + product search + picture download only; no sign-in, no cart call):
- unsalted butter: Kroger Unsalted Butter Sticks, $3.59, 51,742 byte picture (x1)
- white rice: Kroger Enriched Long Grain White Rice, $1.89, 24,839 byte picture (x1)
- apples: Kroger Honeycrisp Apples 4 Pack Tray, $5.00, 35,184 byte picture (x3, $15.00)

Picture downloads took 128 to 288 ms; render 93 to 119 ms. The PNG shows three tiles in one row, centred, with photos on white, two-line names, prices ("$15.00 · x3" on the apples), "Total $20.48" and the footer. The first render had the second name line overlapping the price; fixed (photo box 120 high) and re-rendered, now clean. Remaining cosmetic points: the rice photo is small because the source image is mostly white space; the "®" in Kroger® is dropped by the text cleaner (same as `agent/card.mjs`).

## Deviations

- [Rule 1 - layout] Name/price overlap and top-heavy single row found in the live render; fixed in 5484469 (photo height 140 to 120, single row centred).
- Worktree started on a different base (merge-base mismatch); hard-reset to 39c128d as the branch check instructs.
- `node --test actions/` as a directory fails on this Node version; `npm test` (which lists files) is the verified run.

## Not verified

The card on a live Chert call; the 7+ item "+N more" tile was tested only as SVG text and exact frame size, not looked at as a PNG.

## Self-Check: PASSED

Files and commits above exist; `git diff 39c128d HEAD` touches only the nine planned files; Shared contract unchanged; nothing under `agent/` or `renal/`.
