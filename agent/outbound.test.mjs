import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkinGreeting, greeting } from './prompt.mjs';
import { createDeadline, outboundCall, outboundRequested, outboundWaitMs, parseJobMetadata, safeReason } from './outbound.mjs';

const VALID = '{"outbound":true,"reason":"dinner_checkin","bridgeIdentity":"chert-bridge-out-sim"}';

test('parseJobMetadata parses valid outbound metadata', () => {
  assert.deepEqual(parseJobMetadata(VALID), { outbound: true, reason: 'dinner_checkin', bridgeIdentity: 'chert-bridge-out-sim' });
});

test('parseJobMetadata never throws and gives {} for bad input', () => {
  for (const raw of ['{', '', undefined, null, 42, 'null', '[1,2]', '"text"', '{"a":"' + 'x'.repeat(5000) + '"}']) {
    assert.deepEqual(parseJobMetadata(raw), {});
  }
});

test('outboundCall accepts valid outbound metadata', () => {
  assert.deepEqual(outboundCall(parseJobMetadata(VALID)), { bridgeIdentity: 'chert-bridge-out-sim', reason: 'dinner_checkin' });
});

test('outboundCall rejects everything else', () => {
  const bad = [
    {}, { sim: true }, { chert_call: 'x', media: {} },
    { outbound: true, reason: 'x' },
    { outbound: true, bridgeIdentity: 'agent-123' },
    { outbound: true, bridgeIdentity: 'bridge-chert-1' },
    { outbound: true, bridgeIdentity: 'chert-bridge-' },
    { outbound: true, bridgeIdentity: 'chert-bridge-a b' },
    { outbound: 'true', bridgeIdentity: 'chert-bridge-out-1' },
    { outbound: true, bridgeIdentity: 7 },
    null, undefined, [], 'x',
  ];
  for (const m of bad) assert.equal(outboundCall(m), null, JSON.stringify(m));
});

test('safeReason sanitises', () => {
  assert.equal(safeReason('Dinner Check-in!'), 'dinnercheckin');
  assert.equal(safeReason('lunch_2'), 'lunch_2');
  assert.equal(safeReason('a'.repeat(100)).length, 40);
  for (const v of ['', '$$$', undefined, 42]) assert.equal(safeReason(v), 'unspecified');
  assert.doesNotMatch(safeReason('x\n[agent] fake'), /[\n\s[\]]/);
});

test('checkinGreeting content and greeting unchanged', () => {
  assert.ok(checkinGreeting.length > 0 && checkinGreeting !== greeting);
  for (const phrase of ['AI renal dietitian', 'mealtime', 'care team', 'plate']) assert.ok(checkinGreeting.includes(phrase), phrase);
  assert.ok(greeting.includes('what food they want to check'));
});

test('outboundRequested flags malformed outbound requests so they are not treated as inbound', () => {
  assert.equal(outboundRequested({ outbound: true }), true);
  assert.equal(outboundRequested({ outbound: true, bridgeIdentity: 'agent-123' }), true);
  assert.equal(outboundCall({ outbound: true, bridgeIdentity: 'agent-123' }), null);
  assert.equal(outboundRequested(parseJobMetadata(VALID)), true);
  for (const m of [{}, { sim: true }, { outbound: 'true' }, { outbound: false }, null, undefined, [], 'x']) {
    assert.equal(outboundRequested(m), false, JSON.stringify(m));
  }
});

test('outboundWaitMs defaults to 90 s and accepts a positive override', () => {
  for (const v of [undefined, '', '  ', 'abc', '0', '-5', 'Infinity', 'NaN', 7]) assert.equal(outboundWaitMs(v), 90000, String(v));
  assert.equal(outboundWaitMs('8'), 8000);
  assert.equal(outboundWaitMs('0.5'), 500);
  assert.equal(outboundWaitMs('99999'), 600000);
});

function fakeTimers() {
  const t = { fn: null, cleared: 0, set: 0 };
  t.setTimer = fn => { t.set++; t.fn = fn; return t.set; };
  t.clearTimer = () => { t.cleared++; t.fn = null; };
  return t;
}

test('createDeadline fires once when it expires', () => {
  const t = fakeTimers();
  let fired = 0;
  const d = createDeadline({ ms: 10, onExpire: () => { fired++; }, setTimer: t.setTimer, clearTimer: t.clearTimer });
  d.arm();
  t.fn();
  assert.equal(fired, 1);
  d.arm(); // closed after expiry
  assert.equal(t.set, 1);
});

test('createDeadline restarts on arm and never fires after clear', () => {
  const t = fakeTimers();
  let fired = 0;
  const d = createDeadline({ ms: 10, onExpire: () => { fired++; }, setTimer: t.setTimer, clearTimer: t.clearTimer });
  d.arm();
  d.arm(); // bridge joined: restart for the ready wait
  assert.equal(t.set, 2);
  assert.equal(t.cleared, 1);
  d.clear();
  assert.equal(t.fn, null);
  d.arm();
  assert.equal(t.set, 2);
  assert.equal(fired, 0);
});

test('createDeadline really fires with real timers', async () => {
  let fired = 0;
  const d = createDeadline({ ms: 20, onExpire: () => { fired++; } });
  d.arm();
  await new Promise(r => setTimeout(r, 80));
  assert.equal(fired, 1);
});
