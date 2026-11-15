---
phase: quick-261114-tk4
plan: 01
subsystem: actions/kroger, actions/cart, agent/tools
tags: [kroger, per-caller, open-access]
key-files:
  modified: [actions/kroger.mjs, actions/kroger-signin.mjs, actions/cart.mjs, agent/tools.mjs, agent/fake-modules.mjs, README.md, actions/README.md]
  tests: [actions/kroger.test.mjs, actions/kroger-signin.test.mjs, actions/cart.test.mjs, agent/kroger.test.mjs]
metrics:
  completed: 2026-11-14
---

# Quick 261114-tk4: Per-caller Kroger sign-in and cart

One sign-in controller per patient, `tokenDirFor` allow-list (`^[pg][0-9a-f]{24}$`) for per-caller token folders, cart run and status scoped to the calling patient, `patientId` passed from every tool call site. Demo (undefined, null, 'demo') keeps the base folder and file names.

## Commits
- 0dcd8da feat: tokenDirFor and per-patient sign-in controllers
- baf15a9 feat: cart uses the calling patient's folder, status scoped to owner
- 4fbf9b7 feat: patientId through tools.mjs, fakes, tests, READMEs

## Tests
Baseline 765/765. Final `node --test`: 782 tests, 782 pass, 0 fail (17 new).

## Deviations from Plan
- Worktree started on a different base; hard-reset to bbb4a73 as instructed.
- `secureFolder` was not changed: the test showed `callers` is created 0700 already.
- Plan verify commands cd into a different checkout; run from this worktree instead.
- Invalid-id wrappers in kroger-signin.mjs answer without a controller; getKrogerStatus for them still reports `configured` from readKrogerConfig (no disk access).

## Known leftovers
Guest folders are not cleaned up (documented). kroger-login.mjs is demo-only. stopCart unscoped.

## Self-Check: PASSED
