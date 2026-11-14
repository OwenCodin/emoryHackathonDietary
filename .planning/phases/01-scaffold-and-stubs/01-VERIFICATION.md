---
phase: 01-scaffold-and-stubs
verified: 2026-11-13T00:00:00Z
status: passed
score: 12/12 must-haves verified
overrides_applied: 0
---

# Phase 1: Scaffold and stubs Verification Report

**Phase Goal:** A teammate can clone the repo, start the agent process, and develop their own track against stubs that match the shared contract
**Status:** passed
**Re-verification:** No, initial verification

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Fresh clone, `npm install` then `npm start`, process starts | VERIFIED | Cloned `agent` branch to a temp dir, `npm ci` succeeded, `npm start` with placeholder env and temp CHERT_HOME printed both `[chert]` lines (No LiveKit keys; Waiting for chert dev) and stayed running. `pgrep` found nothing afterwards. |
| SC2 | Stubs return contract shapes, offline, never throw | VERIFIED | Read renal/index.mjs and actions/index.mjs: all exports present, async except getCartFrame (sync, null), default `{}` params. `npm test`: 13/13 pass, includes fetch-throwing guard. |
| SC3 | video constants only in shared/video.mjs, agent reads from there | VERIFIED | grep for WIDTH/HEIGHT/FPS assignments matches only shared/video.mjs (1280, 720, 15). agent.mjs and face.mjs import from `../shared/video.mjs`; face test checks the 1280*720*4 length. |
| SC4 | .env.example has all variables as placeholders; ignores work | VERIFIED | All 11 variables present with YOUR_ placeholders or empty. `git check-ignore -v` ignores .env.local, node_modules, actions/.browser-profile/x. `git ls-files` has no .env.local or browser-profile. |
| D-01 | package.json matches the contract; lockfile committed | VERIFIED | package.json identical to contract; installed versions 1.8.0 / 1.8.0 / 0.13.35; package-lock.json tracked; `npm ci` works. |
| D-04 | greet/chert-rooms byte-identical; READMEs unchanged | VERIFIED | sha256 0022f7ae... and ddf28480... match. `git diff 0d16bb2 HEAD` on the three track READMEs is empty. agent/ holds only the expected 7 files. |
| D-05 | Gemini realtime model, no openai import | VERIFIED | agent.mjs uses `google.realtime.RealtimeModel` with `GEMINI_LIVE_MODEL \|\| 'gemini-3.8-live'` and voice Puck. No agents-plugin-openai anywhere. |
| D-06 | Starter call flow kept; renal-dietitian instructions | VERIFIED | AUDIO_ONLY connect, waitForParticipant, one camera track, greetOnBridgeReady, videoEnabled false all present. Instructions say AI and care-team limits. |
| D-07 | One anonymous check_food tool wired to renal stub | VERIFIED | tools.mjs exports buildTools returning only check_food (no name option), calling getProfile and checkFood; agent.mjs passes it to voice.Agent. Tested. |
| D-09 | renal/ and actions/ contain only README.md and index.mjs | VERIFIED | `ls -A` confirms. |
| D-10 | npm test exits 0 | VERIFIED | 13 tests, 0 fail, in repo and in the fresh clone. |
| D-11 | npm start waits without keys, no crash on missing GOOGLE_API_KEY | VERIFIED | See SC1. |
| D-12 | Root README Getting started | VERIFIED | Title kept, Node version, npm install, cp .env.example, npm start, npm test, three track links. |

**Score:** 12/12

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| SCAF-01 | SATISFIED | Fresh-clone `npm ci` and `npm start` boot, waiting for chert dev. |
| SCAF-02 | SATISFIED | Single definition in shared/video.mjs, imported by agent and face. |
| SCAF-03 | SATISFIED | Stubs match contract; contract test passes offline. |
| SCAF-04 | SATISFIED | .env.example and .gitignore verified. |

No orphaned requirements: REQUIREMENTS.md maps only SCAF-01 to SCAF-04 to Phase 1, and all four are claimed by plan 01-01.

### Anti-Patterns

No TBD, FIXME, XXX or TODO markers in phase files. Stubs are intentional and documented. Working tree clean; `.env.local` ignored and untracked, and was never read.

### Human Verification Required

None. Real keys and a real call belong to Phase 2. The merge of `agent` into `main` is the person's decision and is not a gap.

### Gaps Summary

None. The phase goal is achieved in the codebase.

---

_Verified: 2026-11-13_
_Verifier: Claude (gsd-verifier)_
