import { createBlobStore } from '../../lib/blob-store.mjs';
import { createRelay } from '../../lib/relay.mjs';

let relay;
const get = () => (relay ??= createRelay({ store: createBlobStore() }));

export const GET = (request) => get().callback(request);
