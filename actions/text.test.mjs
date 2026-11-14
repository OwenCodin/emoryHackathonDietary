import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTextSender } from './text.mjs';

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
