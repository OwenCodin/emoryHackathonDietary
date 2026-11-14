import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bargeInConfig, callWarnMs, createReplyWatchdog } from './turns.mjs';
import { replyNudge } from './prompt.mjs';

const clock = () => { const c = { t: 1000, now: () => c.t, tick: ms => { c.t += ms; } }; return c; };
const make = () => { const c = clock(); return { c, w: createReplyWatchdog({ now: c.now, waitMs: 6000, maxNudges: 3 }) }; };
const turnEnded = w => { w.userState('speaking'); w.userState('listening'); };

describe('bargeInConfig', () => {
  it('is off by default and for anything but "1"', () => {
    for (const v of [undefined, '', '0', 'true', ' 1']) {
      assert.deepEqual(bargeInConfig(v === undefined ? {} : { AGENT_ALLOW_BARGE_IN: v }), { activityHandling: 'NO_INTERRUPTION' });
    }
  });
  it('keeps default behaviour with "1"', () => {
    assert.equal(bargeInConfig({ AGENT_ALLOW_BARGE_IN: '1' }), undefined);
  });
});

describe('callWarnMs', () => {
  it('falls back to 240 s', () => {
    for (const v of [undefined, '', 'abc', '0', '-5', 'Infinity', 5]) assert.equal(callWarnMs(v), 240000);
  });
  it('parses and caps', () => {
    assert.equal(callWarnMs('10'), 10000);
    assert.equal(callWarnMs('99999'), 3600000);
  });
});

describe('createReplyWatchdog', () => {
  it('is never due before arm', () => {
    const { c, w } = make();
    turnEnded(w); c.tick(20000);
    assert.equal(w.due(), false);
  });
  it('is due 6 s after an unanswered turn ended, not before', () => {
    const { c, w } = make();
    w.arm(); turnEnded(w);
    c.tick(5999); assert.equal(w.due(), false);
    c.tick(1); assert.equal(w.due(), true);
  });
  it('is not due again after nudged()', () => {
    const { c, w } = make();
    w.arm(); turnEnded(w); c.tick(6000);
    assert.equal(w.due(), true);
    w.nudged(); c.tick(20000);
    assert.equal(w.due(), false);
    assert.equal(w.nudges, 1);
  });
  it('agent speech after the turn started means no nudge, before or after it ended', () => {
    let { c, w } = make();
    w.arm(); w.userState('speaking'); w.agentState('speaking'); w.agentState('listening'); w.userState('listening'); c.tick(7000);
    assert.equal(w.due(), false);
    ({ c, w } = make());
    w.arm(); turnEnded(w); c.tick(1000); w.agentState('speaking'); w.agentState('listening'); c.tick(7000);
    assert.equal(w.due(), false);
  });
  it('a turn that starts while the agent is speaking is answered by that speech', () => {
    const { c, w } = make();
    w.arm(); w.agentState('speaking'); w.userState('speaking'); w.userState('listening'); w.agentState('listening'); c.tick(6000);
    assert.equal(w.due(), false);
  });
  it('a tool run after the turn started means no nudge', () => {
    const { c, w } = make();
    w.arm(); turnEnded(w); w.toolsExecuted(); c.tick(7000);
    assert.equal(w.due(), false);
  });
  it('waits for an open tool, then becomes due; count never goes negative', () => {
    const { c, w } = make();
    w.arm(); turnEnded(w); w.toolActivity(1); c.tick(7000);
    assert.equal(w.due(), false);
    w.toolActivity(-1); assert.equal(w.due(), true);
    w.toolActivity(-1); w.toolActivity(-1); w.toolActivity(1);
    assert.equal(w.due(), false);
    w.toolActivity(-1); assert.equal(w.due(), true);
  });
  it('is not due while the agent or the caller is speaking now', () => {
    const { c, w } = make();
    w.arm(); turnEnded(w); c.tick(7000);
    w.agentState('speaking'); assert.equal(w.due(), false);
  });
  it('is not due while the caller is speaking, and a new turn replaces the old one', () => {
    const { c, w } = make();
    w.arm(); turnEnded(w); c.tick(7000);
    w.userState('speaking'); assert.equal(w.due(), false);
    w.userState('listening'); assert.equal(w.due(), false); // new turn, just ended
    c.tick(6000); assert.equal(w.due(), true);
  });
  it('allows at most three nudges per call', () => {
    const { c, w } = make();
    w.arm();
    for (let i = 0; i < 3; i++) { turnEnded(w); c.tick(6000); assert.equal(w.due(), true); w.nudged(); }
    turnEnded(w); c.tick(6000);
    assert.equal(w.due(), false);
  });
  it('disarm is permanent', () => {
    const { c, w } = make();
    w.arm(); turnEnded(w); c.tick(7000); w.disarm();
    assert.equal(w.due(), false);
    w.arm(); turnEnded(w); c.tick(7000);
    assert.equal(w.due(), false);
  });
  it('thinking alone does not block a nudge', () => {
    const { c, w } = make();
    w.arm(); turnEnded(w); w.agentState('thinking'); c.tick(6000);
    assert.equal(w.due(), true);
  });
  it('tolerates odd input', () => {
    const { w } = make();
    w.arm();
    assert.doesNotThrow(() => { w.userState(null); w.agentState(42); w.toolActivity(NaN); w.toolActivity(undefined); w.toolsExecuted(); w.nudged(); w.due(); });
  });
});

describe('replyNudge', () => {
  it('is a fixed instruction', () => {
    assert.equal(typeof replyNudge, 'string');
    assert.ok(replyNudge.includes('repeat') && replyNudge.includes('Answer'));
  });
});
