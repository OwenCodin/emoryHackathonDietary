# emoryHackathonDietary

## Getting started

- Node 24 (22.23.2 or later also works).
- `npm install`
- `cp .env.example .env.local`, then put real keys only in `.env.local`. Git ignores it. Never commit or paste keys.
- `npm start` runs the agent. Without LiveKit keys it waits for `chert dev`, which is expected.
- `npm test` runs the contract test against the stubs. It needs no keys and no network.

Track guides, which also hold the shared contract:

- [agent/README.md](agent/README.md): Track A, the call
- [renal/README.md](renal/README.md): Track B, the renal brain
- [actions/README.md](actions/README.md): Track C, cart, calls and texts
