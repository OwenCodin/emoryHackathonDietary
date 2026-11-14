# Quick 261114-k0g: Kroger API cart path Summary

Kroger public-API cart path beside the browser cart: `startCart` uses app-token product search plus `PUT /v1/cart/add` with the patient's stored sign-in when both Kroger keys are set; one-time sign-in script saves the refresh token outside the repo (700/600).

## Commits
- 5e675e2 feat(actions): Kroger public API client (kroger.mjs, kroger.test.mjs)
- f9a0ec8 feat(actions): Kroger API cart path and sign-in script (cart.mjs, cart.test.mjs, kroger-login.mjs)
- 70a1827 docs(actions): Kroger API cart path (.env.example, actions/README.md)

## Official docs confirmation
Not confirmed. developer.kroger.com pages are JavaScript-rendered and fetching them (and guessed OpenAPI URLs) returned no readable content. Implemented the third-party description: PUT /v1/cart/add, scope cart.basic:write, body {items:[{upc, quantity, modality:"PICKUP"}]}, success 2xx (204), authorization_code and refresh_token grants with Basic auth, rotated refresh_token saved if returned. The README says so.

## Rules
- API path used when KROGER_CLIENT_ID and KROGER_CLIENT_SECRET are both non-empty; otherwise browser path unchanged. No other switch.
- Sign-in stored at ~/.config/renal-dietitian/kroger-tokens.json (or KROGER_TOKEN_DIR), folder 700, file 600, refused inside the repo.
- Sign-in command: `node --env-file=.env.local actions/kroger-login.mjs`

## Tests
`npm test`: 441 tests, 441 pass, 0 fail (no .env.local, no network). 13 new in kroger.test.mjs, 8 new in cart.test.mjs.

## Read-only live check (app token + product search at 01100695 only)
- unsalted butter -> Kroger Unsalted Butter Sticks, $3.59, 0001111089305
- white rice -> Kroger Enriched Long Grain White Rice, $1.89, 0001111089875
- apples -> Kroger Honeycrisp Apples - 4 Pack Tray, $5.00, 0001111070110 (a 4-pack tray; first priced match in Kroger's order, left as is)

No sign-in, refresh, code exchange or add-to-cart was run live.

## Deviations
None of substance. TDD note: tests and module were written in one pass, so the RED run was skipped (tests passed on first run). Redirect URI default http://localhost:8765/callback is now confirmed registered (authorize returns the Kroger login page), and the README states that.

## Shared contract env table
The Shared contract "Environment variables" table (identical in the three track READMEs) is untouched and lacks the five keys. Proposed rows:

| Variable | Purpose |
|---|---|
| `KROGER_CLIENT_ID` | Kroger public API client id. With the secret, switches the cart to the Kroger API. |
| `KROGER_CLIENT_SECRET` | Kroger public API client secret. |
| `KROGER_LOCATION_ID` | Store for product search. Empty means 01100695 (Kroger - Ponce). |
| `KROGER_REDIRECT_URI` | Sign-in redirect; must match the registered URI. Empty means http://localhost:8765/callback. |
| `KROGER_TOKEN_DIR` | Folder outside the repo for the Kroger sign-in. Empty means ~/.config/renal-dietitian. |

## Human next steps
1. Put KROGER_CLIENT_ID and KROGER_CLIENT_SECRET in .env.local.
2. Run `node --env-file=.env.local actions/kroger-login.mjs` and sign in.
3. Run a first real add-to-cart and check kroger.com/cart; if cart/add differs from the third-party description, adjust kroger.mjs.

## Self-Check: PASSED
