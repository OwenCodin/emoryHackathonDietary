import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPatientCaller } from './outbound.mjs';

const config = {
  CHERT_API_KEY: 'ftk_test_key',
  CHERT_PROJECT_ID: 'project-id',
  CHERT_LINE_ID: 'line-id',
  PATIENT_PHONE: '+15551234567',
  LIVEKIT_URL: 'wss://example.livekit.cloud',
  LIVEKIT_API_KEY: 'livekit-key',
  LIVEKIT_API_SECRET: 'livekit-secret',
  AGENT_NAME: 'renal-dietitian',
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

test('callPatient rejects unconfigured or unverified destinations before connecting', async () => {
  await withConfig(async () => {
    let connectCount = 0;
    const caller = createPatientCaller({
      createLiveKit: () => {
        connectCount += 1;
        throw new Error('must not connect');
      },
    });
    assert.deepEqual(
      await caller.callPatient({ phone: '+15550000000', reason: 'Dinner check-in' }),
      { ok: false, error: 'Recipient must be the configured verified patient number' },
    );
    assert.equal(connectCount, 0);
  });
});

test('callPatient dispatches the agent and requests one call with a stable idempotency key', async () => {
  await withConfig(async () => {
    const callRecords = [];
    const roomOperations = [];
    let keyIndex = 0;
    let time = 0;
    let eventCount = 0;
    const caller = createPatientCaller({
      createKey: () => `key-${++keyIndex}`,
      createLiveKit: (host) => {
        assert.equal(host, 'https://example.livekit.cloud');
        return {
          rooms: {
            createRoom: async (room) => roomOperations.push(['create', room]),
            listParticipants: async () => [{
              identity: 'agent-participant',
              tracks: [{ type: 0, muted: false }],
            }],
            updateRoomMetadata: async (...args) => roomOperations.push(['metadata', ...args]),
            deleteRoom: async (...args) => roomOperations.push(['delete', ...args]),
          },
          dispatch: {
            createDispatch: async (...args) => roomOperations.push(['dispatch', ...args]),
          },
          accessToken: () => ({
            addGrant: (grant) => roomOperations.push(['grant', grant]),
            toJwt: async () => 'participant-token',
          }),
        };
      },
      fetchImpl: async (url, options) => {
        callRecords.push({ url, options });
        if (url.endsWith('/events')) {
          eventCount += 1;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              events: eventCount === 1
                ? [{ type: 'bridge_ready' }]
                : [{ type: 'ended' }],
            }),
          };
        }
        return {
          ok: true,
          status: 201,
          json: async () => ({ data: { id: 'call-id' } }),
        };
      },
      sleep: async (ms) => {
        time += ms;
      },
      now: () => time,
      logError: () => {},
    });

    assert.deepEqual(
      await caller.callPatient({ phone: config.PATIENT_PHONE, reason: 'Dinner check-in' }),
      { ok: true, callId: 'call-id' },
    );
    const outboundRequest = callRecords.find(({ url, options }) =>
      url.endsWith('/calls') && options.method === 'POST'
    );
    assert.ok(outboundRequest);
    assert.equal(outboundRequest.options.headers['Idempotency-Key'], 'call-key-1');
    assert.equal(JSON.parse(outboundRequest.options.body).remote_participant_identity, 'agent-participant');
    assert.equal(roomOperations.some(([name]) => name === 'dispatch'), true);
  });
});

test('callPatient keeps the Chert line busy until the call monitor finishes', async () => {
  await withConfig(async () => {
    let releaseSleep;
    let sleepStarted;
    const sleeping = new Promise((resolve) => {
      sleepStarted = resolve;
    });
    const caller = createPatientCaller({
      createLiveKit: () => ({
        rooms: {
          createRoom: async () => {},
          listParticipants: async () => [{
            identity: 'agent-participant',
            tracks: [{ type: 0, muted: false }],
          }],
          updateRoomMetadata: async () => {},
          deleteRoom: async () => {},
        },
        dispatch: { createDispatch: async () => {} },
        accessToken: () => ({
          addGrant: () => {},
          toJwt: async () => 'participant-token',
        }),
      }),
      fetchImpl: async (url) => ({
        ok: true,
        status: 201,
        json: async () => url.endsWith('/events')
          ? { events: [{ type: 'ended' }] }
          : { id: 'call-id' },
      }),
      sleep: () => new Promise((resolve) => {
        releaseSleep = resolve;
        sleepStarted();
      }),
      logError: () => {},
    });

    assert.equal(
      (await caller.callPatient({ phone: config.PATIENT_PHONE, reason: 'Dinner' })).ok,
      true,
    );
    await sleeping;
    assert.deepEqual(
      await caller.callPatient({ phone: config.PATIENT_PHONE, reason: 'Dinner' }),
      { ok: false, error: 'busy' },
    );
    releaseSleep();
  });
});

test('callPatient retries an uncertain call only with the same idempotency key', async () => {
  await withConfig(async () => {
    let keyIndex = 0;
    let time = 0;
    let postCount = 0;
    const requestKeys = [];
    const caller = createPatientCaller({
      createKey: () => `key-${++keyIndex}`,
      createLiveKit: () => ({
        rooms: {
          createRoom: async () => {},
          listParticipants: async () => [{
            identity: 'agent-participant',
            tracks: [{ type: 0, muted: false }],
          }],
          updateRoomMetadata: async () => {},
          deleteRoom: async () => {},
        },
        dispatch: { createDispatch: async () => {} },
        accessToken: () => ({
          addGrant: () => {},
          toJwt: async () => 'participant-token',
        }),
      }),
      fetchImpl: async (url, options) => {
        if (url.endsWith('/events')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ events: [{ type: 'call.ended' }] }),
          };
        }
        if (url.endsWith('/end')) {
          return { ok: true, status: 202, json: async () => ({}) };
        }
        postCount += 1;
        requestKeys.push(options.headers['Idempotency-Key']);
        return postCount === 1
          ? { ok: false, status: 503, json: async () => ({}) }
          : { ok: true, status: 201, json: async () => ({ id: 'call-id' }) };
      },
      sleep: async (ms) => {
        time += ms;
      },
      now: () => time,
      logError: () => {},
    });

    assert.deepEqual(
      await caller.callPatient({ phone: config.PATIENT_PHONE, reason: 'Dinner' }),
      { ok: true, callId: 'call-id' },
    );
    assert.equal(postCount, 2);
    assert.equal(requestKeys[0], requestKeys[1]);
  });
});
