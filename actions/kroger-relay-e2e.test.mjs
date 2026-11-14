// Local end-to-end: the real relay handlers on a loopback node:http server, a simulated phone, the real actions
// poller, and a fake Kroger token endpoint. No Vercel, no Kroger, no real sign-in, no real token store.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createMemoryStore } from '../kroger-relay/lib/memory-store.mjs';
import { createNodeHandler } from '../kroger-relay/lib/node-adapter.mjs';
import { createRelay } from '../kroger-relay/lib/relay.mjs';
import { buildAuthorizeUrl } from './kroger.mjs';
import { createKrogerSignIn, relayRedirectUri } from './kroger-signin.mjs';

const SECRET = 'E'.repeat(43);
const CODE = 'e2e-test-code';
let server;
let origin;
let dir;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kroger-e2e-'));
  const store = createMemoryStore();
  let handler;
  server = createServer((req, res) => handler(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  const relay = createRelay({ store, env: { KROGER_CLIENT_ID: 'test-id', RELAY_SECRET: SECRET, RELAY_PUBLIC_URL: origin } });
  handler = createNodeHandler(relay);
});

after(async () => {
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

test('texted-link flow end to end against the local relay', async () => {
  const tokenCalls = [];
  const fetchImpl = async (url, init) => {
    if (url === 'https://api.kroger.com/v1/connect/oauth2/token') {
      tokenCalls.push({ headers: init.headers, body: String(init.body) });
      return new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r-e2e', expires_in: 1800 }), { status: 200 });
    }
    assert.ok(String(url).startsWith(origin), `non-loopback fetch ${url}`);
    return fetch(url, init);
  };
  const env = {
    KROGER_CLIENT_ID: 'test-id',
    KROGER_CLIENT_SECRET: 'test-secret',
    KROGER_RELAY_URL: origin,
    KROGER_RELAY_SECRET: SECRET,
    KROGER_TOKEN_DIR: dir,
  };
  const si = createKrogerSignIn({ env, fetchImpl, pollMs: 15, maxWaitMs: 5000, unrefTimers: false });
  const { link } = await si.startKrogerSignIn();
  const state = link.split('/k/')[1];

  // The phone follows the link: 302 to Kroger's authorize page with the relay callback.
  const hop = await fetch(link, { redirect: 'manual' });
  assert.equal(hop.status, 302);
  const location = hop.headers.get('location');
  assert.equal(location, buildAuthorizeUrl({ clientId: 'test-id', redirectUri: relayRedirectUri(origin), state }));
  assert.equal(new URL(location).searchParams.get('redirect_uri'), `${origin}/api/kroger/callback`);

  // Kroger redirects the phone back to the relay with a code.
  const done = await fetch(`${origin}/api/kroger/callback?code=${CODE}&state=${state}`);
  assert.equal(done.status, 200);
  const doneText = await done.text();
  assert.match(doneText, /signed in to Kroger/);
  assert.ok(!doneText.includes('Kroger is connected'));
  assert.match(doneText, /After ten minutes/);

  assert.deepEqual(await si.waitForKrogerSignIn(), { ok: true });
  assert.equal(tokenCalls.length, 1);
  const params = new URLSearchParams(tokenCalls[0].body);
  assert.equal(params.get('code'), CODE);
  assert.equal(params.get('redirect_uri'), `${origin}/api/kroger/callback`);
  assert.equal(tokenCalls[0].headers.Authorization, `Basic ${Buffer.from('test-id:test-secret').toString('base64')}`);
  assert.match(await readFile(join(dir, 'kroger-tokens.json'), 'utf8'), /r-e2e/);
  assert.equal((await si.getKrogerStatus()).connected, true);

  // The code was deleted by the claim.
  const again = await fetch(`${origin}/api/kroger/claim`, {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify({ state }),
  });
  assert.equal(again.status, 404);
});

test('phone signs in after the starting process is gone; a second process picks it up', async () => {
  const dir2 = await mkdtemp(join(tmpdir(), 'kroger-e2e-late-'));
  try {
    const tokenCalls = [];
    const fetchImpl = async (url, init) => {
      if (url === 'https://api.kroger.com/v1/connect/oauth2/token') {
        tokenCalls.push({ body: String(init.body) });
        return new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r-late', expires_in: 1800 }), { status: 200 });
      }
      assert.ok(String(url).startsWith(origin), `non-loopback fetch ${url}`);
      return fetch(url, init);
    };
    const env = {
      KROGER_CLIENT_ID: 'test-id',
      KROGER_CLIENT_SECRET: 'test-secret',
      KROGER_RELAY_URL: origin,
      KROGER_RELAY_SECRET: SECRET,
      KROGER_TOKEN_DIR: dir2,
    };
    // Process A texts the link, polls briefly and is gone before the patient finishes.
    const a = createKrogerSignIn({ env, fetchImpl, pollMs: 15, maxWaitMs: 60, unrefTimers: false });
    const { link } = await a.startKrogerSignIn();
    const state = link.split('/k/')[1];
    assert.deepEqual(await a.waitForKrogerSignIn(), { ok: false, error: 'timed_out' });
    a.cancel();
    assert.equal((await readdir(dir2)).includes('kroger-signin-pending.json'), true);

    // The phone follows the link and signs in after A stopped.
    const hop = await fetch(link, { redirect: 'manual' });
    assert.equal(hop.status, 302);
    const done = await fetch(`${origin}/api/kroger/callback?code=${CODE}&state=${state}`);
    assert.equal(done.status, 200);

    // Process B never started anything; its first status check claims, exchanges and saves.
    const b = createKrogerSignIn({ env, fetchImpl, unrefTimers: false });
    assert.deepEqual(await b.getKrogerStatus(), { ok: true, configured: true, relay: true, connected: true, pending: false });
    assert.equal(tokenCalls.length, 1);
    const params = new URLSearchParams(tokenCalls[0].body);
    assert.equal(params.get('code'), CODE);
    assert.equal(params.get('redirect_uri'), `${origin}/api/kroger/callback`);
    assert.match(await readFile(join(dir2, 'kroger-tokens.json'), 'utf8'), /r-late/);
    assert.equal((await readdir(dir2)).includes('kroger-signin-pending.json'), false);

    const again = await fetch(`${origin}/api/kroger/claim`, {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    assert.equal(again.status, 404);
  } finally {
    await rm(dir2, { recursive: true, force: true });
  }
});
