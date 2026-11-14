import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createKrogerSignIn, getKrogerStatus, readRelayConfig, relayRedirectUri, startKrogerSignIn } from './kroger-signin.mjs';

const RELAY = 'https://relay.example.app';
const RELAY_SECRET = 'R'.repeat(40);
const CLIENT_SECRET = 'client-secret-xyz';
const CODE = 'one-time-code-123';
const REFRESH = 'refresh-token-abc';
const ACCESS = 'access-token-def';
const dirs = [];

const tempDir = async () => {
  const d = await mkdtemp(join(tmpdir(), 'kroger-signin-'));
  dirs.push(d);
  return d;
};
after(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

const baseEnv = (dir, over = {}) => ({
  KROGER_CLIENT_ID: 'cid',
  KROGER_CLIENT_SECRET: CLIENT_SECRET,
  KROGER_TOKEN_DIR: dir,
  KROGER_RELAY_URL: RELAY,
  KROGER_RELAY_SECRET: RELAY_SECRET,
  ...over,
});

// claims: array of responders ({status, body}) or functions; the last one repeats.
function makeFetch(claims, { tokenOk = true } = {}) {
  const log = { claims: [], tokens: [] };
  let n = 0;
  const impl = async (url, init) => {
    if (url === `${RELAY}/api/kroger/claim`) {
      log.claims.push({ headers: init.headers, body: JSON.parse(init.body), method: init.method });
      const step = claims[Math.min(n, claims.length - 1)];
      n += 1;
      if (step === 'throw') throw new Error('network');
      return new Response(JSON.stringify(step.body ?? {}), { status: step.status });
    }
    if (url === 'https://api.kroger.com/v1/connect/oauth2/token') {
      log.tokens.push({ headers: init.headers, body: String(init.body) });
      if (!tokenOk) return new Response('{}', { status: 400 });
      return new Response(JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 1800 }), { status: 200 });
    }
    assert.fail(`unexpected fetch ${url}`);
  };
  return { impl, log };
}

const make = (env, fetchImpl, extra = {}) =>
  createKrogerSignIn({ env, fetchImpl, pollMs: 10, maxWaitMs: 250, unrefTimers: false, ...extra });

function captureConsole() {
  const lines = [];
  const orig = { log: console.log, error: console.error };
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  return { lines, restore: () => Object.assign(console, orig) };
}

test('readRelayConfig validates the url and secret', () => {
  const ok = { KROGER_RELAY_URL: `${RELAY}/`, KROGER_RELAY_SECRET: RELAY_SECRET };
  assert.deepEqual(readRelayConfig(ok), { relayUrl: RELAY, secret: RELAY_SECRET });
  assert.deepEqual(readRelayConfig({ ...ok, KROGER_RELAY_URL: 'http://localhost:8787' })?.relayUrl, 'http://localhost:8787');
  assert.equal(readRelayConfig({ ...ok, KROGER_RELAY_URL: 'http://127.0.0.1:9' })?.relayUrl, 'http://127.0.0.1:9');
  for (const bad of ['http://relay.example.app', 'https://u:p@relay.example.app', `${RELAY}/x`, `${RELAY}/?a=1`, `${RELAY}/#h`, 'nonsense', '']) {
    assert.equal(readRelayConfig({ ...ok, KROGER_RELAY_URL: bad }), null, bad);
  }
  assert.equal(readRelayConfig({ ...ok, KROGER_RELAY_SECRET: 'short' }), null);
  assert.equal(readRelayConfig({}), null);
  assert.equal(relayRedirectUri(RELAY), `${RELAY}/api/kroger/callback`);
});

test('start reports not_configured and no_relay', async () => {
  const dir = await tempDir();
  const { impl } = makeFetch([{ status: 404 }]);
  assert.deepEqual(await make({ KROGER_TOKEN_DIR: dir }, impl).startKrogerSignIn(), { ok: false, error: 'not_configured' });
  const noRelay = baseEnv(dir, { KROGER_RELAY_URL: '', KROGER_RELAY_SECRET: '' });
  assert.deepEqual(await make(noRelay, impl).startKrogerSignIn(), { ok: false, error: 'no_relay' });
});

test('start returns only a link and polling exchanges the claimed code', async () => {
  const dir = await tempDir();
  const { impl, log } = makeFetch([{ status: 404 }, { status: 404 }, { status: 200, body: { code: CODE } }]);
  const si = make(baseEnv(dir), impl);
  const started = await si.startKrogerSignIn();
  assert.deepEqual(Object.keys(started).sort(), ['link', 'ok']);
  assert.match(started.link, new RegExp(`^${RELAY}/k/[A-Za-z0-9_-]{43}$`));
  assert.equal((await si.getKrogerStatus()).pending, true);
  assert.equal((await si.getKrogerStatus()).connected, false);
  assert.deepEqual(await si.waitForKrogerSignIn(), { ok: true });
  assert.deepEqual(await si.getKrogerStatus(), { ok: true, configured: true, relay: true, connected: true, pending: false });
  const state = started.link.split('/k/')[1];
  assert.equal(log.claims.length, 3);
  assert.deepEqual(log.claims[0].body, { state });
  assert.equal(log.claims[0].method, 'POST');
  assert.equal(log.claims[0].headers.Authorization, `Bearer ${RELAY_SECRET}`);
  assert.equal(log.claims[0].headers['Content-Type'], 'application/json');
  assert.equal(log.tokens.length, 1);
  const params = new URLSearchParams(log.tokens[0].body);
  assert.equal(params.get('code'), CODE);
  assert.equal(params.get('grant_type'), 'authorization_code');
  assert.equal(params.get('redirect_uri'), relayRedirectUri(RELAY));
  assert.match(await readFile(join(dir, 'kroger-tokens.json'), 'utf8'), /refresh-token-abc/);
});

test('401 or 403 stops with relay_rejected', async () => {
  for (const status of [401, 403]) {
    const dir = await tempDir();
    const si = make(baseEnv(dir), makeFetch([{ status }]).impl);
    await si.startKrogerSignIn();
    assert.deepEqual(await si.waitForKrogerSignIn(), { ok: false, error: 'relay_rejected' });
    assert.equal((await si.getKrogerStatus()).pending, false);
  }
});

test('network errors and 5xx keep polling', async () => {
  const dir = await tempDir();
  const { impl, log } = makeFetch(['throw', { status: 503 }, { status: 200, body: { code: CODE } }]);
  const si = make(baseEnv(dir), impl);
  await si.startKrogerSignIn();
  assert.deepEqual(await si.waitForKrogerSignIn(), { ok: true });
  assert.equal(log.claims.length, 3);
});

test('timed_out leaves connected unchanged and stops polling', async () => {
  const dir = await tempDir();
  const { impl, log } = makeFetch([{ status: 404 }]);
  const si = make(baseEnv(dir), impl, { maxWaitMs: 60 });
  await si.startKrogerSignIn();
  assert.deepEqual(await si.waitForKrogerSignIn(), { ok: false, error: 'timed_out' });
  const st = await si.getKrogerStatus();
  assert.equal(st.pending, false);
  assert.equal(st.connected, false);
  const seen = log.claims.length;
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(log.claims.length, seen);
});

test('a failed exchange gives exchange_failed and saves nothing', async () => {
  const dir = await tempDir();
  const si = make(baseEnv(dir), makeFetch([{ status: 200, body: { code: CODE } }], { tokenOk: false }).impl);
  await si.startKrogerSignIn();
  assert.deepEqual(await si.waitForKrogerSignIn(), { ok: false, error: 'exchange_failed' });
  assert.equal((await si.getKrogerStatus()).connected, false);
});

test('an invalid claimed code gives exchange_failed without exchanging', async () => {
  const dir = await tempDir();
  const { impl, log } = makeFetch([{ status: 200, body: { code: 'x'.repeat(2049) } }]);
  const si = make(baseEnv(dir), impl);
  await si.startKrogerSignIn();
  assert.deepEqual(await si.waitForKrogerSignIn(), { ok: false, error: 'exchange_failed' });
  assert.equal(log.tokens.length, 0);
});

test('a second start cancels the first', async () => {
  const dir = await tempDir();
  const { impl, log } = makeFetch([{ status: 404 }]);
  const si = make(baseEnv(dir), impl, { maxWaitMs: 200 });
  const first = await si.startKrogerSignIn();
  const firstWaiter = si.waitForKrogerSignIn();
  const second = await si.startKrogerSignIn();
  assert.notEqual(first.link, second.link);
  assert.deepEqual(await firstWaiter, { ok: false, error: 'cancelled' });
  const firstState = first.link.split('/k/')[1];
  const secondState = second.link.split('/k/')[1];
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(log.claims.some((c) => c.body.state === secondState));
  assert.ok(!log.claims.some((c) => c.body.state === firstState));
  si.cancel();
});

test('waitForKrogerSignIn with nothing pending gives no_pending', async () => {
  const si = make(baseEnv(await tempDir()), makeFetch([{ status: 404 }]).impl);
  assert.deepEqual(await si.waitForKrogerSignIn(), { ok: false, error: 'no_pending' });
});

test('status without keys never touches the token store', async () => {
  let touched = false;
  const si = createKrogerSignIn({
    env: {},
    createStore: () => {
      touched = true;
      return { load: async () => null };
    },
  });
  assert.deepEqual(await si.getKrogerStatus(), { ok: true, configured: false, relay: false, connected: false, pending: false });
  assert.equal(touched, false);
});

test('no secret, code, token or state is logged or returned (except the link)', async () => {
  const dir = await tempDir();
  const cap = captureConsole();
  const results = [];
  let state;
  try {
    const si = make(baseEnv(dir), makeFetch([{ status: 404 }, { status: 200, body: { code: CODE } }]).impl);
    const started = await si.startKrogerSignIn();
    state = started.link.split('/k/')[1];
    results.push(await si.getKrogerStatus(), await si.waitForKrogerSignIn(), await si.getKrogerStatus());
    const failing = make(baseEnv(dir), makeFetch([{ status: 401 }]).impl);
    await failing.startKrogerSignIn();
    results.push(await failing.waitForKrogerSignIn());
  } finally {
    cap.restore();
  }
  const haystack = cap.lines.join('\n') + JSON.stringify(results);
  for (const secret of [CLIENT_SECRET, RELAY_SECRET, CODE, REFRESH, ACCESS, state]) {
    assert.ok(!haystack.includes(secret), 'leaked a sensitive value');
  }
  assert.ok(cap.lines.some((l) => l.includes('kroger sign-in connected')));
});

test('the default-controller wrappers return the documented shapes without keys', async () => {
  const saved = {};
  for (const k of Object.keys(process.env)) if (k.startsWith('KROGER_')) { saved[k] = process.env[k]; delete process.env[k]; }
  const dir = await tempDir();
  process.env.KROGER_TOKEN_DIR = dir;
  try {
    assert.deepEqual(await startKrogerSignIn(), { ok: false, error: 'not_configured' });
    assert.deepEqual(await getKrogerStatus(), { ok: true, configured: false, relay: false, connected: false, pending: false });
  } finally {
    delete process.env.KROGER_TOKEN_DIR;
    Object.assign(process.env, saved);
  }
});
