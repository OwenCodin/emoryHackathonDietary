import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentUIStore, normalizePanelEvent } from './ui-state.mjs';

const summary = { type: 'summary', meters: [{ key: 'fluid', label: 'Fluid', used: 450, limit: 1200, unit: 'ml' }] };
const verdict = { type: 'verdict', verdict: 'caution', food: 'Soup', reason: 'Example reason.' };

describe('PanelEvent validation', () => {
  it('accepts and copies every supported event shape', () => {
    const events = [
      summary,
      verdict,
      { type: 'note', heading: 'Today', body: 'Example note.', icon: 'info' },
      { type: 'cart', items: [{ name: 'Apples', qty: '2' }], estimatedTotal: '$4', status: 'confirming' },
    ];
    for (const event of events) {
      const normalized = normalizePanelEvent(event);
      assert.deepEqual(normalized, event);
      assert.notEqual(normalized, event);
    }
  });

  it('rejects malformed values, unknown verdicts, non-finite amounts and oversized lists', () => {
    const invalid = [
      null,
      { type: 'summary', meters: [{ key: 'fluid', label: 'Fluid', used: NaN, limit: 100, unit: 'ml' }] },
      { type: 'summary', meters: [{ key: 'fluid', label: 'Fluid', used: 20, limit: 0, unit: 'ml' }] },
      { type: 'verdict', verdict: 'maybe', food: 'Soup', reason: 'Reason.' },
      { type: 'verdict', verdict: 'yes', food: 'Soup', reason: '' },
      { type: 'verdict', verdict: 'yes', food: 'Soup', reason: 'Reason.', nutrients: Array(4).fill({ label: 'Sodium', level: 'low' }) },
      { type: 'note', heading: 'Info', body: 5 },
      { type: 'cart', items: [{ name: 'Apples' }], status: 'shipped' },
    ];
    for (const event of invalid) assert.equal(normalizePanelEvent(event), null);
    const hostile = Object.defineProperty({}, 'type', { get() { throw new Error('invalid input'); } });
    assert.equal(normalizePanelEvent(hostile), null);
  });
});

describe('Agent UI store', () => {
  it('keeps one panel, retains summaries and dismisses verdicts to the latest summary', () => {
    let expire;
    const changes = [];
    const store = createAgentUIStore({
      schedule: callback => { expire = callback; return 1; },
      cancel: () => {},
      onChange: state => changes.push(state),
    });
    assert.equal(store.setAgentState('looking'), true);
    assert.equal(store.setAgentState('unknown'), false);
    assert.equal(store.dispatchPanelEvent(summary), true);
    assert.equal(store.dispatchPanelEvent(verdict), true);
    assert.equal(store.getState().panelEvent.type, 'verdict');
    expire();
    assert.deepEqual(store.getState().panelEvent, summary);
    assert.ok(changes.length >= 4);
    store.close();
  });

  it('clamps audio levels and ignores malformed updates', () => {
    const store = createAgentUIStore();
    assert.equal(store.setOutputLevel(1.7), true);
    assert.equal(store.setMicLevel(-1), true);
    assert.equal(store.setOutputLevel(NaN), false);
    assert.equal(store.getState().outputLevel, 1);
    assert.equal(store.getState().micLevel, 0);
    store.close();
  });
});
