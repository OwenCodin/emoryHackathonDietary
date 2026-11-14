---
phase: quick-261114-fc6
plan: 01
status: complete
branch: build/lookup
base: 44f6bdb
---

# Quick 261114-fc6: grounded lookup, generic names, tool failure logging

Result: `npm test` 350 tests, 350 pass, 0 fail (run with GOOGLE_API_KEY and USDA_API_KEY unset; the worktree has no .env.local). `git status --short -- . ':!.planning'` was empty after the run and after the last commit.

## Commits

- 4620a3c feat(renal): grounded web nutrition lookup (renal/websearch.mjs, strict parser, grounding gate; gemini helper passes the response to parse; plausibleMatch moved to data.mjs; .env.example keys)
- 51d6823 feat(renal): generic vision food names and a guarded generic seed fallback in lookupFood
- d22daa7 fix(renal): lookupFood chain seed, generic seed, guarded USDA, grounded web, not found; USDA failures never fail a check; web cache namespace
- 5aa78ce feat(renal): checkFood judges web results per found serving with source 'web' and a spoken online provenance; "judged as" for generic seed matches
- 9d11270 feat(agent): agent/toollog.mjs (pure) wired into agent.mjs, logs a validated failure code
- 57c12e4 feat(agent): look_at_camera never a dead end (unjudged:true, remembers foods), codes vision_failed / unclear_picture / no_food_seen, online:true

## Exact Gemini prompt (online lookup), for query "oatly oat milk"

The query is only normalizeFoodName(name).slice(0, 80) (lowercase letters, digits, single spaces).

```
Use Google Search to find the nutrition facts for ONE typical serving of this food or product: "oatly oat milk".
Prefer the manufacturer's own website or an official nutrition database.
Report only numbers that are stated in the search results. Write unknown for anything that is not stated. Never estimate, convert or calculate a value.
PHOSPHATE_ADDITIVE is yes only if the ingredient list includes a phosphate or phosphoric acid, no if the ingredient list was found and has none, otherwise unknown.
Answer with one short sentence naming where you found the facts, then exactly these seven lines and nothing after them:
PRODUCT: <the product or food name as the source writes it>
SERVING: <the serving as the source writes it, for example 1 cup (240 ml)>
SERVING_AMOUNT: <the serving size in grams or milliliters, for example 240 ml, or unknown>
SODIUM_MG: <number or unknown>
POTASSIUM_MG: <number or unknown>
PHOSPHORUS_MG: <number or unknown>
PHOSPHATE_ADDITIVE: <yes, no or unknown>
```

Request: model gemini-3.5-flash-lite (or RENAL_LOOKUP_MODEL; optional RENAL_LOOKUP_FALLBACK_MODEL), `config: { tools: [{ googleSearch: {} }], temperature: 0, abortSignal }`, no responseMimeType, no responseSchema. Budget: 5500 ms total, 3000 ms hedge.

## Exact answer format required

One free sentence, then seven lines, each key exactly once (optional leading "-" or "*" bullet and "**" around key/value tolerated):
PRODUCT (1..120 chars), SERVING (1..80 chars), SERVING_AMOUNT (`^\d{1,4}(\.\d{1,2})?\s*(g|ml)$` or unknown), SODIUM_MG / POTASSIUM_MG / PHOSPHORUS_MG (`^\d{1,5}(\.\d{1,2})?\s*(mg)?$` or unknown), PHOSPHATE_ADDITIVE (yes|no|unknown). Anything else rejects the whole answer; unknown becomes null, never a default.

Accepted only if: groundingMetadata has at least one webSearchQuery AND at least one groundingChunk with an http(s) web.uri; PRODUCT passes plausibleMatch against the query; at least one nutrient is a number; sodium <= 5000, potassium <= 5000, phosphorus <= 3000 mg; serving 1..2000 g/ml. Cache reads re-run the same acceptance check.

## Acceptance results (all stubbed, no network, all pass)

- A (renal/lookup.test.mjs "acceptance A"): USDA 429 + grounded valid answer -> `{ok:true, found:true, source:'web', matched:'web'}`, serving "1 cup (240 ml)", host oatly.com. PASS
- B ("acceptance B"): USDA 429 + ungrounded (empty groundingChunks) -> `{ok:true, found:false}`. PASS
- C ("acceptance C"): grounded, SODIUM_MG 50000 -> `{ok:true, found:false}`. PASS
- D ("acceptance D"): grounded PRODUCT "Minute Maid Lemonade" for "coca cola zero cherry" -> `{ok:true, found:false}`. PASS
- F (renal/check.test.mjs, four "acceptance F" tests): "Local Bounti Crispy Green Leaf lettuce" judged from the lettuce seed with fetch and ai failing if called, reason and portion say "judged as lettuce"; "Local Bounti Spring Mix" with USDA 429 + ungrounded ai -> verdict unknown, source none, USDA called once, ai called once; "pina colada" -> unknown, no cola reason, not source 'rule'; "star fruit juice" -> avoid, source 'rule', no lookup. PASS
- Also tested: USDA 503 / throw / bad JSON / no key all fall through; a USDA failure is not cached as not-found; web cache write and read; tampered (sodium 90000) and mismatched cache entries ignored; web rejection negatively cached in memory only (nothing negative on disk).

## Exact spoken text

Accepted online result (Oatly sample, 1 cup, sodium 100, potassium 390, phosphorus 270; the test profile limits 2000/2000/1000 make it "avoid" at 27% of phosphorus):

> Avoid, oatly oat milk web a has about two hundred seventy milligrams of phosphorus per serving; try an unseasoned fresh alternative instead. That is from what I found online, not from your care team's list.

(check_food's agent wrapper prefixes "No, " and keeps two sentences within 240 chars.) With phosphorus unknown the first sentence ends ", and I could not find its phosphorus."; with a phosphate additive, ", and it has a phosphate additive."

Seen but unjudged look (two foods, none checkable), look_at_camera result `say`:

> I can see 2 foods, but I couldn't check them against your limits just now.

Each row keeps its existing spoken text "I can't tell, I couldn't check that one just now." with verdict unknown. One food: "I can see one food, but I couldn't check it against your limits just now."

## Live commands for the orchestrator (run from this worktree)

Web lookup directly (empty USDA_API_KEY forces the web step; empty-string env wins over the file):

```
RENAL_STATE_DIR=$(mktemp -d) USDA_API_KEY= node --env-file=/Users/ptrczx/Desktop/emoryHackathonDietary/.env.local --input-type=module -e "const m=await import('./renal/nutrients.mjs'); console.log(JSON.stringify(await m.lookupFood({name:'oatly oat milk'}),null,1))"
```

Full check (patient id is `demo`):

```
RENAL_STATE_DIR=$(mktemp -d) USDA_API_KEY= node --env-file=/Users/ptrczx/Desktop/emoryHackathonDietary/.env.local --input-type=module -e "const r=await import('./renal/index.mjs'); const p=await r.getProfile({patientId:'demo'}); console.log(JSON.stringify(await r.checkFood({food:{name:'Local Bounti Spring Mix'},profile:p.profile}),null,1))"
```

Expect source 'web' with a host and per-serving numbers, or verdict 'unknown'; never invented numbers. Not run here (no keys in this worktree).

## Existing tests edited (and why)

- renal/contract.test.mjs "returns a failure object instead of throwing when USDA is offline" renamed "a USDA outage with no web result is an honest unknown, not a failure": USDA failure no longer fails a check; now asserts ok:true, verdict unknown, source none and the cannot-judge say; also removes GOOGLE_API_KEY for its duration (restored after).
- agent/tools.test.mjs "unclear and failed pictures give unclear_picture" split into three: failed describeImage -> vision_failed, unclear -> unclear_picture (/closer/), no named foods -> no_food_seen. The failed-describeImage expectation legitimately changed.
- agent/tools.test.mjs "a module returning ok:false with a url becomes our own error": the look_at_camera half now expects ok:true with unjudged:true (was ok:false); the no-leak assertions (SECRET123, http, boom, stack) are unchanged and still apply to both results; the check_food half is unchanged.
- renal/gemini.test.mjs, renal/check.test.mjs: only appended tests. No tests deleted.

## Contract-relevant changes for other track owners (README "Shared contract" untouched)

- checkFood result `source` gains the value 'web'.
- checkFood(input, { ai }) and lookupFood(food, { ai }) accept an optional second argument (injected Gemini client, for tests).
- lookupFood no longer returns ok:false on USDA failure; seed matches from the generic fallback carry `genericFrom` (the spoken name) and checkFood reasons/portion say "judged as <seed>".
- describeImage food names for plate/fridge/shelf are now generic (no brand/marketing words); labels keep the printed product name.
- look_at_camera: new failure codes vision_failed and no_food_seen; check_failed is no longer returned by it; optional result fields `unjudged` and `online`. A look that saw foods is always ok:true and remembers home fridge/shelf foods (so pantry/suggest_meal work).
- check_food and look_at_camera may now take up to ~8 s (USDA 2.4 s + web 5.5 s) in the worst case, inside the 12 s guard.
- New env keys RENAL_LOOKUP_MODEL, RENAL_LOOKUP_FALLBACK_MODEL (both commented in .env.example).
- cache.json gains a `web` namespace (old files without it work). The agent log line is now `[agent] tool <name> ok=true|false [error=<code>]`, code limited to `^[a-z_]{1,40}$`, else `other`; also `none`, `tool_exception`, `bad_output`, tool name `unknown_tool`.

## Residual limitations

- Live grounded behaviour is untested here (stubs only); models sometimes answer from memory without grounding, which is rejected and reported as "cannot judge".
- Grounded numbers cannot be verified against the page; mitigated by bounds, match check, and the spoken "found online" note. Bounds are loose (sodium 5000 per serving) so a wrong-but-plausible number could pass.
- Web results with a serving in ml scale by grams as if 1 g = 1 ml when the caller gives grams.
- look_at_camera rows cap spoken verdicts at 130/60 chars, which can cut the provenance sentence; the tool description tells the model to say it once when `online:true`.
- The generic seed fallback is deliberately narrow: only exact trailing 1-3 word seed names, refused when a dropped word is a risk word or a food. Brand names that hide a risky product (e.g. "Brand Crunchy Leaf" where the dropped words are unknown) still resolve to the plain seed.
- Web miss cache is in-memory (10 minutes); a process restart retries.
- A cache.json read failure inside the web step returns ok:false (unexpected-throw path only).

## Deviations

None from the plan's behaviour. Minor: the web say for the Oatly sample is "avoid" (not "limit") with the test profile because phosphorus 270 mg is 27% of 1000 mg; check tests assert that. lookupWeb returns `{ok:true, found:false}` on any throw rather than `{ok:false}` (plan's "never throws" wording).

## Self-Check: PASSED

All six commits present in `git log 44f6bdb..HEAD`; renal/websearch.mjs, agent/toollog.mjs, renal/lookup.test.mjs, renal/vision.test.mjs, agent/toollog.test.mjs exist; grep checks: no responseSchema/responseMimeType in websearch.mjs outside a comment, googleSearch present, no check_failed in look_at_camera.
