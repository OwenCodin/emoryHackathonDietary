# kroger-relay

A small public relay so a patient can sign in to Kroger on their phone while on a FaceTime call with the agent.

Kroger redirects the browser to a registered HTTPS address with a one-time authorization code. The agent's Mac is not reachable from a phone, so this relay receives that redirect and keeps the code for a moment. The Mac fetches it over outbound HTTPS and does the secret-bearing exchange itself.

## What it holds, and what it never holds

- It holds only the one-time authorization code, keyed by a random state. A code is deleted when claimed, refused after 10 minutes, and swept on later callbacks.
- It never holds the Kroger client secret or any access or refresh token. Its environment has only `KROGER_CLIENT_ID` (not a secret), `RELAY_SECRET` and optionally `RELAY_PUBLIC_URL`.
- It never logs anything, and no page shows the code or the state.

## Routes

| Route | Method | What it does |
| --- | --- | --- |
| `/k/<state>` (rewritten to `/api/k?state=<state>`) | GET | Checks the state is exactly 43 URL-safe characters, then redirects (302) to Kroger's authorize page with the relay callback as `redirect_uri`. Stores nothing. |
| `/api/kroger/callback` | GET | Kroger's redirect target. Stores `{ code, at }` under the state and shows "Kroger is connected. You can go back to your call." On a Kroger error shows "not finished" and stores nothing. |
| `/api/kroger/claim` | POST | The agent's Mac sends `Authorization: Bearer <RELAY_SECRET>` and `{"state":"..."}`. Returns `{"code":"..."}` once and deletes it; later claims and codes older than 10 minutes give 404. |

Environment (set on Vercel): `KROGER_CLIENT_ID`, `RELAY_SECRET` (32 characters or more), `RELAY_PUBLIC_URL` (the production domain, no trailing slash). Blob access needs no variable: the store connection adds OIDC credentials and `BLOB_STORE_ID` automatically.

## Deploy (a person does this; nothing here has been deployed)

Flags below were checked against `vercel --version` (59.5.0) and `--help` for `link`, `blob create-store`, `env add` and `deploy`.

1. `cd kroger-relay`, then `vercel login`.
2. `vercel link`. Create a new project (for example `renaline-kroger-relay`), framework Other, in this folder.
3. `vercel blob create-store renaline-kroger-codes --access private --yes`. This connects the store to the project for all environments; OIDC credentials and `BLOB_STORE_ID` are added automatically, so there is no token to copy.
4. Generate the shared secret without showing it, add it to Vercel and to `.env.local`, then add the client id. In zsh:
   ```
   SECRET=$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))")
   printf %s "$SECRET" | vercel env add RELAY_SECRET production
   printf 'KROGER_RELAY_SECRET=%s\n' "$SECRET" >> ../.env.local
   unset SECRET
   vercel env add KROGER_CLIENT_ID production
   ```
   Paste the Kroger client id when asked (it is not a secret).
5. `vercel deploy --prod`. Note the production domain `https://<project>.vercel.app`, not the per-deployment URL, which Deployment Protection blocks. Then `vercel env add RELAY_PUBLIC_URL production` with that domain (no trailing slash), and `vercel deploy --prod` again.
6. Check: `curl -sI https://<domain>/k/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` (43 `A` characters) must show `302` and a `location: https://api.kroger.com/...` header containing `redirect_uri=https%3A%2F%2F<domain>%2Fapi%2Fkroger%2Fcallback`.
7. On developer.kroger.com, set the app's redirect URI to exactly `https://<domain>/api/kroger/callback`. After this, `http://localhost:8765/callback` no longer works (the app has one redirect URI).
8. Add `KROGER_RELAY_URL=https://<domain>` to `.env.local` (the secret line was added in step 4).
9. Test the sign-in without a call: `node --env-file=.env.local actions/kroger-login.mjs` prints a link; open it on a phone, sign in, and expect "Kroger sign-in saved." Then restart `npm start` so the agent sees the new keys.

## Local check

`PORT=8787 node kroger-relay/dev-server.mjs` serves the relay on `127.0.0.1:8787` with an in-memory store. Set `KROGER_CLIENT_ID` and `RELAY_SECRET` in the environment to exercise the routes. `npm test` at the repo root runs the relay tests (no network, no install) and the local end-to-end test.

## Verified / not verified

Verified: the handler tests (`lib/relay.test.mjs`), the local server end-to-end test (`actions/kroger-relay-e2e.test.mjs`, with a fake Kroger token endpoint), and the `@vercel/blob` 2.9.0 call signatures, read from the package's type files.

Not verified: the deployed functions, the `/k/:state` rewrite on Vercel (the handler also reads the state from the path as a fallback), Blob on Vercel (including the message used to detect an existing pathname), the Kroger redirect-URI switch, the texted link on a real phone, and a real sign-in.
