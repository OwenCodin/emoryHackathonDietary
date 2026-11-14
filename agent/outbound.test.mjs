import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkinGreeting, greeting } from './prompt.mjs';
import { outboundCall, outboundRequested, parseJobMetadata, safeReason } from './outbound.mjs';

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
