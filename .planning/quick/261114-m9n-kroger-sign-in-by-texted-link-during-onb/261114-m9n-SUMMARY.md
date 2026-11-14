# Quick 261114-m9n: Kroger sign-in by texted link during setup - Summary

**One-liner:** A Vercel relay (`kroger-relay/`, not deployed) holds only Kroger's one-time code; the agent's Mac polls it with a shared secret, exchanges locally, and the agent texts the patient a sign-in link during first-call setup.

## Result

- `npm test`: 615 passing, 0 failing (base 559), no `.env.local`.
- Sim (`node agent/sim/onboarding-run.mjs`): PASS, estimate 203 s (was 164 s). Setup script about 245 words (cap 300).
- `@vercel/blob` pinned at exact 2.9.0 (read from the packed types; not installed).
- Commits: 617fd18 (relay), 3c5644c (actions), 4bf20bb (agent tools and prompt), f3b5e47 (docs, contract in one commit).

## `connected` trade-off

`getKrogerStatus().connected` only checks that a stored sign-in exists. A refresh would rotate the refresh token, add up to 10 s on a live call and could race the cart's own refresh. An expired or revoked sign-in reads as connected until the cart fails; `cart_status` then returns `kroger_not_connected`.

## Deviations

- Commit trailer: the harness attribution reminder said `Claude Sonnet 5.5`; the environment note said `Claude Fable 5.2` and the plan said `Opus 5.5`. I used the harness reminder.
- The plan's verify command `node --test kroger-relay/` fails on Node 24 (a directory argument is not accepted); I ran the test file by path. Root `npm test` picks it up.
- Worktree base was not cd73fd6; reset --hard to it as instructed.

## Not verified

The deployed relay, the `/k/:state` rewrite on Vercel, Blob on Vercel (including the "already exists" error message used to detect a repeated state), the Kroger redirect-URI switch, the texted link on a real phone, and a real end-to-end sign-in. Verified instead: relay handler tests, actions tests, and a local loopback end-to-end test with a fake Kroger token endpoint.

## Self-Check: PASSED
