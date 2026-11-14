---
phase: 01-scaffold-and-stubs
reviewed: 2026-11-13T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - package.json
  - .env.example
  - README.md
  - shared/video.mjs
  - renal/index.mjs
  - actions/index.mjs
  - agent/agent.mjs
  - agent/tools.mjs
  - agent/face.mjs
  - agent/contract.test.mjs
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-11-13
**Depth:** standard
**Files Reviewed:** 10 (greet.mjs and chert-rooms.mjs read for context only)

## Summary

Stub shapes match the contract. `getCartFrame` is synchronous and returns null. `drawFace` returns exactly WIDTH*HEIGHT*4 bytes, and the test checks it. `npm test` passes 13/13. The `agent.mjs` calls match the 1.8.0 type definitions: `AgentSessionEventTypes.AgentStateChanged`, the `inputOptions` fields, anonymous `llm.tool` keyed by object name, and `RealtimeModel` options. The zod nullable `grams` converts correctly in the Google plugin's schema converter. No secret is logged or tracked: `.env.local` is ignored and only `.env.example` is tracked. No import-time throw without keys was found. The `RealtimeModel` constructor does not throw without `GOOGLE_API_KEY`. `runAgent` only prints the waiting message.

## Warnings

### WR-01: checkFood stub gives the banana verdict for every food

**File:** `renal/index.mjs:23-34`
**Issue:** The stub always returns verdict `limit` with the "A banana has about 420 milligrams..." text, whatever `food.name` is. `agent/tools.mjs` wires it to the live voice model, so a caller asking about star fruit or salt substitute hears wrong health advice about a banana.
**Fix:** For a non-banana name, return `verdict: 'unknown'`, `source: 'none'`, `nutrients: null`, `say: 'I cannot check that yet.'`. Keep the banana text only for banana.

### WR-02: Frame timer and shutdown callback are not failure-safe

**File:** `agent/agent.mjs:31,34,40-45`
**Issue:** `frame()` runs in a bare `setInterval`. If `captureFrame` throws, for example because the source was closed, the exception is uncaught and kills the whole agent process. In the shutdown callback, if `session.close()` throws, `track.close()` and `source.close()` are skipped, because `chert-rooms` catches per callback, not per statement.
**Fix:** Wrap the body of `frame` in try/catch. In the shutdown callback, use try/finally or `Promise.allSettled([session.close(), track.close(), source.close()])` after `clearInterval`.

### WR-03: `npm start` fails on a fresh clone with no `.env.local`

**File:** `package.json:6`
**Issue:** `node --env-file=.env.local` exits with an error if the file is missing. Phase success criteria and D-11 expect a fresh clone to run. README works around this with a `cp` step, but the script itself is fragile. The test script already uses `--env-file-if-exists`.
**Fix:** Use `--env-file-if-exists=.env.local` in `start`. Update the contract line in all three READMEs in the same commit, as the contract requires.

## Info

### IN-01: Copied placeholder is used as a real Google key

**File:** `.env.example:11`, `agent/agent.mjs:37`
**Issue:** After `cp .env.example .env.local`, `GOOGLE_API_KEY=YOUR_GOOGLE_API_KEY` is truthy. The plugin sends it as the key and fails only on the first call, with an opaque auth error. `GEMINI_LIVE_MODEL=` is empty, which is handled by `||`.
**Fix:** Warn at startup when `GOOGLE_API_KEY` is unset or starts with `YOUR_`, without printing its value.

### IN-02: Stubs can still throw

**File:** `renal/index.mjs:6,19,23,37,50,54`, `actions/index.mjs:4,29,33`
**Issue:** `= {}` defaults only cover `undefined`. Passing `null` throws a TypeError from the destructuring, which breaks the "never throws" rule. `suggestMeals({ count: 1e9 })` allocates a huge array.
**Fix:** Take `args` and use `const { patientId } = args ?? {}`, and cap `count` with `Math.min(count, 5)`.

---

_Reviewed: 2026-11-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
