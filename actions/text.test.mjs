import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTextSender, createInboundCheck } from './text.mjs';

const config = {
  CHERT_API_KEY: 'ftk_test_key',
  CHERT_PROJECT_ID: 'project-id',
  CHERT_LINE_ID: 'line-id',
  PATIENT_PHONE: '+15551234567',
};

function withConfig(callback) {
  const previous = Object.fromEntries(
    Object.keys(config).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, config);
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test('sendText posts only to the configured patient with an idempotency key', async () => {
  await withConfig(async () => {
    const requests = [];
    const sendText = createTextSender({
      createKey: () => 'unique-key',
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return { ok: true, status: 201, json: async () => ({ state: 'sent' }) };
      },
    });

    assert.deepEqual(
      await sendText({ phone: config.PATIENT_PHONE, text: 'Dinner is ready.' }),
      { ok: true },
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.headers['Idempotency-Key'], 'msg-unique-key');
    assert.equal(requests[0].options.headers['X-Chert-Project-Id'], config.CHERT_PROJECT_ID);
    assert.equal(JSON.parse(requests[0].options.body).recipient, config.PATIENT_PHONE);
  });
});

test('sendText rejects any recipient other than the configured patient', async () => {
  await withConfig(async () => {
    let requestCount = 0;
    const sendText = createTextSender({
      fetchImpl: async () => {
        requestCount += 1;
        throw new Error('must not fetch');
      },
    });

    assert.deepEqual(
      await sendText({ phone: '+15550000000', text: 'Dinner is ready.' }),
      { ok: false, error: 'Recipient must be the configured verified patient number' },
    );
    assert.equal(requestCount, 0);
  });
});

test('sendText does not retry when Chert reports an unknown outcome', async () => {
  await withConfig(async () => {
    const requests = [];
    const sendText = createTextSender({
      createKey: () => 'unique-key',
      fetchImpl: async (url, options = {}) => {
        requests.push({ url, options });
        if (options.method === 'POST') {
          return { ok: true, status: 202, json: async () => ({ state: 'unknown' }) };
        }
        return { ok: true, status: 200, json: async () => ({ messages: [] }) };
      },
    });

    assert.deepEqual(
      await sendText({ phone: config.PATIENT_PHONE, text: 'Dinner is ready.' }),
      { ok: false, error: 'Send outcome is unknown; inspect Chert before retrying' },
    );
    assert.equal(requests.length, 2);
    assert.equal(requests[0].options.method, 'POST');
    assert.equal(requests[1].options.method, undefined);
  });
});

test('sendText does not report rejected messages as successful', async () => {
  await withConfig(async () => {
    const sendText = createTextSender({
      fetchImpl: async () => ({
        ok: true,
        status: 201,
        json: async () => ({ state: 'failed' }),
      }),
    });

    assert.deepEqual(
      await sendText({ phone: config.PATIENT_PHONE, text: 'Dinner is ready.' }),
      { ok: false, error: 'Chert could not send the message' },
    );
  });
});

// ---- per-caller texting (allow), reply window, inbound check ----
const CALLER = '+15555550123';
const sentOk = async () => ({ ok: true, status: 201, json: async () => ({ state: 'sent' }) });

test('sendText refuses another number without allow', async () => {
  await withConfig(async () => {
    let calls = 0;
    const sendText = createTextSender({ fetchImpl: async () => { calls++; return sentOk(); } });
    const r = await sendText({ phone: CALLER, text: 'hi' });
    assert.equal(r.ok, false);
    assert.equal(calls, 0);
  });
});

test('sendText posts to the allowed caller, and refuses a third number', async () => {
  await withConfig(async () => {
    const bodies = [];
    const sendText = createTextSender({
      fetchImpl: async (url, o) => { bodies.push(o.body); return sentOk(); },
    });
    assert.deepEqual(await sendText({ phone: CALLER, text: 'hi', allow: CALLER }), { ok: true });
    assert.equal(JSON.parse(bodies[0]).recipient, CALLER);
    const r = await sendText({ phone: '+15555550999', text: 'hi', allow: CALLER });
    assert.equal(r.ok, false);
    assert.equal(bodies.length, 1);
    const bad = await sendText({ phone: 'abc', text: 'hi', allow: 'abc' });
    assert.equal(bad.ok, false);
  });
});

test('403 shared_reply_window_closed gets a code; unreadable 403 does not', async () => {
  await withConfig(async () => {
    const a = createTextSender({
      fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: { code: 'shared_reply_window_closed' } }) }),
    });
    assert.deepEqual(await a({ phone: config.PATIENT_PHONE, text: 'hi' }), {
      ok: false, error: 'Chert rejected the message (HTTP 403)', code: 'reply_window_closed',
    });
    const b = createTextSender({
      fetchImpl: async () => ({ ok: false, status: 403, json: async () => { throw new Error('x'); } }),
    });
    assert.deepEqual(await b({ phone: config.PATIENT_PHONE, text: 'hi' }), {
      ok: false, error: 'Chert rejected the message (HTTP 403)',
    });
  });
});

const NOW = Date.parse('2026-11-14T12:00:00Z');
const inboundEnv = { CHERT_API_KEY: 'ftk_k', CHERT_PROJECT_ID: 'p', CHERT_LINE_ID: 'line-id' };
function inbound(items, { ok = true } = {}) {
  let reads = 0;
  const check = createInboundCheck({
    env: inboundEnv,
    now: () => NOW,
    sleep: async () => {},
    fetchImpl: async () => { reads++; return { ok, status: ok ? 200 : 500, json: async () => ({ data: { items } }) }; },
  });
  return { check, reads: () => reads };
}
const msg = (extra) => ({ direction: 'inbound', masked_recipient: '•••0123', created_at: new Date(NOW - 3600e3).toISOString(), line_id: 'line-id', ...extra });

test('hasRecentInboundText matches by last four within 24 h', async () => {
  assert.deepEqual(await inbound([msg()]).check({ phone: CALLER }), { ok: true, texted: true });
});

test('hasRecentInboundText: no match after all tries', async () => {
  for (const items of [
    [msg({ direction: 'outbound' })],
    [msg({ masked_recipient: '•••9999' })],
    [msg({ created_at: new Date(NOW - 25 * 3600e3).toISOString() })],
  ]) {
    const t = inbound(items);
    assert.deepEqual(await t.check({ phone: CALLER }), { ok: true, texted: false });
    assert.equal(t.reads(), 3);
  }
});

test('hasRecentInboundText: failures and bad phone', async () => {
  assert.deepEqual(await inbound([], { ok: false }).check({ phone: CALLER }), { ok: false, error: 'lookup_failed' });
  assert.deepEqual(await inbound([]).check({ phone: 'nope' }), { ok: false, error: 'no_phone' });
});
