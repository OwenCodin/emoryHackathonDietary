---
phase: quick-261114-lep
plan: 01
subsystem: video
tags: [safe-area, facetime, sharp, svg]
key-files:
  modified: [shared/video.mjs, agent/card.mjs, agent/face.mjs, actions/cart-card.mjs, actions/frames.mjs, .env.example, agent/README.md, actions/README.md, renal/README.md]
  created: [shared/video.test.mjs]
decisions:
  - "Default safe scale 0.8 (rect x128 y72 1024x576), VIDEO_SAFE_SCALE read once at import, clamped 0.5-1, invalid means 0.8"
metrics:
  completed: 2026-11-14
---

# Phase quick-261114-lep Plan 01: Call video safe area Summary

Everything the agent sends on the call (brand screen, verdict cards, voice wave, drawn face, Kroger cart card, browser cart frame) is drawn inside a centred safe area from `shared/video.mjs` (80% by default, `VIDEO_SAFE_SCALE`), with backgrounds still filling the full 1280x720 frame.

## Commits
- a566c56 fix(video): agent screens, wave and drawn face in the safe area, plus shared/video.mjs
- 016263f fix(actions): cart card and browser frame in the safe area
- 6b6c9dc docs(video): VIDEO_SAFE_SCALE, .env.example, three READMEs

`npm test`: 505 pass, 0 fail (484 before, 21 new), no `.env.local`.

## Deliberate size changes (cart card, design space)
Product names 24 to 26 px (line spacing 26 to 28), step line fit 28/20 to 30/24, footer 30 to 32. Nothing else changed.

## Visual check (PNGs in /private/tmp/claude-501/-Users-ptrczx-Desktop/49d7789a-b64c-470b-9826-f7eda7d76f05/scratchpad/lep/, all looked at)
At 0.8, in every picture nothing touches the outer 10%; all content is centred in the safe rectangle.
- agent/01-idle, 02-idle-speaking: wordmark, tagline, wave/flat line with marker and footer centred; fine.
- agent/03 to 10 (YES, SMALL PORTION long name truncated with ellipsis, NO, CAN'T TELL, three rows + more, unjudged, online, escaping): no overlaps; the online tag clears the wordmark. Left-aligned text starts at x about 177 and the tag ends at x about 1105, so content is symmetric. The portion line and "+2 more" row sit fairly close above the wave (about 20 px gap) but do not overlap (spacing is unchanged from before the inset).
- cart-3.png, cart-7.png (fixture pictures, not real Kroger photos): no overlap between names and prices; names two lines at 26 px. In the 7-item card the step line is tight against the first tile row and the footer is tight under the second row (a few px of gap), no overlap. Photos sit in their tiles at the scaled positions (white photo boxes show a faint square corner against the rounded tile, as before).
- face.png: face centred, accent bar inside the safe area.
- browser-frame.png: fixture screenshot fitted into the safe rect on white; full-frame white border around it.
I have not seen any of this on a live call or a phone; legibility on a phone is unverified.

## Deviations from Plan
- The base was wrong at start (merge-base 23d4399); reset to 1f20cb7 per the branch check.
- Test note: in the face test, frame-for-frame equality with `drawFace` is asserted only for non-speaking frames. Speaking frames in `createFaceFrames` use a quantised mouth and never matched `drawFace` exactly (pre-existing behaviour); the margin check still runs on both.
- No source fix was needed after the visual check.

## Known Stubs
None.

## Self-Check: PASSED
