import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
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
    // the record is kept (a secret problem, not the patient's), so a fresh record still reads as pending
    assert.equal((await si.getKrogerStatus()).pending, true);
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
  assert.equal(st.pending, true); // the record outlives the poller: another process may still claim within 10 minutes
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

// ---- pending record and resume ----

const pendingPath = (dir) => join(dir, 'kroger-signin-pending.json');
const stateOf = (started) => started.link.split('/k/')[1];
const readRecord = async (dir) => JSON.parse(await readFile(pendingPath(dir), 'utf8'));
const exists = async (f) => {
  try {
    await stat(f);
    return true;
  } catch {
    return false;
  }
};
const FIXED_NOW = 1_800_000_000_000;

test('start writes a private pending record with only the state and start time', async () => {
  const dir = await tempDir();
  const si = make(baseEnv(dir), makeFetch([{ status: 404 }]).impl, { now: () => FIXED_NOW });
  const started = await si.startKrogerSignIn();
  assert.equal((await stat(pendingPath(dir))).mode & 0o777, 0o600);
  assert.equal((await stat(dir)).mode & 0o777, 0o700);
  assert.deepEqual(await readRecord(dir), { state: stateOf(started), startedAt: FIXED_NOW });
  assert.deepEqual((await readdir(dir)).filter((n) => n.endsWith('.tmp')), []);
  si.cancel();
});

test('the record is removed on success and on a rejected exchange', async () => {
  const dir = await tempDir();
  const ok = make(baseEnv(dir), makeFetch([{ status: 200, body: { code: CODE } }]).impl);
  await ok.startKrogerSignIn();
  assert.deepEqual(await ok.waitForKrogerSignIn(), { ok: true });
  assert.equal(await exists(pendingPath(dir)), false);

  const dir2 = await tempDir();
  const bad = make(baseEnv(dir2), makeFetch([{ status: 200, body: { code: CODE } }], { tokenOk: false }).impl);
  await bad.startKrogerSignIn();
  assert.deepEqual(await bad.waitForKrogerSignIn(), { ok: false, error: 'exchange_failed' });
  assert.equal(await exists(pendingPath(dir2)), false);

  const dir3 = await tempDir();
  const long = make(baseEnv(dir3), makeFetch([{ status: 200, body: { code: 'x'.repeat(2049) } }]).impl);
  await long.startKrogerSignIn();
  assert.deepEqual(await long.waitForKrogerSignIn(), { ok: false, error: 'exchange_failed' });
  assert.equal(await exists(pendingPath(dir3)), false);
});

test('relay_rejected, timed_out and cancel keep the record; a second start overwrites it', async () => {
  const dir = await tempDir();
  const rejected = make(baseEnv(dir), makeFetch([{ status: 401 }]).impl);
  await rejected.startKrogerSignIn();
  await rejected.waitForKrogerSignIn();
  assert.equal(await exists(pendingPath(dir)), true);

  const dir2 = await tempDir();
  const slow = make(baseEnv(dir2), makeFetch([{ status: 404 }]).impl, { maxWaitMs: 40 });
  await slow.startKrogerSignIn();
  assert.deepEqual(await slow.waitForKrogerSignIn(), { ok: false, error: 'timed_out' });
  assert.equal(await exists(pendingPath(dir2)), true);

  const dir3 = await tempDir();
  const si = make(baseEnv(dir3), makeFetch([{ status: 404 }]).impl);
  const first = await si.startKrogerSignIn();
  si.cancel();
  assert.equal((await readRecord(dir3)).state, stateOf(first));
  const second = await si.startKrogerSignIn();
  assert.equal((await readRecord(dir3)).state, stateOf(second));
  assert.notEqual(stateOf(first), stateOf(second));
  si.cancel();
});

test('a fresh process resumes the sign-in the first process left behind', async () => {
  const dir = await tempDir();
  const a = make(baseEnv(dir), makeFetch([{ status: 404 }]).impl, { maxWaitMs: 40 });
  const started = await a.startKrogerSignIn();
  await a.waitForKrogerSignIn();
  a.cancel();
  const { impl, log } = makeFetch([{ status: 200, body: { code: CODE } }]);
  const b = make(baseEnv(dir), impl);
  assert.deepEqual(await b.resumePendingSignIn(), { resumed: 'connected' });
  assert.equal(log.claims.length, 1);
  assert.equal(log.claims[0].body.state, stateOf(started));
  assert.equal(log.tokens.length, 1);
  assert.match(await readFile(join(dir, 'kroger-tokens.json'), 'utf8'), /refresh-token-abc/);
  assert.equal(await exists(pendingPath(dir)), false);
  const st = await b.getKrogerStatus();
  assert.equal(st.connected, true);
  assert.equal(st.pending, false);
});

test('resume with a relay 404 waits and keeps the record; status reads pending from disk', async () => {
  const dir = await tempDir();
  const a = make(baseEnv(dir), makeFetch([{ status: 404 }]).impl);
  await a.startKrogerSignIn();
  a.cancel();
  const b = make(baseEnv(dir), makeFetch([{ status: 404 }]).impl);
  assert.deepEqual(await b.resumePendingSignIn(), { resumed: 'waiting' });
  assert.equal(await exists(pendingPath(dir)), true);
  const c = make(baseEnv(dir), makeFetch([{ status: 404 }]).impl);
  const st = await c.getKrogerStatus();
  assert.deepEqual(Object.keys(st), ['ok', 'configured', 'relay', 'connected', 'pending']);
  assert.equal(st.pending, true);
});

test('a stale or far-future record is deleted without any claim', async () => {
  for (const offset of [600_001, -60_001]) {
    const dir = await tempDir();
    const a = make(baseEnv(dir), makeFetch([{ status: 404 }]).impl, { now: () => FIXED_NOW });
    await a.startKrogerSignIn();
    a.cancel();
    const { impl, log } = makeFetch([{ status: 200, body: { code: CODE } }]);
    const b = make(baseEnv(dir), impl, { now: () => FIXED_NOW + offset });
    assert.deepEqual(await b.resumePendingSignIn(), { resumed: 'expired' });
    assert.equal(log.claims.length, 0);
    assert.equal(await exists(pendingPath(dir)), false);
  }
});

test('resume: Kroger rejecting the exchange, a bad code and a relay 401', async () => {
  const dir = await tempDir();
  await make(baseEnv(dir), makeFetch([{ status: 404 }]).impl).startKrogerSignIn();
  const rejected = makeFetch([{ status: 200, body: { code: CODE } }], { tokenOk: false });
  assert.deepEqual(await make(baseEnv(dir), rejected.impl).resumePendingSignIn(), { resumed: 'failed' });
  assert.equal(await exists(pendingPath(dir)), false);
  assert.equal(await exists(join(dir, 'kroger-tokens.json')), false);

  const dir2 = await tempDir();
  await make(baseEnv(dir2), makeFetch([{ status: 404 }]).impl).startKrogerSignIn();
  const long = makeFetch([{ status: 200, body: { code: 'x'.repeat(2049) } }]);
  assert.deepEqual(await make(baseEnv(dir2), long.impl).resumePendingSignIn(), { resumed: 'failed' });
  assert.equal(long.log.tokens.length, 0);
  assert.equal(await exists(pendingPath(dir2)), false);

  const dir3 = await tempDir();
  await make(baseEnv(dir3), makeFetch([{ status: 404 }]).impl).startKrogerSignIn();
  assert.deepEqual(await make(baseEnv(dir3), makeFetch([{ status: 401 }]).impl).resumePendingSignIn(), { resumed: 'failed' });
  assert.equal(await exists(pendingPath(dir3)), true);
});

test('resume with no record, no Kroger config or no relay config makes no request', async () => {
  const guard = async () => assert.fail('no fetch expected');
  const dir = await tempDir();
  assert.deepEqual(await make(baseEnv(dir), guard).resumePendingSignIn(), { resumed: 'none' });
  assert.deepEqual(await make({}, guard).resumePendingSignIn(), { resumed: 'none' });
  await make(baseEnv(dir), makeFetch([{ status: 404 }]).impl).startKrogerSignIn();
  const noRelay = baseEnv(dir, { KROGER_RELAY_URL: '' });
  assert.deepEqual(await make(noRelay, guard).resumePendingSignIn(), { resumed: 'none' });
  assert.equal(await exists(pendingPath(dir)), true);
});

test('a corrupt record is removed; a symlink is never followed or deleted', async () => {
  const guard = async () => assert.fail('no fetch expected');
  for (const body of ['not json', JSON.stringify({ state: 'short', startedAt: FIXED_NOW }), JSON.stringify({ state: 'A'.repeat(43) })]) {
    const dir = await tempDir();
    await writeFile(pendingPath(dir), body);
    assert.deepEqual(await make(baseEnv(dir), guard).resumePendingSignIn(), { resumed: 'none' });
    assert.equal(await exists(pendingPath(dir)), false);
  }
  const dir = await tempDir();
  const target = join(await tempDir(), 'target.json');
  await writeFile(target, JSON.stringify({ state: 'A'.repeat(43), startedAt: Date.now() }));
  await symlink(target, pendingPath(dir));
  assert.deepEqual(await make(baseEnv(dir), guard).resumePendingSignIn(), { resumed: 'none' });
  assert.equal(await exists(target), true);
  assert.equal((await readFile(target, 'utf8')).includes('AAAA'), true);
});

test('resume and status respect their time cap with a fetch that never answers', async () => {
  const dir = await tempDir();
  await make(baseEnv(dir), makeFetch([{ status: 404 }]).impl).startKrogerSignIn();
  const hang = () => new Promise(() => {});
  const si = make(baseEnv(dir), hang, { resumeWaitMs: 100 });
  let t = Date.now();
  assert.deepEqual(await si.resumePendingSignIn(), { resumed: 'waiting' });
  assert.ok(Date.now() - t < 300, 'resume exceeded its cap');
  t = Date.now();
  const st = await si.getKrogerStatus();
  assert.ok(Date.now() - t < 300, 'status exceeded its cap');
  assert.deepEqual(st, { ok: true, configured: true, relay: true, connected: false, pending: true });
});

test('no double save: poller plus resumes, and two processes, exchange exactly once', async () => {
  const dir = await tempDir();
  let claimed = false;
  const log = { tokens: 0, claims: 0 };
  const impl = async (url) => {
    if (url === `${RELAY}/api/kroger/claim`) {
      log.claims += 1;
      if (claimed) return new Response('{}', { status: 404 });
      claimed = true;
      return new Response(JSON.stringify({ code: CODE }), { status: 200 });
    }
    log.tokens += 1;
    return new Response(JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 1800 }), { status: 200 });
  };
  const a = make(baseEnv(dir), impl, { pollMs: 5000, maxWaitMs: 8000 });
  await a.startKrogerSignIn();
  const results = await Promise.all([a.resumePendingSignIn(), a.resumePendingSignIn()]);
  assert.deepEqual(results, [{ resumed: 'waiting' }, { resumed: 'waiting' }]); // the poller owns it: no claim
  assert.equal(log.claims, 0);
  a.cancel();

  const b = make(baseEnv(dir), impl);
  const c = make(baseEnv(dir), impl);
  const both = await Promise.all([b.resumePendingSignIn(), c.resumePendingSignIn()]);
  assert.equal(both.filter((r) => r.resumed === 'connected').length, 1);
  assert.equal(log.tokens, 1);
  assert.equal(await exists(pendingPath(dir)), false);
});

test('resume never leaks the state, code, tokens or secrets', async () => {
  const dir = await tempDir();
  const cap = captureConsole();
  const results = [];
  let state;
  try {
    const a = make(baseEnv(dir), makeFetch([{ status: 404 }]).impl);
    state = stateOf(await a.startKrogerSignIn());
    a.cancel();
    const b = make(baseEnv(dir), makeFetch([{ status: 200, body: { code: CODE } }]).impl);
    results.push(await b.resumePendingSignIn(), await b.getKrogerStatus());
    const dir2 = await tempDir();
    const x = make(baseEnv(dir2), makeFetch([{ status: 404 }]).impl, { now: () => FIXED_NOW });
    state = [state, stateOf(await x.startKrogerSignIn())];
    x.cancel();
    results.push(await make(baseEnv(dir2), makeFetch([{ status: 401 }]).impl, { now: () => FIXED_NOW + 700_000 }).resumePendingSignIn());
  } finally {
    cap.restore();
  }
  const haystack = cap.lines.join('\n') + JSON.stringify(results);
  for (const secret of [CLIENT_SECRET, RELAY_SECRET, CODE, REFRESH, ACCESS, ...state]) {
    assert.ok(!haystack.includes(secret), 'leaked a sensitive value');
  }
  assert.ok(cap.lines.some((l) => l.includes('connected (resumed)')));
});
