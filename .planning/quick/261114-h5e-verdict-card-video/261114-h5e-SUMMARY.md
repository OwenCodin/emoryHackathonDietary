---
status: complete
phase: quick-261114-h5e
plan: 01
---

# Quick 261114-h5e: RenaLine verdict card video

Replaced the smiley face with a RenaLine brand screen (voice wave) and verdict cards built from tool-result data. Branch build/card.

## Commits
- 4ae97bb feat(agent): card.mjs (SVG builders, text safety, wave, sharp renderer), card.test.mjs, preview-card.mjs
- 19b7af9 feat(agent): screen.mjs state machine and screen.test.mjs
- ce7144a feat(agent): display hook in tools.mjs (guardTool `display` option, `call.display`), agent.mjs wiring, new `display hook` tests in tools.test.mjs
- 4ccd74e docs(agent): README "Video out" section

## Results
- `npm test`: 401 tests, 401 pass, 0 fail.
- `git status --short -- . ':!.planning'`: empty.
- agent/video.mjs, agent/face.mjs, renal/, actions/, shared/ unchanged.

## Preview command and files
`node agent/sim/preview-card.mjs /private/tmp/claude-501/-Users-ptrczx-Desktop/8e5621c5-0903-4b6d-83e3-c59535bbc085/scratchpad/card-preview`
Wrote 01-idle, 02-idle-speaking, 03-yes-banana, 04-small-portion-long-name, 05-no, 06-cant-tell, 07-fridge-three, 08-unjudged, 09-online, 10-escaping (.png) in that folder. Refuses a path inside the repo (checked before mkdir and again with realpath).

## Timing
- One card render (sharp): about 14 ms (warm, average of 10).
- frame() per tick: about 0.21 ms (slice + wave paint).

## Look
- Colours: background #0F2430; white #FFFFFF; soft grey #CBD5E1; detail #E2E8F0; YES #4ADE80, SMALL PORTION #FBBF24, NO #F87171, CAN'T TELL #CBD5E1; wave teal (94,234,212) with a white shimmer dot.
- Font sizes: brand wordmark 128, tagline 56, footer 36; card wordmark 44; single verdict 150 down to 110 (fitted; SMALL PORTION lands near 115), food 72 down to 60, detail lines 44; multi rows verdict 64, food 56 down to 44, "+N more" 44; unjudged 88 / 52 / 44; "Found online" 32.
- Font-size note: "110 px tall" was read as font size (em box) >= 110, not cap height, since a 110 px cap height cannot fit SMALL PORTION on one line.

## Call path (tool result to pixels)
look_at_camera / check_food set `call.display` from renal result fields (displayItem) -> guardTool, after fit(), checks not timed out, `ok === true` and verdict data still present -> `display(call.display)` (= buildTools `onDisplay`) -> agent.mjs `screen.show(display)` -> cardSvg -> renderSvg (sharp, background, 3 s timeout, latest wins) -> stored as card base for 15 s -> each tick `drawOwnPicture` = `screen.frame(tick++, speaking)` copies the base, paintWave, returns Uint8Array -> createVideoPicker (cart frame still wins) -> VideoFrame -> VideoSource.

## Existing tests edited
None. tools.test.mjs only had a new describe block appended.

## Deviations
None of substance. Minor: icon ids are `icon-<verdict>` for the first icon and `icon-<verdict>-N` on later rows, to keep ids unique in one SVG. `idleFailed` state is tracked but the fallback is chosen simply by "no idle base".

## Residual limitations
- Readability on a real phone and a live call are untested; preview PNGs not visually reviewed by me.
- Fonts depend on what librsvg finds on the host (Helvetica Neue / Helvetica / Arial / sans-serif); a Linux host without them falls back to a default sans.
- Text width is an estimate, so very wide names are cut with an ellipsis earlier than strictly needed.
- If a newer card render fails after an older one is in flight, the older card is dropped (latest-wins by sequence).
- No emoji or pictograph in food names is drawn.
