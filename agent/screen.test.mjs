import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HEIGHT, WIDTH } from '../shared/video.mjs';
import { panelEventFromDisplay, createScreen, verdictMsFrom } from './screen.mjs';

const N = WIDTH * HEIGHT * 4;
const marker = svg => svg.includes('Banana') ? 22 : svg.includes('Bread') ? 33 : 11;
const okRender = async svg => {
  const pixels = new Uint8Array(N);
  const value = marker(svg);
  for (let i = 0; i < N; i += 4) {
    pixels[i] = value;
    pixels[i + 1] = value;
    pixels[i + 2] = value;
    pixels[i + 3] = 255;
  }
  return pixels;
};
const probe = frame => frame[(450 * WIDTH + 250) * 4];
const display = (food, verdict) => ({
  items: [{ food, verdict, reason: `${food} guidance from the renal data.` }],
  unjudged: false,
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

describe('screen', () => {
  it('starts on a quiet Today panel and returns fresh full-size frames', async () => {
    const screen = createScreen({ render: okRender, log: () => {} });
    assert.equal(screen.frame()[0], 11);
    await screen.flush();
    const a = screen.frame(0, Date.now() + 500), b = screen.frame(1, Date.now() + 600);
    assert.equal(a.length, N);
    assert.ok(a instanceof Uint8Array);
    assert.notEqual(a, b);
    a[0] = 0;
    assert.notEqual(probe(screen.frame(2, 2000)), 0);
    screen.close();
  });

  it('maps existing renal display events without inventing a judgment', () => {
    assert.deepEqual(panelEventFromDisplay(display('Banana', 'ok')), {
      type: 'verdict',
      verdict: 'yes',
      food: 'Banana',
      reason: 'Banana guidance from the renal data.',
    });
    assert.equal(panelEventFromDisplay(display('Bread', 'unknown')).type, 'note');
    assert.equal(panelEventFromDisplay(null), null);
    assert.equal(panelEventFromDisplay({ items: [], unjudged: true }), null);
  });

  it('replaces a verdict and auto-dismisses back to the resting card', async () => {
    const screen = createScreen({ render: okRender, verdictMs: 20, log: () => {} });
    await screen.flush();
    assert.equal(screen.show(display('Banana', 'ok')), true);
    await screen.flush();
    assert.equal(probe(screen.frame(0, Date.now() + 500)), 22);
    assert.equal(screen.show(display('Bread', 'avoid')), true);
    await screen.flush();
    assert.equal(probe(screen.frame(0, Date.now() + 1000)), 33);
    await pause(40);
    await screen.flush();
    assert.equal(probe(screen.frame(0, Date.now() + 1000)), 11);
    screen.close();
  });

  it('rejects malformed or empty panel events without replacing the current card', async () => {
    const screen = createScreen({ render: okRender, log: () => {} });
    await screen.flush();
    assert.equal(screen.show(null), false);
    assert.equal(screen.dispatchPanelEvent({ type: 'verdict', verdict: 'yes', food: 'Apple' }), false);
    assert.equal(screen.dispatchPanelEvent({ type: 'summary', meters: [{ key: 'x', used: 2, limit: 3 }] }), false);
    await screen.flush();
    assert.equal(probe(screen.frame(0, Date.now() + 500)), 11);
    screen.close();
  });

  it('keeps the previous scene when rendering fails or times out', async () => {
    let mode = 'ok';
    const render = svg => {
      if (svg.includes('Today') || svg.includes('Ready') || mode === 'ok') return okRender(svg);
      if (mode === 'fail') return Promise.reject(new Error('render failed'));
      return new Promise(() => {});
    };
    const logs = [];
    const screen = createScreen({ render, renderTimeoutMs: 15, log: message => logs.push(message) });
    await screen.flush();
    mode = 'fail';
    screen.show(display('Banana', 'ok'));
    await screen.flush();
    assert.equal(probe(screen.frame(0, Date.now() + 500)), 11);
    mode = 'hang';
    screen.show(display('Bread', 'avoid'));
    await screen.flush();
    assert.equal(probe(screen.frame(0, Date.now() + 500)), 11);
    assert.equal(logs.filter(line => line.includes('panel render failed')).length, 1);
    screen.close();
  });

  it('uses the latest panel when asynchronous renders finish out of order', async () => {
    const gates = [];
    const render = svg => (svg.includes('Today') || svg.includes('Ready')
      ? okRender(svg)
      : new Promise(resolve => gates.push(() => resolve(okRender(svg)))));
    const screen = createScreen({ render, log: () => {} });
    await screen.flush();
    screen.show(display('Banana', 'ok'));
    screen.show(display('Bread', 'avoid'));
    await new Promise(resolve => setImmediate(resolve));
    gates[1]();
    await new Promise(resolve => setImmediate(resolve));
    gates[0]();
    await screen.flush();
    assert.equal(probe(screen.frame(0, Date.now() + 500)), 33);
    screen.close();
  });

  it('uses a twelve-second verdict default and the existing bounded override', () => {
    assert.equal(verdictMsFrom({}), 12000);
    assert.equal(verdictMsFrom({ AGENT_CARD_SECONDS: 'x' }), 12000);
    assert.equal(verdictMsFrom({ AGENT_CARD_SECONDS: '8' }), 8000);
    assert.equal(verdictMsFrom({ AGENT_CARD_SECONDS: '9999' }), 120000);
  });
});
