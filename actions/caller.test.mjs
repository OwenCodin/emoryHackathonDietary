import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCallerLookup } from './caller.mjs';

const env = { CHERT_API_KEY: 'ftk_test_key', CHERT_PROJECT_ID: 'project-id' };
const PHONE = '+15555550123';
const rec = (extra = {}) => ({ id: 'call_1', from: { type: 'phone_number', value: PHONE }, ...extra });
const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
const notOk = (status = 404) => ({ ok: false, status, json: async () => ({}) });

function lookup(handler, e = env) {
  const urls = [];
  const headers = [];
  const fn = createCallerLookup({
    env: e,
    fetchImpl: async (url, options) => {
      urls.push(url);
      headers.push(options.headers);
      return handler(url);
    },
  });
  return { fn, urls, headers };
}

test('reads the phone from data', async () => {
  const { fn, urls, headers } = lookup(() => okJson({ data: rec() }));
  assert.deepEqual(await fn({ callId: 'call_1' }), { ok: true, phone: PHONE });
  assert.match(urls[0], /\/calls\/call_1$/);
  assert.equal(headers[0].Authorization, 'Bearer ftk_test_key');
  assert.equal(headers[0]['X-Chert-Project-Id'], 'project-id');
});

test('reads the phone from data.items[0]', async () => {
  const { fn } = lookup(() => okJson({ data: { items: [rec()] } }));
  assert.deepEqual(await fn({ callId: 'call_1' }), { ok: true, phone: PHONE });
});

test('falls back to the list on 404', async () => {
  const { fn, urls } = lookup((url) => (url.includes('/calls/') ? notOk() : okJson({ data: { items: [rec()] } })));
  assert.deepEqual(await fn({ callId: 'call_1' }), { ok: true, phone: PHONE });
  assert.match(urls[1], /\/calls\?limit=20$/);
});

test('list without the id is not_found', async () => {
  const { fn } = lookup((url) => (url.includes('/calls/') ? notOk() : okJson({ data: { items: [rec({ id: 'other' })] } })));
  assert.deepEqual(await fn({ callId: 'call_1' }), { ok: false, error: 'not_found' });
});

test('email and non-E.164 handles are not_a_phone', async () => {
  const a = lookup(() => okJson({ data: rec({ from: { type: 'email', value: 'a@b.co' } }) }));
  assert.deepEqual(await a.fn({ callId: 'call_1' }), { ok: false, error: 'not_a_phone' });
  const b = lookup(() => okJson({ data: rec({ from: { type: 'phone_number', value: '555' } }) }));
  assert.deepEqual(await b.fn({ callId: 'call_1' }), { ok: false, error: 'not_a_phone' });
});

test('missing or wrong key is not_configured with no request', async () => {
  for (const e of [{}, { CHERT_API_KEY: 'sk_nope', CHERT_PROJECT_ID: 'p' }, { CHERT_API_KEY: 'ftk_x' }]) {
    const { fn, urls } = lookup(() => okJson({}), e);
    assert.deepEqual(await fn({ callId: 'call_1' }), { ok: false, error: 'not_configured' });
    assert.equal(urls.length, 0);
  }
});

test('bad call ids make no request', async () => {
  for (const callId of ['', 'a/b', '..', 'a b', 'x'.repeat(129), undefined, 5]) {
    const { fn, urls } = lookup(() => okJson({}));
    assert.deepEqual(await fn({ callId }), { ok: false, error: 'bad_call_id' });
    assert.equal(urls.length, 0);
  }
});

test('network errors and bad json never throw', async () => {
  const a = lookup(() => { throw new Error('boom'); });
  assert.deepEqual(await a.fn({ callId: 'call_1' }), { ok: false, error: 'lookup_failed' });
  const b = lookup(() => ({ ok: true, status: 200, json: async () => { throw new Error('bad'); } }));
  assert.deepEqual(await b.fn({ callId: 'call_1' }), { ok: false, error: 'lookup_failed' });
  const c = lookup(() => { const e = new Error('t'); e.name = 'AbortError'; throw e; });
  assert.deepEqual(await c.fn({ callId: 'call_1' }), { ok: false, error: 'lookup_failed' });
});

test('nothing is logged', async () => {
  const seen = [];
  const orig = { log: console.log, error: console.error };
  console.log = (...a) => seen.push(a.join(' '));
  console.error = (...a) => seen.push(a.join(' '));
  try {
    const { fn } = lookup(() => okJson({ data: rec() }));
    await fn({ callId: 'call_1' });
  } finally {
    console.log = orig.log;
    console.error = orig.error;
  }
  assert.equal(seen.join('').includes('5555550123'), false);
});
