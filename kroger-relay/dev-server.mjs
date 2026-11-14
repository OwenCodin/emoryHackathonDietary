// Local check only: node kroger-relay/dev-server.mjs  (PORT defaults to 8787). Uses the in-memory store.
import { createServer } from 'node:http';
import { createMemoryStore } from './lib/memory-store.mjs';
import { createNodeHandler } from './lib/node-adapter.mjs';
import { createRelay } from './lib/relay.mjs';

const port = Number(process.env.PORT ?? 8787);
const server = createServer(createNodeHandler(createRelay({ store: createMemoryStore() })));
server.listen(port, '127.0.0.1', () => console.log(`kroger-relay dev server on http://127.0.0.1:${port}`));
