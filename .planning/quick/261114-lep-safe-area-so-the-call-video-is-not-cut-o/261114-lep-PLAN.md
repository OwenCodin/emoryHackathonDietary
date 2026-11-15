---
phase: quick-261114-lep
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - shared/video.mjs
  - shared/video.test.mjs
  - agent/card.mjs
  - agent/card.test.mjs
  - agent/face.mjs
  - agent/video.test.mjs
  - actions/cart-card.mjs
  - actions/cart-card.test.mjs
  - actions/frames.mjs
  - actions/frames.test.mjs
  - .env.example
  - agent/README.md
  - actions/README.md
  - renal/README.md
autonomous: true
requirements: [QUICK-261114-lep]

must_haves:
  truths:
    - "With the default scale (0.8), every picture the agent sends on the call (brand screen, verdict cards, voice wave, drawn fallback face, Kroger cart card, browser cart frame) has only background-coloured pixels in the outer 9% of the frame on all four sides"
    - "The background colour still fills the whole 1280x720 frame; only content is inset"
    - "VIDEO_SAFE_SCALE tunes the safe area between test calls without a code change: read once, clamped to 0.5-1.0, empty or invalid means 0.8, and 1 gives the old full-frame layout"
    - "Frame size, FPS, the getCartFrame contract (exactly WIDTH*HEIGHT*4 RGBA bytes) and all tool behaviour are unchanged"
    - "npm test passes without a .env.local (484 before this task, plus the new tests)"
  artifacts:
    - path: "shared/video.mjs"
      provides: "WIDTH, HEIGHT, FPS unchanged plus SAFE_SCALE_DEFAULT, safeScaleFrom, SAFE_SCALE, safeArea, SAFE, safeTransform"
      contains: "VIDEO_SAFE_SCALE"
    - path: "shared/video.test.mjs"
      provides: "env parsing, clamping and read-once tests"
    - path: "agent/card.mjs"
      provides: "SVG content in a safe-area group; paintWave mapped to the safe area; waveBand helper"
      contains: "safeTransform"
    - path: "agent/face.mjs"
      provides: "drawn face and moving bar mapped into the safe area"
    - path: "actions/cart-card.mjs"
      provides: "cart card content in a safe-area group, photos composited at mapped positions"
      contains: "safeTransform"
    - path: "actions/frames.mjs"
      provides: "browser screenshot fitted into the safe rectangle on white"
  key_links:
    - from: "agent/card.mjs, agent/face.mjs, actions/cart-card.mjs, actions/frames.mjs"
      to: "shared/video.mjs"
      via: "import { SAFE_SCALE, safeArea, safeTransform }"
      pattern: "from '\\.\\./shared/video\\.mjs'"
    - from: "actions/cart-card.mjs renderCartCard"
      to: "cardLayout photo boxes"
      via: "photo composites resized and offset by the same scale as the SVG group"
      pattern: "safeArea"
---

<objective>
Keep everything the agent shows on the FaceTime call inside a centred safe area, so the caller's phone, which shows the agent's video zoomed (aspect-fill), no longer cuts content off on all four edges. A caller reported this after a live call at 15:17 on 14 Nov 2026 that showed the Kroger cart card.

Purpose: the exact crop differs by phone and orientation, so the fix is a conservative, tunable inset (default 80% of width and height, 10% margin per side). It is applied once at layout/render time, never by resizing frames at 15 fps.
Output: one safe-area definition in shared/video.mjs, applied in the agent screens, the drawn face, the Kroger cart card and the browser cart frame; tests; a PNG visual check outside the repo; docs and `.env.example`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@shared/video.mjs
@agent/card.mjs
@agent/face.mjs
@actions/cart-card.mjs
@actions/frames.mjs

## Executor environment (read before doing anything)

- You run in an isolated git worktree with no `.env.local` and no `node_modules`. First: `ln -s /Users/ptrczx/Desktop/emoryHackathonDietary-merge/node_modules node_modules` in the worktree root. NEVER commit it. Stage files by name only; never `git add -A` or `git add .`.
- Run tests with `npm test` (it uses `--env-file-if-exists=.env.local`, so with no `.env.local` no keys are loaded). Baseline: 484 pass.
- Hard rules: do not start, stop or signal any running `npm start`, `chert` or `facetime` process (a live Chert session runs from the main checkout). No Kroger sign-in or cart calls, no texts. Do not push.
- If (optionally) a live read-only Kroger check is used for the cart card pictures: `node --env-file=/Users/ptrczx/Desktop/emoryHackathonDietary-merge/.env.local ...`, app token + product search + picture download only; never print key values.
- Before finishing: `rm node_modules` (the symlink only) so the worktree is clean apart from the uncommitted SUMMARY.md.
- Tracks do not import each other's code: `agent/` and `actions/` may both import `shared/video.mjs`, never each other. Test helpers (e.g. a border-band check) are written inline in each test file.

## Facts the executor needs

- Frames are RGBA 1280x720 at 15 fps. Current content sits within about 60 px of the left/right edges and 30-60 px of the top/bottom (agent card wordmark x=60, footer y=645; cart card title x=60 y=78, total right edge x=1220, footer y=692; face accent bar at y 676-696 across the full width).
- Background colours: agent card and cart card `#0F2430` = (15,36,48); drawn face BACKGROUND = (16,40,52); browser cart frames white (255,255,255).
- `actions/cart.mjs` uses WIDTH/HEIGHT for the Playwright viewport and for mapping Gemini's 0-999 coordinates (`toViewport`). Gemini receives raw `page.screenshot()` PNGs, not `captureCartFrame` output. Do NOT touch `actions/cart.mjs`: insetting only the call frame keeps click coordinates correct.
- `agent/sim/fake-cart.mjs` (magenta test frame, only with AGENT_FAKE_CART=1 for the simulated proof) is intentionally left full-frame.
- `agent/screen.mjs` calls `brandSvg()`, `cardSvg(display)`, `paintWave(pixels, tick, speaking)`; `agent/agent.mjs` uses `createScreen()`; `actions/cart.mjs` calls `renderCartCard({ storeName, items, step, total })` and `captureCartFrame(page)`. All existing call sites must keep working unchanged (new parameters are optional and default to `SAFE_SCALE`).
- `agent/sim/preview-card.mjs <outDir outside repo>` already renders the idle screen (with wave) and 8 sample verdict cards to PNG; it refuses folders inside the repo.
- `agent/screen.test.mjs` probes pixel (0,0) with fake renders; it is unaffected. `agent/contract.test.mjs` pins only WIDTH/HEIGHT/FPS; adding exports does not break it.

<interfaces>
New exports in shared/video.mjs (Task 1 creates them; Tasks 1-2 consume them):

- `SAFE_SCALE_DEFAULT = 0.8`
- `safeScaleFrom(env)` -> number. Reads `env?.VIDEO_SAFE_SCALE`. Missing, not a string or number, an empty/whitespace-only string, or a value whose `Number()` is not finite -> `SAFE_SCALE_DEFAULT`. Otherwise clamp to [0.5, 1]. (Guard the empty string explicitly: `Number('')` is 0 and must NOT clamp to 0.5.)
- `SAFE_SCALE = safeScaleFrom(globalThis.process?.env)`, read once at import.
- `safeArea(scale = SAFE_SCALE)` -> frozen `{ x, y, width, height, scale }` with `x = Math.round(WIDTH * (1 - scale) / 2)`, `y = Math.round(HEIGHT * (1 - scale) / 2)`, `width = WIDTH - 2 * x`, `height = HEIGHT - 2 * y`. At 0.8: `{ x: 128, y: 72, width: 1024, height: 576, scale: 0.8 }`. At 1: `{ x: 0, y: 0, width: 1280, height: 720, scale: 1 }`.
- `SAFE = safeArea(SAFE_SCALE)`.
- `safeTransform(scale = SAFE_SCALE)` -> the SVG transform string `translate(${x} ${y}) scale(${scale})` using `safeArea(scale)`'s x and y. It maps a point (px, py) of the full 1280x720 design to (x + px*scale, y + py*scale), a uniform scale about the frame centre.

Mapping rule used everywhere (design space = today's full-frame coordinates): frame = safe.x/y + design * scale; inverse: design = (frame - safe.x/y) / scale.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Shared safe area and the agent's pictures (verdict card, brand screen, voice wave, drawn face)</name>
  <files>shared/video.mjs, shared/video.test.mjs, agent/card.mjs, agent/card.test.mjs, agent/face.mjs, agent/video.test.mjs</files>
  <behavior>
    - safeScaleFrom: unset/{} -> 0.8; '' and '   ' -> 0.8; 'abc', 'NaN', 'Infinity' -> 0.8; '1' -> 1; '0.7' -> 0.7; ' 0.9 ' -> 0.9; '0.2' -> 0.5; '0' -> 0.5; '3' -> 1; '-1' -> 0.5; the number 0.75 -> 0.75.
    - safeArea(0.8) deep-equals {x:128, y:72, width:1024, height:576, scale:0.8}; safeArea(1) is the full frame; safeTransform(1) is 'translate(0 0) scale(1)'.
    - Read once at import: a child process (spawnSync(process.execPath, ['--input-type=module', '-e', <import shared/video.mjs by absolute file URL and print JSON of SAFE_SCALE and SAFE>], { env: { ...process.env, VIDEO_SAFE_SCALE: v } })) prints scale 1 for '1', 0.8 for 'abc', 0.5 for '0.2'; WIDTH/HEIGHT/FPS unchanged.
    - At scale 0.8 (pass the scale explicitly so a developer's .env.local cannot change the test): rendered brandSvg and cardSvg for each verdict (ok, limit, avoid, unknown), a 4-item multi card, an unjudged card and an online card have only (15,36,48,255) pixels in the outer bands (left/right floor(0.09*WIDTH) = 115 columns, top/bottom floor(0.09*HEIGHT) = 64 rows) and at least one non-background pixel inside the safe rect; each is exactly WIDTH*HEIGHT*4 bytes.
    - paintWave at scale 0.8 on a buffer filled with 7, for ticks 0..60 both speaking and not speaking: no byte outside the safe rect changes, and every changed row lies inside waveBand(0.8).top..bottom. The existing "paints only inside the band and moves" test is kept and updated deliberately to use waveBand(SAFE_SCALE_DEFAULT) rows; a scale-1 case asserts waveBand(1) deep-equals {top:505, bottom:585, left:135, right:1145} (the old WAVE band and WAVE_LEFT..WAVE_LEFT+WAVE_SPAN).
    - Scale 1 reproduces the old layout: brandSvg({scale:1}) and cardSvg(display, {scale:1}) contain 'scale(1)', and a rendered scale-1 single verdict card has non-background pixels in the left 115-column band (the wordmark at x=60).
    - Drawn face at scale 0.8: drawFace(t, s, 0.8) and createFaceFrames({ scale: 0.8 }).frame(t, s) for several ticks (including ticks where the accent bar is near both ends of its travel) have only (16,40,52,255) in the outer 9% bands and face pixels inside; createFaceFrames still matches drawFace frame-for-frame at the same scale and still renders only at creation. At scale 1 the accent bar appears in rows 676-696 as before.
  </behavior>
  <action>
    1) shared/video.mjs: keep WIDTH, HEIGHT, FPS and the header comment. Add the exports listed in the interfaces block (SAFE_SCALE_DEFAULT, safeScaleFrom, SAFE_SCALE, safeArea, SAFE, safeTransform) with a one-line comment: FaceTime shows the video zoomed on the caller's phone, so content is drawn inside the centred safe area and backgrounds still fill the whole frame. No new dependency. Create shared/video.test.mjs with the env/area/transform tests and the child-process read-once test (node:test, node:assert/strict, node:child_process, node:url; no network).

    2) agent/card.mjs: import SAFE_SCALE, safeArea, safeTransform. Change `brandSvg()` to `brandSvg({ scale = SAFE_SCALE } = {})` and `cardSvg(display)` to `cardSvg(display, { scale = SAFE_SCALE } = {})`; when cardSvg falls back to brandSvg it passes the same scale. Restructure the SVG so the full-frame background rect stays a direct child of the svg (outside the group). ALL other content (wordmark, online tag, icons, text, footer) goes inside one `<g transform="${safeTransform(scale)}">...</g>` closed before `</svg>`. Keep all existing design-space coordinates and font sizes: the smallest line is the 36 px footer, 28.8 px effective at 0.8, which stays legible, so there is no font bump here. Keep the WAVE export unchanged (design space). Add an exported `waveBand(scale = SAFE_SCALE)` returning the wave band in frame pixels: top = Math.floor(a.y + WAVE.top*scale), bottom = Math.ceil(a.y + WAVE.bottom*scale), left = Math.floor(a.x + WAVE_LEFT*scale), right = Math.ceil(a.x + (WAVE_LEFT + WAVE_SPAN)*scale), where a = safeArea(scale). Change `paintWave(pixels, tick, speaking)` to `paintWave(pixels, tick, speaking, scale = SAFE_SCALE)`. Compute bar rectangles exactly as now in design space, then have fillRect map each rectangle's corners to frame space (a.x + x*scale, a.y + y*scale) before rounding, and clamp rows to waveBand(scale).top..bottom and columns to 0..WIDTH. It still mutates in place, only inside the band. Per-tick cost stays the same (no resize).

    3) agent/face.mjs: map the face into the safe area by inverse mapping, keeping the existing geometry (SCALE = HEIGHT/360, cx, cy, radius, eyes, mouth, bar) in design space. `renderFace({ blink, mouth, bar, scale = SAFE_SCALE })`: for each frame pixel compute design coords dx = (x - a.x)/scale, dy = (y - a.y)/scale. If (dx, dy) is outside [0, WIDTH) x [0, HEIGHT) the pixel is BACKGROUND; otherwise run the existing tests on (dx, dy). `drawFace(tick, speaking, scale = SAFE_SCALE)` passes scale through. `createFaceFrames({ render = renderFace, scale = SAFE_SCALE } = {})` passes scale to every render call and paints the moving accent bar per tick with the same inverse mapping. Only loop over the frame rows/columns covering the mapped bar rect, so the per-tick cost stays small. Keep `barAt` in design space. Update the file header comment to say content is drawn inside the shared safe area.

    4) Tests: add the cases in <behavior> to agent/card.test.mjs and agent/video.test.mjs with an inline border-band helper (outer floor(0.09*WIDTH) columns on left and right, floor(0.09*HEIGHT) rows on top and bottom, every pixel equal to the given RGBA). Update the existing wave-band test deliberately (do not delete it). Pass scales explicitly (SAFE_SCALE_DEFAULT or 1) in the new tests.

    Run `npm test`; all tests must pass. Commit by name: `git add shared/video.mjs shared/video.test.mjs agent/card.mjs agent/card.test.mjs agent/face.mjs agent/video.test.mjs` with message `fix(video): keep the agent's screens inside a safe area FaceTime does not crop (quick-261114-lep)`.
  </action>
  <verify>
    <automated>node --test shared/video.test.mjs agent/card.test.mjs agent/video.test.mjs agent/screen.test.mjs agent/contract.test.mjs && npm test 2>&1 | grep -E "^# (pass|fail)"</automated>
  </verify>
  <done>All listed tests pass; npm test shows fail 0. Brand screen, verdict cards, wave and drawn face keep the outer 9% bands background-only at 0.8 and reproduce the old positions at 1. Existing call sites in agent/screen.mjs and agent/sim/preview-card.mjs are unchanged and working.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Kroger cart card and browser cart frame inside the safe area</name>
  <files>actions/cart-card.mjs, actions/cart-card.test.mjs, actions/frames.mjs, actions/frames.test.mjs</files>
  <behavior>
    - renderCartCard with 1, 3 and 7 items (fixture pictures from sharp `create`, e.g. solid #336699 PNGs) at scale 0.8: exactly WIDTH*HEIGHT*4 bytes, offset 0, own buffer (existing assertExact); the outer 9% bands on all four sides are only (15,36,48,255); there are non-background pixels inside the safe rect; the fixture photo colour (51,102,153) appears at the mapped centre of the first tile's photo box (a.x + (photo.x + photo.w/2)*0.8, a.y + (photo.y + photo.h/2)*0.8), which proves photos are composited at the scaled positions, not the old ones.
    - Scale 1: cartCardSvg({ ..., scale: 1 }) contains 'scale(1)' and a rendered 3-item scale-1 card has non-background pixels in the left 115-column band (title at x=60).
    - Existing tests (escaping, 5 tiles + "+2 more", total, quantity, footer text, no NaN, passed total) keep passing unchanged.
    - captureCartFrame with a fake page whose screenshot is a 12x9 #123456 PNG (existing test) and with a 1280x720 #123456 PNG: the frame is exactly WIDTH*HEIGHT*4 bytes; the outer 9% bands are all (255,255,255,255); the frame centre pixel is (18,52,86,255). getCartFrame/setCartFrame/setCartFrameActive behaviour is unchanged.
  </behavior>
  <action>
    1) actions/cart-card.mjs: import SAFE_SCALE, safeArea, safeTransform from ../shared/video.mjs. Add an optional `scale = SAFE_SCALE` to `cartCardSvg({ storeName, items, step, total, scale })` and `renderCartCard({ storeName, items, step, total, scale })`. actions/cart.mjs keeps calling without it (do not edit actions/cart.mjs). Keep the full-frame BACKGROUND rect a direct child of the svg and wrap everything else (title, total, step line, tiles, "+N more" tile, footer) in one `<g transform="${safeTransform(scale)}">...</g>`. `cardLayout` stays in design space (its tests rely on it). In renderCartCard map each photo box to frame space with a = safeArea(scale): left = Math.round(a.x + photo.x*scale), top = Math.round(a.y + photo.y*scale), w = Math.round(photo.w*scale), h = Math.round(photo.h*scale). Pass {w, h} to preparePhoto (resize contain on white, as now) and composite at {left, top}.
    Legibility at 0.8 (rule: no line below about 20 px effective in the 1280x720 frame): the only lines that fall below are the tile product names (24 px -> 19.2) and the step line minimum (20 -> 16). Bump them in design space. Introduce `const NAME_SIZE = 26`, used by nameLines (all textWidth/fitText calls there) and tileSvg, with name line spacing 28 instead of 26. The first baseline stays at photo bottom + 30, and the second line ends about y+198, clear of the price baseline at tile bottom - 14. Set the step text fitText to `{ max: 30, min: 24, width: 1160 }` and the footer from 30 to 32 (it still fits 1160 px). Leave other sizes. These are the only deliberate size changes; record them in the SUMMARY.

    2) actions/frames.mjs: in captureCartFrame, with a = safeArea(SAFE_SCALE), resize the screenshot to (a.width, a.height) with `fit: 'contain', background: '#ffffff'`. Then `.extend({ top: a.y, bottom: HEIGHT - a.y - a.height, left: a.x, right: WIDTH - a.x - a.width, background: '#ffffff' })`, then `.flatten({ background: '#ffffff' })` before `.ensureAlpha().raw().toBuffer()`, so the frame is opaque white outside the picture. Keep the exact-size check and the Uint8Array.from copy. setCartFrame/getCartFrame/setCartFrameActive are unchanged.

    3) Tests per <behavior> in actions/cart-card.test.mjs and actions/frames.test.mjs, with an inline border-band helper (do not import from agent/). Pass scale explicitly to renderCartCard/cartCardSvg in the new cart-card tests (SAFE_SCALE_DEFAULT or 1). frames.mjs reads SAFE_SCALE at import, so frames.test asserts against safeArea(SAFE_SCALE) rather than hard-coded 0.8 numbers (with no .env.local in the worktree it is 0.8 there).

    Run `npm test`; all must pass. Commit by name: `git add actions/cart-card.mjs actions/cart-card.test.mjs actions/frames.mjs actions/frames.test.mjs` with message `fix(actions): draw the cart card and browser frame inside the call safe area (quick-261114-lep)`.
  </action>
  <verify>
    <automated>node --test actions/cart-card.test.mjs actions/frames.test.mjs actions/cart.test.mjs actions/kroger.test.mjs && npm test 2>&1 | grep -E "^# (pass|fail)"</automated>
  </verify>
  <done>The cart card (1/3/7 items) and browser frames keep the outer 9% bands background-only at the default scale, photos land in their scaled tiles, getCartFrame still gives exactly WIDTH*HEIGHT*4 bytes, actions/cart.mjs is untouched, and npm test shows fail 0.</done>
</task>

<task type="auto">
  <name>Task 3: Visual check of real renders, docs and .env.example</name>
  <files>.env.example, agent/README.md, actions/README.md, renal/README.md</files>
  <action>
    1) Visual check (no repo files). Output folder: /private/tmp/claude-501/-Users-ptrczx-Desktop/49d7789a-b64c-470b-9826-f7eda7d76f05/scratchpad/lep/ (create it). Keep VIDEO_SAFE_SCALE unset:
    - `node agent/sim/preview-card.mjs /private/tmp/claude-501/-Users-ptrczx-Desktop/49d7789a-b64c-470b-9826-f7eda7d76f05/scratchpad/lep/agent` renders the idle screen (with wave), the speaking idle screen and the sample verdict cards (YES, SMALL PORTION with a long name, NO, CAN'T TELL, three rows + more, unjudged, online, escaping).
    - Write a script in the scratch folder (NOT in the repo), /private/tmp/claude-501/-Users-ptrczx-Desktop/49d7789a-b64c-470b-9826-f7eda7d76f05/scratchpad/lep/render.mjs. It imports by absolute path from the worktree: renderCartCard from actions/cart-card.mjs, drawFace from agent/face.mjs, captureCartFrame from actions/frames.mjs; and sharp via createRequire('<worktree>/package.json')('sharp'). Render: a 3-item cart card using fixture pictures made with sharp (three different solid colours or simple drawn shapes) and realistic names/prices (Kroger Unsalted Butter Sticks $3.59, Kroger Enriched Long Grain White Rice $1.89, Kroger Honeycrisp Apples 4 Pack Tray $15.00 quantity 3, step "Kroger cart updated"); a 7-item card; the drawn fallback face (drawFace(5, true)); and a browser frame from a fake page returning a 1280x720 fixture PNG. Save each as a PNG in the scratch folder. Optional only: replace the fixtures with real product pictures from a read-only Kroger app token + product search + picture download (`node --env-file=/Users/ptrczx/Desktop/emoryHackathonDietary-merge/.env.local`), no sign-in, no cart calls, never print key values; save downloaded pictures in their own new subfolder.
    - Open every PNG with the Read tool and look at it. Record honestly in the SUMMARY, per picture: whether any content touches the outer 10% margin; overlaps (tile names vs price, icon vs verdict word, online tag vs wordmark); text that looks too small to read on a phone; anything off-centre. If something overlaps or is clearly unreadable, fix it in the source file from Task 1 or 2 (design-space sizes/positions only), rerun npm test, commit that file by name with a `fix(video): ...` message, re-render and look again. Do not claim it reads well on a phone: it has not been seen on a live call.

    2) .env.example: after the `AGENT_CALL_WARN_SECONDS=` line add the comment line
    `# Optional. Share of the frame's width and height used by everything shown on the call (centred), so the zoomed FaceTime picture does not cut it off. 0.5 to 1; empty or invalid means 0.8; 1 is the old full-frame layout.`
    followed by the line `VIDEO_SAFE_SCALE=`.

    3) Shared contract. It must stay byte-identical in agent/README.md, actions/README.md and renal/README.md, and its env table says it lists every key in .env.example, so the row is required. In all three files, in the same commit and with identical text:
    - In "### Environment variables", insert after the `AGENT_CALL_WARN_SECONDS` row: | `VIDEO_SAFE_SCALE` | A, C | Optional | Share of the frame's width and height used by everything shown on the call, centred, because FaceTime shows the agent's video zoomed and cuts off the edges. Backgrounds still fill the whole frame. 0.5 to 1; empty or invalid means 0.8; 1 is the old full-frame layout. Read once at start. |
    - In the layout code block, change the line `shared/video.mjs     export const WIDTH = 1280, HEIGHT = 720, FPS = 15` to `shared/video.mjs     export const WIDTH = 1280, HEIGHT = 720, FPS = 15, and the safe area SAFE` (keep the column alignment).
    Check identity: `for f in agent renal actions; do awk '/^## Shared contract/{p=1} /^## Track/{p=0} p' $f/README.md | shasum; done` prints three equal hashes.

    4) agent/README.md, "### Video out" (Track A section, not the shared contract): add a short paragraph. Everything the agent draws (brand screen, verdict cards, voice wave, drawn face) is laid out at full size and then placed in the centred safe area from shared/video.mjs (80% of width and height by default, set by `VIDEO_SAFE_SCALE`), because a caller reported on 14 Nov 2026 that the picture was cut off on all four edges. The background still fills the frame. The scale is applied when a screen is rendered, not per frame. It has not yet been seen on a live call.
    actions/README.md, "### Kroger API cart": add to "The cart card" paragraph (or a short paragraph right after it) that the card and the browser cart frames are drawn inside the same safe area (`VIDEO_SAFE_SCALE`, default 0.8); that the product names (26 px), step line and footer were made slightly larger so they stay readable after the inset; that the click coordinates sent to Gemini are unaffected (it sees the raw screenshot); and that the inset card has not yet been seen on a live call.

    5) Commit by name: `git add .env.example agent/README.md actions/README.md renal/README.md` with message `docs(video): VIDEO_SAFE_SCALE and the call safe area (quick-261114-lep)`. Run `npm test` one final time. Then `rm node_modules` (the symlink only) and confirm `git status --porcelain` shows nothing except the uncommitted SUMMARY.md.
  </action>
  <verify>
    <automated>grep -c '^VIDEO_SAFE_SCALE=$' .env.example && test "$(for f in agent renal actions; do awk '/^## Shared contract/{p=1} /^## Track/{p=0} p' $f/README.md | shasum; done | sort -u | wc -l | tr -d ' ')" = 1 && grep -c 'VIDEO_SAFE_SCALE' agent/README.md actions/README.md renal/README.md && ls /private/tmp/claude-501/-Users-ptrczx-Desktop/49d7789a-b64c-470b-9826-f7eda7d76f05/scratchpad/lep/*.png /private/tmp/claude-501/-Users-ptrczx-Desktop/49d7789a-b64c-470b-9826-f7eda7d76f05/scratchpad/lep/agent/*.png</automated>
  </verify>
  <done>PNGs for the brand screen (idle and speaking), all sample verdict cards, 3- and 7-item cart cards, the drawn face and a browser frame exist outside the repo and were looked at, with an honest per-picture note in the SUMMARY. `.env.example` has VIDEO_SAFE_SCALE. The three shared-contract sections are byte-identical and list VIDEO_SAFE_SCALE. agent/README.md "Video out" and actions/README.md "Kroger API cart" describe the safe area. npm test shows fail 0. The node_modules symlink is removed and nothing is pushed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| environment -> shared/video.mjs | VIDEO_SAFE_SCALE comes from `.env.local` / the process environment |
| Kroger picture download / browser screenshot -> sharp | untrusted image bytes (unchanged paths; only target size and offset change) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-lep-01 | Denial of service | safeScaleFrom | mitigate | Non-finite, empty or non-numeric values fall back to 0.8; others are clamped to [0.5, 1], so no zero/negative/huge scale can produce empty or oversized resizes; tested |
| T-lep-02 | Tampering | renderCartCard / captureCartFrame output size | mitigate | The existing exact WIDTH*HEIGHT*4 checks stay; frames.mjs uses extend amounts computed from safeArea so the sum is exactly WIDTH x HEIGHT; tests assert the size |
| T-lep-03 | Information disclosure | visual-check script and PNGs | mitigate | Written only to the scratchpad outside the repo; the optional live check never prints key values and makes no sign-in or cart calls |
| T-lep-04 | Tampering | picture bytes into sharp | accept | Unchanged from before (Kroger host allowlist, 2 MB cap, limitInputPixels); only the target box size changes |
</threat_model>

<verification>
- `npm test` with no `.env.local`: fail 0, pass at least 484 plus the new tests.
- `git diff --stat` across the task's commits touches only the files in files_modified; actions/cart.mjs, agent/screen.mjs, agent/agent.mjs and agent/video.mjs are unchanged.
- The three shared-contract sections have identical hashes.
- `git status --porcelain` is empty apart from the SUMMARY.md; no node_modules entry; nothing pushed.
</verification>

<success_criteria>
- At the default scale, no picture the agent sends has content in the outer 9% of any edge (tested for verdict cards of every verdict, brand screen, wave, drawn face, cart card with 1/3/7 items, browser frame).
- VIDEO_SAFE_SCALE=1 gives the old layout; invalid values give 0.8; the value is read once.
- Frame size, FPS, the getCartFrame contract and tool behaviour are unchanged; no new dependency.
- An honest visual report of the rendered PNGs is in the SUMMARY.
</success_criteria>

<output>
Create `.planning/quick/261114-lep-safe-area-so-the-call-video-is-not-cut-o/261114-lep-SUMMARY.md` when done (leave it uncommitted).
</output>
