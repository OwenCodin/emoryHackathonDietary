import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryStore } from './memory-store.mjs';
import { CODE_TTL_MS, createRelay, escapeHtml, isValidState } from './relay.mjs';

const STATE = 'A'.repeat(43);
const OTHER = 'B'.repeat(43);
const SECRET = 'S'.repeat(40);
const ORIGIN = 'https://relay.test';

function setup(envOver = {}, t0 = 1_000_000) {
  let t = t0;
  const store = createMemoryStore();
  const env = { KROGER_CLIENT_ID: 'client-id', RELAY_SECRET: SECRET, ...envOver };
  const relay = createRelay({ store, env, now: () => t });
  return { store, relay, env, advance: (ms) => (t += ms), now: () => t };
}

const get = (path) => new Request(`${ORIGIN}${path}`);
const claimReq = (body, headers = {}, method = 'POST') =>
  new Request(`${ORIGIN}/api/kroger/claim`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
const auth = { authorization: `Bearer ${SECRET}` };

test('isValidState accepts exactly 43 url-safe chars', () => {
  assert.equal(isValidState(STATE), true);
  assert.equal(isValidState('a-_Z0'.repeat(8) + 'abc'), true);
  for (const bad of ['', 'A'.repeat(42), 'A'.repeat(44), 'A'.repeat(42) + '.', 'A'.repeat(42) + '%', 'A'.repeat(42) + '/', 'A'.repeat(42) + '<', null, undefined]) {
    assert.equal(isValidState(bad), false, String(bad));
  }
});

test('escapeHtml escapes the five characters', () => {
  assert.equal(escapeHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('start redirects to Kroger authorize with the callback on the relay', async () => {
  const { relay } = setup();
  for (const path of [`/k/${STATE}`, `/api/k?state=${STATE}`]) {
    const res = await relay.start(get(path));
    assert.equal(res.status, 302);
    const loc = new URL(res.headers.get('location'));
    assert.equal(loc.host, 'api.kroger.com');
    assert.equal(loc.pathname, '/v1/connect/oauth2/authorize');
    assert.deepEqual(
      Object.fromEntries(loc.searchParams),
      {
        response_type: 'code',
        client_id: 'client-id',
        redirect_uri: `${ORIGIN}/api/kroger/callback`,
        scope: 'cart.basic:write',
        state: STATE,
      },
    );
    assert.equal([...loc.searchParams.keys()].length, 5);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  }
});

test('start uses RELAY_PUBLIC_URL without its trailing slash when set', async () => {
  const { relay } = setup({ RELAY_PUBLIC_URL: 'https://prod.example/' });
  const res = await relay.start(get(`/k/${STATE}`));
  assert.equal(new URL(res.headers.get('location')).searchParams.get('redirect_uri'), 'https://prod.example/api/kroger/callback');
});

test('start rejects bad states with 400 and no Location', async () => {
  const { relay } = setup();
  for (const path of ['/k/', `/k/${'A'.repeat(42)}`, `/k/${'A'.repeat(44)}`, `/k/${'A'.repeat(42)}.`, `/k/${'A'.repeat(42)}%25`, '/api/k', `/api/k?state=${'A'.repeat(42)}%2F`, `/api/k?state=${'A'.repeat(42)}%3C`]) {
    const res = await relay.start(get(path));
    assert.equal(res.status, 400, path);
    assert.equal(res.headers.get('location'), null);
    assert.match(await res.text(), /not valid/);
  }
});

test('start answers 503 when KROGER_CLIENT_ID is missing', async () => {
  const { relay } = setup({ KROGER_CLIENT_ID: '' });
  const res = await relay.start(get(`/k/${STATE}`));
  assert.equal(res.status, 503);
  assert.match(await res.text(), /not set up/);
});

test('callback stores the code and shows the success page with hardened headers', async () => {
  const { relay, store } = setup({}, 5000);
  const res = await relay.callback(get(`/api/kroger/callback?code=abc123&state=${STATE}`));
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(body.includes("<h1>Thanks, you're signed in to Kroger.</h1>"));
  assert.ok(body.includes("<p>If you're still on your call, go back to it. If your call has ended, call your dietitian back within a few minutes to finish connecting.</p>"));
  assert.ok(body.includes('<p>After ten minutes this sign-in is dropped, and you can ask for a new link on any call.</p>'));
  assert.ok(!body.includes('Kroger is connected'));
  assert.ok(!body.includes('abc123') && !body.includes(STATE));
  assert.deepEqual(await store.get(STATE), { code: 'abc123', at: 5000 });
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(res.headers.get('content-security-policy'), "default-src 'none'; style-src 'unsafe-inline'");
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('a second callback for the same state keeps the first record', async () => {
  const { relay, store } = setup();
  await relay.callback(get(`/api/kroger/callback?code=first&state=${STATE}`));
  const res = await relay.callback(get(`/api/kroger/callback?code=second&state=${STATE}`));
  assert.equal(res.status, 200);
  assert.equal((await store.get(STATE)).code, 'first');
});

test('callback with a Kroger error stores nothing and escapes the error', async () => {
  const { relay, store } = setup();
  const res = await relay.callback(get(`/api/kroger/callback?error=${encodeURIComponent('<script>' + 'x'.repeat(80))}&state=${STATE}`));
  assert.equal(res.status, 400);
  const body = await res.text();
  assert.match(body, /Kroger sign-in was not finished\./);
  assert.match(body, /&lt;script&gt;/);
  assert.ok(!body.includes('<script>'));
  assert.ok(!body.includes('x'.repeat(40)));
  assert.equal(await store.get(STATE), null);
  const plain = await (await relay.callback(get(`/api/kroger/callback?error=access_denied&state=${STATE}`))).text();
  assert.match(plain, /access_denied/);
});

test('callback rejects bad state, missing, overlong or odd codes', async () => {
  const { relay, store } = setup();
  const cases = [
    `?code=abc&state=short`,
    `?code=abc`,
    `?state=${STATE}`,
    `?code=${'a'.repeat(2049)}&state=${STATE}`,
    `?code=${encodeURIComponent('a b')}&state=${STATE}`,
    `?code=${encodeURIComponent('é')}&state=${STATE}`,
  ];
  for (const q of cases) {
    const res = await relay.callback(get(`/api/kroger/callback${q}`));
    assert.equal(res.status, 400, q);
  }
  assert.equal(await store.get(STATE), null);
  const ok = await relay.callback(get(`/api/kroger/callback?code=${'a'.repeat(2048)}&state=${STATE}`));
  assert.equal(ok.status, 200);
});

test('callback answers 503 on a store failure and never shows code, state or Location', async () => {
  const { env, now } = setup();
  const relay = createRelay({ store: { put: async () => ({ ok: false }), sweep: async () => {} }, env, now });
  const res = await relay.callback(get(`/api/kroger/callback?code=zzz&state=${STATE}`));
  assert.equal(res.status, 503);
  const body = await res.text();
  assert.match(body, /couldn't save/);
  assert.ok(!body.includes('zzz') && !body.includes(STATE));
  assert.equal(res.headers.get('location'), null);
});

test('a failing sweep does not change the success page', async () => {
  const { env, now } = setup();
  const relay = createRelay({
    store: { put: async () => ({ ok: true }), sweep: async () => { throw new Error('boom'); } },
    env,
    now,
  });
  const res = await relay.callback(get(`/api/kroger/callback?code=abc&state=${STATE}`));
  assert.equal(res.status, 200);
});

test('callback sweeps records older than the TTL', async () => {
  const { relay, store, advance } = setup();
  await relay.callback(get(`/api/kroger/callback?code=old&state=${STATE}`));
  advance(CODE_TTL_MS + 1);
  await relay.callback(get(`/api/kroger/callback?code=new&state=${OTHER}`));
  assert.equal(await store.get(STATE), null);
  assert.equal((await store.get(OTHER)).code, 'new');
});

test('claim returns the code once and deletes it', async () => {
  const { relay, store } = setup();
  await relay.callback(get(`/api/kroger/callback?code=abc&state=${STATE}`));
  const res = await relay.claim(claimReq({ state: STATE }, auth));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { code: 'abc' });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(await store.get(STATE), null);
  const again = await relay.claim(claimReq({ state: STATE }, auth));
  assert.equal(again.status, 404);
  assert.deepEqual(await again.json(), { error: 'not_found' });
  assert.equal(again.headers.get('cache-control'), 'no-store');
});

test('claim refuses and deletes a record older than the TTL', async () => {
  const { relay, store, advance } = setup();
  await relay.callback(get(`/api/kroger/callback?code=abc&state=${STATE}`));
  advance(CODE_TTL_MS + 1);
  const res = await relay.claim(claimReq({ state: STATE }, auth));
  assert.equal(res.status, 404);
  assert.equal(await store.get(STATE), null);
});

test('claim with a wrong or missing secret gives 401 and the record survives', async () => {
  const { relay, store } = setup();
  await relay.callback(get(`/api/kroger/callback?code=abc&state=${STATE}`));
  for (const headers of [{}, { authorization: 'Bearer nope' }, { authorization: SECRET }]) {
    const res = await relay.claim(claimReq({ state: STATE }, headers));
    assert.equal(res.status, 401);
  }
  assert.equal((await store.get(STATE)).code, 'abc');
});

test('claim answers 503 when RELAY_SECRET is unset or short', async () => {
  for (const RELAY_SECRET of [undefined, 'short']) {
    const { relay } = setup({ RELAY_SECRET });
    const res = await relay.claim(claimReq({ state: STATE }, { authorization: `Bearer ${RELAY_SECRET ?? ''}` }));
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'not_configured' });
  }
});

test('claim rejects bad bodies and wrong methods', async () => {
  const { relay } = setup();
  for (const body of ['not json', JSON.stringify({ state: 'x'.repeat(2000) }), JSON.stringify({ state: 'short' }), JSON.stringify({})]) {
    const res = await relay.claim(claimReq(body, auth));
    assert.equal(res.status, 400, body.slice(0, 20));
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
  const res = await relay.claim(claimReq('', auth, 'GET'));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('handlers never throw: a broken store gives 500', async () => {
  const { env, now } = setup();
  const boom = async () => { throw new Error('boom'); };
  const relay = createRelay({ store: { put: boom, get: boom, del: boom, sweep: boom }, env, now });
  assert.equal((await relay.callback(get(`/api/kroger/callback?code=a&state=${STATE}`))).status, 500);
  const res = await relay.claim(claimReq({ state: STATE }, auth));
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'server_error' });
});

test('memory store: put, get, del and sweep', async () => {
  const store = createMemoryStore();
  assert.deepEqual(await store.put('a', { code: 'c', at: 10 }), { ok: true });
  assert.deepEqual(await store.put('a', { code: 'd', at: 11 }), { ok: false, exists: true });
  assert.deepEqual(await store.get('a'), { code: 'c', at: 10 });
  await store.put('b', { code: 'c', at: 100 });
  await store.sweep(50);
  assert.equal(await store.get('a'), null);
  assert.notEqual(await store.get('b'), null);
  await store.del('b');
  await store.del('missing');
  assert.equal(await store.get('b'), null);
});
