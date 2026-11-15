---
phase: quick-261114-kle
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - actions/kroger.mjs
  - actions/kroger.test.mjs
  - actions/cart-card.mjs
  - actions/cart-card.test.mjs
  - actions/frames.mjs
  - actions/frames.test.mjs
  - actions/cart.mjs
  - actions/cart.test.mjs
  - actions/README.md
autonomous: true
requirements: [QUICK-261114-kle]

must_haves:
  truths:
    - "On the Kroger API cart path, after each successful add, getCartFrame returns a 1280x720 RGBA cart card (product photos, names, prices, x-quantity, running total, footer 'Nothing is paid. Review and check out yourself.'), so the agent's video shows it with no change under agent/"
    - "When the run ends (done, or failed after at least one add) the final card stays for 20 s and is then deactivated, so the agent's own picture returns; stopCart deactivates at once and cancels the hold; a new startCart cancels a pending hold"
    - "If nothing was added, getCartFrame stays null for the whole run"
    - "The only URL fetched besides the Kroger API token/products/cart-add endpoints is an https://www.kroger.com/product/images/... picture; any other picture URL is treated as no picture and never fetched"
    - "A missing, failed, slow (>3 s), oversized (>2 MB), non-image or undecodable picture gives a placeholder tile and never fails or stalls the cart run"
    - "Browser cart path, public contract (startCart, async getCartStatus, stopCart, getCartFrame) and getCartStatus shape are unchanged; npm test passes with no .env.local and no network"
  artifacts:
    - path: "actions/cart-card.mjs"
      provides: "downloadPicture (guarded fetch), cartCardSvg (pure, escaped), renderCartCard (RGBA frame)"
      exports: ["downloadPicture", "cartCardSvg", "cardLayout", "renderCartCard", "CARD_MAX_TILES"]
    - path: "actions/cart-card.test.mjs"
      provides: "No-network tests for picture download guards, escaping and exact frame size"
    - path: "actions/kroger.mjs"
      provides: "pickImageUrl and isKrogerImageUrl"
      exports: ["pickImageUrl", "isKrogerImageUrl"]
    - path: "actions/frames.mjs"
      provides: "setCartFrame(rgba) beside captureCartFrame/getCartFrame/setCartFrameActive"
      exports: ["setCartFrame"]
    - path: "actions/cart.mjs"
      provides: "Kroger path publishes the card after each add, holds it, clears it"
      contains: "renderCartCard"
  key_links:
    - from: "actions/cart.mjs"
      to: "actions/cart-card.mjs"
      via: "renderCard / fetchPicture injectable defaults"
      pattern: "renderCartCard|downloadPicture"
    - from: "actions/cart.mjs"
      to: "actions/frames.mjs"
      via: "publishFrame = setCartFrame then activateFrame(true)"
      pattern: "setCartFrame"
    - from: "actions/frames.mjs getCartFrame"
      to: "agent/video.mjs pickFrame"
      via: "exact WIDTH*HEIGHT*4 Uint8Array wins over the agent's own picture"
      pattern: "getCartFrame"
---

<objective>
Show pictures of the items on the FaceTime call while the Kroger API cart adds them. Track C renders a "cart card" video frame (product photos, short names, prices, quantities, running total, safety footer) and offers it through the existing `getCartFrame`, which the agent already polls every frame tick. Nothing under `agent/` or `renal/` changes.

Purpose: today the Kroger API path works but the caller sees nothing while it runs; the card gives visible proof of what went into the cart.
Output: `actions/cart-card.mjs` + tests, small additions to `actions/kroger.mjs` and `actions/frames.mjs`, wiring in `actions/cart.mjs`, extended tests, an updated "### Kroger API cart" README section, and a PNG of a live-rendered card written OUTSIDE the repo.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@actions/kroger.mjs
@actions/cart.mjs
@actions/frames.mjs
@actions/cart.test.mjs
@actions/kroger.test.mjs
@actions/frames.test.mjs

READ ONLY (style and consumer, do not edit): @agent/card.mjs (colours, FONT, cleanText/fitText/escapeXml/textWidth, renderSvg with sharp), @agent/video.mjs (pickFrame accepts only a Uint8Array of exactly WIDTH*HEIGHT*4).

## Executor environment (mandatory)

- You run in an isolated git worktree with no `.env.local` and no `node_modules`. First, in the worktree root: `ln -s /Users/ptrczx/Desktop/emoryHackathonDietary-merge/node_modules node_modules`. Never commit it.
- Stage files BY NAME only (`git add actions/cart-card.mjs ...`); never `git add -A` / `git add .`. Do not push.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No edits under `agent/` or `renal/`. No edits to the "## Shared contract" section of any README. No new dependency (sharp is already there; use global `fetch`, `AbortSignal.timeout`, `Headers`).
- A live Chert session is running from the main checkout: do NOT start, stop or restart any `npm start` / `chert dev` / agent process.
- Live network use is limited to Task 3's read-only check. Never sign in, never call `getUserToken`, `addToCart` or `exchangeCode`, never print key or token values.
- Before finishing: remove the `node_modules` symlink (and any other symlink you made) so `git status` shows only the uncommitted SUMMARY.md.

## Facts established live today (do not re-derive)

- Each product in `GET /v1/products` `data[]` has `images: [{ perspective: 'front', featured: true, sizes: [{ size: 'xlarge'|'large'|'medium'|'small'|'thumbnail', url }] }, ...]`. Front "large" URL form: `https://www.kroger.com/product/images/large/front/<upc>`. A plain Node `fetch` returned 200, `image/jpeg`, 500x500, ~52 KB, readable by sharp.
- Kroger run status shape `{state, step, added:[{name, price}], missing, total, cartUrl}`; `price` is the line price (unit x quantity, rounded to cents).
- `text_cart_link` already works for this path; nothing to build for texting.

<interfaces>
From shared/video.mjs: `export const WIDTH = 1280; export const HEIGHT = 720; export const FPS = 15;`

From actions/frames.mjs (current, whole file is 30 lines):
- `captureCartFrame(page)` -> screenshots, resizes to WIDTH x HEIGHT, stores `latestFrame` (module state), returns it.
- `getCartFrame()` -> `cartActive ? latestFrame : null` (synchronous).
- `setCartFrameActive(active)` -> sets `cartActive`; `false` also nulls `latestFrame`.

From actions/kroger.mjs:
- `chooseProduct(itemName, products)` -> `{ upc, description, unitPrice } | null` (a test deep-equals this shape: DO NOT add fields to it).
- `createKrogerClient({clientId, clientSecret, locationId, tokenStore, fetchImpl, now})` -> `{ searchProducts(term) -> {ok, products} | {ok:false, error}, getUserToken, addToCart({upc, quantity}, token), exchangeCode }`.
- `readKrogerConfig(env)` -> `{clientId, clientSecret, locationId, redirectUri, tokenDir} | null`; `parseQuantity(text)` -> 1..5.

From actions/cart.mjs `createCartController({ openContext, createAi, getStoreUrl, captureFrame = captureCartFrame, activateFrame = setCartFrameActive, createFallbackLink, now, getKrogerConfig, createKroger })`; `runKroger(items, config)` loops items: search -> chooseProduct -> addToCart -> `status.added.push({name: product.description, price})`; ends `done` ("Kroger cart updated" / "No items could be added to the Kroger cart"), `failed` (sign-in expired mid-run keeps earlier items), or `idle` "Cart stopped". `stopCart()` sets `stopRequested`, and only when no run is in flight sets idle + `activateFrame(false)`. Module singleton at the bottom exports `startCart`, `getCartStatus` (async), `stopCart`.

From actions/cart.test.mjs: `makeKrogerController({stored, search, add, refreshStatus, openContext})` builds a controller with an injected `fetchImpl` that records `{path, body}` and throws on any unknown pathname; `krogerProduct(upc, description, price)`; `waitForState(controller, state)` polls every 5 ms for up to 2 s.

From agent/card.mjs (copy the ideas, do NOT import from agent/): `FONT = 'Helvetica Neue, Helvetica, Arial, sans-serif'`, `BACKGROUND '#0F2430'`, `WHITE '#FFFFFF'`, `SOFT '#CBD5E1'`, `LIGHT '#E2E8F0'`; `cleanText(value, max)` strips URLs, control chars, emoji, collapses spaces, caps length; `escapeXml` escapes & < > " '; `textWidth(s, size, bold)` cautious estimate; `fitText(s, {max, min, width, bold})` shrinks then truncates with an ellipsis; `renderSvg` races sharp against a 3 s timeout and checks the raw size.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Picture URL selection and the cart-card renderer</name>
  <files>actions/kroger.mjs, actions/kroger.test.mjs, actions/cart-card.mjs, actions/cart-card.test.mjs</files>
  <behavior>
    - pickImageUrl: featured front image -> its 'large' URL; no 'large' -> 'medium', then 'xlarge', then first size with a url; no featured -> first 'front' image; no front -> first image; no images / malformed -> null.
    - isKrogerImageUrl: true only for https, hostname exactly 'www.kroger.com', no port, no username/password, pathname starting '/product/images/'. False for http://www.kroger.com/..., https://kroger.com/..., https://www.kroger.com.evil.example/product/images/x, https://www.kroger.com@evil.example/product/images/x, https://evil.example/product/images/x, https://www.kroger.com/cart, non-strings, unparseable strings.
    - pickImageUrl never returns a URL that fails isKrogerImageUrl: when the preferred URL is off-host it moves on to the next candidate, and returns null if none passes.
    - downloadPicture(url, opts): disallowed URL -> null with ZERO fetch calls; fetch called with redirect 'error' and no Authorization header; non-2xx -> null; content-type not starting 'image/' -> null; content-length header above maxBytes -> null; body longer than maxBytes without a header -> null; fetch that rejects -> null; fetch that never settles with timeoutMs 50 -> resolves null within ~ timeoutMs (never rejects); good image -> Buffer.
    - renderCartCard with 1, 3 and 7 items -> Uint8Array, byteLength exactly 1280*720*4, byteOffset 0, byteLength === buffer.byteLength.
    - renderCartCard with picture null, picture = random non-image bytes, and picture = a 3000x3000 PNG -> still exactly 1280*720*4 bytes (placeholder tile for the first two).
    - cartCardSvg with name 'Kroger® "Big" <Deal> & more' does not throw, the SVG contains '&lt;Deal&gt;' and '&amp;' and '&quot;' and not the raw '<Deal>'; renderCartCard with that name resolves to the exact size.
    - cartCardSvg with 7 items draws 5 product tiles and a '+2 more' tile, and the header total covers all 7 items.
  </behavior>
  <action>
In actions/kroger.mjs add two exports and leave everything else as is (chooseProduct keeps its exact return shape because a test deep-equals it):
- isKrogerImageUrl(url): parse with new URL inside try; accept only protocol 'https:', hostname === 'www.kroger.com' (exact, not endsWith), port '', username '' and password '', pathname starting with '/product/images/'. Return a boolean, never throw.
- pickImageUrl(product): read product?.images if it is an array; order image candidates as featured+front, featured, front, then the rest in Kroger's order; inside each image order sizes as 'large', 'medium', 'xlarge', then the rest; return the first url string that passes isKrogerImageUrl, else null. Never throw.

Create actions/cart-card.mjs (Track C module; header comment says it draws the Kroger cart card offered through getCartFrame, is pure apart from sharp and the injected fetch, and never throws to its caller except renderCartCard, which the cart wraps). Contents:
- Constants: PICTURE_TIMEOUT_MS = 3000, PICTURE_MAX_BYTES = 2_000_000, export CARD_MAX_TILES = 6, and the colours/FONT copied from agent/card.mjs (BACKGROUND '#0F2430', WHITE, SOFT '#CBD5E1', LIGHT '#E2E8F0'), a tile fill such as '#17384A', placeholder fill '#E2E8F0' with grey '#64748B' text, total in '#4ADE80' or WHITE.
- Local copies (do NOT import from agent/, a different track) of cleanText, escapeXml, textWidth and fitText with the same behaviour as agent/card.mjs. Every drawn string goes cleanText -> fit/wrap -> escapeXml.
- export async function downloadPicture(url, { fetchImpl = fetch, timeoutMs = PICTURE_TIMEOUT_MS, maxBytes = PICTURE_MAX_BYTES } = {}): if !isKrogerImageUrl(url) return null without fetching. Otherwise call fetchImpl(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }) with no auth headers, and race the whole read (headers + arrayBuffer) against a setTimeout of timeoutMs that resolves null (clear the timer in finally, unref it). Reject non-ok responses, a content-type (via response.headers.get) not starting with 'image/', a numeric content-length above maxBytes, and an arrayBuffer longer than maxBytes. Return Buffer.from(arrayBuffer). Any exception -> null. Never rejects.
- export function cartCardSvg({ storeName = 'Kroger', items = [], step = '', total }): pure; returns the 1280x720 SVG text with NO photos (photos are composited by renderCartCard). Also export cardLayout(count), returning the tile rectangles { x, y, w, h, photo: { x, y, w, h } } that both cartCardSvg and renderCartCard use. Layout (adjust a few pixels if the visual check needs it): background BACKGROUND; header 'Your Kroger cart' (use cleanText(storeName) so it reads 'Your <store> cart') at x 60 y 78, 48 px bold WHITE; right-aligned 'Total $NN.NN' at x 1220 anchor end, 44 px bold; step line at y 122, 28 px SOFT, fitText to 1160 wide; grid of up to 6 tiles in 3 columns x 2 rows from y 140 to 650 (tile about 373 x 245, 20 px gaps, rx 16, tile fill); each tile has a white photo box 140 high at its top (the photo is contained in it, about 140 x 140 centred) and below it the product name wrapped into at most two lines of about 24 px LIGHT within the tile width minus 28 px (second line truncated with an ellipsis via fitText), and a price line about 28 px bold WHITE reading '$7.18' or, when quantity > 1, '$7.18 · x2' (price is the line price as in status). With more than CARD_MAX_TILES items draw the first 5 items and a sixth tile reading '+N more' centred. Total = the passed total if it is a finite number, else the sum of item prices, formatted with toFixed(2). Footer centred at y 692, 30 px SOFT: 'Nothing is paid. Review and check out yourself.' Missing/invalid price renders as an empty price line, never 'NaN'.
- export async function renderCartCard({ storeName, items, step, total }): build the SVG; for each shown tile with a picture Buffer, prepare the photo with sharp(picture, { limitInputPixels: 25_000_000 }).resize(photo.w, photo.h, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' }).png().toBuffer() inside its own try/catch; on failure (or no picture) leave the tile as a neutral placeholder drawn in the SVG (light box with a simple basket outline or the words 'No picture'; the SVG draws the placeholder for every tile and the photo, when present, is composited over it). Composite all photos onto sharp(Buffer.from(svg)) at their photo boxes, then .ensureAlpha().raw().toBuffer({ resolveWithObject: true }) raced against a 3 s timeout like agent/card.mjs renderSvg; throw if info.width/height/length do not equal WIDTH, HEIGHT, WIDTH*HEIGHT*4; return new Uint8Array(data) (a fresh exact-size array, byteOffset 0).

Tests (no network, no keys):
- In actions/kroger.test.mjs add a test for pickImageUrl and isKrogerImageUrl covering every case in behavior; import the two new names. Do not change ALLOWED_PATHS (the API client still fetches only token/products/cart-add).
- Create actions/cart-card.test.mjs covering every downloadPicture and renderCartCard / cartCardSvg case in behavior. Use a fake fetchImpl that records calls and returns objects shaped { ok, status, headers: new Headers({...}), arrayBuffer: async () => ... }. Make small real images with sharp({ create: {...} }).png().toBuffer() (a 3000x3000 one for the oversized-dimension case; a 2_000_001-byte Buffer for the size-cap case).

Write the tests first, run them red, then implement. Commit: feat(actions): Kroger cart card renderer and picture URL allow-list.
  </action>
  <verify>
    <automated>node --test actions/cart-card.test.mjs actions/kroger.test.mjs</automated>
  </verify>
  <done>Both test files pass; cart-card.mjs exports downloadPicture, cartCardSvg, cardLayout, renderCartCard, CARD_MAX_TILES; kroger.mjs exports pickImageUrl and isKrogerImageUrl; chooseProduct unchanged; no import from agent/; committed with the two source and two test files staged by name.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Publish, hold and clear the card on the Kroger API path</name>
  <files>actions/frames.mjs, actions/frames.test.mjs, actions/cart.mjs, actions/cart.test.mjs</files>
  <behavior>
    - setCartFrame(rgba) stores a Uint8Array of exactly WIDTH*HEIGHT*4 and returns true; anything else returns false and leaves the stored frame unchanged; getCartFrame still returns null until setCartFrameActive(true); setCartFrameActive(false) still clears it.
    - Kroger run with two found items: publishFrame receives an exact-size frame after the first add and again after the second; activateFrame(true) is called; when state reads 'done' a hold timer of 20000 ms is already scheduled and activateFrame(false) has not yet been called after the last true; firing the fake timer calls activateFrame(false); the hold timer handle had unref called.
    - getCartStatus is deep-equal to today's expectation in 'kroger API path fills the cart without a browser' (no picture fields leak into status).
    - All items missing: publishFrame and activateFrame(true) are never called and no hold timer is scheduled.
    - stopCart during the run (inside the add callback): run ends idle 'Cart stopped', no hold is scheduled, and the last activateFrame call is false (no frame is published after the stop).
    - stopCart after done while the hold is pending: activateFrame(false) is called immediately and the fake clearTimer received the hold handle.
    - startCart after done while the hold is pending: the hold is cleared and activateFrame(false) is called before the new run's first publish.
    - 401 mid-run after one add: state 'failed', the card from the first add was published and the hold is scheduled.
    - Every URL fetched during Kroger runs is either an api.kroger.com token/products/cart/add endpoint or starts with https://www.kroger.com/product/images/; a product whose image URL is on another host gets a placeholder and that URL is never fetched.
    - Existing browser-path tests pass untouched.
  </behavior>
  <action>
actions/frames.mjs: add export function setCartFrame(rgba): if rgba is a Uint8Array with byteLength === WIDTH*HEIGHT*4, set latestFrame = rgba and return true; else return false. Do not change captureCartFrame, getCartFrame or setCartFrameActive. Add a frames.test.mjs case for the behavior above.

actions/cart.mjs (Kroger API path only; the browser path in run(), executeAction, every guard, MAX_DURATION_MS, and the status shape stay byte-for-byte as they are):
- Import setCartFrame from './frames.mjs', renderCartCard and downloadPicture from './cart-card.mjs', pickImageUrl from './kroger.mjs'. Add const CARD_HOLD_MS = 20_000 (constant, no env).
- New createCartController options with defaults: publishFrame = setCartFrame, renderCard = renderCartCard, fetchPicture = (url) => downloadPicture(url), setTimer = setTimeout, clearTimer = clearTimeout, cardHoldMs = CARD_HOLD_MS.
- Controller state: holdTimer = null, cardShown = false, cardItems = [] (per run, NOT part of status: entries { name, price, quantity, picture }).
- clearHold(): if holdTimer, clearTimer(holdTimer), holdTimer = null. hideCard(): clearHold(); if cardShown, cardShown = false and activateFrame(false). scheduleHold(): clearHold(); holdTimer = setTimer(() => { holdTimer = null; if (cardShown) { cardShown = false; activateFrame(false); } }, cardHoldMs); call holdTimer?.unref?.() so it never keeps the process alive.
- showCard(step): try { const rgba = await renderCard({ storeName: 'Kroger', items: cardItems, step, total: status.total }); if (stopRequested) return; if (publishFrame(rgba)) { activateFrame(true); cardShown = true; } } catch { /* the card is decoration; never fail the run */ }.
- In runKroger: reset cardItems = [] at the start. After chooseProduct succeeds, compute imageUrl = pickImageUrl of the product in found.products whose upc equals product.upc, and START the download before addToCart: picturePromise = imageUrl ? fetchPicture(imageUrl) : Promise.resolve(null) (attach .catch(() => null) so a rejecting injected fetcher cannot surface); the download overlaps the add so it costs no extra time. After the add succeeds and status.added/total are updated (status must be updated BEFORE any picture/render await so cart_status sees the add at once), if not stopRequested: picture = await picturePromise (bounded by the 3 s per-picture timeout inside downloadPicture), push { name: product.description, price, quantity, picture } to cardItems, await showCard(status.step). On add failure or missing products, do nothing with the picture.
- End of a successful loop with at least one add and not stopped: await showCard('Kroger cart updated') BEFORE assigning the done status, then assign it (so by the time a poller sees 'done' the final card is published and, via finally, the hold is scheduled in the same synchronous continuation). Zero adds: no card at all.
- runKroger finally (keep runPromise = null): if stopRequested -> hideCard(); else if cardShown -> scheduleHold(). This covers done and failed-after-adds (e.g. sign-in expired mid-run) and the catch path.
- startCart: after the busy check and validation pass, call hideCard() (cancels a pending hold and removes the previous card before the new run) and then proceed exactly as today.
- stopCart: at the top, after stopRequested = true, call hideCard(); keep the rest unchanged (the browser context close and the idle/activateFrame(false) branch when no run is in flight).

actions/cart.test.mjs (Kroger section only; leave browser tests and helpers above line 400 untouched):
- Extend makeKrogerController with fakes: frames = { published: [], active: [] } via publishFrame: (f) => { frames.published.push(f); return f instanceof Uint8Array && f.byteLength === 1280*720*4; } and activateFrame: (a) => frames.active.push(a); fake timers setTimer(fn, ms) that records { fn, ms, unrefCalled } and returns a handle object with unref(), clearTimer(handle) that records cleared handles. Return { controller, calls, frames, timers }.
- Route pictures through the same recording fetchImpl: fetchPicture: (url) => downloadPicture(url, { fetchImpl }). In fetchImpl, record the full URL string; if u.hostname === 'www.kroger.com' && u.pathname.startsWith('/product/images/') return { ok: true, status: 200, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => the existing 4x4 png bytes }; else assert u.hostname === 'api.kroger.com' and keep today's pathname branches and the throw on unknown paths. Add images to krogerProduct via an optional fourth argument (default: [{ perspective: 'front', featured: true, sizes: [{ size: 'large', url: 'https://www.kroger.com/product/images/large/front/' + upc }] }]) so existing call sites keep working; add one fixture whose image url is https://images.example.com/x.jpg.
- Use the real renderCartCard (sharp, fast enough within waitForState's 2 s) so the test also proves the exact frame size; add tests for every behavior bullet, plus an allow-list assertion over all recorded URLs in every Kroger test: each one starts with https://api.kroger.com/v1/connect/oauth2/token, https://api.kroger.com/v1/products, https://api.kroger.com/v1/cart/add, or https://www.kroger.com/product/images/, and none contains checkout, order or payment.
- Keep the existing Kroger assertions as they are (they must still pass unchanged, which proves the status shape did not change).

Write the new tests first, see them fail, then implement. Run the whole suite. Commit: feat(actions): show the Kroger cart card on the call while the API cart adds items.
  </action>
  <verify>
    <automated>node --test actions/ && npm test</automated>
  </verify>
  <done>frames.mjs exports setCartFrame; the Kroger path publishes after each add, holds 20 s then deactivates, clears on stopCart and on a new startCart, publishes nothing when nothing was added; the hold timer is unref'd; the URL allow-list assertion covers pictures; existing browser and Kroger assertions unchanged and green; npm test green with no .env.local; committed with the four files staged by name.</done>
</task>

<task type="auto">
  <name>Task 3: Read-only live render of a real card, README update, cleanup</name>
  <files>actions/README.md</files>
  <action>
Read-only live check (the ONLY network use in this plan). Write a throwaway script in your scratch/temp directory OUTSIDE the repo (never inside the worktree). It must: import readKrogerConfig, createKrogerClient, chooseProduct and pickImageUrl from the worktree's actions/kroger.mjs and downloadPicture and renderCartCard from actions/cart-card.mjs by absolute file URL; load sharp with createRequire pointed at the worktree's package.json (the script lives outside the repo so bare 'sharp' does not resolve). Build the client from readKrogerConfig(process.env) (stop and report if it is null) with a tokenStore whose load returns null and save is a no-op. For 'unsalted butter', 'white rice', 'apples' call ONLY searchProducts + chooseProduct, then pickImageUrl on the chosen product, then downloadPicture with real fetch. Print only description, unit price, upc, image URL, and picture byte count or 'no picture' (never keys or tokens). Render with renderCartCard({ storeName: 'Kroger', items: the three with quantity 1, 1, 3 and line prices, step: 'Kroger cart updated' }), convert the raw RGBA to PNG with sharp(Buffer.from(rgba), { raw: { width: 1280, height: 720, channels: 4 } }).png().toFile(...), and write it into the same scratch/temp directory OUTSIDE the repo. Run it with node --env-file=/Users/ptrczx/Desktop/emoryHackathonDietary-merge/.env.local <script>. Do NOT call getUserToken, addToCart or exchangeCode; do not sign in; do not touch any running npm start / chert dev process. Open the PNG with the Read tool and check it looks right (photos visible on white, names readable and inside their tiles, prices, total, footer); if text overflows or overlaps, adjust the layout in actions/cart-card.mjs, re-run node --test actions/ and re-render, and include that fix in an extra commit. Record the absolute PNG path, the three choices, picture sizes and render time in SUMMARY.md.

README: in actions/README.md, edit ONLY the "### Kroger API cart" subsection under "## Track C in detail" (the "## Shared contract" section must stay byte-identical). Replace the sentence "There is no cart picture on this path (`getCartFrame` stays `null`)." with a short paragraph: after each item is added, the cart draws a card (photo on white, short name, line price, "x3" when quantity > 1, running total, "Nothing is paid. Review and check out yourself.") and offers it through `getCartFrame`; up to 6 tiles, the 7th onward shown as "+N more"; when the run ends the card stays 20 s and then the agent's own picture returns; `stopCart` or a new `startCart` removes it at once; nothing is shown when nothing was added. Pictures come only from `https://www.kroger.com/product/images/...` (exact host, https, redirects refused), 3 s timeout and 2 MB cap each, image content-type only, failures give a placeholder and never fail the run; the download overlaps the add. Update the Safety paragraph so the test description says every URL fetched is the token, products or cart/add endpoint or a www.kroger.com product picture. Add to the verified notes what you actually saw in the read-only check (date 14 Nov 2026: three products, pictures downloaded, card rendered to a PNG outside the repo, looked right). Add to "Not verified": the card on a live call (not seen until a person calls). Keep the existing plain, short style; no marketing language.

Cleanup: delete the throwaway script (the PNG stays outside the repo for a person to look at); remove the node_modules symlink and any other symlink you created; confirm git status shows nothing but the uncommitted SUMMARY.md. Commit the README: docs(actions): Kroger cart card on the call.
  </action>
  <verify>
    <automated>test "$(awk '/^## Shared contract/{s=1} /^## Track C in detail/{s=0} s' actions/README.md | shasum)" = "$(git show HEAD~1:actions/README.md | awk '/^## Shared contract/{s=1} /^## Track C in detail/{s=0} s' | shasum)" && ! grep -q "There is no cart picture on this path" actions/README.md && grep -q "product/images" actions/README.md && git diff --name-only HEAD~3 -- agent renal | wc -l | grep -q '^ *0$' && test ! -L node_modules</automated>
  </verify>
  <done>A live-rendered card PNG exists OUTSIDE the repo and its absolute path is in SUMMARY.md; README "### Kroger API cart" describes the card and the honest verified / not-verified split; Shared contract section byte-identical; no files changed under agent/ or renal/; no symlinks left; nothing pushed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Kroger products API -> cart | Product descriptions and image URLs are third-party data |
| cart -> www.kroger.com picture host | Outbound HTTP fetch of a URL taken from that data |
| picture bytes -> sharp | Untrusted image bytes decoded locally |
| product text -> SVG -> sharp | Untrusted strings placed into markup |
| cart card -> FaceTime video | Whatever is drawn is seen by the patient |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-kle-01 | Spoofing / SSRF | downloadPicture, pickImageUrl | mitigate | isKrogerImageUrl: https only, hostname exactly www.kroger.com, no port, no userinfo, path /product/images/; checked in pickImageUrl AND again in downloadPicture before fetch; redirect: 'error'; tests cover look-alike hosts and userinfo tricks and assert zero fetch calls |
| T-kle-02 | Denial of service | downloadPicture, run loop | mitigate | 3 s AbortSignal plus a racing timer, 2 MB cap via content-length and actual length, download started before the add so it overlaps; every failure returns null; render wrapped in try/catch |
| T-kle-03 | Denial of service | sharp decoding | mitigate | limitInputPixels 25M on picture decode, per-picture try/catch -> placeholder, 3 s render race, exact-size check |
| T-kle-04 | Tampering (markup injection) | cartCardSvg | mitigate | cleanText -> fitText -> escapeXml on every drawn string; test with Kroger® "Big" <Deal> & more |
| T-kle-05 | Information disclosure | picture fetch | mitigate | no Authorization or other headers on picture requests; no tokens in card, status or logs |
| T-kle-06 | Elevation (purchase without consent) | cart card | accept | card is display only; footer says nothing is paid and the patient checks out themselves; no checkout/order/payment URL is fetched (allow-list test) |
| T-kle-07 | Denial of service | hold timer | mitigate | timer unref'd, cleared on stopCart and new startCart |
</threat_model>

<verification>
- node --test actions/ and npm test pass in the worktree with no .env.local and no network.
- git diff of the three commits touches only the nine files in files_modified; nothing under agent/ or renal/; Shared contract section unchanged.
- A person can open the PNG path in SUMMARY.md and see the three real Kroger products with photos.
</verification>

<success_criteria>
- getCartFrame returns an exact 1280x720 RGBA cart card during and 20 s after a Kroger API run that added items, and null otherwise.
- Picture fetching is limited to https://www.kroger.com/product/images/ with timeout, size and type guards, and never fails or noticeably slows the cart.
- Browser path, public contract and status shape unchanged; all tests green.
- README "### Kroger API cart" says what was built and what was actually seen; the live call itself is listed as not verified.
</success_criteria>

<output>
Create `.planning/quick/261114-kle-product-pictures-on-the-call-for-the-kro/261114-kle-SUMMARY.md` when done (leave it uncommitted). Include the absolute PNG path, the three live product choices with picture sizes, render time, and any layout adjustments.
</output>
