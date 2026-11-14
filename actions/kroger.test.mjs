import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  KROGER_CART_URL,
  MAX_QUANTITY,
  buildAuthorizeUrl,
  chooseProduct,
  createKrogerClient,
  createTokenStore,
  defaultTokenDir,
  parseQuantity,
  readKrogerConfig,
} from './kroger.mjs';

const SECRETS = ['test-secret', 'test-refresh', 'test-access', 'test-user-access', 'new-refresh', 'test-code'];
const ALLOWED_PATHS = new Set(['/v1/connect/oauth2/token', '/v1/products', '/v1/cart/add']);
const allResults = [];

function makeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ url: u, init });
    assert.ok(ALLOWED_PATHS.has(u.pathname), `unexpected path ${u.pathname}`);
    assert.ok(!/checkout|order|payment/i.test(u.pathname));
    const out = await handler(u, init, calls.length);
    if (out instanceof Error) throw out;
    return {
      ok: out.status >= 200 && out.status < 300,
      status: out.status,
      json: async () => {
        if (out.badJson) throw new Error('bad json');
        return out.body;
      },
    };
  };
  return { fetchImpl, calls };
}

const tokenReply = (extra = {}) => ({ status: 200, body: { access_token: 'test-access', expires_in: 1800, ...extra } });

function memoryStore(initial = null) {
  let stored = initial;
  return {
    saved: [],
    load: async () => stored,
    save: async function (value) { stored = value; this.saved.push(value); return { ok: true }; },
  };
}

function makeClient(handler, { store = memoryStore(), now = () => 0 } = {}) {
  const { fetchImpl, calls } = makeFetch(handler);
  const client = createKrogerClient({
    clientId: 'test-client',
    clientSecret: 'test-secret',
    locationId: '01100695',
    tokenStore: store,
    fetchImpl,
    now,
  });
  return { client, calls, store };
}

const record = (r) => { allResults.push(JSON.stringify(r)); return r; };

test('readKrogerConfig needs both keys', () => {
  assert.equal(readKrogerConfig({}), null);
  assert.equal(readKrogerConfig({ KROGER_CLIENT_ID: 'a' }), null);
  assert.equal(readKrogerConfig({ KROGER_CLIENT_ID: 'a', KROGER_CLIENT_SECRET: '  ' }), null);
  const cfg = readKrogerConfig({ KROGER_CLIENT_ID: ' a ', KROGER_CLIENT_SECRET: 'b' });
  assert.equal(cfg.clientId, 'a');
  assert.equal(cfg.locationId, '01100695');
  assert.equal(cfg.redirectUri, 'http://localhost:8765/callback');
  assert.equal(cfg.tokenDir, join(homedir(), '.config', 'renal-dietitian'));
  const custom = readKrogerConfig({
    KROGER_CLIENT_ID: 'a', KROGER_CLIENT_SECRET: 'b', KROGER_LOCATION_ID: '9',
    KROGER_REDIRECT_URI: 'http://localhost:1/x', KROGER_TOKEN_DIR: '/tmp/x',
  });
  assert.equal(custom.locationId, '9');
  assert.equal(custom.redirectUri, 'http://localhost:1/x');
  assert.equal(custom.tokenDir, resolve('/tmp/x'));
  assert.equal(defaultTokenDir({ KROGER_TOKEN_DIR: '/tmp/y' }), resolve('/tmp/y'));
});

test('parseQuantity', () => {
  assert.equal(parseQuantity('3'), 3);
  assert.equal(parseQuantity('3 apples'), 3);
  assert.equal(parseQuantity('1 carton'), 1);
  assert.equal(parseQuantity('a dozen'), 1);
  assert.equal(parseQuantity('0'), 1);
  assert.equal(parseQuantity('40'), MAX_QUANTITY);
  assert.equal(parseQuantity(undefined), 1);
});

const product = (upc, description, regular, promo) => ({
  upc, description, items: [{ price: { regular, ...(promo === undefined ? {} : { promo }) } }],
});

test('chooseProduct picks by words, markers, price and order', () => {
  const butter = [product('1', 'Kroger Salted Butter', 3), product('2', 'Kroger Unsalted Butter Sticks', 3.59)];
  assert.deepEqual(chooseProduct('unsalted butter', butter), { upc: '2', description: 'Kroger Unsalted Butter Sticks', unitPrice: 3.59 });
  assert.equal(chooseProduct('apples', [product('3', 'Honeycrisp Apple', 1.5)]).upc, '3');
  assert.equal(chooseProduct('apples', [product('3', 'Honeycrisp Apple', 0)]), null);
  assert.equal(chooseProduct('apples', [product('4', 'Orange Juice', 2)]), null);
  assert.equal(chooseProduct('apples', []), null);
  // promo price wins when positive
  assert.equal(chooseProduct('apples', [product('5', 'Gala Apples', 2, 1.25)]).unitPrice, 1.25);
  // marker preferred when not requested
  const rice = [product('6', 'White Rice', 2), product('7', 'No Salt Added White Rice', 2.2)];
  assert.equal(chooseProduct('white rice', rice).upc, '7');
  // requested marker is required
  assert.equal(chooseProduct('low sodium broth', [product('8', 'Chicken Broth', 2)]), null);
  assert.equal(chooseProduct('low sodium broth', [product('9', 'Low Sodium Chicken Broth', 2)]).upc, '9');
  // ties keep Kroger order
  assert.equal(chooseProduct('rice', [product('a', 'Rice A', 1), product('b', 'Rice B', 1)]).upc, 'a');
});

test('app token is cached and refreshed after expiry', async () => {
  let t = 0;
  const { client, calls } = makeClient((u) => {
    if (u.pathname.endsWith('/token')) return tokenReply();
    return { status: 200, body: { data: [{ upc: '1' }] } };
  }, { now: () => t });
  record(await client.searchProducts('a'));
  record(await client.searchProducts('b'));
  assert.equal(calls.filter((c) => c.url.pathname.endsWith('/token')).length, 1);
  t = 1800 * 1000 - 59_000;
  await client.searchProducts('c');
  assert.equal(calls.filter((c) => c.url.pathname.endsWith('/token')).length, 2);
  const tokenCall = calls[0];
  assert.equal(tokenCall.init.method, 'POST');
  assert.equal(tokenCall.init.headers.Authorization, `Basic ${Buffer.from('test-client:test-secret').toString('base64')}`);
  assert.equal(tokenCall.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(String(tokenCall.init.body), 'grant_type=client_credentials&scope=product.compact');
});

test('searchProducts request shape and errors', async () => {
  const { client, calls } = makeClient((u) => u.pathname.endsWith('/token')
    ? tokenReply()
    : { status: 200, body: { data: [{ upc: '1' }] } });
  const r = record(await client.searchProducts('unsalted butter'));
  assert.deepEqual(r, { ok: true, products: [{ upc: '1' }] });
  const search = calls[1];
  assert.equal(search.url.searchParams.get('filter.term'), 'unsalted butter');
  assert.equal(search.url.searchParams.get('filter.locationId'), '01100695');
  assert.equal(search.url.searchParams.get('filter.limit'), '10');
  assert.equal(search.init.headers.Authorization, 'Bearer test-access');

  const e500 = makeClient((u) => u.pathname.endsWith('/token') ? tokenReply() : { status: 500, body: {} });
  assert.deepEqual(record(await e500.client.searchProducts('x')), { ok: false, error: 'http_500' });
  const net = makeClient((u) => u.pathname.endsWith('/token') ? tokenReply() : new Error('boom'));
  assert.deepEqual(record(await net.client.searchProducts('x')), { ok: false, error: 'network' });
  const bad = makeClient((u) => u.pathname.endsWith('/token') ? tokenReply() : { status: 200, badJson: true });
  assert.deepEqual(record(await bad.client.searchProducts('x')), { ok: false, error: 'bad_response' });
});

test('getUserToken: no sign-in makes no request', async () => {
  const { client, calls } = makeClient(() => tokenReply());
  assert.deepEqual(record(await client.getUserToken()), { ok: false, error: 'no_sign_in' });
  assert.equal(calls.length, 0);
});

test('getUserToken refreshes and saves a rotated token', async () => {
  const store = memoryStore({ refreshToken: 'test-refresh' });
  const { client, calls } = makeClient(() => ({ status: 200, body: { access_token: 'test-user-access', expires_in: 1800, refresh_token: 'new-refresh' } }), { store });
  const r = await client.getUserToken();
  assert.deepEqual(r, { ok: true, token: 'test-user-access' });
  assert.equal(String(calls[0].init.body), 'grant_type=refresh_token&refresh_token=test-refresh');
  assert.equal(calls[0].init.headers.Authorization, `Basic ${Buffer.from('test-client:test-secret').toString('base64')}`);
  assert.deepEqual(store.saved, [{ refreshToken: 'new-refresh' }]);
  for (const status of [400, 401]) {
    const rejected = makeClient(() => ({ status, body: {} }), { store: memoryStore({ refreshToken: 'test-refresh' }) });
    assert.deepEqual(record(await rejected.client.getUserToken()), { ok: false, error: 'sign_in_rejected' });
  }
});

test('addToCart request shape and errors', async () => {
  const { client, calls } = makeClient(() => ({ status: 204, body: null }));
  assert.deepEqual(await client.addToCart({ upc: '0001111089305', quantity: 2 }, 'test-user-access'), { ok: true });
  const c = calls[0];
  assert.equal(c.init.method, 'PUT');
  assert.equal(c.url.pathname, '/v1/cart/add');
  assert.equal(c.init.headers.Authorization, 'Bearer test-user-access');
  assert.equal(c.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(c.init.body), { items: [{ upc: '0001111089305', quantity: 2, modality: 'PICKUP' }] });
  const unauth = makeClient(() => ({ status: 401, body: {} }));
  assert.deepEqual(record(await unauth.client.addToCart({ upc: '1', quantity: 1 }, 't')), { ok: false, error: 'sign_in_rejected' });
  const e = makeClient(() => ({ status: 503, body: {} }));
  assert.deepEqual(record(await e.client.addToCart({ upc: '1', quantity: 1 }, 't')), { ok: false, error: 'http_503' });
});

test('exchangeCode saves the refresh token and returns no token', async () => {
  const store = memoryStore();
  const { client, calls } = makeClient(() => ({ status: 200, body: { access_token: 'test-user-access', refresh_token: 'new-refresh' } }), { store });
  const r = record(await client.exchangeCode({ code: 'test-code', redirectUri: 'http://localhost:8765/callback' }));
  assert.deepEqual(r, { ok: true });
  const params = new URLSearchParams(String(calls[0].init.body));
  assert.equal(params.get('grant_type'), 'authorization_code');
  assert.equal(params.get('code'), 'test-code');
  assert.equal(params.get('redirect_uri'), 'http://localhost:8765/callback');
  assert.deepEqual(store.saved, [{ refreshToken: 'new-refresh' }]);
  const none = makeClient(() => ({ status: 200, body: { access_token: 'x' } }), { store: memoryStore() });
  assert.equal((await none.client.exchangeCode({ code: 'c', redirectUri: 'u' })).ok, false);
});

test('buildAuthorizeUrl', () => {
  const u = new URL(buildAuthorizeUrl({ clientId: 'test-client', redirectUri: 'http://localhost:8765/callback', state: 'abc' }));
  assert.equal(u.origin + u.pathname, 'https://api.kroger.com/v1/connect/oauth2/authorize');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('client_id'), 'test-client');
  assert.equal(u.searchParams.get('redirect_uri'), 'http://localhost:8765/callback');
  assert.equal(u.searchParams.get('scope'), 'cart.basic:write');
  assert.equal(u.searchParams.get('state'), 'abc');
  assert.equal(KROGER_CART_URL, 'https://www.kroger.com/cart');
});

test('token store round-trips with tight permissions', async () => {
  const base = await mkdtemp(join(tmpdir(), 'kroger-test-'));
  try {
    const dir = join(base, 'state');
    const store = createTokenStore({ dir });
    assert.equal(await store.load(), null);
    assert.deepEqual(await store.save({ refreshToken: 'test-refresh' }), { ok: true });
    assert.deepEqual(await store.load(), { refreshToken: 'test-refresh' });
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    assert.equal((await stat(join(dir, 'kroger-tokens.json'))).mode & 0o777, 0o600);
    await writeFile(join(dir, 'kroger-tokens.json'), '{nope');
    assert.equal(await store.load(), null);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('token store refuses a folder inside the repo', async () => {
  const dir = resolve(import.meta.dirname, '..', 'kroger-should-not-exist');
  const store = createTokenStore({ dir });
  assert.deepEqual(await store.save({ refreshToken: 'test-refresh' }), { ok: false });
  assert.equal(await store.load(), null);
  await assert.rejects(stat(dir));
});

test('no secret appears in any result', () => {
  const text = allResults.join('\n');
  for (const s of SECRETS) assert.ok(!text.includes(s), `leaked ${s}`);
});
