// Kroger sign-in through the public relay (kroger-relay/). The agent texts a link; the patient signs in on their
// phone; Kroger redirects to the relay, which keeps only the one-time code. This module polls the relay's claim
// endpoint over outbound HTTPS with a shared secret and exchanges the code locally, so the Kroger client secret
// never leaves this machine. The refresh token lands in the existing token store (actions/kroger.mjs).
//
// Finishing later: startKrogerSignIn also writes kroger-signin-pending.json (state and start time only, mode 600 in
// the 700 token folder, atomic) beside the token file. The state therefore appears only in the texted link and that
// file. Any later process resumes it (getKrogerStatus, or the cart's no-sign-in path): one claim with a short timeout,
// exchange, save, delete the record. A 404 keeps the record; a record older than the relay's 10-minute window, a
// rejected exchange or a malformed file is deleted; a relay 401/403 keeps it (a secret problem, not the patient's).
// The relay hands a code out once, so a second claim from anywhere is a harmless 404 and the token is never saved twice.
//
// Nothing here throws. Results carry only short codes; the only sensitive-looking value ever returned is the link
// from startKrogerSignIn (the texted link is the one place a state appears). Logging is one value-free line per outcome.
//
// getKrogerStatus().connected is only a check that a stored sign-in exists. A refresh would rotate the refresh
// token, add up to 10 s of network on a live call and could race a running cart's own refresh. The cost: a revoked or
// expired sign-in reads as connected until the cart reports it (the agent maps that cart failure to "not connected").
import { randomBytes } from 'node:crypto';
import { createKrogerClient, createPendingSignInStore, createTokenStore, readKrogerConfig } from './kroger.mjs';

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
  createPendingStore = createPendingSignInStore,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = Date.now,
  randomState = () => randomBytes(32).toString('base64url'),
  pollMs = 2000,
  maxWaitMs = 240_000,
  requestTimeoutMs = 5000,
  unrefTimers = true,
  codeTtlMs = 600_000, // mirror of the relay's CODE_TTL_MS
  resumeWaitMs = 2500,
  resumeRequestTimeoutMs = 2000,
} = {}) {
  let generation = 0;
  let pending = null; // { gen, state, promise, resolve, timers: Set }
  let resumeFlight = null;

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

  // cancel keeps the pending record: another process may still claim it within the relay's window.
  function cancel() {
    generation += 1;
    endPending({ ok: false, error: 'cancelled' });
  }

  async function claimOnce(relay, state, timeoutMs) {
    let res;
    let guard;
    try {
      const request = fetchImpl(`${relay.relayUrl}/api/kroger/claim`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${relay.secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      request.catch?.(() => {});
      // A fetch that ignores its abort signal must not hold a claim (or the resume slot) forever.
      const hung = new Promise((resolve) => {
        guard = setTimeout(() => resolve(null), timeoutMs + 500);
        guard.unref?.();
      });
      res = await Promise.race([request, hung]);
      if (!res) return { keepGoing: true };
    } catch {
      return { keepGoing: true };
    } finally {
      if (guard) clearTimeout(guard);
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

  async function exchange(config, relay, code) {
    try {
      const client = createClient({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        locationId: config.locationId,
        tokenStore: createStore({ dir: config.tokenDir }),
        fetchImpl,
      });
      const result = await client.exchangeCode({ code, redirectUri: relayRedirectUri(relay.relayUrl) });
      return { ok: result?.ok === true };
    } catch {
      return { ok: false };
    }
  }

  async function removeRecord(config, state) {
    try {
      await createPendingStore({ dir: config.tokenDir }).remove({ ifState: state });
    } catch {
      // the record expires by age
    }
  }

  async function poll(gen, config, relay, state) {
    if (gen !== generation || !pending) return;
    const claimed = await claimOnce(relay, state, requestTimeoutMs);
    if (gen !== generation || !pending) return;
    if (claimed.stop) {
      // relay_rejected keeps the record (a secret problem); a bad code is settled, the relay already deleted it.
      return finish(gen, { ok: false, error: claimed.stop }, { config, state, remove: claimed.stop === 'exchange_failed' });
    }
    if (claimed.code) {
      const result = await exchange(config, relay, claimed.code);
      if (gen !== generation || !pending) return;
      return finish(gen, result.ok ? { ok: true } : { ok: false, error: 'exchange_failed' }, { config, state, remove: true });
    }
    const next = timer(() => {
      pending?.timers.delete(next);
      void poll(gen, config, relay, state);
    }, pollMs);
    pending.timers.add(next);
  }

  // remove: true deletes the pending record (settled either way); otherwise it is kept so a later process can still
  // claim it. The record is gone before waitForKrogerSignIn() resolves.
  async function finish(gen, outcome, { config, state, remove = false } = {}) {
    if (gen !== generation) return;
    console.log(outcome.ok ? '[actions] kroger sign-in connected' : `[actions] kroger sign-in ended (${outcome.error})`);
    if (!remove || !config) return endPending(outcome);
    const p = pending;
    if (!p || p.gen !== gen) return;
    pending = null;
    for (const t of p.timers) clearTimer(t);
    p.timers.clear();
    await removeRecord(config, state);
    p.resolve(outcome);
  }

  async function resumeInner(given) {
    const config = given ?? readKrogerConfig(env);
    if (!config) return { resumed: 'none' };
    const store = createPendingStore({ dir: config.tokenDir });
    const record = await store.load();
    if (!record) return { resumed: 'none' };
    const { state } = record;
    const age = now() - record.startedAt;
    if (age > codeTtlMs || age < -60_000) {
      await store.remove({ ifState: state });
      console.log('[actions] kroger sign-in ended (expired)');
      return { resumed: 'expired' };
    }
    const relay = readRelayConfig(env);
    if (!relay) return { resumed: 'none' };
    if (pending && pending.state === state) return { resumed: 'waiting' }; // the poller owns this one
    const claimed = await claimOnce(relay, state, resumeRequestTimeoutMs);
    if (claimed.keepGoing) return { resumed: 'waiting' };
    if (claimed.stop === 'relay_rejected') {
      console.log('[actions] kroger sign-in ended (relay_rejected)');
      return { resumed: 'failed' };
    }
    if (claimed.stop) {
      await store.remove({ ifState: state });
      console.log('[actions] kroger sign-in ended (exchange_failed)');
      return { resumed: 'failed' };
    }
    const result = await exchange(config, relay, claimed.code);
    await store.remove({ ifState: state });
    console.log(result.ok ? '[actions] kroger sign-in connected (resumed)' : '[actions] kroger sign-in ended (exchange_failed)');
    if (result.ok && pending && pending.state === state) endPending({ ok: true });
    return { resumed: result.ok ? 'connected' : 'failed' };
  }

  // Resume a sign-in the patient finished after the process that texted the link ended. Never throws; resolves
  // { resumed: 'waiting' } after resumeWaitMs while the work carries on in the background.
  function resumePendingSignIn({ config } = {}) {
    if (!resumeFlight) {
      const work = Promise.resolve()
        .then(() => resumeInner(config))
        .catch(() => ({ resumed: 'none' }))
        .finally(() => {
          if (resumeFlight === work) resumeFlight = null;
        });
      resumeFlight = work;
    }
    const flight = resumeFlight;
    return new Promise((resolve) => {
      const t = setTimer(() => resolve({ resumed: 'waiting' }), resumeWaitMs);
      if (t && typeof t.unref === 'function') t.unref();
      flight.then((r) => {
        clearTimer(t);
        resolve(r);
      });
    });
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
      try {
        const saved = await createPendingStore({ dir: config.tokenDir }).save({ state, startedAt: now() });
        if (!saved?.ok) console.log('[actions] kroger sign-in not remembered');
      } catch {
        console.log('[actions] kroger sign-in not remembered');
      }
      if (gen !== generation) return { ok: false, error: 'not_configured' };
      let resolveFn;
      const promise = new Promise((r) => {
        resolveFn = r;
      });
      pending = { gen, state, promise, resolve: resolveFn, timers: new Set() };
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
      try {
        await resumePendingSignIn({ config });
      } catch {
        // a resume problem never changes the answer
      }
      const stored = await createStore({ dir: config.tokenDir }).load();
      const connected = stored !== null;
      let isPending = pending !== null;
      if (!isPending && !connected) isPending = (await createPendingStore({ dir: config.tokenDir }).load()) !== null;
      return { ok: true, configured: true, relay, connected, pending: connected ? false : isPending };
    } catch {
      return { ok: true, configured: true, relay: false, connected: false, pending: pending !== null };
    }
  }

  function waitForKrogerSignIn() {
    return pending ? pending.promise : Promise.resolve({ ok: false, error: 'no_pending' });
  }

  return { startKrogerSignIn, getKrogerStatus, waitForKrogerSignIn, resumePendingSignIn, cancel };
}

const controller = createKrogerSignIn();
export const startKrogerSignIn = () => controller.startKrogerSignIn();
export const getKrogerStatus = () => controller.getKrogerStatus();
export const waitForKrogerSignIn = () => controller.waitForKrogerSignIn();
export const resumeKrogerSignIn = (opts) => controller.resumePendingSignIn(opts);
