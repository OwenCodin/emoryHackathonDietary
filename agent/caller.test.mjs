import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { callIdFrom, patientIdFor, resolveCaller } from './caller.mjs';
import { safePatientId } from './memory.mjs';

const DEMO_PHONE = '+15555550100';
const OTHER = '+15555550123';
const counting = (result) => {
  const fn = async () => { fn.calls++; return typeof result === 'function' ? result() : result; };
  fn.calls = 0;
  return fn;
};
const open = { AGENT_OPEN_ACCESS: '1', PATIENT_PHONE: DEMO_PHONE };
const base = { identity: 'chert-bridge-abc_123', randomHex: () => 'a'.repeat(24) };

describe('callIdFrom', () => {
  it('reads the bridge identity, then room metadata, then job metadata', () => {
    assert.equal(callIdFrom({ identity: 'chert-bridge-abc_123' }), 'abc_123');
    assert.equal(callIdFrom({ identity: 'someone', roomMetadata: '{"chert_call":"abc"}' }), 'abc');
    assert.equal(callIdFrom({ roomMetadata: { chert_call: 'abc' } }), 'abc');
    assert.equal(callIdFrom({ jobMetadata: { chert_call: 'abc' } }), 'abc');
  });
  it('rejects bad json and bad ids', () => {
    assert.equal(callIdFrom({ roomMetadata: '{not json' }), null);
    assert.equal(callIdFrom({ identity: 'chert-bridge-a/b' }), null);
    assert.equal(callIdFrom({ roomMetadata: '{"chert_call":"a b"}' }), null);
    assert.equal(callIdFrom({ jobMetadata: { chert_call: 'x'.repeat(129) } }), null);
    assert.equal(callIdFrom(), null);
  });
});

describe('patientIdFor', () => {
  it('is p plus 24 hex of sha256 and survives safePatientId', () => {
    const id = patientIdFor(OTHER);
    assert.equal(id, 'p' + createHash('sha256').update(OTHER).digest('hex').slice(0, 24));
    assert.match(id, /^p[0-9a-f]{24}$/);
    assert.equal(safePatientId(id), id);
  });
});

describe('resolveCaller', () => {
  const demo = { kind: 'demo', patientId: 'demo', phone: DEMO_PHONE, textAllow: null, textFirst: false };
  it('flag off: demo, no lookup', async () => {
    for (const env of [{ PATIENT_PHONE: DEMO_PHONE }, { PATIENT_PHONE: DEMO_PHONE, AGENT_OPEN_ACCESS: '' }, { PATIENT_PHONE: DEMO_PHONE, AGENT_OPEN_ACCESS: '0' }]) {
      const lookup = counting({ ok: true, phone: OTHER });
      assert.deepEqual(await resolveCaller({ ...base, env, getCallerPhone: lookup }), demo);
      assert.equal(lookup.calls, 0);
    }
  });
  it('open access + outbound: demo, no lookup', async () => {
    const lookup = counting({ ok: true, phone: OTHER });
    assert.deepEqual(await resolveCaller({ ...base, outbound: true, env: open, getCallerPhone: lookup }), demo);
    assert.equal(lookup.calls, 0);
  });
  it('open access + the demo phone: demo', async () => {
    assert.deepEqual(await resolveCaller({ ...base, env: open, getCallerPhone: counting({ ok: true, phone: DEMO_PHONE }) }), demo);
  });
  it('open access + another phone: their own id, texting and text-first', async () => {
    assert.deepEqual(await resolveCaller({ ...base, env: open, getCallerPhone: counting({ ok: true, phone: OTHER }) }), {
      kind: 'caller', patientId: patientIdFor(OTHER), phone: OTHER, textAllow: OTHER, textFirst: true,
    });
  });
  it('open access + failure, throw, bad phone or no call id: guest', async () => {
    const guest = { kind: 'guest', patientId: 'g' + 'a'.repeat(24), phone: null, textAllow: null, textFirst: false };
    for (const lookup of [
      counting({ ok: false, error: 'not_a_phone' }),
      counting(() => { throw new Error('x'); }),
      counting({ ok: true, phone: 'nope' }),
    ]) {
      assert.deepEqual(await resolveCaller({ ...base, env: open, getCallerPhone: lookup }), guest);
    }
    const lookup = counting({ ok: true, phone: OTHER });
    assert.deepEqual(await resolveCaller({ randomHex: base.randomHex, env: open, getCallerPhone: lookup }), guest);
    assert.equal(lookup.calls, 0);
  });
  it('open access + a lookup that never settles: guest within the timeout', async () => {
    const started = Date.now();
    const r = await resolveCaller({ ...base, env: open, timeoutMs: 20, getCallerPhone: () => new Promise(() => {}) });
    assert.equal(r.kind, 'guest');
    assert.match(r.patientId, /^g[0-9a-f]{24}$/);
    assert.ok(Date.now() - started < 220);
  });
  it('default random guest id has the right shape', async () => {
    const r = await resolveCaller({ identity: 'x', env: open });
    assert.match(r.patientId, /^g[0-9a-f]{24}$/);
  });
});
