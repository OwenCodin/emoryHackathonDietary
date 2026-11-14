// Kroger sign-in through the public relay (kroger-relay/). The agent texts a link; the patient signs in on their
// phone; Kroger redirects to the relay, which keeps only the one-time code. This module polls the relay's claim
// endpoint over outbound HTTPS with a shared secret and exchanges the code locally, so the Kroger client secret
// never leaves this machine. The refresh token lands in the existing token store (actions/kroger.mjs).
//
// Nothing here throws. Results carry only short codes; the only sensitive-looking value ever returned is the link
// from startKrogerSignIn (the texted link is the one place a state appears). Logging is one value-free line per outcome.
//
// getKrogerStatus().connected is only a check that a stored sign-in exists. A refresh would rotate the refresh
// token, add up to 10 s of network on a live call and could race a running cart's own refresh. The cost: a revoked or
// expired sign-in reads as connected until the cart reports it (the agent maps that cart failure to "not connected").
import { randomBytes } from 'node:crypto';
import { createKrogerClient, createTokenStore, readKrogerConfig } from './kroger.mjs';

const MIN_SECRET = 32;
const MAX_CODE = 2048;

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

// Returns { relayUrl, secret } or null. The URL must be https (http only for localhost / 127.0.0.1) with no
// credentials, query, hash or path beyond "/".
export function readRelayConfig(env = process.env) {
  const raw = clean(env.KROGER_RELAY_URL);
  const secret = clean(env.KROGER_RELAY_SECRET);
  if (!raw || secret.length < MIN_SECRET) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  if (raw.includes('?') || raw.includes('#')) return null;
  return { relayUrl: url.origin, secret };
}

export const relayRedirectUri = (relayUrl) => `${relayUrl}/api/kroger/callback`;

export function createKrogerSignIn({
  env = process.env,
  fetchImpl = fetch,
  createClient = createKrogerClient,
  createStore = createTokenStore,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = Date.now,
  randomState = () => randomBytes(32).toString('base64url'),
  pollMs = 2000,
  maxWaitMs = 240_000,
  requestTimeoutMs = 5000,
  unrefTimers = true,
} = {}) {
  let generation = 0;
  let pending = null; // { gen, finish, timers: Set }

  const timer = (fn, ms) => {
    const t = setTimer(fn, ms);
    if (unrefTimers && t && typeof t.unref === 'function') t.unref();
    return t;
  };

  function endPending(outcome) {
    const p = pending;
    if (!p) return;
    pending = null;
    for (const t of p.timers) clearTimer(t);
    p.timers.clear();
    p.resolve(outcome);
  }

  function cancel() {
    generation += 1;
    endPending({ ok: false, error: 'cancelled' });
  }

  async function claimOnce(config, relay, state) {
    let res;
    try {
      res = await fetchImpl(`${relay.relayUrl}/api/kroger/claim`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${relay.secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch {
      return { keepGoing: true };
    }
    if (res.status === 401 || res.status === 403) return { stop: 'relay_rejected' };
    if (res.status !== 200) return { keepGoing: true };
    let code;
    try {
      code = (await res.json())?.code;
    } catch {
      return { stop: 'exchange_failed' };
    }
    if (typeof code !== 'string' || code.length < 1 || code.length > MAX_CODE) return { stop: 'exchange_failed' };
    return { code };
  }

  async function poll(gen, config, relay, state) {
    if (gen !== generation || !pending) return;
    const claimed = await claimOnce(config, relay, state);
    if (gen !== generation || !pending) return;
    if (claimed.stop) return finish(gen, { ok: false, error: claimed.stop });
    if (claimed.code) {
      let result;
      try {
        const client = createClient({
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          locationId: config.locationId,
          tokenStore: createStore({ dir: config.tokenDir }),
          fetchImpl,
        });
        result = await client.exchangeCode({ code: claimed.code, redirectUri: relayRedirectUri(relay.relayUrl) });
      } catch {
        result = { ok: false };
      }
      if (gen !== generation || !pending) return;
      return finish(gen, result?.ok ? { ok: true } : { ok: false, error: 'exchange_failed' });
    }
    const next = timer(() => {
      pending?.timers.delete(next);
      void poll(gen, config, relay, state);
    }, pollMs);
    pending.timers.add(next);
  }

  function finish(gen, outcome) {
    if (gen !== generation) return;
    console.log(outcome.ok ? '[actions] kroger sign-in connected' : `[actions] kroger sign-in ended (${outcome.error})`);
    endPending(outcome);
  }

  async function startKrogerSignIn() {
    try {
      const config = readKrogerConfig(env);
      if (!config) return { ok: false, error: 'not_configured' };
      const relay = readRelayConfig(env);
      if (!relay) return { ok: false, error: 'no_relay' };
      cancel();
      const gen = generation;
      const state = randomState();
      let resolveFn;
      const promise = new Promise((r) => {
        resolveFn = r;
      });
      pending = { gen, promise, resolve: resolveFn, timers: new Set() };
      const deadline = timer(() => finish(gen, { ok: false, error: 'timed_out' }), maxWaitMs);
      pending.timers.add(deadline);
      const first = timer(() => {
        pending?.timers.delete(first);
        void poll(gen, config, relay, state);
      }, pollMs);
      pending.timers.add(first);
      return { ok: true, link: `${relay.relayUrl}/k/${state}` };
    } catch {
      return { ok: false, error: 'not_configured' };
    }
  }

  async function getKrogerStatus() {
    try {
      const config = readKrogerConfig(env);
      const relay = readRelayConfig(env) !== null;
      if (!config) return { ok: true, configured: false, relay, connected: false, pending: false };
      const stored = await createStore({ dir: config.tokenDir }).load();
      return { ok: true, configured: true, relay, connected: stored !== null, pending: pending !== null };
    } catch {
      return { ok: true, configured: true, relay: false, connected: false, pending: pending !== null };
    }
  }

  function waitForKrogerSignIn() {
    return pending ? pending.promise : Promise.resolve({ ok: false, error: 'no_pending' });
  }

  return { startKrogerSignIn, getKrogerStatus, waitForKrogerSignIn, cancel };
}

const controller = createKrogerSignIn();
export const startKrogerSignIn = () => controller.startKrogerSignIn();
export const getKrogerStatus = () => controller.getKrogerStatus();
export const waitForKrogerSignIn = () => controller.waitForKrogerSignIn();
