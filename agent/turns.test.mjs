import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bargeInConfig, callWarnMs, createReplyWatchdog, turnHandlingConfig } from './turns.mjs';
import { replyNudge } from './prompt.mjs';

const clock = () => { const c = { t: 1000, now: () => c.t, tick: ms => { c.t += ms; } }; return c; };
const make = () => { const c = clock(); return { c, w: createReplyWatchdog({ now: c.now, waitMs: 6000, maxNudges: 3 }) }; };
// One caller utterance: Gemini's transcript pieces for a fresh item (isFinal false, growing), as user_input_transcribed gives them.
let nextItem = 0;
const turnEnded = w => { const itemId = `GI_${++nextItem}`; w.heard({ itemId, isFinal: false, length: 4 }); w.heard({ itemId, isFinal: false, length: 18 }); return itemId; };

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

describe('turnHandlingConfig', () => {
  it('turns LiveKit speech interruption off by default and for anything but "1", keeping caller audio', () => {
    for (const v of [undefined, '', '0', 'true', ' 1']) {
      assert.deepEqual(turnHandlingConfig(v === undefined ? {} : { AGENT_ALLOW_BARGE_IN: v }),
        { interruption: { enabled: false, discardAudioIfUninterruptible: false } });
    }
  });
  it('leaves LiveKit defaults (interruptible) with "1"', () => {
    assert.equal(turnHandlingConfig({ AGENT_ALLOW_BARGE_IN: '1' }), undefined);
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
  it('is never due before arm (nothing before the greeting was requested)', () => {
    const { c, w } = make();
    turnEnded(w); c.tick(20000);
    assert.equal(w.due(), false);
    w.arm(); c.tick(20000);
    assert.equal(w.due(), false); // words heard before arm are not a turn
  });
  it('is due 6 s after an unanswered turn ended, not before', () => {
    const { c, w } = make();
    w.arm(); turnEnded(w);
    c.tick(5999); assert.equal(w.due(), false);
    c.tick(1); assert.equal(w.due(), true);
  });
  it('is not due again after nudged(): one nudge per caller turn', () => {
    const { c, w } = make();
    w.arm(); turnEnded(w); c.tick(6000);
    assert.equal(w.due(), true);
    w.nudged(); c.tick(20000);
    assert.equal(w.due(), false);
    assert.equal(w.nudges, 1);
  });
  it('normal answered turn: agent speech after the turn ended means no nudge', () => {
    const { c, w } = make();
    w.arm(); turnEnded(w); c.tick(800); w.agentState('thinking'); c.tick(700); w.agentState('speaking'); c.tick(3000); w.agentState('listening');
    c.tick(20000);
    assert.equal(w.due(), false);
  });
  it('the observed failure: turn ends, a tool starts and is cancelled, no speech: nudge fires once', () => {
    const { c, w } = make();
    w.arm(); turnEnded(w);
    c.tick(5); w.agentState('thinking'); w.toolActivity(1);
    c.tick(5); w.agentState('listening'); // the reply was aborted
    c.tick(3); w.toolActivity(-1); // the cancelled tool settles
    c.tick(5999); assert.equal(w.due(), false);
    c.tick(1); assert.equal(w.due(), true);
    w.nudged(); c.tick(30000);
    assert.equal(w.due(), false);
    assert.equal(w.nudges, 1);
  });
  it('a tool that finishes is not an answer: no speech after it, nudge 6 s after it finished', () => {
    const { c, w } = make();
    w.arm(); turnEnded(w); w.agentState('thinking'); w.toolActivity(1);
    c.tick(4000); w.toolActivity(-1); w.toolsExecuted(); w.agentState('listening');
    c.tick(5999); assert.equal(w.due(), false);
    c.tick(1); assert.equal(w.due(), true);
  });
  it('answer after a tool: no nudge', () => {
    const { c, w } = make();
    w.arm(); turnEnded(w); w.agentState('thinking'); w.toolActivity(1);
    c.tick(7000); assert.equal(w.due(), false); // a running tool holds the nudge back
    w.toolActivity(-1); w.toolsExecuted(); c.tick(1500); w.agentState('speaking'); c.tick(2000); w.agentState('listening');
    c.tick(20000);
    assert.equal(w.due(), false);
  });
  it('thinking for longer than 6 s then speech: no nudge', () => {
    const { c, w } = make();
    w.arm(); turnEnded(w); w.agentState('thinking');
    c.tick(9000); assert.equal(w.due(), false);
    w.agentState('speaking'); c.tick(2000); w.agentState('listening'); c.tick(20000);
    assert.equal(w.due(), false);
  });
  it('thinking that ends without speech restarts the clock', () => {
    const { c, w } = make();
    w.arm(); turnEnded(w); w.agentState('thinking');
    c.tick(4000); w.agentState('listening');
    c.tick(5999); assert.equal(w.due(), false);
    c.tick(1); assert.equal(w.due(), true);
  });
  it('a thinking spell that never ends stops holding the nudge after the cap', () => {
    const { c, w } = make();
    w.arm(); turnEnded(w); w.agentState('thinking');
    c.tick(14999); assert.equal(w.due(), false);
    c.tick(1); assert.equal(w.due(), true);
  });
  it('a turn overlapping agent speech is not answered by that overlap', () => {
    const { c, w } = make();
    w.arm(); w.agentState('speaking'); c.tick(1000);
    turnEnded(w); c.tick(500); w.agentState('listening'); // stopped 0.5 s after the caller's turn ended
    c.tick(5999); assert.equal(w.due(), false); // the clock restarts when that speech ends
    c.tick(1); assert.equal(w.due(), true);
  });
  it('a turn overlapping agent speech is answered when that speech goes on long enough after it', () => {
    const { c, w } = make();
    w.arm(); w.agentState('speaking'); c.tick(1000);
    turnEnded(w); c.tick(1500); w.agentState('listening');
    c.tick(20000);
    assert.equal(w.due(), false);
  });
  it('an overlapped turn is answered by new speech that starts after it', () => {
    const { c, w } = make();
    w.arm(); w.agentState('speaking'); turnEnded(w); c.tick(200); w.agentState('listening');
    c.tick(2000); w.agentState('speaking'); c.tick(1000); w.agentState('listening'); c.tick(20000);
    assert.equal(w.due(), false);
  });
  it('is never due while the agent is speaking', () => {
    const { c, w } = make();
    w.arm(); w.agentState('speaking'); turnEnded(w); c.tick(500);
    // still speaking long after the turn ended: never a nudge on top of it
    c.tick(30000); assert.equal(w.due(), false);
  });
  it('more words from the caller extend the turn; the clock starts from the last of them', () => {
    const { c, w } = make();
    w.arm();
    w.heard({ itemId: 'A', isFinal: false, length: 5 });
    c.tick(5000); w.heard({ itemId: 'A', isFinal: false, length: 20 });
    c.tick(5999); assert.equal(w.due(), false);
    c.tick(1); assert.equal(w.due(), true);
  });
  it('the full transcript repeated at the end of the generation does not reopen an answered turn', () => {
    const { c, w } = make();
    w.arm();
    w.heard({ itemId: 'A', isFinal: false, length: 18 });
    c.tick(1000); w.agentState('speaking'); c.tick(3000); w.agentState('listening');
    w.heard({ itemId: 'A', isFinal: true, length: 18 });
    w.heard({ itemId: 'A', isFinal: false, length: 18 }); // no new words
    c.tick(20000);
    assert.equal(w.due(), false);
  });
  it('a final transcript for an item not seen before is a turn; empty or odd transcripts are not', () => {
    let { c, w } = make();
    w.arm(); w.heard({ itemId: 'B', isFinal: true, length: 12 }); c.tick(6000);
    assert.equal(w.due(), true);
    ({ c, w } = make());
    w.arm();
    w.heard({ itemId: 'C', isFinal: false, length: 0 });
    w.heard({ itemId: 'D', isFinal: false, length: NaN });
    w.heard({ itemId: null, isFinal: true, length: 9 });
    w.heard();
    c.tick(20000);
    assert.equal(w.due(), false);
  });
  it('a new question after an answer is a new turn', () => {
    const { c, w } = make();
    w.arm(); turnEnded(w); c.tick(1000); w.agentState('speaking'); c.tick(2000); w.agentState('listening');
    c.tick(3000); turnEnded(w);
    c.tick(6000); assert.equal(w.due(), true);
  });
  it('words after a nudge start a new turn that can be nudged once more', () => {
    const { c, w } = make();
    w.arm(); turnEnded(w); c.tick(6000); assert.equal(w.due(), true); w.nudged();
    c.tick(2000); turnEnded(w);
    c.tick(6000); assert.equal(w.due(), true);
  });
  it('waits for an open tool, then restarts the clock; count never goes negative', () => {
    const { c, w } = make();
    w.arm(); turnEnded(w); w.toolActivity(1); c.tick(7000);
    assert.equal(w.due(), false);
    w.toolActivity(-1); assert.equal(w.due(), false);
    c.tick(6000); assert.equal(w.due(), true);
    w.toolActivity(-1); w.toolActivity(-1); w.toolActivity(1);
    assert.equal(w.due(), false);
    w.toolActivity(-1); c.tick(6000); assert.equal(w.due(), true);
  });
  it('allows at most three nudges per call', () => {
    const { c, w } = make();
    w.arm();
    for (let i = 0; i < 3; i++) { turnEnded(w); c.tick(6000); assert.equal(w.due(), true); w.nudged(); }
    turnEnded(w); c.tick(6000);
    assert.equal(w.due(), false);
    assert.equal(w.nudges, 3);
  });
  it('disarm is permanent: nothing after stop', () => {
    const { c, w } = make();
    w.arm(); turnEnded(w); c.tick(7000); w.disarm();
    assert.equal(w.due(), false);
    w.arm(); turnEnded(w); c.tick(7000);
    assert.equal(w.due(), false);
  });
  it('tolerates odd input', () => {
    const { w } = make();
    w.arm();
    assert.doesNotThrow(() => {
      w.heard(null); w.heard({ itemId: {}, length: '3' }); w.agentState(42); w.agentState(undefined);
      w.toolActivity(NaN); w.toolActivity(undefined); w.toolsExecuted(); w.nudged(); w.due();
    });
  });
});

describe('time warning deferral (warnReady, ignoreNextSpeech)', () => {
  it('is ready at once when the agent is idle and no caller turn is waiting', () => {
    const { c, w } = make();
    w.arm(); w.agentState('listening'); c.tick(60000);
    assert.equal(w.warnReady(c.t), true);
  });
  it('waits while the agent speaks or thinks or a tool runs, then goes when idle', () => {
    const { c, w } = make();
    w.arm(); w.agentState('listening');
    const dueAt = c.t;
    w.agentState('speaking'); assert.equal(w.warnReady(dueAt), false);
    w.agentState('thinking'); assert.equal(w.warnReady(dueAt), false);
    w.toolActivity(1); w.agentState('listening'); assert.equal(w.warnReady(dueAt), false);
    w.toolActivity(-1); c.tick(500); assert.equal(w.warnReady(dueAt), true);
  });
  it('is not said on top of a caller turn: waits for the caller to be quiet and for the answer', () => {
    const { c, w } = make();
    w.arm(); w.agentState('listening');
    const dueAt = c.t;
    turnEnded(w);
    assert.equal(w.warnReady(dueAt), false); // caller just spoke
    c.tick(2000); assert.equal(w.warnReady(dueAt), false); // question still unanswered
    w.agentState('speaking'); c.tick(2000); assert.equal(w.warnReady(dueAt), false);
    w.agentState('listening'); assert.equal(w.warnReady(dueAt), true);
  });
  it('is not said on top of a nudge: waits for the nudge reply to start', () => {
    const { c, w } = make();
    w.arm(); w.agentState('listening'); turnEnded(w); c.tick(6000);
    assert.equal(w.due(), true); w.nudged();
    const dueAt = c.t;
    c.tick(1000); assert.equal(w.warnReady(dueAt), false);
    w.agentState('thinking'); c.tick(1000); assert.equal(w.warnReady(dueAt), false);
    w.agentState('speaking'); c.tick(2000); w.agentState('listening');
    assert.equal(w.warnReady(dueAt), true);
  });
  it('is said anyway after 20 s', () => {
    const { c, w } = make();
    w.arm(); w.agentState('speaking');
    const dueAt = c.t;
    c.tick(19999); assert.equal(w.warnReady(dueAt), false);
    c.tick(1); assert.equal(w.warnReady(dueAt), true);
  });
  it('the warning speech does not answer a pending caller turn', () => {
    const { c, w } = make();
    w.arm(); w.agentState('listening'); turnEnded(w);
    c.tick(500); w.ignoreNextSpeech(); w.agentState('speaking'); c.tick(3000); w.agentState('listening'); w.ignoreDone();
    assert.equal(w.due(), false); // the clock restarts when the warning ends
    c.tick(6000); assert.equal(w.due(), true);
  });
  it('only the next speech is ignored: the reply after the warning answers the turn', () => {
    const { c, w } = make();
    w.arm(); w.agentState('listening');
    w.ignoreNextSpeech(); w.agentState('speaking'); c.tick(3000); turnEnded(w); c.tick(200); w.agentState('listening'); w.ignoreDone();
    c.tick(1000); w.agentState('speaking'); c.tick(2000); w.agentState('listening');
    c.tick(20000); assert.equal(w.due(), false);
  });
  it('a warning that never spoke does not swallow the next reply', () => {
    let { c, w } = make();
    w.arm(); w.agentState('listening'); w.ignoreNextSpeech(); w.ignoreDone();
    turnEnded(w); c.tick(1000); w.agentState('speaking'); c.tick(2000); w.agentState('listening'); c.tick(20000);
    assert.equal(w.due(), false);
    ({ c, w } = make()); // and an unanswered request lapses on its own
    w.arm(); w.agentState('listening'); w.ignoreNextSpeech(); c.tick(15000);
    turnEnded(w); c.tick(1000); w.agentState('speaking'); c.tick(2000); w.agentState('listening'); c.tick(20000);
    assert.equal(w.due(), false);
  });
});

describe('replyNudge', () => {
  it('is a fixed instruction', () => {
    assert.equal(typeof replyNudge, 'string');
    assert.ok(replyNudge.includes('repeat') && replyNudge.includes('Answer'));
    assert.ok(replyNudge.includes('last question') && replyNudge.includes('tool'));
  });
});
